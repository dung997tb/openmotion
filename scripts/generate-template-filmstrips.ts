import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHyperframeRuntimeScript } from '@hyperframes/core/runtime-script';
import puppeteer, { type Page } from 'puppeteer-core';
import sharp from 'sharp';
import { isMain } from '../shared/entry.ts';
import { isTextProjectPath } from '../shared/project-validation.ts';
import {
  assembleBuiltinTemplate,
  BUILTIN_TEMPLATES,
  type BuiltinTemplateDefinition,
} from '../src/services/builtin-template-source.ts';
import type {
  BuiltinFilmstripManifest,
  BuiltinFilmstripManifestEntry,
} from '../src/services/builtin-filmstrip-store.ts';
import {
  computeCompositionFilmstripDepsDigest,
  embedFilmstripComment,
  extractFilmstripMeta,
  extractIndexHeadMarkup,
  MAX_FILMSTRIP_FRAMES,
} from '../src/studio/engine/composition-filmstrip-sprite.ts';
import { buildSubCompositionHtmlInMemory } from '../src/studio/engine/preview-bundler.ts';
import {
  InMemoryVirtualProject,
  listVirtualCompositions,
  type VirtualFileRecord,
} from '../src/studio/virtual-project-store.ts';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const FILMSTRIPS_DIR = path.join(REPO_ROOT, 'template-library', 'filmstrips');
const MANIFEST_PATH = path.join(FILMSTRIPS_DIR, 'manifest.json');

const FRAME_WIDTH = 160;
const FRAME_COUNT = MAX_FILMSTRIP_FRAMES;
const JPEG_QUALITY = 78;

function detectBrowserExecutable(): string {
  const candidates = [
    process.env.HYPERFRAMES_BROWSER_PATH,
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter((p): p is string => Boolean(p && p.trim()));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'No Chromium/Chrome executable found. Set HYPERFRAMES_BROWSER_PATH or install Chrome/Chromium.',
  );
}

function computeSampleTimes(durationSeconds: number, frameCount: number): number[] {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const count = Math.max(1, Math.min(MAX_FILMSTRIP_FRAMES, Math.floor(frameCount || 1)));
  if (safeDuration <= 0) return [0];
  if (count === 1) {
    return [Number((safeDuration <= 3 ? safeDuration * 0.5 : Math.min(3, safeDuration * 0.35)).toFixed(3))];
  }
  if (count === 2) {
    return [Number((safeDuration * 0.25).toFixed(3)), Number((safeDuration * 0.75).toFixed(3))];
  }
  const start = safeDuration * 0.04;
  const end = safeDuration * 0.94;
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => Number((start + i * step).toFixed(3)));
}

