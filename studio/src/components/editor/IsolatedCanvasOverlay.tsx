import { useIsolatedInlineText } from "./useIsolatedInlineText";
import { isIsolatedSourceTarget, isolatedPatchTarget, type IsolatedSourceTarget } from "./isolatedSourceTarget";
import { useIsolatedLayerBounds } from "./useIsolatedLayerBounds";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useDomEditActionsContext } from "../../contexts/DomEditContext";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { useI18n } from "../../i18n/I18n";
import { createPreviewAdapter, type PreviewAdapter } from "../../player/lib/previewAdapter";
import { isolatedPreviewOrigin } from "../../player/lib/previewLease";
import { usePlayerStore } from "../../player/store/playerStore";
import type { PatchOperation } from "../../utils/sourcePatcher";

interface Drag {
  pointer: number;
  gestureId: string;
  adapter: PreviewAdapter;
  startX: number;
  startY: number;
  frame: DOMRect;
  moved: boolean;
  finishing: boolean;
  bounds?: Box;
}

interface DragResult extends IsolatedSourceTarget {
  left: number;
  top: number;
  makeRelative: boolean;
}

type Box = { x: number; y: number; width: number; height: number };
interface Pick { geometry: Box; viewport: { width: number; height: number } }

function validResult(result: DragResult | null): result is DragResult {
  return isIsolatedSourceTarget(result) && Number.isFinite(result.left) && Number.isFinite(result.top);
}

function positionPatch(result: DragResult) {
  const operations: PatchOperation[] = [];
  if (result.makeRelative === true) {
    operations.push({ type: "inline-style", property: "position", value: "relative" });
  }
  operations.push(
    { type: "inline-style", property: "left", value: result.left + "px" },
    { type: "inline-style", property: "top", value: result.top + "px" },
  );
  const { sourceFile, ifMatch, target } = isolatedPatchTarget(result);
  return { sourceFile, ifMatch, patches: [{ target, operations }] };
}

/** Input and persistence stay in Studio. The scoped frame only measures and previews layout. */
export function IsolatedCanvasOverlay() {
  const { t } = useI18n();
  const { commitDomEditPatchBatches } = useDomEditActionsContext();
  const { previewIframeRef, projectId, showToast, writeBlockedReason } = useStudioShellContext();
  const select = usePlayerStore(state => state.activeTool === "select");
  const text = useIsolatedInlineText(previewIframeRef, projectId, select && !writeBlockedReason);
  const drag = useRef<Drag | null>(null);
  const lastPick = useRef<Drag | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const overlay = useIsolatedLayerBounds(previewIframeRef, projectId, setBox);

  const observedFrame = useRef<HTMLIFrameElement | null>(null);
  const cancel = useCallback(() => {
    const active = drag.current;
    active?.adapter.send("canvas-drag", { phase: "cancel", gestureId: active.gestureId });
    drag.current = null;
    lastPick.current = null;
    setBox(null);
  }, []);

  useEffect(() => () => {
    observedFrame.current?.removeEventListener("load", cancel);
    observedFrame.current = null;
    cancel();
  }, [projectId, select, writeBlockedReason, cancel]);

  function begin(event: PointerEvent<HTMLDivElement>) {
    const iframe = previewIframeRef.current;
    if (!iframe || drag.current || event.button !== 0 || !event.isPrimary) return;
    const adapter = createPreviewAdapter({ iframe });
    if (adapter.projectId !== projectId || !adapter.token || adapter.targetOrigin !== isolatedPreviewOrigin()) return;
    const frame = iframe.getBoundingClientRect();
    const { clientX: startX, clientY: startY } = event;
    const x = (startX - frame.x) / frame.width, y = (startY - frame.y) / frame.height;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    if (observedFrame.current !== iframe) {
      observedFrame.current?.removeEventListener("load", cancel);
      observedFrame.current = iframe;
      iframe.addEventListener("load", cancel);
    }
    const active: Drag = { pointer: event.pointerId, gestureId: crypto.randomUUID(), adapter, frame, startX, startY, moved: false, finishing: false };
    drag.current = lastPick.current = active;
    setBox(null);
    const overlay = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    void adapter.request<Pick | null>("canvas-drag", { phase: "start", gestureId: active.gestureId, x, y })
      .then(pick => {
        if (lastPick.current !== active || !pick?.geometry || !pick.viewport?.width || !pick.viewport.height) return;
        const sx = frame.width / pick.viewport.width, sy = frame.height / pick.viewport.height;
        active.bounds = { x: frame.x - overlay.x + pick.geometry.x * sx, y: frame.y - overlay.y + pick.geometry.y * sy,
          width: pick.geometry.width * sx, height: pick.geometry.height * sy };
        if (!active.moved) setBox(active.bounds);
      }).catch(() => { if (drag.current === active) setBox(null); });
  }

  function update(event: PointerEvent<HTMLDivElement>, phase: "move" | "finish" | "cancel") {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId || active.finishing) return;
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) >= 3) active.moved = true;
    const payload = { phase, dx: dx / active.frame.width, dy: dy / active.frame.height, gestureId: active.gestureId };
    if (phase === "move") {
      if (active.moved) {
        if (active.bounds) setBox({ ...active.bounds, x: active.bounds.x + dx, y: active.bounds.y + dy });
        active.adapter.send("canvas-drag", payload);
      }
      return;
    }
    if (phase === "cancel" || !active.moved) {
      if (phase === "cancel") { setBox(null); lastPick.current = null; }
      active.adapter.send("canvas-drag", { ...payload, phase: "cancel" });
      drag.current = null;
      return;
    }
    active.finishing = true;
    void active.adapter.request<DragResult | null>("canvas-drag", payload).then(async result => {
      if (drag.current !== active || previewIframeRef.current !== active.adapter.iframe) return;
      if (createPreviewAdapter({ iframe: active.adapter.iframe }).token !== active.adapter.token) return;
      if (!validResult(result)) {
        setBox(null);
        return;
      }
      await commitDomEditPatchBatches([positionPatch(result)], { label: "Move layer", coalesceKey: active.gestureId });
    }, () => showToast(t("Preview unavailable"), "error")).catch(() => {
      // The shared save queue reports the error and reloads the authoritative preview.
    }).finally(() => { if (drag.current === active) drag.current = null; });
  }

  if (!select || writeBlockedReason) return null;
  return <div ref={overlay} className="absolute inset-0 z-10 touch-none pointer-events-auto" aria-label={t("Composition canvas")}
    style={text.editing ? { pointerEvents: "none" } : undefined} onDoubleClick={text.open}
    onPointerDown={begin} onPointerMove={event => update(event, "move")}
    onPointerUp={event => update(event, "finish")} onPointerCancel={event => update(event, "cancel")}
    onLostPointerCapture={event => update(event, "cancel")}>
    {box && <div className="absolute pointer-events-none border border-studio-accent"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />}
  </div>;
}
