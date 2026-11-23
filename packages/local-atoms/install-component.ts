/**
 * Atom 3: `atom.installComponent` — Verified first-party component installer (K7).
 *
 * Security & Isolation Rules (Design Doc §5.6):
 * - Artifact URL must be inside built-in domain scope (`isUrlInAllowedDomainScope`),
 *   including any HTTP redirects during download.
 * - Publisher ID must be in `BUILTIN_PUBLISHERS`.
 * - SHA-256 digest must match manifest strictly (`VERIFICATION_FAILED` on mismatch).
 * - macOS code signature publisher Team ID (`codesign -dv --verbose=4`, injectable for
 *   cross-platform tests) must match the built-in publisher Team ID before installation.
 * - Components are installed strictly OUTSIDE the app bundle (`<dataDir>/components/`).
 * - Provenance metadata (`registry.json`) ensures `uninstall` only removes components
 *   installed by this host, and `atom.exec` only runs verified installed components.
 */

import { execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {
  BUILTIN_PUBLISHERS,
  isUrlInAllowedDomainScope,
  validateTypedPlaceholderValue,
  type BuiltinPublisherEntry,
} from '../../shared/desktop-builtin-rules.ts';
import {
  hostErr,
  hostOk,
  type AtomInstallComponentParams,
  type AtomInstallComponentResult,
  type ConfirmationFact,
  type HostInvokeResult,
  type HostPlatform,
  type HostReleaseChannel,
} from '../../shared/desktop-contract.ts';
import type {
  SignedComponentManifest,
  SignedComponentPlatformArtifact,
  SignedConfigPayload,
} from '../../shared/signed-config.ts';
import { assertFeatureAllowsResource, type FeatureConfirmationGate } from './confirmation.ts';
import type { SerialMutationQueue } from './serial-queue.ts';

const COMPONENTS_DIR_NAME = 'components';
const REGISTRY_FILE_NAME = 'registry.json';
const STAGING_DIR_NAME = '.staging';
const MAX_REDIRECTS = 5;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const SAFE_COMPONENT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export type SupportedPlatformArch = 'darwin-arm64' | 'darwin-x64' | 'win32-x64';

export type InstalledComponentRecord = {
  componentId: string;
  version: string;
  installDir: string;
  executablePath: string;
  sha256: string;
  publisherId: string;
  installedByHost: true;
  installedAt: string;
};

type PersistedComponentRegistry = {
  schemaVersion: number;
  components: Record<string, InstalledComponentRecord>;
};

export type ArtifactDownloader = (
  url: string,
  destinationPath: string,
  options: {
    timeoutMs: number;
    validateUrl: (candidateUrl: string) => boolean;
  },
) => Promise<{ bytesWritten: number }>;

export type CodeSignatureVerificationResult =
  | { ok: true; teamId: string }
  | { ok: false; reason: string; actualTeamId?: string };

export type CodeSignatureVerifier = (
  filePath: string,
  expectedTeamId: string,
  platform: HostPlatform,
) => Promise<CodeSignatureVerificationResult>;

export type InstallComponentAtomDeps = {
  dataDir: string;
  platform?: HostPlatform;
  arch?: string;
  channel?: HostReleaseChannel;
  allowLocalDevLoopback?: boolean;
  /** Optional path to the host Electron app bundle to enforce out-of-bundle installation. */
  appBundlePath?: string;
  getSignedConfig: () => SignedConfigPayload;
  confirmationGate: FeatureConfirmationGate;
  mutationQueue: SerialMutationQueue;
  registry?: ComponentInstallRegistry;
  /** Optional publisher list override (defaults to `BUILTIN_PUBLISHERS`). */
  publishers?: readonly BuiltinPublisherEntry[];
  downloader?: ArtifactDownloader;
  codeSignatureVerifier?: CodeSignatureVerifier;
  downloadTimeoutMs?: number;
  now?: () => Date;
};

function normalizePlatform(raw: NodeJS.Platform | HostPlatform): HostPlatform {
  if (raw === 'darwin' || raw === 'win32' || raw === 'linux') return raw;
  return 'linux';
}

function getPlatformArchKey(platform: HostPlatform, arch: string): SupportedPlatformArch | null {
  const key = `${platform}-${arch}`;
  if (key === 'darwin-arm64' || key === 'darwin-x64' || key === 'win32-x64') {
    return key;
  }
  return null;
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const resolvedParent = path.resolve(parentPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const rel = path.relative(resolvedParent, resolvedCandidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function deriveExecutableFileName(componentId: string, artifactUrl: string, platform: HostPlatform): string {
  try {
    const parsed = new URL(artifactUrl);
    const base = path.posix.basename(parsed.pathname);
    if (base && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(base)) {
      if (platform === 'win32' && !base.toLowerCase().endsWith('.exe')) {
        return `${base}.exe`;
      }
      return base;
    }
  } catch {
    // Fall back to componentId
  }
  return platform === 'win32' ? `${componentId}.exe` : componentId;
}

function computeFileSha256(filePath: string): string {
  const bytes = readFileSync(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

function hexDigestsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a.toLowerCase(), 'utf8');
  const bufB = Buffer.from(b.toLowerCase(), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const defaultArtifactDownloader: ArtifactDownloader = async (url, destinationPath, options) => {
  const downloadWithRedirects = (currentUrl: string, redirectsLeft: number): Promise<{ bytesWritten: number }> => {
    return new Promise((resolve, reject) => {
      if (!options.validateUrl(currentUrl)) {
        reject(new Error(`Download URL outside allowed domain scope: ${currentUrl}`));
        return;
      }
      const parsed = new URL(currentUrl);
      const requestOpts = {
        timeout: options.timeoutMs,
        headers: {
          'user-agent': 'OpenMotion-Host-ComponentInstaller/1.0',
        },
      };
      const onResponse = (res: http.IncomingMessage) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many HTTP redirects while downloading component'));
            return;
          }
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          void downloadWithRedirects(nextUrl, redirectsLeft - 1).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`Component download failed with HTTP ${status}`));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          totalBytes += chunk.length;
        });
        res.on('end', () => {
          try {
            mkdirSync(path.dirname(destinationPath), { recursive: true });
            writeFileSync(destinationPath, Buffer.concat(chunks));
            resolve({ bytesWritten: totalBytes });
          } catch (error) {
            reject(error);
          }
        });
        res.on('error', reject);
      };
      const req =
        parsed.protocol === 'https:'
          ? https.get(parsed, requestOpts, onResponse)
          : http.get(parsed, requestOpts, onResponse);
      req.on('timeout', () => {
        req.destroy(new Error(`Component download timed out after ${options.timeoutMs}ms`));
      });
      req.on('error', reject);
    });
  };

  return downloadWithRedirects(url, MAX_REDIRECTS);
};

