import { usePlayerStore } from "../store/playerStore";
import {
  acquireSharedPreviewGrant,
  clearSharedPreviewGrantsForTest,
  invalidateSharedPreviewGrant,
  isolatedPreviewOrigin,
} from "./previewLease";
import {
  createThumbnailKey,
  type ThumbnailLoadedResult,
  type ThumbnailPriority,
  type ThumbnailRequest,
  type ThumbnailValue,
} from "./thumbnailScheduler";

export const MAX_CLIENT_COMPOSITION_FRAMES = 8;
/** Cap how many uncached composition clips can block initial editor unlock. */
export const MAX_INITIAL_TIMELINE_PREVIEW_GATE = 4;
/** Maximum extra wait after primary assets settle before releasing to background capture. */
export const TIMELINE_PREVIEW_GATE_TIMEOUT_MS = 4_500;

const CAPTURE_TARGET_WIDTH = 160;
const CAPTURE_JPEG_QUALITY = 0.78;
const CAPTURE_BOOT_TIMEOUT_MS = 12_000;
const CAPTURE_MEDIA_TIMEOUT_MS = 2_000;
const CAPTURE_RAF_FALLBACK_MS = 250;
const CAPTURE_FRAME_YIELD_MS = 8;
const CAPTURE_IDLE_TEARDOWN_MS = 1_500;
const MAX_CONCURRENT_ISOLATED_CAPTURES = 3;
const MAX_CONCURRENT_SAME_ORIGIN_CAPTURES = 2;
const IDB_NAME = "openmotion-client-comp-thumbs-v1";
const IDB_STORE = "strips";
const IDB_MAX_ENTRIES = 120;
const MEMORY_STRIP_CACHE_MAX = 64;
const SHARED_COVER_CACHE_MAX = 128;

interface CachedStripRecord {
  key: string;
  aspect: number;
  width: number;
  height: number;
  blobs: Blob[];
  updatedAt: number;
}

interface MemoryStripEntry {
  blobs: readonly Blob[];
  value: ThumbnailValue;
  coverValue: ThumbnailValue;
  urls: string[];
  aspect: number;
  width: number;
  height: number;
  weight: number;
  baseCoverKey: string;
  compPathKey: string;
  clipIdentityKey: string;
  inCache: boolean;
  refCount: number;
  revoked: boolean;
}

interface CapturePreviewWindow extends Window {
  __player?: {
    seek?: (time: number) => void;
    pause?: () => void;
    getDuration?: () => number;
  };
}

export interface ClientCaptureInput {
  previewUrl: string;
  projectId: string;
  sessionEpoch: number;
  contentRevision: number;
  frameCount: number;
  duration?: number;
  seekTime?: number;
  selector?: string;
  selectorIndex?: number;
  priority?: ThumbnailPriority;
  /** Boosts capture priority above background clips when participating in initial editor unlock. */
  gatePriority?: boolean;
  rich?: boolean;
}

type SnapdomModuleFn = typeof import("@zumer/snapdom").snapdom;

type ProgressiveFrameCallback = (
  index: number,
  total: number,
  blob: Blob,
  dims: { aspect: number; width: number; height: number },
) => void;

let testCapabilityOverride: boolean | null = null;
let snapdomLoader: Promise<SnapdomModuleFn | null> | null = null;
const projectRevisionByProjectId = new Map<string, string>();
const compositionRevisionsByProjectId = new Map<string, Map<string, string>>();
const revisionListenersByProjectId = new Map<string, Set<() => void>>();

function notifyRevisionListeners(projectId: string): void {
  const listeners = revisionListenersByProjectId.get(projectId);
  if (!listeners) return;
  for (const listener of new Set(listeners)) listener();
}
// In-memory cover cache keyed by composition identity (ignoring frameCount) so sidebar 1-frame
// cards immediately reuse frames already captured for a timeline strip without booting a 2nd run.
const sharedCoverCache = new Map<string, { blob: Blob; aspect: number; width: number; height: number }>();
// In-memory LRU strip cache keyed independent of sessionEpoch so switching projects/compositions
// renders captured filmstrips synchronously in 0ms without re-queuing or re-fetching posters.
const memoryStripCache = new Map<string, MemoryStripEntry>();
// Maps any ThumbnailValue handed out from memoryStripCache back to its entry for owner ref-counting.
const entryByValue = new WeakMap<ThumbnailValue, MemoryStripEntry>();
const inFlightIdbReads = new Map<string, Promise<MemoryStripEntry | null>>();
// Live progressive frame values emitted mid-capture so clips display frame 1 immediately
// while remaining filmstrip frames stream in the background.
const progressiveStrips = new Map<string, ThumbnailValue>();
const progressiveListeners = new Map<string, Set<() => void>>();

function notifyProgressiveListeners(idbKey: string): void {
  const listeners = progressiveListeners.get(idbKey);
  if (!listeners) return;
  for (const listener of new Set(listeners)) listener();
}

function setProgressiveEntry(idbKey: string, value: ThumbnailValue): void {
  progressiveStrips.set(idbKey, value);
  notifyProgressiveListeners(idbKey);
}

function clearProgressiveEntry(idbKey: string): void {
  if (!progressiveStrips.delete(idbKey)) return;
  notifyProgressiveListeners(idbKey);
}

function putSharedCoverCache(
  baseCoverKey: string,
  entry: { blob: Blob; aspect: number; width: number; height: number },
): void {
  if (sharedCoverCache.has(baseCoverKey)) sharedCoverCache.delete(baseCoverKey);
  sharedCoverCache.set(baseCoverKey, entry);
  while (sharedCoverCache.size > SHARED_COVER_CACHE_MAX) {
    const oldestKey = sharedCoverCache.keys().next().value;
    if (!oldestKey) break;
    sharedCoverCache.delete(oldestKey);
  }
}

function maybeRevokeEntry(entry: MemoryStripEntry): void {
  if (entry.revoked || entry.inCache || entry.refCount > 0) return;
  entry.revoked = true;
  for (const url of entry.urls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}

function retainMemoryEntry(entry: MemoryStripEntry): () => void {
  entry.refCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.refCount = Math.max(0, entry.refCount - 1);
    maybeRevokeEntry(entry);
  };
}

/**
 * Retain ownership of a ThumbnailValue returned by `peekCachedCompositionCapture`
 * so LRU cache eviction does not revoke its object URLs while mounted.
 */
export function retainCachedCompositionCapture(
  value: ThumbnailValue | null | undefined,
): () => void {
  if (!value) return () => {};
  const entry = entryByValue.get(value);
  if (!entry) return () => {};
  return retainMemoryEntry(entry);
}

