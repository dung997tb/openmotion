import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { DEFAULT_PAT_SCOPES, type AuthContext } from '../../src/contracts/auth.ts';
import type {
  BlobScope,
  HeadObjectResult,
  ObjectStreamResult,
  PresignGetOptions,
  PresignPutOptions,
  StoragePort,
} from '../../src/contracts/storage.ts';
import {
  assertTenantScopedKey,
  catalogCompFilmstripKey,
  isCatalogCasKey,
  isImmutableCasKey,
} from '../../src/infra/storage.ts';
import {
  clearBuiltinFilmstripCacheForTest,
  getBuiltinCompositionFilmstrip,
} from '../../src/services/builtin-filmstrip-store.ts';
import {
  assembleBuiltinTemplate,
  BUILTIN_TEMPLATES,
  WELCOME_TEMPLATE_ID,
} from '../../src/services/builtin-template-source.ts';
import { handleStudioError, type DisklessStudioDeps } from '../../src/studio/context.ts';
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
  parseJpegSofDimensions,
} from '../../src/studio/engine/composition-filmstrip-sprite.ts';
import { createStudioCompositionFilmstripsRoutes } from '../../src/studio/routes/composition-filmstrips.ts';
import { listVirtualCompositions, type VirtualFileRecord } from '../../src/studio/virtual-project-store.ts';

const WID_A = '11111111-1111-4111-8111-111111111111';
const WID_B = '22222222-2222-4222-8222-222222222222';
const PID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SHA_SCENE = 'a'.repeat(64);
const SHA_OTHER = 'b'.repeat(64);
const SHA_PATCH = 'c'.repeat(64);

async function makeTestSpriteJpeg(
  frameCount: number,
  frameWidth = 160,
  frameHeight = 90,
): Promise<Buffer> {
  return sharp({
    create: {
      width: frameCount * frameWidth,
      height: frameHeight,
      channels: 3,
      background: { r: 32, g: 64, b: 128 },
    },
  })
    .jpeg({ quality: 75 })
    .toBuffer();
}

class MemoryStorage implements StoragePort {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  putCount = 0;

  async putObject(
    key: string,
    body: Buffer | Uint8Array | Readable | string,
    contentType: string,
  ): Promise<void> {
    this.putCount += 1;
    const buf = Buffer.isBuffer(body)
      ? Buffer.from(body)
      : typeof body === 'string'
        ? Buffer.from(body, 'utf8')
        : body instanceof Uint8Array
          ? Buffer.from(body)
          : Buffer.alloc(0);
    this.objects.set(key, { body: buf, contentType });
  }

  async putBlobIfAbsent(key: string, body: Buffer, contentType: string): Promise<{ uploaded: boolean }> {
    if (this.objects.has(key)) return { uploaded: false };
    await this.putObject(key, body, contentType);
    return { uploaded: true };
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    if (!found) throw new Error(`NoSuchKey: ${key}`);
    return Buffer.from(found.body);
  }

  async getObjectStream(key: string): Promise<ObjectStreamResult> {
    const buf = await this.getObjectBuffer(key);
    return { stream: Readable.from([buf]), contentLength: buf.byteLength, contentType: 'image/jpeg' };
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    const found = this.objects.get(key);
    if (!found) return null;
    const etag = `"${createHash('sha256').update(found.body).digest('hex')}"`;
    return { contentLength: found.body.byteLength, contentType: found.contentType, etag };
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async deletePrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const k of [...this.objects.keys()]) {
      if (k.startsWith(prefix)) {
        this.objects.delete(k);
        count++;
      }
    }
    return count;
  }

  async presignPut(key: string, _options: PresignPutOptions): Promise<string> {
    return `https://s3.test/${key}`;
  }

  async presignGet(key: string, _options?: PresignGetOptions): Promise<string> {
    return `https://s3.test/${key}`;
  }

  async ensureBucketAndCors(): Promise<void> {}
}

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    workspaceId: WID_A,
    userId: USER_A,
    role: 'editor',
    scopes: [...DEFAULT_PAT_SCOPES],
    authMode: 'dev',
    authMethod: 'dev_bypass',
    ...overrides,
  };
}

