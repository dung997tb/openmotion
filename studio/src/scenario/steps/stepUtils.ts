import {
  scenarioAgentPrompt,
  scenarioRunAgentPrompt,
  type PoolKind,
  type ScenarioDefinition,
  type ScenarioPromptIntegration,
} from '../../../../shared/scenarios';
import type { ScenarioRun, ScenarioStepState, StepIteration } from '../../../../shared/scenario-runs';
import { ScenarioApiError } from '../scenarioClient';

export const POOL_DRAG_MIME = 'application/x-om-pool-item';

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to failure result; callers notify via Toast.
  }
  return false;
}

export function triggerUrlDownload(url: string, filename?: string): void {
  const link = document.createElement('a');
  link.href = url;
  if (filename) link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function poolKindIcon(kind: PoolKind): string {
  switch (kind) {
    case 'image': return 'image-line';
    case 'video': return 'movie-line';
    case 'audio': return 'music-2-line';
    case 'page': return 'layout-line';
    case 'motion': return 'clapperboard-line';
    case 'text': return 'file-text-line';
  }
}

export function poolKindLabel(kind: PoolKind): string {
  switch (kind) {
    case 'image': return 'Image';
    case 'video': return 'Video';
    case 'audio': return 'Audio';
    case 'page': return 'Page';
    case 'motion': return 'Motion';
    case 'text': return 'Text';
  }
}

export function stepStatusLabel(status: ScenarioStepState['status']): string {
  switch (status) {
    case 'todo': return 'To do';
    case 'in-progress': return 'In progress';
    case 'done': return 'Done';
    case 'skipped': return 'Skipped';
  }
}

export function jobStateLabel(state: NonNullable<StepIteration['job']>['state']): string {
  switch (state) {
    case 'queued': return 'Queued';
    case 'running': return 'Running';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
  }
}

export function isScenarioConflictError(error: unknown): boolean {
  return error instanceof ScenarioApiError && error.code === 'SCENARIO_CONFLICT';
}

export function parsePriceNumber(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[^0-9.,]/g, '');
  if (!cleaned) return null;
  const normalized = cleaned.includes(',') && !cleaned.includes('.')
    ? cleaned.replace(',', '.')
    : cleaned.replace(/,/g, '');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function computeDiscountSummary(
  originalRaw: unknown,
  saleRaw: unknown,
  discountRaw: unknown,
): { percent: number | null; savings: number | null; label: string } | null {
  const orig = parsePriceNumber(originalRaw);
  const sale = parsePriceNumber(saleRaw);
  if (orig !== null && sale !== null && orig > sale) {
    const percent = Math.round(((orig - sale) / orig) * 100);
    const savings = Math.round((orig - sale) * 100) / 100;
    return { percent, savings, label: `${percent}% OFF` };
  }
  const manual = typeof discountRaw === 'string' ? discountRaw.trim() : '';
  if (manual) {
    return { percent: null, savings: null, label: manual };
  }
  return null;
}

export function buildStepAgentPrompt(
  scenario: ScenarioDefinition,
  run: ScenarioRun | null,
  options: { stepId?: string; stepPrompt?: string; locale?: string | null; integration?: ScenarioPromptIntegration | null } = {},
): string {
  if (run) {
    return scenarioRunAgentPrompt(scenario, run, options);
  }
  return scenarioAgentPrompt(scenario, { locale: options.locale, integration: options.integration });
}

export function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

export function briefStringValue(brief: Record<string, string | string[]>, key: string): string {
  const val = brief[key];
  if (Array.isArray(val)) return val.filter(Boolean).join(', ');
  return typeof val === 'string' ? val : '';
}