export function parseMacOsCodesignTeamId(output: string): string | null {
  const match = /^TeamIdentifier=(.+)$/m.exec(output);
  if (!match) return null;
  const value = match[1]!.trim();
  if (!value || value.toLowerCase() === 'not set') {
    return null;
  }
  return value;
}

export const defaultCodeSignatureVerifier: CodeSignatureVerifier = async (filePath, expectedTeamId, platform) => {
  if (!expectedTeamId || !expectedTeamId.trim()) {
    return { ok: false, reason: 'Expected publisher Team ID is empty' };
  }
  if (platform !== 'darwin') {
    return {
      ok: false,
      reason: `No built-in code signature verifier configured for platform "${platform}"`,
    };
  }

  return new Promise(resolve => {
    execFile(
      '/usr/bin/codesign',
      ['-dv', '--verbose=4', filePath],
      {
        encoding: 'utf8',
        timeout: 10_000,
        shell: false,
        maxBuffer: 256 * 1024,
      },
      (error, stdout, stderr) => {
        const outStr = typeof stdout === 'string' ? stdout : '';
        const errStr = typeof stderr === 'string' ? stderr : '';
        if (error) {
          resolve({
            ok: false,
            reason: `codesign verification failed: ${errStr.trim() || error.message}`,
          });
          return;
        }
        const combined = `${outStr}\n${errStr}`;
        const teamId = parseMacOsCodesignTeamId(combined);
        if (!teamId) {
          resolve({ ok: false, reason: 'Binary does not contain a valid macOS TeamIdentifier' });
          return;
        }
        if (teamId !== expectedTeamId) {
          resolve({
            ok: false,
            reason: `Code signature TeamIdentifier mismatch: expected "${expectedTeamId}", got "${teamId}"`,
            actualTeamId: teamId,
          });
          return;
        }
        resolve({ ok: true, teamId });
      },
    );
  });
};

