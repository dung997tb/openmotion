import type { CanvasResolution } from "@hyperframes/parsers";
import { applyPreviewVariablesToUrl } from "../hooks/previewVariablesStore";
import { createPreviewAdapter } from "../player/lib/previewAdapter";
import { acquireSharedPreviewGrant, invalidateSharedPreviewGrant } from "../player/lib/previewLease";
import type { KeyframeCacheEntry } from "../player/store/keyframeSlice";
import type { TimelineElement } from "../player/store/timelineElement";
import { buildProjectApiPath } from "../utils/projectRouting";
import {
  resolveBrowserExportDimensions,
  type BrowserExportOptions,
  type BrowserExportResult,
  type BrowserExportStats,
} from "./browserExport";

const ISOLATED_EXPORT_BOOT_TIMEOUT_MS = 20_000;
const MAX_STAGE_LENGTH = 200;
const MAX_ERROR_LENGTH = 500;

export interface IsolatedBrowserExportOptions extends Omit<BrowserExportOptions, "isolateIframe" | "previewTarget"> {
  previewOrigin: string;
  activeCompPath?: string | null;
}

export function sanitizeIsolatedExportMimeType(
  _rawMimeType: unknown,
  format: "mp4" | "webm",
): string {
  return format === "webm" ? "video/webm" : "video/mp4";
}

