import { getCachedCloudDisklessMode } from "../utils/cloudRuntime";
import {
  planAuthoredAnimatedValues,
  planValueAtPlayhead,
  type PlayheadEditPlan,
  type PlayheadEdit,
  type PlayheadSamples,
} from "../../../packages/edit-core/playhead-edit";
export {
  planValueAtPlayhead,
  type PlayheadEditPlan,
  type PlayheadEdit,
  type ImplicitEndValue,
} from "../../../packages/edit-core/playhead-edit";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import type { EditMoment } from "../components/editor/manualEditsTypes";
import { editMoment, playheadMoment } from "./editMoment";
import { materializeIfDynamic, parkPlayheadOnKeyframe, type GsapDragCommitCallbacks } from "./gsapDragCommit";
import type { GsapEditOutcome } from "./gsapEditOutcome";
import {
  exactKeyframePct,
  findParsedTween,
  parsedImplicitEndValue,
  parsedTweenEase,
  withExactStepTimes,
  withLiveTiming,
} from "./gsapParsedTween";
import { tweenReach } from "./gsapTweenReach";

/** commitValueAtPlayhead's plan, writing nothing, so a group can plan every member first. */
export function planValueEdit(
  selection: DomEditSelection,
  anim: GsapAnimation,
  values: Record<string, number>,
  iframe: HTMLIFrameElement | null,
  {
    backfill,
    holdFromStart,
    moment = playheadMoment(),
    samples,
  }: Pick<PlayheadEdit, "backfill" | "holdFromStart"> & {
    moment?: EditMoment;
    samples?: PlayheadSamples;
  } = {},
): PlayheadEditPlan {
  // One keyframe of a tween its siblings share would move them all.
  if (tweenReach(anim, selection.element) === "shared") return { ok: false, reason: "shared-tween" };
  const { keyframePct: activeKeyframePct, time: currentTime } = moment;
  const tween = findParsedTween(iframe, selection.element, anim);
  const timed = withExactStepTimes(anim, tween);
  const endpoint = parsedImplicitEndValue(tween);
  const ease = parsedTweenEase(iframe, tween);
  if (samples && ease) samples.ease = ease;
  return planValueAtPlayhead({
    anim: withLiveTiming(timed, tween),
    at:
      activeKeyframePct != null
        ? { percentage: exactKeyframePct(anim, tween, activeKeyframePct) }
        : { time: currentTime },
    values,
    backfill,
    holdFromStart,
    implicitEndValue: (property, side) => {
      const value = endpoint(property, side);
      if (samples && value != null) (samples[side] ??= {})[property] = value;
      return value;
    },
    parsedEase: ease,
  });
}

/** Writes `values` into `anim` at the playhead (or the keyframe selected in the lane). */
export async function commitValueAtPlayhead(
  selection: DomEditSelection,
  anim: GsapAnimation,
  values: Record<string, number>,
  iframe: HTMLIFrameElement | null,
  callbacks: GsapDragCommitCallbacks,
  options: Pick<PlayheadEdit, "backfill" | "holdFromStart"> & {
    label: string;
    beforeReload?: () => void;
  },
): Promise<GsapEditOutcome> {
  await materializeIfDynamic(anim, iframe, callbacks.commitMutation, selection);
  const moment = editMoment(callbacks.stamp);
  const { setActiveKeyframePct } = usePlayerStore.getState();
  const tween = findParsedTween(iframe, selection.element, anim);
  const parkAt = moment.keyframePct == null ? null : exactKeyframePct(anim, tween, moment.keyframePct);
  const samples: PlayheadSamples | undefined = getCachedCloudDisklessMode()
    ? { backfill: options.backfill, holdFromStart: options.holdFromStart }
    : undefined;
  const plan = planValueEdit(selection, anim, values, iframe, { ...options, moment, samples });
  if (!plan.ok) return { status: "blocked", reason: "keyframes-uneditable", detail: plan.reason };
  const at = parkAt == null ? { time: moment.time } : { percentage: parkAt };
  // Send just the gesture for authored tweens. A runtime-dependent tween also carries
  // the endpoint/ease values the planner actually requested, never the whole preview.
  let mutation: Record<string, unknown> = plan.mutation;
  if (samples) {
    const expected = JSON.stringify(plan.mutation);
    const matches = (other: PlayheadEditPlan) => other.ok && JSON.stringify(other.mutation) === expected;
    const authored = matches(planAuthoredAnimatedValues(anim, at, values));
    if (authored || matches(planAuthoredAnimatedValues(anim, at, values, samples))) {
      mutation = {
        type: "set-animated-values",
        animationId: anim.id,
        at,
        values,
        ...(!authored && { samples }),
      };
    }
  }
  await callbacks.commitMutation(selection, mutation, {
    label: options.label,
    softReload: true,
    beforeReload: options.beforeReload,
    ...(plan.added && { keyframeAction: "add" as const }),
  });
  if (parkAt != null) {
    setActiveKeyframePct(null);
    parkPlayheadOnKeyframe(anim, parkAt);
  }
  return { status: "persisted" };
}