export class ComponentInstallRegistry {
  private readonly componentsRoot: string;
  private readonly registryPath: string;

  constructor(dataDir: string) {
    this.componentsRoot = path.resolve(dataDir, COMPONENTS_DIR_NAME);
    this.registryPath = path.join(this.componentsRoot, REGISTRY_FILE_NAME);
  }

  getComponentsRoot(): string {
    return this.componentsRoot;
  }

  getInstalled(componentId: string): InstalledComponentRecord | null {
    const all = this.readAll();
    const record = all[componentId];
    if (!record) return null;
    if (!record.installedByHost) return null;
    if (!isPathInside(this.componentsRoot, record.executablePath)) return null;
    if (!existsSync(record.executablePath)) return null;
    return record;
  }

  listInstalled(): InstalledComponentRecord[] {
    return Object.values(this.readAll()).filter(
      record =>
        record.installedByHost &&
        isPathInside(this.componentsRoot, record.executablePath) &&
        existsSync(record.executablePath),
    );
  }

  recordInstall(record: InstalledComponentRecord): void {
    const all = this.readAll();
    all[record.componentId] = record;
    this.writeAll(all);
  }

  removeRecord(componentId: string): InstalledComponentRecord | null {
    const all = this.readAll();
    const existing = all[componentId] ?? null;
    if (!existing) return null;
    delete all[componentId];
    this.writeAll(all);
    return existing;
  }

