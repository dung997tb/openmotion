export const CLOUD_ERROR_CODES = [
  'FEATURE_DEFERRED_P2',
  'REVISION_CONFLICT',
  'VERSION_CONFLICT',
  'WORKSPACE_FORBIDDEN',
  'QUOTA_EXCEEDED',
  'UNAUTHORIZED',
  'AUTH_UNAVAILABLE',
  'FORBIDDEN',
  'INSUFFICIENT_SCOPE',
  'PROJECT_GRANT_REQUIRED',
  'NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'PROJECT_TRASHED',
  'SESSION_NOT_FOUND',
  'ASSET_NOT_FOUND',
  'ASSET_VERSION_UNAVAILABLE',
  'EXPORT_BUSY',
  'EXPORT_NOT_FOUND',
  'REQUEST_ID_CONFLICT',
  'INVALID_ARGUMENT',
  'INVALID_PATH',
  'SSRF_BLOCKED',
  'RATE_LIMITED',
  'STORAGE_ERROR',
  'SERVICE_UNAVAILABLE',
  'BLOB_GC_IN_PROGRESS',
  'TEMPLATE_NOT_COPYABLE',
  'TEMPLATE_MEDIA_UNAVAILABLE',
] as const;

export type CloudErrorCode = (typeof CLOUD_ERROR_CODES)[number];

export type CloudErrorOptions = {
  status?: number;
  details?: Record<string, unknown>;
  applied?: boolean | 'unknown';
  cause?: unknown;
};

export function externalAuthErrorCode(code: CloudErrorCode): string | undefined {
  switch (code) {
    case 'UNAUTHORIZED':
      return 'auth_required';
    case 'INSUFFICIENT_SCOPE':
      return 'insufficient_scope';
    case 'PROJECT_NOT_FOUND':
      return 'project_not_found';
    case 'PROJECT_GRANT_REQUIRED':
      return 'project_grant_required';
    case 'AUTH_UNAVAILABLE':
      return 'auth_unavailable';
    default:
      return undefined;
  }
}

export class CloudError extends Error {
  readonly code: CloudErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly applied?: boolean | 'unknown';

  constructor(code: CloudErrorCode, message: string, options: CloudErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'CloudError';
    this.code = code;
    this.status = options.status ?? defaultStatusForErrorCode(code);
    this.details = options.details;
    this.applied = options.applied;
  }

  toJSON(): Record<string, unknown> {
    const ext = externalAuthErrorCode(this.code);
    return {
      code: this.code,
      ...(ext ? { errorCode: ext } : {}),
      error: this.message,
      ...(this.applied !== undefined ? { applied: this.applied } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function defaultStatusForErrorCode(code: CloudErrorCode): number {
  switch (code) {
    case 'FEATURE_DEFERRED_P2':
      return 501;
    case 'REVISION_CONFLICT':
    case 'VERSION_CONFLICT':
    case 'EXPORT_BUSY':
    case 'REQUEST_ID_CONFLICT':
    case 'BLOB_GC_IN_PROGRESS':
      return 409;
    case 'UNAUTHORIZED':
      return 401;
    case 'WORKSPACE_FORBIDDEN':
    case 'FORBIDDEN':
    case 'INSUFFICIENT_SCOPE':
    case 'PROJECT_GRANT_REQUIRED':
      return 403;
    case 'NOT_FOUND':
    case 'PROJECT_NOT_FOUND':
    case 'SESSION_NOT_FOUND':
    case 'ASSET_NOT_FOUND':
    case 'ASSET_VERSION_UNAVAILABLE':
    case 'EXPORT_NOT_FOUND':
      return 404;
    case 'QUOTA_EXCEEDED':
    case 'RATE_LIMITED':
      return 429;
    case 'SERVICE_UNAVAILABLE':
    case 'AUTH_UNAVAILABLE':
      return 503;
    case 'STORAGE_ERROR':
      return 502;
    case 'INVALID_ARGUMENT':
    case 'INVALID_PATH':
    case 'PROJECT_TRASHED':
    case 'SSRF_BLOCKED':
    case 'TEMPLATE_NOT_COPYABLE':
    case 'TEMPLATE_MEDIA_UNAVAILABLE':
      return 400;
  }
}

export function isCloudError(error: unknown): error is CloudError {
  return error instanceof CloudError;
}

export function featureDeferredP2(feature: string): CloudError {
  return new CloudError(
    'FEATURE_DEFERRED_P2',
    `${feature} is deferred to cloud phase 2 and is not enabled in P1.`,
    { status: 501, applied: false, details: { feature } },
  );
}

export function revisionConflict(details?: { currentRevision?: string; currentVersionId?: string }): CloudError {
  return new CloudError(
    'REVISION_CONFLICT',
    'Project has been updated; reload the latest revision and versionId before retrying.',
    { status: 409, applied: false, details },
  );
}

export function workspaceForbidden(message = 'Access to the requested workspace is forbidden.'): CloudError {
  return new CloudError('WORKSPACE_FORBIDDEN', message, { status: 403, applied: false });
}

export function quotaExceeded(message: string, details?: Record<string, unknown>): CloudError {
  return new CloudError('QUOTA_EXCEEDED', message, { status: 429, applied: false, details });
}
