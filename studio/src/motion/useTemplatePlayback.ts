import { useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react';
import { observeScrollActivity } from '../utils/scrollActivity';

export const MAX_TEMPLATE_PLAYERS = 8;
export const EXPLORE_TEMPLATE_PLAYERS = 4;

export interface TemplatePlaybackStore {
  subscribe: (listener: () => void) => () => void;
  isPlaying: (id: string) => boolean;
  getSnapshot: () => Set<string>;
  setPriority: (id: string | null) => void;
}

/**
 * External store backing bounded media playback inside a scroll root.
 * Defers observer and hover player switches while scroll is actively moving so scrolling stays jank-free,
 * and allows individual cards to subscribe to their own active boolean without re-rendering siblings or the page.
 */
export function useTemplatePlaybackStore(
  root: RefObject<HTMLElement | null>,
  catalogKey: string,
  enabled: boolean,
  autoplay: boolean,
  priorityOnly = false,
  playerBudget = MAX_TEMPLATE_PLAYERS,
  externalPriority?: string | null,
): TemplatePlaybackStore {
  const snapshotRef = useRef<Set<string>>(new Set());
  const listenersRef = useRef<Set<() => void>>(new Set());
  const controls = useRef<{ autoplay: boolean; priority: string | null }>({
    autoplay,
    priority: externalPriority ?? null,
  });
  const refresh = useRef<(force?: boolean) => void>(() => {});
  const isScrollingRef = useRef<() => boolean>(() => false);

  const store = useMemo<TemplatePlaybackStore>(() => ({
    subscribe(listener) {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    isPlaying(id) {
      return snapshotRef.current.has(id);
    },
    getSnapshot() {
      return snapshotRef.current;
    },
    setPriority(id) {
      if (controls.current.priority === id) return;
      controls.current.priority = id;
      if (!isScrollingRef.current()) {
        refresh.current(false);
      }
    },
  }), []);

  useEffect(() => {
    const prevAutoplay = controls.current.autoplay;
    controls.current.autoplay = autoplay;
    if (externalPriority !== undefined) {
      controls.current.priority = externalPriority;
    }
    const autoplayChanged = prevAutoplay !== autoplay;
    if (autoplayChanged || !isScrollingRef.current()) {
      refresh.current(autoplayChanged);
    }
  }, [autoplay, externalPriority]);

  useEffect(() => {
    const commitSnapshot = (ids: string[]) => {
      const previous = snapshotRef.current;
      if (previous.size === ids.length && ids.every(id => previous.has(id))) return;
      snapshotRef.current = new Set(ids);
      for (const listener of [...listenersRef.current]) {
        listener();
      }
    };

    const container = root.current;
    if (!container || !enabled) {
      refresh.current = () => {};
      isScrollingRef.current = () => false;
      commitSnapshot([]);
      return;
    }

    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const compact = matchMedia('(max-width: 699px)');
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    const visible = new Map<string, number>();

    const update = (force = false) => {
      if (!force && isScrollingRef.current()) return;
      const { autoplay: currentAutoplay, priority } = controls.current;
      const allowed = currentAutoplay && !document.hidden && !media.matches;
      const currentActive = snapshotRef.current;
      const candidates = [...visible].sort((a, b) =>
        Number(b[0] === priority) - Number(a[0] === priority)
        || Number(currentActive.has(b[0]) && b[1] >= 0.5) - Number(currentActive.has(a[0]) && a[1] >= 0.5)
        || b[1] - a[1],
      );
      // Brand Kit showcases are full HTML documents. Decode only the card the
      // user is actively hovering/focusing instead of starting several iframe
      // runtimes as soon as the masonry enters the viewport.
      const scoped = priorityOnly ? (priority ? candidates.filter(([id]) => id === priority) : []) : candidates;
      const compactCap = playerBudget <= 2 ? playerBudget : Math.min(4, Math.ceil(playerBudget / 2));
      const maxAllowed = Math.min(playerBudget, compact.matches ? compactCap : MAX_TEMPLATE_PLAYERS);
      const ids = allowed
        ? scoped.filter(([id]) => !connection?.saveData || id === priority).slice(0, maxAllowed).map(([id]) => id)
        : [];
      commitSnapshot(ids);
    };

    const scrollActivity = observeScrollActivity(container, () => update(true));
    isScrollingRef.current = scrollActivity.isScrolling;
    refresh.current = update;

    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const { playbackId, templateId } = (entry.target as HTMLElement).dataset;
        const id = playbackId ?? templateId;
        if (!id) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.2) visible.set(id, entry.intersectionRatio);
        else visible.delete(id);
      }
      if (!scrollActivity.isScrolling()) {
        update();
      }
    }, { root: container, threshold: [0, 0.2, 0.6] });

    container.querySelectorAll('[data-template-id][data-has-video="true"], [data-playback-id]').forEach(element => observer.observe(element));
    const forceUpdate = () => update(true);
    document.addEventListener('visibilitychange', forceUpdate);
    media.addEventListener('change', forceUpdate);
    compact.addEventListener('change', forceUpdate);
    connection?.addEventListener('change', forceUpdate);
    update(true);

    return () => {
      refresh.current = () => {};
      isScrollingRef.current = () => false;
      scrollActivity.disconnect();
      observer.disconnect();
      document.removeEventListener('visibilitychange', forceUpdate);
      media.removeEventListener('change', forceUpdate);
      compact.removeEventListener('change', forceUpdate);
      connection?.removeEventListener('change', forceUpdate);
    };
  }, [root, catalogKey, enabled, priorityOnly, playerBudget]);

  return store;
}

/** Subscribes a single card to its active playback boolean without re-rendering sibling cards. */
export function useTemplatePlaybackActive(store: TemplatePlaybackStore, id: string | undefined): boolean {
  return useSyncExternalStore(
    store.subscribe,
    () => Boolean(id && store.isPlaying(id)),
    () => false,
  );
}

/** One observer and a bounded decoder budget for the whole gallery. No offscreen video sources. */
export function useTemplatePlayback(
  root: RefObject<HTMLElement | null>,
  catalogKey: string,
  enabled: boolean,
  autoplay: boolean,
  priority: string | null,
  priorityOnly = false,
  playerBudget = MAX_TEMPLATE_PLAYERS,
) {
  const store = useTemplatePlaybackStore(root, catalogKey, enabled, autoplay, priorityOnly, playerBudget, priority);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