/** Reset in-memory capture caches between unit tests. */
export function clearClientCompositionCaptureCacheForTest(): void {
  cancelIdleTeardown();
  for (const slot of captureIframePool) {
    try {
      slot.iframe.src = "about:blank";
      slot.iframe.remove();
    } catch {
      // ignore teardown errors
    }
  }
  captureIframePool.length = 0;
  for (const entry of memoryStripCache.values()) {
    entry.inCache = false;
    if (!entry.revoked) {
      entry.revoked = true;
      for (const url of entry.urls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    }
  }
  memoryStripCache.clear();
  sharedCoverCache.clear();
  projectRevisionByProjectId.clear();
  compositionRevisionsByProjectId.clear();
  revisionListenersByProjectId.clear();
  inFlightIdbReads.clear();
  progressiveStrips.clear();
  progressiveListeners.clear();
  clearSharedPreviewGrantsForTest();
}

function normalizeCompositionPathForGate(raw: string): string {
  const withoutOrigin = raw.replace(/^https?:\/\/[^/]+/i, "");
  const previewComp = /\/preview\/comp\/([^?#]+)/.exec(withoutOrigin);
  if (previewComp?.[1]) {
    try {
      return decodeURIComponent(previewComp[1]).replace(/^(\.\/|\/)+/, "");
    } catch {
      return previewComp[1].replace(/^(\.\/|\/)+/, "");
    }
  }
  const previewRoot = /\/preview\/([^?#]+)/.exec(withoutOrigin);
  if (previewRoot?.[1]) {
    try {
      return decodeURIComponent(previewRoot[1]).replace(/^(\.\/|\/)+/, "");
    } catch {
      return previewRoot[1].replace(/^(\.\/|\/)+/, "");
    }
  }
  return withoutOrigin.split(/[?#]/)[0]!.replace(/^(\.\/|\/)+/, "");
}

/**
 * Pick at most `maxCount` unique visible composition paths closest to `currentTime`
 * to participate in the initial unified loading gate. Remaining clips capture
 * progressively in the background so long projects (20–30+ scenes) never stall.
 */
export function selectInitialGateCompositionPaths(
  elements: ReadonlyArray<{
    compositionSrc?: string;
    hidden?: boolean;
    start: number;
    duration: number;
  }>,
  currentTime: number,
  maxCount: number = MAX_INITIAL_TIMELINE_PREVIEW_GATE,
): string[] {
  if (maxCount <= 0) return [];
  const safeTime = Number.isFinite(currentTime) ? currentTime : 0;
  const bestDistance = new Map<string, { dist: number; start: number }>();
  for (const el of elements) {
    if (!el.compositionSrc || el.hidden) continue;
    const normalized = normalizeCompositionPathForGate(el.compositionSrc);
    if (!normalized) continue;
    const end = el.start + Math.max(0, el.duration);
    const dist =
      safeTime >= el.start && safeTime <= end
        ? 0
        : Math.min(Math.abs(safeTime - el.start), Math.abs(safeTime - end));
    const prev = bestDistance.get(normalized);
    if (!prev || dist < prev.dist || (dist === prev.dist && el.start < prev.start)) {
      bestDistance.set(normalized, { dist, start: el.start });
    }
  }
  return Array.from(bestDistance.entries())
    .sort((a, b) => a[1].dist - b[1].dist || a[1].start - b[1].start)
    .slice(0, maxCount)
    .map(([src]) => src);
}

/** Override browser capture eligibility in unit tests. */
export function setClientCompositionCaptureCapabilityForTest(enabled: boolean | null): void {
  testCapabilityOverride = enabled;
}

export function setCachedProjectRevision(
  projectId: string,
  revision: string | null | undefined,
  compositionRevisions?: Readonly<Record<string, string>> | null,
): void {
  if (!projectId) return;
  let changed = false;
  if (typeof revision === "string" && revision.trim()) {
    const trimmed = revision.trim();
    if (projectRevisionByProjectId.get(projectId) !== trimmed) {
      projectRevisionByProjectId.set(projectId, trimmed);
      changed = true;
    }
  }
  if (compositionRevisions && typeof compositionRevisions === "object") {
    const normalized = new Map<string, string>();
    for (const [rawPath, compRev] of Object.entries(compositionRevisions)) {
      if (typeof compRev !== "string" || !compRev.trim()) continue;
      const key = normalizeCompositionPathForGate(rawPath);
      if (key) normalized.set(key, compRev.trim());
    }
    const prev = compositionRevisionsByProjectId.get(projectId);
    if (normalized.size > 0) {
      const same =
        prev !== undefined &&
        prev.size === normalized.size &&
        Array.from(normalized.entries()).every(([k, v]) => prev.get(k) === v);
      if (!same) {
        compositionRevisionsByProjectId.set(projectId, normalized);
        changed = true;
      }
      if (changed) notifyRevisionListeners(projectId);
      return;
    }
  }
  if (compositionRevisionsByProjectId.delete(projectId)) {
    changed = true;
  }
  if (changed) notifyRevisionListeners(projectId);
}

export function subscribeCompositionCacheRevision(projectId: string, listener: () => void): () => void {
  if (!projectId) return () => {};
  let listeners = revisionListenersByProjectId.get(projectId);
  if (!listeners) {
    listeners = new Set();
    revisionListenersByProjectId.set(projectId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = revisionListenersByProjectId.get(projectId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) revisionListenersByProjectId.delete(projectId);
  };
}

export function getCompositionCacheRevision(projectId: string, compPathOrUrl: string): string {
  return resolveCompositionRevision(projectId, compPathOrUrl);
}

function resolveCompositionRevision(projectId: string, compPathOrUrl: string): string {
  const perComp = compositionRevisionsByProjectId.get(projectId);
  if (perComp) {
    const normalized = normalizeCompositionPathForGate(compPathOrUrl);
    const exact = perComp.get(normalized);
    if (exact) return exact;
  }
  return projectRevisionByProjectId.get(projectId) ?? "";
}

export function canCaptureCompositionInBrowser(): boolean {
  if (testCapabilityOverride !== null) return testCapabilityOverride;
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (typeof HTMLCanvasElement === "undefined" || typeof requestAnimationFrame !== "function") return false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/HappyDOM|jsdom/i.test(ua)) return false;
  return true;
}

/** Quantize requested timeline tiles into 1 / 2 / 4 / 8 captured frames so zooming reuses caches. */
export function quantizeCompositionFrameCount(
  tileCount: number,
  durationSeconds?: number,
): number {
  if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds <= 0.5) {
    return 1;
  }
  const safe = Math.max(1, Number.isFinite(tileCount) ? Math.ceil(tileCount) : 1);
  if (safe <= 1) return 1;
  if (safe <= 2) return 2;
  if (safe <= 4) return 4;
  return MAX_CLIENT_COMPOSITION_FRAMES;
}

/** Pick evenly distributed timestamps that avoid blank t=0 fade-ins and tail fade-outs. */
export function computeCompositionSampleTimes(
  durationSeconds: number,
  frameCount: number,
  seekTime?: number,
): number[] {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const count = Math.max(1, Math.min(MAX_CLIENT_COMPOSITION_FRAMES, Math.floor(frameCount || 1)));
  if (safeDuration <= 0) {
    return [Math.max(0, Number.isFinite(seekTime) ? seekTime! : 0)];
  }
  if (count === 1) {
    const preferred =
      typeof seekTime === "number" && Number.isFinite(seekTime) && seekTime > 0 && seekTime < safeDuration
        ? seekTime
        : safeDuration <= 3
          ? safeDuration * 0.5
          : Math.min(3, safeDuration * 0.35);
    return [Number(preferred.toFixed(3))];
  }
  if (count === 2) {
    return [
      Number((safeDuration * 0.25).toFixed(3)),
      Number((safeDuration * 0.75).toFixed(3)),
    ];
  }
  const start = safeDuration * 0.04;
  const end = safeDuration * 0.94;
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => Number((start + i * step).toFixed(3)));
}

/** Selector thumbnails sample the clip's visible interval in its own composition. */
export function captureSampleTimes(
  documentDuration: number,
  input: Pick<ClientCaptureInput, "frameCount" | "selector" | "seekTime" | "duration">,
): number[] {
  const { duration, frameCount, seekTime, selector } = input;
  if (!selector || duration === undefined || !Number.isFinite(duration)) {
    return computeCompositionSampleTimes(documentDuration || duration || 0, frameCount, seekTime);
  }
  const start = typeof seekTime === "number" && Number.isFinite(seekTime) ? seekTime : 0;
  const limit = documentDuration > 0 ? documentDuration : Infinity;
  const from = Math.min(limit, Math.max(0, start));
  const to = Math.min(limit, Math.max(from, start + duration));
  if (from === to) return [from];
  return computeCompositionSampleTimes(1, frameCount).map(fraction => from + (to - from) * fraction);
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function nextAnimationFrames(win: Window, count: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let rafId = 0;
    let remaining = Math.max(1, count);
    let settled = false;
    const cleanup = () => {
      clearTimeout(fallbackTimer);
      win.cancelAnimationFrame?.(rafId);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError());
    };
    const fallbackTimer = setTimeout(finish, CAPTURE_RAF_FALLBACK_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    const step = () => {
      if (settled) return;
      if (--remaining <= 0) {
        finish();
        return;
      }
      rafId = win.requestAnimationFrame(step);
    };
    rafId = win.requestAnimationFrame(step);
  });
}

async function waitUntilInteractiveIdle(signal: AbortSignal): Promise<void> {
  // Wait for primary composition assets to finish so capture hits the warm HTTP cache
  // without competing with initial preview loads, and yield while playing or hidden.
  // Do NOT block on editorInputLocked: initial timeline captures complete inside the unified loader.
  while (!signal.aborted) {
    const state = usePlayerStore.getState();
    const assetsSettled =
      state.assetReadinessPhase === "ready" || state.assetReadinessSkipped || !state.editorInputLocked;
    if (assetsSettled && !state.isPlaying && (typeof document === "undefined" || !document.hidden)) {
      return;
    }
    await sleepAbortable(60, signal);
  }
  throw abortError();
}

// ---------------------------------------------------------------------------
// IndexedDB Persistent Cache (best-effort; degrades cleanly in private mode)
// ---------------------------------------------------------------------------

let idbOpenPromise: Promise<IDBDatabase | null> | null = null;

function openThumbDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!idbOpenPromise) {
    idbOpenPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            const store = db.createObjectStore(IDB_STORE, { keyPath: "key" });
            store.createIndex("updatedAt", "updatedAt");
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return idbOpenPromise;
}

async function readCachedStrip(key: string): Promise<CachedStripRecord | null> {
  const db = await openThumbDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as CachedStripRecord | undefined;
        if (rec && Array.isArray(rec.blobs) && rec.blobs.length > 0) resolve(rec);
        else resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeCachedStrip(record: CachedStripRecord): Promise<void> {
  const db = await openThumbDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      store.put(record);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const overflow = (countReq.result || 0) - IDB_MAX_ENTRIES;
        if (overflow <= 0) return;
        let removed = 0;
        const cursorReq = store.index("updatedAt").openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || removed >= overflow) return;
          cursor.delete();
          removed += 1;
          cursor.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Bounded Concurrent Offscreen Capture Iframe Pool (steady-state 0 RAM)
// ---------------------------------------------------------------------------

type CaptureQueuePriority = "overscan" | "visible" | "gate" | "interaction";

const CAPTURE_PRIORITY_RANK: Readonly<Record<CaptureQueuePriority, number>> = {
  overscan: 0,
  visible: 1,
  gate: 2,
  interaction: 3,
};

interface CaptureIframeSlot {
  iframe: HTMLIFrameElement;
  busy: boolean;
}

interface QueuedCaptureJob {
  priority: CaptureQueuePriority;
  seq: number;
  signal: AbortSignal;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onAbort: () => void;
}

const captureIframePool: CaptureIframeSlot[] = [];
let teardownTimer: ReturnType<typeof setTimeout> | null = null;
let activeCaptureCount = 0;
let captureJobSeq = 0;
const pendingCaptureJobs: QueuedCaptureJob[] = [];

function maxConcurrentCaptures(): number {
  return isolatedPreviewOrigin()
    ? MAX_CONCURRENT_ISOLATED_CAPTURES
    : MAX_CONCURRENT_SAME_ORIGIN_CAPTURES;
}

function cancelIdleTeardown(): void {
  if (teardownTimer !== null) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
}

function scheduleIdleTeardown(): void {
  cancelIdleTeardown();
  if (activeCaptureCount > 0 || pendingCaptureJobs.length > 0) return;
  teardownTimer = setTimeout(() => {
    teardownTimer = null;
    if (activeCaptureCount > 0 || pendingCaptureJobs.length > 0 || captureIframePool.length === 0) return;
    for (const slot of captureIframePool) {
      try {
        slot.iframe.src = "about:blank";
        slot.iframe.remove();
      } catch {
        // ignore teardown errors
      }
    }
    captureIframePool.length = 0;
  }, CAPTURE_IDLE_TEARDOWN_MS);
}

function createCaptureIframe(width: number, height: number): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("data-openmotion-thumb-capture", "true");
  iframe.setAttribute("inert", "");
  iframe.tabIndex = -1;
  iframe.referrerPolicy = "no-referrer";
  iframe.allow = "autoplay 'none'";
  iframe.sandbox.add("allow-scripts", "allow-same-origin");
  // Keep hidden capture frames intersecting the viewport (0 opacity, behind the app):
  // positioning a cross-origin preview iframe offscreen (e.g. left: -10000px) causes Chromium
  // to throttle/suspend requestAnimationFrame inside isolated preview captures.
  Object.assign(iframe.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${width}px`,
    height: `${height}px`,
    opacity: "0",
    border: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  document.body.appendChild(iframe);
  return iframe;
}

function acquireCaptureSlot(width = 1280, height = 720): CaptureIframeSlot {
  cancelIdleTeardown();
  for (let i = captureIframePool.length - 1; i >= 0; i--) {
    const slot = captureIframePool[i]!;
    if (!slot.iframe.isConnected) {
      if (!slot.busy) captureIframePool.splice(i, 1);
      continue;
    }
    if (!slot.busy) {
      slot.busy = true;
      slot.iframe.style.width = `${width}px`;
      slot.iframe.style.height = `${height}px`;
      return slot;
    }
  }
  const slot: CaptureIframeSlot = {
    iframe: createCaptureIframe(width, height),
    busy: true,
  };
  captureIframePool.push(slot);
  return slot;
}

function releaseCaptureSlot(slot: CaptureIframeSlot, reset: boolean): void {
  if (reset) resetCaptureIframe(slot.iframe);
  slot.busy = false;
}

function resetCaptureIframe(iframe: HTMLIFrameElement): void {
  try {
    iframe.src = "about:blank";
  } catch {
    // ignore reset errors
  }
}

let previewSafeFetchDepth = 0;
let previewSafeFetchOrig: typeof fetch | null = null;
let previewSafeFetchWrapped: typeof fetch | null = null;

/**
 * SnapDOM defaults same-origin image/CSS fetches to `credentials: "include"`.
 * In cloud mode, `/api/projects/:id/preview/*` 302-redirects to cross-origin presigned
 * S3/R2/OSS URLs that do not emit `Access-Control-Allow-Credentials: true`, so `"include"`
 * fails with a CORS error and renders placeholder boxes. Downgrading preview-asset requests
 * to `"same-origin"` keeps cookies on the first hop and drops them across the 302 redirect.
 * Ref-counted so concurrent same-origin captures share one wrapper and only the outermost
 * owner restores `globalThis.fetch`.
 */
export async function withPreviewRedirectSafeFetch<T>(run: () => Promise<T>): Promise<T> {
  if (typeof globalThis.fetch !== "function") return run();
  if (previewSafeFetchDepth === 0) {
    const origFetch = globalThis.fetch;
    const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
      const baseHref = typeof window !== "undefined" ? window.location.href : "";
      const baseOrigin = typeof window !== "undefined" ? window.location.origin : "";
      if (init?.credentials === "include" && baseOrigin) {
        try {
          const rawUrl =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : typeof input?.url === "string"
                  ? input.url
                  : "";
          if (rawUrl) {
            const parsed = new URL(rawUrl, baseHref);
            if (
              parsed.origin === baseOrigin &&
              /^\/api\/projects\/[^/]+\/preview\//.test(parsed.pathname)
            ) {
              return origFetch.call(globalThis, input, { ...init, credentials: "same-origin" });
            }
          }
        } catch {
          // ignore URL parse errors and fall through to original fetch
        }
      }
      return origFetch.call(globalThis, input, init);
    }) as typeof fetch;
    previewSafeFetchOrig = origFetch;
    previewSafeFetchWrapped = wrapped;
    globalThis.fetch = wrapped;
  }
  previewSafeFetchDepth += 1;
  try {
    return await run();
  } finally {
    previewSafeFetchDepth = Math.max(0, previewSafeFetchDepth - 1);
    if (previewSafeFetchDepth === 0) {
      if (previewSafeFetchOrig && globalThis.fetch === previewSafeFetchWrapped) {
        globalThis.fetch = previewSafeFetchOrig;
      }
      previewSafeFetchOrig = null;
      previewSafeFetchWrapped = null;
    }
  }
}

function pumpCaptureQueue(): void {
  const limit = maxConcurrentCaptures();
  while (activeCaptureCount < limit && pendingCaptureJobs.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < pendingCaptureJobs.length; i++) {
      const cand = pendingCaptureJobs[i]!;
      const best = pendingCaptureJobs[bestIdx]!;
      const delta = CAPTURE_PRIORITY_RANK[cand.priority] - CAPTURE_PRIORITY_RANK[best.priority];
      if (delta > 0 || (delta === 0 && cand.seq < best.seq)) {
        bestIdx = i;
      }
    }
    const [job] = pendingCaptureJobs.splice(bestIdx, 1);
    if (!job) break;
    job.signal.removeEventListener("abort", job.onAbort);
    if (job.signal.aborted) {
      job.reject(abortError());
      continue;
    }
    activeCaptureCount += 1;
    cancelIdleTeardown();
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeCaptureCount = Math.max(0, activeCaptureCount - 1);
        if (pendingCaptureJobs.length > 0) {
          pumpCaptureQueue();
        } else {
          scheduleIdleTeardown();
        }
      });
  }
  if (activeCaptureCount === 0 && pendingCaptureJobs.length === 0) {
    scheduleIdleTeardown();
  }
}

