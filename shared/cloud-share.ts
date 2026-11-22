export const CLOUD_SHARE_API = '/motion-api/cloud-share';

export type CloudShareKind = 'game-project' | 'design-project';
export type CloudShareStatus = 'none' | 'active' | 'stopped';
export type CloudShareFreshness = 'fresh' | 'outdated' | 'unknown';

export interface CloudShareSnapshot {
  kind: CloudShareKind;
  projectId: string;
  title: string;
  accountState: 'signed-out' | 'authorizing' | 'signed-in' | 'reauth-required' | 'unavailable';
  accountEmail?: string;
  workspaceName?: string;
  status: CloudShareStatus;
  url: string | null;
  slug?: string;
  version?: number;
  publishedAt?: number;
  freshness: CloudShareFreshness;
  fileCount: number;
  totalBytes: number;
  bundledAssetCount: number;
  multiplayer?: boolean;
  entryPath: string;
}

const SAFE_SHARE_SLUG = /^[A-Za-z0-9_-]{8,128}$/;

export function cloudProjectIdForShare(kind: CloudShareKind, projectId: string): string {
  return kind === 'game-project' ? `om-game-${projectId}` : `om-design-${projectId}`;
}

export function buildCloudSharePath(cloudProjectId: string, slug: string): string {
  return `/artifact/${encodeURIComponent(cloudProjectId)}/${encodeURIComponent(slug)}`;
}

/**
 * Accept a reported public Viewer URL only when it uses clean HTTPS root-origin
 * formatting without userinfo/query/hash and matches `/artifact/{cloudProjectId}/{slug}`
 * verbatim, mirroring OpenDesign's share-link verification rule.
 */
export function verifiedAmrShareViewerUrl(raw: unknown, cloudProjectId: string, slug: string): string | null {
  const trimmedProjectId = cloudProjectId.trim();
  if (
    typeof raw !== 'string'
    || !trimmedProjectId
    || trimmedProjectId === '.'
    || trimmedProjectId === '..'
    || !SAFE_SHARE_SLUG.test(slug)
  ) {
    return null;
  }
  if (raw.slice(0, 8).toLowerCase() !== 'https://') return null;
  const pathStart = raw.indexOf('/', 8);
  if (pathStart < 0) return null;
  const rawOrigin = raw.slice(0, pathStart);
  if (rawOrigin.includes('@') || rawOrigin.includes('?') || rawOrigin.includes('#')) return null;
  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(rawOrigin).origin;
  } catch {
    return null;
  }
  if (parsedOrigin !== rawOrigin) return null;
  const expected = new URL(buildCloudSharePath(trimmedProjectId, slug), parsedOrigin).href;
  return expected === raw ? raw : null;
}
