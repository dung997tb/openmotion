import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthContext, AuthMode } from '../contracts/auth.ts';
import type { AppConfig } from '../infra/config.ts';
import { isAssetLease } from './preview-asset-lease.ts';
import { isUuid } from '../../shared/project-validation.ts';

export const PREVIEW_TOKEN_TYPE = 'om_preview' as const;
export const PREVIEW_TOKEN_PREFIX = 'om_pt_' as const;
export const PREVIEW_TOKEN_QUERY_PARAM = 'pt' as const;
export const PREVIEW_TOKEN_HEADER = 'x-openmotion-preview-token' as const;
export const DEFAULT_PREVIEW_TOKEN_TTL_SEC = 900;

const PREVIEW_KEY_DOMAIN = 'openmotion:preview-token:hmac-sha256:v1';
const MAX_PREVIEW_TOKEN_LENGTH = 2048;
const PREVIEW_VIEWER_USER_ID = '00000000-0000-4000-8000-000000000000';
const BASE64URL_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

export interface PreviewTokenPayload {
  readonly typ: typeof PREVIEW_TOKEN_TYPE;
  readonly wid: string;
  readonly pid: string;
  readonly assetLease?: string;
  readonly iat: number;
  readonly exp: number;
}

export interface SignPreviewTokenInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly assetLease?: string;
  readonly ttlSec?: number;
  readonly nowMs?: number;
}

export interface SignedPreviewToken {
  readonly token: string;
  readonly expiresAt: string;
  readonly exp: number;
}

export interface VerifyPreviewTokenOptions {
  readonly expectedProjectId?: string;
  readonly expectedWorkspaceId?: string;
  readonly nowMs?: number;
}

/**
 * Derive a domain-separated HS256 signing key from `SESSION_SECRET` (or `DEV_PAT` in local `AUTH_MODE=dev`)
 * so raw session secrets are never reused directly as HMAC keys across token types.
 */
export function resolvePreviewTokenSecret(
  config: Pick<AppConfig, 'SESSION_SECRET' | 'DEV_PAT' | 'AUTH_MODE'>,
): string {
  const sessionSecret = config.SESSION_SECRET?.trim();
  if (sessionSecret) {
    return sessionSecret;
  }
  if (config.AUTH_MODE === 'dev' && config.DEV_PAT) {
    return `dev-preview:${config.DEV_PAT}`;
  }
  throw new Error('SESSION_SECRET is required to sign or verify preview tokens');
}

function derivePreviewHmacKey(secret: string): Buffer {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new Error('Preview token signing secret must not be empty');
  }
  return createHash('sha256').update(`${PREVIEW_KEY_DOMAIN}:${trimmed}`, 'utf8').digest();
}

function encodeBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeBase64UrlJson(segment: string): unknown | null {
  if (!segment || !BASE64URL_SEGMENT_RE.test(segment)) return null;
  try {
    const raw = Buffer.from(segment, 'base64url').toString('utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Sign a short-lived HMAC-SHA256 preview token strictly scoped to a single `(workspaceId, projectId)` pair.
 * Format: `om_pt_<base64url(payload)>.<base64url(hmacSha256)>`.
 * The `om_pt_` prefix + 2-segment shape makes it structurally distinct from OIDC 3-segment JWTs,
 * `om_pat_` PATs, and `om_oat_` OAuth access tokens so `/motion-api/*`, `/auth/*`, `/oauth/*`,
 * `/mcp`, and all mutating endpoints immediately reject it with 401 without hitting OIDC JWKS.
 */
export function signPreviewToken(input: SignPreviewTokenInput, secret: string): SignedPreviewToken {
  if (!isUuid(input.workspaceId)) {
    throw new Error('Preview token workspaceId must be a valid UUID');
  }
  if (!isUuid(input.projectId)) {
    throw new Error('Preview token projectId must be a valid UUID');
  }
  const ttlSec = input.ttlSec ?? DEFAULT_PREVIEW_TOKEN_TTL_SEC;
  if (!Number.isFinite(ttlSec) || ttlSec <= 0) {
    throw new Error('Preview token ttlSec must be a positive number');
  }

  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const exp = nowSec + Math.floor(ttlSec);

  const payload: PreviewTokenPayload = {
    typ: PREVIEW_TOKEN_TYPE,
    wid: input.workspaceId,
    pid: input.projectId,
    ...(input.assetLease && { assetLease: input.assetLease }),
    iat: nowSec,
    exp,
  };
  const payloadB64 = encodeBase64UrlJson(payload);
  const signingInput = `${PREVIEW_TOKEN_PREFIX}${payloadB64}`;
  const key = derivePreviewHmacKey(secret);
  const signatureB64 = createHmac('sha256', key).update(signingInput, 'utf8').digest('base64url');

  return {
    token: `${signingInput}.${signatureB64}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    exp,
  };
}

/**
 * Timing-safe HMAC-SHA256 verification of a project-scoped preview token.
 * Enforces `om_pt_` prefix, `typ === 'om_preview'`, valid UUID claims, expiration, and optional project/workspace binding.
 */
export function verifyPreviewToken(
  token: string | null | undefined,
  secret: string,
  options: VerifyPreviewTokenOptions = {},
): PreviewTokenPayload | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > MAX_PREVIEW_TOKEN_LENGTH) return null;
  if (!trimmed.startsWith(PREVIEW_TOKEN_PREFIX)) return null;

  const segments = trimmed.split('.');
  if (segments.length !== 2) return null;
  const [prefixedPayload, sigB64] = segments;
  const payloadB64 = prefixedPayload.slice(PREVIEW_TOKEN_PREFIX.length);
  if (
    !payloadB64 ||
    !sigB64 ||
    !BASE64URL_SEGMENT_RE.test(payloadB64) ||
    !BASE64URL_SEGMENT_RE.test(sigB64)
  ) {
    return null;
  }

  let key: Buffer;
  try {
    key = derivePreviewHmacKey(secret);
  } catch {
    return null;
  }

  const expectedSig = createHmac('sha256', key).update(prefixedPayload, 'utf8').digest();
  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
    return null;
  }

  const rawPayload = decodeBase64UrlJson(payloadB64);
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return null;
  const payload = rawPayload as Partial<PreviewTokenPayload>;

  if (payload.typ !== PREVIEW_TOKEN_TYPE) return null;
  if (payload.assetLease !== undefined && !isAssetLease(payload.assetLease)) return null;
  if (typeof payload.wid !== 'string' || !isUuid(payload.wid)) return null;
  if (typeof payload.pid !== 'string' || !isUuid(payload.pid)) return null;
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) return null;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;

  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (payload.exp <= nowSec) return null;

  if (options.expectedProjectId !== undefined && payload.pid !== options.expectedProjectId) {
    return null;
  }
  if (options.expectedWorkspaceId !== undefined && payload.wid !== options.expectedWorkspaceId) {
    return null;
  }

  return {
    typ: PREVIEW_TOKEN_TYPE,
    wid: payload.wid,
    pid: payload.pid,
    ...(payload.assetLease && { assetLease: payload.assetLease }),
    iat: payload.iat,
    exp: payload.exp,
  };
}

export function previewAssetBase(origin: string, projectId: string, assetCredential: string): string {
  return `${origin}/api/projects/${encodeURIComponent(projectId)}/preview/~assets/${encodeURIComponent(assetCredential)}/`;
}

/**
 * Extract a preview token strictly from the `X-OpenMotion-Preview-Token` header or `?pt=...` query param.
 * Never reads browser session cookies or `Authorization: Bearer` headers.
 */
export function extractPreviewToken(request: Request): string | null {
  const fromHeader = request.headers.get(PREVIEW_TOKEN_HEADER)?.trim();
  if (fromHeader) return fromHeader;
  try {
    const fromQuery = new URL(request.url).searchParams.get(PREVIEW_TOKEN_QUERY_PARAM)?.trim();
    return fromQuery || null;
  } catch {
    return null;
  }
}

/**
 * Build a minimal read-only `AuthContext` bound strictly to the preview token's workspace and `projects:read` scope.
 */
export function buildPreviewAuthContext(payload: Pick<PreviewTokenPayload, 'wid' | 'pid'>, authMode: AuthMode): AuthContext {
  return {
    workspaceId: payload.wid,
    userId: PREVIEW_VIEWER_USER_ID,
    role: 'viewer',
    scopes: ['projects:read'],
    authMode,
    authMethod: 'preview_token',
    tokenId: `om_preview:${payload.pid}`,
    displayName: 'Preview Viewer',
  };
}
