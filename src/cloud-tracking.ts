import crypto from 'node:crypto';
import { createTracker, uuid } from '../tracking/core.ts';
import { omEvents, studioEvents } from '../tracking/events.ts';
import { createPosthogSender } from '../tracking/node.ts';

const MAX_BROWSER_BATCH_SIZE = 25;
const SAFE_HOOK_ID = /^[a-z0-9_]{1,40}$/;

export interface CloudTrackingHandle {
  isEnabled(): boolean;
  acceptBrowserBatch(payload: unknown): number;
  trackWebSignInResult(params: {
    outcome: 'success' | 'failure' | 'cancelled';
    hookId?: string | null;
    entryId?: string | null;
    userId?: string | null;
    durationMs?: number;
  }): void;
}

export function sanitizeHookId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return SAFE_HOOK_ID.test(trimmed) ? trimmed : undefined;
}

export function sanitizeEntryId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return uuid.test(trimmed) ? trimmed : undefined;
}

/**
 * Env-controlled PostHog tracker for the Web Cloud API server.
 * Stays safely disabled unless OPENMOTION_TRACKING_ENABLED=1/true and a valid
 * public PostHog token (OPENMOTION_POSTHOG_TOKEN=phc_...) are configured.
 */
export function createCloudTracking(appVersion: string, env: NodeJS.ProcessEnv = process.env): CloudTrackingHandle {
  const flag = (env.OPENMOTION_TRACKING_ENABLED ?? '').trim().toLowerCase();
  const token = (env.OPENMOTION_POSTHOG_TOKEN ?? '').trim();
  const host = (env.OPENMOTION_POSTHOG_HOST ?? 'https://us.i.posthog.com').trim();
  const rawEnv = (env.OPENMOTION_TRACKING_ENV ?? 'production').trim().toLowerCase();
  const trackingEnv: 'development' | 'test' | 'production' =
    rawEnv === 'development' || rawEnv === 'test' ? rawEnv : 'production';

  const shouldEnable = (flag === '1' || flag === 'true') && /^phc_[A-Za-z0-9_]+$/.test(token);

  if (!shouldEnable) {
    return {
      isEnabled: () => false,
      acceptBrowserBatch: () => 0,
      trackWebSignInResult: () => {},
    };
  }

  const sender = createPosthogSender({
    host,
    token,
    identity: {
      installation_id: crypto.randomUUID(),
      utm_source: 'openmotion_web',
      created_at: new Date().toISOString(),
    },
    appVersion,
    env: trackingEnv,
  });

  const studioTracker = createTracker({
    registry: studioEvents,
    entrypoint: 'studio',
    enabled: true,
    send: sender,
  });

  const serverTracker = createTracker({
    registry: omEvents,
    entrypoint: 'mcp',
    enabled: true,
    send: sender,
  });

  return {
    isEnabled: () => true,
    acceptBrowserBatch(payload: unknown): number {
      const items = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as { events?: unknown }).events)
          ? (payload as { events: unknown[] }).events
          : [];
      let accepted = 0;
      for (const raw of items.slice(0, MAX_BROWSER_BATCH_SIZE)) {
        if (!raw || typeof raw !== 'object') continue;
        const record = raw as { event?: unknown; properties?: unknown };
        if (typeof record.event !== 'string' || !Object.hasOwn(studioEvents, record.event)) continue;
        const props = record.properties && typeof record.properties === 'object'
          ? (record.properties as Record<string, unknown>)
          : {};
        const status = studioTracker.track(record.event as keyof typeof studioEvents, props as never);
        if (status === 'queued') accepted++;
      }
      return accepted;
    },
    trackWebSignInResult({ outcome, hookId, entryId, userId, durationMs }) {
      const safeHook = sanitizeHookId(hookId) ?? 'openmotion_editor_login';
      const safeEntry = sanitizeEntryId(entryId);
      serverTracker.track('account_sign_in_result', {
        attempt_id: crypto.randomUUID(),
        outcome,
        source_product: 'openmotion',
        source_detail: safeHook as never,
        ...(safeEntry ? { entry_id: safeEntry } : {}),
        ...(userId ? { amr_user_id: userId } : {}),
        connector_version: 'web-oidc',
        resumed: false,
        duration_ms: Math.max(0, Math.round(durationMs ?? 0)),
      });
    },
  };
}
