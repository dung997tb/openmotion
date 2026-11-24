import { isMain } from '../shared/entry.ts';
import { createLogger } from '../src/infra/logger.ts';
import { StorageService, resolveCorsAllowedOrigins } from '../src/infra/storage.ts';

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Idempotently ensure the S3 bucket exists and apply the canonical CORS rule
 * required for browser direct PUT uploads and 302 presigned GET media/thumbnail playback.
 */
export async function initS3Bucket(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const logger = createLogger({ bindings: { service: 's3-init' } });
  const bucket = env.S3_BUCKET?.trim() || 'openmotion';
  const region = env.S3_REGION?.trim() || 'us-east-1';
  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  const publicEndpoint = env.S3_PUBLIC_ENDPOINT?.trim() || undefined;
  const publicOrigin = env.APP_PUBLIC_ORIGIN?.trim() || 'http://127.0.0.1:4173';
  const extraOrigins = (env.S3_CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (env.PREVIEW_PUBLIC_ORIGIN?.trim()) {
    extraOrigins.push(new URL(env.PREVIEW_PUBLIC_ORIGIN).origin);
  }
  const allowedOrigins = resolveCorsAllowedOrigins(publicOrigin, extraOrigins);

  const storage = new StorageService({
    bucket,
    region,
    endpoint,
    publicEndpoint,
    accessKeyId: env.S3_ACCESS_KEY_ID?.trim() || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY?.trim() || undefined,
    forcePathStyle: envBoolean(env.S3_FORCE_PATH_STYLE, true),
    publicOrigin,
  });

  try {
    await storage.ensureBucketAndCors(allowedOrigins);
    logger.info('S3 bucket and CORS configuration verified', {
      bucket,
      region,
      endpoint: endpoint ?? 'aws-default',
      allowedOrigins,
    });
  } finally {
    storage.close();
  }
}

if (isMain(import.meta.url)) {
  initS3Bucket().catch((error) => {
    const logger = createLogger({ bindings: { service: 's3-init' } });
    logger.error('Failed to initialize S3 bucket and CORS', { error });
    process.exitCode = 1;
  });
}
