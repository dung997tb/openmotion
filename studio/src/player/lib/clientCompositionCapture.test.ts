// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canCaptureCompositionInBrowser,
  clearClientCompositionCaptureCacheForTest,
  computeCompositionSampleTimes,
  createClientCompositionCaptureRequest,
  peekCachedCompositionCapture,
  quantizeCompositionFrameCount,
  retainCachedCompositionCapture,
  seedClientCompositionCaptureForTest,
  selectInitialGateCompositionPaths,
  setCachedProjectRevision,
  setClientCompositionCaptureCapabilityForTest,
  withPreviewRedirectSafeFetch,
} from "./clientCompositionCapture";
import { ThumbnailScheduler } from "./thumbnailScheduler";
import { usePlayerStore } from "../store/playerStore";

afterEach(() => {
  setClientCompositionCaptureCapabilityForTest(null);
  clearClientCompositionCaptureCacheForTest();
  vi.restoreAllMocks();
});

describe("clientCompositionCapture", () => {
  it("disables browser capture automatically under HappyDOM unless overridden", () => {
    expect(canCaptureCompositionInBrowser()).toBe(false);
    setClientCompositionCaptureCapabilityForTest(true);
    expect(canCaptureCompositionInBrowser()).toBe(true);
  });

  it("quantizes tile counts into 1 / 2 / 4 / 8 frames and clamps ultra-short clips", () => {
    expect(quantizeCompositionFrameCount(1, 10)).toBe(1);
    expect(quantizeCompositionFrameCount(2, 10)).toBe(2);
    expect(quantizeCompositionFrameCount(3, 10)).toBe(4);
    expect(quantizeCompositionFrameCount(4, 10)).toBe(4);
    expect(quantizeCompositionFrameCount(5, 10)).toBe(8);
    expect(quantizeCompositionFrameCount(20, 60)).toBe(8);
    expect(quantizeCompositionFrameCount(8, 0.3)).toBe(1);
  });

  it("spaces sample timestamps across the clip while avoiding blank start/end edges", () => {
    expect(computeCompositionSampleTimes(48, 1)).toEqual([3]);
    expect(computeCompositionSampleTimes(2, 1)).toEqual([1]);
    expect(computeCompositionSampleTimes(4, 2)).toEqual([1, 3]);
    const times = computeCompositionSampleTimes(10, 4);
    expect(times).toHaveLength(4);
    expect(times[0]).toBeGreaterThan(0);
    expect(times[3]).toBeLessThan(10);
    expect(times).toEqual([0.4, 3.4, 6.4, 9.4]);
  });

  it("includes project revision and frame count in scheduler request identity", () => {
    setCachedProjectRevision("proj-1", "rev-a");
    const reqA = createClientCompositionCaptureRequest({
      previewUrl: "/api/projects/proj-1/preview/comp/compositions/intro.html",
      projectId: "proj-1",
      sessionEpoch: 0,
      contentRevision: 0,
      frameCount: 4,
      duration: 5,
    });
    setCachedProjectRevision("proj-1", "rev-b");
    const reqB = createClientCompositionCaptureRequest({
      previewUrl: "/api/projects/proj-1/preview/comp/compositions/intro.html",
      projectId: "proj-1",
      sessionEpoch: 0,
      contentRevision: 0,
      frameCount: 4,
      duration: 5,
    });
    expect(reqA.key).not.toBe(reqB.key);
    expect(reqA.kind).toBe("composition");
  });

  it("caps initial blocking gate compositions to the 4 visible clips nearest the playhead", () => {
    const elements = Array.from({ length: 10 }, (_, idx) => ({
      compositionSrc: idx === 4 ? "/api/projects/p1/preview/comp/compositions/s4.html" : `compositions/s${idx}.html`,
      hidden: idx === 5,
      start: idx * 5,
      duration: 5,
    }));
    // Playhead at t=22s sits inside s4 (20..25), next nearest are s3 (dist 2), s2 (dist 7), s6 (dist 8, s5 hidden).
    expect(selectInitialGateCompositionPaths(elements, 22, 4)).toEqual([
      "compositions/s4.html",
      "compositions/s3.html",
      "compositions/s2.html",
      "compositions/s6.html",
    ]);
    // At t=0, picks first 4 clips left-to-right.
    expect(selectInitialGateCompositionPaths(elements, 0, 4)).toEqual([
      "compositions/s0.html",
      "compositions/s1.html",
      "compositions/s2.html",
      "compositions/s3.html",
    ]);
  });

  it("keeps strip object URLs alive past LRU eviction while ThumbnailScheduler retains the result, and revokes on scheduler disposal", async () => {
    const activeUrls = new Set<string>();
    let seq = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:test/strip-${++seq}`;
      activeUrls.add(url);
      return url;
    });
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      activeUrls.delete(url);
    });

    const firstInput = {
      previewUrl: "/api/projects/proj-lru/preview/comp/compositions/scene-0.html",
      projectId: "proj-lru",
      contentRevision: 0,
      frameCount: 2,
    };
    const firstVal = seedClientCompositionCaptureForTest(firstInput, [
      new Blob(["a"], { type: "image/jpeg" }),
      new Blob(["b"], { type: "image/jpeg" }),
    ]);
    expect(firstVal.kind).toBe("filmstrip");
    const firstUrls = firstVal.kind === "filmstrip" ? [...firstVal.urls] : [];
    expect(firstUrls).toHaveLength(2);

    const scheduler = new ThumbnailScheduler();
    const req = createClientCompositionCaptureRequest({
      ...firstInput,
      sessionEpoch: 1,
      duration: 5,
    });
    const lease = scheduler.acquire(req, () => {});
    await vi.waitFor(() => {
      expect(scheduler.getSnapshot(req).status).toBe("ready");
    });

    // Release active lease while ThumbnailScheduler still retains the cached ready entry.
    lease.release();
    expect(scheduler.getSnapshot(req).status).toBe("ready");

    // Cache 65 additional distinct strips so scene-0 is evicted from memoryStripCache (max 64).
    for (let i = 1; i <= 65; i += 1) {
      seedClientCompositionCaptureForTest(
        {
          previewUrl: `/api/projects/proj-lru/preview/comp/compositions/scene-${i}.html`,
          projectId: "proj-lru",
          contentRevision: 0,
          frameCount: 2,
        },
        [new Blob([`f${i}-0`]), new Blob([`f${i}-1`])],
      );
    }

    // Evicted from memoryStripCache, yet URLs stay live because ThumbnailScheduler still owns them.
    expect(peekCachedCompositionCapture(firstInput)).toBeNull();
    for (const url of firstUrls) {
      expect(activeUrls.has(url)).toBe(true);
      expect(revokeSpy).not.toHaveBeenCalledWith(url);
    }

    // Remounting a tile receives the ready scheduler snapshot with readable URLs.
    const remountLease = scheduler.acquire(req, () => {});
    const snap = scheduler.getSnapshot(req);
    expect(snap.status).toBe("ready");
    if (snap.status === "ready" && snap.value.kind === "filmstrip") {
      for (const url of snap.value.urls) expect(activeUrls.has(url)).toBe(true);
    }

    // Once the scheduler drops its entry, its dispose() releases the final ref and revokes the URLs.
    remountLease.release();
    scheduler.invalidateProject("proj-lru");
    for (const url of firstUrls) {
      expect(activeUrls.has(url)).toBe(false);
      expect(revokeSpy).toHaveBeenCalledWith(url);
    }
  });

  it("keeps direct sync-hit and reused cover URLs alive past LRU eviction until consumers release", () => {
    const activeUrls = new Set<string>();
    let seq = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:test/direct-${++seq}`;
      activeUrls.add(url);
      return url;
    });
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      activeUrls.delete(url);
    });

    const firstInput = {
      previewUrl: "/api/projects/proj-direct/preview/comp/compositions/scene-0.html",
      projectId: "proj-direct",
      contentRevision: 0,
      frameCount: 4,
    };
    seedClientCompositionCaptureForTest(firstInput, [
      new Blob(["0"]),
      new Blob(["1"]),
      new Blob(["2"]),
      new Blob(["3"]),
    ]);

    const stripVal = peekCachedCompositionCapture(firstInput);
    expect(stripVal?.kind).toBe("filmstrip");
    const urlsBeforeCover = seq;
    // Sidebar 1-frame cover reuses the resident strip's URL without creating a duplicate object URL.
    const coverVal = peekCachedCompositionCapture({ ...firstInput, frameCount: 1 });
    expect(coverVal?.kind).toBe("image");
    expect(seq).toBe(urlsBeforeCover);

    const releaseStrip = retainCachedCompositionCapture(stripVal);
    const releaseCover = retainCachedCompositionCapture(coverVal);
    const stripUrls = stripVal?.kind === "filmstrip" ? [...stripVal.urls] : [];

    // Push 65 distinct entries to evict scene-0 from memoryStripCache.
    for (let i = 1; i <= 65; i += 1) {
      seedClientCompositionCaptureForTest(
        {
          previewUrl: `/api/projects/proj-direct/preview/comp/compositions/scene-${i}.html`,
          projectId: "proj-direct",
          contentRevision: 0,
          frameCount: 2,
        },
        [new Blob([`a-${i}`]), new Blob([`b-${i}`])],
      );
    }

    // Both consumers still hold leases -> URLs must not be revoked.
    for (const url of stripUrls) expect(activeUrls.has(url)).toBe(true);

    // Releasing only the strip still leaves the sidebar cover active.
    releaseStrip();
    for (const url of stripUrls) expect(activeUrls.has(url)).toBe(true);

    // Releasing the final consumer revokes all URLs for the evicted entry.
    releaseCover();
    for (const url of stripUrls) {
      expect(activeUrls.has(url)).toBe(false);
      expect(revokeSpy).toHaveBeenCalledWith(url);
    }
  });

  it("mounts the isolated capture iframe inside the viewport with opacity 0 so cross-origin rAF is not throttled", async () => {
    const meta = document.createElement("meta");
    meta.name = "openmotion-preview-origin";
    meta.content = "https://preview.example.test/";
    document.head.appendChild(meta);

    usePlayerStore.setState({
      assetReadinessPhase: "ready",
      assetReadinessSkipped: false,
      editorInputLocked: false,
      isPlaying: false,
    });

    const iframeSrcs = new WeakMap<HTMLIFrameElement, string>();
    const origSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
      configurable: true,
      get(this: HTMLIFrameElement) {
        return iframeSrcs.get(this) ?? "";
      },
      set(this: HTMLIFrameElement, value: string) {
        iframeSrcs.set(this, String(value));
      },
    });

    const posted: Array<{ message: Record<string, unknown>; targetOrigin: string }> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        token: "tok-isolated-1",
        previewOrigin: "https://preview.example.test",
        assetLease: "lease-1",
      }),
    ) as unknown as typeof fetch;

    let seq = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/iso-${++seq}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    try {
      const req = createClientCompositionCaptureRequest({
        previewUrl: "/api/projects/proj-iso/preview/comp/compositions/scene-1.html",
        projectId: "proj-iso",
        sessionEpoch: 1,
        contentRevision: 2,
        frameCount: 2,
        duration: 6,
      });

      const controller = new AbortController();
      const pending = req.load(controller.signal);

      let iframe: HTMLIFrameElement | null = null;
      await vi.waitFor(() => {
        iframe = document.querySelector<HTMLIFrameElement>('iframe[data-openmotion-thumb-capture="true"]');
        expect(iframe).toBeTruthy();
        expect(iframe?.src).toContain("https://preview.example.test/api/projects/proj-iso/preview/comp/compositions/scene-1.html");
        expect(iframe?.src).toContain("capture=1");
        expect(iframe?.src).toContain("pt=tok-isolated-1");
      });

      expect(iframe!.style.position).toBe("fixed");
      expect(iframe!.style.left).toBe("0px");
      expect(iframe!.style.top).toBe("0px");
      expect(iframe!.style.opacity).toBe("0");
      expect(iframe!.style.pointerEvents).toBe("none");
      expect(iframe!.style.zIndex).toBe("-1");
      expect(iframe!.hasAttribute("inert")).toBe(true);
      expect(iframe!.referrerPolicy).toBe("no-referrer");

      const fakeContentWindow = {
        postMessage: (message: Record<string, unknown>, targetOrigin: string) => {
          posted.push({ message, targetOrigin });
          if (message.type === "capture-frames") {
            queueMicrotask(() => {
              window.dispatchEvent(
                new MessageEvent("message", {
                  origin: "https://preview.example.test",
                  source: fakeContentWindow as unknown as Window,
                  data: {
                    source: "openmotion-preview-bridge",
                    version: 1,
                    type: "response",
                    projectId: "proj-iso",
                    token: "tok-isolated-1",
                    requestId: message.requestId,
                    ok: true,
                    result: {
                      frames: [new Uint8Array([1, 2]).buffer, new Uint8Array([3, 4]).buffer],
                      mimeType: "image/jpeg",
                      width: 240,
                      height: 135,
                      aspect: 16 / 9,
                    },
                  },
                }),
              );
            });
          }
        },
      };
      Object.defineProperty(iframe!, "contentWindow", {
        configurable: true,
        value: fakeContentWindow,
      });

      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://preview.example.test",
          source: fakeContentWindow as unknown as Window,
          data: {
            source: "openmotion-preview-bridge",
            version: 1,
            type: "timeline-state",
            projectId: "proj-iso",
            token: "tok-isolated-1",
            duration: 6,
            width: 1080,
            height: 1920,
          },
        }),
      );

      const loaded = await pending;
      expect(iframe!.style.width).toBe("1080px");
      expect(iframe!.style.height).toBe("1920px");
      expect(posted).toHaveLength(1);
      expect(posted[0]?.targetOrigin).toBe("https://preview.example.test");
      expect(loaded.value.kind).toBe("filmstrip");
      if (loaded.value.kind === "filmstrip") {
        expect(loaded.value.urls).toHaveLength(2);
      }
      loaded.dispose?.();
    } finally {
      if (origSrcDescriptor) Object.defineProperty(HTMLIFrameElement.prototype, "src", origSrcDescriptor);
      globalThis.fetch = origFetch;
      meta.remove();
      document.querySelector('iframe[data-openmotion-thumb-capture="true"]')?.remove();
    }
  });

  it("fails fast on preview-build-busy and resets the capture iframe to about:blank", async () => {
    const meta = document.createElement("meta");
    meta.name = "openmotion-preview-origin";
    meta.content = "https://preview.example.test";
    document.head.appendChild(meta);

    usePlayerStore.setState({
      assetReadinessPhase: "ready",
      assetReadinessSkipped: false,
      editorInputLocked: false,
      isPlaying: false,
    });

    const iframeSrcs = new WeakMap<HTMLIFrameElement, string>();
    const origSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
      configurable: true,
      get(this: HTMLIFrameElement) {
        return iframeSrcs.get(this) ?? "";
      },
      set(this: HTMLIFrameElement, value: string) {
        iframeSrcs.set(this, String(value));
      },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        token: "tok-busy-1",
        previewOrigin: "https://preview.example.test",
        assetLease: "lease-busy",
      }),
    ) as unknown as typeof fetch;

    try {
      const req = createClientCompositionCaptureRequest({
        previewUrl: "/api/projects/proj-busy/preview/comp/compositions/scene-busy.html",
        projectId: "proj-busy",
        sessionEpoch: 1,
        contentRevision: 1,
        frameCount: 2,
        duration: 5,
      });

      const pending = req.load(new AbortController().signal);
      let iframe: HTMLIFrameElement | null = null;
      await vi.waitFor(() => {
        iframe = document.querySelector<HTMLIFrameElement>('iframe[data-openmotion-thumb-capture="true"]');
        expect(iframe?.src).toContain("pt=tok-busy-1");
      });

      const fakeContentWindow = {} as Window;
      Object.defineProperty(iframe!, "contentWindow", {
        configurable: true,
        value: fakeContentWindow,
      });

      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://preview.example.test",
          source: fakeContentWindow,
          data: {
            source: "openmotion-preview-bridge",
            version: 1,
            type: "preview-build-busy",
            projectId: "proj-busy",
            token: "tok-busy-1",
            retryAfterMs: 1000,
          },
        }),
      );

      await expect(pending).rejects.toThrow(/busy/i);
      expect(iframe!.src).toBe("about:blank");
    } finally {
      if (origSrcDescriptor) Object.defineProperty(HTMLIFrameElement.prototype, "src", origSrcDescriptor);
      globalThis.fetch = origFetch;
      meta.remove();
      document.querySelector('iframe[data-openmotion-thumb-capture="true"]')?.remove();
    }
  });

  it("downgrades credentials from include to same-origin only for same-origin preview assets and restores fetch", async () => {
    const calls: Array<{ input: RequestInfo | URL; credentials?: RequestCredentials }> = [];
    const origFetch = globalThis.fetch;
    const stubFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, credentials: init?.credentials });
      return new Response("ok");
    }) as unknown as typeof fetch;
    globalThis.fetch = stubFetch;

    try {
      await withPreviewRedirectSafeFetch(async () => {
        await globalThis.fetch("/api/projects/p1/preview/assets/hero.png", { credentials: "include" });
        await globalThis.fetch("/motion-api/projects", { credentials: "include" });
        await globalThis.fetch("https://cdn.example.test/image.png", { credentials: "include" });
      });
      expect(globalThis.fetch).toBe(stubFetch);
      expect(calls).toEqual([
        { input: "/api/projects/p1/preview/assets/hero.png", credentials: "same-origin" },
        { input: "/motion-api/projects", credentials: "include" },
        { input: "https://cdn.example.test/image.png", credentials: "include" },
      ]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
