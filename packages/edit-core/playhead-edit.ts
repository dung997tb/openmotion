import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { GSAP_DEFAULT_DURATION } from "@hyperframes/parsers/gsap-parser";
import { isTweenConfigKey } from "@hyperframes/parsers/gsap-constants";

export const KEYFRAME_PCT_MATCH = 1;
export type PlayheadEditRefusal =
  | "eased-keyframes"
  | "simple-array-keyframes"
  | "array-step-delay"
  | "array-step-callback"
  | "array-step-config"
  | "array-step-computed"
  | "array-step-relative"
  | "array-step-random"
  | "unknown-ease"
  | "implicit-end-unknown"
  | "not-a-tween"
  | "no-timing"
  | "shared-tween";

// GSAP 3.15 defaults: a percentage keyframe eases its segment power1.inOut; an array step is linear.
export const PERCENTAGE_SEGMENT_EASE = "power1.inOut";
export const ARRAY_STEP_EASE = "none";
// A motionPath tween is a plain tween to GSAP, so it runs GSAP's default tween ease.
export const MOTION_PATH_RUN_EASE = "power1.out";

/** `run` warps a keyframed tween's whole progress; a segment eases with the keyframe it arrives
 *  at, else easeEach, else GSAP's default for the form. A flat tween has no run ease. */
export function keyframedTweenEases(anim: GsapAnimation): {
  run?: string;
  segment: (arriving: { ease?: string }) => string;
} {
  const data = anim.keyframes;
  const fallback =
    data?.format === "object-array" ? ARRAY_STEP_EASE : (data?.easeEach ?? PERCENTAGE_SEGMENT_EASE);
  return {
    run: data
      ? (data.ease ?? anim.ease ?? (data.fromMotionPath ? MOTION_PATH_RUN_EASE : undefined))
      : undefined,
    segment: (arriving) => arriving.ease ?? fallback,
  };
}

