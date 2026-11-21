import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import {
  hasMinRole,
  hasScope,
  type AuthContext,
} from '../contracts/auth.ts';
import { CloudError } from '../contracts/errors.ts';
import type { BlobMetadata, StoragePort } from '../contracts/storage.ts';
import type { Database, DbExecutor } from '../db/client.ts';
import { asInsert, asUpdate } from '../db/helpers.ts';
import { workspaces } from '../db/schema/auth.ts';
import {
  catalogTemplateFiles,
  catalogTemplates,
  type CatalogTemplateKind,
} from '../db/schema/blobs-assets.ts';
import {
  projectFiles,
  projectHistoryEntries,
  projectVersionFiles,
  projectVersions,
} from '../db/schema/project-files.ts';
import { projectGrants, projects, sessions } from '../db/schema/projects.ts';
import type { Logger } from '../infra/logger.ts';
import type { HotTextCache } from '../infra/redis.ts';
import { catalogBlobKey } from '../infra/storage.ts';
import {
  isEditableTemplate,
  templatePage,
  templateWorkflow,
  type GalleryTemplate,
  type TemplatePage,
} from '../../shared/catalog.ts';
import {
  computeProjectRevision,
  isSha256Hex,
  isTextProjectPath,
  isUuid,
  projectPath,
  validateProjectTitle,
  validateStableRequestId,
} from '../../shared/project-validation.ts';
import {
  authoredTemplateGuide,
  compactNativeGuideStage,
  upgradeTemplateGuidePage,
} from '../../shared/template-guide.ts';
import { catalogLocale } from '../../shared/template-locale.ts';

// ---------------------------------------------------------------------------
// Canonical Built-in Template & Welcome Definitions (Zero Legacy FS Coupling)
// ---------------------------------------------------------------------------

export const WELCOME_TEMPLATE_ID = 'openmotion-welcome';
export const WELCOME_PROJECT_TITLE = 'OpenMotion 示例短片';
export const WELCOME_PROJECT_TITLE_KEY = 'OpenMotion Sample Video' as const;
export const GSAP_CDN_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';

export const NATIVE_PROJECT_CONFIG = {
  $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
  paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
} as const;

export const WELCOME_SHARED_ASSETS: readonly (readonly [string, string])[] = [
  ['packages/design-system/brand/loading-mark.svg', 'assets/brand-mark.svg'],
  ['packages/design-system/fonts/AlbertSans-VariableFont_wght.ttf', 'assets/fonts/AlbertSans.ttf'],
  ['packages/design-system/fonts/Albert-Sans-OFL.txt', 'assets/fonts/Albert-Sans-OFL.txt'],
  ['packages/design-system/opendesign-logo-SOURCE.md', 'assets/brand-NOTICE.md'],
  ['library/skills/openmotion-design-remix/vendor/fonts/libre-baskerville-f5bc4341f15d.ttf', 'assets/fonts/serif.ttf'],
  ['library/skills/openmotion-design-remix/vendor/fonts/libre-baskerville-OFL.txt', 'assets/fonts/Libre-Baskerville-OFL.txt'],
  ['library/skills/openmotion-design-remix/vendor/three-0.147.0/build/three.min.js', 'assets/three.min.js'],
  ['library/skills/openmotion-design-remix/vendor/three-0.147.0/LICENSE', 'assets/three-LICENSE.txt'],
] as const;

export interface BuiltinTemplateDefinition {
  readonly id: string;
  readonly sortOrder: number;
  readonly title: string;
  readonly label: string;
  readonly description: string;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly posterTime: number;
  readonly author: string;
  readonly sourceUrl: string;
}

/**
 * Built-in templates ordered with `openmotion-welcome` first so even `--limit 1`
 * sync runs always ingest the welcome template required by workspace bootstrap.
 */
export const BUILTIN_TEMPLATES: readonly BuiltinTemplateDefinition[] = [
  {
    id: WELCOME_TEMPLATE_ID,
    sortOrder: 0,
    title: 'OpenMotion Welcome',
    label: 'Official welcome',
    description:
      'An editable brand welcome with kinetic typography, a motion gallery and a three-dimensional closing mark.',
    duration: 37.3,
    width: 1920,
    height: 1080,
    posterTime: 3.8,
    author: 'OpenMotion',
    sourceUrl: 'https://github.com/nexu-io/openmotion/tree/main/template-library/openmotion-welcome',
  },
  {
    id: 'product-promo',
    sortOrder: 1,
    title: 'Product Promo',
    label: '产品宣传',
    description: '从图标开场到多人协作，查看多场景动画与字幕编排。',
    duration: 20,
    width: 1920,
    height: 1080,
    posterTime: 7,
    author: 'Hyperframes',
    sourceUrl:
      'https://github.com/heygen-com/hyperframes/tree/3baf81f9a92615507f76fe8de33e489034ee77ec/registry/examples/product-promo',
  },
  {
    id: 'nyt-graph',
    sortOrder: 2,
    title: 'NYT Graph',
    label: '数据叙事',
    description: '报刊风格的动态图表，查看数据、标注与图形的节奏。',
    duration: 15,
    width: 1920,
    height: 1080,
    posterTime: 9,
    author: 'Hyperframes',
    sourceUrl:
      'https://github.com/heygen-com/hyperframes/tree/3baf81f9a92615507f76fe8de33e489034ee77ec/registry/examples/nyt-graph',
  },
  {
    id: 'decision-tree',
    sortOrder: 3,
    title: 'Decision Tree',
    label: '流程动画',
    description: '逐步展开的决策树，查看节点、连线与分支动画。',
    duration: 10,
    width: 1920,
    height: 1080,
    posterTime: 7,
    author: 'Hyperframes',
    sourceUrl:
      'https://github.com/heygen-com/hyperframes/tree/3baf81f9a92615507f76fe8de33e489034ee77ec/registry/examples/decision-tree',
  },
] as const;

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const DEFAULT_PRESIGN_GET_TTL_SEC = 300;
const REDIRECT_CACHE_CONTROL = 'private, max-age=60';
const REDIRECT_VARY = 'Origin, Cookie';

