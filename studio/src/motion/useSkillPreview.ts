import { useEffect, useState } from 'react';
import { skillPreviewSnapshot } from './skillCatalog';

const MAX_CACHED_PREVIEWS = 12;
const blobCacheByFetch = new WeakMap<typeof fetch, Map<string, Promise<Blob>>>();

function getPreviewBlobCache(fetcher: typeof fetch): Map<string, Promise<Blob>> {
  let cache = blobCacheByFetch.get(fetcher);
  if (!cache) {
    cache = new Map();
    blobCacheByFetch.set(fetcher, cache);
  }
  return cache;
}

function fetchSkillPreviewBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const fetcher = globalThis.fetch;
  const cache = getPreviewBlobCache(fetcher);
  const existing = cache.get(url);
  if (existing) {
    cache.delete(url);
    cache.set(url, existing);
    return existing;
  }

  // GitHub Raw serves archived MP4s as octet-stream.
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const promise = fetcher(url, { signal: requestSignal, credentials: 'omit', redirect: 'error' })
    .then(async response => {
      if (!response.ok) throw new Error('Skill preview unavailable');
      const blob = await response.blob();
      return new Blob([blob], { type: 'video/mp4' });
    })
    .catch(error => {
      cache.delete(url);
      throw error;
    });

  if (cache.size >= MAX_CACHED_PREVIEWS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, promise);
  return promise;
}

export function useSkillPreview(url: string | undefined, active: boolean, onFailure?: (failed: boolean) => void) {
  const [source, setSource] = useState<{ original: string; playable: string }>();
  const snapshot = url?.startsWith(skillPreviewSnapshot);
  useEffect(() => {
    if (!active || !url || !snapshot) return;
    const controller = new AbortController();
    let playable: string | undefined;
    void fetchSkillPreviewBlob(url, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      playable = URL.createObjectURL(blob);
      setSource({ original: url, playable });
    }).catch(() => { if (!controller.signal.aborted) onFailure?.(true); });
    return () => {
      controller.abort();
      if (playable) URL.revokeObjectURL(playable);
      setSource(undefined);
    };
  }, [url, snapshot, active, onFailure]);
  if (!active) return undefined;
  if (!snapshot) return url;
  return source?.original === url ? source?.playable : undefined;
}
