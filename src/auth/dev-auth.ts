import { PAT_SCOPES, type AuthContext } from '../contracts/auth.ts';
import type { AppConfig } from '../infra/config.ts';
import { timingSafeStringEqual, type AuthStore } from './store.ts';

export function assertDevAuthAllowed(
  config: Pick<AppConfig, 'NODE_ENV' | 'AUTH_MODE' | 'ALLOW_INSECURE_DEV_AUTH'>,
): void {
  if (
    config.NODE_ENV === 'production' &&
    config.AUTH_MODE === 'dev' &&
    !config.ALLOW_INSECURE_DEV_AUTH
  ) {
    throw new Error(
      'INSECURE_CONFIG: Refusing dev auth bypass when NODE_ENV=production without ALLOW_INSECURE_DEV_AUTH=true.',
    );
  }
}

export function buildDevAuthContext(
  config: Pick<AppConfig, 'DEV_WORKSPACE_ID' | 'DEV_USER_ID'>,
): AuthContext {
  return {
    workspaceId: config.DEV_WORKSPACE_ID,
    userId: config.DEV_USER_ID,
    role: 'owner',
    scopes: [...PAT_SCOPES],
    authMode: 'dev',
    authMethod: 'dev_bypass',
    externalWorkspaceId: null,
    email: 'dev@localhost',
    displayName: 'Local Developer',
  };
}

export function verifyDevPat(
  rawToken: string,
  config: Pick<AppConfig, 'DEV_PAT'>,
): boolean {
  if (!config.DEV_PAT || !rawToken) return false;
  return timingSafeStringEqual(rawToken, config.DEV_PAT);
}

/**
 * Ensures the deterministic dev workspace, user, and owner membership exist in PG.
 * Cached per store instance so it runs once per process lifetime.
 */
export function createDevTenantProvisioner(
  store: AuthStore,
  config: Pick<
    AppConfig,
    'NODE_ENV' | 'AUTH_MODE' | 'ALLOW_INSECURE_DEV_AUTH' | 'DEV_WORKSPACE_ID' | 'DEV_USER_ID'
  >,
): () => Promise<AuthContext> {
  let provisioned: Promise<void> | null = null;

  return async () => {
    assertDevAuthAllowed(config);
    if (!provisioned) {
      provisioned = store
        .ensureDevTenant({
          workspaceId: config.DEV_WORKSPACE_ID,
          userId: config.DEV_USER_ID,
          email: 'dev@localhost',
          displayName: 'Local Developer',
        })
        .then(() => undefined)
        .catch((err) => {
          provisioned = null;
          throw err;
        });
    }
    await provisioned;
    return buildDevAuthContext(config);
  };
}
