// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canCaptureCompositionInBrowser,
  captureSampleTimes,
  clearClientCompositionCaptureCacheForTest,
  computeCompositionSampleTimes,
  createClientCompositionCaptureRequest,
  getProgressiveCompositionCapture,
  peekCachedCompositionCapture,
  quantizeCompositionFrameCount,
  retainCachedCompositionCapture,
  seedClientCompositionCaptureForTest,
  selectInitialGateCompositionPaths,
  setCachedProjectRevision,
  setClientCompositionCaptureCapabilityForTest,
  subscribeProgressiveCompositionCapture,
  withPreviewRedirectSafeFetch,
} from "./clientCompositionCapture";
import { bindPreviewLease } from "./previewLease";
import { ThumbnailScheduler } from "./thumbnailScheduler";
import { usePlayerStore } from "../store/playerStore";

afterEach(() => {
  setClientCompositionCaptureCapabilityForTest(null);
  clearClientCompositionCaptureCacheForTest();
  vi.restoreAllMocks();
});

describe("clientCompositionCapture", () => {
  it("samples selector filmstrips inside their visible interval in the rendered composition", () => {
    const clip = { selector: "#card", seekTime: 12, duration: 2, frameCount: 2 };
    expect(captureSampleTimes(20, clip)).toEqual([12.5, 13.5]);
    expect(captureSampleTimes(20, { ...clip, frameCount: 1 })).toEqual([13]);
    // A nested composition has its own clock, independent of its parent's start.
    expect(captureSampleTimes(5, { ...clip, seekTime: 2 })).toEqual([2.5, 3.5]);
    expect(captureSampleTimes(20, { ...clip, selector: undefined })).toEqual([5, 15]);
  });

  it("invalidates selector captures across moves and trims while retaining composition covers", () => {
    const input = { projectId: "windows", previewUrl: "/preview", contentRevision: 1, sessionEpoch: 0,
      frameCount: 2, selector: "#card", seekTime: 5, duration: 2 };
    const cached = seedClientCompositionCaptureForTest(input, [new Blob(["old"])]);
    const key = createClientCompositionCaptureRequest(input).key;
    for (const changed of [{ ...input, seekTime: 6 }, { ...input, duration: 1 }]) {
      expect(createClientCompositionCaptureRequest(changed).key).not.toBe(key);
      expect(peekCachedCompositionCapture(changed)).toBeNull();
    }
    expect(peekCachedCompositionCapture(input)).toBe(cached);
    const whole = { ...input, selector: undefined };
    expect(createClientCompositionCaptureRequest(whole).key)
      .toBe(createClientCompositionCaptureRequest({ ...whole, duration: 3 }).key);
  });

  it("clamps partially visible, zero-length and sub-frame selection windows", () => {
    const clip = { selector: "#card", seekTime: 19, duration: 4, frameCount: 4 };
    const times = captureSampleTimes(20, clip);
    expect(times).toHaveLength(4);
    expect(times.every(value => value > 19 && value < 20)).toBe(true);
    expect(captureSampleTimes(20, { ...clip, duration: 0 })).toEqual([19]);
    expect(captureSampleTimes(20, { ...clip, seekTime: 25 })).toEqual([20]);
    expect(captureSampleTimes(20, { ...clip, seekTime: -1, frameCount: 1 })).toEqual([1.5]);
    expect(captureSampleTimes(20, { ...clip, duration: 0.0001 }).every(t => t > 19 && t < 19.0001)).toBe(true);
  });

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

  it("keeps withPreviewRedirectSafeFetch re-entrant across concurrent same-origin captures and restores fetch only after the last exits", async () => {
    const calls: Array<{ input: RequestInfo | URL; credentials?: RequestCredentials }> = [];
    const origFetch = globalThis.fetch;
    const stubFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, credentials: init?.credentials });
      return new Response("ok");
    }) as unknown as typeof fetch;
    globalThis.fetch = stubFetch;

    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });
    const secondGate = new Promise<void>((r) => { releaseSecond = r; });

    try {
      const job1 = withPreviewRedirectSafeFetch(async () => {
        await globalThis.fetch("/api/projects/p1/preview/assets/one.png", { credentials: "include" });
        await firstGate;
      });
      const job2 = withPreviewRedirectSafeFetch(async () => {
        await secondGate;
        // Runs AFTER job1 has exited: wrapper must still downgrade preview asset credentials.
        await globalThis.fetch("/api/projects/p1/preview/assets/two.png", { credentials: "include" });
      });

      // Finish job1 while job2 is still active.
      releaseFirst();
      await job1;
      expect(globalThis.fetch).not.toBe(stubFetch);

      // Now finish job2 and confirm original fetch is restored exactly.
      releaseSecond();
      await job2;
      expect(globalThis.fetch).toBe(stubFetch);
      expect(calls).toEqual([
        { input: "/api/projects/p1/preview/assets/one.png", credentials: "same-origin" },
        { input: "/api/projects/p1/preview/assets/two.png", credentials: "same-origin" },
      ]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("keeps untouched sibling compositions cached when per-composition revisions update only one scene", () => {
    setCachedProjectRevision("proj-percomp", "rev-1", {
      "compositions/scene-1.html": "sha1:head:shared",
      "compositions/scene-2.html": "sha2:head:shared",
    });

    const scene1Input = {
      previewUrl: "/api/projects/proj-percomp/preview/comp/compositions/scene-1.html",
      projectId: "proj-percomp",
      contentRevision: 0,
      frameCount: 4,
    };
    const scene2Input = {
      previewUrl: "/api/projects/proj-percomp/preview/comp/compositions/scene-2.html",
      projectId: "proj-percomp",
      contentRevision: 0,
      frameCount: 4,
    };
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/pc-${Math.random()}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    seedClientCompositionCaptureForTest(scene1Input, [new Blob(["1a"]), new Blob(["1b"])]);
    seedClientCompositionCaptureForTest(scene2Input, [new Blob(["2a"]), new Blob(["2b"])]);
    const req1Before = createClientCompositionCaptureRequest({ ...scene1Input, sessionEpoch: 1 });
    const req2Before = createClientCompositionCaptureRequest({ ...scene2Input, sessionEpoch: 1 });

    // Only scene-2 changed; whole-project revision bumped from rev-1 -> rev-2.
    setCachedProjectRevision("proj-percomp", "rev-2", {
      "compositions/scene-1.html": "sha1:head:shared",
      "compositions/scene-2.html": "sha2-edited:head:shared",
    });

    expect(peekCachedCompositionCapture(scene1Input)).not.toBeNull();
    expect(peekCachedCompositionCapture(scene2Input)).toBeNull();
    expect(createClientCompositionCaptureRequest({ ...scene1Input, sessionEpoch: 1 }).key).toBe(req1Before.key);
    expect(createClientCompositionCaptureRequest({ ...scene2Input, sessionEpoch: 1 }).key).not.toBe(req2Before.key);
    expect(req1Before.concurrencyBucket).toBe("client-capture");
  });

  it("reuses one shared preview-token across concurrent capture slots and streams progressive frames without duplicating URLs", async () => {
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
    const fetchSpy = vi.fn(async () =>
      Response.json({
        token: "tok-shared-pool",
        previewOrigin: "https://preview.example.test",
        assetLease: "lease-shared",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:test/prog-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revokedUrls.push(String(url));
    });

    try {
      const inputs = [0, 1, 2, 3].map((idx) => ({
        previewUrl: `/api/projects/proj-pool/preview/comp/compositions/scene-${idx}.html`,
        projectId: "proj-pool",
        sessionEpoch: 1,
        contentRevision: 0,
        frameCount: 4,
        duration: 8,
      }));

      // Subscribe to progressive frame updates on scene-0.
      const progressiveSnapshots: Array<ReturnType<typeof getProgressiveCompositionCapture>> = [];
      const unsub = subscribeProgressiveCompositionCapture(inputs[0]!, () => {
        progressiveSnapshots.push(getProgressiveCompositionCapture(inputs[0]!));
      });

      const pending = inputs.map((inp) =>
        createClientCompositionCaptureRequest(inp).load(new AbortController().signal),
      );

      // Exactly 3 concurrent iframes should be spawned (4th waits in pool) and only 1 preview-token POST made.
      let iframes: HTMLIFrameElement[] = [];
      await vi.waitFor(() => {
        iframes = Array.from(
          document.querySelectorAll<HTMLIFrameElement>('iframe[data-openmotion-thumb-capture="true"]'),
        );
        expect(iframes).toHaveLength(3);
        expect(iframes.every((f) => f.src.includes("pt=tok-shared-pool"))).toBe(true);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Attach mock contentWindows to all 3 slots; hold scene-0 after frame 1 to inspect progressive UI state.
      let finishScene0: (() => void) | null = null;
      const attachMockWindow = (iframe: HTMLIFrameElement, holdMidway: boolean) => {
        const win = {
          postMessage: (message: Record<string, unknown>) => {
            if (message.type !== "capture-frames") return;
            expect(message.progressive).toBe(true);
            const sendFrame = (index: number) => {
              window.dispatchEvent(
                new MessageEvent("message", {
                  origin: "https://preview.example.test",
                  source: win as unknown as Window,
                  data: {
                    source: "openmotion-preview-bridge",
                    version: 1,
                    type: "capture-frame",
                    projectId: "proj-pool",
                    token: "tok-shared-pool",
                    requestId: message.requestId,
                    index,
                    total: 4,
                    frame: new Uint8Array([index + 1]).buffer,
                    mimeType: "image/jpeg",
                    width: 240,
                    height: 135,
                    aspect: 16 / 9,
                  },
                }),
              );
            };
            const sendDone = () => {
              window.dispatchEvent(
                new MessageEvent("message", {
                  origin: "https://preview.example.test",
                  source: win as unknown as Window,
                  data: {
                    source: "openmotion-preview-bridge",
                    version: 1,
                    type: "response",
                    projectId: "proj-pool",
                    token: "tok-shared-pool",
                    requestId: message.requestId,
                    ok: true,
                    result: {
                      frames: [],
                      streamed: true,
                      frameCount: 4,
                      mimeType: "image/jpeg",
                      width: 240,
                      height: 135,
                      aspect: 16 / 9,
                    },
                  },
                }),
              );
            };
            queueMicrotask(() => {
              sendFrame(2); // Hero cover frame first
              if (holdMidway) {
                finishScene0 = () => {
                  sendFrame(0);
                  sendFrame(1);
                  sendFrame(3);
                  sendDone();
                };
              } else {
                sendFrame(0);
                sendFrame(1);
                sendFrame(3);
                sendDone();
              }
            });
          },
        };
        Object.defineProperty(iframe, "contentWindow", { configurable: true, value: win });
        return win;
      };

      const slotWins = iframes.map((iframe, idx) => attachMockWindow(iframe, idx === 0));
      for (const win of slotWins) {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://preview.example.test",
            source: win as unknown as Window,
            data: {
              source: "openmotion-preview-bridge",
              version: 1,
              type: "timeline-state",
              projectId: "proj-pool",
              token: "tok-shared-pool",
              duration: 8,
              width: 1280,
              height: 720,
            },
          }),
        );
      }

      // Scene-0 should emit a progressive filmstrip after its very first frame, and seed the 1-frame cover cache.
      await vi.waitFor(() => {
        expect(progressiveSnapshots.length).toBeGreaterThanOrEqual(1);
        expect(finishScene0).not.toBeNull();
      });
      const firstProg = progressiveSnapshots[0];
      expect(firstProg?.kind).toBe("filmstrip");
      const heroUrl = firstProg?.kind === "filmstrip" ? firstProg.urls[0] : "";
      expect(heroUrl).toBeTruthy();

      // Scene-1 and Scene-2 finish, freeing a slot for Scene-3 which reuses the same warm iframe + shared token.
      await vi.waitFor(() => {
        expect(iframes.some((f) => f.src.includes("scene-3.html"))).toBe(true);
      });
      const scene3Idx = iframes.findIndex((f) => f.src.includes("scene-3.html"));
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://preview.example.test",
          source: slotWins[scene3Idx] as unknown as Window,
          data: {
            source: "openmotion-preview-bridge",
            version: 1,
            type: "timeline-state",
            projectId: "proj-pool",
            token: "tok-shared-pool",
            duration: 8,
            width: 1280,
            height: 720,
          },
        }),
      );

      // Complete Scene-0's remaining frames; final filmstrip must reuse heroUrl at index 2 without revoking it.
      finishScene0!();
      const results = await Promise.all(pending);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(document.querySelectorAll('iframe[data-openmotion-thumb-capture="true"]')).toHaveLength(3);
      const scene0Val = results[0]!.value;
      expect(scene0Val.kind).toBe("filmstrip");
      if (scene0Val.kind === "filmstrip") {
        expect(scene0Val.urls).toHaveLength(4);
        expect(scene0Val.urls[2]).toBe(heroUrl);
      }
      expect(revokedUrls).not.toContain(heroUrl);
      expect(getProgressiveCompositionCapture(inputs[0]!)).toBeNull();
      unsub();
      for (const res of results) res.dispose?.();
    } finally {
      if (origSrcDescriptor) Object.defineProperty(HTMLIFrameElement.prototype, "src", origSrcDescriptor);
      globalThis.fetch = origFetch;
      meta.remove();
    }
  });

  it("reuses the live player's bindPreviewLease grant with zero extra preview-token requests", async () => {
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
    const fetchSpy = vi.fn(async () =>
      Response.json({
        token: "tok-live-player",
        previewOrigin: "https://preview.example.test",
        assetLease: "lease-live-player",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:test/live-reuse");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const navigate = vi.fn();
    const liveLease = bindPreviewLease(
      new URL("https://studio.example.test/api/projects/proj-live/preview"),
      "https://preview.example.test",
      navigate,
      vi.fn(),
    );

    try {
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const req = createClientCompositionCaptureRequest({
        previewUrl: "/api/projects/proj-live/preview/comp/compositions/s1.html",
        projectId: "proj-live",
        sessionEpoch: 1,
        contentRevision: 0,
        frameCount: 1,
        duration: 5,
      });
      const pending = req.load(new AbortController().signal);

      let iframe: HTMLIFrameElement | null = null;
      await vi.waitFor(() => {
        iframe = document.querySelector<HTMLIFrameElement>('iframe[data-openmotion-thumb-capture="true"]');
        expect(iframe?.src).toContain("pt=tok-live-player");
      });
      // Zero additional POST /preview-token calls!
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const fakeWin = {
        postMessage: (msg: Record<string, unknown>) => {
          if (msg.type === "capture-frames") {
            queueMicrotask(() => {
              window.dispatchEvent(
                new MessageEvent("message", {
                  origin: "https://preview.example.test",
                  source: fakeWin as unknown as Window,
                  data: {
                    source: "openmotion-preview-bridge",
                    version: 1,
                    type: "response",
                    projectId: "proj-live",
                    token: "tok-live-player",
                    requestId: msg.requestId,
                    ok: true,
                    result: {
                      frames: [new Uint8Array([9, 8]).buffer],
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
      Object.defineProperty(iframe!, "contentWindow", { configurable: true, value: fakeWin });
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://preview.example.test",
          source: fakeWin as unknown as Window,
          data: {
            source: "openmotion-preview-bridge",
            version: 1,
            type: "timeline-state",
            projectId: "proj-live",
            token: "tok-live-player",
            duration: 5,
            width: 1280,
            height: 720,
          },
        }),
      );

      const loaded = await pending;
      expect(loaded.value.kind).toBe("image");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      loaded.dispose?.();
    } finally {
      liveLease.dispose();
      if (origSrcDescriptor) Object.defineProperty(HTMLIFrameElement.prototype, "src", origSrcDescriptor);
      globalThis.fetch = origFetch;
      meta.remove();
    }
  });
});
