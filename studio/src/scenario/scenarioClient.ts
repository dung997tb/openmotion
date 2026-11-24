import type { DesignProjectDetail, DesignVersion } from '../../../shared/design-project';
import type { EmbedImageTarget } from '../../../shared/scenario-content';
import {
  parseScenarioError,
  type IterationOutput,
  type PoolItem,
  type PoolRef,
  type ScenarioBundleReceipt,
  type ScenarioCommand,
  type ScenarioRun,
  type ScenarioRunSummary,
  type ScenarioStepState,
  type StepIteration,
} from '../../../shared/scenario-runs';
import type { ScenarioDefinition, ScenarioId, scenarioCategories, socialPlatforms } from '../../../shared/scenarios';
import { isClientCacheEnabled } from '../utils/clientCacheMode';

export type ScenarioListArgs = { scenarioId?: ScenarioId; includeArchived?: boolean; offset?: number; limit?: number };
export type ScenarioListResult = { runs: ScenarioRunSummary[]; nextOffset: number | null };

const SCENARIO_LIST_CACHE_TTL_MS = 20_000;
let scenarioListGeneration = 0;
const scenarioListCache = new Map<string, { value: ScenarioListResult; expiresAt: number }>();
const inflightScenarioLists = new Map<string, Promise<ScenarioListResult>>();

function scenarioListKey(args: ScenarioListArgs = {}): string {
  return JSON.stringify([
    args.scenarioId ?? 'all',
    Boolean(args.includeArchived),
    args.offset ?? 0,
    args.limit ?? 6,
  ]);
}

export function clearScenarioListCache(): void {
  scenarioListGeneration++;
  scenarioListCache.clear();
  inflightScenarioLists.clear();
}

export function peekCachedScenarioList(args: ScenarioListArgs = {}): ScenarioListResult | undefined {
  if (!isClientCacheEnabled()) return undefined;
  return scenarioListCache.get(scenarioListKey(args))?.value;
}

export function prefetchScenarioHub(): void {
  if (!isClientCacheEnabled()) return;
  const cached = scenarioListCache.get(scenarioListKey({ offset: 0, limit: 6 }));
  if (cached && cached.expiresAt > Date.now()) return;
  void scenarioClient.list({ offset: 0, limit: 6 }).catch(() => {});
}

export class ScenarioApiError extends Error {
  readonly code: string;
  readonly applied?: boolean | 'unknown';
  constructor(code: string, message: string, applied?: boolean | 'unknown') {
    super(message);
    this.code = code;
    this.applied = applied;
  }
}

export async function scenarioRequest<T>(command: ScenarioCommand, args: Record<string, unknown> = {}): Promise<T> {
  if (command !== 'catalog' && command !== 'list' && command !== 'get') {
    clearScenarioListCache();
  }
  const response = await fetch('/motion-api/phase1/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'openmotion_assets_use',
      arguments: {
        action: 'scenario',
        scenario: { command, ...args },
      },
    }),
  });
  let payload: Record<string, unknown> | null = null;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const rawError = typeof payload?.error === 'string'
      ? payload.error
      : `Scenario request failed (${response.status})`;
    const parsed = parseScenarioError(rawError);
    const code = parsed.code !== 'SCENARIO_ERROR'
      ? parsed.code
      : typeof payload?.code === 'string' && payload.code
        ? payload.code
        : 'SCENARIO_ERROR';
    const applied = payload?.applied === true || payload?.applied === false || payload?.applied === 'unknown'
      ? payload.applied
      : undefined;
    throw new ScenarioApiError(code, parsed.message, applied);
  }
  return payload as T;
}