function safeSlugForPath(compPath: string): string {
  const stripped = compPath.replace(/^compositions\//i, '').replace(/\.html?$/i, '');
  const slug = stripped.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'scene';
}

async function startTemplatePreviewServer(
  template: Awaited<ReturnType<typeof assembleBuiltinTemplate>>,
  repoRoot: string,
): Promise<{ origin: string; close: () => Promise<void>; compositions: string[]; shaByPath: Map<string, string> }> {
  const runtimeJs = getHyperframeRuntimeScript();
  const projectFiles = template.files.filter((f) => f.isProjectFile && f.bytes !== null);
  const now = new Date();
  const textContents = new Map<string, string>();
  const bytesByPath = new Map<string, { bytes: Buffer; mimeType: string }>();
  const shaByPath = new Map<string, string>();

  const records: VirtualFileRecord[] = projectFiles.map((file) => {
    const isText = isTextProjectPath(file.path);
    if (isText) textContents.set(file.path, file.bytes!.toString('utf8'));
    bytesByPath.set(file.path, { bytes: file.bytes!, mimeType: file.mimeType });
    shaByPath.set(file.path, file.sha256);
    return {
      path: file.path,
      blobScope: 'catalog',
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      isText,
      updatedAt: now,
      metadata: file.metadata,
    };
  });

  const virtual = new InMemoryVirtualProject({
    projectId: `prebake-${template.id}`,
    projectName: template.id,
    revision: template.catalogVersion,
    files: records,
    textContents,
  });

  const allComps = listVirtualCompositions(records);
  const subComps = allComps.filter((p) => p !== 'index.html');
  const compositions = subComps.length > 0 ? subComps : allComps;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/api/runtime.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(runtimeJs);
        return;
      }
      if (url.pathname.startsWith('/api/vendor/gsap/')) {
        const assetName = path.posix.basename(url.pathname);
        const gsapPath = path.join(repoRoot, 'node_modules/gsap/dist', assetName);
        if (existsSync(gsapPath)) {
          const bytes = await readFile(gsapPath);
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end(bytes);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      if (url.pathname.startsWith('/preview/comp/')) {
        const compPath = decodeURIComponent(url.pathname.slice('/preview/comp/'.length));
        const html = await buildSubCompositionHtmlInMemory(virtual, compPath, {
          runtimeUrl: '/api/runtime.js',
          baseHref: '/preview/',
          gsapBaseUrl: '/api/vendor/gsap/',
          capture: true,
          cacheProjectScripts: false,
          skipDeterministicFonts: true,
        });
        if (!html) {
          res.writeHead(404);
          res.end('Composition not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (url.pathname.startsWith('/preview/')) {
        const rel = decodeURIComponent(url.pathname.slice('/preview/'.length));
        const found = bytesByPath.get(rel);
        if (!found) {
          res.writeHead(404);
          res.end('Asset not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': found.mimeType });
        res.end(found.bytes);
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      res.writeHead(500);
      res.end(error instanceof Error ? error.message : 'Server error');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    compositions,
    shaByPath,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function captureCompositionSprite(
  page: Page,
  origin: string,
  compPath: string,
): Promise<{ jpeg: Buffer; frameCount: number; frameWidth: number; frameHeight: number; aspect: number }> {
  const encodedPath = compPath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`${origin}/preview/comp/${encodedPath}`, { waitUntil: 'networkidle0', timeout: 30_000 });

  await page.waitForFunction(
    () => {
      const p = (window as unknown as { __player?: { seek?: unknown; getDuration?: () => number } }).__player;
      return Boolean(p && typeof p.seek === 'function' && typeof p.getDuration === 'function' && p.getDuration() > 0);
    },
    { timeout: 15_000 },
  );

  const stageInfo = await page.evaluate(async () => {
    const p = (window as unknown as {
      __player?: { pause?: () => void; getDuration?: () => number };
    }).__player;
    p?.pause?.();
    if (document.fonts?.ready) {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
    }
    const imgs = Array.from(document.querySelectorAll('img')).filter((img) => !img.complete);
    if (imgs.length > 0) {
      await Promise.race([
        Promise.all(
          imgs.map(
            (img) =>
              new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              }),
          ),
        ),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
    const root = (document.querySelector('[data-composition-id]') ?? document.body) as HTMLElement;
    const width = Number(root.getAttribute('data-width')) || root.clientWidth || 1920;
    const height = Number(root.getAttribute('data-height')) || root.clientHeight || 1080;
    const duration = p?.getDuration?.() ?? 5;
    return { width, height, duration };
  });

  if (stageInfo.width !== 1920 || stageInfo.height !== 1080) {
    await page.setViewport({
      width: Math.max(320, Math.round(stageInfo.width)),
      height: Math.max(180, Math.round(stageInfo.height)),
      deviceScaleFactor: 1,
    });
  }

  const aspect = stageInfo.width / Math.max(1, stageInfo.height);
  const frameWidth = FRAME_WIDTH;
  const frameHeight = Math.max(24, Math.round(frameWidth / aspect));
  const times = computeSampleTimes(stageInfo.duration, FRAME_COUNT);

  const framePngs: Buffer[] = [];
  for (const t of times) {
    await page.evaluate(async (timeSec: number) => {
      const p = (window as unknown as { __player?: { seek?: (n: number) => void } }).__player;
      p?.seek?.(timeSec);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }, t);

    const rootHandle = await page.$('[data-composition-id]');
    const rawPng = rootHandle
      ? Buffer.from(await rootHandle.screenshot({ type: 'png' }))
      : Buffer.from(await page.screenshot({ type: 'png' }));
    if (rootHandle) await rootHandle.dispose();

    const resized = await sharp(rawPng)
      .resize(frameWidth, frameHeight, { fit: 'fill' })
      .png()
      .toBuffer();
    framePngs.push(resized);
  }

  const totalWidth = frameWidth * framePngs.length;
  const rawJpeg = await sharp({
    create: {
      width: totalWidth,
      height: frameHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(
      framePngs.map((input, idx) => ({
        input,
        left: idx * frameWidth,
        top: 0,
      })),
    )
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  const meta = {
    version: 1 as const,
    frameCount: framePngs.length,
    frameWidth,
    frameHeight,
    aspect: Number(aspect.toFixed(4)),
  };
  const jpeg = embedFilmstripComment(rawJpeg, meta);
  if (!jpeg) {
    throw new Error(`Failed to embed filmstrip metadata into JPEG for ${compPath}`);
  }
  return { jpeg, ...meta };
}

function computeTemplateDepsMap(
  assembled: Awaited<ReturnType<typeof assembleBuiltinTemplate>>,
): Map<string, string> {
  const projectFiles = assembled.files.filter((f) => f.isProjectFile && f.bytes !== null);
  const textContents = new Map<string, string>();
  const records: VirtualFileRecord[] = projectFiles.map((file) => {
    const isText = isTextProjectPath(file.path);
    if (isText) textContents.set(file.path, file.bytes!.toString('utf8'));
    return {
      path: file.path,
      blobScope: 'catalog',
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      isText,
      updatedAt: new Date(0),
      metadata: file.metadata,
    };
  });
  const indexHead = extractIndexHeadMarkup(textContents.get('index.html'));
  const allComps = listVirtualCompositions(records);
  const comps = allComps.filter((p) => p !== 'index.html');
  const targetComps = comps.length > 0 ? comps : allComps;
  const depsByPath = new Map<string, string>();
  for (const compPath of targetComps) {
    const { depsSha256 } = computeCompositionFilmstripDepsDigest({
      compPath,
      files: records,
      indexHead,
      readText: (filePath) => textContents.get(filePath) ?? null,
    });
    depsByPath.set(compPath, depsSha256);
  }
  return depsByPath;
}

async function verifyManifest(selectedTemplates: readonly BuiltinTemplateDefinition[]): Promise<void> {
  const raw = await readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw) as BuiltinFilmstripManifest;
  if (manifest.version !== 1 || !manifest.entries) {
    throw new Error('Invalid template-library/filmstrips/manifest.json');
  }
  const errors: string[] = [];
  for (const def of selectedTemplates) {
    const assembled = await assembleBuiltinTemplate(def, REPO_ROOT, REPO_ROOT);
    const projectFiles = assembled.files.filter((f) => f.isProjectFile);
    const depsByPath = computeTemplateDepsMap(assembled);
    for (const [compPath, expectedDepsSha256] of depsByPath) {
      const file = projectFiles.find((f) => f.path === compPath);
      if (!file) continue;
      const entry = manifest.entries[file.sha256];
      if (!entry) {
        errors.push(`Missing filmstrip entry for ${def.id}/${compPath} (${file.sha256})`);
        continue;
      }
      if (entry.depsSha256 !== expectedDepsSha256) {
        errors.push(`Stale depsSha256 for ${def.id}/${compPath}: expected ${expectedDepsSha256}, got ${entry.depsSha256}`);
        continue;
      }
      const jpgPath = path.join(FILMSTRIPS_DIR, entry.file);
      const bytes = await readFile(jpgPath).catch(() => null);
      if (!bytes) {
        errors.push(`Missing filmstrip JPEG ${entry.file} for ${def.id}/${compPath}`);
        continue;
      }
      const meta = extractFilmstripMeta(bytes);
      if (!meta || meta.frameCount !== entry.frameCount || meta.frameWidth !== entry.frameWidth || meta.frameHeight !== entry.frameHeight) {
        errors.push(`Corrupt or mismatched OMFS1 header in ${entry.file}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Built-in filmstrip verification failed:\n${errors.join('\n')}`);
  }
  console.log(`PASS: verified ${Object.keys(manifest.entries).length} pre-baked built-in composition filmstrips.`);
}

async function refreshManifestDeps(selectedTemplates: readonly BuiltinTemplateDefinition[]): Promise<void> {
  const raw = await readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw) as BuiltinFilmstripManifest;
  const entries: Record<string, BuiltinFilmstripManifestEntry> = { ...manifest.entries };
  for (const def of selectedTemplates) {
    const assembled = await assembleBuiltinTemplate(def, REPO_ROOT, REPO_ROOT);
    const projectFiles = assembled.files.filter((f) => f.isProjectFile);
    const depsByPath = computeTemplateDepsMap(assembled);
    for (const [compPath, depsSha256] of depsByPath) {
      const file = projectFiles.find((f) => f.path === compPath);
      const prev = file ? entries[file.sha256] : undefined;
      if (!file || !prev) {
        throw new Error(`Missing existing manifest entry for ${def.id}/${compPath}`);
      }
      entries[file.sha256] = {
        templateId: prev.templateId,
        path: prev.path,
        file: prev.file,
        depsSha256,
        frameCount: prev.frameCount,
        frameWidth: prev.frameWidth,
        frameHeight: prev.frameHeight,
        aspect: prev.aspect,
      };
    }
  }
  const sortedEntries: Record<string, BuiltinFilmstripManifestEntry> = {};
  for (const key of Object.keys(entries).sort()) {
    sortedEntries[key] = entries[key]!;
  }
  await writeFile(MANIFEST_PATH, `${JSON.stringify({ version: 1, entries: sortedEntries }, null, 2)}\n`, 'utf8');
  console.log(`Updated depsSha256 for ${Object.keys(sortedEntries).length} built-in filmstrip entries.`);
}

async function run(argv: readonly string[]): Promise<void> {
  const checkOnly = argv.includes('--check');
  const syncDepsOnly = argv.includes('--sync-manifest-deps');
  const templateFilter = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--template' && argv[i + 1]) {
      for (const id of argv[++i]!.split(',')) if (id.trim()) templateFilter.add(id.trim());
    } else if (arg.startsWith('--template=')) {
      for (const id of arg.slice('--template='.length).split(',')) if (id.trim()) templateFilter.add(id.trim());
    }
  }

  const selectedTemplates =
    templateFilter.size > 0
      ? BUILTIN_TEMPLATES.filter((t) => templateFilter.has(t.id))
      : BUILTIN_TEMPLATES;

  if (selectedTemplates.length === 0) {
    throw new Error('No matching built-in templates selected.');
  }

  if (checkOnly) {
    await verifyManifest(selectedTemplates);
    return;
  }

  if (syncDepsOnly) {
    await refreshManifestDeps(selectedTemplates);
    return;
  }

  let existingEntries: Record<string, BuiltinFilmstripManifestEntry> = {};
  if (templateFilter.size > 0 && existsSync(MANIFEST_PATH)) {
    const prev = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Partial<BuiltinFilmstripManifest>;
    if (prev.entries && typeof prev.entries === 'object') {
      existingEntries = { ...prev.entries };
    }
  }

  const executablePath = detectBrowserExecutable();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });

  const entries: Record<string, BuiltinFilmstripManifestEntry> = { ...existingEntries };
  let totalBytes = 0;
  let generatedCount = 0;

  try {
    const page = await browser.newPage();
    for (const def of selectedTemplates) {
      const assembled = await assembleBuiltinTemplate(def, REPO_ROOT, REPO_ROOT);
      const depsByPath = computeTemplateDepsMap(assembled);
      const preview = await startTemplatePreviewServer(assembled, REPO_ROOT);
      const outDir = path.join(FILMSTRIPS_DIR, def.id);
      await mkdir(outDir, { recursive: true });
      try {
        for (const compPath of preview.compositions) {
          const sha256 = preview.shaByPath.get(compPath);
          const depsSha256 = depsByPath.get(compPath);
          if (!sha256 || !depsSha256) continue;
          const result = await captureCompositionSprite(page, preview.origin, compPath);
          const relFile = `${def.id}/${safeSlugForPath(compPath)}.jpg`;
          const outPath = path.join(FILMSTRIPS_DIR, relFile);
          await writeFile(outPath, result.jpeg);
          entries[sha256] = {
            templateId: def.id,
            path: compPath,
            file: relFile,
            depsSha256,
            frameCount: result.frameCount,
            frameWidth: result.frameWidth,
            frameHeight: result.frameHeight,
            aspect: result.aspect,
          };
          totalBytes += result.jpeg.byteLength;
          generatedCount += 1;
          console.log(
            `Generated ${relFile} (${result.frameCount}x ${result.frameWidth}x${result.frameHeight}, ${(result.jpeg.byteLength / 1024).toFixed(1)} KiB, sha256=${sha256.slice(0, 12)})`,
          );
        }
      } finally {
        await preview.close();
      }
    }
  } finally {
    await browser.close();
  }

  const sortedEntries: Record<string, BuiltinFilmstripManifestEntry> = {};
  for (const key of Object.keys(entries).sort()) {
    sortedEntries[key] = entries[key]!;
  }
  const manifest: BuiltinFilmstripManifest = {
    version: 1,
    entries: sortedEntries,
  };
  await mkdir(FILMSTRIPS_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    `Wrote ${MANIFEST_PATH} with ${generatedCount} filmstrips (${(totalBytes / 1024).toFixed(1)} KiB total).`,
  );
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
