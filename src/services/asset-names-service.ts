import { and, eq } from 'drizzle-orm';
import type { AuthContext } from '../contracts/auth.ts';
import { CloudError } from '../contracts/errors.ts';
import type { Database } from '../db/client.ts';
import { asUpdate } from '../db/helpers.ts';
import { projects } from '../db/schema/projects.ts';
import {
  FONT_EXT,
  allocateProjectAssetNames,
  namingLanguage,
  projectAssetKind,
  validateAssetDisplayName,
  type AssetNameAllocations,
  type ProjectAssetName,
} from '../../shared/asset-names.ts';
import {
  loadProjectOrThrow,
  normalizeSafeProjectPath,
  type ProjectFilesService,
} from './project-files-service.ts';

export type FontMetadataEntry = NonNullable<ProjectAssetName['font']> & { path: string };

export interface AssetNamesServiceDeps {
  readonly db: Database;
  readonly files: ProjectFilesService;
  readonly inspectFontBuffer?: (buffer: Buffer) => NonNullable<ProjectAssetName['font']> | null;
}

export interface ProjectAssetNamesResult {
  readonly projectId: string;
  readonly namingLanguage: string;
  readonly assetNames: Record<string, string>;
  readonly allocations: AssetNameAllocations;
}

interface MotionAssetsManifest {
  assets?: Array<ProjectAssetName & Record<string, unknown>>;
  [key: string]: unknown;
}

function parseMotionAssets(raw: string | null): MotionAssetsManifest {
  if (!raw) return { assets: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as MotionAssetsManifest;
      return {
        ...obj,
        assets: Array.isArray(obj.assets) ? obj.assets : [],
      };
    }
  } catch {
    // Ignore malformed manifest and return empty list.
  }
  return { assets: [] };
}

function parseProjectLanguage(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { namingLanguage?: unknown };
    if (typeof parsed.namingLanguage === 'string' && parsed.namingLanguage.trim()) {
      return namingLanguage(parsed.namingLanguage.trim());
    }
  } catch {
    // Ignore malformed manifest.
  }
  return null;
}

function readStoredAllocations(raw: Record<string, unknown> | null | undefined): AssetNameAllocations {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: AssetNameAllocations = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const item = value as { basis?: unknown; name?: unknown; sequence?: unknown };
      if (typeof item.basis === 'string' && typeof item.name === 'string') {
        result[key] = {
          basis: item.basis,
          name: item.name,
          ...(typeof item.sequence === 'number' ? { sequence: item.sequence } : {}),
        };
      }
    }
  }
  return result;
}

export class AssetNamesService {
  private readonly db: Database;
  private readonly files: ProjectFilesService;
  private readonly inspectFontBuffer?: (buffer: Buffer) => NonNullable<ProjectAssetName['font']> | null;

  constructor(deps: AssetNamesServiceDeps) {
    this.db = deps.db;
    this.files = deps.files;
    this.inspectFontBuffer = deps.inspectFontBuffer;
  }