/** Why a percentage keyframe can't stand in for this array step entry, or null when it can. */
function stepBlock([key, value]: [string, number | string]): PlayheadEditRefusal | null {
  if (key === "delay") return "array-step-delay";
  if (/^on[A-Z]/.test(key)) return "array-step-callback";
  if (isTweenConfigKey(key)) return "array-step-config";
  if (typeof value === "number") return null;
  return STEP_VALUE_BLOCKS.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

/** First match wins: code is computed, even when it calls random(). */
const STEP_VALUE_BLOCKS: Array<[RegExp, PlayheadEditRefusal]> = [
  [/^__raw:/, "array-step-computed"],
  [/random\(/, "array-step-random"],
  [/[-+*/]=/, "array-step-relative"],
];

/** Why a step list can't be rewritten as percentage keyframes, or null. */
export function stepListBlock(anim: GsapAnimation): PlayheadEditRefusal | null {
  const data = anim.keyframes;
  if (data?.format !== "object-array") return null;
  const entries = data.keyframes.flatMap((kf) => Object.entries(kf.properties));
  return entries.map(stepBlock).find(Boolean) ?? null;
}

export function nearestKeyframeIndex(keyframes: { percentage: number }[], pct: number): number {
  let best = -1;
  keyframes.forEach((kf, i) => {
    const off = Math.abs(kf.percentage - pct);
    if (
      off <= KEYFRAME_PCT_MATCH &&
      (best < 0 || off < Math.abs(keyframes[best]!.percentage - pct))
    )
      best = i;
  });
  return best;
}

export function resolveTweenStart(animation: GsapAnimation): number | null {
  if (animation.resolvedStart != null) return animation.resolvedStart;
  if (typeof animation.position === "number") return animation.position;
  const parsed = Number.parseFloat(animation.position as string);
  if (!Number.isNaN(parsed)) return parsed;
  return null;
}

export function resolveTweenDuration(animation: GsapAnimation): number {
  return animation.duration ?? GSAP_DEFAULT_DURATION;
}

type Props = Record<string, number | string>;
interface Keyframe {
  percentage: number;
  properties: Props;
  ease?: string;
  auto?: boolean;
}

/** A tween's un-animated value of `prop` at its start or end, from GSAP's own parse; null when unknown. */
export type ImplicitEndValue = (prop: string, end: "start" | "end") => number | null;

export interface PlayheadEdit {
  anim: GsapAnimation;
  /** The playhead's composition time, or a keyframe the user selected in the lane. */
  at: { time: number } | { percentage: number };
  /** Every channel here must already be animated by `anim`. */
  values: Record<string, number>;
  implicitEndValue: ImplicitEndValue;
  /** The flat tween's ease as GSAP resolved it, for a tween that authors none. */
  parsedEase?: string | null;
  /** A channel of the edit the tween does not animate yet, held at this value on its keyframes. */
  backfill?: Record<string, number>;
  /** Hold the backfill from the tween's start too, where GSAP would otherwise begin at the old value. */
  holdFromStart?: boolean;
}

export type PlayheadEditPlan =
  | {
      ok: true;
      mutation: {
        type: "replace-with-keyframes";
        animationId: string;
        targetSelector: string;
        position: number;
        duration: number;
        keyframes: Keyframe[];
        ease?: string;
        easeEach?: string;
      };
      /** A keyframe was added, not only changed: keyframe usage counts it as an add. */
      added: boolean;
    }
  | { ok: false; reason: PlayheadEditRefusal };

const roundPct = (pct: number) => Math.round(pct * 1000) / 1000;

const isLinear = (ease: string | undefined) => !ease || ease === "none" || ease === "linear";

interface Normalized {
  keyframes: Keyframe[];
  runEase?: string;
  easeEach?: string;
}

function refuse(reason: PlayheadEditRefusal): { ok: false; reason: PlayheadEditRefusal } {
  return { ok: false, reason };
}

// fallow-ignore-next-line complexity
function normalize(edit: PlayheadEdit): Normalized | { reason: PlayheadEditRefusal } {
  const { anim } = edit;
  const data = anim.keyframes;
  if (data) {
    if (data.format === "simple-array") return { reason: "simple-array-keyframes" };
    const arrayStep = data.format === "object-array";
    const blocked = stepListBlock(anim);
    if (blocked) return { reason: blocked };
    return {
      runEase: keyframedTweenEases(anim).run,
      keyframes: data.keyframes.map((kf) => ({
        ...kf,
        properties: { ...kf.properties },
        ...(arrayStep ? { ease: kf.ease ?? ARRAY_STEP_EASE } : {}),
      })),
      ...(data.easeEach && !arrayStep ? { easeEach: data.easeEach } : {}),
    };
  }
  // The flat tween's ease becomes easeEach: a top-level ease would leave each segment power1.inOut.
  const easeEach = anim.ease ?? edit.parsedEase;
  if (!easeEach) return { reason: "unknown-ease" };
  const to = { percentage: 100, properties: { ...anim.properties } };
  if (anim.method === "to") return { keyframes: [to], easeEach };
  if (anim.method === "fromTo") {
    return { keyframes: [{ percentage: 0, properties: { ...anim.fromProperties } }, to], easeEach };
  }
  if (anim.method === "from") {
    const end: Props = {};
    for (const prop of Object.keys(anim.properties)) {
      const value = edit.implicitEndValue(prop, "end");
      if (value == null) return { reason: "implicit-end-unknown" };
      end[prop] = value;
    }
    return {
      keyframes: [
        { percentage: 0, properties: { ...anim.properties } },
        { percentage: 100, properties: end },
      ],
      easeEach,
    };
  }
  return { reason: "not-a-tween" };
}

function valueAt(keyframes: Keyframe[], prop: string, side: "first" | "last") {
  const carrying = keyframes.filter((kf) => kf.properties[prop] != null);
  const kf = side === "first" ? carrying[0] : carrying.at(-1);
  return kf ? { percentage: kf.percentage, value: kf.properties[prop]! } : null;
}

const keyframeAt = (keyframes: Keyframe[], percentage: number) =>
  keyframes[nearestKeyframeIndex(keyframes, percentage)];

function upsert(keyframes: Keyframe[], percentage: number, properties: Props, ease?: string) {
  const hit = keyframeAt(keyframes, percentage);
  if (hit) {
    Object.assign(hit.properties, properties);
    return hit;
  }
  const added = { percentage, properties, ...(ease ? { ease } : {}) };
  keyframes.push(added);
  return added;
}

/** Every channel the tween animates, held at its value at the tween's authored start or end. */
function heldEnds(
  norm: Normalized,
  end: "start" | "end",
  implicit: ImplicitEndValue,
  backfilled: Record<string, number>,
) {
  const props = new Set(norm.keyframes.flatMap((kf) => Object.keys(kf.properties)));
  const held: Props = {};
  for (const prop of props) {
    const known = valueAt(norm.keyframes, prop, end === "start" ? "first" : "last");
    // A channel holds its last keyframe after it; only a start can be implicit.
    const value =
      known && (end === "end" || known.percentage <= 0)
        ? known.value
        : (backfilled[prop] ?? implicit(prop, "start"));
    if (value == null) return null;
    held[prop] = value;
  }
  return held;
}

/** An array step without a channel holds it, where a percentage keyframe would tween through it. */
function holdOmittedChannels(
  steps: Keyframe[],
  implicit: ImplicitEndValue,
  backfilled: Record<string, number>,
): boolean {
  const props = new Set(steps.flatMap((kf) => Object.keys(kf.properties)));
  for (const prop of props) {
    let held: number | string | null | undefined;
    for (const kf of steps) {
      if (kf.properties[prop] != null) held = kf.properties[prop];
      else {
        held ??= backfilled[prop] ?? implicit(prop, "start");
        if (held == null) return false;
        kf.properties[prop] = held;
      }
    }
  }
  return true;
}

/** On a keyframe, change it; between two, add one at the playhead; outside the tween, add one there
 *  and keep the authored ends. Values come from the file's tween or GSAP's parse, never the DOM. */
// fallow-ignore-next-line complexity
export function planValueAtPlayhead(edit: PlayheadEdit): PlayheadEditPlan {
  const { anim, values } = edit;
  const start = resolveTweenStart(anim);
  const duration = resolveTweenDuration(anim);
  if (start == null || !(duration > 0)) return refuse("no-timing");
  const norm = normalize(edit);
  if ("reason" in norm) return refuse(norm.reason);
  const keyframes = norm.keyframes;
  const authored = keyframes.length;
  const steps = anim.keyframes?.format === "object-array" ? [...keyframes] : [];
  // GSAP runs `scale` beside scaleX/scaleY and the longhands win, so a per-axis edit splits it.
  if ("scaleX" in values || "scaleY" in values) {
    for (const kf of keyframes) {
      const { scale, ...rest } = kf.properties;
      if (scale != null) kf.properties = { scaleX: scale, scaleY: scale, ...rest };
    }
  }
  const backfilled: Record<string, number> = {};
  const pauseStepsHoldThePrevious = new Set(
    steps.filter((kf) => Object.keys(kf.properties).length === 0),
  );
  for (const [prop, value] of Object.entries(edit.backfill ?? {})) {
    if (!(prop in values) || keyframes.some((kf) => kf.properties[prop] != null)) continue;
    if (edit.holdFromStart && !keyframes.some((kf) => kf.percentage <= 0))
      keyframes.unshift({ percentage: 0, properties: {} });
    for (const kf of keyframes) if (!pauseStepsHoldThePrevious.has(kf)) kf.properties[prop] = value;
    backfilled[prop] = value;
  }
  if (Object.keys(values).some((prop) => !keyframes.some((kf) => kf.properties[prop] != null)))
    return refuse("implicit-end-unknown");
  let position = start;
  let span = duration;

  const pct =
    "percentage" in edit.at
      ? edit.at.percentage
      : roundPct(((edit.at.time - start) / duration) * 100);
  const eased = !isLinear(norm.runEase);
  if (pct >= -KEYFRAME_PCT_MATCH && pct <= 100 + KEYFRAME_PCT_MATCH) {
    const at = Math.min(100, Math.max(0, pct));
    const hit = keyframeAt(keyframes, at);
    // The ease moves where a time lands, not a keyframe's own percentage or the tween's ends.
    const onKeyframe = "percentage" in edit.at || hit?.percentage === 0 || hit?.percentage === 100;
    if (eased && !(hit && onKeyframe)) return refuse("eased-keyframes");
    const next = [...keyframes]
      .sort((a, b) => a.percentage - b.percentage)
      .find((kf) => kf.percentage > at + KEYFRAME_PCT_MATCH);
    // The new keyframe splits next's segment, so it takes next's ease.
    upsert(keyframes, at, { ...values }, next?.ease);
  } else {
    if (eased) return refuse("eased-keyframes");
    const time = (edit.at as { time: number }).time;
    const before = time < start;
    const held = heldEnds(norm, before ? "start" : "end", edit.implicitEndValue, backfilled);
    if (!held) return refuse("implicit-end-unknown");
    position = before ? time : start;
    span = before ? start + duration - time : time - start;
    for (const kf of keyframes) {
      kf.percentage = roundPct(
        ((start + (kf.percentage / 100) * duration - position) / span) * 100,
      );
    }
    const oldEdge = roundPct((((before ? start : start + duration) - position) / span) * 100);
    // The span the tween gains is new and linear; the authored segments keep their eases.
    const linear = isLinear(norm.easeEach ?? PERCENTAGE_SEGMENT_EASE) ? undefined : "none";
    const edge = upsert(keyframes, oldEdge, held, linear);
    if (before && linear) edge.ease ??= linear;
    upsert(keyframes, before ? 0 : 100, { ...held, ...values }, before ? undefined : linear);
  }

  if (!holdOmittedChannels(steps, edit.implicitEndValue, backfilled))
    return refuse("implicit-end-unknown");
  keyframes.sort((a, b) => a.percentage - b.percentage);
  return {
    ok: true,
    mutation: {
      type: "replace-with-keyframes",
      animationId: anim.id,
      targetSelector: anim.targetSelector,
      position: roundPct(position),
      duration: roundPct(span),
      keyframes,
      ...(norm.runEase ? { ease: norm.runEase } : {}),
      ...(norm.easeEach ? { easeEach: norm.easeEach } : {}),
    },
    added: keyframes.length > authored,
  };
}


/** Values the player can measure when a tween inherits its endpoints or ease from runtime state. */
export interface PlayheadSamples {
  start?: Record<string, number>;
  end?: Record<string, number>;
  ease?: string;
  backfill?: Record<string, number>;
  holdFromStart?: boolean;
}

/** Resolves the edit without executing project JavaScript. An omitted runtime value is unknown. */
export function planAuthoredAnimatedValues(anim: GsapAnimation, at: PlayheadEdit["at"], values: PlayheadEdit["values"], samples?: PlayheadSamples) {
  if (anim.durationUnresolved || anim.hasUnresolvedSelector || anim.hasUnresolvedKeyframes || anim.arcPath?.enabled)
    return refuse("no-timing");
  return planValueAtPlayhead({ anim, at, values, parsedEase:samples?.ease, backfill:samples?.backfill,
    holdFromStart:samples?.holdFromStart, implicitEndValue:(prop,side) => samples?.[side]?.[prop] ?? null });
}