function resolveQueuePriority(input: Pick<ClientCaptureInput, "priority" | "gatePriority">): CaptureQueuePriority {
  if (input.priority === "interaction") return "interaction";
  if (input.gatePriority) return "gate";
  if (input.priority === "overscan") return "overscan";
  return "visible";
}

function enqueueSerializedCapture<T>(
  priority: CaptureQueuePriority,
  signal: AbortSignal,
  task: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const job: QueuedCaptureJob = {
      priority,
      seq: ++captureJobSeq,
      signal,
      task,
      resolve: (value) => resolve(value as T),
      reject,
      onAbort: () => {
        const idx = pendingCaptureJobs.indexOf(job);
        if (idx >= 0) {
          pendingCaptureJobs.splice(idx, 1);
          reject(abortError());
        }
      },
    };
    signal.addEventListener("abort", job.onAbort, { once: true });
    pendingCaptureJobs.push(job);
    cancelIdleTeardown();
    pumpCaptureQueue();
  });
}

async function loadLocalSnapdom(): Promise<SnapdomModuleFn | null> {
  if (!snapdomLoader) {
    snapdomLoader = import("@zumer/snapdom")
      .then((mod) => (typeof mod.snapdom === "function" ? mod.snapdom : null))
      .catch(() => null);
  }
  return snapdomLoader;
}

