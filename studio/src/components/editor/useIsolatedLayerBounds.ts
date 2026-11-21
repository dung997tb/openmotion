import { useEffect, useRef, type RefObject } from "react";
import { createPreviewAdapter } from "../../player/lib/previewAdapter";
import { isolatedPreviewOrigin } from "../../player/lib/previewLease";
import { useLivePreviewIframe } from "../../player/store/previewIframeStore";

interface Box { x: number; y: number; width: number; height: number }

/** Project the selected child-frame rectangle into Studio's scaled preview viewport. */
export function useIsolatedLayerBounds(iframeRef: RefObject<HTMLIFrameElement | null>, projectId: string | null,
  setBox: (box: Box | null) => void) {
  const overlay = useRef<HTMLDivElement>(null);
  const live = useLivePreviewIframe();
  useEffect(() => {
    setBox(null);
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== "select-element" || typeof event.data.layerKey !== "string") return;
      const iframe = iframeRef.current;
      if (!iframe || !overlay.current) return;
      const adapter = createPreviewAdapter({ iframe });
      if (adapter.projectId !== projectId || adapter.targetOrigin !== isolatedPreviewOrigin() || !adapter.accepts(event)) return;
      const { geometry, viewport } = event.data.selection ?? {};
      if (!geometry || !viewport || ![geometry.x, geometry.y, geometry.width, geometry.height, viewport.width,
        viewport.height].every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0) return;
      const frame = iframe.getBoundingClientRect(), container = overlay.current.getBoundingClientRect();
      const sx = frame.width / viewport.width, sy = frame.height / viewport.height;
      setBox({ x: frame.x - container.x + geometry.x * sx, y: frame.y - container.y + geometry.y * sy,
        width: geometry.width * sx, height: geometry.height * sy });
    };
    const clear = () => setBox(null);
    const iframe = iframeRef.current;
    iframe?.addEventListener("load", clear);
    window.addEventListener("message", receive);
    return () => {
      iframe?.removeEventListener("load", clear);
      window.removeEventListener("message", receive);
    };
  }, [iframeRef, projectId, setBox, live]);
  return overlay;
}
