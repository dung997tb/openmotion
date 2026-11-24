import type { CanvasResolution } from "@hyperframes/parsers";
import type { KeyframeCacheEntry } from "../player/store/keyframeSlice";
import type { TimelineElement } from "../player/store/timelineElement";
import {
  runBrowserExportBuffer,
  type BrowserExportBufferResult,
  type BrowserExportProgress,
  type BrowserHtmlCaptureMode,
} from "./browserExport";

export interface PreviewHostBrowserExportPayload {
  projectId: string;
  format: "mp4" | "webm";
  quality: "draft" | "standard" | "high";
  fps: number;
  resolution?: CanvasResolution | "auto";
  compositionDimensions?: { width: number; height: number } | null;
  duration: number;
  elements: readonly TimelineElement[];
  keyframeEntries?: ReadonlyArray<readonly [string, KeyframeCacheEntry]>;
  htmlCaptureMode?: BrowserHtmlCaptureMode;
  snapdomEngine?: "svg" | "html-in-canvas";
}

export interface PreviewHostBrowserExportCallbacks {
  signal?: AbortSignal;
  onProgress?: (update: BrowserExportProgress) => void;
}

export interface PreviewHostBrowserExportRunner {
  run: (
    payload: PreviewHostBrowserExportPayload,
    callbacks?: PreviewHostBrowserExportCallbacks,
  ) => Promise<BrowserExportBufferResult>;
}

const runner: PreviewHostBrowserExportRunner = {
  async run(payload, callbacks) {
    const keyframeCache = new Map<string, KeyframeCacheEntry>(payload.keyframeEntries ?? []);
    return runBrowserExportBuffer({
      projectId: payload.projectId,
      format: payload.format,
      quality: payload.quality,
      fps: payload.fps,
      resolution: payload.resolution,
      compositionDimensions: payload.compositionDimensions,
      duration: payload.duration,
      elements: payload.elements,
      keyframeCache,
      previewTarget: { window, document },
      isolateIframe: false,
      htmlCaptureMode: payload.htmlCaptureMode,
      snapdomEngine: payload.snapdomEngine,
      signal: callbacks?.signal,
      onProgress: callbacks?.onProgress,
    });
  },
};

(globalThis as { __openmotionBrowserExport?: PreviewHostBrowserExportRunner }).__openmotionBrowserExport =
  runner;
