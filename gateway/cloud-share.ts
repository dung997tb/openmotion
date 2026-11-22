import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WorkspaceStore } from '../workspace.ts';
import { DesignError, designProjectsFor } from '../design-projects.ts';
import { GameError, gameProjectsFor } from '../game-projects.ts';
import {
  buildCloudSharePath,
  cloudProjectIdForShare,
  verifiedAmrShareViewerUrl,
  type CloudShareFreshness,
  type CloudShareKind,
  type CloudShareSnapshot,
  type CloudShareStatus,
} from '../shared/cloud-share.ts';
import { AssetLibrary, atomicAssetJson } from './asset-library.ts';
import { AccountRequestError, type OpenDesignAccount, type OpenDesignWorkspacePrincipal } from './account.ts';
import { gatewayFor } from './service.ts';

const MAX_SHARE_FILES = 500;
const MAX_SHARE_BYTES = 50 * 1024 * 1024;
const PUBLIC_FILE_RESOURCE_KIND = 'project';
const REWRITABLE_TEXT_FILE = /\.(?:html?|css|m?js|cjs|json|svg)$/i;
const ASSET_MEDIA_REF = /(?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?\/(?:motion-api|api)\/assets\/([A-Za-z0-9_-]+)\/versions\/([A-Za-z0-9_-]+)\/media(?:\?[^"'`\s)\\]*)?/g;
const GAME_PLAY_REF = /(?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?\/(?:motion-api|api)\/games\/([^/]+)\/play\/([^"'`\s)\\?#]+(?:\?[^"'`\s)\\#]*)?(?:#[^"'`\s)\\]*)?)/g;
const DESIGN_RAW_REF = /(?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?\/(?:motion-api|api)\/design\/raw\/([^/]+)\/([^"'`\s)\\?#]+(?:\?[^"'`\s)\\#]*)?(?:#[^"'`\s)\\]*)?)/g;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
};

export class CloudShareError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'CLOUD_SHARE_ERROR') {
    super(message);
    this.name = 'CloudShareError';
    this.status = status;
    this.code = code;
  }
}

interface StagedShareFile {
  file: string;
  data: Buffer;
}

interface ShareBundle {
  kind: CloudShareKind;
  projectId: string;
  title: string;
  entryPath: string;
  multiplayer?: boolean;
  files: StagedShareFile[];
  fileCount: number;
  totalBytes: number;
  bundledAssetCount: number;
  contentFingerprint: string;
}

interface PersistedCloudShareRecord {
  kind: CloudShareKind;
  projectId: string;
  cloudProjectId: string;
  workspaceId: string;
  ownerMemberId: string;
  workspaceName?: string;
  slug: string;
  sourceFileId: string;
  sourceKey: string;
  resourceId: string;
  entryPath: string;
  status: CloudShareStatus;
  url: string | null;
  version?: number;
  versionId?: string;
  publishedAt?: number;
  contentFingerprint?: string;
  updatedAt: number;
}

function assertValidKind(kind: string): asserts kind is CloudShareKind {
  if (kind !== 'game-project' && kind !== 'design-project') {
    throw new CloudShareError(`Unsupported share deliverable kind: ${kind}`, 400, 'CLOUD_SHARE_UNSUPPORTED');
  }
}

function assertValidProjectId(projectId: string): string {
  const trimmed = typeof projectId === 'string' ? projectId.trim() : '';
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/\0]/.test(trimmed) || trimmed.length > 200) {
    throw new CloudShareError('Invalid project identifier', 400, 'CLOUD_SHARE_INVALID_PROJECT_ID');
  }
  return trimmed;
}

function relativePosixPath(fromFilePath: string, targetFilePath: string): string {
  const dir = path.posix.dirname(fromFilePath);
  const rel = path.posix.relative(dir === '.' ? '' : dir, targetFilePath);
  return rel.startsWith('.') ? rel : `./${rel}`;
}

async function walkProjectFiles(
  rootDir: string,
  skipRelative: (relativePosix: string) => boolean,
): Promise<Array<{ path: string; data: Buffer }>> {
  const results: Array<{ path: string; data: Buffer }> = [];
  let totalBytes = 0;

  async function visit(currentDir: string, prefixPosix: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relPosix = prefixPosix ? `${prefixPosix}/${entry.name}` : entry.name;
      if (skipRelative(relPosix)) continue;
      const absPath = path.join(currentDir, entry.name);
      const info = await lstat(absPath);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await visit(absPath, relPosix);
        continue;
      }
      if (!info.isFile()) continue;
      if (results.length >= MAX_SHARE_FILES) {
        throw new CloudShareError(`Deliverable exceeds ${MAX_SHARE_FILES} files`, 413, 'CLOUD_SHARE_TOO_LARGE');
      }
      totalBytes += info.size;
      if (totalBytes > MAX_SHARE_BYTES) {
        throw new CloudShareError('Deliverable exceeds the 50 MiB cloud share limit', 413, 'CLOUD_SHARE_TOO_LARGE');
      }
      results.push({ path: relPosix, data: await readFile(absPath) });
    }
  }

  await visit(rootDir, '');
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

