import { planArcDrag } from "../../../packages/edit-core/arc-drag";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import {
  computeDraggedGsapPosition,
  readDragStamp,
  restoreDragOffset,
} from "./draggedGsapPosition";
import {
  type GsapDragCommitCallbacks,
  computeCurrentPercentage,
  parkPlayheadOnKeyframe,
} from "./gsapDragCommit";
import type { GsapEditOutcome } from "./gsapEditOutcome";
import { commitValueAtPlayhead, planValueEdit } from "./gsapValueAtPlayhead";
import { editMoment } from "./editMoment";
import type { EditMoment } from "../components/editor/manualEditsTypes";

export { buildExtendedKeyframes, linearArcKeyframes, buildTemporalArcKeyframes } from "../../../packages/edit-core/arc-drag";
/** commitGsapPositionFromDrag's refusal, decided without writing. */
export function gsapPositionFromDragOutcome(
  selection: DomEditSelection,
  anim: GsapAnimation,
  studioOffset: { x: number; y: number },
  gsapPos: { x: number; y: number },
  iframe: HTMLIFrameElement | null,
  moment?: EditMoment,
): GsapEditOutcome {
  if (anim.arcPath?.enabled) return { status: "persisted" };
  const { newX, newY, baseGsapX, baseGsapY } = computeDraggedGsapPosition(
    selection.element,
    studioOffset,
    gsapPos,
  );
  const plan = planValueEdit(selection, anim, { x: newX, y: newY }, iframe, {
    backfill: { x: baseGsapX, y: baseGsapY },
    moment,
  });
  return plan.ok
    ? { status: "persisted" }
    : { status: "blocked", reason: "keyframes-uneditable", detail: plan.reason };
}

// fallow-ignore-next-line code-duplication
// fallow-ignore-next-line complexity
export async function commitGsapPositionFromDrag(
  selection: DomEditSelection,
  anim: GsapAnimation,
  studioOffset: { x: number; y: number },
  gsapPos: { x: number; y: number },
  iframe: HTMLIFrameElement | null,
  callbacks: GsapDragCommitCallbacks,
): Promise<GsapEditOutcome> {
  const el = selection.element;
  const stamp = callbacks.stamp ?? readDragStamp(el);
  // fallow-ignore-next-line code-duplication
  const { newX, newY, baseGsapX, baseGsapY } = computeDraggedGsapPosition(
    el,
    studioOffset,
    gsapPos,
    stamp,
  );
  const restoreOffset = () => restoreDragOffset(el, stamp);

  if (anim.arcPath?.enabled) {
    const { keyframePct: activeKeyframePct, time: currentTime } = editMoment(stamp);
    const { setActiveKeyframePct } = usePlayerStore.getState();
    const pct = activeKeyframePct ?? computeCurrentPercentage(selection, anim, currentTime);
    const mutation = planArcDrag(anim, currentTime, {x:newX,y:newY}, pct, activeKeyframePct !== null);
    if (!mutation) return {status:"persisted"};
    const waypoint = mutation.type === "update-motion-path-point";
    await callbacks.commitMutation(selection, mutation, {
      label: waypoint ? "Move layer (waypoint)" : "Move layer (new keyframe)",
      ...(!waypoint && {keyframeAction:"add" as const}),
      softReload:true,
      beforeReload:restoreOffset,
    });
    if (waypoint) {
      setActiveKeyframePct(null);
      parkPlayheadOnKeyframe(anim,pct);
    }
    return { status: "persisted" };
  }
  return commitValueAtPlayhead(
    selection,
    anim,
    { x: newX, y: newY },
    iframe,
    { ...callbacks, stamp },
    {
      label: "Move layer",
      backfill: { x: baseGsapX, y: baseGsapY },
      beforeReload: restoreOffset,
    },
  );
}
