/**
 * Zero-dependency, default-off Electron Main-Process Sentry Envelope Reporter
 * and native `crashReporter` integration.
 *
 * Design principles (aligned with `@openmotion/observability`):
 * - Default-off: without a valid DSN (or when `DO_NOT_TRACK=1` / `OPENMOTION_TELEMETRY=0`),
 *   zero outbound requests are made and `crashReporter` is never started.
 * - Zero preload / IPC footprint: never injects code into renderer windows, popups,
 *   iframes, or `/auth/*` routes — preserving strict thin-shell isolation.
 * - Strict scrubbing: strips local filesystem paths, Bearer tokens, credentials, and
 *   query parameters using both `redactDesktopText` and `@openmotion/observability/sanitize`.
 * - Bounded sliding-window rate limiting prevents crash loops from flooding ingest.
 * - Store and forward: an envelope that cannot be delivered (offline, proxy down, ingest 5xx)
 *   is kept in a small bounded outbox and retried later, because the failures worth reporting
 *   are often the ones that happen while the network is unavailable.
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DESKTOP_PRODUCT_NAME } from '../../shared/desktop-builtin-rules.ts';
import type { HostPlatform, HostReleaseChannel } from '../../shared/desktop-contract.ts';
import { parseSentryDsn } from '../../packages/observability/config.ts';
import { sanitizeSentryEvent, sanitizeText, type SentryLikeEvent } from '../../packages/observability/sanitize.ts';
import { redactDesktopText } from './logger.ts';

const DEFAULT_MAX_EVENTS_PER_MINUTE = 20;
const DEFAULT_SEND_TIMEOUT_MS = 4_000;
const RATE_WINDOW_MS = 60_000;
const OUTBOX_MAX_ITEMS = 20;
const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type OutboxItem = { at: number; body: string };

export type ParsedSentryEndpoints = {
  dsn: string;
  envelopeUrl: string;
  minidumpUrl: string;
  publicKey: string;
  projectId: string;
};

declare const __OPENMOTION_DESKTOP_SENTRY_DSN__: string | undefined;

/**
 * Resolves the DSN for this shell: a runtime environment override first (local
 * development and ingest mocks), then the value `desktop/scripts/build.mjs`
 * embeds at build time. Unbundled runs carry no embedded value.
 */
export function resolveDesktopSentryDsn(
  env: NodeJS.ProcessEnv = process.env,
  embedded: string | undefined = typeof __OPENMOTION_DESKTOP_SENTRY_DSN__ === 'string'
    ? __OPENMOTION_DESKTOP_SENTRY_DSN__
    : undefined,
): string | undefined {
  const fromEnv = env.SENTRY_DESKTOP_DSN?.trim() || env.OPENMOTION_DESKTOP_SENTRY_DSN?.trim();
  return fromEnv || embedded?.trim() || undefined;
}

export type ElectronCrashReporterLike = {
  start: (options: {
    submitURL: string;
    productName?: string;
    compress?: boolean;
    uploadToServer?: boolean;
    ignoreSystemCrashHandler?: boolean;
    extra?: Record<string, string>;
  }) => void;
  setUploadToServer?: (uploadToServer: boolean) => void;
};

export type DesktopSentryReporterOptions = {
  dsn?: string | null;
  environment?: string;
  release: string;
  channel: HostReleaseChannel;
  platform: HostPlatform;
  arch: string;
  shellVersion: string;
  redactPaths?: readonly string[];
  /** File that holds undelivered envelopes; store and forward is off when unset. */
  outboxPath?: string;
  env?: NodeJS.ProcessEnv;
  maxEventsPerMinute?: number;
  sendTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Called for every event captured while reporting is on, before it is sent. */
  onCapture?: (level: 'info' | 'warning' | 'error' | 'fatal') => void;
  /** Called when reporting is turned off, so callers can erase what they kept for it. */
  onDisabled?: () => void;
};

/** One update of a release-health session; times are epoch milliseconds. */
export type DesktopSentrySessionUpdate = {
  sid: string;
  did?: string;
  init: boolean;
  startedAt: number;
  timestamp: number;
  status: 'ok' | 'exited' | 'crashed' | 'abnormal';
  errors: number;
  durationSeconds?: number;
  release: string;
};