/**
 * Exclusive file staging matching OpenDesign's share-staging rules: refuses
 * path escapes and filesystem aliasing collisions inside a fresh temp folder.
 */
async function stageShareFiles(directory: string, files: readonly StagedShareFile[]): Promise<void> {
  const directories = new Map<string, string>();
  const checkedPaths = new Set<string>();
  for (const file of files) {
    const target = path.resolve(directory, file.file);
    const relative = path.relative(directory, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new CloudShareError('Share file escapes staging directory', 400, 'CLOUD_SHARE_INVALID_PATH');
    }
    const parts = relative.split(path.sep);
    let parent = directory;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      if (checkedPaths.has(parent)) continue;
      await mkdir(parent, { recursive: true });
      const identity = await stat(parent);
      const key = `${identity.dev}:${identity.ino}`;
      const previous = directories.get(key);
      if (previous !== undefined && previous !== parent) {
        throw new CloudShareError('Filesystem could not preserve distinct share paths', 500, 'CLOUD_SHARE_STAGING_FAILED');
      }
      directories.set(key, parent);
      checkedPaths.add(parent);
    }
    await writeFile(target, file.data, { flag: 'wx' });
  }
}

function parseJsonObject(stdout: string, errorMessage: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new CloudShareError(errorMessage, 502, 'CLOUD_SHARE_PUBLISH_FAILED');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CloudShareError(errorMessage, 502, 'CLOUD_SHARE_PUBLISH_FAILED');
  }
  return parsed as Record<string, unknown>;
}

const COMMENT_FILE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CommentFileFact {
  sourceFileId: string;
  sourceFilePath: string;
  entryPath: string;
  resourceId: string;
  versionId: string;
  retired: boolean;
}

interface CommentFileState {
  schemaVersion: 1;
  revision: number;
  files: CommentFileFact[];
}

function isSafeRelativeFilePath(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && !value.includes('\0')
    && !value.includes('\\')
    && !value.startsWith('/')
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function parseCommentFileState(value: unknown): CommentFileState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<CommentFileState>;
  if (candidate.schemaVersion !== 1 || !Number.isSafeInteger(candidate.revision) || (candidate.revision ?? -1) < 0 || !Array.isArray(candidate.files)) {
    return null;
  }
  const files: CommentFileFact[] = [];
  for (const item of candidate.files) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const fact = item as Partial<CommentFileFact>;
    if (
      typeof fact.sourceFileId !== 'string' || !COMMENT_FILE_UUID_RE.test(fact.sourceFileId)
      || !isSafeRelativeFilePath(fact.sourceFilePath)
      || !isSafeRelativeFilePath(fact.entryPath)
      || typeof fact.resourceId !== 'string' || !fact.resourceId.trim()
      || typeof fact.versionId !== 'string' || !fact.versionId.trim()
      || typeof fact.retired !== 'boolean'
    ) {
      return null;
    }
    files.push({
      sourceFileId: fact.sourceFileId,
      sourceFilePath: fact.sourceFilePath,
      entryPath: fact.entryPath,
      resourceId: fact.resourceId,
      versionId: fact.versionId,
      retired: fact.retired,
    });
  }
  return {
    schemaVersion: 1,
    revision: candidate.revision as number,
    files,
  };
}

function sanitizeShareDisplayName(title: string, fallbackEntryPath: string): string {
  const cleaned = title.replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (cleaned) return cleaned;
  const base = path.posix.basename(fallbackEntryPath).replace(/[\\/]+/g, ' ').trim().slice(0, 140);
  return base || 'index.html';
}

function commentFileSourceKey(cloudProjectId: string, sourceFileId: string): string {
  return `comment-file-v1:${Buffer.from(cloudProjectId, 'utf8').toString('base64url')}:${sourceFileId}`;
}

function publicFileResourceIdFor(
  workspaceId: string,
  ownerMemberId: string,
  cloudProjectId: string,
  entryPath: string,
): string {
  const encoded = Buffer.from(
    JSON.stringify([workspaceId, ownerMemberId, cloudProjectId, entryPath]),
    'utf8',
  ).toString('base64url');
  return `project-file-${encoded}`;
}

function overrideViewerUrl(cloudProjectId: string, slug: string): string | null {
  const origin = process.env.OM_CLOUD_SHARE_VIEWER_ORIGIN?.trim();
  if (!origin) return null;
  return verifiedAmrShareViewerUrl(
    new URL(buildCloudSharePath(cloudProjectId, slug), origin).href,
    cloudProjectId,
    slug,
  );
}

