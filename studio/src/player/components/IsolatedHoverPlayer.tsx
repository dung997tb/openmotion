import { useCallback, useEffect, useRef } from "react";
import { createPreviewAdapter } from "../lib/previewAdapter";
import { setPreviewMediaMuted } from "../lib/timelineIframeHelpers";
import { IsolatedPlayer } from "./IsolatedPlayer";

/** A passive frame has its own lease and never drives the editor transport. A supplied
 * time selects a paused frame. Composition cards play silently while hovered. */
export function IsolatedHoverPlayer({ source, origin, time, onReady, onError }: {
  source: string;
  origin: string;
  time?: number;
  onReady: (ready: boolean) => void;
  onError: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(false);
  const seek = useCallback(() => {
    if (!frame.current || time === undefined || !loaded.current) return;
    createPreviewAdapter({ iframe: frame.current, expectedOrigin: origin })
      .send("playback-control", { action: "seek", time });
  }, [origin, time]);
  useEffect(seek, [seek]);

  return <IsolatedPlayer ref={frame} passive origin={origin} directUrl={source}
    onLoad={() => {
      if (!frame.current) return;
      loaded.current = true;
      setPreviewMediaMuted(frame.current, true);
      createPreviewAdapter({ iframe: frame.current, expectedOrigin: origin })
        .send("playback-control", { action: time === undefined ? "play" : "pause" });
      seek();
    }}
    onReadyToShowChange={ready => {
      if (!ready) loaded.current = false;
      onReady(ready);
    }}
    onPreviewError={() => { loaded.current = false; onError(); }}
  />;
}
