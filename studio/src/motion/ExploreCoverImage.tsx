import { useState, type CSSProperties } from 'react';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';

export function ExploreCoverImage({ src, position, eager }: { src?: string; position?: CSSProperties['objectPosition']; eager?: boolean }) {
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const loaded = Boolean(src && loadedSrc === src);
  return <>
    {!loaded && <CoverPlaceholder fill />}
    {src && <img src={src} style={{ objectPosition: position, opacity: loaded ? undefined : 0 }}
      loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined}
      decoding={eager ? 'sync' : 'async'} alt=""
      onLoad={() => setLoadedSrc(src)} onError={() => setLoadedSrc(undefined)} />}
  </>;
}
