import { useEffect, useRef, useState } from "react";
import { onPreviewPromoted } from "../player/sceneSwap";

/** The one source for which preview is on screen: the host's iframe, then each reload promoted in its place. */
export function useLivePreviewIframe(host: HTMLIFrameElement | null): HTMLIFrameElement | null {
  const [promoted, setPromoted] = useState<{ host: WeakRef<HTMLIFrameElement>; live: HTMLIFrameElement }>();
  const live = host && promoted?.host.deref() === host ? promoted.live : host;
  const liveRef = useRef(live);
  liveRef.current = live;
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    setPromoted((current) => (current && (!host || current.host.deref() !== host) ? undefined : current));
    if (!host) return;
    return onPreviewPromoted(host.ownerDocument, ({ retired, live: next }) => {
      if (retired === liveRef.current) setPromoted({ host: new WeakRef(host), live: next });
    });
  }, [host]);
  return live;
}
