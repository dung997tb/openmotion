import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { isMain } from '../shared/entry.ts';
import { boundedMediaBody, downloadMedia, validateMediaLock } from '../shared/repository-media.ts';
import {
  lfsPointer,
  loadRepositoryCatalog,
  maxLfsAssetBytes,
  maxTemplateAssetBytes,
  readRepositoryFile,
} from '../shared/repository-template-catalog.ts';
import type { BlobMetadata, StoragePort } from '../src/contracts/storage.ts';
import { createDbHandle, type Database } from '../src/db/client.ts';
import { asInsert, asUpdate } from '../src/db/helpers.ts';
import {
  catalogTemplateFiles,
  catalogTemplates,
} from '../src/db/schema/blobs-assets.ts';
import { createLogger, type Logger } from '../src/infra/logger.ts';
import { StorageService, catalogBlobKey } from '../src/infra/storage.ts';
import { assembleBuiltinTemplate, BUILTIN_TEMPLATES } from '../src/services/builtin-template-source.ts';
import {
  extractCatalogFileMetadata, mimeTypeForPath, normalizeCatalogAssetPath, sha256Hex,
  type MediaMetadataHints, type PreparedCatalogFile, type PreparedCatalogTemplate,
} from '../src/services/catalog-template-source.ts';

export { assembleBuiltinTemplate } from '../src/services/builtin-template-source.ts';
export {
  extractCatalogFileMetadata, type MediaMetadataHints, type PreparedCatalogFile, type PreparedCatalogTemplate,
} from '../src/services/catalog-template-source.ts';

const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 32;

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export interface SyncCatalogOptions {
  dryRun?: boolean;
  limit?: number;
  builtinOnly?: boolean;
  repoOnly?: boolean;
  templateIds?: readonly string[];
  concurrency?: number;
  fetchRemote?: boolean;
  /** When true, fail the sync on transient remote network/HTTP errors instead of marking unavailable. */
  strictRemote?: boolean;
  repoRoot?: string;
  runtimeRoot?: string;
  catalogRoot?: string;
  fetchImpl?: typeof fetch;
}

export interface SyncCatalogDeps {
  db: Database;
  storage: StoragePort;
  logger?: Logger;
}

export interface SyncCatalogSummary {
  dryRun: boolean;
  templatesProcessed: number;
  builtinTemplatesProcessed: number;
  repositoryTemplatesProcessed: number;
  filesProcessed: number;
  uniqueBlobsSeen: number;
  blobsUploaded: number;
  blobsSkipped: number;
  blobsDeduplicated: number;
  unavailableFiles: number;
  templateIds: string[];
}

// ---------------------------------------------------------------------------
// CLI Argument Parser
// ---------------------------------------------------------------------------