export function hasValidVideoContainerMagic(
  buffer: ArrayBuffer,
  format: "mp4" | "webm",
): boolean {
  const bytes = new Uint8Array(buffer);
  if (format === "webm") {
    return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  }
  // ISO BMFF / MP4 starts with a box whose 4-byte type at offset 4 is 'ftyp'.
  return (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

export function buildIsolatedExportPreviewUrl(options: {
  projectId: string;
  previewOrigin: string;
  token: string;
  liveIframe?: HTMLIFrameElement | null;
  activeCompPath?: string | null;
}): string {
  const { projectId, previewOrigin, token, liveIframe, activeCompPath } = options;
  const expectedOrigin = new URL(previewOrigin).origin;
  const rawSrc = liveIframe?.getAttribute("src")?.trim() || liveIframe?.src?.trim() || "";
  const previewBase = buildProjectApiPath(projectId, "/preview");

  let target: URL;
  if (rawSrc && rawSrc !== "about:blank" && rawSrc !== "about:srcdoc") {
    try {
      const parsed = new URL(rawSrc, expectedOrigin);
      if (parsed.pathname === previewBase || parsed.pathname.startsWith(`${previewBase}/`)) {
        target = new URL(parsed.pathname, expectedOrigin);
        target.search = parsed.search;
      } else {
        target = buildDefaultCompositionUrl(projectId, expectedOrigin, activeCompPath);
      }
    } catch {
      target = buildDefaultCompositionUrl(projectId, expectedOrigin, activeCompPath);
    }
  } else {
    target = buildDefaultCompositionUrl(projectId, expectedOrigin, activeCompPath);
  }

  target.searchParams.set("capture", "1");
  target.searchParams.set("pt", token);
  return target.href;
}

function buildDefaultCompositionUrl(
  projectId: string,
  expectedOrigin: string,
  activeCompPath?: string | null,
): URL {
  const normalizedComp = activeCompPath?.trim().replace(/^\/+/, "");
  const route =
    normalizedComp && normalizedComp !== "index.html"
      ? buildProjectApiPath(projectId, `/preview/comp/${normalizedComp}`)
      : buildProjectApiPath(projectId, "/preview");
  const url = new URL(route, expectedOrigin);
  applyPreviewVariablesToUrl(url);
  return url;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function isArrayBufferValue(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function normalizeStats(raw: unknown): BrowserExportStats | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const htmlMode =
    record.htmlMode === "canvas2d" ||
    record.htmlMode === "snapdom-cached" ||
    record.htmlMode === "snapdom-live"
      ? record.htmlMode
      : null;
  if (!htmlMode) return undefined;
  return {
    htmlMode,
    effectiveFps: Number.isFinite(record.effectiveFps) ? Number(record.effectiveFps) : 0,
    snapdomCaptures: Number.isFinite(record.snapdomCaptures) ? Number(record.snapdomCaptures) : 0,
    snapdomTotalMs: Number.isFinite(record.snapdomTotalMs) ? Number(record.snapdomTotalMs) : 0,
    videoDecodeTotalMs: Number.isFinite(record.videoDecodeTotalMs) ? Number(record.videoDecodeTotalMs) : 0,
    encodeTotalMs: Number.isFinite(record.encodeTotalMs) ? Number(record.encodeTotalMs) : 0,
  };
}

/**
 * Execute client-side browser export inside a hidden preview iframe mounted on
 * the cookie-less `PREVIEW_PUBLIC_ORIGIN`. Project HTML, DOM, media, snapdom,
 * and WebCodecs encoding stay strictly on the isolated preview origin while
 * Studio receives progress events and the final validated MP4/WebM ArrayBuffer.
 */
export async function runIsolatedBrowserExport(
  options: IsolatedBrowserExportOptions,
): Promise<BrowserExportResult> {
  const {
    projectId,
    previewOrigin,
    activeCompPath,
    format,
    quality,
    fps,
    resolution,
    compositionDimensions,
    duration,
    elements,
    keyframeCache,
    iframe: liveIframe,
    htmlCaptureMode,
    snapdomEngine,
    signal,
    onProgress,
  } = options;

  if (typeof document === "undefined" || !document.body) {
    throw new Error("DOM document is unavailable for isolated browser export.");
  }

  throwIfAborted(signal);
  const startedAt = Date.now();
  onProgress?.({ progress: 2, stage: "Preparing isolated render frame" });

  const expectedOrigin = new URL(previewOrigin).origin;
  const grantController = new AbortController();
  const forwardAbort = () => grantController.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });

  let grant;
  try {
    grant = await acquireSharedPreviewGrant(projectId, expectedOrigin, grantController.signal);
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
  }
  throwIfAborted(signal);

  const exportUrl = buildIsolatedExportPreviewUrl({
    projectId,
    previewOrigin: expectedOrigin,
    token: grant.token,
    liveIframe,
    activeCompPath,
  });

  const resolvedSize = resolveBrowserExportDimensions(
    resolution as CanvasResolution | "auto" | undefined,
    compositionDimensions,
  );
  const frameWidth = compositionDimensions?.width && compositionDimensions.width > 0
    ? compositionDimensions.width
    : resolvedSize.width;
  const frameHeight = compositionDimensions?.height && compositionDimensions.height > 0
    ? compositionDimensions.height
    : resolvedSize.height;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("data-openmotion-isolated-export-frame", "true");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.referrerPolicy = "no-referrer";
  frame.tabIndex = -1;
  frame.style.cssText = [
    "position: fixed",
    "left: 0",
    "top: 0",
    `width: ${Math.max(2, Math.round(frameWidth))}px`,
    `height: ${Math.max(2, Math.round(frameHeight))}px`,
    "border: 0",
    "opacity: 0.001",
    "pointer-events: none",
    "z-index: -1",
  ].join("; ");

  const exportId =
    globalThis.crypto?.randomUUID?.() ?? `isolated-export-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let adapter: ReturnType<typeof createPreviewAdapter> | null = null;
  const cleanupRef: { current: (() => void) | null } = { current: null };

  try {
    document.body.appendChild(frame);
    frame.src = exportUrl;
    adapter = createPreviewAdapter({
      iframe: frame,
      expectedOrigin,
      projectId,
      token: grant.token,
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let sawReady = false;
      let sawTimeline = false;

      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener("message", onBootMessage);
        signal?.removeEventListener("abort", onAbort);
        if (err) reject(err);
        else resolve();
      };

      const onAbort = () => finish(new DOMException("Aborted", "AbortError"));
      const timeout = setTimeout(() => {
        if (grant.expiresAt <= Date.now()) {
          invalidateSharedPreviewGrant(projectId, grant.token);
        }
        finish(new Error("Timed out waiting for isolated browser export frame to boot."));
      }, ISOLATED_EXPORT_BOOT_TIMEOUT_MS);

      const onBootMessage = (event: MessageEvent) => {
        if (!adapter?.accepts(event)) return;
        const data = event.data;
        if (data.type === "preview-build-busy") {
          finish(new Error("Preview builders are busy. Try again shortly."));
          return;
        }
        if (data.type === "preview-ready") {
          const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
          if (!capabilities.includes("browser-export")) {
            finish(new Error("Browser export bridge is not available on this preview release."));
            return;
          }
          sawReady = true;
          if (sawTimeline) finish();
          return;
        }
        if (data.type === "timeline-state") {
          if (Number(data.duration) > 0) {
            sawTimeline = true;
            if (sawReady) finish();
          }
        }
      };

      window.addEventListener("message", onBootMessage);
      signal?.addEventListener("abort", onAbort, { once: true });
    });

    throwIfAborted(signal);
    onProgress?.({ progress: 4, stage: "Preparing browser export" });

    const serializedKeyframes: Array<[string, KeyframeCacheEntry]> = Array.from(keyframeCache.entries());
    const result = await new Promise<{
      buffer: ArrayBuffer;
      mimeType: string;
      bytes: number;
      durationMs: number;
      frameCount: number;
      width: number;
      height: number;
      stats?: BrowserExportStats;
    }>((resolve, reject) => {
      let settled = false;
      const requestId =
        globalThis.crypto?.randomUUID?.() ?? `browser-export-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const finish = (err?: unknown, value?: {
        buffer: ArrayBuffer;
        mimeType: string;
        bytes: number;
        durationMs: number;
        frameCount: number;
        width: number;
        height: number;
        stats?: BrowserExportStats;
      }) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onExportMessage);
        signal?.removeEventListener("abort", onAbort);
        cleanupRef.current = null;
        if (err) reject(err);
        else resolve(value!);
      };

      const onAbort = () => {
        try {
          adapter?.send("browser-export-cancel", { exportId });
        } catch {
          /* ignore */
        }
        finish(new DOMException("Aborted", "AbortError"));
      };

      const onExportMessage = (event: MessageEvent) => {
        if (!adapter?.accepts(event)) return;
        const data = event.data;
        if (data.type === "browser-export-progress") {
          if (data.requestId && data.requestId !== requestId) return;
          if (data.exportId && data.exportId !== exportId) return;
          const rawPct = typeof data.progress === "number" && Number.isFinite(data.progress) ? data.progress : 0;
          const pct = Math.max(0, Math.min(100, Math.round(rawPct)));
          const stage =
            typeof data.stage === "string" && data.stage.trim()
              ? data.stage.trim().slice(0, MAX_STAGE_LENGTH)
              : "Exporting";
          onProgress?.({ progress: pct, stage });
          return;
        }
        if (data.type === "response" && data.requestId === requestId) {
          if (data.ok === false) {
            const msg =
              typeof data.error === "string" && data.error.trim()
                ? data.error.trim().slice(0, MAX_ERROR_LENGTH)
                : "Browser export failed";
            finish(new Error(msg));
            return;
          }
          const rawResult = data.result as Record<string, unknown> | null | undefined;
          const buffer = rawResult?.buffer;
          if (!isArrayBufferValue(buffer) || buffer.byteLength <= 0) {
            finish(new Error("Browser export produced an empty output buffer."));
            return;
          }
          if (!hasValidVideoContainerMagic(buffer, format)) {
            finish(new Error("Browser export returned an invalid video container."));
            return;
          }
          const safeMimeType = sanitizeIsolatedExportMimeType(rawResult?.mimeType, format);
          finish(undefined, {
            buffer,
            mimeType: safeMimeType,
            bytes: buffer.byteLength,
            durationMs:
              typeof rawResult?.durationMs === "number" && Number.isFinite(rawResult.durationMs)
                ? Math.max(1, rawResult.durationMs)
                : Math.max(1, Date.now() - startedAt),
            frameCount:
              typeof rawResult?.frameCount === "number" && Number.isFinite(rawResult.frameCount)
                ? Math.max(1, Math.round(rawResult.frameCount))
                : Math.max(1, Math.ceil(duration * fps)),
            width:
              typeof rawResult?.width === "number" && Number.isFinite(rawResult.width)
                ? Math.max(2, Math.round(rawResult.width))
                : resolvedSize.width,
            height:
              typeof rawResult?.height === "number" && Number.isFinite(rawResult.height)
                ? Math.max(2, Math.round(rawResult.height))
                : resolvedSize.height,
            stats: normalizeStats(rawResult?.stats),
          });
        }
      };

      window.addEventListener("message", onExportMessage);
      signal?.addEventListener("abort", onAbort, { once: true });
      cleanupRef.current = () => {
        window.removeEventListener("message", onExportMessage);
        signal?.removeEventListener("abort", onAbort);
      };

      const sentId = adapter!.send(
        "browser-export-start",
        {
          exportId,
          payload: {
            projectId,
            format,
            quality,
            fps,
            resolution,
            compositionDimensions: compositionDimensions ?? null,
            duration,
            elements: elements as readonly TimelineElement[],
            keyframeEntries: serializedKeyframes,
            htmlCaptureMode,
            snapdomEngine,
          },
        },
        requestId,
      );
      if (!sentId) {
        finish(new Error("Preview bridge is not ready for browser export."));
      }
    });

    throwIfAborted(signal);
    const blob = new Blob([result.buffer], { type: result.mimeType });
    const blobUrl = URL.createObjectURL(blob);
    onProgress?.({ progress: 100, stage: "Completed" });

    return {
      blobUrl,
      mimeType: result.mimeType,
      bytes: blob.size,
      durationMs: result.durationMs,
      frameCount: result.frameCount,
      width: result.width,
      height: result.height,
      stats: result.stats,
    };
  } finally {
    cleanupRef.current?.();
    try {
      frame.src = "about:blank";
    } catch {
      /* ignore */
    }
    frame.remove();
  }
}