function makeRouteApp(
  storage: MemoryStorage,
  fileLookup: (auth: AuthContext, projectId: string, filePath: string) => VirtualFileRecord | null,
  authResolver: (req: Request) => AuthContext,
) {
  const deps = {
    storage,
    files: {
      getFile: async (auth: AuthContext, projectId: string, filePath: string) =>
        fileLookup(auth, projectId, filePath),
    },
    resolveAuth: (c: { req: { raw: Request } }) => authResolver(c.req.raw),
  } as unknown as DisklessStudioDeps;
  const app = createStudioCompositionFilmstripsRoutes(deps);
  app.onError((err, c) => handleStudioError(c, err));
  return app;
}

describe('Composition filmstrip sprite codec & storage security', () => {
  it('embeds and extracts validated OMFS1 metadata inside standard JPEG bytes', async () => {
    const raw = await makeTestSpriteJpeg(8, 160, 90);
    assert.deepEqual(parseJpegSofDimensions(raw), { width: 1280, height: 90 });
    assert.equal(extractFilmstripMeta(raw), null);

    const tagged = embedFilmstripComment(raw, {
      version: 1,
      frameCount: 8,
      frameWidth: 160,
      frameHeight: 90,
      aspect: 16 / 9,
    });
    assert.ok(tagged);
    const meta = extractFilmstripMeta(tagged);
    assert.deepEqual(meta, {
      version: 1,
      frameCount: 8,
      frameWidth: 160,
      frameHeight: 90,
      aspect: 1.7778,
    });

    // Re-embedding replaces prior OMFS1 comment cleanly instead of duplicating it.
    const retagged = embedFilmstripComment(tagged, {
      version: 1,
      frameCount: 8,
      frameWidth: 160,
      frameHeight: 90,
      aspect: 1.7778,
    });
    assert.ok(retagged);
    assert.equal(retagged.byteLength, tagged.byteLength);
    assert.deepEqual(extractFilmstripMeta(retagged), meta);
  });

  it('rejects non-JPEG data, mismatched SOF dimensions, and out-of-range metadata', async () => {
    const raw4 = await makeTestSpriteJpeg(4, 160, 90);
    assert.equal(
      embedFilmstripComment(raw4, { version: 1, frameCount: 8, frameWidth: 160, frameHeight: 90, aspect: 16 / 9 }),
      null,
    );
    assert.equal(
      embedFilmstripComment(Buffer.from('not-a-jpeg'), {
        version: 1,
        frameCount: 1,
        frameWidth: 160,
        frameHeight: 90,
        aspect: 16 / 9,
      }),
      null,
    );
    assert.equal(
      embedFilmstripComment(raw4, { version: 1, frameCount: 0, frameWidth: 160, frameHeight: 90, aspect: 16 / 9 }),
      null,
    );
    assert.equal(
      embedFilmstripComment(raw4, { version: 1, frameCount: 4, frameWidth: 160, frameHeight: 91, aspect: 16 / 9 }),
      null,
    );
  });

  it('scopes catalog filmstrip keys to read-only allowCatalog guards', () => {
    const key = catalogCompFilmstripKey(SHA_SCENE);
    assert.equal(key, `catalog/filmstrips/${SHA_SCENE}/strip-v1.jpg`);
    assert.equal(isCatalogCasKey(key), true);
    assert.equal(isImmutableCasKey(key), true);
    assert.equal(assertTenantScopedKey(WID_A, key, { allowCatalog: true }), key);
    assert.throws(() => assertTenantScopedKey(WID_A, key), { code: 'WORKSPACE_FORBIDDEN' });
    assert.throws(() => assertTenantScopedKey(WID_A, key, { allowCatalog: false }), {
      code: 'WORKSPACE_FORBIDDEN',
    });
  });

  it('ships valid pre-baked 8-frame filmstrips for every built-in template composition', async () => {
    clearBuiltinFilmstripCacheForTest();
    let verifiedCount = 0;
    for (const def of BUILTIN_TEMPLATES) {
      const assembled = await assembleBuiltinTemplate(def);
      const projectFiles = assembled.files.filter((f) => f.isProjectFile);
      const records: VirtualFileRecord[] = projectFiles.map((f) => ({
        path: f.path,
        blobScope: 'catalog',
        sha256: f.sha256,
        sizeBytes: f.sizeBytes,
        mimeType: f.mimeType,
        isText: f.path.endsWith('.html'),
        updatedAt: new Date(0),
        metadata: f.metadata,
      }));
      const allComps = listVirtualCompositions(records);
      const targetComps = allComps.filter((p) => p !== 'index.html');
      const comps = targetComps.length > 0 ? targetComps : allComps;
      for (const compPath of comps) {
        const file = projectFiles.find((f) => f.path === compPath);
        assert.ok(file, `Missing file ${compPath} in ${def.id}`);
        const loaded = await getBuiltinCompositionFilmstrip(file.sha256);
        assert.ok(
          loaded,
          `Missing pre-baked filmstrip for ${def.id}/${compPath} (${file.sha256}). Run npm run templates:filmstrips`,
        );
        assert.equal(loaded.meta.frameCount, 8);
        assert.equal(loaded.meta.frameWidth, 160);
        assert.ok(loaded.bytes.byteLength > 1000 && loaded.bytes.byteLength <= MAX_FILMSTRIP_JPEG_BYTES);
        verifiedCount += 1;
      }
    }
    assert.ok(verifiedCount >= 12, `Expected at least 12 built-in scenes, got ${verifiedCount}`);
    assert.equal(await getBuiltinCompositionFilmstrip('not-a-sha'), null);
    assert.equal(await getBuiltinCompositionFilmstrip('0'.repeat(64)), null);
  });
});