  /**
   * Read or allocate deterministic human-readable display names for every asset path in a project.
   * Persists updated allocations to `projects.asset_name_allocations` without creating source edits.
   */
  async readAssetNames(
    ctx: AuthContext,
    projectId: string,
    options: {
      paths?: readonly string[];
      fonts?: readonly FontMetadataEntry[];
      fallbackLanguage?: string;
    } = {},
  ): Promise<ProjectAssetNamesResult> {
    const project = await loadProjectOrThrow(this.db, ctx.workspaceId, projectId, { allowTrashed: true, auth: ctx });

    const allFiles = options.paths
      ? [...options.paths]
      : (await this.files.listFiles(ctx, projectId, { allowTrashed: true })).map((f) => f.path);

    const motionAssetsText = (await this.files.readTextFile(ctx, projectId, 'motion-assets.json'))?.content ?? null;
    const motionProjectText = (await this.files.readTextFile(ctx, projectId, 'motion-project.json'))?.content ?? null;

    const manifest = parseMotionAssets(motionAssetsText);
    const records: ProjectAssetName[] = (manifest.assets ?? []).filter(
      (item) => Boolean(item && typeof item.path === 'string'),
    );

    const language =
      project.namingLanguage?.trim() ||
      parseProjectLanguage(motionProjectText) ||
      options.fallbackLanguage ||
      'en';

    let fonts: FontMetadataEntry[] = options.fonts ? [...options.fonts] : [];
    if (!options.fonts && this.inspectFontBuffer) {
      fonts = [];
      for (const filePath of allFiles) {
        if (!FONT_EXT.test(filePath)) continue;
        try {
          const bin = await this.files.readBinaryFile(ctx, projectId, filePath);
          if (!bin) continue;
          const meta = this.inspectFontBuffer(bin.buffer);
          if (meta) fonts.push({ ...meta, path: filePath });
        } catch {
          // Invalid font files remain untouched and fall back to sequence captions.
        }
      }
    }

    const previous = readStoredAllocations(project.assetNameAllocations);
    const { names, allocations } = allocateProjectAssetNames(allFiles, records, language, fonts, previous);

    const prevJson = JSON.stringify(previous);
    const nextJson = JSON.stringify(allocations);
    if (prevJson !== nextJson) {
      await this.db
        .update(projects)
        .set(
          asUpdate(projects, {
            assetNameAllocations: allocations as unknown as Record<string, unknown>,
          }),
        )
        .where(and(eq(projects.id, project.id), eq(projects.workspaceId, ctx.workspaceId)));
    }

    return {
      projectId: project.id,
      namingLanguage: language,
      assetNames: names,
      allocations,
    };
  }

  /**
   * Update one or more asset display names (and optional `namingLanguage`) in `motion-assets.json`
   * + `projects.asset_name_allocations` without renaming or moving the underlying file paths.
   */
  async updateAssetNames(
    ctx: AuthContext,
    projectId: string,
    input: {
      assetNames?: ReadonlyArray<{
        path: string;
        name: string;
        nameSource?: 'user' | 'agent' | 'source';
      }>;
      namingLanguage?: string;
      expectedRevision?: string;
      requestId?: string;
      writeToken?: string | null;
    },
  ): Promise<ProjectAssetNamesResult & { revision: string; versionId: string | null }> {
    const project = await loadProjectOrThrow(this.db, ctx.workspaceId, projectId, { allowTrashed: false, auth: ctx });

    let validatedLanguage: string | undefined;
    if (input.namingLanguage !== undefined) {
      try {
        validatedLanguage = namingLanguage(input.namingLanguage);
      } catch (error) {
        throw new CloudError(
          'INVALID_ARGUMENT',
          error instanceof Error ? error.message : 'Invalid namingLanguage.',
          { status: 400, applied: false },
        );
      }
    }

    const updates = (input.assetNames ?? []).map((entry) => {
      const safePath = normalizeSafeProjectPath(entry.path);
      if (projectAssetKind(safePath) < 0) {
        throw new CloudError('INVALID_ARGUMENT', `Path "${safePath}" is not a project media or font asset.`, {
          status: 400,
          applied: false,
        });
      }
      let cleanName: string;
      try {
        cleanName = validateAssetDisplayName(entry.name);
      } catch (error) {
        throw new CloudError(
          'INVALID_ARGUMENT',
          error instanceof Error ? error.message : 'Invalid asset display name.',
          { status: 400, applied: false },
        );
      }
      return {
        path: safePath,
        name: cleanName,
        nameSource: entry.nameSource ?? ('user' as const),
      };
    });

    const motionAssetsRaw = (await this.files.readTextFile(ctx, projectId, 'motion-assets.json'))?.content ?? null;
    const manifest = parseMotionAssets(motionAssetsRaw);
    const byPath = new Map<string, ProjectAssetName & Record<string, unknown>>();
    for (const item of manifest.assets ?? []) {
      if (item && typeof item.path === 'string') {
        byPath.set(item.path, { ...item });
      }
    }

    for (const update of updates) {
      const existing = byPath.get(update.path) ?? { path: update.path };
      byPath.set(update.path, {
        ...existing,
        path: update.path,
        name: update.name,
        nameSource: update.nameSource,
      });
    }

    const nextManifest: MotionAssetsManifest = {
      ...manifest,
      assets: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };

    const ops: Array<{ op: 'upsert_text'; path: string; content: string; mimeType: string }> = [
      {
        op: 'upsert_text',
        path: 'motion-assets.json',
        content: JSON.stringify(nextManifest, null, 2) + '\n',
        mimeType: 'application/json; charset=utf-8',
      },
    ];

    if (validatedLanguage !== undefined) {
      const motionProjectRaw = (await this.files.readTextFile(ctx, projectId, 'motion-project.json'))?.content ?? null;
      let motionProject: Record<string, unknown> = {};
      if (motionProjectRaw) {
        try {
          const parsed = JSON.parse(motionProjectRaw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            motionProject = parsed as Record<string, unknown>;
          }
        } catch {
          motionProject = {};
        }
      }
      motionProject.namingLanguage = validatedLanguage;
      ops.push({
        op: 'upsert_text',
        path: 'motion-project.json',
        content: JSON.stringify(motionProject, null, 2) + '\n',
        mimeType: 'application/json; charset=utf-8',
      });
    }

    const committed = await this.files.commitChanges(ctx, {
      projectId: project.id,
      ops,
      expectedRevision: input.expectedRevision,
      requestId: input.requestId,
      idempotencyScope: 'project:asset-names',
      source: 'studio',
      summary: 'Updated asset display names',
      writeToken: input.writeToken,
      projectUpdates: validatedLanguage !== undefined ? { namingLanguage: validatedLanguage } : undefined,
    });

    const refreshed = await this.readAssetNames(ctx, projectId);
    return {
      ...refreshed,
      revision: committed.revision,
      versionId: committed.versionId,
    };
  }

