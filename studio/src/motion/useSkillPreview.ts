import { useEffect, useRef, useState } from 'react';
import { skillPreviewSnapshot } from './skillCatalog';

export const MAX_SKILL_PREVIEW_CACHE = 24;

type CachedPreview = {
  playable: string;
  activeCount: number;
};

type InFlightPreview = {
  promise: Promise<string>;
  controller: AbortController;
  consumers: number;
};

const previewCache = new Map<string, CachedPreview>();
const inFlightPreviews = new Map<string, InFlightPreview>();

function touchPreviewCache(url: string, entry: CachedPreview) {
  previewCache.delete(url);
  previewCache.set(url, entry);
  if (previewCache.size <= MAX_SKILL_PREVIEW_CACHE) return;
  for (const [candidateUrl, candidate] of previewCache) {
    if (previewCache.size <= MAX_SKILL_PREVIEW_CACHE) break;
    if (candidate.activeCount === 0) {
      previewCache.delete(candidateUrl);
      try {
        URL.revokeObjectURL(candidate.playable);
      } catch {
        /* ignore detached or simulated DOM URL errors */
      }
    }
  }
}

/** Clears cached skill preview blob URLs and aborts pending preview downloads (for tests). */
export function clearSkillPreviewCache() {
  for (const inflight of inFlightPreviews.values()) {
    inflight.controller.abort();
  }
  inFlightPreviews.clear();
  for (const entry of previewCache.values()) {
    try {
      URL.revokeObjectURL(entry.playable);
    } catch {
      /* ignore detached or simulated DOM URL errors */
    }
  }
  previewCache.clear();
}

export function useSkillPreview(url: string | undefined, active: boolean, onFailure?: (failed: boolean) => void) {
  const [source, setSource] = useState<{ original: string; playable: string }>();
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;
  const snapshot = Boolean(url?.startsWith(skillPreviewSnapshot));

  useEffect(() => {
    if (!active || !url || !snapshot) return;
    let cancelled = false;
    let heldEntry: CachedPreview | undefined;
    let holdingInFlight = false;

    const existing = previewCache.get(url);
    if (existing) {
      existing.activeCount += 1;
      touchPreviewCache(url, existing);
      heldEntry = existing;
      setSource(current =>
        current?.original === url && current.playable === existing.playable
          ? current
          : { original: url, playable: existing.playable },
      );
    } else {
      let inflight = inFlightPreviews.get(url);
      if (!inflight) {
        const controller = new AbortController();
        // GitHub Raw serves archived MP4s as octet-stream.
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
        const entry: InFlightPreview = {
          controller,
          consumers: 0,
          promise: fetch(url, { signal, credentials: 'omit', redirect: 'error' }).then(async response => {
            if (!response.ok) throw new Error('Skill preview unavailable');
            const blob = await response.blob();
            if (controller.signal.aborted) throw new Error('Skill preview aborted');
            return URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
          }),
        };
        inFlightPreviews.set(url, entry);
        inflight = entry;
      }

      inflight.consumers += 1;
      holdingInFlight = true;
      const currentInflight = inflight;

      void currentInflight.promise.then(playable => {
        if (inFlightPreviews.get(url) === currentInflight) {
          inFlightPreviews.delete(url);
        }
        if (currentInflight.controller.signal.aborted && !previewCache.has(url)) {
          try {
            URL.revokeObjectURL(playable);
          } catch {
            /* ignore */
          }
          return;
        }
        const cacheEntry = previewCache.get(url) ?? { playable, activeCount: 0 };
        if (cancelled) {
          touchPreviewCache(url, cacheEntry);
          return;
        }
        holdingInFlight = false;
        cacheEntry.activeCount += 1;
        heldEntry = cacheEntry;
        touchPreviewCache(url, cacheEntry);
        setSource({ original: url, playable: cacheEntry.playable });
      }).catch(() => {
        if (inFlightPreviews.get(url) === currentInflight) {
          inFlightPreviews.delete(url);
        }
        holdingInFlight = false;
        if (!cancelled) onFailureRef.current?.(true);
      });
    }

    return () => {
      cancelled = true;
      if (heldEntry) {
        heldEntry.activeCount = Math.max(0, heldEntry.activeCount - 1);
      }
      if (holdingInFlight) {
        holdingInFlight = false;
        const current = inFlightPreviews.get(url);
        if (current) {
          current.consumers = Math.max(0, current.consumers - 1);
          if (current.consumers === 0) {
            inFlightPreviews.delete(url);
            current.controller.abort();
          }
        }
      }
      setSource(undefined);
    };
  }, [url, snapshot, active]);

  if (!active) return undefined;
  if (!snapshot) return url;
  if (url && previewCache.has(url)) return previewCache.get(url)!.playable;
  return source?.original === url ? source?.playable : undefined;
}
