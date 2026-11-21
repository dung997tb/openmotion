import {
  type AmrWorkspaceRole,
  type AuthContext,
  type EffectiveWriteAccess,
  type PatScope,
  type WorkspaceRole,
} from '../contracts/auth.ts';
import { CloudError } from '../contracts/errors.ts';
import type { AppConfig } from '../infra/config.ts';
import {
  intersectScopesWithRole,
  roleAllowedScopes,
  type AuthKeyValueCache,
  type AuthStore,
  type MembershipResolution,
} from './store.ts';

export const MAX_AMR_IDENTITY_CACHE_TTL_SEC = 60;

export interface AmrWorkspaceSnapshot {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceType: 'personal' | 'team';
  readonly workspaceMemberId: string;
  readonly role: AmrWorkspaceRole;
  readonly lifecycleState: string;
  readonly effectiveWriteAccess: EffectiveWriteAccess;
}

export interface AmrWorkspaceDirectoryEntry {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceType: 'personal' | 'team';
  readonly role: AmrWorkspaceRole;
  readonly lifecycleState: string;
}

export interface AmrIdentityLookupResponse {
  readonly active: boolean;
  readonly status: string;
  readonly accessRevokedAt?: string | null;
  readonly authUserId: string;
  readonly appUserId: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly image: string | null;
  readonly workspace: AmrWorkspaceSnapshot | null;
  readonly workspaces?: readonly AmrWorkspaceDirectoryEntry[];
}

export type AmrIdentityLookupResult =
  | { readonly kind: 'ok'; readonly data: AmrIdentityLookupResponse }
  | { readonly kind: 'inactive'; readonly status: string }
  | { readonly kind: 'user_not_found' }
  | { readonly kind: 'workspace_not_found'; readonly code?: string };

export function mapAmrRoleToMotionRole(role: AmrWorkspaceRole): WorkspaceRole {
  switch (role) {
    case 'owner':
      return 'owner';
    case 'admin':
      return 'admin';
    case 'member':
      return 'editor';
  }
}

export function amrIdentityCacheKey(authUserId: string, externalWorkspaceId?: string | null): string {
  const wsPart = externalWorkspaceId?.trim() || 'default';
  return `om:amr:id:${authUserId}:${wsPart}`;
}

export interface AmrIdentityClientOptions {
  apiUrl: string;
  internalToken: string;
  cache?: AuthKeyValueCache;
  cacheTtlSec?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export function amrIdentityClientFromAppConfig(
  config: Pick<
    AppConfig,
    'OPENDESIGN_API_URL' | 'OPENDESIGN_INTERNAL_API_TOKEN' | 'OPENDESIGN_S2S_API_KEY' | 'AMR_IDENTITY_CACHE_TTL_SEC'
  >,
  cache?: AuthKeyValueCache,
): AmrIdentityClient | undefined {
  const token = config.OPENDESIGN_INTERNAL_API_TOKEN ?? config.OPENDESIGN_S2S_API_KEY;
  if (!token) return undefined;
  return new AmrIdentityClient({
    apiUrl: config.OPENDESIGN_API_URL,
    internalToken: token,
    cache,
    cacheTtlSec: config.AMR_IDENTITY_CACHE_TTL_SEC,
  });
}

/**
 * Service-to-service identity lookup client against AMR (`GET /api/internal/identity/:authUserId`).
 * Enforces:
 * - x-internal-token auth ONLY (never Authorization: Bearer)
 * - Cache key isolated by (authUserId, externalWorkspaceId) with TTL <= 60s
 * - 503 AUTH_UNAVAILABLE on AMR unreachability (never silently accepts or clears session)
 * - 401 UNAUTHORIZED (auth_required) on banned/deleting/deleted/revoked accounts
 */
export class AmrIdentityClient {
  private readonly apiUrl: string;
  private readonly internalToken: string;
  private readonly cache?: AuthKeyValueCache;
  private readonly cacheTtlSec: number;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: AmrIdentityClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.internalToken = options.internalToken;
    this.cache = options.cache;
    this.cacheTtlSec = Math.min(
      MAX_AMR_IDENTITY_CACHE_TTL_SEC,
      Math.max(1, Math.floor(options.cacheTtlSec ?? MAX_AMR_IDENTITY_CACHE_TTL_SEC)),
    );
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetcher = options.fetcher ?? fetch;
  }

