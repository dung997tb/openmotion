import { Hono, type Context } from 'hono';
import type { BlobScope } from '../../contracts/storage.ts';
import {
  assertTenantScopedKey,
  catalogCompFilmstripKey,
  derivedAssetKey,
} from '../../infra/storage.ts';
import { isSha256Hex } from '../../../shared/project-validation.ts';
import { getBuiltinCompositionFilmstrip } from '../../services/builtin-filmstrip-store.ts';
import { normalizeSafeProjectPath } from '../../services/project-files-service.ts';
import {
  extractWildcardPath,
  getAuthContext,
  type DisklessStudioDeps,
  type StudioVariables,
} from '../context.ts';
import {
  embedFilmstripComment,
  extractFilmstripMeta,
  FILMSTRIP_HEADER_ASPECT,
  FILMSTRIP_HEADER_FRAMES,
  FILMSTRIP_HEADER_HEIGHT,
  FILMSTRIP_HEADER_SCOPE,
  FILMSTRIP_HEADER_SHA256,
  FILMSTRIP_HEADER_SOURCE,
  FILMSTRIP_HEADER_WIDTH,
  MAX_FILMSTRIP_JPEG_BYTES,
  validateFilmstripMeta,
  WORKSPACE_FILMSTRIP_DERIVED_NAME,
  WORKSPACE_PATCH_FILMSTRIP_DERIVED_NAME,
  type CompositionFilmstripMeta,
} from '../engine/composition-filmstrip-sprite.ts';

type FilmstripCacheSource = 'builtin' | 'catalog' | 'workspace';

function isHtmlCompositionFile(file: { isText: boolean; path: string }): boolean {
  return file.isText && /\.html?$/i.test(file.path);
}

function workspaceFilmstripKey(workspaceId: string, sha256: string, blobScope: BlobScope): string {
  const derivedName =
    blobScope === 'patch'
      ? WORKSPACE_PATCH_FILMSTRIP_DERIVED_NAME
      : WORKSPACE_FILMSTRIP_DERIVED_NAME;
  return assertTenantScopedKey(workspaceId, derivedAssetKey(workspaceId, sha256, derivedName));
}

async function readValidatedS3Filmstrip(
  deps: DisklessStudioDeps,
  s3Key: string,
): Promise<{ bytes: Buffer; meta: CompositionFilmstripMeta } | null> {
  try {
    const head = await deps.storage.headObject(s3Key);
    if (!head || head.contentLength <= 0 || head.contentLength > MAX_FILMSTRIP_JPEG_BYTES) {
      return null;
    }
    const bytes = await deps.storage.getObjectBuffer(s3Key, MAX_FILMSTRIP_JPEG_BYTES);
    const meta = extractFilmstripMeta(bytes);
    if (!meta) return null;
    return { bytes, meta };
  } catch {
    return null;
  }
}

function parseStrictPositiveInt(raw: string | undefined): number {
  if (!raw || !/^\d{1,4}$/.test(raw.trim())) return Number.NaN;
  return Number.parseInt(raw.trim(), 10);
}

function parseOptionalPositiveFloat(raw: string | undefined): number | undefined {
  if (!raw || !raw.trim()) return undefined;
  const parsed = Number.parseFloat(raw.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; status: 400 | 413 }> {
  const declaredLen = request.headers.get('content-length');
  if (declaredLen !== null) {
    const parsed = Number(declaredLen);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      return { ok: false, status: 413 };
    }
  }
  const reader = request.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.byteLength === 0) return { ok: false, status: 400 };
    if (buf.byteLength > maxBytes) return { ok: false, status: 413 };
    return { ok: true, buffer: buf };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413 };
    }
    chunks.push(Buffer.from(value));
  }
  if (total === 0) return { ok: false, status: 400 };
  return { ok: true, buffer: Buffer.concat(chunks, total) };
}

