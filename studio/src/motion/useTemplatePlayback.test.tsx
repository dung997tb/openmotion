// @vitest-environment happy-dom
import { act, memo, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_SETTLE_MS } from '../utils/scrollActivity';
import { skillPreviewSnapshot } from './skillCatalog';
import { clearSkillPreviewCache, useSkillPreview } from './useSkillPreview';
import {
  useTemplatePlaybackActive,
  useTemplatePlaybackStore,
  type TemplatePlaybackStore,
} from './useTemplatePlayback';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class TestObserver {
  static latest: TestObserver | null = null;
  elements: Element[] = [];
  constructor(private callback: IntersectionObserverCallback) {
    TestObserver.latest = this;
  }
  observe(element: Element) {
    this.elements.push(element);
  }
  disconnect() {}
  emit(ratios: Record<string, number>) {
    this.callback(
      this.elements.map(target => {
        const el = target as HTMLElement;
        const id = el.dataset.playbackId ?? el.dataset.templateId!;
        const ratio = ratios[id] ?? 0;
        return {
          target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        } as IntersectionObserverEntry;
      }),
      this as unknown as IntersectionObserver,
    );
  }
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  TestObserver.latest = null;
  clearSkillPreviewCache();
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('IntersectionObserver', TestObserver);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearSkillPreviewCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useTemplatePlaybackStore & useSkillPreview', () => {
  it('defers intersection and priority player changes while actively scrolling and commits once settled', async () => {
    vi.useFakeTimers();
    let capturedStore!: TemplatePlaybackStore;
    const activeCounts: Record<string, number> = { a: 0, b: 0, c: 0 };

    const Card = memo(function Card({ id, store }: { id: string; store: TemplatePlaybackStore }) {
      const playing = useTemplatePlaybackActive(store, id);
      activeCounts[id] += 1;
      return <div data-playback-id={id} data-playing={String(playing)} />;
    });

    function Gallery() {
      const scroller = useRef<HTMLDivElement>(null);
      const store = useTemplatePlaybackStore(scroller, 'k', true, true, false, 1);
      capturedStore = store;
      return (
        <div ref={scroller}>
          <Card id="a" store={store} />
          <Card id="b" store={store} />
          <Card id="c" store={store} />
        </div>
      );
    }

    await act(async () => {
      root.render(<Gallery />);
    });
    const scroller = host.firstElementChild as HTMLDivElement;

    // Initial stationary visibility applies synchronously.
    await act(async () => {
      TestObserver.latest!.emit({ a: 0.9, b: 0, c: 0 });
    });
    expect(host.querySelector('[data-playback-id="a"]')?.getAttribute('data-playing')).toBe('true');

    // Start scrolling: visibility & priority shifts must not churn players mid-scroll.
    await act(async () => {
      scroller.dispatchEvent(new Event('scroll'));
      TestObserver.latest!.emit({ a: 0, b: 0.8, c: 0.7 });
      capturedStore.setPriority('c');
    });
    expect(host.querySelector('[data-playback-id="a"]')?.getAttribute('data-playing')).toBe('true');
    expect(host.querySelector('[data-playback-id="c"]')?.getAttribute('data-playing')).toBe('false');

    // Once scroll settles, priority card 'c' activates in one commit.
    await act(async () => {
      vi.advanceTimersByTime(SCROLL_SETTLE_MS);
    });
    expect(host.querySelector('[data-playback-id="a"]')?.getAttribute('data-playing')).toBe('false');
    expect(host.querySelector('[data-playback-id="c"]')?.getAttribute('data-playing')).toBe('true');
  });

  it('re-renders only cards whose active boolean changes and clears players immediately on tab hide', async () => {
    vi.useFakeTimers();
    const renderCounts = { parent: 0, a: 0, b: 0, c: 0 };
    let capturedStore!: TemplatePlaybackStore;

    const Card = memo(function Card({ id, store }: { id: 'a' | 'b' | 'c'; store: TemplatePlaybackStore }) {
      const playing = useTemplatePlaybackActive(store, id);
      renderCounts[id] += 1;
      return <div data-playback-id={id} data-playing={String(playing)} />;
    });

    function Gallery() {
      const scroller = useRef<HTMLDivElement>(null);
      renderCounts.parent += 1;
      const store = useTemplatePlaybackStore(scroller, 'k', true, true, false, 1);
      capturedStore = store;
      return (
        <div ref={scroller}>
          <Card id="a" store={store} />
          <Card id="b" store={store} />
          <Card id="c" store={store} />
        </div>
      );
    }

    await act(async () => {
      root.render(<Gallery />);
    });
    const scroller = host.firstElementChild as HTMLDivElement;

    await act(async () => {
      TestObserver.latest!.emit({ a: 0.9, b: 0.8, c: 0.7 });
    });
    expect(renderCounts).toEqual({ parent: 1, a: 2, b: 1, c: 1 });

    // Moving priority from 'a' to 'b' should only re-render 'a' and 'b', leaving Parent and 'c' untouched.
    await act(async () => {
      capturedStore.setPriority('b');
    });
    expect(renderCounts).toEqual({ parent: 1, a: 3, b: 2, c: 1 });
    expect(host.querySelector('[data-playback-id="b"]')?.getAttribute('data-playing')).toBe('true');

    // Hiding the document clears playback immediately even during active scrolling.
    await act(async () => {
      scroller.dispatchEvent(new Event('scroll'));
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(host.querySelector('[data-playback-id="b"]')?.getAttribute('data-playing')).toBe('false');
  });

  it('caches fetched snapshot blobs across toggles, deduplicates concurrent requests, and never caches failures', async () => {
    const okUrl = skillPreviewSnapshot + 'cached-clip.mp4';
    const failUrl = skillPreviewSnapshot + 'missing-clip.mp4';
    let objectIds = 0;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cached-${++objectIds}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    let shouldFail = true;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === failUrl && shouldFail) return new Response(null, { status: 404 });
      return new Response('video-bytes', { headers: { 'Content-Type': 'application/octet-stream' } });
    });
    vi.stubGlobal('fetch', fetcher);

    const onFailure = vi.fn();
    function PreviewHarness({ url, active }: { url: string; active: boolean }) {
      const src = useSkillPreview(url, active, onFailure);
      return <span data-src={src ?? ''} />;
    }

    // 1. Concurrent consumers share one fetch for okUrl.
    await act(async () => {
      root.render(
        <>
          <PreviewHarness url={okUrl} active />
          <PreviewHarness url={okUrl} active />
        </>,
      );
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    const spans = [...host.querySelectorAll('span')].map(el => el.getAttribute('data-src'));
    expect(spans).toEqual(['blob:cached-1', 'blob:cached-1']);

    // 2. Deactivating returns undefined, then reactivating reuses cached blob with 0 extra fetches.
    await act(async () => {
      root.render(<PreviewHarness url={okUrl} active={false} />);
    });
    expect(host.querySelector('span')?.getAttribute('data-src')).toBe('');

    await act(async () => {
      root.render(<PreviewHarness url={okUrl} active />);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(host.querySelector('span')?.getAttribute('data-src')).toBe('blob:cached-1');

    // 3. Failure calls onFailure and is not cached on retry.
    await act(async () => {
      root.render(<PreviewHarness url={failUrl} active />);
    });
    expect(onFailure).toHaveBeenCalledWith(true);
    expect(host.querySelector('span')?.getAttribute('data-src')).toBe('');

    shouldFail = false;
    await act(async () => {
      root.render(<PreviewHarness url={failUrl} active={false} />);
    });
    await act(async () => {
      root.render(<PreviewHarness url={failUrl} active />);
    });
    expect(fetcher.mock.calls.filter(([input]) => String(input) === failUrl)).toHaveLength(2);
    expect(host.querySelector('span')?.getAttribute('data-src')).toBe('blob:cached-2');
  });
});