describe('Studio composition filmstrip HTTP routes', () => {
  it('serves pre-baked built-in catalog scenes directly with 0 S3 writes and supports HEAD + 304 ETag', async () => {
    const welcome = await assembleBuiltinTemplate(
      BUILTIN_TEMPLATES.find((t) => t.id === WELCOME_TEMPLATE_ID)!,
    );
    const introFile = welcome.files.find((f) => f.path === 'compositions/intro.html')!;
    const storage = new MemoryStorage();
    const app = makeRouteApp(
      storage,
      (_auth, projectId, filePath) =>
        projectId === PID_A && filePath === 'compositions/intro.html'
          ? {
              path: 'compositions/intro.html',
              blobScope: 'catalog',
              sha256: introFile.sha256,
              sizeBytes: introFile.sizeBytes,
              mimeType: 'text/html; charset=utf-8',
              isText: true,
              updatedAt: new Date(0),
            }
          : null,
      () => makeAuth(),
    );

    const getRes = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/intro.html`,
    );
    assert.equal(getRes.status, 200);
    assert.equal(getRes.headers.get('content-type'), 'image/jpeg');
    assert.equal(getRes.headers.get(FILMSTRIP_HEADER_SOURCE), 'builtin');
    assert.equal(getRes.headers.get(FILMSTRIP_HEADER_FRAMES), '8');
    assert.equal(getRes.headers.get(FILMSTRIP_HEADER_SHA256), introFile.sha256);
    assert.equal(getRes.headers.get('cache-control'), 'private, no-cache');
    const etag = getRes.headers.get('etag');
    assert.ok(etag);
    const body = Buffer.from(await getRes.arrayBuffer());
    assert.ok(extractFilmstripMeta(body)?.frameCount === 8);

    const headRes = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/intro.html`,
      { method: 'HEAD' },
    );
    assert.equal(headRes.status, 200);
    assert.equal(headRes.headers.get(FILMSTRIP_HEADER_SOURCE), 'builtin');
    assert.equal((await headRes.arrayBuffer()).byteLength, 0);

    const notModRes = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/intro.html`,
      { headers: { 'if-none-match': etag } },
    );
    assert.equal(notModRes.status, 304);

    // Client PUT for an already pre-baked built-in scene skips duplicate S3 storage.
    const raw8 = await makeTestSpriteJpeg(8, 160, 90);
    const putRes = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/intro.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: introFile.sha256,
          [FILMSTRIP_HEADER_SCOPE]: 'catalog',
          [FILMSTRIP_HEADER_FRAMES]: '8',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw8),
      },
    );
    assert.equal(putRes.status, 200);
    assert.deepEqual(await putRes.json(), {
      stored: false,
      reason: 'already_cached',
      source: 'builtin',
      frameCount: 8,
      sha256: introFile.sha256,
    });
    assert.equal(storage.putCount, 0);
  });

  it('serves S3 catalog filmstrips read-only and never allows client PUT to write catalog/*', async () => {
    const storage = new MemoryStorage();
    const raw8 = await makeTestSpriteJpeg(8, 160, 90);
    const tagged8 = embedFilmstripComment(raw8, {
      version: 1,
      frameCount: 8,
      frameWidth: 160,
      frameHeight: 90,
      aspect: 16 / 9,
    })!;

    // Case 1: un-prebaked catalog scene -> GET 204, client PUT writes ONLY to workspace derived key.
    const app = makeRouteApp(
      storage,
      (_auth, projectId, filePath) =>
        projectId === PID_A && filePath === 'compositions/prism.html'
          ? {
              path: 'compositions/prism.html',
              blobScope: 'catalog',
              sha256: SHA_SCENE,
              sizeBytes: 512,
              mimeType: 'text/html; charset=utf-8',
              isText: true,
              updatedAt: new Date(0),
            }
          : null,
      () => makeAuth(),
    );

    const miss = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/prism.html`,
    );
    assert.equal(miss.status, 204);
    assert.equal(miss.headers.get(FILMSTRIP_HEADER_SHA256), SHA_SCENE);
    assert.equal(miss.headers.get(FILMSTRIP_HEADER_SCOPE), 'catalog');

    const raw4 = await makeTestSpriteJpeg(4, 160, 90);
    const put = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/prism.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: SHA_SCENE,
          [FILMSTRIP_HEADER_SCOPE]: 'catalog',
          [FILMSTRIP_HEADER_FRAMES]: '4',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw4),
      },
    );
    assert.equal(put.status, 200);
    assert.equal(storage.objects.has(catalogCompFilmstripKey(SHA_SCENE)), false);
    assert.equal(
      storage.objects.has(`workspaces/${WID_A}/derived/${SHA_SCENE}/comp-filmstrip-v1.jpg`),
      true,
    );

    // Case 2: once trusted catalog-sync populates catalog/filmstrips/{sha}/strip-v1.jpg, GET prefers catalog!
    await storage.putObject(catalogCompFilmstripKey(SHA_SCENE), tagged8, 'image/jpeg');
    const hit = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/prism.html`,
    );
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get(FILMSTRIP_HEADER_SOURCE), 'catalog');
    assert.equal(hit.headers.get(FILMSTRIP_HEADER_FRAMES), '8');
  });

  it('enforces strict tenant isolation, upgrade-only writes, patch key separation, and input validation', async () => {
    const storage = new MemoryStorage();
    let currentScope: BlobScope = 'workspace';
    let currentSha = SHA_SCENE;

    const app = makeRouteApp(
      storage,
      (auth, projectId, filePath) => {
        if (
          (auth.workspaceId === WID_A && projectId === PID_A) ||
          (auth.workspaceId === WID_B && projectId === PID_B)
        ) {
          if (filePath === 'compositions/custom.html') {
            return {
              path: filePath,
              blobScope: currentScope,
              sha256: currentSha,
              sizeBytes: 1024,
              mimeType: 'text/html; charset=utf-8',
              isText: true,
              updatedAt: new Date(0),
            };
          }
          if (filePath === 'assets/photo.jpg') {
            return {
              path: filePath,
              blobScope: 'workspace',
              sha256: SHA_OTHER,
              sizeBytes: 2048,
              mimeType: 'image/jpeg',
              isText: false,
              updatedAt: new Date(0),
            };
          }
        }
        return null;
      },
      (req) => {
        const ws = req.headers.get('x-test-ws') ?? WID_A;
        const role = (req.headers.get('x-test-role') as AuthContext['role']) ?? 'editor';
        const scopes = role === 'viewer' ? (['projects:read'] as const) : DEFAULT_PAT_SCOPES;
        return makeAuth({ workspaceId: ws, role, scopes: [...scopes] });
      },
    );

    // Non-HTML asset returns 404.
    const nonHtml = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/assets/photo.jpg`,
    );
    assert.equal(nonHtml.status, 404);

    // Viewer cannot PUT (403).
    const raw4 = await makeTestSpriteJpeg(4, 160, 90);
    const viewerPut = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
      {
        method: 'PUT',
        headers: {
          'x-test-role': 'viewer',
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: SHA_SCENE,
          [FILMSTRIP_HEADER_FRAMES]: '4',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw4),
      },
    );
    assert.equal(viewerPut.status, 403);

    // Stale sha256 mismatch -> 409 Conflict.
    const stalePut = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: SHA_OTHER,
          [FILMSTRIP_HEADER_FRAMES]: '4',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw4),
      },
    );
    assert.equal(stalePut.status, 409);

    // Wrong Content-Type -> 415; mismatched dimensions -> 400; oversized -> 413.
    const wrongType = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/png',
          [FILMSTRIP_HEADER_SHA256]: SHA_SCENE,
          [FILMSTRIP_HEADER_FRAMES]: '4',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw4),
      },
    );
    assert.equal(wrongType.status, 415);

    const wrongDims = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: SHA_SCENE,
          [FILMSTRIP_HEADER_FRAMES]: '8',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw4),
      },
    );
    assert.equal(wrongDims.status, 400);

    const tooBig = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: SHA_SCENE,
          [FILMSTRIP_HEADER_FRAMES]: '4',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(MAX_FILMSTRIP_JPEG_BYTES + 16),
      },
    );
    assert.equal(tooBig.status, 413);

    // Valid 4-frame PUT by Workspace A succeeds.
    const put4 = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: SHA_SCENE,
          [FILMSTRIP_HEADER_FRAMES]: '4',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw4),
      },
    );
    assert.equal(put4.status, 200);
    assert.equal((await put4.json()).stored, true);

    // Workspace A hits 200, while Workspace B (same SHA!) strictly misses with 204 (tenant isolation).
    const hitA = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
    );
    assert.equal(hitA.status, 200);
    assert.equal(hitA.headers.get(FILMSTRIP_HEADER_FRAMES), '4');
    assert.equal(hitA.headers.get(FILMSTRIP_HEADER_SOURCE), 'workspace');

    const missB = await app.request(
      `http://studio.local/api/projects/${PID_B}/composition-filmstrip/compositions/custom.html`,
      { headers: { 'x-test-ws': WID_B } },
    );
    assert.equal(missB.status, 204);

    // Downgrade (2 < 4) is skipped; upgrade (8 > 4) replaces cleanly.
    const raw2 = await makeTestSpriteJpeg(2, 160, 90);
    const downgrade = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: SHA_SCENE,
          [FILMSTRIP_HEADER_FRAMES]: '2',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw2),
      },
    );
    assert.equal(downgrade.status, 200);
    assert.equal((await downgrade.json()).stored, false);

    const raw8 = await makeTestSpriteJpeg(8, 160, 90);
    const upgrade = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: SHA_SCENE,
          [FILMSTRIP_HEADER_FRAMES]: '8',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw8),
      },
    );
    assert.equal(upgrade.status, 200);
    assert.equal((await upgrade.json()).stored, true);

    const hitUpgraded = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
    );
    assert.equal(hitUpgraded.status, 200);
    assert.equal(hitUpgraded.headers.get(FILMSTRIP_HEADER_FRAMES), '8');

    // Patch scope writes to its own comp-filmstrip-patch-v1.jpg derived key.
    currentScope = 'patch';
    currentSha = SHA_PATCH;
    const putPatch = await app.request(
      `http://studio.local/api/projects/${PID_A}/composition-filmstrip/compositions/custom.html`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'image/jpeg',
          [FILMSTRIP_HEADER_SHA256]: SHA_PATCH,
          [FILMSTRIP_HEADER_SCOPE]: 'patch',
          [FILMSTRIP_HEADER_FRAMES]: '4',
          [FILMSTRIP_HEADER_WIDTH]: '160',
          [FILMSTRIP_HEADER_HEIGHT]: '90',
        },
        body: new Uint8Array(raw4),
      },
    );
    assert.equal(putPatch.status, 200);
    assert.equal(
      storage.objects.has(`workspaces/${WID_A}/derived/${SHA_PATCH}/comp-filmstrip-patch-v1.jpg`),
      true,
    );
  });
});