export function createStudioCompositionFilmstripsRoutes(
  deps: DisklessStudioDeps,
): Hono<{ Variables: StudioVariables }> {
  const app = new Hono<{ Variables: StudioVariables }>();

  async function resolveFilmstripHit(
    workspaceId: string,
    file: { blobScope: BlobScope; sha256: string },
  ): Promise<{ bytes: Buffer; meta: CompositionFilmstripMeta; source: FilmstripCacheSource } | null> {
    if (file.blobScope === 'catalog') {
      const builtin = await getBuiltinCompositionFilmstrip(file.sha256, deps.runtimeRoot);
      if (builtin) {
        return { bytes: builtin.bytes, meta: builtin.meta, source: 'builtin' };
      }
      const catalogKey = assertTenantScopedKey(
        workspaceId,
        catalogCompFilmstripKey(file.sha256),
        { allowCatalog: true },
      );
      const catalogHit = await readValidatedS3Filmstrip(deps, catalogKey);
      if (catalogHit) {
        return { ...catalogHit, source: 'catalog' };
      }
    }

    const wsKey = workspaceFilmstripKey(workspaceId, file.sha256, file.blobScope);
    const workspaceHit = await readValidatedS3Filmstrip(deps, wsKey);
    if (workspaceHit) {
      return { ...workspaceHit, source: 'workspace' };
    }
    return null;
  }

  const handleGetFilmstrip = async (c: Context<{ Variables: StudioVariables }>) => {
    const auth = await getAuthContext(c, deps, { scope: 'projects:read' });
    const projectId = c.req.param('id') ?? '';
    const rawPath = extractWildcardPath(c.req.url, '/composition-filmstrip/');
    const safePath = normalizeSafeProjectPath(rawPath || 'index.html');
    const file = await deps.files.getFile(auth, projectId, safePath);
    if (!file || !isHtmlCompositionFile(file)) {
      return c.req.method === 'HEAD'
        ? c.body(null, 404)
        : c.json({ error: 'Composition file not found', path: safePath }, 404);
    }
    const fileSha = file.sha256.trim();
    if (!isSha256Hex(fileSha)) {
      c.header('Cache-Control', 'no-store');
      return c.body(null, 204);
    }

    const hit = await resolveFilmstripHit(auth.workspaceId, { blobScope: file.blobScope, sha256: fileSha });
    if (!hit) {
      c.header('Cache-Control', 'no-store');
      c.header(FILMSTRIP_HEADER_SHA256, fileSha);
      c.header(FILMSTRIP_HEADER_SCOPE, file.blobScope);
      return c.body(null, 204);
    }

    const etag = `"omfs-v1:${file.blobScope}:${fileSha}:${hit.meta.frameCount}"`;
    c.header('Content-Type', 'image/jpeg');
    c.header('Content-Length', String(hit.bytes.byteLength));
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, no-cache');
    c.header('Vary', 'Cookie, Authorization');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header(FILMSTRIP_HEADER_FRAMES, String(hit.meta.frameCount));
    c.header(FILMSTRIP_HEADER_WIDTH, String(hit.meta.frameWidth));
    c.header(FILMSTRIP_HEADER_HEIGHT, String(hit.meta.frameHeight));
    c.header(FILMSTRIP_HEADER_ASPECT, hit.meta.aspect.toFixed(4));
    c.header(FILMSTRIP_HEADER_SHA256, fileSha);
    c.header(FILMSTRIP_HEADER_SCOPE, file.blobScope);
    c.header(FILMSTRIP_HEADER_SOURCE, hit.source);

    if (c.req.header('if-none-match')?.trim() === etag) {
      return c.body(null, 304);
    }
    if (c.req.method === 'HEAD') {
      return c.body(null, 200);
    }
    return c.body(new Uint8Array(hit.bytes), 200);
  };

  const handlePutFilmstrip = async (c: Context<{ Variables: StudioVariables }>) => {
    const auth = await getAuthContext(c, deps, { scope: 'projects:write', minRole: 'editor' });
    const projectId = c.req.param('id') ?? '';
    const rawPath = extractWildcardPath(c.req.url, '/composition-filmstrip/');
    const safePath = normalizeSafeProjectPath(rawPath || 'index.html');
    const file = await deps.files.getFile(auth, projectId, safePath);
    if (!file || !isHtmlCompositionFile(file)) {
      return c.json({ error: 'Composition file not found', path: safePath }, 404);
    }
    const fileSha = file.sha256.trim();

    const expectedSha = c.req.header(FILMSTRIP_HEADER_SHA256)?.trim() ?? '';
    if (!isSha256Hex(expectedSha)) {
      return c.json({ error: 'Valid x-openmotion-filmstrip-sha256 header is required' }, 400);
    }
    const expectedScope = c.req.header(FILMSTRIP_HEADER_SCOPE)?.trim();
    if (expectedSha !== fileSha || (expectedScope && expectedScope !== file.blobScope)) {
      return c.json(
        {
          stored: false,
          reason: 'version_mismatch',
          currentSha256: fileSha,
          currentScope: file.blobScope,
        },
        409,
      );
    }

    const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'image/jpeg') {
      return c.json({ error: 'Content-Type must be image/jpeg' }, 415);
    }

    const rawAspect = parseOptionalPositiveFloat(c.req.header(FILMSTRIP_HEADER_ASPECT));
    if (rawAspect !== undefined && Number.isNaN(rawAspect)) {
      return c.json({ error: 'Invalid x-openmotion-filmstrip-aspect header' }, 400);
    }
    const meta = validateFilmstripMeta({
      frameCount: parseStrictPositiveInt(c.req.header(FILMSTRIP_HEADER_FRAMES)),
      frameWidth: parseStrictPositiveInt(c.req.header(FILMSTRIP_HEADER_WIDTH)),
      frameHeight: parseStrictPositiveInt(c.req.header(FILMSTRIP_HEADER_HEIGHT)),
      aspect: rawAspect,
    });
    if (!meta) {
      return c.json({ error: 'Invalid filmstrip dimension or frame count headers' }, 400);
    }

    const bodyResult = await readBoundedRequestBody(c.req.raw, MAX_FILMSTRIP_JPEG_BYTES);
    if (!bodyResult.ok) {
      return c.json(
        {
          error:
            bodyResult.status === 413
              ? `Filmstrip sprite exceeds maximum size of ${MAX_FILMSTRIP_JPEG_BYTES} bytes`
              : 'Filmstrip body is required',
        },
        bodyResult.status,
      );
    }

    const canonicalBytes = embedFilmstripComment(bodyResult.buffer, meta);
    if (!canonicalBytes) {
      return c.json(
        { error: 'Filmstrip body must be a valid JPEG matching declared frame dimensions' },
        400,
      );
    }

    // Do not duplicate an equal-or-higher resolution pre-baked catalog filmstrip into workspace S3.
    if (file.blobScope === 'catalog') {
      const builtin = await getBuiltinCompositionFilmstrip(fileSha, deps.runtimeRoot);
      if (builtin && builtin.meta.frameCount >= meta.frameCount) {
        return c.json(
          {
            stored: false,
            reason: 'already_cached',
            source: 'builtin',
            frameCount: builtin.meta.frameCount,
            sha256: fileSha,
          },
          200,
        );
      }
      const catalogKey = assertTenantScopedKey(
        auth.workspaceId,
        catalogCompFilmstripKey(fileSha),
        { allowCatalog: true },
      );
      const catalogHit = await readValidatedS3Filmstrip(deps, catalogKey);
      if (catalogHit && catalogHit.meta.frameCount >= meta.frameCount) {
        return c.json(
          {
            stored: false,
            reason: 'already_cached',
            source: 'catalog',
            frameCount: catalogHit.meta.frameCount,
            sha256: fileSha,
          },
          200,
        );
      }
    }

    // Client write-backs strictly target this workspace's tenant-scoped derived keyspace (never catalog/*).
    const wsKey = workspaceFilmstripKey(auth.workspaceId, fileSha, file.blobScope);
    const existing = await readValidatedS3Filmstrip(deps, wsKey);
    if (existing && existing.meta.frameCount >= meta.frameCount) {
      return c.json(
        {
          stored: false,
          reason: 'already_cached',
          source: 'workspace',
          frameCount: existing.meta.frameCount,
          sha256: fileSha,
        },
        200,
      );
    }

    await deps.storage.putObject(wsKey, canonicalBytes, 'image/jpeg', canonicalBytes.byteLength);
    return c.json(
      {
        stored: true,
        source: 'workspace',
        frameCount: meta.frameCount,
        bytes: canonicalBytes.byteLength,
        sha256: fileSha,
      },
      200,
    );
  };

  app.get('/api/projects/:id/composition-filmstrip', handleGetFilmstrip);
  app.get('/api/projects/:id/composition-filmstrip/*', handleGetFilmstrip);
  app.put('/api/projects/:id/composition-filmstrip', handlePutFilmstrip);
  app.put('/api/projects/:id/composition-filmstrip/*', handlePutFilmstrip);

  return app;
}
