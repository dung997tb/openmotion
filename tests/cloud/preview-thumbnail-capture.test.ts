import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { PREVIEW_THUMBNAIL_CAPTURE } from '../../src/studio/engine/preview-thumbnail-capture.ts';
import { PREVIEW_BRIDGE_SCRIPT } from '../../src/studio/engine/preview-bridge.ts';
import { buildSubCompositionHtmlInMemory } from '../../src/studio/engine/preview-bundler.ts';
import { SNAPDOM_VENDOR_PATH } from '../../src/studio/routes/preview.ts';
import { computeCompositionRevisions } from '../../src/studio/routes/projects.ts';

describe('preview-thumbnail-capture embedded bridge script', () => {
  it('parses as valid ES5 browser code and registers capture-frames in preview-bridge', () => {
    assert.doesNotThrow(() => new vm.Script(`(function(){${PREVIEW_THUMBNAIL_CAPTURE}})()`));
    assert.match(PREVIEW_BRIDGE_SCRIPT, /capture-frames/);
    assert.match(PREVIEW_BRIDGE_SCRIPT, /thumbnail-capture/);
    assert.equal(SNAPDOM_VENDOR_PATH, '/api/vendor/snapdom.js');
  });

  it('pauses playback, recovers when rAF is throttled, and downgrades preview-asset fetch credentials for 302 S3 redirects', async () => {
    let paused = false;
    const sought: number[] = [];
    const observedFetches: Array<{ url: string; credentials?: string }> = [];
    const origFetch = (input: string, init?: { credentials?: string }) => {
      observedFetches.push({ url: input, credentials: init?.credentials });
      return Promise.resolve({ ok: true });
    };

    const fakeStage = {
      nodeType: 1,
      tagName: 'DIV',
      clientWidth: 1280,
      clientHeight: 720,
      textContent: 'Hello',
      getAttribute: (name: string) => (name === 'data-width' ? '1280' : name === 'data-height' ? '720' : null),
      querySelectorAll: () => [],
      querySelector: () => null,
      getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    };

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (cb: (blob: { arrayBuffer: () => Promise<ArrayBuffer> }) => void) => {
        cb({ arrayBuffer: () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0x01]).buffer) });
      },
    };

    const sandbox: Record<string, unknown> = {
      URL,
      Promise,
      Array,
      Object,
      Number,
      Math,
      String,
      Error,
      setTimeout,
      clearTimeout,
      location: { origin: 'https://preview.example.test', href: 'https://preview.example.test/api/projects/p1/preview/comp/s1.html?capture=1&pt=tok' },
      // Simulate throttled cross-origin iframe where requestAnimationFrame never fires.
      requestAnimationFrame: () => 0,
      player: () => ({
        pause: () => { paused = true; },
        seek: (t: number) => { sought.push(t); },
      }),
      document: {
        body: fakeStage,
        fonts: { ready: Promise.resolve() },
        querySelector: () => fakeStage,
        querySelectorAll: () => [],
        createElement: (tag: string) => (tag === 'canvas' ? { ...fakeCanvas } : {}),
      },
      window: {
        innerWidth: 1280,
        innerHeight: 720,
        fetch: origFetch,
        snapdom: async () => {
          const fetchFn = (sandbox.window as { fetch: typeof origFetch }).fetch;
          await fetchFn('https://preview.example.test/api/projects/p1/preview/~assets/lease/assets/hero.png', { credentials: 'include' });
          await fetchFn('https://cdn.example.test/other.png', { credentials: 'include' });
          return { toCanvas: async () => ({}) };
        },
      },
    };

    const capturePreviewFrames = vm.runInNewContext(
      `(function(){${PREVIEW_THUMBNAIL_CAPTURE}; return capturePreviewFrames;})()`,
      sandbox,
    ) as (msg: Record<string, unknown>) => Promise<{ frames: ArrayBuffer[]; width: number; height: number }>;

    const result = await capturePreviewFrames({ times: [0.5, 2.5], width: 240 });
    assert.equal(paused, true);
    assert.deepEqual(sought, [0.5, 2.5]);
    assert.equal(result.frames.length, 2);
    assert.equal(result.width, 240);
    assert.equal(result.height, 135);
    assert.equal((sandbox.window as { fetch: unknown }).fetch, origFetch, 'window.fetch must be restored');
    assert.deepEqual(observedFetches.slice(0, 2), [
      {
        url: 'https://preview.example.test/api/projects/p1/preview/~assets/lease/assets/hero.png',
        credentials: 'same-origin',
      },
      {
        url: 'https://cdn.example.test/other.png',
        credentials: 'include',
      },
    ]);
  });

  it('streams progressive frames hero-cover first and returns streamed metadata when onFrame is supplied', async () => {
    const sought: number[] = [];
    const emitted: Array<{ index: number; total: number; byte0: number }> = [];
    let frameCounter = 0;

    const fakeStage = {
      nodeType: 1,
      tagName: 'DIV',
      clientWidth: 1920,
      clientHeight: 1080,
      textContent: 'Scene',
      getAttribute: (name: string) => (name === 'data-width' ? '1920' : name === 'data-height' ? '1080' : null),
      querySelectorAll: () => [],
      querySelector: () => null,
      getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
    };

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (cb: (blob: { arrayBuffer: () => Promise<ArrayBuffer> }) => void) => {
        const seq = ++frameCounter;
        cb({ arrayBuffer: () => Promise.resolve(new Uint8Array([seq]).buffer) });
      },
    };

    const sandbox: Record<string, unknown> = {
      URL,
      Promise,
      Array,
      Object,
      Number,
      Math,
      String,
      Error,
      setTimeout,
      clearTimeout,
      location: { origin: 'https://preview.example.test', href: 'https://preview.example.test/api/projects/p1/preview/comp/s1.html?capture=1&pt=tok' },
      requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
      player: () => ({
        pause: () => {},
        seek: (t: number) => { sought.push(t); },
      }),
      document: {
        body: fakeStage,
        fonts: { ready: Promise.resolve() },
        querySelector: () => fakeStage,
        querySelectorAll: () => [],
        createElement: (tag: string) => (tag === 'canvas' ? { ...fakeCanvas } : {}),
      },
      window: {
        innerWidth: 1920,
        innerHeight: 1080,
        fetch: () => Promise.resolve({ ok: true }),
        snapdom: async () => ({ toCanvas: async () => ({}) }),
      },
    };

    const capturePreviewFrames = vm.runInNewContext(
      `(function(){${PREVIEW_THUMBNAIL_CAPTURE}; return capturePreviewFrames;})()`,
      sandbox,
    ) as (
      msg: Record<string, unknown>,
      onFrame: (ev: { index: number; total: number; frame: ArrayBuffer }, buf: ArrayBuffer) => void,
    ) => Promise<{ frames: ArrayBuffer[]; streamed?: boolean; frameCount?: number }>;

    const result = await capturePreviewFrames({ times: [0.4, 3.4, 6.4, 9.4], width: 240, progressive: true }, (ev, buf) => {
      emitted.push({ index: ev.index, total: ev.total, byte0: new Uint8Array(buf)[0]! });
    });

    // Mid-scene hero frame (index 2 => 6.4s) is captured and streamed first, then remaining indices.
    assert.deepEqual(sought, [6.4, 0.4, 3.4, 9.4]);
    assert.deepEqual(emitted.map((e) => e.index), [2, 0, 1, 3]);
    assert.equal(result.streamed, true);
    assert.equal(result.frameCount, 4);
    assert.equal(result.frames.length, 0);
  });

  it('announces capture=1 timeline-state immediately via fast boot poll without waiting 500ms or preloading video', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const appendedScripts: string[] = [];
    let videoLoadCalls = 0;
    const intervals: Array<ReturnType<typeof setInterval>> = [];
    const trackedSetInterval = ((fn: () => void, ms: number) => {
      const id = setInterval(fn, ms);
      intervals.push(id);
      return id;
    }) as typeof setInterval;

    const fakeVideo = {
      tagName: 'VIDEO',
      preload: 'none',
      readyState: 0,
      networkState: 0,
      hasAttribute: () => false,
      getAttribute: (name: string) => (name === 'src' ? 'assets/heavy.mp4' : null),
      querySelector: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
      load: () => { videoLoadCalls += 1; },
    };

    const fakeWindow: Record<string, unknown> = {
      addEventListener: () => {},
      innerWidth: 1920,
      innerHeight: 1080,
      __player: null,
      __clipManifest: { compositionWidth: 1920, compositionHeight: 1080, fps: 30, durationInFrames: 180 },
      parent: {
        postMessage: (msg: Record<string, unknown>) => {
          posted.push(msg);
        },
      },
    };
    const fakeDocument = {
      readyState: 'interactive',
      visibilityState: 'visible',
      referrer: 'https://studio.example.test/',
      baseURI: 'https://preview.example.test/api/projects/p1/preview/~assets/lease-1/',
      currentScript: {
        getAttribute: () => JSON.stringify({ projectId: 'p1', compositionPath: 'compositions/s1.html', sourceVersions: {} }),
      },
      head: {
        appendChild: (node: { src?: string }) => {
          if (node.src) appendedScripts.push(node.src);
        },
      },
      documentElement: { appendChild: () => {} },
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: (sel: string) => (sel === 'video' ? [fakeVideo] : []),
      createElement: () => ({}),
    };

    const sandbox: Record<string, unknown> = {
      URL,
      Promise,
      Array,
      Object,
      Number,
      Math,
      String,
      Error,
      JSON,
      Boolean,
      setTimeout,
      clearTimeout,
      setInterval: trackedSetInterval,
      clearInterval,
      location: {
        origin: 'https://preview.example.test',
        href: 'https://preview.example.test/api/projects/p1/preview/comp/compositions/s1.html?capture=1&pt=tok-fast',
      },
      window: fakeWindow,
      document: fakeDocument,
      innerWidth: 1920,
      innerHeight: 1080,
    };

    try {
      const start = Date.now();
      vm.runInNewContext(PREVIEW_BRIDGE_SCRIPT, sandbox);
      // SnapDOM preload starts eagerly in capture=1 mode.
      assert.deepEqual(appendedScripts, ['/api/vendor/snapdom.js']);

      // Simulate async runtime boot 30ms later (well before the 500ms heartbeat, without window.load).
      setTimeout(() => {
        fakeWindow.__player = { getTime: () => 0, getDuration: () => 6, isPlaying: () => false };
      }, 30);

      await new Promise<void>((resolve, reject) => {
        const check = setInterval(() => {
          if (posted.some((m) => m.type === 'timeline-state' && Number(m.duration) === 6)) {
            clearInterval(check);
            resolve();
          } else if (Date.now() - start > 300) {
            clearInterval(check);
            reject(new Error('Expected fast boot poll to emit timeline-state well under 500ms'));
          }
        }, 10);
      });

      const elapsed = Date.now() - start;
      assert.ok(elapsed < 300, `Expected <300ms fast boot handshake, got ${elapsed}ms`);
      assert.equal(videoLoadCalls, 0, 'capture=1 must not preload <video> elements via asset tracker');
      assert.equal(fakeVideo.preload, 'none');
    } finally {
      for (const id of intervals) clearInterval(id);
    }
  });

  it('computes per-composition cache revisions so single-scene edits preserve untouched static siblings while shared edits invalidate all', () => {
    const baseFiles = [
      { path: 'index.html', sha256: 'idx-1' },
      { path: 'compositions/s1.html', sha256: 's1-aaaaaaaaaaaaaaaa' },
      { path: 'compositions/s2.html', sha256: 's2-bbbbbbbbbbbbbbbb' },
      { path: 'assets/hero.png', sha256: 'img-1' },
      { path: 'styles/theme.css', sha256: 'css-1' },
    ];
    const comps = ['index.html', 'compositions/s1.html', 'compositions/s2.html'];
    const indexV1 = '<html><head><link rel="stylesheet" href="styles/theme.css"></head><body><div>v1</div></body></html>';
    const textByPath: Record<string, string> = {
      'index.html': indexV1,
      'compositions/s1.html': '<template><div data-composition-id="s1"><h1>Scene 1</h1></div></template>',
      'compositions/s2.html': '<template><div data-composition-id="s2"><h1>Scene 2</h1></div></template>',
    };
    const readText = (p: string) => textByPath[p] ?? null;

    const rev1 = computeCompositionRevisions(baseFiles, comps, indexV1, 'proj-rev-1', readText);

    // Editing only s2.html leaves static s1.html unchanged while changing s2.html and root index.html.
    const filesS2Edited = baseFiles.map((f) =>
      f.path === 'compositions/s2.html' ? { ...f, sha256: 's2-cccccccccccccccc' } : f,
    );
    const rev2 = computeCompositionRevisions(filesS2Edited, comps, indexV1, 'proj-rev-2', readText);
    assert.equal(rev2['compositions/s1.html'], rev1['compositions/s1.html']);
    assert.notEqual(rev2['compositions/s2.html'], rev1['compositions/s2.html']);
    assert.notEqual(rev2['index.html'], rev1['index.html']);

    // Editing only index.html body preserves static sub-composition revisions.
    const indexBodyEdited = '<html><head><link rel="stylesheet" href="styles/theme.css"></head><body><div>v2</div></body></html>';
    const rev3 = computeCompositionRevisions(baseFiles, comps, indexBodyEdited, 'proj-rev-3', readText);
    assert.equal(rev3['compositions/s1.html'], rev1['compositions/s1.html']);
    assert.equal(rev3['compositions/s2.html'], rev1['compositions/s2.html']);
    assert.notEqual(rev3['index.html'], rev1['index.html']);

    // Editing index.html <head> invalidates all sub-compositions.
    const indexHeadEdited = '<html><head><style>body{color:rgb(255, 0, 0)}</style></head><body><div>v1</div></body></html>';
    const rev4 = computeCompositionRevisions(baseFiles, comps, indexHeadEdited, 'proj-rev-4', readText);
    assert.notEqual(rev4['compositions/s1.html'], rev1['compositions/s1.html']);
    assert.notEqual(rev4['compositions/s2.html'], rev1['compositions/s2.html']);

    // Editing a shared asset invalidates all sub-compositions.
    const filesAssetEdited = baseFiles.map((f) =>
      f.path === 'assets/hero.png' ? { ...f, sha256: 'img-2' } : f,
    );
    const rev5 = computeCompositionRevisions(filesAssetEdited, comps, indexV1, 'proj-rev-5', readText);
    assert.notEqual(rev5['compositions/s1.html'], rev1['compositions/s1.html']);
    assert.notEqual(rev5['compositions/s2.html'], rev1['compositions/s2.html']);
  });

  it('falls back to projectRevision for scripted/dynamic compositions so runtime reads of another HTML file never serve stale caches', () => {
    const files = [
      { path: 'index.html', sha256: 'idx-1' },
      { path: 'compositions/parent-scripted.html', sha256: 'parent-1' },
      { path: 'compositions/child-color.html', sha256: 'child-red' },
      { path: 'compositions/static-sibling.html', sha256: 'static-1' },
      { path: 'compositions/nested-dynamic.html', sha256: 'nested-dyn-1' },
    ];
    const comps = files.map((f) => f.path);
    const textByPath: Record<string, string> = {
      'index.html': '<html><head><title>App</title></head><body></body></html>',
      'compositions/parent-scripted.html':
        '<div data-composition-id="parent"><script>fetch("compositions/child-color.html").then(r=>r.text()).then(t=>{document.body.style.background=t;});</script></div>',
      'compositions/child-color.html': '<div data-composition-id="color">red</div>',
      'compositions/static-sibling.html': '<div data-composition-id="static"><h1>Static</h1></div>',
      'compositions/nested-dynamic.html':
        '<div data-composition-id="nested"><div data-composition-src="parent-scripted.html"></div></div>',
    };
    const readText = (p: string) => textByPath[p] ?? null;

    const revRed = computeCompositionRevisions(files, comps, textByPath['index.html'], 'proj-red', readText);
    assert.equal(revRed['compositions/parent-scripted.html'], 'proj-red');
    assert.equal(revRed['compositions/nested-dynamic.html'], 'proj-red');
    assert.notEqual(revRed['compositions/static-sibling.html'], 'proj-red');

    // Child HTML changes from red to blue: scripted parent AND compositions embedding it MUST invalidate on reopen,
    // while unrelated purely static siblings remain cached.
    const blueFiles = files.map((f) =>
      f.path === 'compositions/child-color.html' ? { ...f, sha256: 'child-blue' } : f,
    );
    const revBlue = computeCompositionRevisions(blueFiles, comps, textByPath['index.html'], 'proj-blue', readText);
    assert.equal(revBlue['compositions/parent-scripted.html'], 'proj-blue');
    assert.notEqual(revBlue['compositions/parent-scripted.html'], revRed['compositions/parent-scripted.html']);
    assert.equal(revBlue['compositions/nested-dynamic.html'], 'proj-blue');
    assert.equal(revBlue['compositions/static-sibling.html'], revRed['compositions/static-sibling.html']);

    // A <script> in index.html <head> affects every sub-composition, so all compositions fall back to projectRevision.
    const scriptedHeadIndex = '<html><head><script>window.__color="blue";</script></head><body></body></html>';
    const revScriptedHead = computeCompositionRevisions(files, comps, scriptedHeadIndex, 'proj-head-script', readText);
    for (const comp of comps) {
      assert.equal(revScriptedHead[comp], 'proj-head-script');
    }

    // Without readText, fail closed to projectRevision for all compositions.
    const revNoReader = computeCompositionRevisions(files, comps, textByPath['index.html'], 'proj-no-reader');
    for (const comp of comps) {
      assert.equal(revNoReader[comp], 'proj-no-reader');
    }
  });

  it('folds transitive data-composition-src dependencies into per-composition revisions with cycle safety', () => {
    const files = [
      { path: 'index.html', sha256: 'idx-1' },
      { path: 'compositions/nested-shell.html', sha256: 'shell-1' },
      { path: 'compositions/title-card.html', sha256: 'card-1' },
      { path: 'compositions/other.html', sha256: 'other-1' },
      { path: 'compositions/cycle-a.html', sha256: 'ca-1' },
      { path: 'compositions/cycle-b.html', sha256: 'cb-1' },
    ];
    const comps = files.map((f) => f.path);
    const textByPath: Record<string, string> = {
      'index.html': '<html><head></head><body></body></html>',
      'compositions/nested-shell.html':
        '<div data-composition-id="shell"><div data-composition-src="title-card.html"></div></div>',
      'compositions/title-card.html': '<div data-composition-id="card"><h1>Title</h1></div>',
      'compositions/other.html': '<div data-composition-id="other">Unrelated</div>',
      'compositions/cycle-a.html': '<div data-composition-src="compositions/cycle-b.html"></div>',
      'compositions/cycle-b.html': '<div data-composition-src="cycle-a.html"></div>',
    };
    const readText = (p: string) => textByPath[p] ?? null;

    const revBefore = computeCompositionRevisions(files, comps, textByPath['index.html'], 'proj-1', readText);

    // Editing title-card.html invalidates nested-shell.html, title-card.html, and index.html,
    // while leaving unrelated other.html untouched.
    const editedFiles = files.map((f) =>
      f.path === 'compositions/title-card.html' ? { ...f, sha256: 'card-2' } : f,
    );
    const revAfter = computeCompositionRevisions(editedFiles, comps, textByPath['index.html'], 'proj-2', readText);

    assert.notEqual(revAfter['compositions/title-card.html'], revBefore['compositions/title-card.html']);
    assert.notEqual(revAfter['compositions/nested-shell.html'], revBefore['compositions/nested-shell.html']);
    assert.equal(revAfter['compositions/other.html'], revBefore['compositions/other.html']);
    assert.equal(revAfter['compositions/cycle-a.html'], revBefore['compositions/cycle-a.html']);
    assert.equal(revAfter['compositions/cycle-b.html'], revBefore['compositions/cycle-b.html']);
  });

  it('inlines decoded images to data URLs once and memoizes preview-asset fetches across multi-frame captures', async () => {
    const attrs: Record<string, string> = { src: 'assets/hero.png' };
    const fakeImg = {
      complete: true,
      naturalWidth: 1600,
      naturalHeight: 900,
      src: 'https://preview.example.test/api/projects/p1/preview/~assets/lease/assets/hero.png',
      currentSrc: 'https://preview.example.test/api/projects/p1/preview/~assets/lease/assets/hero.png',
      getAttribute: (name: string) => attrs[name] ?? null,
      setAttribute: (name: string, val: string) => { attrs[name] = val; },
      hasAttribute: (name: string) => name in attrs,
      removeAttribute: (name: string) => { delete attrs[name]; },
    };
    const fakeStage = {
      nodeType: 1,
      tagName: 'DIV',
      clientWidth: 1280,
      clientHeight: 720,
      textContent: 'With image',
      getAttribute: (name: string) => (name === 'data-width' ? '1280' : name === 'data-height' ? '720' : null),
      querySelectorAll: (sel: string) => (sel === 'img' ? [fakeImg] : []),
      querySelector: () => null,
      getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    };

    let fetchCount = 0;
    const origFetch = async () => {
      fetchCount += 1;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    };

    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
      toBlob: (cb: (blob: { arrayBuffer: () => Promise<ArrayBuffer> }) => void) => {
        cb({ arrayBuffer: () => Promise.resolve(new Uint8Array([0xff, 0xd8]).buffer) });
      },
    };

    const sandbox: Record<string, unknown> = {
      URL,
      Response,
      Promise,
      Array,
      Object,
      Number,
      Math,
      String,
      Error,
      setTimeout,
      clearTimeout,
      location: {
        origin: 'https://preview.example.test',
        href: 'https://preview.example.test/api/projects/p1/preview/comp/s1.html?capture=1&pt=tok',
      },
      requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
      player: () => ({ pause: () => {}, seek: () => {} }),
      document: {
        body: fakeStage,
        fonts: { ready: Promise.resolve() },
        querySelector: () => fakeStage,
        querySelectorAll: () => [],
        createElement: (tag: string) => (tag === 'canvas' ? { ...fakeCanvas } : {}),
      },
      window: {
        innerWidth: 1280,
        innerHeight: 720,
        fetch: origFetch,
        snapdom: async () => {
          const fetchFn = (sandbox.window as { fetch: (u: string, init?: RequestInit) => Promise<Response> }).fetch;
          // Simulate a CSS background-image fetch happening on every frame.
          await fetchFn('https://preview.example.test/api/projects/p1/preview/~assets/lease/assets/bg.png', { credentials: 'include' });
          return { toCanvas: async () => ({}) };
        },
      },
    };

    const capturePreviewFrames = vm.runInNewContext(
      `(function(){${PREVIEW_THUMBNAIL_CAPTURE}; return capturePreviewFrames;})()`,
      sandbox,
    ) as (msg: Record<string, unknown>) => Promise<{ frames: ArrayBuffer[] }>;

    const result = await capturePreviewFrames({ times: [1, 2, 3, 4], width: 240 });
    assert.equal(result.frames.length, 4);
    assert.equal(attrs.src, 'data:image/png;base64,iVBORw0KGgo=');
    assert.equal(attrs.width, '1600');
    assert.equal(attrs.height, '900');
    assert.equal(fetchCount, 1, 'identical preview asset GETs across frames must be memoized');
  });

  it('adds crossorigin="anonymous" on project-local <img> tags and snapdom preload only in capture=1 isolated builds', async () => {
    const files = new Map<string, string>([
      ['index.html', '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>'],
      [
        'compositions/scene-1.html',
        '<template><div data-composition-id="scene-1" data-width="1920" data-height="1080">' +
          '<img src="assets/local.png">' +
          '<img src="https://cdn.example.test/external.png">' +
          '</div></template>',
      ],
    ]);
    const virtual = {
      projectId: 'p1',
      projectName: 'Test',
      revision: 'rev-1',
      getBlobMetadata: () => null,
      listFiles: () =>
        [...files.keys()].map((p) => ({
          path: p,
          sha256: 'a'.repeat(64),
          sizeBytes: files.get(p)!.length,
          mimeType: 'text/html',
          isText: true,
          blobScope: 'workspace' as const,
          updatedAt: new Date(),
          metadata: null,
        })),
      getFile: (p: string) =>
        files.has(p)
          ? {
              path: p,
              sha256: 'a'.repeat(64),
              sizeBytes: files.get(p)!.length,
              mimeType: 'text/html',
              isText: true,
              blobScope: 'workspace' as const,
              updatedAt: new Date(),
              metadata: null,
            }
          : null,
      exists: (p: string) => files.has(p) || p === 'assets/local.png',
      readText: (p: string) => files.get(p) ?? null,
    };

    const captureHtml = await buildSubCompositionHtmlInMemory(virtual, 'compositions/scene-1.html', {
      capture: true,
      bridgeOrigin: 'https://preview.example.test',
      skipDeterministicFonts: true,
    });
    assert.ok(captureHtml);
    assert.match(captureHtml, /<link rel="preload" as="script" href="https:\/\/preview\.example\.test\/api\/vendor\/snapdom\.js">/);
    assert.match(captureHtml, /<img(?=[^>]*\bsrc="assets\/local\.png")(?=[^>]*\bcrossorigin="anonymous")[^>]*>/);
    assert.doesNotMatch(captureHtml, /<img(?=[^>]*\bsrc="https:\/\/cdn\.example\.test\/external\.png")(?=[^>]*\bcrossorigin="anonymous")[^>]*>/);

    const interactiveHtml = await buildSubCompositionHtmlInMemory(virtual, 'compositions/scene-1.html', {
      capture: false,
      bridgeOrigin: 'https://preview.example.test',
      skipDeterministicFonts: true,
    });
    assert.ok(interactiveHtml);
    assert.doesNotMatch(interactiveHtml, /snapdom\.js/);
    assert.doesNotMatch(interactiveHtml, /<img[^>]*crossorigin="anonymous"/);
  });
});
