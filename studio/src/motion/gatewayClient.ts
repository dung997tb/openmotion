import type { GatewayStatus, Model, GenerationJob, GenerateInput } from '../../../shared/gateway';
import { classifyAuthHttpError, notifyAuthRecovery } from './authRecoveryStore';
export type { GatewayStatus, Model, GenerationJob, GenerateInput, Modality, GeneratedAsset } from '../../../shared/gateway';

export type CloudApiError = Error & {
  status?: number;
  code?: string;
  errorCode?: string;
  applied?: boolean;
};

export async function gatewayRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/motion-api/' + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON response body.
  }
  if (!response.ok) {
    const message = typeof data.error === 'string'
      ? data.error
      : data.error && typeof data.error === 'object' && typeof (data.error as { message?: unknown }).message === 'string'
        ? String((data.error as { message: string }).message)
        : `Model gateway request failed (${response.status})`;
    const code = typeof data.code === 'string'
      ? data.code
      : data.error && typeof data.error === 'object' && typeof (data.error as { code?: unknown }).code === 'string'
        ? String((data.error as { code: string }).code)
        : undefined;
    const error = new Error(message) as CloudApiError;
    error.status = response.status;
    if (code) error.code = code;
    if (typeof data.errorCode === 'string') error.errorCode = data.errorCode;
    if (data.applied === false) error.applied = false;
    const authRecovery = classifyAuthHttpError(response.status, data, message);
    const isMutating = method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD';
    if (authRecovery && (authRecovery.kind === 'auth_unavailable' || isMutating)) {
      notifyAuthRecovery(authRecovery);
    }
    throw error;
  }
  return data as T;
}

export async function loadModels(options?: { refresh?: boolean }): Promise<Model[]> {
  const models: Model[] = [];
  let offset: number | null = 0;
  do {
    const query = new URLSearchParams({ offset: String(offset) });
    if (options?.refresh) query.set('refresh', 'true');
    const page: { models?: Model[]; nextOffset?: number | null } = await gatewayRequest(`models?${query.toString()}`);
    if (Array.isArray(page.models)) models.push(...page.models);
    offset = typeof page.nextOffset === 'number' ? page.nextOffset : null;
  } while (offset !== null && models.length < 5000);
  return models;
}

function normalizeStatus(raw: Partial<GatewayStatus> | null | undefined): GatewayStatus {
  return {
    providers: Array.isArray(raw?.providers) ? raw.providers : [],
    agents: Array.isArray(raw?.agents) ? raw.agents : [],
    routes: raw?.routes && typeof raw.routes === 'object' ? raw.routes : {},
    capabilities: Array.isArray(raw?.capabilities) ? raw.capabilities : [],
  };
}

export async function loadGateway(): Promise<{ status: GatewayStatus; models: Model[]; mode?: 'opendesign' | 'mock' }> {
  const [rawStatus, catalog] = await Promise.all([
    gatewayRequest<Partial<GatewayStatus>>('models/status')
      .then(res => (Array.isArray(res?.providers) ? res : gatewayRequest<Partial<GatewayStatus>>('models/capabilities').catch(() => res)))
      .catch(() => gatewayRequest<Partial<GatewayStatus>>('models/capabilities')),
    gatewayRequest<{ models?: Model[]; mode?: 'opendesign' | 'mock' }>('models/catalog')
      .then(async res => (Array.isArray(res?.models) ? res : { models: await loadModels(), mode: res?.mode }))
      .catch(async () => ({ models: await loadModels(), mode: undefined })),
  ]);
  return {
    status: normalizeStatus(rawStatus),
    models: Array.isArray(catalog.models) ? catalog.models : [],
    mode: catalog.mode,
  };
}

/** Shared entry point for future property panels and other editor consumers. */
export function generateAsset(input: GenerateInput) {
  return gatewayRequest<{ job: GenerationJob }>('models/generate', 'POST', input);
}
