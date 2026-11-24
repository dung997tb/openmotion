import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { MAX_ASSET_BYTES } from '../../../shared/asset-limits.ts';
import { preparedFontResponse } from '../../../shared/studio-fonts.ts';
import {
  getAuthContext,
  type DisklessStudioDeps,
  type StudioVariables,
} from '../context.ts';
import type { ContainerFontCatalog } from '../fonts-catalog.ts';
import { createWriteToken } from '../etag.ts';

export function createStudioFontsRoutes(
  deps: DisklessStudioDeps,
  fontCatalog: ContainerFontCatalog,
): Hono<{ Variables: StudioVariables }> {
  const app = new Hono<{ Variables: StudioVariables }>();

  // GET /api/fonts — List baked container fonts from /app/fonts (never scans host OS directories).
  app.get('/api/fonts', async (c) => {
    await getAuthContext(c, deps, { scope: 'projects:read' });
    return c.json({ fonts: await fontCatalog.listFamilies() });
  });

  // GET /api/fonts/google?family=... — Redis-cached Google Fonts CSS proxy.
  app.get('/api/fonts/google', async (c) => {
    await getAuthContext(c, deps, { scope: 'projects:read' });
    const families = c.req.queries('family') ?? [];
    const css = await fontCatalog.fetchGoogleFontCss(families, deps.hotTextCache, deps.fetchImpl);
    c.header('Content-Type', 'text/css; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(css, 200);
  });

  // GET /api/fonts/file?family=... — Serve prepared font binary from baked /app/fonts catalog.
  app.get('/api/fonts/file', async (c) => {
    await getAuthContext(c, deps, { scope: 'projects:read' });
    const family = c.req.query('family');
    if (!family) return c.json({ error: 'family parameter required' }, 400);
    const font = await fontCatalog.getFont(family);
    return font ? preparedFontResponse(font) : c.json({ error: 'font not found' }, 404);
  });

  // POST /api/fonts/prepare — Inspect & normalize an uploaded font buffer in memory.
  app.post('/api/fonts/prepare', bodyLimit({ maxSize: MAX_ASSET_BYTES }), async (c) => {
    await getAuthContext(c, deps, { scope: 'projects:read' });
    try {
      const bytes = Buffer.from(await c.req.arrayBuffer());
      const prepared = fontCatalog.prepareBuffer(bytes);
      return preparedFontResponse(prepared);
    } catch {
      return c.json({ error: 'Unsupported or invalid font file' }, 400);
    }
  });

  // POST /api/projects/:id/fonts/import — Copy a baked container font into project S3 CAS (`assets/fonts/...`).
  app.post('/api/projects/:id/fonts/import', bodyLimit({ maxSize: 4096 }), async (c) => {
    const auth = await getAuthContext(c, deps, { scope: 'projects:write', minRole: 'editor' });
    const projectId = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as { family?: unknown } | null;
    if (!body || typeof body.family !== 'string' || !body.family.trim()) {
      return c.json({ error: 'Font family required' }, 400);
    }

    const font = await fontCatalog.getFont(body.family);
    if (!font) return c.json({ error: 'Font not found' }, 404);

    const safeName = `${font.postscriptName.replace(/[^a-zA-Z0-9_-]/g, '_')}-${randomUUID().slice(0, 8)}`;
    const assetPath = `assets/fonts/${safeName}.${font.format}`;
    const writeToken = createWriteToken(c.req.header('x-hyperframes-write-token'));

    const committed = await deps.files.commitChanges(auth, {
      projectId,
      ops: [
        {
          op: 'upsert_binary',
          path: assetPath,
          data: font.data,
          mimeType: `font/${font.format}`,
        },
      ],
      source: 'studio',
      summary: `Imported font ${font.family}`,
      writeToken,
    });

    return c.json(
      {
        family: font.family,
        weight: font.weight,
        style: font.style,
        postscriptName: font.postscriptName,
        path: assetPath,
        revision: committed.revision,
        writeToken: committed.writeToken,
      },
      201,
    );
  });

  return app;
}
