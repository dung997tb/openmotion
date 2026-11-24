import { useEffect, type RefObject } from "react";
import { createPreviewAdapter } from "../../player/lib/previewAdapter";
import { isolatedPreviewOrigin } from "../../player/lib/previewLease";
import { useLivePreviewIframe } from "../../player/store/previewIframeStore";

export interface LayerBounds { x: number; y: number; width: number; height: number }

/** Bounds in fractions of the preview document. Studio's layout may change after a pick. */
export function relativeLayerBounds(selection?: { geometry?: LayerBounds; viewport?: { width: number; height: number } }) {
  const { geometry, viewport } = selection ?? {};
  if (!geometry || !viewport || ![geometry.x, geometry.y, geometry.width, geometry.height, viewport.width,
    viewport.height].every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0) return null;
  return { x: geometry.x / viewport.width, y: geometry.y / viewport.height,
    width: geometry.width / viewport.width, height: geometry.height / viewport.height };
}

export function useIsolatedLayerBounds(iframeRef: RefObject<HTMLIFrameElement | null>, projectId: string | null,
  setBox: (box: LayerBounds | null) => void) {
  const live = useLivePreviewIframe();
  useEffect(() => {
    setBox(null);
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== "select-element" || typeof event.data.layerKey !== "string") return;
      const iframe = iframeRef.current;
      if (!iframe) return;
      const adapter = createPreviewAdapter({ iframe });
      if (adapter.projectId !== projectId || adapter.targetOrigin !== isolatedPreviewOrigin() || !adapter.accepts(event)) return;
      const bounds = relativeLayerBounds(event.data.selection);
      if (bounds) setBox(bounds);
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
}
