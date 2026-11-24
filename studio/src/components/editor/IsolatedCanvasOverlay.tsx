import { IsolatedCanvasContextMenu, type CanvasMenuPick } from "./IsolatedCanvasContextMenu";
import { useIsolatedInlineText } from "./useIsolatedInlineText";
import { isIsolatedSourceTarget, isolatedPatchTarget, type IsolatedSourceTarget } from "./isolatedSourceTarget";
import { usePreviewOverlayContext } from "./PreviewOverlayProvider";
import { relativeLayerBounds, useIsolatedLayerBounds, type LayerBounds } from "./useIsolatedLayerBounds";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useDomEditActionsContext } from "../../contexts/DomEditContext";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { useI18n } from "../../i18n/I18n";
import { createPreviewAdapter, type PreviewAdapter } from "../../player/lib/previewAdapter";
import { projectPreviewAdapter } from "../../player/lib/projectPreviewAdapter";
import { usePlayerStore } from "../../player/store/playerStore";
import { canvasBoxOperations, type MeasuredCanvasPosition } from "../../../../packages/edit-core/canvas-box";

interface Drag {
  pointer: number;
  gestureId: string;
  adapter: PreviewAdapter;
  startX: number;
  startY: number;
  frame: DOMRect;
  finishing: boolean;
  corner?: Corner;
  bounds?: LayerBounds;
  offset?: { x: number; y: number };
}

type Corner = "nw" | "ne" | "sw" | "se";
const corners: Corner[] = ["nw", "ne", "sw", "se"];

interface DragResult extends IsolatedSourceTarget {
  left: number;
  top: number;
  makeRelative: boolean;
  position?: MeasuredCanvasPosition;
  corner?: Corner;
  width?: number;
  height?: number;
}

interface Pick { geometry: LayerBounds; viewport: { width: number; height: number } }

function validResult(result: DragResult | null): result is DragResult {
  return isIsolatedSourceTarget(result) && Number.isFinite(result.left) && Number.isFinite(result.top);
}

