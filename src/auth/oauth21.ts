import {
  DEFAULT_PAT_SCOPES,
  type AuthContext,
  type AuthMode,
  type PatScope,
} from '../contracts/auth.ts';
import { CloudError } from '../contracts/errors.ts';
import type { AppConfig } from '../infra/config.ts';
import { verifyPkceS256 } from './oidc.ts';
import {
  intersectScopesWithRole,
  isValidPatScope,
  randomBase64Url,
  randomHex,
  sha256Hex,
  timingSafeStringEqual,
  type AuthKeyValueCache,
  type AuthStore,
  type OAuthAuthMethod,
  type OAuthClientRecord,
} from './store.ts';

export const OAUTH_ACCESS_TOKEN_PREFIX = 'om_oat_';
export const OAUTH_REFRESH_TOKEN_PREFIX = 'om_ort_';
const AUTH_CODE_TTL_SEC = 300; // 5 minutes
const ACCESS_TOKEN_TTL_SEC = 3600; // 1 hour
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const OAUTH_TOUCH_THROTTLE_SEC = 60;
// Concurrent refreshes from one client lose the rotation race within this window; that is not theft.
const REFRESH_REUSE_GRACE_SEC = 30;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
export const DEFAULT_DCR_ALLOWED_HTTPS_HOSTS: readonly string[] = ['chatgpt.com', 'claude.ai'];

export type McpOAuthMode = 'proxy' | 'delegated';

export interface OAuth21Config {
  mode: McpOAuthMode;
  publicOrigin: string;
  issuer: string;
  resourceUrl: string;
  resourceMetadataUrl: string;
  supportedScopes: readonly PatScope[];
  allowedHttpsHosts: readonly string[];
  dcrRateLimitPerMin: number;
}

export function parseAllowedHttpsHosts(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [...DEFAULT_DCR_ALLOWED_HTTPS_HOSTS];
  const hosts: string[] = [];
  for (const part of raw.split(',')) {
    const cleaned = part.trim().toLowerCase();
    if (cleaned && !hosts.includes(cleaned)) hosts.push(cleaned);
  }
  return hosts;
}

export function buildOAuth21Config(
  config: Pick<
    AppConfig,
    'APP_PUBLIC_ORIGIN' | 'MCP_OAUTH_MODE' | 'MCP_OAUTH_ISSUER' | 'OIDC_ISSUER'
  > &
    Partial<Pick<AppConfig, 'OAUTH_DCR_ALLOWED_HTTPS_HOSTS' | 'OAUTH_DCR_RATE_LIMIT_PER_MIN'>>,
): OAuth21Config {
  const publicOrigin = config.APP_PUBLIC_ORIGIN.replace(/\/$/, '');
  const resourceUrl = `${publicOrigin}/mcp`;
  const resourceMetadataUrl = `${publicOrigin}/.well-known/oauth-protected-resource/mcp`;
  const issuer = (
    config.MCP_OAUTH_ISSUER ??
    (config.MCP_OAUTH_MODE === 'delegated' && config.OIDC_ISSUER
      ? config.OIDC_ISSUER
      : publicOrigin)
  ).replace(/\/$/, '');

  return {
    mode: config.MCP_OAUTH_MODE,
    publicOrigin,
    issuer,
    resourceUrl,
    resourceMetadataUrl,
    supportedScopes: [...DEFAULT_PAT_SCOPES],
    allowedHttpsHosts: parseAllowedHttpsHosts(config.OAUTH_DCR_ALLOWED_HTTPS_HOSTS),
    dcrRateLimitPerMin: config.OAUTH_DCR_RATE_LIMIT_PER_MIN ?? 10,
  };
}

/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata document.
 */
export function buildProtectedResourceMetadata(cfg: OAuth21Config): Record<string, unknown> {
  return {
    resource: cfg.resourceUrl,
    authorization_servers: [cfg.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [...cfg.supportedScopes],
    resource_name: 'OpenDesign Workbench MCP',
  };
}

/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata document (proxy mode).
 */
export function buildAuthorizationServerMetadata(cfg: OAuth21Config): Record<string, unknown> {
  const base = cfg.publicOrigin;
  return {
    issuer: cfg.issuer,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [...cfg.supportedScopes],
  };
}

export function normalizeResourceUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function isLoopbackRedirectUri(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function formatRedirectHostLabel(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      return `Local application (${parsed.hostname})`;
    }
    return parsed.host;
  } catch {
    return raw;
  }
}

