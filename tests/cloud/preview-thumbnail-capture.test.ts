import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { PREVIEW_THUMBNAIL_CAPTURE } from '../../src/studio/engine/preview-thumbnail-capture.ts';
import { PREVIEW_BRIDGE_SCRIPT } from '../../src/studio/engine/preview-bridge.ts';
import { SNAPDOM_VENDOR_PATH } from '../../src/studio/routes/preview.ts';

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
});