  /**
   * Clean up asset display metadata and PG allocations after deleting a file or folder prefix.
   */
  async cleanupDeletedPaths(
    ctx: AuthContext,
    projectId: string,
    deletedPaths: readonly string[],
  ): Promise<void> {
    if (deletedPaths.length === 0) return;
    const deletedSet = new Set(deletedPaths.map((p) => normalizeSafeProjectPath(p)));
    const project = await loadProjectOrThrow(this.db, ctx.workspaceId, projectId, { allowTrashed: true, auth: ctx });

    const previous = readStoredAllocations(project.assetNameAllocations);
    let allocationsChanged = false;
    const nextAllocations: AssetNameAllocations = {};
    for (const [assetPath, entry] of Object.entries(previous)) {
      if (deletedSet.has(assetPath)) {
        allocationsChanged = true;
      } else {
        nextAllocations[assetPath] = entry;
      }
    }

    if (allocationsChanged) {
      await this.db
        .update(projects)
        .set(
          asUpdate(projects, {
            assetNameAllocations: nextAllocations as unknown as Record<string, unknown>,
          }),
        )
        .where(and(eq(projects.id, project.id), eq(projects.workspaceId, ctx.workspaceId)));
    }

    const motionAssetsRaw = (await this.files.readTextFile(ctx, projectId, 'motion-assets.json'))?.content ?? null;
    if (!motionAssetsRaw) return;
    const manifest = parseMotionAssets(motionAssetsRaw);
    const filtered = (manifest.assets ?? []).filter((item) => !deletedSet.has(item.path));
    if (filtered.length !== (manifest.assets ?? []).length) {
      await this.files.commitChanges(ctx, {
        projectId: project.id,
        ops: [
          {
            op: 'upsert_text',
            path: 'motion-assets.json',
            content: JSON.stringify({ ...manifest, assets: filtered }, null, 2) + '\n',
            mimeType: 'application/json; charset=utf-8',
          },
        ],
        skipVersion: true,
        summary: 'Cleaned deleted asset metadata',
      });
    }
  }
}