export class CloudShareService {
  readonly store: WorkspaceStore;
  readonly account: OpenDesignAccount;
  readonly root: string;
  private locks = new Map<string, Promise<unknown>>();

  constructor(store: WorkspaceStore, account: OpenDesignAccount) {
    this.store = store.workspaceStore ?? store;
    this.account = account;
    this.root = path.join(this.store.directory, 'cloud-shares');
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(key, current);
    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }

  private recordPath(kind: CloudShareKind, projectId: string): string {
    const safeKey = Buffer.from(`${kind}:${projectId}`, 'utf8').toString('base64url');
    return path.join(this.root, `${kind}__${safeKey}.json`);
  }

  private async readRecord(kind: CloudShareKind, projectId: string): Promise<PersistedCloudShareRecord | null> {
    try {
      const raw = await readFile(this.recordPath(kind, projectId), 'utf8');
      const parsed = JSON.parse(raw) as PersistedCloudShareRecord;
      return parsed && parsed.kind === kind && parsed.projectId === projectId ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async saveRecord(record: PersistedCloudShareRecord): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await atomicAssetJson(this.recordPath(record.kind, record.projectId), record);
  }

  async buildShareBundle(kind: CloudShareKind, rawProjectId: string): Promise<ShareBundle> {
    assertValidKind(kind);
    const projectId = assertValidProjectId(rawProjectId);

    let title = projectId;
    let entryPath = 'index.html';
    let multiplayer: boolean | undefined;
    let rawFiles: Array<{ path: string; data: Buffer }>;

    if (kind === 'game-project') {
      const games = gameProjectsFor(this.store.directory);
      let card;
      let located;
      try {
        card = await games.get(projectId);
        located = await games.locate(projectId);
      } catch (error) {
        if (error instanceof GameError) {
          throw new CloudShareError(error.message, error.status, error.status === 404 ? 'CLOUD_SHARE_NOT_FOUND' : 'CLOUD_SHARE_INVALID');
        }
        throw error;
      }
      if (card.external) {
        throw new CloudShareError('External community games cannot be deployed from OpenMotion.', 400, 'CLOUD_SHARE_UNSUPPORTED');
      }
      title = card.title || projectId;
      multiplayer = card.multiplayer;
      rawFiles = await walkProjectFiles(
        located.dir,
        rel => rel.toLowerCase() === 'game.json' || rel.toLowerCase().startsWith('trailer/'),
      );
      if (!rawFiles.some(f => f.path === 'index.html')) {
        throw new CloudShareError('Game project has no runnable index.html to deploy yet.', 400, 'CLOUD_SHARE_NOT_READY');
      }
    } else {
      const design = designProjectsFor(this.store.directory);
      let project;
      try {
        project = await design.get(projectId);
      } catch (error) {
        if (error instanceof DesignError) {
          throw new CloudShareError(
            error.message,
            error.status,
            error.status === 404 ? 'CLOUD_SHARE_NOT_FOUND' : 'CLOUD_SHARE_INVALID',
          );
        }
        throw error;
      }
      if (project.trashedAt) {
        throw new CloudShareError('Design project is in Trash and cannot be shared.', 400, 'CLOUD_SHARE_NOT_FOUND');
      }
      title = project.title || projectId;
      entryPath = project.entry || 'index.html';
      const rootDir = design.projectDir(projectId);
      rawFiles = await walkProjectFiles(rootDir, () => false);
      if (!rawFiles.some(f => f.path === entryPath)) {
        const fallbackHtml = rawFiles.find(f => /\.html?$/i.test(f.path));
        if (!fallbackHtml) {
          throw new CloudShareError('Design project has no HTML entry page to deploy.', 400, 'CLOUD_SHARE_NOT_READY');
        }
        entryPath = fallbackHtml.path;
      }
    }

    const assetLibrary = new AssetLibrary(this.store);
    const bundledAssets = new Map<string, StagedShareFile>();
    const knownPaths = new Set(rawFiles.map(f => f.path));
    let totalBytes = rawFiles.reduce((sum, f) => sum + f.data.length, 0);

    const resolveBundledAssetPath = async (assetId: string, versionId: string): Promise<string | null> => {
      const key = `${assetId}/${versionId}`;
      const existing = bundledAssets.get(key);
      if (existing) return existing.file;

      let resolved;
      try {
        resolved = await assetLibrary.resolve({ assetId, versionId });
      } catch {
        return null;
      }
      const bytes = await readFile(resolved.filename).catch(() => null);
      if (!bytes) return null;

      totalBytes += bytes.length;
      if (rawFiles.length + bundledAssets.size >= MAX_SHARE_FILES || totalBytes > MAX_SHARE_BYTES) {
        throw new CloudShareError('Bundled deliverable and media assets exceed the 50 MiB limit', 413, 'CLOUD_SHARE_TOO_LARGE');
      }

      const rawExt = path.extname(resolved.version.filename || '') || MIME_EXTENSIONS[resolved.version.mimeType || ''] || '';
      const safeExt = /^\.[A-Za-z0-9]{1,10}$/.test(rawExt) ? rawExt.toLowerCase() : '';
      let targetPath = `_shared-assets/${assetId}-${versionId}${safeExt}`;
      let collisionIndex = 1;
      while (knownPaths.has(targetPath)) {
        targetPath = `_shared-assets/${assetId}-${versionId}-${collisionIndex++}${safeExt}`;
      }
      knownPaths.add(targetPath);
      bundledAssets.set(key, { file: targetPath, data: bytes });
      return targetPath;
    };

    const stagedFiles: StagedShareFile[] = [];
    for (const file of rawFiles) {
      if (!REWRITABLE_TEXT_FILE.test(file.path)) {
        stagedFiles.push({ file: file.path, data: file.data });
        continue;
      }
      let text = file.data.toString('utf8');

      // Rewrite local OpenMotion generated media URLs (/motion-api/assets/<id>/versions/<vid>/media)
      // into bundled relative assets so shared previews remain completely self-contained.
      const assetMatches = [...text.matchAll(ASSET_MEDIA_REF)];
      if (assetMatches.length > 0) {
        const replacements = new Map<string, string>();
        for (const match of assetMatches) {
          const full = match[0];
          const assetId = match[1];
          const versionId = match[2];
          if (replacements.has(full)) continue;
          const bundledPath = await resolveBundledAssetPath(assetId, versionId);
          if (bundledPath) {
            replacements.set(full, relativePosixPath(file.path, bundledPath));
          }
        }
        if (replacements.size > 0) {
          text = text.replace(ASSET_MEDIA_REF, matched => replacements.get(matched) ?? matched);
        }
      }

      // Rewrite local app-origin URLs pointing back at files inside the same project.
      if (kind === 'game-project') {
        text = text.replace(GAME_PLAY_REF, (matched, rawGameId: string, relSuffix: string) => {
          try {
            if (decodeURIComponent(rawGameId) !== projectId) return matched;
          } catch {
            return matched;
          }
          const cleanTarget = relSuffix.replace(/[?#].*$/, '');
          const suffix = relSuffix.slice(cleanTarget.length);
          return `${relativePosixPath(file.path, cleanTarget)}${suffix}`;
        });
      } else {
        text = text.replace(DESIGN_RAW_REF, (matched, rawDesignId: string, relSuffix: string) => {
          try {
            if (decodeURIComponent(rawDesignId) !== projectId) return matched;
          } catch {
            return matched;
          }
          const cleanTarget = relSuffix.replace(/[?#].*$/, '');
          const suffix = relSuffix.slice(cleanTarget.length);
          return `${relativePosixPath(file.path, cleanTarget)}${suffix}`;
        });
      }

      const nextBuf = Buffer.from(text, 'utf8');
      totalBytes += nextBuf.length - file.data.length;
      stagedFiles.push({ file: file.path, data: nextBuf });
    }

    for (const bundled of bundledAssets.values()) {
      stagedFiles.push(bundled);
    }
    stagedFiles.sort((a, b) => a.file.localeCompare(b.file));

    const hash = createHash('sha256');
    for (const file of stagedFiles) {
      const digest = createHash('sha256').update(file.data).digest('hex');
      hash.update(`${file.file}:${digest}\n`);
    }

    return {
      kind,
      projectId,
      title,
      entryPath,
      ...(multiplayer !== undefined ? { multiplayer } : {}),
      files: stagedFiles,
      fileCount: stagedFiles.length,
      totalBytes,
      bundledAssetCount: bundledAssets.size,
      contentFingerprint: hash.digest('hex'),
    };
  }

  private toSnapshot(
    bundle: ShareBundle,
    summary: Awaited<ReturnType<OpenDesignAccount['summary']>>,
    record: PersistedCloudShareRecord | null,
  ): CloudShareSnapshot {
    const status: CloudShareStatus = record?.status ?? 'none';
    const freshness: CloudShareFreshness = status === 'none' || !record?.contentFingerprint
      ? 'unknown'
      : record.contentFingerprint === bundle.contentFingerprint
        ? 'fresh'
        : 'outdated';

    return {
      kind: bundle.kind,
      projectId: bundle.projectId,
      title: bundle.title,
      accountState: summary.state,
      ...(summary.user?.email ? { accountEmail: summary.user.email } : {}),
      ...(record?.workspaceName ? { workspaceName: record.workspaceName } : {}),
      status,
      url: status === 'none' ? null : (overrideViewerUrl(record!.cloudProjectId, record!.slug) ?? record!.url),
      ...(record?.slug ? { slug: record.slug } : {}),
      ...(record?.version !== undefined ? { version: record.version } : {}),
      ...(record?.publishedAt !== undefined ? { publishedAt: record.publishedAt } : {}),
      freshness,
      fileCount: bundle.fileCount,
      totalBytes: bundle.totalBytes,
      bundledAssetCount: bundle.bundledAssetCount,
      ...(bundle.multiplayer !== undefined ? { multiplayer: bundle.multiplayer } : {}),
      entryPath: bundle.entryPath,
    };
  }

  private async requirePrincipal(): Promise<{
    summary: Awaited<ReturnType<OpenDesignAccount['summary']>>;
    principal: OpenDesignWorkspacePrincipal;
  }> {
    const summary = await this.account.summary();
    if (summary.state === 'reauth-required') {
      throw new CloudShareError('OpenDesign account session expired. Sign in again to continue.', 401, 'ACCOUNT_REAUTH_REQUIRED');
    }
    if (summary.state !== 'signed-in') {
      throw new CloudShareError('Sign in with your OpenDesign account to deploy and share online.', 401, 'ACCOUNT_SIGN_IN_REQUIRED');
    }
    let principal: OpenDesignWorkspacePrincipal | null = null;
    try {
      principal = await this.account.workspacePrincipal();
    } catch (error) {
      if (error instanceof AccountRequestError && error.status === 401) {
        throw new CloudShareError('OpenDesign account session expired. Sign in again to continue.', 401, 'ACCOUNT_REAUTH_REQUIRED');
      }
      throw new CloudShareError(
        error instanceof Error ? error.message : 'Could not reach OpenDesign workspace directory.',
        502,
        'CLOUD_SHARE_WORKSPACE_UNAVAILABLE',
      );
    }
    if (!principal) {
      throw new CloudShareError('No active OpenDesign workspace was found for this account.', 400, 'CLOUD_SHARE_WORKSPACE_UNAVAILABLE');
    }
    return { summary, principal };
  }

  private mapCliError(error: unknown, fallbackCode: string, fallbackMessage: string): never {
    if (error instanceof CloudShareError) throw error;
    if (error instanceof AccountRequestError) {
      if (error.status === 401) {
        throw new CloudShareError('OpenDesign sign-in was rejected. Sign in again and retry.', 401, 'ACCOUNT_REAUTH_REQUIRED');
      }
      if (error.code === 'SHARE_GENERATION_MISMATCH') {
        throw new CloudShareError(
          'OpenDesign rejected the share generation because the published file metadata is out of sync. Retry publishing.',
          409,
          'SHARE_GENERATION_MISMATCH',
        );
      }
      const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 502;
      throw new CloudShareError(error.message || fallbackMessage, status, error.code || fallbackCode);
    }
    throw new CloudShareError(error instanceof Error ? error.message : fallbackMessage, 500, fallbackCode);
  }

  private async admitCommentFileReceipt(input: {
    workspaceId: string;
    ownerMemberId: string;
    cloudProjectId: string;
    fileResourceId: string;
    versionId: string;
    entryPath: string;
    sourceFileId: string;
  }): Promise<void> {
    const readCatalogRow = async () => {
      const row = parseJsonObject(
        await this.account.runInWorkspace(input.workspaceId, ['team-projects', 'get', input.cloudProjectId, '--json']),
        'OpenDesign project file authority is unavailable.',
      );
      const rootResourceId = typeof row.resourceId === 'string' ? row.resourceId.trim() : '';
      if (
        row.projectId !== input.cloudProjectId
        || row.workspaceId !== input.workspaceId
        || row.ownerMemberId !== input.ownerMemberId
        || !rootResourceId
      ) {
        throw new CloudShareError('OpenDesign project file authority is unavailable.', 502, 'CLOUD_SHARE_PUBLISH_FAILED');
      }
      const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
      const state = metadata._commentFiles === undefined
        ? { schemaVersion: 1 as const, revision: 0, files: [] }
        : parseCommentFileState(metadata._commentFiles);
      if (!state) {
        throw new CloudShareError('OpenDesign project file authority is unavailable.', 502, 'CLOUD_SHARE_PUBLISH_FAILED');
      }
      return { rootResourceId, metadata, state };
    };

    const matches = (state: CommentFileState) => state.files.some(fact =>
      fact.sourceFileId === input.sourceFileId
      && fact.sourceFilePath === input.entryPath
      && fact.entryPath === input.entryPath
      && fact.retired === false
      && fact.resourceId === input.fileResourceId
      && fact.versionId === input.versionId,
    );

    const { rootResourceId, metadata, state } = await readCatalogRow();
    if (matches(state)) return;

    const conflicting = state.files.some(fact =>
      fact.sourceFileId === input.sourceFileId && (fact.sourceFilePath !== input.entryPath || fact.retired),
    );
    if (conflicting) {
      throw new CloudShareError('OpenDesign file share identity conflict.', 409, 'CLOUD_SHARE_PUBLISH_FAILED');
    }

    const mutation = {
      schemaVersion: 1 as const,
      baseRevision: state.revision,
      resourceId: input.fileResourceId,
      versionId: input.versionId,
      files: [
        {
          sourceFileId: input.sourceFileId,
          sourceFilePath: input.entryPath,
          entryPath: input.entryPath,
          retired: false,
        },
      ],
    };

    let upsertError: unknown;
    try {
      await this.account.runInWorkspace(input.workspaceId, [
        'team-projects', 'upsert', input.cloudProjectId,
        '--resource-id', rootResourceId,
        '--metadata-json', JSON.stringify({ ...metadata, _commentFiles: mutation }),
      ]);
    } catch (error) {
      upsertError = error;
    }

    const { state: admitted } = await readCatalogRow();
    if (!matches(admitted)) {
      throw upsertError ?? new CloudShareError('OpenDesign did not admit the published file version.', 502, 'CLOUD_SHARE_PUBLISH_FAILED');
    }
  }

  async status(kind: CloudShareKind, projectId: string): Promise<CloudShareSnapshot> {
    const bundle = await this.buildShareBundle(kind, projectId);
    const [summary, record] = await Promise.all([
      this.account.summary(),
      this.readRecord(bundle.kind, bundle.projectId),
    ]);
    return this.toSnapshot(bundle, summary, record);
  }

  async publish(kind: CloudShareKind, rawProjectId: string): Promise<CloudShareSnapshot> {
    assertValidKind(kind);
    const projectId = assertValidProjectId(rawProjectId);
    return this.withLock(`${kind}:${projectId}`, async () => {
      const { summary, principal } = await this.requirePrincipal();
      const bundle = await this.buildShareBundle(kind, projectId);
      const existing = await this.readRecord(kind, projectId);
      const sameOwner = Boolean(
        existing
        && existing.workspaceId === principal.workspaceId
        && existing.ownerMemberId === principal.workspaceMemberId,
      );

      const cloudProjectId = cloudProjectIdForShare(kind, projectId);
      const slug = sameOwner ? existing!.slug : randomUUID();
      const sourceFileId = sameOwner ? existing!.sourceFileId : randomUUID();
      const sourceKey = sameOwner ? existing!.sourceKey : commentFileSourceKey(cloudProjectId, sourceFileId);
      const resourceId = sameOwner && existing!.entryPath === bundle.entryPath
        ? existing!.resourceId
        : publicFileResourceIdFor(principal.workspaceId, principal.workspaceMemberId, cloudProjectId, bundle.entryPath);

      // Save reservation before remote mutation so retries reuse the same slug/sourceKey.
      const baseRecord: PersistedCloudShareRecord = {
        kind,
        projectId,
        cloudProjectId,
        workspaceId: principal.workspaceId,
        ownerMemberId: principal.workspaceMemberId,
        workspaceName: principal.workspaceName,
        slug,
        sourceFileId,
        sourceKey,
        resourceId,
        entryPath: bundle.entryPath,
        status: sameOwner ? existing!.status : 'none',
        url: sameOwner ? existing!.url : null,
        version: sameOwner ? existing!.version : undefined,
        versionId: sameOwner ? existing!.versionId : undefined,
        publishedAt: sameOwner ? existing!.publishedAt : undefined,
        contentFingerprint: sameOwner ? existing!.contentFingerprint : undefined,
        updatedAt: Date.now(),
      };
      await this.saveRecord(baseRecord);

      let tempDir = '';
      try {
        const ensured = parseJsonObject(
          await this.account.runInWorkspace(principal.workspaceId, ['team-projects', 'ensure-private', cloudProjectId]),
          'OpenDesign could not register project for cloud sharing.',
        );
        if (ensured.projectId !== cloudProjectId || ensured.workspaceId !== principal.workspaceId) {
          throw new CloudShareError('OpenDesign workspace catalog returned mismatched project scope.', 502, 'CLOUD_SHARE_PUBLISH_FAILED');
        }

        const registered = parseJsonObject(
          await this.account.runInWorkspace(principal.workspaceId, ['team-projects', 'register-resource', cloudProjectId, resourceId]),
          'OpenDesign could not attach resource identity.',
        );
        if (registered.ok !== true) {
          throw new CloudShareError('OpenDesign did not confirm resource registration.', 502, 'CLOUD_SHARE_PUBLISH_FAILED');
        }

        tempDir = await mkdtemp(path.join(os.tmpdir(), 'om-cloud-share-'));
        await stageShareFiles(tempDir, bundle.files);

        const uploadKey = createHash('sha256')
          .update(JSON.stringify([principal.workspaceId, principal.workspaceMemberId, cloudProjectId, slug, bundle.contentFingerprint]))
          .digest('hex');

        const pushObj = parseJsonObject(
          await this.account.runInWorkspace(principal.workspaceId, [
            'resource', 'push',
            PUBLIC_FILE_RESOURCE_KIND,
            resourceId,
            tempDir,
            '--public-upload-key', uploadKey,
            '--metadata-json', JSON.stringify({
              source: 'openmotion',
              kind,
              projectId: cloudProjectId,
              fileName: bundle.entryPath,
            }),
            '--json',
          ]),
          'OpenDesign resource push returned an invalid response.',
        );
        const versionId = typeof pushObj.id === 'string' && pushObj.id.trim() ? pushObj.id.trim() : '';
        if (!versionId) {
          throw new CloudShareError('OpenDesign upload did not return an immutable version ID.', 502, 'CLOUD_SHARE_PUBLISH_FAILED');
        }

        await this.admitCommentFileReceipt({
          workspaceId: principal.workspaceId,
          ownerMemberId: principal.workspaceMemberId,
          cloudProjectId,
          fileResourceId: resourceId,
          versionId,
          entryPath: bundle.entryPath,
          sourceFileId,
        });

        if (baseRecord.status === 'stopped') {
          await this.account.runInWorkspace(principal.workspaceId, [
            'share', 'resume-existing', slug,
            '--project-id', cloudProjectId,
            '--source-file-path', bundle.entryPath,
            '--json',
          ]).catch(() => {});
        }

        const publishObj = parseJsonObject(
          await this.account.runInWorkspace(principal.workspaceId, [
            'share', 'publish', resourceId,
            '--project-id', cloudProjectId,
            '--source-file-path', bundle.entryPath,
            '--slug', slug,
            '--source-key', sourceKey,
            '--entry-path', bundle.entryPath,
            '--name', sanitizeShareDisplayName(bundle.title, bundle.entryPath),
            '--version-id', versionId,
            '--json',
          ]),
          'OpenDesign share publish returned an invalid response.',
        );

        const snapshot = publishObj.snapshot as Record<string, unknown> | undefined;
        const receipt = publishObj.receipt as Record<string, unknown> | undefined;
        const versionNum = publishObj.version;
        const publishedAtNum = publishObj.publishedAt;
        if (
          publishObj.status !== 'published'
          || publishObj.slug !== slug
          || publishObj.entryPath !== bundle.entryPath
          || typeof versionNum !== 'number' || !Number.isSafeInteger(versionNum) || versionNum < 1
          || typeof publishedAtNum !== 'number' || !Number.isSafeInteger(publishedAtNum) || publishedAtNum < 0
          || snapshot?.versionId !== versionId
          || receipt?.slug !== slug
          || receipt?.versionId !== versionId
          || receipt?.entryPath !== bundle.entryPath
          || receipt?.version !== versionNum
        ) {
          throw new CloudShareError('OpenDesign share publish receipt could not be verified.', 502, 'CLOUD_SHARE_PUBLISH_FAILED');
        }

        const verifiedUrl = verifiedAmrShareViewerUrl(publishObj.url, cloudProjectId, slug)
          ?? overrideViewerUrl(cloudProjectId, slug);
        if (!verifiedUrl) {
          throw new CloudShareError('OpenDesign share publish did not return a verified public URL.', 502, 'CLOUD_SHARE_PUBLISH_FAILED');
        }

        const completedRecord: PersistedCloudShareRecord = {
          ...baseRecord,
          status: 'active',
          url: verifiedUrl,
          version: versionNum,
          versionId,
          publishedAt: publishedAtNum,
          contentFingerprint: bundle.contentFingerprint,
          updatedAt: Date.now(),
        };
        await this.saveRecord(completedRecord);
        return this.toSnapshot(bundle, summary, completedRecord);
      } catch (error) {
        return this.mapCliError(error, 'CLOUD_SHARE_PUBLISH_FAILED', 'Cloud deployment failed.');
      } finally {
        if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  }

  async stop(kind: CloudShareKind, rawProjectId: string): Promise<CloudShareSnapshot> {
    assertValidKind(kind);
    const projectId = assertValidProjectId(rawProjectId);
    return this.withLock(`${kind}:${projectId}`, async () => {
      const { summary, principal } = await this.requirePrincipal();
      const bundle = await this.buildShareBundle(kind, projectId);
      const record = await this.readRecord(kind, projectId);
      if (!record || record.status === 'none') {
        throw new CloudShareError('No active cloud deployment exists for this project.', 404, 'CLOUD_SHARE_NOT_FOUND');
      }
      if (record.workspaceId !== principal.workspaceId || record.ownerMemberId !== principal.workspaceMemberId) {
        throw new CloudShareError('This share belongs to a different OpenDesign account or workspace.', 403, 'CLOUD_SHARE_FORBIDDEN');
      }
      if (record.status === 'stopped') {
        return this.toSnapshot(bundle, summary, record);
      }
      try {
        const stopped = parseJsonObject(
          await this.account.runInWorkspace(principal.workspaceId, [
            'share', 'stop', record.slug,
            '--project-id', record.cloudProjectId,
            '--json',
          ]),
          'OpenDesign could not disable the public link.',
        );
        if (stopped.status !== 'stopped' || stopped.slug !== record.slug) {
          throw new CloudShareError('OpenDesign did not confirm disabling the share link.', 502, 'CLOUD_SHARE_STOP_FAILED');
        }
        const nextRecord: PersistedCloudShareRecord = {
          ...record,
          status: 'stopped',
          updatedAt: Date.now(),
        };
        await this.saveRecord(nextRecord);
        return this.toSnapshot(bundle, summary, nextRecord);
      } catch (error) {
        return this.mapCliError(error, 'CLOUD_SHARE_STOP_FAILED', 'Could not disable the share link.');
      }
    });
  }

  async resume(kind: CloudShareKind, rawProjectId: string): Promise<CloudShareSnapshot> {
    assertValidKind(kind);
    const projectId = assertValidProjectId(rawProjectId);
    return this.withLock(`${kind}:${projectId}`, async () => {
      const { summary, principal } = await this.requirePrincipal();
      const bundle = await this.buildShareBundle(kind, projectId);
      const record = await this.readRecord(kind, projectId);
      if (!record || record.status === 'none') {
        throw new CloudShareError('No stopped cloud deployment exists to resume.', 404, 'CLOUD_SHARE_NOT_FOUND');
      }
      if (record.workspaceId !== principal.workspaceId || record.ownerMemberId !== principal.workspaceMemberId) {
        throw new CloudShareError('This share belongs to a different OpenDesign account or workspace.', 403, 'CLOUD_SHARE_FORBIDDEN');
      }
      if (record.status === 'active') {
        return this.toSnapshot(bundle, summary, record);
      }
      try {
        const resumed = parseJsonObject(
          await this.account.runInWorkspace(principal.workspaceId, [
            'share', 'resume-existing', record.slug,
            '--project-id', record.cloudProjectId,
            '--source-file-path', record.entryPath,
            '--json',
          ]),
          'OpenDesign could not reopen the public link.',
        );
        if (resumed.status !== 'active' || resumed.slug !== record.slug || resumed.projectId !== record.cloudProjectId) {
          throw new CloudShareError('OpenDesign did not confirm reopening the share link.', 502, 'CLOUD_SHARE_RESUME_FAILED');
        }
        const verifiedUrl = verifiedAmrShareViewerUrl(resumed.url, record.cloudProjectId, record.slug)
          ?? overrideViewerUrl(record.cloudProjectId, record.slug)
          ?? record.url;
        const nextRecord: PersistedCloudShareRecord = {
          ...record,
          status: 'active',
          url: verifiedUrl,
          ...(typeof resumed.version === 'number' ? { version: resumed.version } : {}),
          ...(typeof resumed.versionId === 'string' ? { versionId: resumed.versionId } : {}),
          ...(typeof resumed.publishedAt === 'number' ? { publishedAt: resumed.publishedAt } : {}),
          updatedAt: Date.now(),
        };
        await this.saveRecord(nextRecord);
        return this.toSnapshot(bundle, summary, nextRecord);
      } catch (error) {
        return this.mapCliError(error, 'CLOUD_SHARE_RESUME_FAILED', 'Could not reopen the share link.');
      }
    });
  }
}

const cloudShareServices = new WeakMap<OpenDesignAccount, Map<string, CloudShareService>>();

export function cloudShareFor(store: WorkspaceStore, account?: OpenDesignAccount): CloudShareService {
  const root = store.workspaceStore ?? store;
  const resolvedAccount = account ?? gatewayFor(root).account;
  let byDir = cloudShareServices.get(resolvedAccount);
  if (!byDir) {
    byDir = new Map();
    cloudShareServices.set(resolvedAccount, byDir);
  }
  const key = path.resolve(root.directory);
  let service = byDir.get(key);
  if (!service) {
    service = new CloudShareService(root, resolvedAccount);
    byDir.set(key, service);
  }
  return service;
}
