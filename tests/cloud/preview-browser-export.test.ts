import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { PREVIEW_BROWSER_EXPORT } from '../../src/studio/engine/preview-browser-export.ts';
import { PREVIEW_BRIDGE_SCRIPT } from '../../src/studio/engine/preview-bridge.ts';
import { BROWSER_EXPORT_VENDOR_PATH, createStudioPreviewRoutes } from '../../src/studio/routes/preview.ts';
import type { DisklessStudioDeps } from '../../src/studio/context.ts';

describe('preview-browser-export embedded bridge helper', () => {
  it('parses as valid ES5 browser code and registers browser-export handlers in preview-bridge', () => {
    assert.doesNotThrow(() => new vm.Script(`(function(){${PREVIEW_BROWSER_EXPORT}})()`));
    assert.match(PREVIEW_BRIDGE_SCRIPT, /browser-export-start/);
    assert.match(PREVIEW_BRIDGE_SCRIPT, /browser-export-cancel/);
    assert.match(PREVIEW_BRIDGE_SCRIPT, /'browser-export'/);
    assert.equal(BROWSER_EXPORT_VENDOR_PATH, '/api/vendor/browser-export.js');
  });

  it('loads the runner lazily, forwards progress, transfers ArrayBuffer, and supports cancellation', async () => {
    const injectedScripts: string[] = [];
    const progressEvents: Array<{ exportId: string; progress: number; stage: string }> = [];
    let observedSignal: AbortSignal | undefined;
    let resolvePendingExport!: (value: { buffer: ArrayBuffer; mimeType: string }) => void;

    const sandbox: Record<string, unknown> = {
      AbortController,
      DOMException,
      Error,
      Promise,
      String,
      window: {},
      document: {
        head: {
          appendChild: (node: { src: string; onload?: () => void }) => {
            injectedScripts.push(node.src);
            (sandbox.window as Record<string, unknown>).__openmotionBrowserExport = {
              run: (
                payload: Record<string, unknown>,
                callbacks: { signal?: AbortSignal; onProgress?: (u: { progress: number; stage: string }) => void },
              ) => {
                observedSignal = callbacks.signal;
                callbacks.onProgress?.({ progress: 50, stage: 'Encoding' });
                if (payload.holdOpen) {
                  return new Promise((resolve) => {
                    resolvePendingExport = resolve;
                  });
                }
                return Promise.resolve({
                  buffer: new Uint8Array([0x00, 0x00, 0x00, 0x18]).buffer,
                  mimeType: 'video/mp4',
                  bytes: 4,
                  durationMs: 12,
                  frameCount: 2,
                  width: 320,
                  height: 180,
                });
              },
            };
            node.onload?.();
          },
        },
        createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
      },
    };

    const helpers = vm.runInNewContext(
      `(function(){${PREVIEW_BROWSER_EXPORT}; return { startBridgeBrowserExport: startBridgeBrowserExport, cancelBridgeBrowserExport: cancelBridgeBrowserExport };})()`,
      sandbox,
    ) as {
      startBridgeBrowserExport: (
        msg: Record<string, unknown>,
        onProgress: (u: { exportId: string; progress: number; stage: string }) => void,
      ) => Promise<{ buffer: ArrayBuffer; mimeType: string }>;
      cancelBridgeBrowserExport: (msg: Record<string, unknown>) => boolean;
    };

    const result = await helpers.startBridgeBrowserExport(
      { exportId: 'exp-1', payload: { format: 'mp4' } },
      (update) => progressEvents.push({ exportId: update.exportId, progress: update.progress, stage: update.stage }),
    );
    assert.deepEqual(injectedScripts, ['/api/vendor/browser-export.js']);
    assert.equal(result.mimeType, 'video/mp4');
    assert.equal(result.buffer.byteLength, 4);
    assert.deepEqual(progressEvents, [{ exportId: 'exp-1', progress: 50, stage: 'Encoding' }]);

    const pending = helpers.startBridgeBrowserExport(
      { exportId: 'exp-cancel', payload: { holdOpen: true } },
      () => {},
    );
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(helpers.cancelBridgeBrowserExport({ exportId: 'exp-cancel' }), true);
    assert.equal(observedSignal?.aborted, true);
    resolvePendingExport({ buffer: new Uint8Array([1]).buffer, mimeType: 'video/mp4' });
    await pending;
  });

  it('enforces studioOrigin on browser-export-start messages in preview-bridge', async () => {
    const posted: Array<{ message: Record<string, unknown>; targetOrigin: string; transfer?: unknown[] }> = [];
    const messageHandlerRef: { current: ((event: Record<string, unknown>) => void) | null } = { current: null };

    const parentWindow = {
      postMessage: (message: Record<string, unknown>, targetOrigin: string, transfer?: unknown[]) => {
        posted.push({ message, targetOrigin, transfer });
      },
    };
    const outBuf = new Uint8Array([1, 2, 3, 4]).buffer;

    const windowObj: Record<string, unknown> = {
      parent: parentWindow,
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => {
        if (type === 'message') messageHandlerRef.current = fn;
      },
      __openmotionBrowserExport: {
        run: async () => ({
          buffer: outBuf,
          mimeType: 'video/mp4',
          bytes: outBuf.byteLength,
          durationMs: 10,
          frameCount: 1,
          width: 320,
          height: 180,
        }),
      },
    };

    const sandbox: Record<string, unknown> = {
      URL,
      Object,
      Array,
      Number,
      Math,
      String,
      Error,
      Promise,
      JSON,
      AbortController,
      DOMException,
      setTimeout,
      clearTimeout,
      setInterval: () => 0,
      clearInterval: () => {},
      location: { href: 'https://preview.example.test/api/projects/p1/preview?pt=tok-1', origin: 'https://preview.example.test' },
      window: windowObj,
      document: {
        readyState: 'complete',
        visibilityState: 'visible',
        referrer: 'https://studio.example.test/',
        currentScript: {
          getAttribute: () =>
            JSON.stringify({
              projectId: 'p1',
              compositionPath: 'index.html',
              sourceVersions: {},
              studioOrigin: 'https://studio.example.test',
            }),
        },
        addEventListener: () => {},
        querySelector: () => null,
        querySelectorAll: () => [],
      },
    };

    vm.runInNewContext(PREVIEW_BRIDGE_SCRIPT, sandbox);
    const dispatchMessage = messageHandlerRef.current;
    assert.ok(dispatchMessage, 'preview bridge must register a message listener');

    // Wrong origin must be ignored
    dispatchMessage({
      source: parentWindow,
      origin: 'https://evil.example.test',
      data: {
        source: 'openmotion-studio',
        version: 1,
        type: 'browser-export-start',
        projectId: 'p1',
        token: 'tok-1',
        requestId: 'req-bad',
        exportId: 'exp-bad',
        payload: {},
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(posted.some((entry) => entry.message.requestId === 'req-bad'), false);

    // Matching studioOrigin succeeds and transfers the ArrayBuffer
    dispatchMessage({
      source: parentWindow,
      origin: 'https://studio.example.test',
      data: {
        source: 'openmotion-studio',
        version: 1,
        type: 'browser-export-start',
        projectId: 'p1',
        token: 'tok-1',
        requestId: 'req-ok',
        exportId: 'exp-ok',
        payload: {},
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    const response = posted.find((entry) => entry.message.type === 'response' && entry.message.requestId === 'req-ok');
    assert.ok(response, 'expected response message for matching studioOrigin');
    assert.equal(response!.message.ok, true);
    assert.equal(response!.transfer?.length, 1);
    assert.equal(response!.transfer?.[0], outBuf);
  });

  it('serves /api/vendor/browser-export.js with ETag, no-cache, and 304 revalidation', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'openmotion-browser-export-route-'));
    try {
      const buildDir = path.join(runtimeRoot, 'studio', 'build');
      await mkdir(buildDir, { recursive: true });
      await writeFile(path.join(buildDir, 'preview-browser-export.js'), 'window.__openmotionBrowserExport={run:async()=>({})};', 'utf8');

      const app = createStudioPreviewRoutes({ runtimeRoot } as unknown as DisklessStudioDeps);

      const res = await app.request(BROWSER_EXPORT_VENDOR_PATH);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /javascript/);
      assert.equal(res.headers.get('cache-control'), 'no-cache');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      const etag = res.headers.get('etag');
      assert.ok(etag && etag.startsWith('"sha256:'));
      assert.match(await res.text(), /__openmotionBrowserExport/);

      const notModified = await app.request(BROWSER_EXPORT_VENDOR_PATH, {
        headers: { 'if-none-match': etag! },
      });
      assert.equal(notModified.status, 304);
      assert.equal(notModified.headers.get('etag'), etag);
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
