/**
 * Atom 4: `atom.credential` — Device-auth, OS Keychain storage & stdin-only injection (K7).
 *
 * Security Invariants (Design Doc §5.6):
 * - `issuerUrl` MUST be within built-in allowed domain scope (`isUrlInAllowedDomainScope`).
 * - Secrets are stored in a pluggable `SecretStore` (default macOS Keychain via `/usr/bin/security`
 *   using interactive stdin so secrets never appear in argv, or encrypted file / memory store).
 * - Secrets are NEVER returned to the calling page, NEVER placed in `argv`, and NEVER logged.
 * - Secret injection ONLY delivers to the `rule.targetComponentId` installed via
 *   `atom.installComponent` via `stdin` (`stdinSecret: true`).
 * - Tracks per-installation `installationId` and revocation state in `<dataDir>/credentials-meta.json`.
 */

import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isUrlInAllowedDomainScope } from '../../shared/desktop-builtin-rules.ts';
import {
  hostErr,
  hostOk,
  type AtomCredentialStartParams,
  type AtomCredentialStartResult,
  type AtomCredentialStatusResult,
  type AtomExecResult,
  type ConfirmationFact,
  type HostInvokeResult,
  type HostPlatform,
  type HostReleaseChannel,
} from '../../shared/desktop-contract.ts';
import type { SignedConfigPayload, SignedCredentialRule } from '../../shared/signed-config.ts';
import { assertFeatureAllowsResource, type FeatureConfirmationGate } from './confirmation.ts';
import type { ExecAtom } from './exec.ts';
import type { SerialMutationQueue } from './serial-queue.ts';

const CREDENTIALS_META_FILE = 'credentials-meta.json';
const DEFAULT_KEYCHAIN_SERVICE = 'io.nexu.openmotion.credentials';
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export type SecretStore = {
  get: (account: string) => Promise<string | null>;
  set: (account: string, secret: string) => Promise<void>;
  delete: (account: string) => Promise<boolean>;
};

export type CredentialHttpResponse = {
  status: number;
  body: Record<string, unknown>;
};

export type CredentialHttpClient = (
  url: string,
  options: {
    method: 'POST';
    headers?: Record<string, string>;
    body: Record<string, unknown>;
    timeoutMs: number;
  },
) => Promise<CredentialHttpResponse>;

export type AtomCredentialPollParams = {
  featureId: string;
  credentialId: string;
  sessionId: string;
};

export type AtomCredentialPollResult =
  | {
      status: 'pending';
      retryAfterMs: number;
    }
  | {
      status: 'authorized';
      credentialId: string;
      stored: true;
      accountId?: string;
      installationId: string;
      updatedAt: string;
    };

export type AtomCredentialInjectParams = {
  featureId: string;
  credentialId: string;
  templateId: string;
  args?: Record<string, string | boolean>;
};

export type AtomCredentialRevokeParams = {
  featureId: string;
  credentialId: string;
};

export type AtomCredentialRevokeResult = {
  credentialId: string;
  revoked: true;
  installationId?: string;
  revokedAt: string;
};

type CredentialMetadataRecord = {
  credentialId: string;
  accountId?: string;
  installationId: string;
  secretAccountKey: string;
  updatedAt: string;
  revoked: boolean;
  revokedAt?: string;
};

type PersistedCredentialsMetaFile = {
  schemaVersion: number;
  credentials: Record<string, CredentialMetadataRecord>;
};

type PendingDeviceAuthSession = {
  sessionId: string;
  credentialId: string;
  deviceCode: string;
  expiresAtMs: number;
  intervalMs: number;
};

export type CredentialAtomDeps = {
  dataDir: string;
  platform?: HostPlatform;
  channel?: HostReleaseChannel;
  allowLocalDevLoopback?: boolean;
  getSignedConfig: () => SignedConfigPayload;
  confirmationGate: FeatureConfirmationGate;
  mutationQueue: SerialMutationQueue;
  execAtom: ExecAtom;
  secretStore?: SecretStore;
  httpClient?: CredentialHttpClient;
  httpTimeoutMs?: number;
  now?: () => Date;
};

function normalizePlatform(raw: NodeJS.Platform | HostPlatform): HostPlatform {
  if (raw === 'darwin' || raw === 'win32' || raw === 'linux') return raw;
  return 'linux';
}

/* -------------------------------------------------------------------------- */
/*  SecretStore implementations                                               */
/* -------------------------------------------------------------------------- */