export function isAllowedOAuthRedirectUri(
  raw: string,
  allowedHttpsHosts: readonly string[] = DEFAULT_DCR_ALLOWED_HTTPS_HOSTS,
): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.hash || parsed.username || parsed.password) return false;
  if (parsed.protocol === 'https:') {
    const host = parsed.hostname.toLowerCase();
    if (!host) return false;
    return allowedHttpsHosts.some((allowed) => {
      const target = allowed.trim().toLowerCase();
      if (!target) return false;
      if (target.startsWith('*.')) {
        const suffix = target.slice(1);
        return host.endsWith(suffix) && host.length > suffix.length;
      }
      return host === target;
    });
  }
  if (parsed.protocol === 'http:') {
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  }
  return false;
}

export function isOAuthAccessToken(token: string): boolean {
  return token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) && token.length >= 40;
}

export function parseScopeString(raw: string | null | undefined, fallback: readonly PatScope[]): PatScope[] {
  if (!raw || !raw.trim()) return [...fallback];
  const scopes: PatScope[] = [];
  for (const part of raw.trim().split(/\s+/)) {
    if (isValidPatScope(part) && !scopes.includes(part)) {
      scopes.push(part);
    }
  }
  return scopes.length > 0 ? scopes : [...fallback];
}

// ---------------------------------------------------------------------------
// RFC 7591 Dynamic Client Registration
// ---------------------------------------------------------------------------

export interface RegisterClientInput {
  client_name?: unknown;
  redirect_uris?: unknown;
  grant_types?: unknown;
  token_endpoint_auth_method?: unknown;
}

export interface RegisterClientResult {
  client_id: string;
  client_secret?: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: OAuthAuthMethod;
  client_id_issued_at: number;
}

export async function registerOAuthClient(
  store: AuthStore,
  input: RegisterClientInput,
  options: { allowedHttpsHosts?: readonly string[] } = {},
): Promise<RegisterClientResult> {
  const clientName =
    typeof input.client_name === 'string' && input.client_name.trim().length > 0
      ? input.client_name.trim().slice(0, 160)
      : 'MCP Client';

  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0 || input.redirect_uris.length > 10) {
    throw new CloudError('INVALID_ARGUMENT', 'redirect_uris must be a non-empty array (max 10)', {
      status: 400,
    });
  }
  const allowedHttpsHosts = options.allowedHttpsHosts ?? DEFAULT_DCR_ALLOWED_HTTPS_HOSTS;
  const redirectUris: string[] = [];
  for (const uri of input.redirect_uris) {
    if (typeof uri !== 'string' || !isAllowedOAuthRedirectUri(uri, allowedHttpsHosts)) {
      throw new CloudError(
        'INVALID_ARGUMENT',
        'redirect_uris must contain only loopback HTTP URIs or allowlisted HTTPS hosts without fragments',
        { status: 400 },
      );
    }
    if (!redirectUris.includes(uri)) redirectUris.push(uri);
  }

  const allowedAuthMethods: readonly OAuthAuthMethod[] = [
    'none',
    'client_secret_post',
    'client_secret_basic',
  ];
  const authMethod: OAuthAuthMethod =
    typeof input.token_endpoint_auth_method === 'string' &&
    allowedAuthMethods.includes(input.token_endpoint_auth_method as OAuthAuthMethod)
      ? (input.token_endpoint_auth_method as OAuthAuthMethod)
      : 'none';

  const supportedGrants = new Set(['authorization_code', 'refresh_token']);
  const requestedGrants = Array.isArray(input.grant_types)
    ? input.grant_types.filter((g): g is string => typeof g === 'string' && supportedGrants.has(g))
    : ['authorization_code', 'refresh_token'];
  const grantTypes =
    requestedGrants.length > 0 ? [...new Set(requestedGrants)] : ['authorization_code', 'refresh_token'];

  const clientId = `om_client_${randomHex(12)}`;
  const rawSecret = authMethod === 'none' ? null : `om_csec_${randomBase64Url(32)}`;
  const clientSecretHash = rawSecret ? sha256Hex(rawSecret) : null;

  const created = await store.createOAuthClient({
    clientId,
    clientSecretHash,
    clientName,
    redirectUris,
    grantTypes,
    tokenEndpointAuthMethod: authMethod,
  });

  return {
    client_id: created.clientId,
    ...(rawSecret ? { client_secret: rawSecret } : {}),
    client_name: created.clientName,
    redirect_uris: created.redirectUris,
    grant_types: created.grantTypes,
    token_endpoint_auth_method: created.tokenEndpointAuthMethod,
    client_id_issued_at: Math.floor(created.createdAt.getTime() / 1000),
  };
}

