import { CLOUD_SHARE_API, type CloudShareKind, type CloudShareSnapshot } from '../../../shared/cloud-share';

export class CloudShareRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'CloudShareRequestError';
    this.status = status;
    this.code = code;
  }
}

async function requestCloudShare(path: string, init?: RequestInit): Promise<CloudShareSnapshot> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => null)) as
    | (CloudShareSnapshot & { error?: string; code?: string })
    | { error?: string; code?: string }
    | null;
  if (!response.ok) {
    throw new CloudShareRequestError(
      body?.error || `Cloud share HTTP ${response.status}`,
      response.status,
      body?.code,
    );
  }
  return body as CloudShareSnapshot;
}

export function getCloudShareStatus(kind: CloudShareKind, projectId: string): Promise<CloudShareSnapshot> {
  return requestCloudShare(`${CLOUD_SHARE_API}/${encodeURIComponent(kind)}/${encodeURIComponent(projectId)}`);
}

export function publishCloudShare(kind: CloudShareKind, projectId: string): Promise<CloudShareSnapshot> {
  return requestCloudShare(`${CLOUD_SHARE_API}/${encodeURIComponent(kind)}/${encodeURIComponent(projectId)}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function stopCloudShare(kind: CloudShareKind, projectId: string): Promise<CloudShareSnapshot> {
  return requestCloudShare(`${CLOUD_SHARE_API}/${encodeURIComponent(kind)}/${encodeURIComponent(projectId)}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function resumeCloudShare(kind: CloudShareKind, projectId: string): Promise<CloudShareSnapshot> {
  return requestCloudShare(`${CLOUD_SHARE_API}/${encodeURIComponent(kind)}/${encodeURIComponent(projectId)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}
