import { createHash, randomBytes } from 'node:crypto';
import type { AuthKeyValueCache } from './store.ts';

// Asset URLs are embedded in CSS, media elements and import maps. Their path
// stays stable while authenticated Studio renews the project's read lease.
export function isAssetLease(value: unknown): value is string {
  return typeof value === 'string' && /^om_pl_[A-Za-z0-9_-]{43}$/.test(value);
}

function leaseKey(projectId: string, lease: string): string {
  return `preview-assets:${projectId}:${createHash('sha256').update(lease).digest('hex')}`;
}

export function resolveAssetWorkspace(cache: AuthKeyValueCache, projectId: string, lease: string): Promise<string | null> {
  return cache.get(leaseKey(projectId, lease));
}

export async function renewAssetLease(
  cache: AuthKeyValueCache,
  workspaceId: string,
  projectId: string,
  requested: true | string,
  ttlSec: number,
): Promise<string> {
  const reusable = isAssetLease(requested) && await resolveAssetWorkspace(cache, projectId, requested) === workspaceId;
  const lease = reusable ? requested : `om_pl_${randomBytes(32).toString('base64url')}`;
  await cache.set(leaseKey(projectId, lease), workspaceId, ttlSec);
  return lease;
}