// ---------------------------------------------------------------------------
// Authorization Code Validation & Issuance (OAuth 2.1 + Mandatory PKCE S256)
// ---------------------------------------------------------------------------

export interface ValidatedAuthorizeParams {
  client: OAuthClientRecord;
  redirectUri: string;
  state: string | null;
  scope: string;
  scopes: PatScope[];
  codeChallenge: string;
  resource: string | null;
}

export async function validateAuthorizeRequest(
  store: AuthStore,
  cfg: OAuth21Config,
  params: {
    clientId?: string | null;
    redirectUri?: string | null;
    responseType?: string | null;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
    scope?: string | null;
    state?: string | null;
    resource?: string | null;
  },
): Promise<ValidatedAuthorizeParams> {
  if (!params.clientId) {
    throw new CloudError('INVALID_ARGUMENT', 'client_id is required', { status: 400 });
  }
  const client = await store.findOAuthClient(params.clientId);
  if (!client) {
    throw new CloudError('INVALID_ARGUMENT', 'Unknown OAuth client_id', { status: 400 });
  }
  if (!params.redirectUri || !client.redirectUris.includes(params.redirectUri)) {
    throw new CloudError('INVALID_ARGUMENT', 'redirect_uri does not match registered client', {
      status: 400,
    });
  }
  if (params.responseType !== 'code') {
    throw new CloudError('INVALID_ARGUMENT', 'response_type must be code', { status: 400 });
  }
  if (!params.codeChallenge || params.codeChallenge.length < 43 || params.codeChallenge.length > 128) {
    throw new CloudError('INVALID_ARGUMENT', 'PKCE code_challenge is required', { status: 400 });
  }
  if (params.codeChallengeMethod !== 'S256') {
    throw new CloudError('INVALID_ARGUMENT', 'OAuth 2.1 requires code_challenge_method=S256', {
      status: 400,
    });
  }

  let normalizedResource: string | null = null;
  if (params.resource) {
    normalizedResource = normalizeResourceUrl(params.resource);
    const expectedResource = normalizeResourceUrl(cfg.resourceUrl);
    if (!normalizedResource || normalizedResource !== expectedResource) {
      throw new CloudError('INVALID_ARGUMENT', 'Invalid RFC 8707 resource parameter', {
        status: 400,
      });
    }
  }

  // Self-registered MCP clients must never be granted workspace:admin.
  const scopes = parseScopeString(params.scope, cfg.supportedScopes).filter(
    (s) => s !== 'workspace:admin',
  );
  const safeScopes = scopes.length > 0 ? scopes : [...cfg.supportedScopes];
  return {
    client,
    redirectUri: params.redirectUri,
    state: params.state ?? null,
    scope: safeScopes.join(' '),
    scopes: safeScopes,
    codeChallenge: params.codeChallenge,
    resource: normalizedResource ?? normalizeResourceUrl(cfg.resourceUrl),
  };
}