function hasVisibleText(node: Node): boolean {
  if (node.nodeType === 3) return Boolean((node.nodeValue ?? "").replace(/\s+/g, "").trim());
  if (node.nodeType !== 1) return false;
  const tag = (node as Element).tagName.toUpperCase();
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE" || tag === "CANVAS") {
    return false;
  }
  if (!node.childNodes || node.childNodes.length === 0) {
    return Boolean((node.textContent ?? "").replace(/\s+/g, "").trim());
  }
  for (const child of Array.from(node.childNodes)) {
    if (hasVisibleText(child)) return true;
  }
  return false;
}

function findPureCanvasTarget(root: Element, stageW: number, stageH: number): HTMLCanvasElement | null {
  if (root instanceof HTMLCanvasElement) return root;
  const canvases = root.querySelectorAll("canvas");
  if (canvases.length !== 1) return null;
  if (hasVisibleText(root)) return null;
  if (root.querySelector("img,svg,video")) return null;
  const canvas = canvases[0]!;
  const rect = canvas.getBoundingClientRect();
  return rect.width >= stageW * 0.9 && rect.height >= stageH * 0.9 ? canvas : null;
}

function isOrContainsDynamicVisual(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  if (tag === "CANVAS" || tag === "VIDEO") return true;
  return Boolean(el.querySelector("canvas,video"));
}

function canSkipUnchangedFrame(doc: Document, target: Element): boolean {
  if (typeof MutationObserver !== "function" || typeof doc.getAnimations !== "function") return false;
  if (isOrContainsDynamicVisual(target)) return false;
  try {
    return doc.getAnimations().length === 0;
  } catch {
    return false;
  }
}

function drawToJpegBlob(
  source: CanvasImageSource,
  outW: number,
  outH: number,
  reusable?: HTMLCanvasElement,
): Promise<Blob> {
  const out = reusable ?? document.createElement("canvas");
  if (out.width !== outW) out.width = outW;
  if (out.height !== outH) out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) return Promise.reject(new Error("2D context unavailable"));
  ctx.clearRect(0, 0, outW, outH);
  ctx.drawImage(source, 0, 0, outW, outH);
  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new Error("Failed to encode composition thumbnail frame"));
      },
      "image/jpeg",
      CAPTURE_JPEG_QUALITY,
    );
  });
}

async function waitForDocumentMedia(doc: Document, signal: AbortSignal): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (doc.fonts?.ready) tasks.push(doc.fonts.ready.catch(() => undefined));
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    if (img.complete) continue;
    if (!img.getAttribute("src") && !img.getAttribute("srcset")) continue;
    if (img.loading === "lazy") img.loading = "eager";
    tasks.push(
      new Promise<void>((resolve) => {
        const done = () => {
          img.removeEventListener("load", done);
          img.removeEventListener("error", done);
          resolve();
        };
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }),
    );
  }
  if (tasks.length === 0) return;
  await Promise.race([
    Promise.all(tasks),
    sleepAbortable(CAPTURE_MEDIA_TIMEOUT_MS, signal),
  ]);
}