export function parseSyncCatalogArgs(argv: readonly string[]): SyncCatalogOptions {
  const options: SyncCatalogOptions = {};
  const templateIds: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--builtin-only') {
      options.builtinOnly = true;
    } else if (arg === '--repo-only') {
      options.repoOnly = true;
    } else if (arg === '--fetch-remote') {
      options.fetchRemote = true;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const raw = arg.includes('=') ? arg.slice('--limit='.length) : argv[++i];
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid --limit value: ${String(raw)}`);
      }
      options.limit = parsed;
    } else if (arg === '--concurrency' || arg.startsWith('--concurrency=')) {
      const raw = arg.includes('=') ? arg.slice('--concurrency='.length) : argv[++i];
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_CONCURRENCY) {
        throw new Error(`Invalid --concurrency value (expected 1..${MAX_CONCURRENCY}): ${String(raw)}`);
      }
      options.concurrency = parsed;
    } else if (arg === '--template' || arg.startsWith('--template=')) {
      const raw = arg.includes('=') ? arg.slice('--template='.length) : argv[++i];
      if (!raw) throw new Error('Missing value for --template');
      for (const id of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
        templateIds.push(id);
      }
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (options.builtinOnly && options.repoOnly) {
    throw new Error('Cannot combine --builtin-only and --repo-only');
  }
  if (templateIds.length > 0) {
    options.templateIds = [...new Set(templateIds)];
  }
  return options;
}

// ---------------------------------------------------------------------------
// Repository Catalog Template Assembly (library/templates/catalog/)
// ---------------------------------------------------------------------------

type LoadedRepositoryCatalog = Awaited<ReturnType<typeof loadRepositoryCatalog>>;

interface RepoTemplateRecord {
  templateId: string;
  entry: {
    templateId: string;
    sortOrder?: number;
    featuredOrder?: number | null;
    files?: Array<{ path: string; bytes: number; sha256: string; mimeType?: string; url?: string }>;
    width?: number;
    height?: number;
    [key: string]: unknown;
  };
  locales: Record<string, unknown>;
  localMedia?: { preview?: string; poster?: string };
  remoteAssets?: Array<{
    url: string;
    bytes: number;
    sha256: string;
    source: { path: string; bytes: number; sha256: string };
  }>;
  sourceArchive?: { url: string; bytes: number; sha256: string };
}

interface RepoSourceManifest {
  canvas?: { width?: number; height?: number };
  fps?: number;
  durationSeconds?: number;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export class CatalogRemoteIntegrityError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CatalogRemoteIntegrityError';
  }
}

function isMediaIntegrityError(error: unknown): boolean {
  if (error instanceof CatalogRemoteIntegrityError) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return /Media size mismatch|Media SHA-256 mismatch|exceeds its declared size|hash\/length mismatch/i.test(msg);
}

async function fetchVerifiedCatalogRemoteBytes(
  url: string,
  expectedBytes: number,
  expectedSha256: string,
  filePath: string,
  fetchImpl: typeof fetch,
): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new CatalogRemoteIntegrityError(`Invalid remote catalog asset URL for ${filePath}`);
  }
  if (parsed.hostname === 'releases.open-design.ai') {
    const lock = { path: filePath, url, bytes: expectedBytes, sha256: expectedSha256 };
    try {
      validateMediaLock(lock);
    } catch (error) {
      throw new CatalogRemoteIntegrityError(
        `Invalid remote catalog media lock for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    try {
      return await downloadMedia(lock, fetchImpl);
    } catch (error) {
      if (isMediaIntegrityError(error)) {
        throw new CatalogRemoteIntegrityError(error instanceof Error ? error.message : String(error), { cause: error });
      }
      throw error;
    }
  }
  if (parsed.hostname === 'r.open-design.ai' && parsed.pathname === `/files/${expectedSha256}`) {
    const response = await fetchImpl(parsed, {
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    let bytes: Buffer;
    try {
      bytes = await boundedMediaBody(response, Math.min(expectedBytes, maxLfsAssetBytes));
    } catch (error) {
      if (isMediaIntegrityError(error)) {
        throw new CatalogRemoteIntegrityError(error instanceof Error ? error.message : String(error), { cause: error });
      }
      throw error;
    }
    if (bytes.byteLength !== expectedBytes || sha256Hex(bytes) !== expectedSha256) {
      throw new CatalogRemoteIntegrityError(`Downloaded asset hash/length mismatch for ${filePath}`);
    }
    return bytes;
  }
  throw new CatalogRemoteIntegrityError(`Unsupported remote catalog asset host for ${filePath}: ${parsed.hostname}`);
}

export async function assembleRepositoryTemplate(
  id: string,
  catalogRoot: string,
  repo: LoadedRepositoryCatalog,
  options: { fetchRemote?: boolean; deferRemoteFetch?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<PreparedCatalogTemplate> {
  const record = repo.records.get(id) as RepoTemplateRecord | undefined;
  if (!record) {
    throw new Error(`Repository template '${id}' not found in catalog.json`);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const manifestBytes = await readRepositoryFile(catalogRoot, `${id}/source/manifest.json`);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as RepoSourceManifest;

  let instructionsMd: string | null = null;
  try {
    instructionsMd = (await readRepositoryFile(catalogRoot, `${id}/TEMPLATE.md`)).toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  let motionMd: string | null = null;
  try {
    motionMd = (await readRepositoryFile(catalogRoot, `${id}/source/motion.md`)).toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const entryFiles = Array.isArray(record.entry.files) ? record.entry.files : [];
  const projectFilePaths = new Set(entryFiles.map((file) => file.path));
  const entryFilesByPath = new Map(entryFiles.map((file) => [file.path, file]));
  const remoteAssetsByPath = new Map(
    (record.remoteAssets ?? [])
      .filter((asset) => Boolean(asset.source?.path))
      .map((asset) => [asset.source.path, asset]),
  );

  const manifestFilesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const allPaths = new Set<string>(manifest.files.map((file) => file.path));
  for (const file of entryFiles) allPaths.add(file.path);
  if (record.localMedia?.poster) allPaths.add(record.localMedia.poster);
  if (record.localMedia?.preview) allPaths.add(record.localMedia.preview);

  const previewHints: MediaMetadataHints = {
    width: manifest.canvas?.width ?? record.entry.width,
    height: manifest.canvas?.height ?? record.entry.height,
    fps: manifest.fps,
    durationSec: manifest.durationSeconds,
  };

  const files: PreparedCatalogFile[] = [];

  // Include source/manifest.json itself as a non-project catalog file for guide/inspection routes.
  files.push({
    path: 'manifest.json',
    sha256: sha256Hex(manifestBytes),
    sizeBytes: manifestBytes.byteLength,
    mimeType: 'application/json; charset=utf-8',
    metadata: null,
    isProjectFile: false,
    isAvailable: true,
    bytes: manifestBytes,
  });

  for (const rawPath of [...allPaths].sort((a, b) => a.localeCompare(b))) {
    const normalizedPath = normalizeCatalogAssetPath(rawPath);
    const isProjectFile = projectFilePaths.has(normalizedPath);
    const manifestEntry = manifestFilesByPath.get(normalizedPath);
    const entryFile = entryFilesByPath.get(normalizedPath);
    const remoteAsset = remoteAssetsByPath.get(normalizedPath);
    const mimeType = entryFile?.mimeType || mimeTypeForPath(normalizedPath);
    const hints = record.localMedia?.preview === normalizedPath ? previewHints : undefined;

    let diskBytes: Buffer | null = null;
    try {
      diskBytes = await readRepositoryFile(catalogRoot, `${id}/source/${normalizedPath}`, maxTemplateAssetBytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    if (diskBytes !== null) {
      const pointer = lfsPointer(diskBytes);
      if (pointer) {
        const remoteUrl = remoteAsset?.url ?? entryFile?.url;
        let fetchedBytes: Buffer | null = null;
        if (options.fetchRemote && !options.deferRemoteFetch && remoteUrl) {
          fetchedBytes = await fetchVerifiedCatalogRemoteBytes(
            remoteUrl,
            pointer.bytes,
            pointer.sha256,
            normalizedPath,
            fetchImpl,
          );
        }
        files.push({
          path: normalizedPath,
          sha256: pointer.sha256,
          sizeBytes: pointer.bytes,
          mimeType,
          metadata: extractCatalogFileMetadata(normalizedPath, fetchedBytes, mimeType, hints),
          isProjectFile,
          isAvailable: fetchedBytes !== null,
          bytes: fetchedBytes,
          ...(fetchedBytes === null && remoteUrl ? { remoteUrl, metadataHints: hints } : {}),
        });
        continue;
      }

      const actualSha = sha256Hex(diskBytes);
      if (
        manifestEntry &&
        (manifestEntry.bytes !== diskBytes.byteLength || manifestEntry.sha256 !== actualSha)
      ) {
        throw new Error(
          `Template '${id}' file '${normalizedPath}' does not match source/manifest.json (expected ${manifestEntry.sha256}, got ${actualSha})`,
        );
      }

      files.push({
        path: normalizedPath,
        sha256: actualSha,
        sizeBytes: diskBytes.byteLength,
        mimeType,
        metadata: extractCatalogFileMetadata(normalizedPath, diskBytes, mimeType, hints),
        isProjectFile,
        isAvailable: true,
        bytes: diskBytes,
      });
      continue;
    }

    // File omitted from disk (e.g. transferred remoteAssets like preview.webm or large reference JPG).
    if (remoteAsset) {
      let fetchedBytes: Buffer | null = null;
      if (options.fetchRemote && !options.deferRemoteFetch) {
        fetchedBytes = await fetchVerifiedCatalogRemoteBytes(
          remoteAsset.url,
          remoteAsset.bytes,
          remoteAsset.sha256,
          normalizedPath,
          fetchImpl,
        );
      }
      files.push({
        path: normalizedPath,
        sha256: remoteAsset.sha256,
        sizeBytes: remoteAsset.bytes,
        mimeType,
        metadata: extractCatalogFileMetadata(normalizedPath, fetchedBytes, mimeType, hints),
        isProjectFile,
        isAvailable: fetchedBytes !== null,
        bytes: fetchedBytes,
        ...(fetchedBytes === null ? { remoteUrl: remoteAsset.url, metadataHints: hints } : {}),
      });
      continue;
    }

    // Fallback: declared in manifest/entry without local bytes.
    const fallbackSha = manifestEntry?.sha256 ?? entryFile?.sha256;
    const fallbackBytes = manifestEntry?.bytes ?? entryFile?.bytes ?? 0;
    if (fallbackSha) {
      files.push({
        path: normalizedPath,
        sha256: fallbackSha,
        sizeBytes: fallbackBytes,
        mimeType,
        metadata: extractCatalogFileMetadata(normalizedPath, null, mimeType, hints),
        isProjectFile,
        isAvailable: false,
        bytes: null,
      });
    }
  }

  // Collect brand logos across catalog publication locales so CatalogService resolves brandLogoUrl from PG.
  const brandLogoMap: Record<string, string> = {};
  for (const localeContent of Object.values(repo.publication.content)) {
    const brands = (localeContent as { brands?: Array<{ name: string; logoUrl: string }> }).brands;
    if (!Array.isArray(brands)) continue;
    for (const brand of brands) {
      if (brand.name && brand.logoUrl && !brandLogoMap[brand.name]) {
        brandLogoMap[brand.name] = brand.logoUrl;
      }
    }
  }

  return {
    id,
    kind: 'prism',
    catalogVersion: repo.version,
    sortOrder: typeof record.entry.sortOrder === 'number' ? record.entry.sortOrder : 0,
    featuredOrder: typeof record.entry.featuredOrder === 'number' ? record.entry.featuredOrder : null,
    hasHtmlProject: files.some((file) => file.isProjectFile && file.path === 'index.html'),
    metadata: {
      entry: record.entry,
      locales: record.locales,
      defaultLocale: repo.publication.defaultLocale,
      brands: brandLogoMap,
      localMedia: record.localMedia ?? null,
      remoteAssets: record.remoteAssets ?? [],
      sourceArchive: record.sourceArchive ?? null,
      canvas: manifest.canvas ?? null,
      fps: manifest.fps ?? null,
      durationSeconds: manifest.durationSeconds ?? null,
    },
    instructionsMd,
    motionMd,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// ---------------------------------------------------------------------------
// Bounded Concurrency Runner & Main Idempotent Sync Orchestrator
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let index = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

/**
 * Idempotently ingest built-in and repository catalog templates into:
 * - S3 `catalog/blobs/{sha256}` (skipping already-present keys via `headObject` + in-run SHA dedup)
 * - PostgreSQL `catalog_templates` and `catalog_template_files` (atomic per-template tx)
 */
export async function syncCatalogCas(
  deps: SyncCatalogDeps,
  options: SyncCatalogOptions = {},
): Promise<SyncCatalogSummary> {
  const dryRun = options.dryRun === true;
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, options.concurrency ?? DEFAULT_CONCURRENCY));
  const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const runtimeRoot = path.resolve(options.runtimeRoot ?? repoRoot);
  const catalogRoot = path.resolve(options.catalogRoot ?? path.join(repoRoot, 'library/templates/catalog'));
  const includeBuiltin = !options.repoOnly;
  const includeRepo = !options.builtinOnly;
  const filterIds = options.templateIds ? new Set(options.templateIds) : null;
  const maxTemplates = options.limit ?? Number.POSITIVE_INFINITY;
  const logger = deps.logger;

  const prepared: PreparedCatalogTemplate[] = [];
  let builtinCount = 0;
  let repoCount = 0;

  // Phase 1: Built-in templates (`template-library/*`)
  if (includeBuiltin) {
    for (const def of BUILTIN_TEMPLATES) {
      if (prepared.length >= maxTemplates) break;
      if (filterIds && !filterIds.has(def.id)) continue;
      const item = await assembleBuiltinTemplate(def, repoRoot, runtimeRoot);
      prepared.push(item);
      builtinCount++;
    }
  }

  // Phase 2: Repository catalog templates (`library/templates/catalog/`)
  const fetchImpl = options.fetchImpl ?? fetch;
  if (includeRepo && prepared.length < maxTemplates) {
    const repo = await loadRepositoryCatalog(catalogRoot);
    const allRepoIds = [...repo.records.keys()];
    for (const id of allRepoIds) {
      if (prepared.length >= maxTemplates) break;
      if (filterIds && !filterIds.has(id)) continue;
      const item = await assembleRepositoryTemplate(id, catalogRoot, repo, {
        fetchRemote: options.fetchRemote,
        deferRemoteFetch: Boolean(options.fetchRemote),
        fetchImpl,
      });
      prepared.push(item);
      repoCount++;
    }
  }

  // Deduplicate blobs across all selected templates and upload missing ones with bounded concurrency.
  const uploadedShas = new Set<string>();
  const hydratedMetadataBySha = new Map<string, BlobMetadata>();
  const inFlightUploads = new Map<string, Promise<void>>();
  let filesProcessed = 0;
  let blobsUploaded = 0;
  let blobsSkipped = 0;
  let blobsDeduplicated = 0;
  let unavailableFiles = 0;

  const isImageMissingDimensions = (file: PreparedCatalogFile): boolean => {
    const baseMime = file.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
    return baseMime.startsWith('image/') && (!file.metadata?.width || !file.metadata?.height);
  };

  const applyPersistedOrHydratedMetadata = async (
    file: PreparedCatalogFile,
    existingMetadataByKey: ReadonlyMap<string, BlobMetadata>,
    key: string,
  ): Promise<void> => {
    if (file.bytes !== null) return;
    const saved = existingMetadataByKey.get(`${file.path}\0${file.sha256}`) ?? hydratedMetadataBySha.get(file.sha256);
    if (saved) {
      file.metadata = file.metadata ? { ...file.metadata, ...saved } : { ...saved };
    }
    if (isImageMissingDimensions(file)) {
      try {
        const s3Bytes = await deps.storage.getObjectBuffer(key, maxTemplateAssetBytes);
        const extracted = extractCatalogFileMetadata(file.path, s3Bytes, file.mimeType, file.metadataHints);
        if (extracted) {
          file.metadata = extracted;
          hydratedMetadataBySha.set(file.sha256, extracted);
        }
      } catch {
        // Keep best-effort metadata if reading dimensions back from S3 is unavailable.
      }
    }
  };

  const ensureBlobInS3 = async (
    file: PreparedCatalogFile,
    existingMetadataByKey: ReadonlyMap<string, BlobMetadata>,
  ): Promise<void> => {
    const canFetchRemote = Boolean(options.fetchRemote && !file.isAvailable && file.bytes === null && file.remoteUrl);
    if ((!file.isAvailable || file.bytes === null) && !canFetchRemote) {
      unavailableFiles++;
      return;
    }

    const key = catalogBlobKey(file.sha256);
    if (uploadedShas.has(file.sha256)) {
      await applyPersistedOrHydratedMetadata(file, existingMetadataByKey, key);
      file.isAvailable = true;
      blobsDeduplicated++;
      return;
    }

    const existingFlight = inFlightUploads.get(file.sha256);
    if (existingFlight) {
      await existingFlight;
      if (uploadedShas.has(file.sha256)) {
        await applyPersistedOrHydratedMetadata(file, existingMetadataByKey, key);
        file.isAvailable = true;
        blobsDeduplicated++;
      } else {
        unavailableFiles++;
      }
      return;
    }

    const task = (async () => {
      const existing = await deps.storage.headObject(key);
      if (existing && existing.contentLength === file.sizeBytes) {
        await applyPersistedOrHydratedMetadata(file, existingMetadataByKey, key);
        blobsSkipped++;
        file.isAvailable = true;
        uploadedShas.add(file.sha256);
        return;
      }

      let bytes = file.bytes;
      if (bytes === null && canFetchRemote && file.remoteUrl) {
        try {
          bytes = await fetchVerifiedCatalogRemoteBytes(
            file.remoteUrl,
            file.sizeBytes,
            file.sha256,
            file.path,
            fetchImpl,
          );
          file.bytes = bytes;
          file.metadata = extractCatalogFileMetadata(file.path, bytes, file.mimeType, file.metadataHints);
          if (file.metadata) {
            hydratedMetadataBySha.set(file.sha256, file.metadata);
          }
        } catch (error) {
          if (error instanceof CatalogRemoteIntegrityError || options.strictRemote) {
            throw error;
          }
          logger?.warn('Catalog remote asset fetch unavailable; marking file unavailable', {
            path: file.path,
            sha256: file.sha256,
            error: error instanceof Error ? error.message : String(error),
          });
          unavailableFiles++;
          return;
        }
      }

      if (bytes === null) {
        unavailableFiles++;
        return;
      }

      if (!dryRun) {
        await deps.storage.putObject(key, bytes, file.mimeType, bytes.byteLength);
        blobsUploaded++;
      }
      if (file.metadata) {
        hydratedMetadataBySha.set(file.sha256, file.metadata);
      }
      file.isAvailable = true;
      uploadedShas.add(file.sha256);
    })();

    inFlightUploads.set(file.sha256, task);
    try {
      await task;
    } finally {
      inFlightUploads.delete(file.sha256);
    }
  };

  for (const template of prepared) {
    filesProcessed += template.files.length;
    const existingMetadataByKey = new Map<string, BlobMetadata>();
    if (!dryRun && template.files.some((file) => file.bytes === null)) {
      const existingRows = await deps.db
        .select({
          path: catalogTemplateFiles.path,
          sha256: catalogTemplateFiles.sha256,
          metadata: catalogTemplateFiles.metadata,
        })
        .from(catalogTemplateFiles)
        .where(eq(catalogTemplateFiles.templateId, template.id));
      for (const row of existingRows) {
        if (row.metadata && typeof row.metadata === 'object') {
          existingMetadataByKey.set(`${row.path}\0${row.sha256}`, row.metadata as BlobMetadata);
        }
      }
    }
    await runWithConcurrency(template.files, concurrency, (file) => ensureBlobInS3(file, existingMetadataByKey));

    if (!dryRun) {
      const now = new Date();
      await deps.db.transaction(async (tx) => {
        await tx
          .insert(catalogTemplates)
          .values(
            asInsert(catalogTemplates, {
              id: template.id,
              kind: template.kind,
              catalogVersion: template.catalogVersion,
              sortOrder: template.sortOrder,
              featuredOrder: template.featuredOrder,
              hasHtmlProject: template.hasHtmlProject,
              metadata: template.metadata,
              instructionsMd: template.instructionsMd,
              motionMd: template.motionMd,
              updatedAt: now,
            }),
          )
          .onConflictDoUpdate({
            target: catalogTemplates.id,
            set: asUpdate(catalogTemplates, {
              kind: template.kind,
              catalogVersion: template.catalogVersion,
              sortOrder: template.sortOrder,
              featuredOrder: template.featuredOrder,
              hasHtmlProject: template.hasHtmlProject,
              metadata: template.metadata,
              instructionsMd: template.instructionsMd,
              motionMd: template.motionMd,
              updatedAt: now,
            }),
          });

        await tx
          .delete(catalogTemplateFiles)
          .where(eq(catalogTemplateFiles.templateId, template.id));

        if (template.files.length > 0) {
          await tx.insert(catalogTemplateFiles).values(
            template.files.map((file) =>
              asInsert(catalogTemplateFiles, {
                templateId: template.id,
                path: file.path,
                sha256: file.sha256,
                sizeBytes: file.sizeBytes,
                mimeType: file.mimeType,
                metadata: file.metadata,
                isProjectFile: file.isProjectFile,
                isAvailable: file.isAvailable,
              }),
            ),
          );
        }
      });
    }
  }

  const summary: SyncCatalogSummary = {
    dryRun,
    templatesProcessed: prepared.length,
    builtinTemplatesProcessed: builtinCount,
    repositoryTemplatesProcessed: repoCount,
    filesProcessed,
    uniqueBlobsSeen: uploadedShas.size,
    blobsUploaded,
    blobsSkipped,
    blobsDeduplicated,
    unavailableFiles,
    templateIds: prepared.map((item) => item.id),
  };

  logger?.info('Catalog CAS sync complete', { ...summary });
  return summary;
}

// ---------------------------------------------------------------------------
// Standalone CLI Runner (`node --experimental-strip-types scripts/sync-catalog-cas.ts`)
// ---------------------------------------------------------------------------

export async function runSyncCatalogCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<SyncCatalogSummary> {
  const logger = createLogger({ bindings: { service: 'catalog-sync' } });
  const options = parseSyncCatalogArgs(argv);
  if (options.fetchRemote === undefined && envBoolean(env.CATALOG_SYNC_FETCH_REMOTE, false)) {
    options.fetchRemote = true;
  }
  if (options.strictRemote === undefined && envBoolean(env.CATALOG_SYNC_STRICT_REMOTE, false)) {
    options.strictRemote = true;
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to sync catalog templates to PostgreSQL.');
  }

  const storage = new StorageService({
    bucket: env.S3_BUCKET?.trim() || 'openmotion',
    region: env.S3_REGION?.trim() || 'us-east-1',
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT?.trim() || undefined,
    accessKeyId: env.S3_ACCESS_KEY_ID?.trim() || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY?.trim() || undefined,
    forcePathStyle: envBoolean(env.S3_FORCE_PATH_STYLE, true),
    publicOrigin: env.APP_PUBLIC_ORIGIN?.trim() || 'http://127.0.0.1:4173',
  });

  const dbHandle = createDbHandle({
    connectionString: databaseUrl,
    max: 4,
    allowExitOnIdle: true,
  });

  try {
    return await syncCatalogCas({ db: dbHandle.db, storage, logger }, options);
  } finally {
    storage.close();
    await dbHandle.close();
  }
}

if (isMain(import.meta.url)) {
  runSyncCatalogCli().catch((error) => {
    const logger = createLogger({ bindings: { service: 'catalog-sync' } });
    logger.error('Catalog CAS sync failed', { error });
    process.exitCode = 1;
  });
}