export async function issueAuthorizationCode(
  store: AuthStore,
  auth: AuthContext,
  validated: ValidatedAuthorizeParams,
  options: { issuer?: string } = {},
): Promise<{ code: string; redirectUrl: string }> {
  const effectiveScopes = intersectScopesWithRole(validated.scopes, auth.role).filter(
    (s) => s !== 'workspace:admin',
  );
  if (effectiveScopes.length === 0) {
    throw new CloudError('FORBIDDEN', 'No requested scopes are permitted for your workspace role', {
      status: 403,
    });
  }

  const code = randomBase64Url(32);
  const codeHash = sha256Hex(code);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000);

  await store.createOAuthAuthCode({
    codeHash,
    clientId: validated.client.clientId,
    userId: auth.userId,
    workspaceId: auth.workspaceId,
    redirectUri: validated.redirectUri,
    scope: effectiveScopes.join(' '),
    codeChallenge: validated.codeChallenge,
    resource: validated.resource,
    expiresAt,
  });

  const redirect = new URL(validated.redirectUri);
  redirect.searchParams.set('code', code);
  if (validated.state) {
    redirect.searchParams.set('state', validated.state);
  }
  if (options.issuer) {
    redirect.searchParams.set('iss', options.issuer);
  }
  return { code, redirectUrl: redirect.toString() };
}

// ---------------------------------------------------------------------------
// Token Exchange & Rotation (`POST /oauth/token`)
// ---------------------------------------------------------------------------

export interface OAuthTokenRequest {
  grantType: string;
  code?: string;
  redirectUri?: string;
  codeVerifier?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  resource?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function authenticateOAuthClient(
  client: OAuthClientRecord,
  suppliedSecret?: string,
): void {
  if (client.tokenEndpointAuthMethod === 'none') return;
  if (!suppliedSecret || !client.clientSecretHash) {
    throw new CloudError('UNAUTHORIZED', 'invalid_client', { status: 401 });
  }
  if (!timingSafeStringEqual(sha256Hex(suppliedSecret), client.clientSecretHash)) {
    throw new CloudError('UNAUTHORIZED', 'invalid_client', { status: 401 });
  }
}

export async function exchangeOAuthToken(
  store: AuthStore,
  cfg: OAuth21Config,
  req: OAuthTokenRequest,
): Promise<OAuthTokenResponse> {
  if (!req.clientId) {
    throw new CloudError('INVALID_ARGUMENT', 'client_id is required', { status: 400 });
  }
  const client = await store.findOAuthClient(req.clientId);
  if (!client) {
    throw new CloudError('UNAUTHORIZED', 'invalid_client', { status: 401 });
  }
  authenticateOAuthClient(client, req.clientSecret);

  if (req.grantType === 'authorization_code') {
    if (!req.code || !req.redirectUri || !req.codeVerifier) {
      throw new CloudError('INVALID_ARGUMENT', 'code, redirect_uri, and code_verifier are required', {
        status: 400,
      });
    }
    const consumed = await store.consumeOAuthAuthCode(sha256Hex(req.code));
    if (!consumed) {
      throw new CloudError('INVALID_ARGUMENT', 'invalid_grant: authorization code expired or already used', {
        status: 400,
      });
    }
    if (consumed.clientId !== client.clientId || consumed.redirectUri !== req.redirectUri) {
      throw new CloudError('INVALID_ARGUMENT', 'invalid_grant: client or redirect_uri mismatch', {
        status: 400,
      });
    }
    if (!verifyPkceS256(req.codeVerifier, consumed.codeChallenge)) {
      throw new CloudError('INVALID_ARGUMENT', 'invalid_grant: PKCE verification failed', {
        status: 400,
      });
    }
    if (req.resource && consumed.resource) {
      if (normalizeResourceUrl(req.resource) !== normalizeResourceUrl(consumed.resource)) {
        throw new CloudError('INVALID_ARGUMENT', 'invalid_target: resource mismatch', {
          status: 400,
        });
      }
    }

    return mintOAuthTokenPair(store, {
      clientId: client.clientId,
      userId: consumed.userId,
      workspaceId: consumed.workspaceId,
      scope: consumed.scope,
      resource: consumed.resource ?? normalizeResourceUrl(cfg.resourceUrl),
    });
  }

  if (req.grantType === 'refresh_token') {
    if (!req.refreshToken) {
      throw new CloudError('INVALID_ARGUMENT', 'refresh_token is required', { status: 400 });
    }
    const refreshHash = sha256Hex(req.refreshToken);
    const existing = await store.findActiveOAuthTokenByRefreshHash(refreshHash);
    if (!existing || existing.clientId !== client.clientId) {
      await revokeConnectionOnRefreshReuse(store, refreshHash, client.clientId);
      throw new CloudError('INVALID_ARGUMENT', 'invalid_grant: refresh token is invalid or expired', {
        status: 400,
      });
    }
    // Rotate refresh token atomically: revoke previous row before issuing a fresh pair.
    const revoked = await store.revokeOAuthTokenById(existing.id);
    if (!revoked) {
      throw new CloudError(
        'INVALID_ARGUMENT',
        'invalid_grant: refresh token already used or revoked',
        { status: 400 },
      );
    }

    return mintOAuthTokenPair(store, {
      clientId: client.clientId,
      userId: existing.userId,
      workspaceId: existing.workspaceId,
      scope: existing.scope,
      resource: existing.resource,
    });
  }

  throw new CloudError('INVALID_ARGUMENT', 'unsupported_grant_type', { status: 400 });
}

/**
 * RFC 9700 §4.14.2: a refresh token presented again after rotation means a copy leaked, and the
 * server cannot tell the attacker from the client, so every live token of that connection is revoked.
 * Only rotation keeps the refresh hash on a revoked row; explicitly revoked tokens no longer match.
 * Project grants stay; the user only has to authorize the client again.
 */
async function revokeConnectionOnRefreshReuse(
  store: AuthStore,
  refreshHash: string,
  clientId: string,
): Promise<void> {
  const prior = await store.findOAuthTokenByRefreshHash(refreshHash);
  if (!prior?.revokedAt || prior.clientId !== clientId) return;
  if (!prior.refreshExpiresAt || prior.refreshExpiresAt.getTime() <= Date.now()) return;
  if (Date.now() - prior.revokedAt.getTime() < REFRESH_REUSE_GRACE_SEC * 1000) return;
  await store.revokeOAuthClientForUser(prior.userId, prior.clientId);
}

async function mintOAuthTokenPair(
  store: AuthStore,
  input: {
    clientId: string;
    userId: string;
    workspaceId: string;
    scope: string;
    resource: string | null;
  },
): Promise<OAuthTokenResponse> {
  const accessToken = `${OAUTH_ACCESS_TOKEN_PREFIX}${randomBase64Url(36)}`;
  const refreshToken = `${OAUTH_REFRESH_TOKEN_PREFIX}${randomBase64Url(36)}`;
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TOKEN_TTL_SEC * 1000);
  const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_SEC * 1000);

  await store.createOAuthToken({
    clientId: input.clientId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    accessTokenHash: sha256Hex(accessToken),
    refreshTokenHash: sha256Hex(refreshToken),
    scope: input.scope,
    resource: input.resource,
    accessExpiresAt,
    refreshExpiresAt,
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshToken,
    scope: input.scope,
  };
}