export function createMemorySecretStore(): SecretStore {
  const store = new Map<string, string>();
  return {
    async get(account) {
      return store.get(account) ?? null;
    },
    async set(account, secret) {
      store.set(account, secret);
    },
    async delete(account) {
      return store.delete(account);
    },
  };
}

function escapeKeychainToken(value: string): string {
  // Reject control characters that could break `security -i` line framing.
  if (/[\r\n\0]/.test(value)) {
    throw new Error('Secret or account identifier contains disallowed newline/null characters');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function createMacOsKeychainSecretStore(serviceName = DEFAULT_KEYCHAIN_SERVICE): SecretStore {
  const runSecurity = (args: string[], stdin?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
    new Promise(resolve => {
      const child = execFile(
        '/usr/bin/security',
        args,
        { encoding: 'utf8', shell: false, timeout: 10_000, maxBuffer: 256 * 1024 },
        (error, stdout, stderr) => {
          const out = typeof stdout === 'string' ? stdout : '';
          const err = typeof stderr === 'string' ? stderr : '';
          if (!error) {
            resolve({ exitCode: 0, stdout: out, stderr: err });
            return;
          }
          const code = typeof (error as { code?: unknown }).code === 'number' ? Number((error as { code: number }).code) : 1;
          resolve({ exitCode: code, stdout: out, stderr: err || error.message });
        },
      );
      if (stdin !== undefined && child.stdin) {
        child.stdin.on('error', () => {});
        child.stdin.end(stdin, 'utf8');
      }
    });

  return {
    async get(account) {
      const res = await runSecurity(['find-generic-password', '-s', serviceName, '-a', account, '-w']);
      if (res.exitCode !== 0) return null;
      return res.stdout.replace(/\r?\n$/, '');
    },
    async set(account, secret) {
      // Deliver secret via `security -i` stdin so the secret NEVER appears in process argv.
      const line = `add-generic-password -U -s ${escapeKeychainToken(serviceName)} -a ${escapeKeychainToken(account)} -w ${escapeKeychainToken(secret)}\n`;
      const res = await runSecurity(['-i'], line);
      if (res.exitCode !== 0) {
        throw new Error(`macOS Keychain write failed (exit ${res.exitCode})`);
      }
    },
    async delete(account) {
      const res = await runSecurity(['delete-generic-password', '-s', serviceName, '-a', account]);
      return res.exitCode === 0;
    },
  };
}

export function createEncryptedFileSecretStore(filePath: string, keySeed?: string): SecretStore {
  const key = createHash('sha256')
    .update(keySeed ?? `${os.hostname()}:${os.userInfo().username}:${filePath}:openmotion-v1`)
    .digest();

  type Envelope = { iv: string; tag: string; data: string };

  const readMap = (): Record<string, string> => {
    if (!existsSync(filePath)) return {};
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<Envelope>;
      if (!raw.iv || !raw.tag || !raw.data) return {};
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(raw.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      const parsed = JSON.parse(plaintext) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed as Record<string, string>;
    } catch {
      return {};
    }
  };

  const writeMap = (entries: Record<string, string>): void => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(entries), 'utf8'),
      cipher.final(),
    ]);
    const envelope: Envelope = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: ciphertext.toString('base64'),
    };
    const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpPath, filePath);
  };

  return {
    async get(account) {
      const entries = readMap();
      return entries[account] ?? null;
    },
    async set(account, secret) {
      const entries = readMap();
      entries[account] = secret;
      writeMap(entries);
    },
    async delete(account) {
      const entries = readMap();
      if (!(account in entries)) return false;
      delete entries[account];
      writeMap(entries);
      return true;
    },
  };
}

export const defaultCredentialHttpClient: CredentialHttpClient = async (url, options) => {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = {};
  }
  return { status: response.status, body };
};

/* -------------------------------------------------------------------------- */
/*  CredentialAtom implementation                                             */
/* -------------------------------------------------------------------------- */

export class CredentialAtom {
  private readonly dataDir: string;
  private readonly channel: HostReleaseChannel;
  private readonly allowLocalDevLoopback: boolean;
  private readonly getSignedConfig: () => SignedConfigPayload;
  private readonly confirmationGate: FeatureConfirmationGate;
  private readonly mutationQueue: SerialMutationQueue;
  private readonly execAtom: ExecAtom;
  private readonly secretStore: SecretStore;
  private readonly httpClient: CredentialHttpClient;
  private readonly httpTimeoutMs: number;
  private readonly now: () => Date;
  private readonly pendingSessions = new Map<string, PendingDeviceAuthSession>();

