export const SCROLL_SETTLE_MS = 160;

type ScrollTracker = {
  scrolling: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  listeners: Set<() => void>;
  refCount: number;
  hasScrollEnd: boolean;
  onScroll: () => void;
  onScrollEnd: () => void;
};

const trackers = new WeakMap<EventTarget, ScrollTracker>();

/** Walks ancestor elements to find the nearest vertical scroll container. */
export function findScrollContainer(element: Element | null): HTMLElement | null {
  if (!element || typeof getComputedStyle !== 'function') return null;
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY || style.overflow)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** Shares one passive scroll/scrollend listener per scroll container and invokes callbacks once scrolling settles. */
export function observeScrollActivity(
  target: EventTarget | null,
  onSettle: () => void,
): { isScrolling: () => boolean; disconnect: () => void } {
  if (!target) {
    return { isScrolling: () => false, disconnect: () => {} };
  }

  let tracker = trackers.get(target);
  if (!tracker) {
    const settle = () => {
      if (!tracker) return;
      if (tracker.timer !== undefined) {
        clearTimeout(tracker.timer);
        tracker.timer = undefined;
      }
      if (!tracker.scrolling) return;
      tracker.scrolling = false;
      for (const callback of [...tracker.listeners]) {
        callback();
      }
    };

    const onScroll = () => {
      if (!tracker) return;
      tracker.scrolling = true;
      if (tracker.timer !== undefined) clearTimeout(tracker.timer);
      tracker.timer = setTimeout(settle, SCROLL_SETTLE_MS);
    };

    const hasScrollEnd = 'onscrollend' in target;
    tracker = {
      scrolling: false,
      timer: undefined,
      listeners: new Set(),
      refCount: 0,
      hasScrollEnd,
      onScroll,
      onScrollEnd: settle,
    };
    trackers.set(target, tracker);
    target.addEventListener('scroll', onScroll, { passive: true });
    if (hasScrollEnd) {
      target.addEventListener('scrollend', settle, { passive: true });
    }
  }

  tracker.refCount += 1;
  tracker.listeners.add(onSettle);
  let active = true;

  return {
    isScrolling: () => Boolean(tracker && trackers.get(target) === tracker && tracker.scrolling),
    disconnect: () => {
      if (!active) return;
      active = false;
      tracker!.listeners.delete(onSettle);
      tracker!.refCount -= 1;
      if (tracker!.refCount <= 0) {
        if (tracker!.timer !== undefined) {
          clearTimeout(tracker!.timer);
          tracker!.timer = undefined;
        }
        target.removeEventListener('scroll', tracker!.onScroll);
        if (tracker!.hasScrollEnd) {
          target.removeEventListener('scrollend', tracker!.onScrollEnd);
        }
        trackers.delete(target);
      }
    },
  };
}
