export type DeferredP2Code =
  | 'FEATURE_DEFERRED_P2'
  | 'DESIGN_STUDIO_CLOUD_P2'
  | 'ASR_PROVIDER_UNCONFIGURED';

const DEFERRED_P2_CODES = new Set<string>([
  'FEATURE_DEFERRED_P2',
  'DESIGN_STUDIO_CLOUD_P2',
  'ASR_PROVIDER_UNCONFIGURED',
  'FEATURE_UNAVAILABLE_IN_P1',
]);

export function isDeferredP2Payload(status?: number, data?: { code?: unknown; error?: unknown } | null): boolean {
  if (status === 501) return true;
  if (!data || typeof data !== 'object') return false;
  if (typeof data.code === 'string' && DEFERRED_P2_CODES.has(data.code)) return true;
  if (data.error && typeof data.error === 'object' && 'code' in data.error) {
    const nested = (data.error as { code?: unknown }).code;
    if (typeof nested === 'string' && DEFERRED_P2_CODES.has(nested)) return true;
  }
  if (typeof data.error === 'string' && /(?:FEATURE_DEFERRED_P2|DESIGN_STUDIO_CLOUD_P2|ASR_PROVIDER_UNCONFIGURED)/.test(data.error)) {
    return true;
  }
  return false;
}

export function isDeferredP2Error(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (candidate.status === 501) return true;
  if (typeof candidate.code === 'string' && DEFERRED_P2_CODES.has(candidate.code)) return true;
  if (typeof candidate.message === 'string' && /(?:FEATURE_DEFERRED_P2|DESIGN_STUDIO_CLOUD_P2|ASR_PROVIDER_UNCONFIGURED|deferred to P2|scheduled for P2)/i.test(candidate.message)) {
    return true;
  }
  return false;
}