  private readAll(): Record<string, InstalledComponentRecord> {
    if (!existsSync(this.registryPath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.registryPath, 'utf8')) as Partial<PersistedComponentRegistry>;
      if (!parsed || typeof parsed.components !== 'object' || !parsed.components) {
        return {};
      }
      return { ...parsed.components };
    } catch {
      return {};
    }
  }

  private writeAll(components: Record<string, InstalledComponentRecord>): void {
    mkdirSync(this.componentsRoot, { recursive: true });
    const payload: PersistedComponentRegistry = {
      schemaVersion: 1,
      components,
    };
    const tmpPath = `${this.registryPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, this.registryPath);
  }
}

export class InstallComponentAtom {
  private readonly platform: HostPlatform;
  private readonly arch: string;
  private readonly channel: HostReleaseChannel;
  private readonly allowLocalDevLoopback: boolean;
  private readonly appBundlePath?: string;
  private readonly getSignedConfig: () => SignedConfigPayload;
  private readonly confirmationGate: FeatureConfirmationGate;
  private readonly mutationQueue: SerialMutationQueue;
  private readonly registry: ComponentInstallRegistry;
  private readonly publishers: readonly BuiltinPublisherEntry[];
  private readonly downloader: ArtifactDownloader;
  private readonly codeSignatureVerifier: CodeSignatureVerifier;
  private readonly downloadTimeoutMs: number;
  private readonly now: () => Date;

  constructor(deps: InstallComponentAtomDeps) {
    this.platform = normalizePlatform(deps.platform ?? process.platform);
    this.arch = deps.arch ?? process.arch;
    this.channel = deps.channel ?? 'stable';
    this.allowLocalDevLoopback = deps.allowLocalDevLoopback ?? false;
    this.appBundlePath = deps.appBundlePath;
    this.getSignedConfig = deps.getSignedConfig;
    this.confirmationGate = deps.confirmationGate;
    this.mutationQueue = deps.mutationQueue;
    this.registry = deps.registry ?? new ComponentInstallRegistry(deps.dataDir);
    this.publishers = deps.publishers ?? BUILTIN_PUBLISHERS;
    this.downloader = deps.downloader ?? defaultArtifactDownloader;
    this.codeSignatureVerifier = deps.codeSignatureVerifier ?? defaultCodeSignatureVerifier;
    this.downloadTimeoutMs = deps.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    this.now = deps.now ?? (() => new Date());
  }

  getRegistry(): ComponentInstallRegistry {
    return this.registry;
  }

  preview(params: AtomInstallComponentParams): HostInvokeResult<{
    componentId: string;
    version: string;
    installDir: string;
    facts: ConfirmationFact[];
  }> {
    const resolved = this.resolveAndValidateManifest(params.componentId);
    if (!resolved.ok) return resolved;
    const { manifest, artifact, installDir } = resolved.data;
    return hostOk({
      componentId: manifest.componentId,
      version: manifest.minVersion,
      installDir,
      facts: this.buildInstallFacts(manifest, artifact, installDir),
    });
  }

  status(params: { componentId: string }): HostInvokeResult<{
    componentId: string;
    installed: boolean;
    record?: InstalledComponentRecord;
  }> {
    if (!params?.componentId || !SAFE_COMPONENT_ID_RE.test(params.componentId)) {
      return hostErr('INVALID_PARAMS', 'Valid componentId is required');
    }
    const record = this.registry.getInstalled(params.componentId);
    return hostOk({
      componentId: params.componentId,
      installed: Boolean(record),
      record: record ?? undefined,
    });
  }

  async install(params: AtomInstallComponentParams): Promise<HostInvokeResult<AtomInstallComponentResult>> {
    if (!params || typeof params !== 'object') {
      return hostErr('INVALID_PARAMS', 'Install component params are required');
    }
    if (!params.featureId || typeof params.featureId !== 'string') {
      return hostErr('INVALID_PARAMS', 'featureId is required');
    }

    const resolved = this.resolveAndValidateManifest(params.componentId);
    if (!resolved.ok) return resolved;
    const { signedConfig, manifest, artifact, publisher, installDir } = resolved.data;

    const authCheck = assertFeatureAllowsResource(params.featureId, signedConfig, {
      kind: 'component',
      id: manifest.componentId,
    });
    if (!authCheck.ok) return authCheck;

    const facts = this.buildInstallFacts(manifest, artifact, installDir);
    const approval = await this.confirmationGate.ensureApproved({
      featureId: params.featureId,
      signedConfig,
      facts,
    });
    if (!approval.ok) return approval;

    return this.mutationQueue.enqueue(async () => {
      // Check if identical version + sha256 + publisher is already installed on disk.
      const existing = this.registry.getInstalled(manifest.componentId);
      if (
        existing &&
        existing.version === manifest.minVersion &&
        existing.publisherId === artifact.publisherId &&
        hexDigestsEqual(existing.sha256, artifact.sha256)
      ) {
        return hostOk({
          componentId: existing.componentId,
          version: existing.version,
          installPath: existing.executablePath,
          sha256: existing.sha256,
          publisherId: existing.publisherId,
          alreadyInstalled: true,
        });
      }

      const stagingDir = path.join(this.registry.getComponentsRoot(), STAGING_DIR_NAME);
      mkdirSync(stagingDir, { recursive: true });
      const stagingFile = path.join(
        stagingDir,
        `${manifest.componentId}-${process.pid}-${randomBytes(6).toString('hex')}.bin`,
      );

      const urlScopeOpts = {
        channel: this.channel,
        allowLocalDevLoopback: this.allowLocalDevLoopback,
      };

      try {
        await this.downloader(artifact.url, stagingFile, {
          timeoutMs: this.downloadTimeoutMs,
          validateUrl: candidateUrl => isUrlInAllowedDomainScope(candidateUrl, urlScopeOpts),
        });
      } catch (error) {
        rmSync(stagingFile, { force: true });
        return hostErr(
          'EXEC_FAILED',
          `Component download failed: ${error instanceof Error ? error.message : String(error)}`,
          { componentId: manifest.componentId, url: artifact.url },
        );
      }

      // 1. Strict SHA-256 verification
      const actualSha256 = computeFileSha256(stagingFile);
      if (!hexDigestsEqual(actualSha256, artifact.sha256)) {
        rmSync(stagingFile, { force: true });
        return hostErr('VERIFICATION_FAILED', 'Downloaded component SHA-256 checksum mismatch', {
          componentId: manifest.componentId,
          expectedSha256: artifact.sha256.toLowerCase(),
          actualSha256,
        });
      }

      // 2. Strict code signature publisher Team ID verification
      const sigResult = await this.codeSignatureVerifier(stagingFile, publisher.appleTeamId, this.platform);
      if (!sigResult.ok) {
        rmSync(stagingFile, { force: true });
        return hostErr('VERIFICATION_FAILED', sigResult.reason, {
          componentId: manifest.componentId,
          publisherId: publisher.id,
          expectedTeamId: publisher.appleTeamId,
          actualTeamId: sigResult.actualTeamId,
        });
      }

      // 3. Install strictly outside app bundle
      const fileName = deriveExecutableFileName(manifest.componentId, artifact.url, this.platform);
      const versionDir = path.join(installDir, manifest.minVersion);
      const executablePath = path.join(versionDir, fileName);

      if (this.appBundlePath && isPathInside(this.appBundlePath, executablePath)) {
        rmSync(stagingFile, { force: true });
        return hostErr('POLICY_DENIED', 'Component install path must remain outside the app bundle', {
          componentId: manifest.componentId,
          executablePath,
        });
      }

      mkdirSync(versionDir, { recursive: true });
      renameSync(stagingFile, executablePath);
      if (this.platform !== 'win32') {
        chmodSync(executablePath, 0o755);
      }

      const record: InstalledComponentRecord = {
        componentId: manifest.componentId,
        version: manifest.minVersion,
        installDir,
        executablePath,
        sha256: actualSha256,
        publisherId: artifact.publisherId,
        installedByHost: true,
        installedAt: this.now().toISOString(),
      };
      this.registry.recordInstall(record);

      return hostOk({
        componentId: record.componentId,
        version: record.version,
        installPath: record.executablePath,
        sha256: record.sha256,
        publisherId: record.publisherId,
        alreadyInstalled: false,
      });
    }, `atom.installComponent:${manifest.componentId}`);
  }

  async uninstall(params: AtomInstallComponentParams): Promise<
    HostInvokeResult<{
      componentId: string;
      removed: boolean;
      removedPath?: string;
    }>
  > {
    if (!params?.featureId || !params?.componentId) {
      return hostErr('INVALID_PARAMS', 'featureId and componentId are required');
    }
    if (!SAFE_COMPONENT_ID_RE.test(params.componentId)) {
      return hostErr('INVALID_PARAMS', `Invalid componentId: "${params.componentId}"`);
    }

    const signedConfig = this.getSignedConfig();
    const authCheck = assertFeatureAllowsResource(params.featureId, signedConfig, {
      kind: 'component',
      id: params.componentId,
    });
    if (!authCheck.ok) return authCheck;

    const existing = this.registry.getInstalled(params.componentId);
    if (!existing) {
      return hostErr('NOT_FOUND', `Component "${params.componentId}" was not installed by this host`, {
        componentId: params.componentId,
      });
    }

    const approval = await this.confirmationGate.ensureApproved({
      featureId: params.featureId,
      signedConfig,
      facts: [
        {
          kind: 'modify_file',
          label: `Remove host-installed component (${params.componentId})`,
          value: existing.installDir,
        },
      ],
    });
    if (!approval.ok) return approval;

    return this.mutationQueue.enqueue(async () => {
      const current = this.registry.getInstalled(params.componentId);
      if (!current || !current.installedByHost) {
        return hostErr('NOT_FOUND', `Component "${params.componentId}" was not installed by this host`, {
          componentId: params.componentId,
        });
      }
      if (!isPathInside(this.registry.getComponentsRoot(), current.installDir)) {
        return hostErr('POLICY_DENIED', 'Refusing to remove directory outside host components root', {
          componentId: params.componentId,
          installDir: current.installDir,
        });
      }
      rmSync(current.installDir, { recursive: true, force: true });
      this.registry.removeRecord(params.componentId);
      return hostOk({
        componentId: params.componentId,
        removed: true,
        removedPath: current.installDir,
      });
    }, `atom.installComponent.uninstall:${params.componentId}`);
  }

  private resolveAndValidateManifest(componentId: string): HostInvokeResult<{
    signedConfig: SignedConfigPayload;
    manifest: SignedComponentManifest;
    artifact: SignedComponentPlatformArtifact;
    publisher: BuiltinPublisherEntry;
    installDir: string;
  }> {
    if (!componentId || typeof componentId !== 'string' || !SAFE_COMPONENT_ID_RE.test(componentId)) {
      return hostErr('INVALID_PARAMS', `Invalid componentId: "${String(componentId)}"`);
    }

    const signedConfig = this.getSignedConfig();
    const manifest = signedConfig.components?.[componentId];
    if (!manifest) {
      return hostErr('POLICY_DENIED', `Unknown componentId in signed config: "${componentId}"`, { componentId });
    }

    const versionCheck = validateTypedPlaceholderValue('semver', manifest.minVersion);
    if (!versionCheck.ok) {
      return hostErr('POLICY_DENIED', `Component "${componentId}" has invalid minVersion: ${versionCheck.reason}`, {
        componentId,
        minVersion: manifest.minVersion,
      });
    }

    const platformKey = getPlatformArchKey(this.platform, this.arch);
    if (!platformKey) {
      return hostErr('UNSUPPORTED', `Unsupported platform/arch for component installation: ${this.platform}-${this.arch}`, {
        platform: this.platform,
        arch: this.arch,
      });
    }

    const artifact = manifest.platforms?.[platformKey];
    if (!artifact) {
      return hostErr('UNSUPPORTED', `Component "${componentId}" has no artifact for ${platformKey}`, {
        componentId,
        platformKey,
      });
    }

    if (
      !isUrlInAllowedDomainScope(artifact.url, {
        channel: this.channel,
        allowLocalDevLoopback: this.allowLocalDevLoopback,
      })
    ) {
      return hostErr('POLICY_DENIED', `Component download URL is outside allowed domain scope: ${artifact.url}`, {
        componentId,
        url: artifact.url,
      });
    }

    if (!/^[a-fA-F0-9]{64}$/.test(artifact.sha256)) {
      return hostErr('VERIFICATION_FAILED', 'Manifest sha256 must be a valid 64-char hex digest', {
        componentId,
      });
    }

    const publisher = this.publishers.find(entry => entry.id === artifact.publisherId);
    if (!publisher) {
      return hostErr('POLICY_DENIED', `Publisher "${artifact.publisherId}" is not in built-in allowlist`, {
        componentId,
        publisherId: artifact.publisherId,
      });
    }

    const installDir = path.join(this.registry.getComponentsRoot(), manifest.componentId);
    if (this.appBundlePath && isPathInside(this.appBundlePath, installDir)) {
      return hostErr('POLICY_DENIED', 'Component install directory must be outside the app bundle', {
        componentId,
        installDir,
      });
    }

    return hostOk({
      signedConfig,
      manifest,
      artifact,
      publisher,
      installDir,
    });
  }

  private buildInstallFacts(
    manifest: SignedComponentManifest,
    artifact: SignedComponentPlatformArtifact,
    installDir: string,
  ): ConfirmationFact[] {
    return [
      {
        kind: 'install_component',
        label: `Install ${manifest.displayName} (${manifest.componentId} v${manifest.minVersion})`,
        value: `publisher=${artifact.publisherId}, sha256=${artifact.sha256.slice(0, 12)}…`,
      },
      {
        kind: 'connect_url',
        label: `Download ${manifest.displayName}`,
        value: artifact.url,
      },
      {
        kind: 'modify_file',
        label: 'Install directory (outside app bundle)',
        value: installDir,
      },
    ];
  }
}

export function createInstallComponentAtom(deps: InstallComponentAtomDeps): InstallComponentAtom {
  return new InstallComponentAtom(deps);
}