function positionPatch(result: DragResult) {
  const { sourceFile, ifMatch, target } = isolatedPatchTarget(result);
  const {left, top, width, height, makeRelative, corner} = result;
  const box = {left, top, width, height, makeRelative, corner};
  return { sourceFile, ifMatch, patches: [{ target, operations:canvasBoxOperations(box) }], box, ...(result.position && {position:result.position}) };
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
  const [menu, setMenu] = useState<CanvasMenuPick | null>(null);
  const [box, setBox] = useState<LayerBounds | null>(null);
  const { state: { compositionRect } } = usePreviewOverlayContext();
  useIsolatedLayerBounds(previewIframeRef, projectId, setBox);

  const observedFrame = useRef<HTMLIFrameElement | null>(null);
  const cancel = useCallback(() => {
    const active = drag.current;
    active?.adapter.send("canvas-drag", { phase: "cancel", gestureId: active.gestureId });
    drag.current = null;
    setMenu(null);
    lastPick.current = null;
    setBox(null);
  }, []);

  useEffect(() => () => {
    observedFrame.current?.removeEventListener("load", cancel);
    observedFrame.current = null;
    cancel();
  }, [projectId, select, writeBlockedReason, cancel]);

  function showBounds(active: Drag) {
    if (!active.bounds) return;
    const x = (active.offset?.x ?? 0) / active.frame.width;
    const y = (active.offset?.y ?? 0) / active.frame.height;
    const rect = active.bounds, corner = active.corner;
    const west = corner?.endsWith("w"), north = corner?.startsWith("n");
    setBox({ x: rect.x + (corner && !west ? 0 : x), y: rect.y + (corner && !north ? 0 : y),
      width: Math.max(1 / active.frame.width, rect.width + (corner ? west ? -x : x : 0)),
      height: Math.max(1 / active.frame.height, rect.height + (corner ? north ? -y : y : 0)) });
  }

  function begin(event: PointerEvent<HTMLDivElement>) {
    const iframe = previewIframeRef.current;
    if (!iframe || drag.current || event.button !== 0 || !event.isPrimary) return;
    const adapter = projectPreviewAdapter(iframe, projectId);
    if (!adapter) return;
    const frame = iframe.getBoundingClientRect();
    const { clientX: startX, clientY: startY } = event;
    const x = (startX - frame.x) / frame.width, y = (startY - frame.y) / frame.height;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    if (observedFrame.current !== iframe) {
      observedFrame.current?.removeEventListener("load", cancel);
      observedFrame.current = iframe;
      iframe.addEventListener("load", cancel);
    }
    const corner = (event.target as HTMLElement).closest<HTMLElement>("[data-resize-corner]")?.dataset.resizeCorner as Corner | undefined;
    const active: Drag = { corner, pointer: event.pointerId, gestureId: crypto.randomUUID(), adapter, frame, startX, startY, finishing: false };
    drag.current = lastPick.current = active;
    setBox(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    void adapter.request<Pick | null>("canvas-drag", { phase: "start", gestureId: active.gestureId, x, y, corner })
      .then(pick => {
        if (lastPick.current !== active || !pick) return;
        const bounds = relativeLayerBounds(pick);
        if (!bounds) return;
        active.bounds = bounds;
        showBounds(active);
      }).catch(() => { if (drag.current === active) setBox(null); });
  }

  function update(event: PointerEvent<HTMLDivElement>, phase: "move" | "finish" | "cancel") {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId || active.finishing) return;
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
    const payload = { phase, dx: dx / active.frame.width, dy: dy / active.frame.height, gestureId: active.gestureId };
    if (phase !== "cancel" && (active.offset || Math.hypot(dx, dy) >= 3)) {
      active.offset = { x: dx, y: dy };
      showBounds(active);
    }
    if (phase === "move") {
      if (active.offset) active.adapter.send("canvas-drag", payload);
      return;
    }
    if (phase === "cancel" || !active.offset) {
      if (phase === "cancel") { setBox(null); lastPick.current = null; }
      active.adapter.send("canvas-drag", { ...payload, phase: "cancel" });
      drag.current = null;
      return;
    }
    active.finishing = true;
    let committed = false;
    let changed = false;
    const wholePath = event.altKey || !usePlayerStore.getState().autoKeyframeEnabled;
    void active.adapter.request<DragResult | null>("canvas-drag", { ...payload, wholePath }).then(async result => {
      if (drag.current !== active || previewIframeRef.current !== active.adapter.iframe) return;
      if (createPreviewAdapter({ iframe: active.adapter.iframe }).token !== active.adapter.token) return;
      if (!validResult(result) || result.corner !== active.corner || (active.corner &&
        !(Number.isFinite(result.width) && Number.isFinite(result.height) && result.width! > 0 && result.height! > 0))) return;
      // The scoped frame holds the optimistic styles until this write settles.
      // Pointer capture can now serve another source file.
      drag.current = null;
      const saved = await commitDomEditPatchBatches([positionPatch(result)], { label: active.corner ? "Resize layer" : "Move layer", coalesceKey: active.gestureId });
      committed = saved.durable;
      changed = saved.changed;
    }, () => { if (drag.current === active) showToast(t("Preview unavailable"), "error"); }).catch(() => {
      // The shared save queue reports the error and reloads the authoritative preview.
    }).finally(() => {
      active.adapter.send("canvas-drag", { phase: committed ? "commit" : "cancel", changed, gestureId: active.gestureId });
      if (drag.current === active) drag.current = null;
      if (!committed && lastPick.current === active) {
        lastPick.current = null;
        setBox(null);
      }
    });
  }

  if (!select || writeBlockedReason) return null;
  return <div className="absolute inset-0 z-10 touch-none pointer-events-auto" aria-label={t("Composition canvas")}
    style={text.editing ? { pointerEvents: "none" } : undefined} onDoubleClick={text.open}
    onContextMenu={event => {
      event.preventDefault();
      const iframe = previewIframeRef.current;
      if (!iframe || !projectId) return;
      const adapter = projectPreviewAdapter(iframe, projectId);
      if (!adapter) return;
      const frame = iframe.getBoundingClientRect();
      setMenu({ adapter, x: (event.clientX - frame.x) / frame.width, y: (event.clientY - frame.y) / frame.height,
        screenX: event.clientX, screenY: event.clientY });
    }}
    onPointerDown={begin} onPointerMove={event => update(event, "move")}
    onPointerUp={event => update(event, "finish")} onPointerCancel={event => update(event, "cancel")}
    onLostPointerCapture={event => update(event, "cancel")}>
    {menu && <IsolatedCanvasContextMenu pick={menu} close={() => setMenu(null)} />}
    {box && compositionRect.width > 0 && compositionRect.height > 0 && <div className="absolute pointer-events-none border border-studio-accent"
      style={{ left: compositionRect.left + box.x * compositionRect.width,
        top: compositionRect.top + box.y * compositionRect.height,
        width: box.width * compositionRect.width, height: box.height * compositionRect.height }}>
      {corners.map(corner => <span key={corner} data-resize-corner={corner} aria-label={t("Resize layer")}
        className="absolute size-2 rounded-sm border border-studio-accent bg-white pointer-events-auto"
        style={{ left: corner.endsWith("w") ? 0 : "100%", top: corner.startsWith("n") ? 0 : "100%",
          transform: "translate(-50%, -50%)", cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }} />)}
    </div>}
  </div>;
}
