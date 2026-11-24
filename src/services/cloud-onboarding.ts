import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CloudError } from '../contracts/errors.ts';

export const DEFAULT_CLOUD_ORIGIN = 'https://motion.open-design.ai';
export const ONBOARDING_HTML_BUDGET_BYTES = 1_000_000;
export const SUPPORTED_ONBOARDING_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'fr', 'es', 'pt'] as const;
export type OnboardingLanguage = (typeof SUPPORTED_ONBOARDING_LANGUAGES)[number];

interface InlineProjectPreview {
  id: string;
  durationSeconds: number;
  videoBase64: string;
  videoMimeType: 'video/webm';
  posterBase64: string;
  posterMimeType: 'image/jpeg';
}

interface LoadedTemplatePresentation {
  readonly uri: string;
  readonly resourceVersion: string;
  readonly content: { text: string };
  readonly templates: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly durationSeconds: number;
    readonly kind?: 'builtin' | 'reference';
    readonly videoUrl?: string;
    readonly posterUrl?: string;
  }>;
}

interface TemplateRecommendationCard {
  position: number;
  templateId: string;
  title: string;
  description: string;
  durationSeconds: number;
  actionRequestId: string;
  templateKind?: 'reference';
}

interface TemplateRecommendationPayload {
  schemaVersion: number;
  resourceVersion: string;
  recommendationId: string;
  cards: TemplateRecommendationCard[];
  language?: string;
  onboarding?: boolean;
  selectionGuide: string;
}

interface OnboardingTemplatesModule {
  onboardingTemplateIds: readonly string[];
  selectOnboardingTemplateIds: (random?: () => number) => string[];
}

interface TemplateRecommendationsModule {
  loadTemplatePresentation: (options?: {
    directory?: string;
    applicationRoot?: string;
  }) => LoadedTemplatePresentation;
  loadInlineProjectPreviews: (
    templateIds: string[],
    options?: { directory?: string; applicationRoot?: string },
  ) => InlineProjectPreview[];
  showTemplateRecommendations: (
    presentation: LoadedTemplatePresentation,
    args: { templateIds: string[]; onboarding?: boolean; language?: string },
  ) => TemplateRecommendationPayload;
}

interface OnboardingI18nModule {
  inlineDescriptionPrefixes: Record<OnboardingLanguage, string>;
  welcomeMarkdown: (language: OnboardingLanguage, cardsPosition?: 'before' | 'after') => string;
  noSidebarWelcomeMarkdown: (
    language: OnboardingLanguage,
    libraryUrl: string,
    options?: { includeCardIntro?: boolean },
  ) => string;
  installationFallbackWelcome: (language: OnboardingLanguage) => string;
}

export interface CloudOnboardingTemplateItem {
  readonly position: number;
  readonly templateId: string;
  readonly title: string;
  readonly summary: string;
  readonly durationSeconds: number;
  readonly previewUrl: string;
  readonly posterUrl: string | null;
  readonly videoUrl: string | null;
}

export interface CloudOnboardingPreparePayload {
  readonly schemaVersion: 1;
  readonly language: OnboardingLanguage;
  readonly origin: string;
  readonly mcpUrl: string;
  readonly libraryUrl: string;
  readonly templateIds: readonly string[];
  readonly resourceVersion: string;
  readonly welcomeMarkdown: string;
  readonly fallbackWelcomeMarkdown: string;
  readonly noSidebarWelcomeMarkdown: string;
  readonly noSidebarTextWelcomeMarkdown: string;
  readonly inlineHtmlUrl: string;
  readonly inlineHtmlSha256: string;
  readonly inlineHtmlBytes: number;
  readonly cardPresentation: {
    readonly tool: 'openmotion_show_template_recommendations';
    readonly arguments: {
      readonly templateIds: readonly string[];
      readonly language: OnboardingLanguage;
      readonly onboarding: true;
    };
    readonly cardsOnlyArguments: {
      readonly templateIds: readonly string[];
      readonly language: OnboardingLanguage;
      readonly onboarding: false;
    };
  };
  readonly templates: readonly CloudOnboardingTemplateItem[];
}

export interface RenderedOnboardingDocument {
  readonly html: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly resourceVersion: string;
  readonly language: OnboardingLanguage;
  readonly templateIds: readonly string[];
  readonly templates: readonly CloudOnboardingTemplateItem[];
}

const MAX_DOCUMENT_CACHE_ENTRIES = 256;
const documentCache = new Map<string, RenderedOnboardingDocument>();

let cachedTemplatesModule: Promise<OnboardingTemplatesModule> | null = null;
let cachedRecommendationsModule: Promise<TemplateRecommendationsModule> | null = null;
let cachedI18nModule: Promise<OnboardingI18nModule> | null = null;