export async function revokeOAuthToken(store: AuthStore, token: string): Promise<void> {
  if (!token) return;
  await store.revokeOAuthTokenByHash(sha256Hex(token));
}

/**
 * Verify an OAuth 2.1 access token stored in PG `oauth_tokens`.
 * Enforces revocation, expiry, RFC 8707 resource binding, live membership, and strict scope intersection.
 */
export async function verifyOAuthAccessToken(
  store: AuthStore,
  rawToken: string,
  options: { authMode: AuthMode; expectedResource: string; cache?: AuthKeyValueCache },
): Promise<AuthContext | null> {
  if (!isOAuthAccessToken(rawToken)) return null;
  const computedHash = sha256Hex(rawToken);
  const row = await store.findActiveOAuthTokenByAccessHash(computedHash);
  if (!row) return null;
  if (!timingSafeStringEqual(computedHash, row.accessTokenHash)) return null;

  if (row.resource) {
    const expected = normalizeResourceUrl(options.expectedResource);
    const actual = normalizeResourceUrl(row.resource);
    if (!expected || !actual || expected !== actual) return null;
  }

  const membership = await store.findMembership(row.workspaceId, row.userId);
  if (!membership) return null;

  const tokenScopes = parseScopeString(row.scope, []).filter((s) => s !== 'workspace:admin');
  const effectiveScopes = intersectScopesWithRole(tokenScopes, membership.role);

  const touchKey = `om:oauth:touch:${row.id}`;
  if (options.cache) {
    const recentlyTouched = await options.cache.get(touchKey);
    if (!recentlyTouched) {
      await options.cache.set(touchKey, '1', OAUTH_TOUCH_THROTTLE_SEC);
      void store.touchOAuthToken(row.id).catch(() => {});
    }
  } else {
    void store.touchOAuthToken(row.id).catch(() => {});
  }

  return {
    workspaceId: membership.workspace.id,
    userId: membership.user.id,
    role: membership.role,
    scopes: effectiveScopes,
    authMode: options.authMode,
    authMethod: 'oauth_bearer',
    entry: 'mcp',
    clientId: row.clientId,
    externalWorkspaceId: membership.workspace.externalWorkspaceId,
    authUserId: membership.user.oidcSub,
    appUserId: membership.user.appUserId ?? null,
    tokenId: row.id,
    email: membership.user.email,
    displayName: membership.user.displayName,
    avatarUrl: membership.user.avatarUrl,
  };
}