function buildCaptureUrl(previewUrl: string, contentRevision: number): URL {
  const url = new URL(previewUrl, window.location.origin);
  url.searchParams.set("capture", "1");
  if (contentRevision > 0) url.searchParams.set("revision", String(contentRevision));
  return url;
}

async function captureSameOrigin(
  input: ClientCaptureInput,
  signal: AbortSignal,
  onFrame?: ProgressiveFrameCallback,
): Promise<{ blobs: Blob[]; aspect: number; width: number; height: number }> {
  const snapdom = await loadLocalSnapdom();
  if (!snapdom) throw new Error("SnapDOM unavailable");
  if (signal.aborted) throw abortError();

  const slot = acquireCaptureSlot(1280, 720);
  const iframe = slot.iframe;
  const captureUrl = buildCaptureUrl(input.previewUrl, input.contentRevision);
  let resetSlot = false;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out loading offscreen composition for thumbnail capture"));
      }, CAPTURE_BOOT_TIMEOUT_MS);
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Failed to load offscreen composition"));
      };
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      function cleanup() {
        clearTimeout(timeout);
        iframe.removeEventListener("load", onLoad);
        iframe.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
      }
      iframe.addEventListener("load", onLoad, { once: true });
      iframe.addEventListener("error", onError, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
      iframe.src = captureUrl.href;
    });

    const win = iframe.contentWindow as CapturePreviewWindow | null;
    const doc = iframe.contentDocument;
    if (!win || !doc) throw new Error("Offscreen capture frame is inaccessible");

    // Wait for HyperFrames player bootstrap inside the offscreen document.
    const deadline = Date.now() + CAPTURE_BOOT_TIMEOUT_MS;
    while (!signal.aborted) {
      const dur = win.__player?.getDuration?.() ?? 0;
      if (win.__player?.seek && Number.isFinite(dur) && dur > 0) break;
      if (Date.now() >= deadline) throw new Error("Timed out waiting for composition player");
      await sleepAbortable(30, signal);
    }
    if (signal.aborted) throw abortError();

    win.__player?.pause?.();
    const root = (doc.querySelector("[data-composition-id]") ?? doc.body) as Element;
    const stageW = Number(root.getAttribute("data-width")) || root.clientWidth || 1280;
    const stageH = Number(root.getAttribute("data-height")) || root.clientHeight || 720;
    iframe.style.width = `${stageW}px`;
    iframe.style.height = `${stageH}px`;

    await waitForDocumentMedia(doc, signal);
    if (signal.aborted) throw abortError();

    let target: Element = root;
    if (input.selector) {
      try {
        const match = doc.querySelectorAll(input.selector)[input.selectorIndex ?? 0];
        if (match) target = match;
      } catch {
        // invalid selector falls back to stage root
      }
    }
    let targetW = stageW;
    let targetH = stageH;
    if (target !== root) {
      const rect = target.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        targetW = rect.width;
        targetH = rect.height;
      }
    }

    const outW = CAPTURE_TARGET_WIDTH;
    const outH = Math.max(27, Math.round((outW * targetH) / Math.max(1, targetW)));
    const scale = outW / Math.max(1, targetW);
    const aspect = targetW / Math.max(1, targetH);
    const actualDuration = win.__player?.getDuration?.() || 0;
    const times = captureSampleTimes(actualDuration, input);
    const order: number[] = [];
    if (onFrame && times.length >= 3) {
      const coverIdx = Math.floor(times.length / 2);
      order.push(coverIdx);
      for (let i = 0; i < times.length; i++) {
        if (i !== coverIdx) order.push(i);
      }
    } else {
      for (let i = 0; i < times.length; i++) order.push(i);
    }

    const hasAsyncVisual = isOrContainsDynamicVisual(target);
    const settleFrames = hasAsyncVisual ? 2 : 1;
    const outCanvas = document.createElement("canvas");
    let observer: MutationObserver | null = null;
    let observedMutated = false;
    const observeRoot = doc.documentElement ?? (target === root ? root : null);
    if (times.length > 1 && observeRoot && canSkipUnchangedFrame(doc, target)) {
      try {
        observer = new MutationObserver(() => {
          observedMutated = true;
        });
        observer.observe(observeRoot, {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });
      } catch {
        observer = null;
      }
    }

    const blobs: Array<Blob | undefined> = new Array(times.length);
    let lastBlob: Blob | null = null;
    try {
      for (const frameIdx of order) {
        const t = times[frameIdx]!;
        await waitUntilInteractiveIdle(signal);
        if (observer) {
          observer.takeRecords();
          observedMutated = false;
        }
        win.__player!.seek!(t);
        await nextAnimationFrames(win, settleFrames, signal);

        let blob: Blob;
        if (
          observer &&
          lastBlob &&
          !observedMutated &&
          observer.takeRecords().length === 0 &&
          canSkipUnchangedFrame(doc, target)
        ) {
          blob = lastBlob;
        } else {
          const pureCanvas = findPureCanvasTarget(target, targetW, targetH);
          if (pureCanvas) {
            blob = await drawToJpegBlob(pureCanvas, outW, outH, outCanvas);
          } else {
            const rendered = await withPreviewRedirectSafeFetch(async () => {
              const snap = await snapdom(target, {
                scale,
                dpr: 1,
                fast: true,
                embedFonts: false,
                exclude: "video",
              });
              return snap.toCanvas();
            });
            blob = await drawToJpegBlob(rendered, outW, outH, outCanvas);
          }
        }
        lastBlob = blob;
        blobs[frameIdx] = blob;
        onFrame?.(frameIdx, times.length, blob, { aspect, width: outW, height: outH });
        if (times.length > 1) await sleepAbortable(CAPTURE_FRAME_YIELD_MS, signal);
      }
    } finally {
      observer?.disconnect();
    }

    return {
      blobs: blobs.filter((b): b is Blob => Boolean(b)),
      aspect,
      width: outW,
      height: outH,
    };
  } catch (error) {
    resetSlot = true;
    throw error;
  } finally {
    releaseCaptureSlot(slot, resetSlot);
  }
}

