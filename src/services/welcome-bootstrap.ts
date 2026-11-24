import { and, eq, isNull } from 'drizzle-orm';
import type { AuthContext } from '../contracts/auth.ts';
import { CloudError } from '../contracts/errors.ts';
import type { Database } from '../db/client.ts';
import { asUpdate } from '../db/helpers.ts';
import { workspaces } from '../db/schema/auth.ts';
import type { Logger } from '../infra/logger.ts';
import { isUuid } from '../../shared/project-validation.ts';
import {
  WELCOME_PROJECT_TITLE,
  WELCOME_PROJECT_TITLE_KEY,
  WELCOME_TEMPLATE_ID,
  type CatalogPort,
  type CloneTemplateResult,
} from './catalog-service.ts';

export interface WelcomeBootstrapDeps {
  db: Database;
  catalog: CatalogPort;
  logger?: Logger;
}

export interface EnsureWelcomeProjectOptions {
  templateId?: string;
  title?: string;
  titleKey?: 'OpenMotion Sample Video' | null;
}

export interface EnsureWelcomeProjectResult {
  bootstrapped: boolean;
  alreadyBootstrapped: boolean;
  workspaceId: string;
  projectId: string | null;
  sessionId: string | null;
  welcomeBootstrappedAt: Date | null;
  cloned?: CloneTemplateResult;
}

/**
 * Idempotent per-workspace welcome bootstrapper.
 *
 * Acquires a row-level `SELECT ... FOR UPDATE` lock on `workspaces` inside a single
 * PostgreSQL transaction so concurrent first requests serialize cleanly:
 * - First request observes `welcome_bootstrapped_at IS NULL`, zero-copy clones
 *   `openmotion-welcome` (`blob_scope = 'catalog'`, 0 `workspace_blobs` writes),
 *   and sets `welcome_bootstrapped_at`, `active_project_id`, and `active_session_id`.
 * - Concurrent / subsequent requests observe `welcome_bootstrapped_at IS NOT NULL`
 *   and return immediately without creating duplicate projects.
 */
export class WelcomeBootstrapService {
  private readonly db: Database;
  private readonly catalog: CatalogPort;
  private readonly logger?: Logger;

  constructor(deps: WelcomeBootstrapDeps) {
    this.db = deps.db;
    this.catalog = deps.catalog;
    this.logger = deps.logger;
  }

  async ensureWelcomeProject(
    ctx: AuthContext,
    options: EnsureWelcomeProjectOptions = {},
  ): Promise<EnsureWelcomeProjectResult> {
    if (!isUuid(ctx.workspaceId)) {
      throw new CloudError('INVALID_ARGUMENT', 'AuthContext.workspaceId must be a valid UUID', {
        status: 400,
        applied: false,
      });
    }

    const templateId = options.templateId ?? WELCOME_TEMPLATE_ID;
    const title = options.title ?? WELCOME_PROJECT_TITLE;
    const titleKey = options.titleKey === undefined ? WELCOME_PROJECT_TITLE_KEY : options.titleKey;

    const result = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({
          id: workspaces.id,
          activeProjectId: workspaces.activeProjectId,
          activeSessionId: workspaces.activeSessionId,
          welcomeBootstrappedAt: workspaces.welcomeBootstrappedAt,
        })
        .from(workspaces)
        .where(eq(workspaces.id, ctx.workspaceId))
        .for('update');

      const workspace = locked[0];
      if (!workspace) {
        throw new CloudError('NOT_FOUND', `Workspace '${ctx.workspaceId}' not found`, {
          status: 404,
          applied: false,
        });
      }

      if (workspace.welcomeBootstrappedAt !== null) {
        return {
          bootstrapped: false,
          alreadyBootstrapped: true,
          workspaceId: workspace.id,
          projectId: workspace.activeProjectId ?? null,
          sessionId: workspace.activeSessionId ?? null,
          welcomeBootstrappedAt: workspace.welcomeBootstrappedAt,
        } satisfies EnsureWelcomeProjectResult;
      }

      const cloned = await this.catalog.cloneTemplateToProject(ctx, {
        templateId,
        title,
        titleKey,
        tx,
        activateWorkspace: false,
        internalSystemBootstrap: true,
      });

      const now = new Date();
      const nextActiveProjectId = workspace.activeProjectId ?? cloned.projectId;
      const nextActiveSessionId = workspace.activeSessionId ?? cloned.sessionId;

      const updatedRows = await tx
        .update(workspaces)
        .set(
          asUpdate(workspaces, {
            activeProjectId: nextActiveProjectId,
            activeSessionId: nextActiveSessionId,
            welcomeBootstrappedAt: now,
            updatedAt: now,
          }),
        )
        .where(and(eq(workspaces.id, ctx.workspaceId), isNull(workspaces.welcomeBootstrappedAt)))
        .returning({
          activeProjectId: workspaces.activeProjectId,
          activeSessionId: workspaces.activeSessionId,
          welcomeBootstrappedAt: workspaces.welcomeBootstrappedAt,
        });

      const updated = updatedRows[0];
      if (!updated) {
        throw new CloudError(
          'REVISION_CONFLICT',
          'Workspace welcome bootstrap raced with another transaction; retry to read current workspace state.',
          { status: 409, applied: false },
        );
      }

      return {
        bootstrapped: true,
        alreadyBootstrapped: false,
        workspaceId: workspace.id,
        projectId: updated.activeProjectId ?? cloned.projectId,
        sessionId: updated.activeSessionId ?? cloned.sessionId,
        welcomeBootstrappedAt: updated.welcomeBootstrappedAt ?? now,
        cloned,
      } satisfies EnsureWelcomeProjectResult;
    });

    if (result.bootstrapped) {
      this.logger?.info('Bootstrapped workspace welcome project zero-copy', {
        workspaceId: result.workspaceId,
        projectId: result.projectId,
        sessionId: result.sessionId,
        templateId,
      });
    }

    return result;
  }
}

export async function ensureWelcomeProject(
  deps: WelcomeBootstrapDeps,
  ctx: AuthContext,
  options?: EnsureWelcomeProjectOptions,
): Promise<EnsureWelcomeProjectResult> {
  return new WelcomeBootstrapService(deps).ensureWelcomeProject(ctx, options);
}