  constructor(deps: CredentialAtomDeps) {
    this.dataDir = deps.dataDir;
    const platform = normalizePlatform(deps.platform ?? process.platform);
    this.channel = deps.channel ?? 'stable';
    this.allowLocalDevLoopback = deps.allowLocalDevLoopback ?? false;
    this.getSignedConfig = deps.getSignedConfig;
    this.confirmationGate = deps.confirmationGate;
    this.mutationQueue = deps.mutationQueue;
    this.execAtom = deps.execAtom;
    this.secretStore =
      deps.secretStore ??
      (platform === 'darwin'
        ? createMacOsKeychainSecretStore()
        : createEncryptedFileSecretStore(path.join(deps.dataDir, 'credentials.enc')));
    this.httpClient = deps.httpClient ?? defaultCredentialHttpClient;
    this.httpTimeoutMs = deps.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Read-only credential status. Never returns the stored secret.
   */
  async status(params: { credentialId: string }): Promise<HostInvokeResult<AtomCredentialStatusResult>> {
    if (!params?.credentialId || typeof params.credentialId !== 'string') {
      return hostErr('INVALID_PARAMS', 'credentialId is required');
    }
    const ruleResult = this.resolveRule(params.credentialId);
    if (!ruleResult.ok) return ruleResult;

    const meta = this.readMetadata()[params.credentialId];
    if (!meta || meta.revoked) {
      return hostOk({
        credentialId: params.credentialId,
        stored: false,
        installationId: meta?.installationId,
        updatedAt: meta?.updatedAt,
      });
    }

    const secret = await this.secretStore.get(meta.secretAccountKey);
    return hostOk({
      credentialId: params.credentialId,
      stored: Boolean(secret),
      accountId: meta.accountId,
      installationId: meta.installationId,
      updatedAt: meta.updatedAt,
    });
  }

  /**
   * Starts device authorization flow against the signed issuer URL.
   * Returns only `sessionId`, `verificationUri`, `userCode`, `expiresAt` — NEVER `deviceCode`.
   */
  async start(params: AtomCredentialStartParams): Promise<HostInvokeResult<AtomCredentialStartResult>> {
    if (!params?.featureId || !params?.credentialId) {
      return hostErr('INVALID_PARAMS', 'featureId and credentialId are required');
    }

    const ruleResult = this.resolveRule(params.credentialId);
    if (!ruleResult.ok) return ruleResult;
    const { signedConfig, rule } = ruleResult.data;

    const authCheck = assertFeatureAllowsResource(params.featureId, signedConfig, {
      kind: 'credential',
      id: rule.credentialId,
    });
    if (!authCheck.ok) return authCheck;

    const deviceAuthUrl = this.resolveEndpointUrl(rule.issuerUrl, rule.deviceAuthPath);
    if (!deviceAuthUrl.ok) return deviceAuthUrl;

    const facts: ConfirmationFact[] = [
      {
        kind: 'store_credential',
        label: `Authorize & store credential (${rule.credentialId})`,
        value: `Target component: ${rule.targetComponentId}`,
      },
      {
        kind: 'connect_url',
        label: 'Device authorization endpoint',
        value: deviceAuthUrl.data,
      },
    ];
    const approval = await this.confirmationGate.ensureApproved({
      featureId: params.featureId,
      signedConfig,
      facts,
    });
    if (!approval.ok) return approval;

    return this.mutationQueue.enqueue(async () => {
      let response: CredentialHttpResponse;
      try {
        response = await this.httpClient(deviceAuthUrl.data, {
          method: 'POST',
          body: {
            credential_id: rule.credentialId,
            target_component: rule.targetComponentId,
          },
          timeoutMs: this.httpTimeoutMs,
        });
      } catch (error) {
        return hostErr(
          'EXEC_FAILED',
          `Device authorization request failed: ${error instanceof Error ? error.message : String(error)}`,
          { credentialId: rule.credentialId },
        );
      }

      if (response.status < 200 || response.status >= 300) {
        return hostErr('UNAUTHORIZED', `Device authorization rejected with HTTP ${response.status}`, {
          credentialId: rule.credentialId,
          status: response.status,
        });
      }

      const deviceCode = typeof response.body.device_code === 'string' ? response.body.device_code : '';
      const verificationUri =
        typeof response.body.verification_uri_complete === 'string'
          ? response.body.verification_uri_complete
          : typeof response.body.verification_uri === 'string'
            ? response.body.verification_uri
            : '';
      const userCode = typeof response.body.user_code === 'string' ? response.body.user_code : undefined;
      const expiresInSec = typeof response.body.expires_in === 'number' && response.body.expires_in > 0
        ? response.body.expires_in
        : 600;
      const intervalSec = typeof response.body.interval === 'number' && response.body.interval > 0
        ? response.body.interval
        : DEFAULT_POLL_INTERVAL_MS / 1000;

      if (!deviceCode || !verificationUri) {
        return hostErr('VERIFICATION_FAILED', 'Device authorization response missing device_code or verification_uri', {
          credentialId: rule.credentialId,
        });
      }

      if (
        !isUrlInAllowedDomainScope(verificationUri, {
          channel: this.channel,
          allowLocalDevLoopback: this.allowLocalDevLoopback,
        })
      ) {
        return hostErr('POLICY_DENIED', 'verification_uri is outside allowed domain scope', {
          credentialId: rule.credentialId,
        });
      }

      const sessionId = randomUUID();
      const expiresAtMs = this.now().getTime() + expiresInSec * 1000;
      this.pendingSessions.set(sessionId, {
        sessionId,
        credentialId: rule.credentialId,
        deviceCode,
        expiresAtMs,
        intervalMs: Math.round(intervalSec * 1000),
      });

      return hostOk({
        sessionId,
        verificationUri,
        userCode,
        expiresAt: new Date(expiresAtMs).toISOString(),
      });
    }, `atom.credential.start:${rule.credentialId}`);
  }

  /**
   * Polls token endpoint for a pending device auth session.
   * When authorized, stores the secret directly in `SecretStore` without EVER exposing it in the return payload.
   */
  async poll(params: AtomCredentialPollParams): Promise<HostInvokeResult<AtomCredentialPollResult>> {
    if (!params?.featureId || !params?.credentialId || !params?.sessionId) {
      return hostErr('INVALID_PARAMS', 'featureId, credentialId, and sessionId are required');
    }

    const ruleResult = this.resolveRule(params.credentialId);
    if (!ruleResult.ok) return ruleResult;
    const { signedConfig, rule } = ruleResult.data;

    const authCheck = assertFeatureAllowsResource(params.featureId, signedConfig, {
      kind: 'credential',
      id: rule.credentialId,
    });
    if (!authCheck.ok) return authCheck;

    const session = this.pendingSessions.get(params.sessionId);
    if (!session || session.credentialId !== rule.credentialId) {
      return hostErr('NOT_FOUND', 'Unknown or expired device authorization session', {
        credentialId: rule.credentialId,
      });
    }

    if (this.now().getTime() >= session.expiresAtMs) {
      this.pendingSessions.delete(session.sessionId);
      return hostErr('TIMEOUT', 'Device authorization session expired', {
        credentialId: rule.credentialId,
      });
    }

    const tokenUrl = this.resolveEndpointUrl(rule.issuerUrl, rule.tokenPath);
    if (!tokenUrl.ok) return tokenUrl;

    let response: CredentialHttpResponse;
    try {
      response = await this.httpClient(tokenUrl.data, {
        method: 'POST',
        body: {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: session.deviceCode,
        },
        timeoutMs: this.httpTimeoutMs,
      });
    } catch (error) {
      return hostErr(
        'EXEC_FAILED',
        `Token poll request failed: ${error instanceof Error ? error.message : String(error)}`,
        { credentialId: rule.credentialId },
      );
    }

    const oauthError = typeof response.body.error === 'string' ? response.body.error : undefined;
    if (oauthError === 'authorization_pending') {
      return hostOk({ status: 'pending', retryAfterMs: session.intervalMs });
    }
    if (oauthError === 'slow_down') {
      session.intervalMs += 5_000;
      return hostOk({ status: 'pending', retryAfterMs: session.intervalMs });
    }
    if (oauthError === 'access_denied') {
      this.pendingSessions.delete(session.sessionId);
      return hostErr('USER_DENIED', 'Device authorization was denied', { credentialId: rule.credentialId });
    }
    if (oauthError === 'expired_token') {
      this.pendingSessions.delete(session.sessionId);
      return hostErr('TIMEOUT', 'Device authorization token expired', { credentialId: rule.credentialId });
    }

    if (response.status < 200 || response.status >= 300) {
      return hostErr('UNAUTHORIZED', `Token endpoint returned HTTP ${response.status}`, {
        credentialId: rule.credentialId,
        status: response.status,
      });
    }

    const accessToken =
      typeof response.body.access_token === 'string'
        ? response.body.access_token
        : typeof response.body.runtime_key === 'string'
          ? response.body.runtime_key
          : '';
    if (!accessToken) {
      return hostErr('VERIFICATION_FAILED', 'Token endpoint response did not contain a secret token', {
        credentialId: rule.credentialId,
      });
    }

    const accountId = typeof response.body.account_id === 'string' ? response.body.account_id : undefined;
    const installationId =
      typeof response.body.installation_id === 'string' && response.body.installation_id.trim()
        ? response.body.installation_id.trim()
        : randomUUID();

    return this.mutationQueue.enqueue(async () => {
      const secretAccountKey = `openmotion:${rule.credentialId}:${installationId}`;
      await this.secretStore.set(secretAccountKey, accessToken);

      const updatedAt = this.now().toISOString();
      const allMeta = this.readMetadata();
      const previous = allMeta[rule.credentialId];
      if (previous && previous.secretAccountKey !== secretAccountKey) {
        await this.secretStore.delete(previous.secretAccountKey).catch(() => false);
      }

      allMeta[rule.credentialId] = {
        credentialId: rule.credentialId,
        accountId,
        installationId,
        secretAccountKey,
        updatedAt,
        revoked: false,
      };
      this.writeMetadata(allMeta);
      this.pendingSessions.delete(session.sessionId);

      // Return metadata only — NEVER return the secret value!
      return hostOk({
        status: 'authorized',
        credentialId: rule.credentialId,
        stored: true,
        accountId,
        installationId,
        updatedAt,
      });
    }, `atom.credential.store:${rule.credentialId}`);
  }

  /**
   * Injects the stored secret ONLY to the allowlisted, host-installed target component
   * strictly via `stdin`. Never exposes the secret in argv, logs, or return values.
   */
  async inject(params: AtomCredentialInjectParams): Promise<HostInvokeResult<AtomExecResult>> {
    if (!params?.featureId || !params?.credentialId || !params?.templateId) {
      return hostErr('INVALID_PARAMS', 'featureId, credentialId, and templateId are required');
    }

    const ruleResult = this.resolveRule(params.credentialId);
    if (!ruleResult.ok) return ruleResult;
    const { signedConfig, rule } = ruleResult.data;

    const authCheck = assertFeatureAllowsResource(params.featureId, signedConfig, {
      kind: 'credential',
      id: rule.credentialId,
    });
    if (!authCheck.ok) return authCheck;

    const meta = this.readMetadata()[rule.credentialId];
    if (!meta || meta.revoked) {
      return hostErr('UNAUTHORIZED', `Credential "${rule.credentialId}" is not stored or has been revoked`, {
        credentialId: rule.credentialId,
      });
    }

    const secret = await this.secretStore.get(meta.secretAccountKey);
    if (!secret) {
      return hostErr('NOT_FOUND', `Stored secret for credential "${rule.credentialId}" is missing`, {
        credentialId: rule.credentialId,
      });
    }

    return this.execAtom.runFirstPartyWithStdinSecret({
      featureId: params.featureId,
      templateId: params.templateId,
      expectedComponentId: rule.targetComponentId,
      args: params.args,
      secret,
      extraFacts: [
        {
          kind: 'store_credential',
          label: `Deliver credential "${rule.credentialId}" via stdin`,
          value: `Target component: ${rule.targetComponentId}`,
        },
      ],
    });
  }

  /**
   * Revokes the per-installation credential remotely (when `revokePath` is configured)
   * and deletes the local secret from `SecretStore`.
   */
  async revoke(params: AtomCredentialRevokeParams): Promise<HostInvokeResult<AtomCredentialRevokeResult>> {
    if (!params?.featureId || !params?.credentialId) {
      return hostErr('INVALID_PARAMS', 'featureId and credentialId are required');
    }

    const ruleResult = this.resolveRule(params.credentialId);
    if (!ruleResult.ok) return ruleResult;
    const { signedConfig, rule } = ruleResult.data;

    const authCheck = assertFeatureAllowsResource(params.featureId, signedConfig, {
      kind: 'credential',
      id: rule.credentialId,
    });
    if (!authCheck.ok) return authCheck;

    const approval = await this.confirmationGate.ensureApproved({
      featureId: params.featureId,
      signedConfig,
      facts: [
        {
          kind: 'store_credential',
          label: `Revoke and remove credential (${rule.credentialId})`,
          value: rule.issuerUrl,
        },
      ],
    });
    if (!approval.ok) return approval;

    return this.mutationQueue.enqueue(async () => {
      const allMeta = this.readMetadata();
      const existing = allMeta[rule.credentialId];

      if (existing && !existing.revoked && rule.revokePath) {
        const revokeUrl = this.resolveEndpointUrl(rule.issuerUrl, rule.revokePath);
        if (revokeUrl.ok) {
          const secret = await this.secretStore.get(existing.secretAccountKey);
          try {
            await this.httpClient(revokeUrl.data, {
              method: 'POST',
              headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
              body: {
                credential_id: rule.credentialId,
                installation_id: existing.installationId,
              },
              timeoutMs: this.httpTimeoutMs,
            });
          } catch {
            // Always proceed to remove local secret even if remote revoke is unreachable.
          }
        }
      }

      if (existing) {
        await this.secretStore.delete(existing.secretAccountKey).catch(() => false);
      }

      const revokedAt = this.now().toISOString();
      allMeta[rule.credentialId] = {
        credentialId: rule.credentialId,
        accountId: existing?.accountId,
        installationId: existing?.installationId ?? randomUUID(),
        secretAccountKey: existing?.secretAccountKey ?? `openmotion:${rule.credentialId}:revoked`,
        updatedAt: revokedAt,
        revoked: true,
        revokedAt,
      };
      this.writeMetadata(allMeta);

      return hostOk({
        credentialId: rule.credentialId,
        revoked: true,
        installationId: allMeta[rule.credentialId]!.installationId,
        revokedAt,
      });
    }, `atom.credential.revoke:${rule.credentialId}`);
  }

  private resolveRule(
    credentialId: string,
  ): HostInvokeResult<{ signedConfig: SignedConfigPayload; rule: SignedCredentialRule }> {
    const signedConfig = this.getSignedConfig();
    const rule = signedConfig.credentials?.[credentialId];
    if (!rule) {
      return hostErr('POLICY_DENIED', `Unknown credentialId in signed config: "${credentialId}"`, { credentialId });
    }
    if (
      !isUrlInAllowedDomainScope(rule.issuerUrl, {
        channel: this.channel,
        allowLocalDevLoopback: this.allowLocalDevLoopback,
      })
    ) {
      return hostErr('POLICY_DENIED', `Credential issuerUrl is outside allowed domain scope: ${rule.issuerUrl}`, {
        credentialId,
        issuerUrl: rule.issuerUrl,
      });
    }
    return hostOk({ signedConfig, rule });
  }

  private resolveEndpointUrl(issuerUrl: string, endpointPath: string): HostInvokeResult<string> {
    try {
      const resolved = new URL(endpointPath, issuerUrl).toString();
      if (
        !isUrlInAllowedDomainScope(resolved, {
          channel: this.channel,
          allowLocalDevLoopback: this.allowLocalDevLoopback,
        })
      ) {
        return hostErr('POLICY_DENIED', `Resolved credential endpoint is outside allowed domain scope: ${resolved}`);
      }
      return hostOk(resolved);
    } catch {
      return hostErr('INVALID_PARAMS', `Invalid credential endpoint path: "${endpointPath}"`);
    }
  }

  private readMetadata(): Record<string, CredentialMetadataRecord> {
    const metaPath = path.join(this.dataDir, CREDENTIALS_META_FILE);
    if (!existsSync(metaPath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as Partial<PersistedCredentialsMetaFile>;
      if (!parsed || typeof parsed.credentials !== 'object' || !parsed.credentials) {
        return {};
      }
      return { ...parsed.credentials };
    } catch {
      return {};
    }
  }

  private writeMetadata(credentials: Record<string, CredentialMetadataRecord>): void {
    mkdirSync(this.dataDir, { recursive: true });
    const metaPath = path.join(this.dataDir, CREDENTIALS_META_FILE);
    const payload: PersistedCredentialsMetaFile = {
      schemaVersion: 1,
      credentials,
    };
    const tmpPath = `${metaPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpPath, metaPath);
  }
}

export function createCredentialAtom(deps: CredentialAtomDeps): CredentialAtom {
  return new CredentialAtom(deps);
}