async function captureIsolatedOrigin(
  input: ClientCaptureInput,
  previewOrigin: string,
  signal: AbortSignal,
  onFrame?: ProgressiveFrameCallback,
): Promise<{ blobs: Blob[]; aspect: number; width: number; height: number }> {
  const expectedOrigin = new URL(previewOrigin).origin;
  const grant = await acquireSharedPreviewGrant(input.projectId, expectedOrigin, signal);
  const token = grant.token;

  const source = new URL(input.previewUrl, window.location.origin);
  const isolatedUrl = new URL(source.pathname, expectedOrigin);
  isolatedUrl.search = source.search;
  isolatedUrl.searchParams.set("capture", "1");
  if (input.contentRevision > 0) isolatedUrl.searchParams.set("revision", String(input.contentRevision));
  isolatedUrl.searchParams.set("pt", token);

  const slot = acquireCaptureSlot(1920, 1080);
  const iframe = slot.iframe;
  let resetSlot = false;

  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        if (grant.expiresAt <= Date.now()) {
          invalidateSharedPreviewGrant(input.projectId, token);
        }
        reject(new Error("Timed out waiting for isolated capture bridge"));
      }, CAPTURE_BOOT_TIMEOUT_MS);
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== expectedOrigin || event.source !== iframe.contentWindow) return;
        const data = event.data;
        if (!data || data.source !== "openmotion-preview-bridge" || data.token !== token) return;
        if (data.type === "preview-build-busy") {
          cleanup();
          reject(new Error("Isolated preview builder is busy"));
          return;
        }
        if (data.type === "timeline-state" && typeof data.duration === "number" && data.duration > 0) {
          if (typeof data.width === "number" && data.width > 0 && typeof data.height === "number" && data.height > 0) {
            iframe.style.width = `${data.width}px`;
            iframe.style.height = `${data.height}px`;
          }
          cleanup();
          resolve(data.duration);
        }
      };
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      function cleanup() {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        signal.removeEventListener("abort", onAbort);
      }
      window.addEventListener("message", onMessage);
      signal.addEventListener("abort", onAbort, { once: true });
      iframe.src = isolatedUrl.href;
    });

    const times = captureSampleTimes(duration, input);
    const requestId = `thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const streamedBlobs: Array<Blob | undefined> = new Array(times.length);
    let streamedCount = 0;

    const payload = await new Promise<{
      frames?: ArrayBuffer[];
      streamed?: boolean;
      frameCount?: number;
      mimeType?: string;
      width?: number;
      height?: number;
      aspect?: number;
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out capturing frames from isolated preview"));
      }, CAPTURE_BOOT_TIMEOUT_MS * 2);
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== expectedOrigin || event.source !== iframe.contentWindow) return;
        const data = event.data;
        if (!data || data.source !== "openmotion-preview-bridge" || data.token !== token) return;
        if (data.type === "capture-frame" && data.requestId === requestId) {
          const idx = typeof data.index === "number" ? data.index : -1;
          if (idx >= 0 && idx < times.length && data.frame instanceof ArrayBuffer) {
            const mime = typeof data.mimeType === "string" && data.mimeType ? data.mimeType : "image/jpeg";
            const blob = new Blob([data.frame], { type: mime });
            if (!streamedBlobs[idx]) streamedCount += 1;
            streamedBlobs[idx] = blob;
            onFrame?.(idx, Number(data.total) || times.length, blob, {
              aspect: typeof data.aspect === "number" && data.aspect > 0 ? data.aspect : 16 / 9,
              width: typeof data.width === "number" && data.width > 0 ? data.width : CAPTURE_TARGET_WIDTH,
              height: typeof data.height === "number" && data.height > 0 ? data.height : 90,
            });
          }
          return;
        }
        if (data.type === "response" && data.requestId === requestId) {
          cleanup();
          if (data.ok && data.result && (Array.isArray(data.result.frames) || data.result.streamed)) {
            resolve(data.result);
          } else {
            reject(new Error(String(data.error || "Isolated capture failed")));
          }
        }
      };
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      function cleanup() {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        signal.removeEventListener("abort", onAbort);
      }
      window.addEventListener("message", onMessage);
      signal.addEventListener("abort", onAbort, { once: true });
      iframe.contentWindow?.postMessage(
        {
          source: "openmotion-studio",
          version: 1,
          type: "capture-frames",
          projectId: input.projectId,
          token,
          requestId,
          times,
          width: CAPTURE_TARGET_WIDTH,
          selector: input.selector,
          selectorIndex: input.selectorIndex,
          progressive: Boolean(onFrame),
        },
        expectedOrigin,
      );
    });

    const mimeType = payload.mimeType || "image/jpeg";
    const blobs =
      streamedCount > 0
        ? streamedBlobs.filter((b): b is Blob => Boolean(b))
        : (payload.frames ?? []).map((buf) => new Blob([buf], { type: mimeType }));
    return {
      blobs,
      aspect: payload.aspect && payload.aspect > 0 ? payload.aspect : 16 / 9,
      width: payload.width || CAPTURE_TARGET_WIDTH,
      height: payload.height || 90,
    };
  } catch (error) {
    resetSlot = true;
    throw error;
  } finally {
    releaseCaptureSlot(slot, resetSlot);
  }
}

type StripCacheInput = Pick<ClientCaptureInput,
  "projectId" | "previewUrl" | "contentRevision" | "frameCount" | "selector" | "selectorIndex" | "seekTime" | "duration">;

export function selectorCaptureWindowKey({ selector, seekTime, duration }: Pick<ClientCaptureInput, "selector" | "seekTime" | "duration">) {
  if (!selector) return undefined;
  return `clip-window-v1:${Number.isFinite(seekTime) ? seekTime : 0}:${Number.isFinite(duration) ? duration : "full"}`;
}

function coverCacheKey(
  input: StripCacheInput,
  projectRev: string,
): string {
  return createThumbnailKey({
    project: input.projectId,
    url: input.previewUrl,
    projectRev,
    rev: input.contentRevision,
    sel: input.selector,
    idx: input.selectorIndex,
    samples: selectorCaptureWindowKey(input),
  });
}

function compPathCacheTag(projectId: string, compPath: string, projectRev: string, contentRevision: number): string {
  return `${projectId}|${normalizeCompositionPathForGate(compPath)}|${projectRev}|${contentRevision}`;
}

function clipIdentityCacheKey(
  input: Pick<StripCacheInput, "projectId" | "previewUrl" | "selector" | "selectorIndex">,
): string {
  return createThumbnailKey({
    project: input.projectId,
    url: input.previewUrl,
    sel: input.selector,
    idx: input.selectorIndex,
  });
}

function stripMemoryCacheKey(
  input: StripCacheInput,
): { idbKey: string; baseCoverKey: string; compPathKey: string; clipIdentityKey: string } {
  const compRev = resolveCompositionRevision(input.projectId, input.previewUrl);
  const baseCoverKey = coverCacheKey(input, compRev);
  return {
    idbKey: `${baseCoverKey}&frames=${input.frameCount}`,
    baseCoverKey,
    compPathKey: compPathCacheTag(input.projectId, input.previewUrl, compRev, input.contentRevision),
    clipIdentityKey: clipIdentityCacheKey(input),
  };
}

function putMemoryStripCache(
  idbKey: string,
  baseCoverKey: string,
  compPathKey: string,
  clipIdentityKey: string,
  blobs: readonly Blob[],
  aspect: number,
  width: number,
  height: number,
  precreatedUrls?: ReadonlyArray<string | undefined>,
): MemoryStripEntry {
  const existing = memoryStripCache.get(idbKey);
  if (existing) {
    if (precreatedUrls) {
      for (const url of precreatedUrls) {
        if (!url) continue;
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    }
    memoryStripCache.delete(idbKey);
    memoryStripCache.set(idbKey, existing);
    return existing;
  }
  const urls = blobs.map((blob, idx) => precreatedUrls?.[idx] ?? URL.createObjectURL(blob));
  const weight = Math.max(1, urls.length) * width * height * 4;
  const value: ThumbnailValue =
    urls.length === 1
      ? { kind: "image", url: urls[0]!, aspect, representative: "render" }
      : { kind: "filmstrip", urls, aspect };
  const coverUrl = urls[Math.min(urls.length - 1, Math.floor(urls.length / 2))]!;
  const coverValue: ThumbnailValue =
    value.kind === "image"
      ? value
      : { kind: "image", url: coverUrl, aspect, representative: "render" };
  const entry: MemoryStripEntry = {
    blobs,
    value,
    coverValue,
    urls,
    aspect,
    width,
    height,
    weight,
    baseCoverKey,
    compPathKey,
    clipIdentityKey,
    inCache: true,
    refCount: 0,
    revoked: false,
  };
  entryByValue.set(value, entry);
  if (coverValue !== value) entryByValue.set(coverValue, entry);
  memoryStripCache.set(idbKey, entry);
  while (memoryStripCache.size > MEMORY_STRIP_CACHE_MAX) {
    const oldestKey = memoryStripCache.keys().next().value;
    if (!oldestKey) break;
    const evicted = memoryStripCache.get(oldestKey);
    memoryStripCache.delete(oldestKey);
    if (evicted) {
      evicted.inCache = false;
      maybeRevokeEntry(evicted);
    }
  }
  return entry;
}

function retainOrRematerialize(idbKey: string, entry: MemoryStripEntry): MemoryStripEntry {
  if (!entry.revoked) return entry;
  return putMemoryStripCache(
    idbKey,
    entry.baseCoverKey,
    entry.compPathKey,
    entry.clipIdentityKey,
    entry.blobs,
    entry.aspect,
    entry.width,
    entry.height,
  );
}

function memoryEntryToThumbnailResult(entry: MemoryStripEntry): ThumbnailLoadedResult {
  // Retain the entry on behalf of ThumbnailScheduler so LRU eviction in memoryStripCache
  // only drops cache ownership; object URLs stay valid until ThumbnailScheduler disposes
  // its result and all direct consumers release their leases.
  const release = retainMemoryEntry(entry);
  return {
    value: entry.value,
    weight: entry.weight,
    dispose: release,
  };
}

function peekMemoryEntry(
  input: StripCacheInput,
): { entry: MemoryStripEntry; value: ThumbnailValue } | null {
  const { idbKey, baseCoverKey, compPathKey, clipIdentityKey } = stripMemoryCacheKey(input);
  const exact = memoryStripCache.get(idbKey);
  if (exact) {
    memoryStripCache.delete(idbKey);
    memoryStripCache.set(idbKey, exact);
    return { entry: exact, value: exact.value };
  }
  if (input.frameCount === 1) {
    // Reuse an already-resident multi-frame strip's middle frame without creating duplicate
    // object URLs or triggering LRU eviction during React render.
    for (const [key, entry] of memoryStripCache) {
      if (entry.baseCoverKey === baseCoverKey) {
        memoryStripCache.delete(key);
        memoryStripCache.set(key, entry);
        return { entry, value: entry.coverValue };
      }
    }
    const shared = sharedCoverCache.get(baseCoverKey);
    if (shared) {
      const entry = putMemoryStripCache(
        idbKey,
        baseCoverKey,
        compPathKey,
        clipIdentityKey,
        [shared.blob],
        shared.aspect,
        shared.width,
        shared.height,
      );
      return { entry, value: entry.value };
    }
  }
  return null;
}

/**
 * Synchronously return a warm in-memory captured strip/cover when available.
 * Independent of `sessionEpoch` so switching projects or sub-compositions renders in 0ms.
 * Callers holding the returned value across renders should retain it via
 * `retainCachedCompositionCapture(value)` so LRU eviction never revokes active URLs.
 */
export function peekCachedCompositionCapture(
  input: StripCacheInput,
): ThumbnailValue | null {
  return peekMemoryEntry(input)?.value ?? null;
}

/**
 * Return the freshest in-memory captured strip/render for the same clip identity
 * regardless of frame count, revision, or selector time window, so a refreshing or
 * remounted timeline clip keeps showing its previous filmstrip until the refresh completes.
 */
export function peekFallbackCompositionCapture(
  input: Pick<StripCacheInput, "projectId" | "previewUrl" | "selector" | "selectorIndex">,
): ThumbnailValue | null {
  const target = clipIdentityCacheKey(input);
  let fallbackRenderImage: ThumbnailValue | null = null;
  const entries = [...memoryStripCache.values()];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.revoked || entry.clipIdentityKey !== target) continue;
    if (entry.value.kind === "filmstrip" && entry.value.urls.length > 0) {
      return entry.value;
    }
    if (!fallbackRenderImage && entry.value.kind === "image" && entry.value.representative === "render") {
      fallbackRenderImage = entry.value;
    }
  }
  return fallbackRenderImage;
}

/** Seed an in-memory cached capture strip in unit tests to exercise LRU/ownership semantics. */
export function seedClientCompositionCaptureForTest(
  input: StripCacheInput,
  blobs: readonly Blob[],
  dims: { aspect?: number; width?: number; height?: number } = {},
): ThumbnailValue {
  const { idbKey, baseCoverKey, compPathKey, clipIdentityKey } = stripMemoryCacheKey(input);
  const aspect = dims.aspect ?? 16 / 9;
  const width = dims.width ?? CAPTURE_TARGET_WIDTH;
  const height = dims.height ?? 135;
  const coverBlob = blobs[Math.min(blobs.length - 1, Math.floor(blobs.length / 2))]!;
  putSharedCoverCache(baseCoverKey, { blob: coverBlob, aspect, width, height });
  return putMemoryStripCache(
    idbKey,
    baseCoverKey,
    compPathKey,
    clipIdentityKey,
    blobs,
    aspect,
    width,
    height,
  ).value;
}

/** True when any frame count for this composition is already cached in RAM (no blocking gate needed). */
export function hasAnyCachedCompositionCapture(
  projectId: string,
  compPath: string,
  contentRevision = 0,
): boolean {
  const compRev = resolveCompositionRevision(projectId, compPath);
  const target = compPathCacheTag(projectId, compPath, compRev, contentRevision);
  for (const entry of memoryStripCache.values()) {
    if (entry.compPathKey === target) return true;
  }
  return false;
}

/** Subscribe to mid-capture progressive frame updates for a composition strip. */
export function subscribeProgressiveCompositionCapture(
  input: StripCacheInput,
  listener: () => void,
): () => void {
  const { idbKey } = stripMemoryCacheKey(input);
  let listeners = progressiveListeners.get(idbKey);
  if (!listeners) {
    listeners = new Set();
    progressiveListeners.set(idbKey, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = progressiveListeners.get(idbKey);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) progressiveListeners.delete(idbKey);
  };
}

/** Read the current progressive mid-capture thumbnail value (referentially stable). */
export function getProgressiveCompositionCapture(
  input: StripCacheInput,
): ThumbnailValue | null {
  const { idbKey } = stripMemoryCacheKey(input);
  return progressiveStrips.get(idbKey) ?? null;
}

/**
 * Fast-path IndexedDB lookup that bypasses `thumbnailScheduler`'s 2-slot composition bucket
 * so warm page reloads recover all cached strips in parallel (~5–15ms).
 * Returns a retained lease that the caller must release when unmounting or changing keys.
 */
export function acquireCachedCompositionCaptureFromIdb(
  input: StripCacheInput,
): Promise<{ value: ThumbnailValue; release: () => void } | null> {
  const syncHit = peekMemoryEntry(input);
  if (syncHit) {
    return Promise.resolve({
      value: syncHit.value,
      release: retainMemoryEntry(syncHit.entry),
    });
  }
  const { idbKey, baseCoverKey, compPathKey, clipIdentityKey } = stripMemoryCacheKey(input);
  let entryPromise = inFlightIdbReads.get(idbKey);
  if (!entryPromise) {
    entryPromise = readCachedStrip(idbKey)
      .then((cached) => {
        if (!cached) return null;
        const coverBlob =
          cached.blobs[Math.min(cached.blobs.length - 1, Math.floor(cached.blobs.length / 2))]!;
        putSharedCoverCache(baseCoverKey, {
          blob: coverBlob,
          aspect: cached.aspect,
          width: cached.width,
          height: cached.height,
        });
        return putMemoryStripCache(
          idbKey,
          baseCoverKey,
          compPathKey,
          clipIdentityKey,
          cached.blobs,
          cached.aspect,
          cached.width,
          cached.height,
        );
      })
      .finally(() => {
        inFlightIdbReads.delete(idbKey);
      });
    inFlightIdbReads.set(idbKey, entryPromise);
  }
  return entryPromise.then((entry) => {
    if (!entry) return null;
    const live = retainOrRematerialize(idbKey, entry);
    return { value: live.value, release: retainMemoryEntry(live) };
  });
}

async function runClientCompositionCapture(
  input: ClientCaptureInput,
  signal: AbortSignal,
): Promise<ThumbnailLoadedResult> {
  const { idbKey, baseCoverKey, compPathKey, clipIdentityKey } = stripMemoryCacheKey(input);

  // 0. Fast path: synchronous in-memory strip/cover cache hit (0ms across switches).
  const memHit = memoryStripCache.get(idbKey);
  if (memHit) {
    memoryStripCache.delete(idbKey);
    memoryStripCache.set(idbKey, memHit);
    return memoryEntryToThumbnailResult(memHit);
  }

  // 1. Fast path: 1-frame sidebar covers reuse any already-captured strip frame immediately.
  if (input.frameCount === 1) {
    for (const [key, entry] of memoryStripCache) {
      if (entry.baseCoverKey === baseCoverKey) {
        memoryStripCache.delete(key);
        memoryStripCache.set(key, entry);
        const release = retainMemoryEntry(entry);
        return {
          value: entry.coverValue,
          weight: entry.width * entry.height * 4,
          dispose: release,
        };
      }
    }
    const shared = sharedCoverCache.get(baseCoverKey);
    if (shared) {
      const entry = putMemoryStripCache(
        idbKey,
        baseCoverKey,
        compPathKey,
        clipIdentityKey,
        [shared.blob],
        shared.aspect,
        shared.width,
        shared.height,
      );
      return memoryEntryToThumbnailResult(entry);
    }
  }

  // 2. Fast path: persistent IndexedDB hit across page refreshes.
  const cached = await readCachedStrip(idbKey);
  if (signal.aborted) throw abortError();
  if (cached) {
    const coverBlob = cached.blobs[Math.min(cached.blobs.length - 1, Math.floor(cached.blobs.length / 2))]!;
    putSharedCoverCache(baseCoverKey, {
      blob: coverBlob,
      aspect: cached.aspect,
      width: cached.width,
      height: cached.height,
    });
    const entry = putMemoryStripCache(
      idbKey,
      baseCoverKey,
      compPathKey,
      clipIdentityKey,
      cached.blobs,
      cached.aspect,
      cached.width,
      cached.height,
    );
    return memoryEntryToThumbnailResult(entry);
  }

  // 3. Priority-queued bounded-pool offscreen browser capture (paused during playback).
  const queuePriority = resolveQueuePriority(input);
  const precreatedUrls: Array<string | undefined> = [];
  const receivedBlobs: Array<Blob | undefined> = [];
  let receivedCount = 0;
  let committed = false;

  const fillNearestUrls = (total: number): string[] => {
    const dense: string[] = [];
    for (let i = 0; i < total; i++) {
      let bestUrl = precreatedUrls[i];
      if (!bestUrl) {
        let bestDist = Infinity;
        for (let j = 0; j < precreatedUrls.length; j++) {
          const cand = precreatedUrls[j];
          if (!cand) continue;
          const dist = Math.abs(i - j);
          if (dist < bestDist) {
            bestDist = dist;
            bestUrl = cand;
          }
        }
      }
      if (bestUrl) dense.push(bestUrl);
    }
    return dense;
  };

  const onProgressiveFrame: ProgressiveFrameCallback = (index, total, blob, dims) => {
    if (signal.aborted) return;
    if (!receivedBlobs[index]) receivedCount += 1;
    receivedBlobs[index] = blob;
    const isFirst = receivedCount === 1;
    const isMidpoint = total >= 4 && receivedCount === Math.ceil(total / 2);
    if (!isFirst && !isMidpoint) return;

    if (isFirst) {
      putSharedCoverCache(baseCoverKey, {
        blob,
        aspect: dims.aspect,
        width: dims.width,
        height: dims.height,
      });
      const firstUrl = precreatedUrls[index] ?? URL.createObjectURL(blob);
      precreatedUrls[index] = firstUrl;
      setProgressiveEntry(
        idbKey,
        input.frameCount === 1
          ? { kind: "image", url: firstUrl, aspect: dims.aspect, representative: "render" }
          : { kind: "filmstrip", urls: [firstUrl], aspect: dims.aspect },
      );
      return;
    }

    for (let i = 0; i < receivedBlobs.length; i++) {
      if (receivedBlobs[i] && !precreatedUrls[i]) {
        precreatedUrls[i] = URL.createObjectURL(receivedBlobs[i]!);
      }
    }
    const denseUrls = fillNearestUrls(total);
    if (denseUrls.length > 0) {
      setProgressiveEntry(idbKey, { kind: "filmstrip", urls: denseUrls, aspect: dims.aspect });
    }
  };

  try {
    const result = await enqueueSerializedCapture(queuePriority, signal, async () => {
      await waitUntilInteractiveIdle(signal);
      if (signal.aborted) throw abortError();
      const previewOrigin = isolatedPreviewOrigin();
      return previewOrigin
        ? captureIsolatedOrigin(input, previewOrigin, signal, onProgressiveFrame)
        : captureSameOrigin(input, signal, onProgressiveFrame);
    });

    if (signal.aborted) throw abortError();
    if (result.blobs.length === 0) throw new Error("Client composition capture returned no frames");

    const coverBlob = result.blobs[Math.min(result.blobs.length - 1, Math.floor(result.blobs.length / 2))]!;
    putSharedCoverCache(baseCoverKey, {
      blob: coverBlob,
      aspect: result.aspect,
      width: result.width,
      height: result.height,
    });

    void writeCachedStrip({
      key: idbKey,
      aspect: result.aspect,
      width: result.width,
      height: result.height,
      blobs: result.blobs,
      updatedAt: Date.now(),
    });

    const entry = putMemoryStripCache(
      idbKey,
      baseCoverKey,
      compPathKey,
      clipIdentityKey,
      result.blobs,
      result.aspect,
      result.width,
      result.height,
      precreatedUrls,
    );
    committed = true;
    clearProgressiveEntry(idbKey);
    return memoryEntryToThumbnailResult(entry);
  } finally {
    clearProgressiveEntry(idbKey);
    if (!committed) {
      for (const url of precreatedUrls) {
        if (!url) continue;
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    }
  }
}

/** Build a scheduler-managed request that captures real composition frames in the browser. */
export function createClientCompositionCaptureRequest(input: ClientCaptureInput): ThumbnailRequest {
  const compRev = resolveCompositionRevision(input.projectId, input.previewUrl);
  return {
    key: createThumbnailKey({
      kind: "client-comp-capture",
      previewUrl: input.previewUrl,
      projectRev: compRev,
      revision: input.contentRevision,
      frames: input.frameCount,
      selector: input.selector,
      selectorIndex: input.selectorIndex,
      samples: selectorCaptureWindowKey(input),
    }),
    projectId: input.projectId,
    sessionEpoch: input.sessionEpoch,
    kind: "composition",
    concurrencyBucket: "client-capture",
    priority: input.priority ?? "visible",
    rich: input.rich ?? true,
    load: (signal) => runClientCompositionCapture(input, signal),
  };
}