export const scenarioClient = {
  catalog: () =>
    scenarioRequest<{
      scenarios: readonly ScenarioDefinition[];
      categories: typeof scenarioCategories;
      platforms: typeof socialPlatforms;
    }>('catalog'),

  list: (args: ScenarioListArgs = {}) => {
    const key = scenarioListKey(args);
    if (isClientCacheEnabled()) {
      const cached = scenarioListCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return Promise.resolve(cached.value);
      }
    }
    const existing = inflightScenarioLists.get(key);
    if (existing) return existing;

    const gen = scenarioListGeneration;
    const run = scenarioRequest<ScenarioListResult>('list', args).then(result => {
      if (isClientCacheEnabled() && gen === scenarioListGeneration) {
        scenarioListCache.set(key, { value: result, expiresAt: Date.now() + SCENARIO_LIST_CACHE_TTL_MS });
      }
      return result;
    });
    inflightScenarioLists.set(key, run);
    return run.finally(() => {
      if (inflightScenarioLists.get(key) === run) inflightScenarioLists.delete(key);
    });
  },

  get: (runId: string) =>
    scenarioRequest<{ run: ScenarioRun }>('get', { runId }),

  create: (args: { requestId: string; scenarioId: ScenarioId; title?: string; brief?: Record<string, string | string[]>; locale?: string }) =>
    scenarioRequest<{ run: ScenarioRun }>('create', args),

  updateRun: (args: { runId: string; expectedRevision: number; requestId: string; changes: { title?: string; archived?: boolean; activeStepId?: string } }) =>
    scenarioRequest<{ run: ScenarioRun }>('update_run', args),

  updateBrief: (args: { runId: string; expectedRevision: number; requestId: string; brief: Record<string, string | string[]> }) =>
    scenarioRequest<{ run: ScenarioRun }>('update_brief', args),

  updateStep: (args: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    stepId: string;
    status?: ScenarioStepState['status'];
    draft?: Record<string, unknown>;
    bindings?: Record<string, string[]>;
    activeIterationId?: string | null;
    iterationNote?: { iterationId: string; note: string };
  }) =>
    scenarioRequest<{ run: ScenarioRun }>('update_step', args),

  addPool: (args: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    items: { ref: PoolRef; label?: string; tags?: string[]; stepId?: string | null; source: PoolItem['source'] }[];
  }) =>
    scenarioRequest<{ run: ScenarioRun; poolItemIds: string[] }>('add_pool', args),

  updatePool: (args: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    poolItemId: string;
    changes: { label?: string; tags?: string[]; pinned?: boolean };
  }) =>
    scenarioRequest<{ run: ScenarioRun }>('update_pool', args),

  removePool: (args: { runId: string; expectedRevision: number; requestId: string; poolItemId: string }) =>
    scenarioRequest<{ run: ScenarioRun }>('remove_pool', args),

  addIteration: (args: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    stepId: string;
    iteration: {
      source: StepIteration['source'];
      prompt?: string;
      settings?: Record<string, unknown>;
      inputs?: string[];
      outputs?: IterationOutput[];
      note?: string;
    };
  }) =>
    scenarioRequest<{ run: ScenarioRun; iteration: StepIteration }>('add_iteration', args),

  generate: (args: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    stepId: string;
    modality: 'image' | 'video' | 'audio';
    model: string;
    mode?: 'text-to-image' | 'text-to-video' | 'text-to-audio' | 'text-to-speech';
    prompt: string;
    parameters?: Record<string, unknown>;
    referencePoolItemIds?: string[];
    scene?: string;
    locale?: string;
  }) =>
    scenarioRequest<{ run: ScenarioRun; job: Record<string, unknown>; iteration: StepIteration }>('generate', args),

  sync: (runId: string) =>
    scenarioRequest<{ run: ScenarioRun }>('sync', { runId }),

  cancel: (args: { runId: string; expectedRevision: number; requestId: string; stepId: string; iterationId: string }) =>
    scenarioRequest<{ run: ScenarioRun; job: Record<string, unknown> }>('cancel', args),

  promote: (args: { runId: string; expectedRevision: number; requestId: string; stepId: string; iterationId: string }) =>
    scenarioRequest<{ run: ScenarioRun }>('promote', args),

  createPage: (args: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    stepId: string;
    mode: 'starter' | 'template' | 'blank';
    templateId?: string;
    title?: string;
  }) =>
    scenarioRequest<{ run: ScenarioRun; project: DesignProjectDetail }>('create_page', args),

  embedImage: (args: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    stepId: string;
    designProjectId: string;
    expectedDesignRevision: string;
    poolItemId: string;
    target: EmbedImageTarget;
    alt?: string;
  }) =>
    scenarioRequest<{ run: ScenarioRun; project: DesignProjectDetail; version: DesignVersion; path: string }>('embed_image', args),

  linkDesign: (args: { runId: string; expectedRevision: number; requestId: string; stepId: string; designProjectId: string }) =>
    scenarioRequest<{ run: ScenarioRun; project: DesignProjectDetail }>('link_design', args),

  createMotion: (args: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    stepId: string;
    projectType: 'template' | 'natural_language';
    templateId?: string;
    title: string;
    requirements?: string;
    poolItemIds?: string[];
  }) =>
    scenarioRequest<{ run: ScenarioRun; project: { projectId: string; sessionId: string | null; previewUrl: string } }>('create_motion', args),

  linkMotion: (args: { runId: string; expectedRevision: number; requestId: string; stepId: string; projectId: string }) =>
    scenarioRequest<{ run: ScenarioRun }>('link_motion', args),

  export: (args: {
    runId: string;
    requestId: string;
    locale?: string;
    stepIds?: string[];
    poolItemIds?: string[];
    activeOnly?: boolean;
    includeStandaloneHtml?: boolean;
    includeMotionSource?: boolean;
  }) =>
    scenarioRequest<{ bundle: ScenarioBundleReceipt }>('export', args),
};

export const bundleDownloadUrl = (bundleId: string) =>
  `/motion-api/scenarios/bundles/${encodeURIComponent(bundleId)}/file`;

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