// ---------------------------------------------------------------------------
// Escaped HTML Consent Page for OAuth 2.1 Proxy Mode (OpenDesign Workbench)
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'projects:read': '查看已授权项目的画面、时间轴与版本历史',
  'projects:write': '编辑已授权项目的场景、文案、动画并保存新版本',
  'assets:read': '读取素材库和项目中的媒体文件',
  'assets:write': '上传与导入新的媒体素材到工作区',
  'exports:write': '发起并下载视频/动效渲染导出任务',
  'media:generate': '调用 OpenDesign 平台模型生成图片、视频和音频',
  'mcp:tools': '通过远程 MCP 协议调用 OpenDesign 工作台工具',
};

export function renderOAuthConsentHtml(input: {
  clientName: string;
  redirectUri?: string;
  workspaceName: string;
  workspaceId?: string;
  workspaces?: ReadonlyArray<{ id: string; name: string; role: string }>;
  userEmail?: string | null;
  userDisplayName?: string | null;
  userAvatarUrl?: string | null;
  switchAccountUrl?: string;
  scopes: readonly string[];
  formAction: string;
  hiddenFields: Record<string, string>;
}): string {
  const hiddenInputs = Object.entries(input.hiddenFields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('\n');
  const scopeList = input.scopes
    .map((scope) => {
      const desc = SCOPE_DESCRIPTIONS[scope] ?? scope;
      return `<li><strong>${escapeHtml(desc)}</strong> <span class="scope-tag">${escapeHtml(scope)}</span></li>`;
    })
    .join('\n');

  const redirectHostLabel = input.redirectUri
    ? formatRedirectHostLabel(input.redirectUri)
    : 'Local application';
  const accountDisplay = input.userEmail || input.userDisplayName || '当前登录账号';
  const avatarInitial = (input.userDisplayName || input.userEmail || 'U').slice(0, 1).toUpperCase();
  const avatarHtml = input.userAvatarUrl
    ? `<img class="avatar-img" src="${escapeHtml(input.userAvatarUrl)}" alt="">`
    : `<span class="avatar-fallback">${escapeHtml(avatarInitial)}</span>`;

  const workspaceControl =
    input.workspaces && input.workspaces.length > 1
      ? `<label class="ws-label" for="selected_workspace_id">授权工作区</label>
         <select id="selected_workspace_id" name="selected_workspace_id" class="ws-select">
           ${input.workspaces
             .map(
               (ws) =>
                 `<option value="${escapeHtml(ws.id)}"${ws.id === input.workspaceId ? ' selected' : ''}>${escapeHtml(ws.name)} (${escapeHtml(ws.role)})</option>`,
             )
             .join('\n')}
         </select>`
      : `<div class="kv"><span>授权工作区</span><strong>${escapeHtml(input.workspaceName)}</strong></div>`;

  const switchAccountHtml = input.switchAccountUrl
    ? `<a class="switch-link" href="${escapeHtml(input.switchAccountUrl)}">换一个账号</a>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>授权 ${escapeHtml(input.clientName)} — OpenDesign 工作台</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;background:#0e0f12;color:#f5f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem;}
    main{background:#18191f;border:1px solid #2b2d36;border-radius:14px;max-width:480px;width:100%;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.4);}
    .brand{font-size:0.8rem;letter-spacing:0.04em;text-transform:uppercase;color:#8f96a3;margin-bottom:6px;}
    h1{font-size:1.25rem;margin:0 0 6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
    .unverified{font-size:0.72rem;background:#3a2b14;color:#fbbf24;border:1px solid #6b4e1b;border-radius:999px;padding:2px 8px;font-weight:500;}
    .sub{color:#a1a7b3;font-size:0.88rem;margin:0 0 16px;line-height:1.45;}
    .card{background:#111217;border:1px solid #272932;border-radius:10px;padding:12px 14px;margin-bottom:14px;}
    .account-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}
    .account-left{display:flex;align-items:center;gap:10px;min-width:0;}
    .avatar-img,.avatar-fallback{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;background:#2c3242;color:#fff;font-weight:600;font-size:0.85rem;object-fit:cover;}
    .account-meta{min-width:0;}
    .account-name{font-size:0.92rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .account-email{font-size:0.8rem;color:#9ba1ae;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .switch-link{color:#7cb3ff;font-size:0.82rem;text-decoration:none;white-space:nowrap;}
    .switch-link:hover{text-decoration:underline;}
    .kv{display:flex;justify-content:space-between;align-items:center;font-size:0.86rem;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid #23252e;}
    .kv span{color:#9ba1ae;}
    .ws-label{display:block;font-size:0.82rem;color:#9ba1ae;margin:10px 0 6px;}
    .ws-select{width:100%;padding:8px 10px;border-radius:8px;border:1px solid #353846;background:#181a22;color:#f5f5f7;font-size:0.88rem;}
    .section-title{font-size:0.84rem;color:#9ba1ae;margin:12px 0 8px;}
    ul{padding-left:18px;margin:0 0 18px;}
    li{margin:6px 0;font-size:0.88rem;line-height:1.45;}
    .scope-tag{font-family:ui-monospace,monospace;font-size:0.74rem;color:#8f96a3;background:#23252e;padding:1px 6px;border-radius:4px;margin-left:4px;}
    .note{font-size:0.78rem;color:#8f96a3;margin-bottom:16px;line-height:1.45;}
    .actions{display:flex;gap:12px;margin-top:16px;}
    button{flex:1;padding:10px 16px;border-radius:8px;border:1px solid #3b3e4c;font-size:0.95rem;cursor:pointer;}
    .approve{background:#fff;color:#111;border-color:#fff;font-weight:600;}
    .deny{background:#242630;color:#f5f5f7;}
  </style>
</head>
<body>
  <main>
    <div class="brand">OpenDesign 工作台</div>
    <h1>授权 ${escapeHtml(input.clientName)} <span class="unverified">应用名未经验证</span></h1>
    <p class="sub">该应用正通过远程 MCP 请求连接你的 OpenDesign 工作台。确认后仍需在网页中按项目单独授权才可读写具体项目。</p>
    <form method="POST" action="${escapeHtml(input.formAction)}">
      ${hiddenInputs}
      <div class="card">
        <div class="account-row">
          <div class="account-left">
            ${avatarHtml}
            <div class="account-meta">
              <div class="account-name">${escapeHtml(input.userDisplayName || accountDisplay)}</div>
              <div class="account-email">${escapeHtml(accountDisplay)}</div>
            </div>
          </div>
          ${switchAccountHtml}
        </div>
        <div class="kv"><span>回调来源</span><strong>${escapeHtml(redirectHostLabel)}</strong></div>
        ${workspaceControl}
      </div>
      <div class="section-title">申请的权限范围</div>
      <ul>${scopeList}</ul>
      <div class="note">你可以随时在 OpenDesign 工作台「设置 → 已连接的应用」中撤销此连接。</div>
      <div class="actions">
        <button class="deny" type="submit" name="decision" value="deny">拒绝</button>
        <button class="approve" type="submit" name="decision" value="approve">同意授权</button>
      </div>
    </form>
  </main>
</body>
</html>`;
}
