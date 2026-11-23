import type { GatewayStatus, Model } from '../../../shared/gateway';
import { isClientCacheEnabled } from '../utils/clientCacheMode';

export const GATEWAY_CACHE_TTL_MS = 30_000;

let cacheGeneration = 0;
let cachedGateway: { value: { status: GatewayStatus; models: Model[] }; expiresAt: number } | null = null;

export function getGatewayCacheGeneration(): number {
  return cacheGeneration;
}

/** Returns the last cached gateway snapshot (even if stale) for instant Frame-0 UI prefill. */
export function peekCachedGateway(): { status: GatewayStatus; models: Model[] } | undefined {
  if (!isClientCacheEnabled()) return undefined;
  return cachedGateway?.value;
}

export function getFreshCachedGateway(): { status: GatewayStatus; models: Model[] } | undefined {
  if (!isClientCacheEnabled() || !cachedGateway) return undefined;
  if (cachedGateway.expiresAt <= Date.now()) return undefined;
  return cachedGateway.value;
}

export function saveCachedGateway(
  value: { status: GatewayStatus; models: Model[] },
  generation: number,
): void {
  if (!isClientCacheEnabled() || generation !== cacheGeneration) return;
  cachedGateway = { value, expiresAt: Date.now() + GATEWAY_CACHE_TTL_MS };
}

export function clearGatewayCacheState(): void {
  cacheGeneration++;
  cachedGateway = null;
}