export type DesktopSentryCaptureContext = {
  area?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export type DesktopSentryReporter = {
  isEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  getEndpoints: () => ParsedSentryEndpoints | null;
  /** Retries undelivered envelopes; resolves with how many were delivered. */
  flushOutbox: () => Promise<number>;
  startCrashReporter: (crashReporter: ElectronCrashReporterLike) => boolean;
  captureException: (error: unknown, context?: DesktopSentryCaptureContext) => Promise<boolean>;
  captureMessage: (
    message: string,
    level?: 'info' | 'warning' | 'error' | 'fatal',
    context?: DesktopSentryCaptureContext,
  ) => Promise<boolean>;
  /** Sends a release-health session update; undeliverable updates wait in the outbox. */
  sendSession: (update: DesktopSentrySessionUpdate) => Promise<boolean>;
};

function isOptedOutByEnv(env: NodeJS.ProcessEnv): boolean {
  const dnt = env.DO_NOT_TRACK?.trim().toLowerCase();
  if (dnt === '1' || dnt === 'true') return true;
  const flag = env.OPENMOTION_TELEMETRY?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return true;
  return false;
}

/**
 * Parses a validated Sentry DSN into its Envelope ingest and Crashpad minidump URLs.
 */
export function parseSentryEnvelopeEndpoints(rawDsn: unknown): ParsedSentryEndpoints | null {
  const validated = parseSentryDsn(rawDsn);
  if (!validated) return null;
  const parsed = new URL(validated);
  const publicKey = parsed.username;
  const segments = parsed.pathname.split('/').filter(Boolean);
  const projectId = segments.at(-1);
  if (!publicKey || !projectId) return null;
  const prefixSegments = segments.slice(0, -1);
  const basePath = prefixSegments.length > 0 ? `/${prefixSegments.join('/')}` : '';
  const apiBase = `${parsed.origin}${basePath}/api/${projectId}`;

  return {
    dsn: validated,
    envelopeUrl: `${apiBase}/envelope/`,
    minidumpUrl: `${apiBase}/minidump/?sentry_key=${encodeURIComponent(publicKey)}`,
    publicKey,
    projectId,
  };
}

function scrubString(value: string, redactPaths: readonly string[]): string {
  return sanitizeText(redactDesktopText(value, [...redactPaths]));
}

function scrubUnknown(
  value: unknown,
  redactPaths: readonly string[],
  depth = 0,
): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return scrubString(value, redactPaths);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => scrubUnknown(item, redactPaths, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      if (/(?:token|secret|password|authorization|cookie|key|credential)/i.test(k)) {
        out[k] = '[redacted]';
      } else {
        out[k] = scrubUnknown(v, redactPaths, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function parseStackFrames(stack: string | undefined, redactPaths: readonly string[]) {
  if (!stack) return undefined;
  const frames: Array<{ filename: string; function?: string; lineno?: number; colno?: number }> = [];
  for (const line of stack.split('\n').slice(1, 25)) {
    const trimmed = line.trim();
    const match = /^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(trimmed);
    if (!match) continue;
    const fnName = match[1]?.trim();
    const filename = scrubString(match[2] ?? '<unknown>', redactPaths);
    const lineno = Number.parseInt(match[3] ?? '', 10);
    const colno = Number.parseInt(match[4] ?? '', 10);
    frames.push({
      filename,
      ...(fnName ? { function: fnName } : {}),
      ...(Number.isFinite(lineno) ? { lineno } : {}),
      ...(Number.isFinite(colno) ? { colno } : {}),
    });
  }
  if (frames.length === 0) return undefined;
  // Sentry expects frames oldest-first.
  return frames.reverse();
}

export function createDesktopSentryReporter(
  options: DesktopSentryReporterOptions,
): DesktopSentryReporter {
  const env = options.env ?? process.env;
  const endpoints = parseSentryEnvelopeEndpoints(options.dsn);
  const redactPaths = options.redactPaths ?? [];
  const maxEventsPerMinute = Math.max(1, options.maxEventsPerMinute ?? DEFAULT_MAX_EVENTS_PER_MINUTE);
  const sendTimeoutMs = Math.max(500, options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS);
  const now = options.now ?? (() => Date.now());
  const environment = options.environment?.trim() || (options.channel === 'stable' ? 'production' : options.channel);

  let runtimeEnabled = Boolean(endpoints) && !isOptedOutByEnv(env);
  let crashReporterStarted = false;
  let crashReporterRef: ElectronCrashReporterLike | null = null;
  const recentSendTimestamps: number[] = [];

  const isEnabled = (): boolean => Boolean(endpoints) && runtimeEnabled && !isOptedOutByEnv(env);

  const allowRateLimitedSend = (): boolean => {
    const currentMs = now();
    while (recentSendTimestamps.length > 0 && currentMs - recentSendTimestamps[0]! >= RATE_WINDOW_MS) {
      recentSendTimestamps.shift();
    }
    if (recentSendTimestamps.length >= maxEventsPerMinute) {
      return false;
    }
    recentSendTimestamps.push(currentMs);
    return true;
  };

  const outboxPath = options.outboxPath;
  let flushingOutbox = false;

  const readOutbox = (): OutboxItem[] => {
    if (!outboxPath) return [];
    try {
      const parsed = JSON.parse(readFileSync(outboxPath, 'utf8')) as { items?: unknown };
      if (!Array.isArray(parsed.items)) return [];
      return parsed.items.filter(
        (item): item is OutboxItem =>
          Boolean(item) &&
          typeof (item as OutboxItem).at === 'number' &&
          typeof (item as OutboxItem).body === 'string' &&
          now() - (item as OutboxItem).at <= OUTBOX_MAX_AGE_MS,
      );
    } catch {
      return [];
    }
  };

  const writeOutbox = (items: OutboxItem[]): void => {
    if (!outboxPath) return;
    try {
      if (items.length === 0) {
        rmSync(outboxPath, { force: true });
        return;
      }
      mkdirSync(path.dirname(outboxPath), { recursive: true });
      writeFileSync(
        outboxPath,
        JSON.stringify({ version: 1, items: items.slice(-OUTBOX_MAX_ITEMS) }),
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch {
      // Reporting must never break the shell; an unwritable outbox only loses retries.
    }
  };

  const enqueue = (body: string): void => {
    if (!outboxPath) return;
    writeOutbox([...readOutbox(), { at: now(), body }]);
  };

  const postEnvelope = async (body: string): Promise<'sent' | 'retry' | 'drop'> => {
    if (!endpoints) return 'drop';
    const fetchFn = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') return 'drop';
    try {
      const response = await fetchFn(endpoints.envelopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=openmotion-desktop/${options.shellVersion}, sentry_key=${endpoints.publicKey}`,
        },
        body,
        signal: AbortSignal.timeout(sendTimeoutMs),
      });
      if (response.ok) return 'sent';
      // Ingest rejected the payload itself: retrying the same bytes cannot succeed.
      return response.status >= 500 || response.status === 429 ? 'retry' : 'drop';
    } catch {
      return 'retry';
    }
  };

  /**
   * Sentry reads `sent_at` as the client clock at the moment of sending and shifts the
   * event time by its distance from the receive time. A delayed envelope must therefore
   * carry the time of the actual attempt, or the failure is dated to when it was delivered.
   */
  const withCurrentSentAt = (body: string): string => {
    const headerEnd = body.indexOf('\n');
    if (headerEnd < 0) return body;
    try {
      const header = JSON.parse(body.slice(0, headerEnd)) as Record<string, unknown>;
      return JSON.stringify({ ...header, sent_at: new Date(now()).toISOString() }) + body.slice(headerEnd);
    } catch {
      return body;
    }
  };

  const flushOutbox = async (): Promise<number> => {
    if (!endpoints || !outboxPath || !isEnabled() || flushingOutbox) return 0;
    flushingOutbox = true;
    try {
      const pending = readOutbox();
      const undelivered: OutboxItem[] = [];
      let delivered = 0;
      for (let index = 0; index < pending.length; index += 1) {
        const result = await postEnvelope(withCurrentSentAt(pending[index]!.body));
        if (result === 'sent') {
          delivered += 1;
        } else if (result === 'retry') {
          // Still unreachable: keep this and everything after it for the next attempt.
          undelivered.push(...pending.slice(index));
          break;
        }
      }
      const queuedMeanwhile = readOutbox().filter(
        item => !pending.some(known => known.at === item.at && known.body === item.body),
      );
      writeOutbox([...undelivered, ...queuedMeanwhile]);
      return delivered;
    } finally {
      flushingOutbox = false;
    }
  };

  const sendEvent = async (eventBody: SentryLikeEvent): Promise<boolean> => {
    if (!endpoints || !isEnabled()) return false;
    if (!allowRateLimitedSend()) return false;

    const sanitized = sanitizeSentryEvent(eventBody, {
      dsnOrigin: new URL(endpoints.dsn).origin,
    });
    const eventId = randomBytes(16).toString('hex');
    const sentAt = new Date(now()).toISOString();
    const payload = {
      ...sanitized,
      event_id: eventId,
      timestamp: now() / 1000,
      platform: 'node',
      release: options.release,
      environment,
    };

    const envelopeHeader = JSON.stringify({
      event_id: eventId,
      sent_at: sentAt,
      dsn: endpoints.dsn,
    });
    const itemHeader = JSON.stringify({ type: 'event' });
    const itemPayload = JSON.stringify(payload);
    const body = `${envelopeHeader}\n${itemHeader}\n${itemPayload}\n`;

    const result = await postEnvelope(body);
    if (result === 'retry') enqueue(body);
    return result === 'sent';
  };

  const baseTags = (context?: DesktopSentryCaptureContext): Record<string, string> => ({
    host_kind: 'desktop',
    release_channel: options.channel,
    host_platform: options.platform,
    host_arch: options.arch,
    shell_version: options.shellVersion,
    ...(context?.area ? { area: context.area } : {}),
    ...(context?.tags ?? {}),
  });

  const sendSession = async (update: DesktopSentrySessionUpdate): Promise<boolean> => {
    if (!endpoints || !isEnabled()) return false;
    const envelopeHeader = JSON.stringify({
      sent_at: new Date(now()).toISOString(),
      dsn: endpoints.dsn,
    });
    const session = JSON.stringify({
      sid: update.sid,
      ...(update.did ? { did: update.did } : {}),
      init: update.init,
      started: new Date(update.startedAt).toISOString(),
      timestamp: new Date(update.timestamp).toISOString(),
      status: update.status,
      errors: update.errors,
      ...(update.durationSeconds !== undefined ? { duration: update.durationSeconds } : {}),
      attrs: { release: update.release, environment },
    });
    const body = `${envelopeHeader}\n${JSON.stringify({ type: 'session' })}\n${session}\n`;
    const result = await postEnvelope(body);
    if (result === 'retry') enqueue(body);
    return result === 'sent';
  };

  const startCrashReporter = (crashReporter: ElectronCrashReporterLike): boolean => {
    crashReporterRef = crashReporter;
    if (!endpoints || !isEnabled() || crashReporterStarted) return false;
    try {
      crashReporter.start({
        submitURL: endpoints.minidumpUrl,
        productName: DESKTOP_PRODUCT_NAME,
        compress: true,
        uploadToServer: true,
        extra: {
          release: options.release,
          environment,
          host_kind: 'desktop',
          release_channel: options.channel,
          host_platform: options.platform,
          host_arch: options.arch,
          shell_version: options.shellVersion,
        },
      });
      crashReporterStarted = true;
      return true;
    } catch {
      return false;
    }
  };

  return {
    isEnabled,
    setEnabled(next: boolean) {
      runtimeEnabled = Boolean(next) && Boolean(endpoints);
      // Turning sharing off also discards what was waiting to be sent.
      if (!isEnabled()) {
        writeOutbox([]);
        options.onDisabled?.();
      }
      if (!crashReporterRef) return;
      if (!crashReporterStarted) {
        startCrashReporter(crashReporterRef);
        return;
      }
      try {
        crashReporterRef.setUploadToServer?.(isEnabled());
      } catch {
        // The sharing preference still gates every envelope sent by this reporter.
      }
    },
    getEndpoints() {
      return endpoints;
    },
    flushOutbox,
    sendSession,
    startCrashReporter,
    async captureException(error, context) {
      if (!isEnabled()) return false;
      options.onCapture?.('error');
      const errObj = error instanceof Error ? error : new Error(typeof error === 'string' ? error : String(error));
      const frames = parseStackFrames(errObj.stack, redactPaths);
      const event: SentryLikeEvent = {
        level: 'error',
        tags: baseTags(context),
        exception: {
          values: [
            {
              type: errObj.name || 'Error',
              value: scrubString(errObj.message || 'Unknown error', redactPaths),
              ...(frames ? { stacktrace: { frames } } : {}),
            },
          ],
        },
        ...(context?.extra
          ? { extra: scrubUnknown(context.extra, redactPaths) as Record<string, unknown> }
          : {}),
      };
      return sendEvent(event);
    },
    async captureMessage(message, level = 'error', context) {
      if (!isEnabled()) return false;
      options.onCapture?.(level);
      const event: SentryLikeEvent = {
        level,
        message: scrubString(message, redactPaths),
        tags: baseTags(context),
        ...(context?.extra
          ? { extra: scrubUnknown(context.extra, redactPaths) as Record<string, unknown> }
          : {}),
      };
      return sendEvent(event);
    },
  };
}