  async lookupIdentity(
    authUserId: string,
    options: { externalWorkspaceId?: string | null; bypassCache?: boolean } = {},
  ): Promise<AmrIdentityLookupResult> {
    const cacheKey = amrIdentityCacheKey(authUserId, options.externalWorkspaceId);

    if (this.cache && !options.bypassCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as AmrIdentityLookupResponse;
          if (parsed && parsed.active === true && parsed.workspace) {
            return { kind: 'ok', data: parsed };
          }
        } catch {
          await this.cache.del(cacheKey);
        }
      }
    }

    const url = new URL(`${this.apiUrl}/api/internal/identity/${encodeURIComponent(authUserId)}`);
    if (options.externalWorkspaceId) {
      url.searchParams.set('workspaceId', options.externalWorkspaceId);
    }

    let response: Response;
    try {
      response = await this.fetcher(url.toString(), {
        method: 'GET',
        headers: {
          'x-internal-token': this.internalToken,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new CloudError(
        'AUTH_UNAVAILABLE',
        'Temporarily unable to verify login state with OpenDesign account service.',
        { status: 503, cause: error },
      );
    }

    if (response.status >= 500 || response.status === 429) {
      throw new CloudError(
        'AUTH_UNAVAILABLE',
        `OpenDesign account identity lookup failed with HTTP ${response.status}.`,
        { status: 503 },
      );
    }

    const rawBody = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (response.status === 404) {
      const errCode = typeof rawBody?.error === 'string' ? rawBody.error : '';
      if (errCode === 'workspace_not_found') {
        return {
          kind: 'workspace_not_found',
          code: typeof rawBody?.code === 'string' ? rawBody.code : undefined,
        };
      }
      return { kind: 'user_not_found' };
    }

    if (!response.ok || !rawBody) {
      throw new CloudError(
        'AUTH_UNAVAILABLE',
        `Unexpected identity service response HTTP ${response.status}.`,
        { status: 503 },
      );
    }

    if (rawBody.active !== true) {
      return {
        kind: 'inactive',
        status: typeof rawBody.status === 'string' ? rawBody.status : 'inactive',
      };
    }

    const ws = rawBody.workspace as AmrWorkspaceSnapshot | null | undefined;
    if (!ws || typeof ws.workspaceId !== 'string' || typeof ws.workspaceMemberId !== 'string') {
      throw new CloudError('AUTH_UNAVAILABLE', 'AMR identity response missing workspace context.', {
        status: 503,
      });
    }

    const data: AmrIdentityLookupResponse = {
      active: true,
      status: String(rawBody.status ?? 'active'),
      authUserId: String(rawBody.authUserId ?? authUserId),
      appUserId: String(rawBody.appUserId ?? ''),
      email: typeof rawBody.email === 'string' ? rawBody.email : null,
      name: typeof rawBody.name === 'string' ? rawBody.name : null,
      image: typeof rawBody.image === 'string' ? rawBody.image : null,
      workspace: ws,
      workspaces: Array.isArray(rawBody.workspaces)
        ? (rawBody.workspaces as AmrWorkspaceDirectoryEntry[])
        : undefined,
    };

    if (this.cache) {
      await this.cache.set(cacheKey, JSON.stringify(data), this.cacheTtlSec);
    }

    return { kind: 'ok', data };
  }

  /**
   * Resolves AMR identity during OIDC callback and projects user + AMR workspace into Motion DB.
   */
  async resolveAndProjectLogin(
    store: AuthStore,
    input: {
      authUserId: string;
      email?: string | null;
      displayName: string;
      avatarUrl?: string | null;
      requestedExternalWorkspaceId?: string | null;
    },
  ): Promise<{ membership: MembershipResolution; identity: AmrIdentityLookupResponse }> {
    const lookup = await this.lookupIdentity(input.authUserId, {
      externalWorkspaceId: input.requestedExternalWorkspaceId,
      bypassCache: true,
    });

    if (lookup.kind === 'inactive' || lookup.kind === 'user_not_found') {
      throw new CloudError('UNAUTHORIZED', 'Account is not active or does not exist.', {
        status: 401,
      });
    }
    if (lookup.kind === 'workspace_not_found') {
      throw new CloudError('WORKSPACE_FORBIDDEN', 'No active workspace membership found.', {
        status: 403,
      });
    }

    const ws = lookup.data.workspace!;
    const mappedRole = mapAmrRoleToMotionRole(ws.role);
    const membership = await store.projectAmrUserAndWorkspace({
      oidcSub: lookup.data.authUserId,
      appUserId: lookup.data.appUserId,
      email: lookup.data.email ?? input.email ?? null,
      displayName: lookup.data.name || input.displayName,
      avatarUrl: lookup.data.image ?? input.avatarUrl ?? null,
      externalWorkspaceId: ws.workspaceId,
      workspaceName: ws.workspaceName,
      role: mappedRole,
    });

    // Also project any additional AMR workspaces returned in the directory so UI switchers have local IDs.
    if (lookup.data.workspaces) {
      for (const entry of lookup.data.workspaces) {
        if (entry.workspaceId === ws.workspaceId) continue;
        await store
          .projectAmrUserAndWorkspace({
            oidcSub: lookup.data.authUserId,
            appUserId: lookup.data.appUserId,
            email: lookup.data.email ?? input.email ?? null,
            displayName: lookup.data.name || input.displayName,
            avatarUrl: lookup.data.image ?? input.avatarUrl ?? null,
            externalWorkspaceId: entry.workspaceId,
            workspaceName: entry.workspaceName,
            role: mapAmrRoleToMotionRole(entry.role),
          })
          .catch(() => {});
      }
    }

    return { membership, identity: lookup.data };
  }

  /**
   * Verifies a locally authenticated AuthContext against AMR live account status & workspace membership
   * (using the 60s cache keyed by authUserId + externalWorkspaceId) and recalculates scopes on every call.
   */
  async verifyAndEnrichAuthContext(
    store: AuthStore,
    localAuth: AuthContext,
    options: { requestedExternalWorkspaceId?: string | null; bypassCache?: boolean } = {},
  ): Promise<AuthContext> {
    const user = await store.findUserById(localAuth.userId);
    const authUserId = localAuth.authUserId ?? user?.oidcSub;
    if (!authUserId) {
      throw new CloudError('UNAUTHORIZED', 'Unable to resolve upstream user identity.', {
        status: 401,
      });
    }

    const externalWorkspaceId =
      options.requestedExternalWorkspaceId ?? localAuth.externalWorkspaceId ?? null;

    const lookup = await this.lookupIdentity(authUserId, {
      externalWorkspaceId,
      bypassCache: options.bypassCache,
    });

    if (lookup.kind === 'inactive' || lookup.kind === 'user_not_found') {
      throw new CloudError('UNAUTHORIZED', 'Account is suspended, deleted, or revoked.', {
        status: 401,
      });
    }
    if (lookup.kind === 'workspace_not_found') {
      throw new CloudError(
        'PROJECT_NOT_FOUND',
        'Workspace not found or user is no longer an active member.',
        { status: 404 },
      );
    }

    const ws = lookup.data.workspace!;
    const mappedRole = mapAmrRoleToMotionRole(ws.role);

    // Ensure local workspace projection exists and matches the AMR workspace.
    let workspaceId = localAuth.workspaceId;
    if (localAuth.externalWorkspaceId !== ws.workspaceId) {
      const projected = await store.projectAmrUserAndWorkspace({
        oidcSub: lookup.data.authUserId,
        appUserId: lookup.data.appUserId,
        email: lookup.data.email ?? localAuth.email ?? null,
        displayName: lookup.data.name || localAuth.displayName || 'User',
        avatarUrl: lookup.data.image ?? localAuth.avatarUrl ?? null,
        externalWorkspaceId: ws.workspaceId,
        workspaceName: ws.workspaceName,
        role: mappedRole,
      });
      workspaceId = projected.workspace.id;
    }

    // Recompute scopes on EVERY request (even on cache hit!):
    // browser sessions get full role scopes; tokens strictly intersect with live AMR role ceiling.
    const effectiveScopes: PatScope[] =
      localAuth.authMethod === 'session_cookie'
        ? [...roleAllowedScopes(mappedRole)]
        : intersectScopesWithRole(localAuth.scopes, mappedRole);

    return {
      ...localAuth,
      workspaceId,
      role: mappedRole,
      scopes: effectiveScopes,
      authUserId: lookup.data.authUserId,
      appUserId: lookup.data.appUserId,
      externalWorkspaceId: ws.workspaceId,
      amrWorkspaceMemberId: ws.workspaceMemberId,
      amrWorkspaceRole: ws.role,
      amrWorkspaceLifecycleState: ws.lifecycleState,
      effectiveWriteAccess: ws.effectiveWriteAccess,
      email: lookup.data.email ?? localAuth.email ?? null,
      displayName: lookup.data.name ?? localAuth.displayName,
      avatarUrl: lookup.data.image ?? localAuth.avatarUrl ?? null,
    };
  }
}
