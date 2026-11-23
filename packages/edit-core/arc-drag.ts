import type { GsapAnimation, GsapPercentageKeyframe } from "@hyperframes/core/gsap-parser";
import { resolveTweenStart, resolveTweenDuration, KEYFRAME_PCT_MATCH } from "./playhead-edit.ts";
import { runEaseOf, timeAtProgress, progressAtTime } from "./keyframe-eases.ts";

const roundTo3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The tween's keyframes with one inserted at `percentage`. Any existing keyframe
 * within {@link KEYFRAME_PCT_MATCH} of the insert is REPLACED, not kept: the
 * server takes a replace-with-keyframes list verbatim, so an append-only build
 * could hand it two keyframes a fraction of a percent apart. The invariant lives
 * here rather than in each caller's own pre-check, which is how the two callers
 * ended up with different tolerances in the first place. Arc writes are linear, so each
 * keyframe moves to the time GSAP reached it and `percentage` is a time percentage.
 */
export function buildTemporalArcKeyframes(
  anim: GsapAnimation,
  percentage: number,
  properties: Record<string, number>,
) {
  return [
    ...linearArcKeyframes(anim)
      .filter((keyframe) => Math.abs(keyframe.percentage - percentage) > KEYFRAME_PCT_MATCH)
      .map((keyframe) => ({
        percentage: keyframe.percentage,
        properties: { ...keyframe.properties },
        ...(keyframe.ease ? { ease: keyframe.ease } : {}),
      })),
    { percentage, properties },
  ].sort((a, b) => a.percentage - b.percentage);
}

/** An arc's keyframes at the time percentages GSAP plays them, for a write with `ease: "none"`. */
export function linearArcKeyframes(anim: GsapAnimation): GsapPercentageKeyframe[] {
  const runEase = runEaseOf(anim);
  return (anim.keyframes?.keyframes ?? []).map((keyframe) => ({
    ...keyframe,
    percentage: roundTo3(timeAtProgress(runEase, keyframe.percentage)),
  }));
}

/** Grow a keyframe tween's range to a playhead outside it and add a keyframe there; every
 *  existing keyframe keeps its absolute time under `writeEase`, the run ease the write keeps. */
export function buildExtendedKeyframes(
  anim: GsapAnimation,
  currentTime: number,
  position: Record<string, number>,
  sourceDuration = resolveTweenDuration(anim),
  writeEase = runEaseOf(anim),
): { position: number; duration: number; keyframes: GsapPercentageKeyframe[] } {
  const oldStart = resolveTweenStart(anim) ?? 0;
  const oldDuration = sourceDuration;
  const newStart = Math.min(oldStart, currentTime);
  const newEnd = Math.max(oldStart + oldDuration, currentTime);
  const newDuration = roundTo3(newEnd - newStart);
  const oldRunEase = runEaseOf(anim);
  const toPct = (absoluteTime: number) => {
    if (newDuration <= 0) return 0;
    const progress = progressAtTime(writeEase, ((absoluteTime - newStart) / newDuration) * 100);
    return Math.max(0, Math.min(100, Math.round(progress * 10) / 10));
  };
  const stops = anim.keyframes?.keyframes ?? [];
  const rescaled: GsapPercentageKeyframe[] = stops.map((stop) => ({
    percentage: toPct(oldStart + (timeAtProgress(oldRunEase, stop.percentage) / 100) * oldDuration),
    properties: stop.properties,
    ...(stop.ease ? { ease: stop.ease } : {}),
  }));
  const added: GsapPercentageKeyframe = {
    percentage: toPct(currentTime),
    properties: position,
  };
  const keyframes = [...rescaled, added].sort((a, b) => a.percentage - b.percentage);
  return { position: roundTo3(newStart), duration: newDuration, keyframes };
}

/** Compute one path edit against authored composition time. Explicit waypoints keep their identity. */
export function planArcDrag(
  anim: GsapAnimation,
  time: number,
  xy: { x: number; y: number },
  percentage?: number,
  explicitPoint = false,
) {
  const start = resolveTweenStart(anim);
  const duration = resolveTweenDuration(anim);
  if (start === null || duration <= 0) return null;
  const base = {
    type: "replace-with-keyframes",
    animationId: anim.id,
    targetSelector: anim.targetSelector,
    ease: "none",
  };
  if (!explicitPoint && (time < start || time > start + duration)) {
    return {
      ...base,
      ...buildExtendedKeyframes(anim, time, xy, duration, "none"),
    };
  }
  const ease = runEaseOf(anim);
  const pct = percentage ?? progressAtTime(ease, ((time - start) / duration) * 100);
  const elapsed = timeAtProgress(ease, pct);
  const frames = anim.keyframes?.keyframes ?? [];
  const index = frames.findIndex(
    (k) => Math.abs(timeAtProgress(ease, k.percentage) - elapsed) <= KEYFRAME_PCT_MATCH,
  );
  if (index >= 0)
    return {
      type: "update-motion-path-point",
      animationId: anim.id,
      pointIndex: index,
      ...xy,
    };
  if (frames.length < 2) return null;
  return {
    ...base,
    position: roundTo3(start),
    duration: roundTo3(duration),
    keyframes: buildTemporalArcKeyframes(anim, roundTo3(elapsed), xy),
  };
}
