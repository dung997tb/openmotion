import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Skeleton } from '../components/ui/Skeleton';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { findScrollContainer, observeScrollActivity } from '../utils/scrollActivity';

const VIRTUAL_WIDTH = 960;
const VIRTUAL_HEIGHT = 600;
export const MAX_ACTIVE_THUMBS = 12;
const STAGGER_BATCH_SIZE = 2;
const STAGGER_TICK_MS = 32;

type SlotEntry = {
  hovered: boolean;
  onEvict: () => void;
};

type WaiterEntry = SlotEntry & {
  onGrant: () => void;
};

const activeThumbSlots = new Map<string, SlotEntry>();
const waitingThumbSlots = new Map<string, WaiterEntry>();

const visibilityListeners = new Set<(visible: boolean) => void>();
let visibilityListenerAttached = false;

function handleDocumentVisibilityChange() {
  const isVisible = !document.hidden;
  for (const listener of [...visibilityListeners]) {
    listener(isVisible);
  }
}

function subscribePageVisibility(listener: (visible: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  visibilityListeners.add(listener);
  if (!visibilityListenerAttached) {
    visibilityListenerAttached = true;
    document.addEventListener('visibilitychange', handleDocumentVisibilityChange);
  }
  return () => {
    visibilityListeners.delete(listener);
    if (visibilityListeners.size === 0 && visibilityListenerAttached) {
      visibilityListenerAttached = false;
      document.removeEventListener('visibilitychange', handleDocumentVisibilityChange);
    }
  };
}

const settledThumbQueue = new Map<string, () => void>();
let staggerTickGrants = 0;
let staggerTimer: ReturnType<typeof setTimeout> | undefined;

function drainSettledThumbs() {
  while (staggerTickGrants < STAGGER_BATCH_SIZE && settledThumbQueue.size > 0) {
    const next = settledThumbQueue.entries().next().value as [string, () => void] | undefined;
    if (!next) break;
    const [id, reveal] = next;
    settledThumbQueue.delete(id);
    staggerTickGrants += 1;
    reveal();
  }
  if (staggerTimer === undefined && (staggerTickGrants > 0 || settledThumbQueue.size > 0)) {
    staggerTimer = setTimeout(() => {
      staggerTimer = undefined;
      staggerTickGrants = 0;
      if (settledThumbQueue.size > 0) {
        drainSettledThumbs();
      }
    }, STAGGER_TICK_MS);
  }
}

function enqueueSettledThumb(id: string, reveal: () => void): void {
  settledThumbQueue.set(id, reveal);
  drainSettledThumbs();
}

function cancelSettledThumb(id: string): void {
  settledThumbQueue.delete(id);
}

function disposeIframeResources(iframe: HTMLIFrameElement | null): void {
  if (!iframe) return;
  try {
    iframe.contentWindow?.postMessage({ type: 'om:thumb-dispose' }, '*');
  } catch {
    /* ignore sandboxed or already-detached frames */
  }
}

function acquireThumbSlot(
  id: string,
  hovered: boolean,
  onEvict: () => void,
  onGrant?: () => void,
): boolean {
  if (activeThumbSlots.has(id)) {
    const existing = activeThumbSlots.get(id)!;
    existing.hovered = hovered;
    existing.onEvict = onEvict;
    waitingThumbSlots.delete(id);
    return true;
  }
  if (activeThumbSlots.size < MAX_ACTIVE_THUMBS) {
    waitingThumbSlots.delete(id);
    activeThumbSlots.set(id, { hovered, onEvict });
    return true;
  }
  // Only evict an existing visible tile when the user hovers a throttled card; never let
  // lower rows evict Row 1 visible thumbnails during initial layout/scroll intersection.
  if (!hovered) {
    if (onGrant) {
      waitingThumbSlots.set(id, { hovered, onEvict, onGrant });
    }
    return false;
  }
  while (activeThumbSlots.size >= MAX_ACTIVE_THUMBS) {
    let victimKey: string | null = null;
    for (const [key, entry] of activeThumbSlots) {
      if (!entry.hovered) {
        victimKey = key;
        break;
      }
    }
    if (victimKey === null) {
      victimKey = activeThumbSlots.keys().next().value ?? null;
    }
    if (victimKey === null) break;
    const victim = activeThumbSlots.get(victimKey);
    activeThumbSlots.delete(victimKey);
    victim?.onEvict();
  }
  waitingThumbSlots.delete(id);
  activeThumbSlots.set(id, { hovered, onEvict });
  return true;
}

function grantNextWaitingThumb(): void {
  while (activeThumbSlots.size < MAX_ACTIVE_THUMBS && waitingThumbSlots.size > 0) {
    const next = waitingThumbSlots.entries().next().value as [string, WaiterEntry] | undefined;
    if (!next) break;
    const [nextId, waiter] = next;
    waitingThumbSlots.delete(nextId);
    activeThumbSlots.set(nextId, { hovered: waiter.hovered, onEvict: waiter.onEvict });
    waiter.onGrant();
  }
}

function releaseThumbSlot(id: string): void {
  waitingThumbSlots.delete(id);
  const removed = activeThumbSlots.delete(id);
  if (removed) grantNextWaitingThumb();
}

function updateThumbSlotHover(id: string, hovered: boolean): void {
  const entry = activeThumbSlots.get(id);
  if (!entry) return;
  entry.hovered = hovered;
  // Promote hovered entries toward the tail so FIFO eviction targets older idle cards first.
  if (hovered) {
    activeThumbSlots.delete(id);
    activeThumbSlots.set(id, entry);
  }
}

function withThumbParam(src: string): string {
  if (!src.startsWith('/motion-api/design/')) return src;
  return src.includes('?') ? `${src}&thumb=1` : `${src}?thumb=1`;
}

/**
 * Viewport-aware, edge-to-edge scaled sandboxed iframe thumbnail for Design Studio templates and projects.
 * - Unmounts off-screen, hidden-tab, or inactive-page iframes so WebGL/rAF contexts are freed immediately.
 * - Defers and staggers iframe mounts/teardowns across active scroll bursts so scrolling never stalls.
 * - Appends ?thumb=1 so heavy WebGL/rAF animations paint their initial frame and freeze at 0% GPU until hovered.
 * - Caps simultaneous mounted iframes across the workspace to MAX_ACTIVE_THUMBS so GPU/WebGL contexts cannot exhaust.
 */
export const ScaledPreviewThumb = memo(function ScaledPreviewThumb({
  src,
  title,
  badge,
  brandedFallback = false,
  active = true,
}: {
  src: string;
  title: string;
  badge?: string;
  brandedFallback?: boolean;
  active?: boolean;
}) {
  const instanceId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hoveredRef = useRef(false);
  const inViewRef = useRef(false);
  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );
  const [visible, setVisible] = useState(false);
  const [slotGranted, setSlotGranted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0.32);

  const waitForReady = brandedFallback && src?.startsWith('/motion-api/design/catalog/templates/');
  const thumbSrc = useMemo(
    () => (src ? withThumbParam(src) + (waitForReady ? '&thumbReady=1' : '') : ''),
    [src, waitForReady],
  );

  useEffect(() => subscribePageVisibility(setPageVisible), []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const updateScale = () => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) {
        const nextScale = width / VIRTUAL_WIDTH;
        setScale(prev => (Math.abs(prev - nextScale) > 0.002 ? nextScale : prev));
      }
    };
    updateScale();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateScale);
      ro.observe(el);
    }
    if (!active || !pageVisible) {
      inViewRef.current = false;
      cancelSettledThumb(instanceId);
      setVisible(false);
      setLoaded(false);
      return () => { ro?.disconnect(); };
    }
    if (typeof IntersectionObserver === 'undefined') {
      inViewRef.current = true;
      setVisible(true);
      return () => { ro?.disconnect(); };
    }
    const scrollHost = findScrollContainer(el);
    const scrollActivity = observeScrollActivity(scrollHost, () => {
      if (!inViewRef.current) {
        cancelSettledThumb(instanceId);
        setVisible(false);
        setLoaded(false);
        return;
      }
      if (hoveredRef.current) {
        cancelSettledThumb(instanceId);
        setVisible(true);
        return;
      }
      enqueueSettledThumb(instanceId, () => {
        if (inViewRef.current && !scrollActivity.isScrolling()) {
          setVisible(true);
        }
      });
    });
    const io = new IntersectionObserver(entries => {
      const inView = entries.some(e => e.isIntersecting);
      inViewRef.current = inView;
      if (scrollActivity.isScrolling()) return;
      cancelSettledThumb(instanceId);
      setVisible(inView);
      if (!inView) setLoaded(false);
    }, { rootMargin: '40px' });
    io.observe(el);
    return () => {
      cancelSettledThumb(instanceId);
      scrollActivity.disconnect();
      io.disconnect();
      ro?.disconnect();
    };
  }, [active, pageVisible, instanceId]);

  const wantMount = Boolean(active && pageVisible && visible && thumbSrc);

  const evictSelf = useCallback(() => {
    disposeIframeResources(iframeRef.current);
    setSlotGranted(false);
    setLoaded(false);
  }, []);

  useEffect(() => {
    if (!wantMount) {
      releaseThumbSlot(instanceId);
      setSlotGranted(false);
      setLoaded(false);
      return;
    }
    const granted = acquireThumbSlot(
      instanceId,
      hoveredRef.current,
      evictSelf,
      () => setSlotGranted(true),
    );
    setSlotGranted(granted);
    return () => {
      releaseThumbSlot(instanceId);
    };
  }, [wantMount, instanceId, evictSelf]);

  const shouldMount = wantMount && slotGranted;

  useEffect(() => {
    if (!shouldMount) return;
    const iframe = iframeRef.current;
    return () => disposeIframeResources(iframe);
  }, [shouldMount, thumbSrc]);

  useEffect(() => {
    if (!shouldMount || !waitForReady) return;
    const receiveReady = (event: MessageEvent) => {
      if (event.source === iframeRef.current?.contentWindow && event.data?.type === 'om:thumb-ready') setLoaded(true);
    };
    window.addEventListener('message', receiveReady);
    return () => window.removeEventListener('message', receiveReady);
  }, [shouldMount, waitForReady]);

  const setPlaying = (play: boolean) => {
    hoveredRef.current = play;
    if (play && inViewRef.current && !visible && active && pageVisible) {
      cancelSettledThumb(instanceId);
      setVisible(true);
    }
    if (play && wantMount && !slotGranted) {
      if (acquireThumbSlot(instanceId, true, evictSelf)) {
        setSlotGranted(true);
      }
      return;
    }
    updateThumbSlotHover(instanceId, play);
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'om:thumb-play', play }, '*');
    } catch { /* ignore */ }
  };

  const handleIframeLoad = () => {
    if (!waitForReady) setLoaded(true);
    if (hoveredRef.current) {
      try {
        iframeRef.current?.contentWindow?.postMessage({ type: 'om:thumb-play', play: true }, '*');
      } catch { /* ignore */ }
    }
  };

  return (
    <div
      ref={hostRef}
      className="om-design-card-thumb"
      data-loaded={loaded}
      onMouseEnter={() => setPlaying(true)}
      onMouseLeave={() => setPlaying(false)}
    >
      {!loaded && (brandedFallback ? <CoverPlaceholder fill /> : <Skeleton className="om-design-thumb-skeleton" />)}
      {shouldMount && (
        <iframe
          ref={iframeRef}
          title={title}
          src={thumbSrc}
          loading="lazy"
          sandbox="allow-scripts"
          tabIndex={-1}
          onLoad={handleIframeLoad}
          style={{
            width: VIRTUAL_WIDTH,
            height: VIRTUAL_HEIGHT,
            transform: `scale(${scale})`,
            opacity: loaded ? 1 : 0,
          }}
        />
      )}
      {badge && <span className="om-design-thumb-badge">{badge}</span>}
    </div>
  );
});