function loadOnboardingTemplatesModule(): Promise<OnboardingTemplatesModule> {
  if (!cachedTemplatesModule) {
    const modPath = '../../shared/onboarding-templates' + '.ts';
    cachedTemplatesModule = import(modPath) as Promise<OnboardingTemplatesModule>;
  }
  return cachedTemplatesModule;
}

function loadRecommendationsModule(): Promise<TemplateRecommendationsModule> {
  if (!cachedRecommendationsModule) {
    const modPath = '../../shared/mcp-template-recommendations' + '.ts';
    cachedRecommendationsModule = import(modPath) as Promise<TemplateRecommendationsModule>;
  }
  return cachedRecommendationsModule;
}

function loadI18nModule(): Promise<OnboardingI18nModule> {
  if (!cachedI18nModule) {
    const modPath = '../../mcp-ui/template-recommendations/i18n' + '.ts';
    cachedI18nModule = import(modPath) as Promise<OnboardingI18nModule>;
  }
  return cachedI18nModule;
}

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  // Set RFC 4122 version 4 / variant 10 bits so downstream UUID validators accept it.
  const part3 = '4' + hex.slice(13, 16);
  const variantNibble = (8 + (Number.parseInt(hex.slice(16, 17), 16) % 4)).toString(16);
  const part4 = variantNibble + hex.slice(17, 20);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${part3}-${part4}-${hex.slice(20, 32)}`;
}

export function normalizeOnboardingLanguage(raw?: string | null): OnboardingLanguage {
  if (typeof raw !== 'string' || !raw.trim()) return 'en';
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_ONBOARDING_LANGUAGES as readonly string[]).includes(base)
    ? (base as OnboardingLanguage)
    : 'en';
}

export function normalizePublicOrigin(rawOrigin: string): string {
  return rawOrigin.trim().replace(/\/+$/, '');
}

/**
 * Renders `docs/install.md` bound to the active deployment's `APP_PUBLIC_ORIGIN`
 * so staging/test and local Docker deployments serve self-consistent cloud setup
 * instructions without committing non-public hostnames into the repository.
 */
export async function renderCloudInstallGuide(options: {
  runtimeRoot: string;
  publicOrigin: string;
}): Promise<string> {
  const origin = normalizePublicOrigin(options.publicOrigin || DEFAULT_CLOUD_ORIGIN);
  const guidePath = path.join(options.runtimeRoot, 'docs/install.md');
  let raw: string;
  try {
    raw = await readFile(guidePath, 'utf8');
  } catch {
    throw new CloudError('SERVICE_UNAVAILABLE', 'Installation guide is unavailable in this deployment', {
      status: 503,
      applied: false,
    });
  }
  return raw.replaceAll(DEFAULT_CLOUD_ORIGIN, origin);
}

export async function resolveOnboardingTemplateSelection(rawTemplates?: string | null): Promise<{
  templateIds: string[];
  explicit: boolean;
}> {
  const { onboardingTemplateIds, selectOnboardingTemplateIds } = await loadOnboardingTemplatesModule();
  if (rawTemplates === undefined || rawTemplates === null || !rawTemplates.trim()) {
    return { templateIds: selectOnboardingTemplateIds(), explicit: false };
  }
  const parts = rawTemplates
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 3 || new Set(parts).size !== 3) {
    throw new CloudError(
      'INVALID_ARGUMENT',
      'templates must be three distinct comma-separated curated onboarding template IDs',
      { status: 400, applied: false },
    );
  }
  for (const id of parts) {
    if (!onboardingTemplateIds.includes(id)) {
      throw new CloudError('INVALID_ARGUMENT', `Unknown onboarding template ID: ${id}`, {
        status: 400,
        applied: false,
      });
    }
  }
  return { templateIds: parts, explicit: true };
}

export async function defaultDeterministicTemplateIds(): Promise<string[]> {
  const { onboardingTemplateIds } = await loadOnboardingTemplatesModule();
  return onboardingTemplateIds.slice(0, 3);
}

/**
 * Deterministically renders the self-contained `< 1 MiB` onboarding HTML cards
 * fragment in memory so any stateless `api` replica serves byte-identical HTML
 * and SHA-256 digests for a given `(resourceVersion, language, templateIds)` tuple.
 */
export async function renderCloudOnboardingDocument(options: {
  runtimeRoot: string;
  publicOrigin: string;
  language: OnboardingLanguage;
  templateIds: readonly string[];
}): Promise<RenderedOnboardingDocument> {
  const origin = normalizePublicOrigin(options.publicOrigin || DEFAULT_CLOUD_ORIGIN);
  const directory = path.join(options.runtimeRoot, 'mcp-ui/template-recommendations');
  const [recMod, i18nMod] = await Promise.all([loadRecommendationsModule(), loadI18nModule()]);

  let presentation: LoadedTemplatePresentation;
  try {
    presentation = recMod.loadTemplatePresentation({
      applicationRoot: options.runtimeRoot,
      directory,
    });
  } catch (error) {
    throw new CloudError(
      'SERVICE_UNAVAILABLE',
      `Onboarding template presentation assets are unavailable: ${error instanceof Error ? error.message : String(error)}`,
      { status: 503, applied: false },
    );
  }

  const cacheKey = `${options.runtimeRoot}|${origin}|${presentation.resourceVersion}|${options.language}|${options.templateIds.join(',')}`;
  const cached = documentCache.get(cacheKey);
  if (cached) return cached;

  const bootstrapMatch = presentation.content.text.match(
    /window\.__OPENMOTION_TEMPLATE_CARDS__=(.*?);<\/script>/s,
  );
  if (!bootstrapMatch) {
    throw new CloudError('SERVICE_UNAVAILABLE', 'Verified template cards bootstrap is missing', {
      status: 503,
      applied: false,
    });
  }

  const bootstrap = JSON.parse(bootstrapMatch[1]) as {
    templates: Array<{
      id: string;
      title: string;
      description: string;
      descriptions?: Record<string, string>;
      kind?: string;
      durationSeconds: number;
      videoUrl?: string;
      posterUrl?: string;
      videoBase64?: string;
      videoMimeType?: string;
      posterBase64?: string;
      posterMimeType?: string;
    }>;
  };

  const templateIds = [...options.templateIds];
  const rawRecommendation = recMod.showTemplateRecommendations(presentation, {
    templateIds,
    language: options.language,
    onboarding: true,
  });

  // Replace random UUIDs with deterministic tuple-derived UUIDs so multi-replica pods
  // return identical HTML bytes and SHA-256 hashes across `/prepare` and `/cards.html`.
  const seedBase = `${presentation.resourceVersion}|${options.language}|${templateIds.join(',')}`;
  const recommendation: TemplateRecommendationPayload = {
    ...rawRecommendation,
    recommendationId: deterministicUuid(`${seedBase}|rec`),
    cards: rawRecommendation.cards.map((card, index) => ({
      ...card,
      actionRequestId: deterministicUuid(`${seedBase}|card|${index}|${card.templateId}`),
    })),
  };

  // Capture original reference URLs before replacing media with inline project previews.
  const mediaById = new Map<string, { posterUrl: string | null; videoUrl: string | null; summary: string }>();
  for (const tpl of bootstrap.templates) {
    if (!templateIds.includes(tpl.id)) continue;
    const localizedSummary = tpl.descriptions?.[options.language] ?? tpl.description;
    mediaById.set(tpl.id, {
      posterUrl: typeof tpl.posterUrl === 'string' ? tpl.posterUrl : null,
      videoUrl: typeof tpl.videoUrl === 'string' ? tpl.videoUrl : null,
      summary: localizedSummary,
    });
  }

  bootstrap.templates = bootstrap.templates.filter((tpl) => templateIds.includes(tpl.id));
  const references = bootstrap.templates.filter((tpl) => tpl.kind === 'reference');
  if (references.length > 0) {
    const previews = recMod.loadInlineProjectPreviews(
      references.map((item) => item.id),
      { applicationRoot: options.runtimeRoot, directory },
    );
    const prefix = i18nMod.inlineDescriptionPrefixes[options.language];
    for (const tpl of references) {
      const preview = previews.find((item) => item.id === tpl.id);
      if (!preview) {
        throw new CloudError('SERVICE_UNAVAILABLE', `Missing inline preview for ${tpl.id}`, {
          status: 503,
          applied: false,
        });
      }
      delete tpl.videoUrl;
      delete tpl.posterUrl;
      Object.assign(tpl, preview);
      tpl.description = prefix + tpl.description;
      if (tpl.descriptions) {
        for (const loc of Object.keys(tpl.descriptions) as OnboardingLanguage[]) {
          const locPrefix = i18nMod.inlineDescriptionPrefixes[loc] ?? prefix;
          tpl.descriptions[loc] = locPrefix + tpl.descriptions[loc];
        }
      }
      const card = recommendation.cards.find((item) => item.templateId === tpl.id);
      if (card) {
        card.durationSeconds = preview.durationSeconds;
        card.description = tpl.description;
      }
    }
  }

  const [fragmentTemplate, inlineCss, inlineJs] = await Promise.all([
    readFile(path.join(directory, 'inline.fragment.html'), 'utf8'),
    readFile(path.join(directory, 'build/app.css'), 'utf8'),
    readFile(path.join(directory, 'build/inline.js'), 'utf8'),
  ]);

  const rootDomId = `openmotion-onboarding-${createHash('sha256').update(seedBase).digest('hex').slice(0, 16)}`;
  const safeJson = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
  const replacements: Record<string, string> = {
    '__OPENMOTION_INLINE_ROOT__': rootDomId,
    '/*__OPENMOTION_INLINE_STYLE__*/': inlineCss.replace(/<\/style/gi, '<\\/style'),
    '/*__OPENMOTION_INLINE_APP__*/': inlineJs.replace(/<\/script/gi, '<\\/script'),
    '/*__OPENMOTION_INLINE_BOOTSTRAP__*/': safeJson(bootstrap),
    '/*__OPENMOTION_INLINE_RECOMMENDATION__*/': safeJson({ ...recommendation, onboarding: false }),
  };

  let html = fragmentTemplate;
  for (const [marker, value] of Object.entries(replacements)) {
    if (!html.includes(marker)) {
      throw new CloudError('SERVICE_UNAVAILABLE', `Inline onboarding marker missing: ${marker}`, {
        status: 503,
        applied: false,
      });
    }
    html = html.replaceAll(marker, () => value);
  }
  if (html.includes('__OPENMOTION_INLINE_')) {
    throw new CloudError('SERVICE_UNAVAILABLE', 'Inline onboarding document contains unresolved markers', {
      status: 503,
      applied: false,
    });
  }

  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes >= ONBOARDING_HTML_BUDGET_BYTES) {
    throw new CloudError(
      'SERVICE_UNAVAILABLE',
      `Inline onboarding document (${bytes} bytes) exceeds 1,000,000-byte host budget`,
      { status: 500, applied: false },
    );
  }

  const sha256 = createHash('sha256').update(html, 'utf8').digest('hex');
  const templates: CloudOnboardingTemplateItem[] = recommendation.cards.map((card) => {
    const orig = mediaById.get(card.templateId);
    return {
      position: card.position,
      templateId: card.templateId,
      title: card.title,
      summary: orig?.summary ?? card.description,
      durationSeconds: card.durationSeconds,
      previewUrl: `${origin}/?templates=1&template=${encodeURIComponent(card.templateId)}`,
      posterUrl: orig?.posterUrl ?? null,
      videoUrl: orig?.videoUrl ?? null,
    };
  });

  const result: RenderedOnboardingDocument = {
    html,
    sha256,
    bytes,
    resourceVersion: presentation.resourceVersion,
    language: options.language,
    templateIds,
    templates,
  };

  if (documentCache.size >= MAX_DOCUMENT_CACHE_ENTRIES) {
    const oldestKey = documentCache.keys().next().value;
    if (oldestKey) documentCache.delete(oldestKey);
  }
  documentCache.set(cacheKey, result);
  return result;
}

export async function prepareCloudOnboarding(options: {
  runtimeRoot: string;
  publicOrigin: string;
  language?: string | null;
  templates?: string | null;
}): Promise<CloudOnboardingPreparePayload> {
  const origin = normalizePublicOrigin(options.publicOrigin || DEFAULT_CLOUD_ORIGIN);
  const language = normalizeOnboardingLanguage(options.language);
  const { templateIds } = await resolveOnboardingTemplateSelection(options.templates);
  const [doc, i18nMod] = await Promise.all([
    renderCloudOnboardingDocument({
      runtimeRoot: options.runtimeRoot,
      publicOrigin: origin,
      language,
      templateIds,
    }),
    loadI18nModule(),
  ]);

  const libraryUrl = `${origin}/?templates=1`;
  const inlineHtmlUrl = `${origin}/api/onboarding/cards.html?lang=${encodeURIComponent(language)}&templates=${encodeURIComponent(templateIds.join(','))}`;

  return {
    schemaVersion: 1,
    language,
    origin,
    mcpUrl: `${origin}/mcp`,
    libraryUrl,
    templateIds: doc.templateIds,
    resourceVersion: doc.resourceVersion,
    welcomeMarkdown: i18nMod.welcomeMarkdown(language),
    fallbackWelcomeMarkdown: i18nMod.installationFallbackWelcome(language),
    noSidebarWelcomeMarkdown: i18nMod.noSidebarWelcomeMarkdown(language, libraryUrl, {
      includeCardIntro: true,
    }),
    noSidebarTextWelcomeMarkdown: i18nMod.noSidebarWelcomeMarkdown(language, libraryUrl, {
      includeCardIntro: false,
    }),
    inlineHtmlUrl,
    inlineHtmlSha256: doc.sha256,
    inlineHtmlBytes: doc.bytes,
    cardPresentation: {
      tool: 'openmotion_show_template_recommendations',
      arguments: {
        templateIds: doc.templateIds,
        language,
        onboarding: true,
      },
      cardsOnlyArguments: {
        templateIds: doc.templateIds,
        language,
        onboarding: false,
      },
    },
    templates: doc.templates,
  };
}
