import {
  DEFAULT_PAT_SCOPES,
  hasMinRole,
  hasScope,
  type AuthContext,
  type AuthMode,
  type PatScope,
} from '../contracts/auth.ts';
import { CloudError } from '../contracts/errors.ts';
import {
  intersectScopesWithRole,
  isValidPatScope,
  randomBase64Url,
  randomHex,
  roleAllowedScopes,
  sha256Hex,
  timingSafeStringEqual,
  type AuthKeyValueCache,
  type AuthStore,
  type PatRecord,
} from './store.ts';

const PAT_FORMAT_REGEX = /^om_pat_([a-f0-9]{8})_([A-Za-z0-9_-]{32,96})$/;
const PAT_TOUCH_THROTTLE_SEC = 60;

export function isPatToken(token: string): boolean {
  return PAT_FORMAT_REGEX.test(token);
}

export interface CreatePatInput {
  name: string;
  scopes?: readonly string[];
  expiresInDays?: number | null;
}

export interface CreatedPatResult {
  id: string;
  name: string;
  tokenPrefix: string;
  token: string; // Returned once at creation time; only SHA-256 hash is persisted.
  scopes: PatScope[];
  expiresAt: string | null;
  createdAt: string;
}

export interface PatSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: PatScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function toPatSummary(row: PatRecord): PatSummary {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: [...row.scopes],
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Mint a workspace-scoped Personal Access Token (`om_pat_<8hex>_<secret>`).
 * Persists only the SHA-256 hash in PG `personal_access_tokens`.
 */
export async function createPat(
  store: AuthStore,
  auth: AuthContext,
  input: CreatePatInput,
): Promise<CreatedPatResult> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100 || /[\x00-\x1f]/.test(name)) {
    throw new CloudError('INVALID_ARGUMENT', 'Token name must be 1 to 100 printable characters', {
      status: 400,
    });
  }

  let requestedScopes: PatScope[];
  if (input.scopes && input.scopes.length > 0) {
    const validated: PatScope[] = [];
    for (const raw of input.scopes) {
      if (!isValidPatScope(raw)) {
        throw new CloudError('INVALID_ARGUMENT', `Unknown token scope: ${raw}`, { status: 400 });
      }
      if (!validated.includes(raw)) validated.push(raw);
    }
    requestedScopes = validated;
  } else {
    requestedScopes = intersectScopesWithRole(DEFAULT_PAT_SCOPES, auth.role);
  }

  // Enforce role ceiling at creation time so a lower-role member cannot request privileged scopes.
  const roleCeiling = new Set<PatScope>(roleAllowedScopes(auth.role));
  for (const scope of requestedScopes) {
    if (!roleCeiling.has(scope)) {
      throw new CloudError(
        'FORBIDDEN',
        `Workspace role '${auth.role}' is not permitted to mint scope '${scope}'`,
        { status: 403 },
      );
    }
  }

  let expiresAt: Date | null = null;
  if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
    if (
      typeof input.expiresInDays !== 'number' ||
      !Number.isFinite(input.expiresInDays) ||
      input.expiresInDays < 1 ||
      input.expiresInDays > 365
    ) {
      throw new CloudError('INVALID_ARGUMENT', 'expiresInDays must be between 1 and 365', {
        status: 400,
      });
    }
    expiresAt = new Date(Date.now() + Math.floor(input.expiresInDays) * 24 * 60 * 60 * 1000);
  }

  const prefixId = randomHex(4); // 8 hex chars
  const secret = randomBase64Url(36); // 48 base64url chars
  const tokenPrefix = `om_pat_${prefixId}`;
  const rawToken = `${tokenPrefix}_${secret}`;
  const tokenHash = sha256Hex(rawToken);

  const row = await store.createPat({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    name,
    tokenPrefix,
    tokenHash,
    scopes: requestedScopes,
    expiresAt,
  });

  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    token: rawToken,
    scopes: [...row.scopes],
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Verify a Personal Access Token against PG `personal_access_tokens`.
 * Strictly intersects token scopes with live workspace role — NEVER elevates restricted PAT scopes!
 */
export async function verifyPat(
  store: AuthStore,
  rawToken: string,
  options: { authMode: AuthMode; cache?: AuthKeyValueCache },
): Promise<AuthContext | null> {
  if (!isPatToken(rawToken)) return null;
  const computedHash = sha256Hex(rawToken);
  const row = await store.findActivePatByHash(computedHash);
  if (!row) return null;

  if (!timingSafeStringEqual(computedHash, row.tokenHash)) {
    return null;
  }

  const membership = await store.findMembership(row.workspaceId, row.userId);
  if (!membership) return null;

  const effectiveScopes = intersectScopesWithRole(row.scopes, membership.role);

  // Throttle `last_used_at` writes to at most once per minute per token.
  const throttleKey = `om:pat:touch:${row.id}`;
  if (options.cache) {
    const recentlyTouched = await options.cache.get(throttleKey);
    if (!recentlyTouched) {
      await options.cache.set(throttleKey, '1', PAT_TOUCH_THROTTLE_SEC);
      void store.touchPat(row.id).catch(() => {});
    }
  } else {
    void store.touchPat(row.id).catch(() => {});
  }

  return {
    workspaceId: membership.workspace.id,
    userId: membership.user.id,
    role: membership.role,
    scopes: effectiveScopes,
    authMode: options.authMode,
    authMethod: 'pat',
    entry: 'api',
    externalWorkspaceId: membership.workspace.externalWorkspaceId,
    authUserId: membership.user.oidcSub,
    appUserId: membership.user.appUserId ?? null,
    tokenId: row.id,
    email: membership.user.email,
    displayName: membership.user.displayName,
    avatarUrl: membership.user.avatarUrl,
  };
}

export async function listPats(store: AuthStore, auth: AuthContext): Promise<PatSummary[]> {
  const canViewAll = hasMinRole(auth, 'admin') && hasScope(auth, 'workspace:admin');
  const rows = await store.listPats(auth.workspaceId, canViewAll ? undefined : auth.userId);
  return rows.map(toPatSummary);
}

export async function revokePat(
  store: AuthStore,
  auth: AuthContext,
  tokenId: string,
): Promise<boolean> {
  const canRevokeAny = hasMinRole(auth, 'admin') && hasScope(auth, 'workspace:admin');
  return store.revokePat(auth.workspaceId, tokenId, canRevokeAny ? undefined : auth.userId);
}
