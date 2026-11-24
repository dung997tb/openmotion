// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyframeCacheEntry } from "../player/store/keyframeSlice";
import type { TimelineElement } from "../player/store/timelineElement";
import { clearSharedPreviewGrantsForTest } from "../player/lib/previewLease";
import {
  buildIsolatedExportPreviewUrl,
  runIsolatedBrowserExport,
  sanitizeIsolatedExportMimeType,
} from "./isolatedBrowserExport";

function makeElement(overrides: Partial<TimelineElement>): TimelineElement {
  return {
    id: "el-1",
    tag: "div",
    start: 0,
    duration: 2,
    track: 0,
    ...overrides,
  };
}

afterEach(() => {
  clearSharedPreviewGrantsForTest();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isolatedBrowserExport helpers", () => {
  it("sanitizes MIME types strictly to MP4/WebM and rejects unsafe HTML/SVG types", () => {
    expect(sanitizeIsolatedExportMimeType("video/mp4", "mp4")).toBe("video/mp4");
    expect(sanitizeIsolatedExportMimeType('video/mp4; codecs="avc1.640028, mp4a.40.2"', "mp4")).toBe(
      'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    );
    expect(sanitizeIsolatedExportMimeType("video/webm", "webm")).toBe("video/webm");
    expect(sanitizeIsolatedExportMimeType("video/webm", "mp4")).toBe("video/mp4");
    expect(sanitizeIsolatedExportMimeType("text/html", "mp4")).toBe("video/mp4");
    expect(sanitizeIsolatedExportMimeType("image/svg+xml", "webm")).toBe("video/webm");
    expect(sanitizeIsolatedExportMimeType(undefined, "mp4")).toBe("video/mp4");
  });

  it("preserves composition path and variables while enforcing capture=1 and fresh preview token", () => {
    const live = document.createElement("iframe");
    live.setAttribute(
      "src",
      "https://openmotion-preview.example.test/api/projects/demo/preview/comp/intro.html?variables=%7B%22title%22%3A%22Hi%22%7D&pt=old-token",
    );

    const url = buildIsolatedExportPreviewUrl({
      projectId: "demo",
      previewOrigin: "https://openmotion-preview.example.test",
      token: "fresh-token",
      liveIframe: live,
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://openmotion-preview.example.test");
    expect(parsed.pathname).toBe("/api/projects/demo/preview/comp/intro.html");
    expect(parsed.searchParams.get("variables")).toBe('{"title":"Hi"}');
    expect(parsed.searchParams.get("capture")).toBe("1");
    expect(parsed.searchParams.get("pt")).toBe("fresh-token");

    const fallbackUrl = buildIsolatedExportPreviewUrl({
      projectId: "demo",
      previewOrigin: "https://openmotion-preview.example.test",
      token: "fresh-token",
      liveIframe: null,
      activeCompPath: "parts/scene-2.html",
    });
    const parsedFallback = new URL(fallbackUrl);
    expect(parsedFallback.pathname).toBe("/api/projects/demo/preview/comp/parts/scene-2.html");
    expect(parsedFallback.searchParams.get("capture")).toBe("1");
    expect(parsedFallback.searchParams.get("pt")).toBe("fresh-token");
  });
});

describe("runIsolatedBrowserExport bridge orchestration", () => {
  function setupPreviewTokenFetch(token = "pt-isolated-1") {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          token,
          previewOrigin: "https://openmotion-preview.example.test",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          assetLease: "lease-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("runs export inside a hidden preview-origin iframe, forwards progress, sanitizes MIME, and cleans up", async () => {
    setupPreviewTokenFetch("pt-isolated-1");
    const createdUrls: Blob[] = [];
    const origCreateObjectURL = URL.createObjectURL;
    vi.spyOn(URL, "createObjectURL").mockImplementation((obj) => {
      createdUrls.push(obj as Blob);
      return "blob:isolated-mp4";
    });

    const sentToIframe: Array<{ data: Record<string, unknown>; targetOrigin: string }> = [];
    const origAppendChild = document.body.appendChild.bind(document.body);
    let mountedFrame: HTMLIFrameElement | null = null;
    const fakeContentWindow = {
      postMessage: (data: Record<string, unknown>, targetOrigin: string) => {
        sentToIframe.push({ data, targetOrigin });
        if (data.type === "browser-export-start") {
          const requestId = String(data.requestId);
          const exportId = String(data.exportId);
          // Spoofed message from wrong origin must be ignored
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://evil.example.test",
              source: fakeContentWindow as unknown as Window,
              data: {
                source: "openmotion-preview-bridge",
                version: 1,
                type: "browser-export-progress",
                projectId: "demo",
                token: "pt-isolated-1",
                requestId,
                exportId,
                progress: 99,
                stage: "Spoofed",
              },
            }),
          );
          // Genuine progress + completion with malicious MIME type (must be sanitized)
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://openmotion-preview.example.test",
              source: fakeContentWindow as unknown as Window,
              data: {
                source: "openmotion-preview-bridge",
                version: 1,
                type: "browser-export-progress",
                projectId: "demo",
                token: "pt-isolated-1",
                requestId,
                exportId,
                progress: 65,
                stage: "Capturing frame 2/3",
              },
            }),
          );
          const mp4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]).buffer;
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://openmotion-preview.example.test",
              source: fakeContentWindow as unknown as Window,
              data: {
                source: "openmotion-preview-bridge",
                version: 1,
                type: "response",
                projectId: "demo",
                token: "pt-isolated-1",
                requestId,
                ok: true,
                result: {
                  buffer: mp4Bytes,
                  mimeType: "text/html",
                  bytes: mp4Bytes.byteLength,
                  durationMs: 120,
                  frameCount: 3,
                  width: 1280,
                  height: 720,
                  stats: {
                    htmlMode: "snapdom-live",
                    effectiveFps: 25,
                    snapdomCaptures: 3,
                    snapdomTotalMs: 50,
                    videoDecodeTotalMs: 20,
                    encodeTotalMs: 30,
                  },
                },
              },
            }),
          );
        }
      },
    };

    vi.spyOn(document.body, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
      const appended = origAppendChild(node);
      if (node instanceof HTMLIFrameElement && node.hasAttribute("data-openmotion-isolated-export-frame")) {
        mountedFrame = node;
        let storedSrc = "";
        Object.defineProperty(node, "src", {
          configurable: true,
          get: () => storedSrc,
          set: (val: string) => {
            storedSrc = val;
          },
        });
        Object.defineProperty(node, "contentWindow", {
          configurable: true,
          get: () => fakeContentWindow,
        });
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://openmotion-preview.example.test",
              source: fakeContentWindow as unknown as Window,
              data: {
                source: "openmotion-preview-bridge",
                version: 1,
                type: "preview-ready",
                projectId: "demo",
                token: "pt-isolated-1",
                capabilities: ["thumbnail-capture", "browser-export"],
              },
            }),
          );
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://openmotion-preview.example.test",
              source: fakeContentWindow as unknown as Window,
              data: {
                source: "openmotion-preview-bridge",
                version: 1,
                type: "timeline-state",
                projectId: "demo",
                token: "pt-isolated-1",
                duration: 2,
                firstFrame: "ready",
              },
            }),
          );
        });
      }
      return appended;
    });

    const progressUpdates: Array<{ progress: number; stage: string }> = [];
    const keyframes = new Map<string, KeyframeCacheEntry>([
      ["el-1", { format: "gsap", keyframes: [{ percentage: 0, properties: { opacity: 0 } }] }],
    ]);

    const result = await runIsolatedBrowserExport({
      projectId: "demo",
      previewOrigin: "https://openmotion-preview.example.test",
      format: "mp4",
      quality: "standard",
      fps: 30,
      duration: 2,
      elements: [makeElement({ tag: "p", text: { value: "Hello" } })],
      keyframeCache: keyframes,
      onProgress: (u) => progressUpdates.push(u),
    });

    expect(mountedFrame).toBeTruthy();
    expect(mountedFrame!.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(mountedFrame!.isConnected).toBe(false);
    expect(result.blobUrl).toBe("blob:isolated-mp4");
    expect(result.mimeType).toBe("video/mp4");
    expect(result.bytes).toBe(8);
    expect(createdUrls[0]?.type).toBe("video/mp4");
    expect(progressUpdates.some((u) => u.stage === "Spoofed")).toBe(false);
    expect(progressUpdates.some((u) => u.progress === 65 && u.stage === "Capturing frame 2/3")).toBe(true);
    expect(sentToIframe.find((m) => m.data.type === "browser-export-start")?.targetOrigin).toBe(
      "https://openmotion-preview.example.test",
    );
    expect(origCreateObjectURL).toBeDefined();
  });

  it("sends browser-export-cancel and removes the hidden iframe when aborted", async () => {
    setupPreviewTokenFetch("pt-isolated-abort");
    const sentTypes: string[] = [];
    const origAppendChild = document.body.appendChild.bind(document.body);
    let mountedFrame: HTMLIFrameElement | null = null;
    const controller = new AbortController();

    const fakeContentWindow = {
      postMessage: (data: Record<string, unknown>) => {
        sentTypes.push(String(data.type));
        if (data.type === "browser-export-start") {
          queueMicrotask(() => controller.abort());
        }
      },
    };

    vi.spyOn(document.body, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
      const appended = origAppendChild(node);
      if (node instanceof HTMLIFrameElement && node.hasAttribute("data-openmotion-isolated-export-frame")) {
        mountedFrame = node;
        let storedSrc = "";
        Object.defineProperty(node, "src", {
          configurable: true,
          get: () => storedSrc,
          set: (val: string) => {
            storedSrc = val;
          },
        });
        Object.defineProperty(node, "contentWindow", {
          configurable: true,
          get: () => fakeContentWindow,
        });
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://openmotion-preview.example.test",
              source: fakeContentWindow as unknown as Window,
              data: {
                source: "openmotion-preview-bridge",
                version: 1,
                type: "preview-ready",
                projectId: "demo",
                token: "pt-isolated-abort",
                capabilities: ["browser-export"],
              },
            }),
          );
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://openmotion-preview.example.test",
              source: fakeContentWindow as unknown as Window,
              data: {
                source: "openmotion-preview-bridge",
                version: 1,
                type: "timeline-state",
                projectId: "demo",
                token: "pt-isolated-abort",
                duration: 2,
                firstFrame: "ready",
              },
            }),
          );
        });
      }
      return appended;
    });

    await expect(
      runIsolatedBrowserExport({
        projectId: "demo",
        previewOrigin: "https://openmotion-preview.example.test",
        format: "mp4",
        quality: "standard",
        fps: 30,
        duration: 2,
        elements: [makeElement({ tag: "p", text: { value: "Cancel me" } })],
        keyframeCache: new Map(),
        signal: controller.signal,
      }),
    ).rejects.toThrow("Aborted");

    expect(sentTypes).toEqual(["browser-export-start", "browser-export-cancel"]);
    expect(mountedFrame?.isConnected).toBe(false);
  });
});