export function mimeTypeForPath(filePath: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function validateTemplateId(value: string): string {
  if (typeof value !== 'string' || !TEMPLATE_ID_REGEX.test(value)) {
    throw new CloudError('INVALID_ARGUMENT', 'Invalid template ID', { status: 400, applied: false });
  }
  return value;
}

export function normalizeCatalogAssetPath(rawPath: string): string {
  if (
    typeof rawPath !== 'string' ||
    !rawPath ||
    rawPath.length > 240 ||
    rawPath.startsWith('/') ||
    rawPath.includes('\\') ||
    rawPath.includes(':') ||
    /[\x00-\x1f]/.test(rawPath)
  ) {
    throw new CloudError('INVALID_PATH', 'Invalid catalog asset path', { status: 400, applied: false });
  }
  const parts = rawPath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new CloudError('INVALID_PATH', 'Catalog asset path contains invalid segments or traversal', {
      status: 400,
      applied: false,
    });
  }
  return rawPath;
}

export function formatStrongShaEtag(sha256: string): string {
  return `"sha256:${sha256}"`;
}

function splitTags(value = ''): string[] {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function buildTemplateRecipe(template: GalleryTemplate): string {
  const workflow = templateWorkflow(template);
  const editable = isEditableTemplate(template);
  const lines = [
    `## ${workflow === 'recreate' ? 'Recreate reference' : 'Use template'} "${template.title}"`,
    '',
    `- Template ID: ${template.id}`,
    `- Collection: ${template.collection}`,
    `- Author: ${template.author || 'OpenMotion'}`,
    `- Duration: ${template.duration === undefined ? 'Inspect media or source' : `${template.duration}s`}`,
    ...(template.ratio ? [`- Aspect ratio: ${template.ratio}`] : []),
    `- Summary: ${template.description || template.subtitle}`,
    ...(template.previewUrl ? [`- Preview URL: ${template.previewUrl}`] : []),
    ...(template.posterUrl ? [`- Poster URL: ${template.posterUrl}`] : []),
    ...(template.sourceUrl ? [`- Source URL: ${template.sourceUrl}`] : []),
    '',
    editable
      ? 'Clone this template into an editable workspace project using openmotion_create_project with projectType=template and the templateId above.'
      : 'Study the motion guide and reference media, then author an editable Hyperframes project in your workspace.',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public Port & DTO Contracts
// ---------------------------------------------------------------------------

export interface CatalogListOptions {
  category?: string;
  query?: string;
  offset?: number;
  limit?: number;
  grouped?: boolean;
  covered?: boolean;
  locale?: string;
  kind?: CatalogTemplateKind;
}

export interface CatalogListResult extends TemplatePage {
  source: 'catalog-cas';
}

export interface CatalogFileSummary {
  path: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  metadata: BlobMetadata | null;
  isProjectFile: boolean;
  isAvailable: boolean;
}

export interface CatalogTemplateDetail extends GalleryTemplate {
  catalogVersion: string;
  instructions: string;
  motionDocument?: { path: string; content: string };
  workflowGuide: { workflow: 'template' | 'recreate'; section: 'start'; status: 'ready' };
  files: CatalogFileSummary[];
}

export interface CatalogAssetHead {
  templateId: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  etag: string;
  metadata: BlobMetadata | null;
  isAvailable: boolean;
}

export type ResolvedCatalogAsset =
  | {
      kind: 'redirect';
      location: string;
      sha256?: string;
      sizeBytes?: number;
      mimeType: string;
      etag?: string;
      metadata: BlobMetadata | null;
      cacheControl: string;
      vary: string;
    }
  | {
      kind: 'inline';
      body: Buffer;
      sha256: string;
      sizeBytes: number;
      mimeType: string;
      etag: string;
      metadata: BlobMetadata | null;
      cacheControl: string;
      vary: string;
      contentDisposition?: string;
    };

export interface ResolveSourceAssetOptions {
  raw?: boolean;
  stage?: boolean;
  download?: boolean;
  forceRedirect?: boolean;
  locale?: string;
  presignTtlSec?: number;
}

export interface CloneTemplateOptions {
  templateId: string;
  title?: string;
  titleKey?: 'OpenMotion Sample Video' | null;
  sessionId?: string;
  requirements?: string;
  namingLanguage?: string;
  requestId?: string;
  locale?: string;
  activateWorkspace?: boolean;
  /** Optional open transaction (used by WelcomeBootstrapService inside its FOR UPDATE tx). */
  tx?: DbExecutor;
  /** Internal flag ONLY for system workspace bootstrap (never exposed over HTTP). */
  internalSystemBootstrap?: boolean;
}

export interface ClonedProjectFile {
  path: string;
  blobScope: 'catalog';
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  isText: boolean;
}

export interface CloneTemplateResult {
  projectId: string;
  sessionId: string;
  artifactId: string;
  title: string;
  titleKey: string | null;
  templateId: string;
  projectType: 'template';
  revision: string;
  versionId: string;
  versionNumber: number;
  historySeq: number;
  fileCount: number;
  files: ClonedProjectFile[];
}

export interface CatalogPort {
  listTemplates(options?: CatalogListOptions): Promise<CatalogListResult>;
  listBuiltinTemplates(locale?: string): Promise<GalleryTemplate[]>;
  getTemplate(templateId: string, options?: { locale?: string }): Promise<CatalogTemplateDetail>;
  headPosterAsset(templateId: string): Promise<CatalogAssetHead>;
  resolvePosterAsset(templateId: string, options?: { presignTtlSec?: number }): Promise<ResolvedCatalogAsset>;
  headPreviewAsset(templateId: string): Promise<CatalogAssetHead>;
  resolvePreviewAsset(templateId: string, options?: { presignTtlSec?: number }): Promise<ResolvedCatalogAsset>;
  headTemplateAsset(templateId: string, assetPath: string): Promise<CatalogAssetHead>;
  resolveSourceAsset(
    templateId: string,
    assetPath: string,
    options?: ResolveSourceAssetOptions,
  ): Promise<ResolvedCatalogAsset>;
  cloneTemplateToProject(ctx: AuthContext, options: CloneTemplateOptions): Promise<CloneTemplateResult>;
  instantiateTemplateToProject(ctx: AuthContext, options: CloneTemplateOptions): Promise<CloneTemplateResult>;
}

// ---------------------------------------------------------------------------
// Metadata Projection Helpers
// ---------------------------------------------------------------------------

interface StoredRemoteAsset {
  url?: string;
  bytes?: number;
  sha256?: string;
  source?: { path?: string; bytes?: number; sha256?: string };
}

interface StoredPrismLocalePayload {
  original?: Record<string, string>;
  conversionNotes?: string;
  motionDocumentUrl?: string;
  motionGuideUrl?: string;
}

interface StoredCatalogMetadata {
  // Built-in fields
  title?: string;
  label?: string;
  subtitle?: string;
  description?: string;
  author?: string;
  collection?: GalleryTemplate['collection'];
  tags?: string[];
  duration?: number;
  width?: number;
  height?: number;
  ratio?: string;
  posterTime?: number;
  sourceUrl?: string;
  posterPath?: string;
  previewPath?: string;

  // Repository (prism) fields
  defaultLocale?: string;
  entry?: {
    templateId?: string;
    sortOrder?: number;
    featuredOrder?: number | null;
    original?: Record<string, string>;
    previewUrl?: string | null;
    coverUrl?: string | null;
    motionDocumentUrl?: string | null;
    motionGuideUrl?: string | null;
    projectFileUrl?: string | null;
    authorAvatarUrl?: string;
    brand?: string;
    colors?: string[];
    industries?: string[];
    creationModels?: string[];
    width?: number;
    height?: number;
    conversionStatus?: string;
    conversionNotes?: string;
    files?: Array<{ path: string; sha256?: string; bytes?: number; mimeType?: string; url?: string }>;
  };
  locales?: Record<string, StoredPrismLocalePayload>;
  brands?: Record<string, string>;
  localMedia?: { preview?: string; poster?: string } | null;
  remoteAssets?: StoredRemoteAsset[];
}

type CatalogTemplateRow = typeof catalogTemplates.$inferSelect;
type CatalogTemplateFileRow = typeof catalogTemplateFiles.$inferSelect;

function projectRowToGalleryTemplate(
  row: CatalogTemplateRow,
  requestedLocale = 'en',
): GalleryTemplate {
  const meta = (row.metadata ?? {}) as StoredCatalogMetadata;

  if (row.kind === 'builtin') {
    const label = meta.label ?? 'Official';
    const author = meta.author ?? 'OpenMotion';
    return {
      id: row.id,
      title: meta.title ?? row.id,
      subtitle: meta.subtitle ?? `${label} · ${author}`,
      description: meta.description ?? '',
      collection: 'builtin',
      kind: 'builtin',
      tags: Array.isArray(meta.tags) && meta.tags.length > 0 ? meta.tags : [label],
      duration: typeof meta.duration === 'number' ? meta.duration : undefined,
      ratio: meta.ratio ?? '16:9',
      width: typeof meta.width === 'number' ? meta.width : undefined,
      height: typeof meta.height === 'number' ? meta.height : undefined,
      posterUrl: `/api/templates/${encodeURIComponent(row.id)}/poster`,
      sourceUrl: typeof meta.sourceUrl === 'string' ? meta.sourceUrl : undefined,
      author,
      sortOrder: row.sortOrder,
      featuredOrder: row.featuredOrder ?? null,
      hasHtmlProject: row.hasHtmlProject,
    };
  }

  const entry = meta.entry ?? {};
  const locales = meta.locales ?? {};
  const localeKeys = Object.keys(locales);
  const defaultLocale = meta.defaultLocale ?? 'zh-CN';
  const resolvedLocale =
    localeKeys.length > 0 ? catalogLocale(localeKeys, requestedLocale, defaultLocale) : defaultLocale;
  const localized = locales[resolvedLocale];
  const original: Record<string, string> = {
    ...(entry.original ?? {}),
    ...(localized?.original ?? {}),
  };

  const localMedia = meta.localMedia ?? null;
  const posterUrl = localMedia?.poster
    ? `/api/templates/${encodeURIComponent(row.id)}/poster`
    : typeof entry.coverUrl === 'string' && entry.coverUrl
      ? entry.coverUrl
      : undefined;
  const previewUrl = localMedia?.preview
    ? `/api/templates/${encodeURIComponent(row.id)}/preview`
    : typeof entry.previewUrl === 'string' && entry.previewUrl
      ? entry.previewUrl
      : undefined;

  const tags = [original.promotionalUseCases, original.visualPresentation, original.motionTags]
    .filter(Boolean)
    .flatMap((value) =>
      value
        .split(/[,，·]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    );

  const parsedDuration = Number(original.durationSeconds);

  return {
    id: row.id,
    title: original.templateName || row.id,
    subtitle: original.category || 'Motion',
    description: original.summary || '',
    collection: 'example',
    kind: 'prism',
    tags,
    duration: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : undefined,
    author: original.author || original.attributionNickname || '',
    sourceUrl: original.sourceUrl || undefined,
    previewUrl,
    posterUrl,
    motionDocumentUrl: `/api/template-source/${encodeURIComponent(row.id)}/motion.md`,
    motionGuideUrl: `/api/template-source/${encodeURIComponent(row.id)}/preview.html`,
    projectFileUrl: typeof entry.projectFileUrl === 'string' ? entry.projectFileUrl : undefined,
    authorAvatarUrl: typeof entry.authorAvatarUrl === 'string' ? entry.authorAvatarUrl : undefined,
    styleDescription: original.styleDescription || undefined,
    reviewFocus: original.reviewFocus || undefined,
    brand: entry.brand || undefined,
    brandLogoUrl: entry.brand && meta.brands ? meta.brands[entry.brand] : undefined,
    uses: splitTags(original.promotionalUseCases),
    styles: splitTags(original.visualPresentation),
    industries: Array.isArray(entry.industries) ? entry.industries : [],
    creationModels: Array.isArray(entry.creationModels) ? entry.creationModels : [],
    colors: Array.isArray(entry.colors) ? entry.colors : [],
    width: typeof entry.width === 'number' ? entry.width : undefined,
    height: typeof entry.height === 'number' ? entry.height : undefined,
    sortOrder: row.sortOrder,
    featuredOrder: row.featuredOrder ?? null,
    hasHtmlProject: row.hasHtmlProject,
  };
}

function resolvePosterPathForRow(row: CatalogTemplateRow): string {
  const meta = (row.metadata ?? {}) as StoredCatalogMetadata;
  if (meta.posterPath) return normalizeCatalogAssetPath(meta.posterPath);
  if (meta.localMedia?.poster) return normalizeCatalogAssetPath(meta.localMedia.poster);
  return row.kind === 'builtin' ? 'poster.jpg' : 'assets/poster.jpg';
}

function resolvePreviewPathForRow(row: CatalogTemplateRow): string | null {
  const meta = (row.metadata ?? {}) as StoredCatalogMetadata;
  if (meta.previewPath) return normalizeCatalogAssetPath(meta.previewPath);
  if (meta.localMedia?.preview) return normalizeCatalogAssetPath(meta.localMedia.preview);
  return null;
}

function findRemoteAssetUrl(row: CatalogTemplateRow, assetPath: string): string | null {
  const meta = (row.metadata ?? {}) as StoredCatalogMetadata;
  const match = (meta.remoteAssets ?? []).find((asset) => asset.source?.path === assetPath);
  if (match && isSafeHttpsUrl(match.url)) {
    return match.url;
  }
  return null;
}

function deriveDefaultProjectTitle(row: CatalogTemplateRow, locale = 'en'): string {
  const gallery = projectRowToGalleryTemplate(row, locale);
  const candidate = (gallery.title || row.id).replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 100);
  return candidate || row.id.slice(0, 100);
}

// ---------------------------------------------------------------------------
// CatalogService Implementation (PG + S3 CAS + HotTextCache)
// ---------------------------------------------------------------------------

export interface CatalogServiceDeps {
  db: Database;
  storage: StoragePort;
  textCache?: HotTextCache;
  logger?: Logger;
  defaultLocale?: string;
  presignGetTtlSec?: number;
}

export class CatalogService implements CatalogPort {
  private readonly db: Database;
  private readonly storage: StoragePort;
  private readonly textCache?: HotTextCache;
  private readonly logger?: Logger;
  private readonly defaultLocale: string;
  private readonly presignGetTtlSec: number;

  constructor(deps: CatalogServiceDeps) {
    this.db = deps.db;
    this.storage = deps.storage;
    this.textCache = deps.textCache;
    this.logger = deps.logger;
    this.defaultLocale = deps.defaultLocale ?? 'en';
    this.presignGetTtlSec = deps.presignGetTtlSec ?? DEFAULT_PRESIGN_GET_TTL_SEC;
  }

  async listTemplates(options: CatalogListOptions = {}): Promise<CatalogListResult> {
    const baseQuery = this.db.select().from(catalogTemplates);
    const rows = options.kind
      ? await baseQuery
          .where(eq(catalogTemplates.kind, options.kind))
          .orderBy(asc(catalogTemplates.kind), asc(catalogTemplates.sortOrder), asc(catalogTemplates.id))
      : await baseQuery.orderBy(
          asc(catalogTemplates.kind),
          asc(catalogTemplates.sortOrder),
          asc(catalogTemplates.id),
        );

    const locale = options.locale ?? this.defaultLocale;
    // Match legacy ordering: prism templates sorted by sortOrder, followed by built-ins sorted by sortOrder.
    const prismRows = rows.filter((row) => row.kind === 'prism').sort((a, b) => a.sortOrder - b.sortOrder);
    const builtinRows = rows.filter((row) => row.kind === 'builtin').sort((a, b) => a.sortOrder - b.sortOrder);
    const ordered = [...prismRows, ...builtinRows];
    const items = ordered.map((row) => projectRowToGalleryTemplate(row, locale));
    const visible = options.covered ? items.filter((item) => Boolean(item.posterUrl)) : items;

    let page: TemplatePage;
    try {
      page = templatePage(visible, {
        category: options.category ?? 'featured',
        query: options.query ?? '',
        offset: options.offset ?? 0,
        limit: options.limit ?? 12,
        grouped: options.grouped ?? false,
      });
    } catch (error) {
      throw new CloudError(
        'INVALID_ARGUMENT',
        error instanceof Error ? error.message : 'Invalid template pagination parameters',
        { status: 400, applied: false },
      );
    }

    const catalogVersion = ordered[0]?.catalogVersion ?? 'empty';
    return {
      ...page,
      catalogTotal: items.length,
      catalogVersion,
      source: 'catalog-cas',
    };
  }

  async listBuiltinTemplates(locale?: string): Promise<GalleryTemplate[]> {
    const rows = await this.db
      .select()
      .from(catalogTemplates)
      .where(eq(catalogTemplates.kind, 'builtin'))
      .orderBy(asc(catalogTemplates.sortOrder), asc(catalogTemplates.id));
    const resolvedLocale = locale ?? this.defaultLocale;
    return rows.map((row) => projectRowToGalleryTemplate(row, resolvedLocale));
  }

  async getTemplate(templateId: string, options: { locale?: string } = {}): Promise<CatalogTemplateDetail> {
    const id = validateTemplateId(templateId);
    const rows = await this.db
      .select()
      .from(catalogTemplates)
      .where(eq(catalogTemplates.id, id));
    const row = rows[0];
    if (!row) {
      throw new CloudError('NOT_FOUND', `Template '${id}' not found`, { status: 404, applied: false });
    }

    const fileRows = await this.db
      .select()
      .from(catalogTemplateFiles)
      .where(eq(catalogTemplateFiles.templateId, id))
      .orderBy(asc(catalogTemplateFiles.path));

    const gallery = projectRowToGalleryTemplate(row, options.locale ?? this.defaultLocale);
    const instructions = row.instructionsMd ?? buildTemplateRecipe(gallery);
    const files: CatalogFileSummary[] = fileRows.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      metadata: file.metadata ?? null,
      isProjectFile: file.isProjectFile,
      isAvailable: file.isAvailable,
    }));

    return {
      ...gallery,
      catalogVersion: row.catalogVersion,
      instructions,
      ...(row.motionMd !== null
        ? {
            motionDocument: {
              path: `/api/template-source/${encodeURIComponent(row.id)}/motion.md`,
              content: row.motionMd,
            },
          }
        : {}),
      workflowGuide: {
        workflow: templateWorkflow(gallery),
        section: 'start',
        status: 'ready',
      },
      files,
    };
  }

  async headTemplateAsset(templateId: string, assetPath: string): Promise<CatalogAssetHead> {
    const id = validateTemplateId(templateId);
    const normalizedPath = normalizeCatalogAssetPath(assetPath);
    const rows = await this.db
      .select()
      .from(catalogTemplateFiles)
      .where(and(eq(catalogTemplateFiles.templateId, id), eq(catalogTemplateFiles.path, normalizedPath)));
    const file = rows[0];
    if (!file) {
      throw new CloudError('NOT_FOUND', `Catalog asset '${normalizedPath}' not found for template '${id}'`, {
        status: 404,
        applied: false,
      });
    }
    if (!file.isAvailable) {
      throw new CloudError(
        'TEMPLATE_MEDIA_UNAVAILABLE',
        `Catalog asset '${normalizedPath}' for template '${id}' is not available in CAS`,
        { details: { templateId: id, path: normalizedPath }, applied: false },
      );
    }
    return {
      templateId: id,
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      etag: formatStrongShaEtag(file.sha256),
      metadata: file.metadata ?? null,
      isAvailable: file.isAvailable,
    };
  }

  async headPosterAsset(templateId: string): Promise<CatalogAssetHead> {
    const id = validateTemplateId(templateId);
    const row = await this.requireTemplateRow(id);
    const posterPath = resolvePosterPathForRow(row);
    return this.headTemplateAsset(id, posterPath);
  }

  async resolvePosterAsset(
    templateId: string,
    options: { presignTtlSec?: number } = {},
  ): Promise<ResolvedCatalogAsset> {
    const id = validateTemplateId(templateId);
    const row = await this.requireTemplateRow(id);
    const posterPath = resolvePosterPathForRow(row);

    const fileRows = await this.db
      .select()
      .from(catalogTemplateFiles)
      .where(and(eq(catalogTemplateFiles.templateId, id), eq(catalogTemplateFiles.path, posterPath)));
    const file = fileRows[0];

    if (file && file.isAvailable) {
      return this.presignCatalogFile(file, options.presignTtlSec);
    }

    const remoteUrl = findRemoteAssetUrl(row, posterPath);
    if (remoteUrl) {
      return {
        kind: 'redirect',
        location: remoteUrl,
        mimeType: mimeTypeForPath(posterPath),
        metadata: file?.metadata ?? null,
        cacheControl: REDIRECT_CACHE_CONTROL,
        vary: REDIRECT_VARY,
      };
    }

    const meta = (row.metadata ?? {}) as StoredCatalogMetadata;
    if (isSafeHttpsUrl(meta.entry?.coverUrl)) {
      return {
        kind: 'redirect',
        location: meta.entry.coverUrl,
        mimeType: 'image/jpeg',
        metadata: null,
        cacheControl: REDIRECT_CACHE_CONTROL,
        vary: REDIRECT_VARY,
      };
    }

    if (file && !file.isAvailable) {
      throw new CloudError('TEMPLATE_MEDIA_UNAVAILABLE', `Poster for template '${id}' is unavailable`, {
        details: { templateId: id, path: posterPath },
        applied: false,
      });
    }

    throw new CloudError('NOT_FOUND', `Poster not found for template '${id}'`, { status: 404, applied: false });
  }

  async headPreviewAsset(templateId: string): Promise<CatalogAssetHead> {
    const id = validateTemplateId(templateId);
    const row = await this.requireTemplateRow(id);
    const previewPath = resolvePreviewPathForRow(row);
    if (!previewPath) {
      throw new CloudError('NOT_FOUND', `Local CAS preview asset not found for template '${id}'`, {
        status: 404,
        applied: false,
      });
    }
    return this.headTemplateAsset(id, previewPath);
  }

  async resolvePreviewAsset(
    templateId: string,
    options: { presignTtlSec?: number } = {},
  ): Promise<ResolvedCatalogAsset> {
    const id = validateTemplateId(templateId);
    const row = await this.requireTemplateRow(id);
    const previewPath = resolvePreviewPathForRow(row);

    if (previewPath) {
      const fileRows = await this.db
        .select()
        .from(catalogTemplateFiles)
        .where(and(eq(catalogTemplateFiles.templateId, id), eq(catalogTemplateFiles.path, previewPath)));
      const file = fileRows[0];
      if (file && file.isAvailable) {
        return this.presignCatalogFile(file, options.presignTtlSec);
      }
      const remoteUrl = findRemoteAssetUrl(row, previewPath);
      if (remoteUrl) {
        return {
          kind: 'redirect',
          location: remoteUrl,
          mimeType: mimeTypeForPath(previewPath),
          metadata: file?.metadata ?? null,
          cacheControl: REDIRECT_CACHE_CONTROL,
          vary: REDIRECT_VARY,
        };
      }
      if (file && !file.isAvailable) {
        throw new CloudError('TEMPLATE_MEDIA_UNAVAILABLE', `Preview media for template '${id}' is unavailable`, {
          details: { templateId: id, path: previewPath },
          applied: false,
        });
      }
    }

    const meta = (row.metadata ?? {}) as StoredCatalogMetadata;
    if (isSafeHttpsUrl(meta.entry?.previewUrl)) {
      return {
        kind: 'redirect',
        location: meta.entry.previewUrl,
        mimeType: 'video/mp4',
        metadata: null,
        cacheControl: REDIRECT_CACHE_CONTROL,
        vary: REDIRECT_VARY,
      };
    }

    throw new CloudError('NOT_FOUND', `Preview not found for template '${id}'`, { status: 404, applied: false });
  }

  async resolveSourceAsset(
    templateId: string,
    assetPath: string,
    options: ResolveSourceAssetOptions = {},
  ): Promise<ResolvedCatalogAsset> {
    const id = validateTemplateId(templateId);
    const normalizedPath = normalizeCatalogAssetPath(assetPath);
    const row = await this.requireTemplateRow(id);

    const fileRows = await this.db
      .select()
      .from(catalogTemplateFiles)
      .where(and(eq(catalogTemplateFiles.templateId, id), eq(catalogTemplateFiles.path, normalizedPath)));
    const file = fileRows[0];

    if (!file) {
      throw new CloudError('NOT_FOUND', `Template source file '${normalizedPath}' not found`, {
        status: 404,
        applied: false,
      });
    }

    if (!file.isAvailable) {
      const remoteUrl = findRemoteAssetUrl(row, normalizedPath);
      if (remoteUrl) {
        return {
          kind: 'redirect',
          location: remoteUrl,
          mimeType: file.mimeType,
          metadata: file.metadata ?? null,
          cacheControl: REDIRECT_CACHE_CONTROL,
          vary: REDIRECT_VARY,
        };
      }
      throw new CloudError(
        'TEMPLATE_MEDIA_UNAVAILABLE',
        `Template source file '${normalizedPath}' is not available in catalog CAS`,
        { details: { templateId: id, path: normalizedPath }, applied: false },
      );
    }

    // Serve HTML guide pages and motion.md inline via HotTextCache/S3 so relative URLs and guide
    // transforms work on the API origin; redirect binary media (or explicit ?redirect=1) via 302 presign.
    const shouldServeInline =
      !options.forceRedirect &&
      (normalizedPath === 'preview.html' ||
        normalizedPath === 'motion.md' ||
        normalizedPath.endsWith('.html'));

    if (!shouldServeInline) {
      return this.presignCatalogFile(file, options.presignTtlSec, {
        responseContentDisposition:
          options.download && normalizedPath === 'motion.md' ? 'attachment; filename="motion.md"' : undefined,
      });
    }

    let text = await this.readCatalogText(file.sha256);
    let transformed = false;
    if (normalizedPath === 'preview.html') {
      if (!options.raw) {
        const gallery = projectRowToGalleryTemplate(row, options.locale ?? this.defaultLocale);
        const motionDocument =
          !authoredTemplateGuide(text) && row.motionMd !== null ? row.motionMd : undefined;
        text = upgradeTemplateGuidePage(text, {
          id: gallery.id,
          title: gallery.title,
          brand: gallery.brand,
          sourceUrl: gallery.sourceUrl,
          previewUrl: gallery.previewUrl,
          posterUrl: gallery.posterUrl,
          hasHtmlProject: gallery.hasHtmlProject,
          ...(motionDocument !== undefined ? { motionDocument } : {}),
        });
        transformed = true;
      } else if (options.stage) {
        text = compactNativeGuideStage(text);
        transformed = true;
      }
    }

    const body = Buffer.from(text, 'utf8');
    const responseSha = transformed ? createHash('sha256').update(body).digest('hex') : file.sha256;
    return {
      kind: 'inline',
      body,
      sha256: responseSha,
      sizeBytes: body.byteLength,
      mimeType: file.mimeType,
      etag: formatStrongShaEtag(responseSha),
      metadata: file.metadata ?? null,
      cacheControl: REDIRECT_CACHE_CONTROL,
      vary: REDIRECT_VARY,
      ...(normalizedPath === 'motion.md' && options.download
        ? { contentDisposition: 'attachment; filename="motion.md"' }
        : {}),
    };
  }

  /**
   * O(1) zero-copy clone of a catalog template into a tenant workspace project.
   *
   * Inserts `sessions` (if needed), `projects`, `project_files` (`blob_scope = 'catalog'`),
   * initial `project_versions` (v1 baseline), `project_version_files` (`blob_scope = 'catalog'`),
   * and `project_history_entries` (seq 1).
   *
   * NEVER copies bytes in S3 and NEVER reads/writes `workspace_blobs` refcounts.
   */
  async cloneTemplateToProject(
    ctx: AuthContext,
    options: CloneTemplateOptions,
  ): Promise<CloneTemplateResult> {
    if (!isUuid(ctx.workspaceId)) {
      throw new CloudError('INVALID_ARGUMENT', 'AuthContext.workspaceId must be a valid UUID', {
        status: 400,
        applied: false,
      });
    }

    if (!options.internalSystemBootstrap) {
      if (!hasScope(ctx, 'projects:write')) {
        throw new CloudError('INSUFFICIENT_SCOPE', 'Scope projects:write is required to clone templates', {
          status: 403,
          applied: false,
        });
      }
      if (!hasMinRole(ctx, 'editor')) {
        throw new CloudError('FORBIDDEN', 'Editor role or higher is required to clone templates', {
          status: 403,
          applied: false,
        });
      }
    }

    const templateId = validateTemplateId(options.templateId);
    if (options.sessionId !== undefined && !isUuid(options.sessionId)) {
      throw new CloudError('INVALID_ARGUMENT', 'sessionId must be a valid UUID', { status: 400, applied: false });
    }

    let validatedRequestId: string | null = null;
    if (options.requestId !== undefined) {
      try {
        validatedRequestId = validateStableRequestId(options.requestId);
      } catch (error) {
        throw new CloudError(
          'INVALID_ARGUMENT',
          error instanceof Error ? error.message : 'Invalid requestId',
          { status: 400, applied: false },
        );
      }
    }

    let explicitTitle: string | undefined;
    if (options.title !== undefined) {
      try {
        explicitTitle = validateProjectTitle(options.title);
      } catch (error) {
        throw new CloudError(
          'INVALID_ARGUMENT',
          error instanceof Error ? error.message : 'Invalid project title',
          { status: 400, applied: false },
        );
      }
    }

    const executeClone = async (tx: DbExecutor): Promise<CloneTemplateResult> => {
      const templateRows = await tx
        .select()
        .from(catalogTemplates)
        .where(eq(catalogTemplates.id, templateId));
      const templateRow = templateRows[0];
      if (!templateRow) {
        throw new CloudError('NOT_FOUND', `Template '${templateId}' not found`, {
          status: 404,
          applied: false,
        });
      }

      const fileRows = await tx
        .select()
        .from(catalogTemplateFiles)
        .where(
          and(
            eq(catalogTemplateFiles.templateId, templateId),
            eq(catalogTemplateFiles.isProjectFile, true),
          ),
        )
        .orderBy(asc(catalogTemplateFiles.path));

      if (fileRows.length === 0 || !fileRows.some((file) => file.path === 'index.html')) {
        throw new CloudError(
          'TEMPLATE_NOT_COPYABLE',
          `Template '${templateId}' does not provide an editable HTML project (missing index.html)`,
          { details: { templateId }, applied: false },
        );
      }

      const unavailable = fileRows.filter((file) => !file.isAvailable);
      if (unavailable.length > 0) {
        throw new CloudError(
          'TEMPLATE_MEDIA_UNAVAILABLE',
          `Template '${templateId}' has unavailable catalog blobs that must be synced before cloning`,
          {
            details: {
              templateId,
              missingPaths: unavailable.map((file) => file.path),
            },
            applied: false,
          },
        );
      }

      const validatedFiles: ClonedProjectFile[] = fileRows.map((file) => {
        let normalized: string;
        try {
          normalized = projectPath(file.path, true);
        } catch (error) {
          throw new CloudError(
            'INVALID_PATH',
            error instanceof Error ? error.message : `Invalid template file path: ${file.path}`,
            { status: 400, applied: false },
          );
        }
        if (!isSha256Hex(file.sha256)) {
          throw new CloudError('STORAGE_ERROR', `Corrupt catalog sha256 digest for ${file.path}`, {
            status: 500,
            applied: false,
          });
        }
        return {
          path: normalized,
          blobScope: 'catalog',
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
          isText: isTextProjectPath(normalized),
        };
      });

      const revision = computeProjectRevision(
        validatedFiles.map((file) => ({
          path: file.path,
          size: file.sizeBytes,
          hash: file.sha256,
        })),
      );

      const title = explicitTitle ?? deriveDefaultProjectTitle(templateRow, options.locale ?? this.defaultLocale);
      const titleKey = options.titleKey ?? null;
      const projectId = randomUUID();
      const artifactId = randomUUID();
      const versionId = randomUUID();
      const now = new Date();

      let sessionId: string;
      if (options.sessionId) {
        const existingSession = await tx
          .select({ id: sessions.id })
          .from(sessions)
          .where(and(eq(sessions.id, options.sessionId), eq(sessions.workspaceId, ctx.workspaceId)));
        if (existingSession.length === 0) {
          throw new CloudError('SESSION_NOT_FOUND', `Session '${options.sessionId}' not found in workspace`, {
            status: 404,
            applied: false,
          });
        }
        sessionId = options.sessionId;
        await tx
          .update(sessions)
          .set(
            asUpdate(sessions, {
              activeArtifactId: artifactId,
              openedAt: now,
              updatedAt: now,
            }),
          )
          .where(and(eq(sessions.id, sessionId), eq(sessions.workspaceId, ctx.workspaceId)));
      } else {
        sessionId = randomUUID();
        await tx.insert(sessions).values(
          asInsert(sessions, {
            id: sessionId,
            workspaceId: ctx.workspaceId,
            title,
            mode: 'motion',
            templateId,
            activeArtifactId: artifactId,
            createdAt: now,
            openedAt: now,
            updatedAt: now,
          }),
        );
      }

      const gallery = projectRowToGalleryTemplate(templateRow, options.locale ?? this.defaultLocale);
      const sourceMeta: Record<string, unknown> = {
        id: templateRow.id,
        kind: templateRow.kind,
        catalogVersion: templateRow.catalogVersion,
        ...(gallery.previewUrl ? { previewUrl: gallery.previewUrl } : {}),
        ...(gallery.posterUrl ? { posterUrl: gallery.posterUrl } : {}),
        ...(gallery.sourceUrl ? { sourceUrl: gallery.sourceUrl } : {}),
      };

      await tx.insert(projects).values(
        asInsert(projects, {
          id: projectId,
          workspaceId: ctx.workspaceId,
          ownerUserId: ctx.userId,
          sessionId,
          artifactId,
          title,
          titleKey,
          projectType: 'template',
          templateId,
          requirements: options.requirements ?? null,
          namingLanguage: options.namingLanguage ?? null,
          sourceMeta,
          assetNameAllocations: {},
          revision,
          currentVersionId: versionId,
          currentVersionNumber: 1,
          currentHistorySeq: 1,
          previewDisplay: null,
          reviews: [],
          trashed: false,
          trashedAt: null,
          createdAt: now,
          openedAt: now,
          updatedAt: now,
        }),
      );

      // Spec: when an OAuth agent creates a new project (including from a template),
      // automatically grant that connection access to the created project.
      if (ctx.authMethod === 'oauth_bearer' && ctx.clientId) {
        await tx
          .insert(projectGrants)
          .values(
            asInsert(projectGrants, {
              projectId,
              userId: ctx.userId,
              workspaceId: ctx.workspaceId,
              clientId: ctx.clientId,
              grantedAt: now,
              revokedAt: null,
            }),
          )
          .onConflictDoUpdate({
            target: [projectGrants.projectId, projectGrants.userId, projectGrants.clientId],
            set: asUpdate(projectGrants, {
              workspaceId: ctx.workspaceId,
              grantedAt: now,
              revokedAt: null,
            }),
          });
      }

      await tx.insert(projectFiles).values(
        validatedFiles.map((file) =>
          asInsert(projectFiles, {
            workspaceId: ctx.workspaceId,
            projectId,
            path: file.path,
            blobScope: 'catalog',
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
            isText: file.isText,
            updatedAt: now,
          }),
        ),
      );

      const summary = `Cloned from template ${templateId}`;
      await tx.insert(projectVersions).values(
        asInsert(projectVersions, {
          id: versionId,
          workspaceId: ctx.workspaceId,
          projectId,
          versionNumber: 1,
          revision,
          source: 'baseline',
          summary,
          requestId: validatedRequestId,
          restoredFromVersionId: null,
          pinned: false,
          createdAt: now,
        }),
      );

      await tx.insert(projectVersionFiles).values(
        validatedFiles.map((file) =>
          asInsert(projectVersionFiles, {
            versionId,
            workspaceId: ctx.workspaceId,
            projectId,
            path: file.path,
            blobScope: 'catalog',
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
          }),
        ),
      );

      await tx.insert(projectHistoryEntries).values(
        asInsert(projectHistoryEntries, {
          workspaceId: ctx.workspaceId,
          projectId,
          seq: 1,
          versionId,
          parentEntryId: null,
          actorKind: 'system',
          actorName: 'catalog',
          label: summary,
          windowId: null,
          pinned: false,
          undone: false,
          startedAt: now,
          endedAt: now,
        }),
      );

      if (options.activateWorkspace) {
        await tx
          .update(workspaces)
          .set(
            asUpdate(workspaces, {
              activeProjectId: projectId,
              activeSessionId: sessionId,
              updatedAt: now,
            }),
          )
          .where(eq(workspaces.id, ctx.workspaceId));
      }

      return {
        projectId,
        sessionId,
        artifactId,
        title,
        titleKey,
        templateId,
        projectType: 'template',
        revision,
        versionId,
        versionNumber: 1,
        historySeq: 1,
        fileCount: validatedFiles.length,
        files: validatedFiles,
      };
    };

    const result = options.tx ? await executeClone(options.tx) : await this.db.transaction(executeClone);
    this.logger?.info('Cloned catalog template zero-copy into workspace', {
      workspaceId: ctx.workspaceId,
      projectId: result.projectId,
      templateId: result.templateId,
      fileCount: result.fileCount,
    });
    return result;
  }

  async instantiateTemplateToProject(
    ctx: AuthContext,
    options: CloneTemplateOptions,
  ): Promise<CloneTemplateResult> {
    return this.cloneTemplateToProject(ctx, options);
  }

  private async requireTemplateRow(id: string): Promise<CatalogTemplateRow> {
    const rows = await this.db.select().from(catalogTemplates).where(eq(catalogTemplates.id, id));
    const row = rows[0];
    if (!row) {
      throw new CloudError('NOT_FOUND', `Template '${id}' not found`, { status: 404, applied: false });
    }
    return row;
  }

  private async presignCatalogFile(
    file: CatalogTemplateFileRow,
    presignTtlSec?: number,
    options: { responseContentDisposition?: string } = {},
  ): Promise<ResolvedCatalogAsset> {
    const key = catalogBlobKey(file.sha256);
    const location = await this.storage.presignGet(key, {
      expiresInSec: presignTtlSec ?? this.presignGetTtlSec,
      responseContentType: file.mimeType,
      ...(options.responseContentDisposition
        ? { responseContentDisposition: options.responseContentDisposition }
        : {}),
    });
    return {
      kind: 'redirect',
      location,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      etag: formatStrongShaEtag(file.sha256),
      metadata: file.metadata ?? null,
      cacheControl: REDIRECT_CACHE_CONTROL,
      vary: REDIRECT_VARY,
    };
  }

  private async readCatalogText(sha256: string): Promise<string> {
    if (this.textCache) {
      try {
        const cached = await this.textCache.getText(sha256);
        if (cached !== null) {
          return cached;
        }
      } catch (error) {
        this.logger?.warn('HotTextCache read failed for catalog blob; falling back to S3', {
          sha256,
          error,
        });
      }
    }

    const buffer = await this.storage.getObjectBuffer(catalogBlobKey(sha256));
    const text = buffer.toString('utf8');

    if (this.textCache) {
      void this.textCache.setText(sha256, text).catch((error) => {
        this.logger?.warn('HotTextCache warm failed for catalog blob', { sha256, error });
      });
    }
    return text;
  }
}
