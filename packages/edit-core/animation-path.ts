import type { GsapAnimation, GsapKeyframesData } from "@hyperframes/core/gsap-parser";
import { KEYFRAME_PROPERTY_DEFAULTS as PROPERTY_DEFAULTS } from "@hyperframes/core/keyframe-defaults";
import {
  resolveTweenStart,
  resolveTweenDuration,
  stepListBlock,
  keyframedTweenEases,
} from "./playhead-edit.ts";
const roundTo3 = (value: number) => Math.round(value * 1000) / 1000;

// fallow-ignore-next-line complexity
export function synthesizeFlatTweenKeyframes(anim: GsapAnimation): GsapKeyframesData | null {
  // Both parsers store extras as raw source text (`__raw:${code}`) so
  // non-editable config like `stagger: {...}` survives verbatim — a literal
  // `immediateRender: true` prints as exactly this string, not a boolean.
  const hasImmediateRenderHold = anim.extras?.immediateRender === "__raw:true";
  if (anim.method === "set" || (anim.duration === 0 && hasImmediateRenderHold)) {
    // A `set` — or a `to()`/`from()` collapsed to a zero-duration
    // immediateRender hold (what removeAllKeyframesFromScript collapses a
    // keyframed tween to) — is a STATIC HOLD: a value applied at one point,
    // not an animated keyframe. It must NOT synthesize a keyframe, or the
    // timeline + panel show a phantom diamond for a value that doesn't
    // animate. This aligns the AST path with the runtime scan, which already
    // skips every zero-duration set.
    return null;
  }
  const toProps = anim.properties;
  const fromProps = anim.fromProperties;
  if (!toProps || Object.keys(toProps).length === 0) return null;

  const rawStart: Record<string, number | string> = {};
  const rawEnd: Record<string, number | string> = {};

  if (anim.method === "from") {
    for (const [k, v] of Object.entries(toProps)) {
      rawStart[k] = v;
      rawEnd[k] = PROPERTY_DEFAULTS[k] ?? 0;
    }
  } else if (anim.method === "fromTo" && fromProps) {
    Object.assign(rawStart, fromProps);
    Object.assign(rawEnd, toProps);
  } else {
    for (const [k, v] of Object.entries(toProps)) {
      rawStart[k] = PROPERTY_DEFAULTS[k] ?? 0;
      rawEnd[k] = v;
    }
  }

  // Only numeric props are keyframe-interpolatable — a flat tween of a
  // non-numeric prop (e.g. backgroundColor: "#fff") can't be a 2-keyframe lane.
  const numericKeys = Object.keys(rawEnd).filter(
    (k) => typeof rawStart[k] === "number" && typeof rawEnd[k] === "number",
  );
  if (numericKeys.length === 0) return null;
  const startProps = Object.fromEntries(numericKeys.map((k) => [k, rawStart[k]]));
  const endProps = Object.fromEntries(numericKeys.map((k) => [k, rawEnd[k]]));

  return {
    format: "percentage",
    keyframes: [
      { percentage: 0, properties: startProps },
      // Segment ease lives on the destination keyframe (Figma/AE model) so the
      // lane + cache surface it; also kept data-level for useGsapTweenCache.
      { percentage: 100, properties: endProps, ...(anim.ease ? { ease: anim.ease } : {}) },
    ],
    ...(anim.ease ? { ease: anim.ease } : {}),
  };
}

/** Translate every point together, keeping each authored segment's easing and timing. */
export function planWholePathOffset(anim: GsapAnimation, deltaX: number, deltaY: number) {
  if (![deltaX, deltaY].every(Number.isFinite)) throw new Error("Expected a finite animation path delta.");
  const refusal = stepListBlock(anim);
  if (refusal || anim.hasUnresolvedKeyframes || anim.durationUnresolved || resolveTweenStart(anim) == null)
    throw new Error("Cannot translate an unresolved animation path" + (refusal ? ": " + refusal : "."));
  const ts = resolveTweenStart(anim)!;
  const td = resolveTweenDuration(anim);
  // A hold has no path to rebuild. Keep its method, timing and immediateRender semantics.
  if (!anim.keyframes && (anim.method === "set" || td === 0)) {
    const translate = (props: GsapAnimation["properties"]) => {
      const x = props.x ?? 0;
      const y = props.y ?? 0;
      if (typeof x !== "number" || typeof y !== "number") throw new Error("Cannot offset a non-numeric hold.");
      return { ...props, x: roundTo3(x + deltaX), y: roundTo3(y + deltaY) };
    };
    return {
      type: "update-meta",
      animationId: anim.id,
      updates: {
        properties: translate(anim.properties),
        ...(anim.fromProperties && { fromProperties: translate(anim.fromProperties) }),
      },
    };
  }

  let kfs = anim.keyframes?.keyframes ?? [];
  if (kfs.length === 0) {
    const fromProps = anim.method === "from" ? anim.properties : (anim.fromProperties ?? {});
    const toProps = anim.method === "from" ? {} : anim.properties;
    const startX = typeof fromProps.x === "number" ? fromProps.x : 0;
    const startY = typeof fromProps.y === "number" ? fromProps.y : 0;
    const endX = typeof toProps.x === "number" ? toProps.x : anim.method === "from" ? 0 : startX;
    const endY = typeof toProps.y === "number" ? toProps.y : anim.method === "from" ? 0 : startY;
    const endpoints = synthesizeFlatTweenKeyframes(anim)?.keyframes;
    kfs = [
      { percentage: 0, properties: { ...endpoints?.[0]?.properties, ...fromProps, x: startX, y: startY } },
      { percentage: 100, properties: { ...endpoints?.[1]?.properties, ...toProps, x: endX, y: endY } },
    ];
  }

  const shifted = kfs.map((kf) => ({
    percentage: kf.percentage,
    properties: {
      ...kf.properties,
      x: roundTo3((typeof kf.properties.x === "number" ? kf.properties.x : 0) + deltaX),
      y: roundTo3((typeof kf.properties.y === "number" ? kf.properties.y : 0) + deltaY),
    },
    ...(kf.ease ? { ease: kf.ease } : {}),
  }));

  return {
    type: "replace-with-keyframes",
    animationId: anim.id,
    targetSelector: anim.targetSelector,
    position: roundTo3(ts),
    duration: roundTo3(td),
    keyframes: shifted,
    ...(anim.keyframes
      ? { ease: keyframedTweenEases(anim).run, easeEach: anim.keyframes.easeEach }
      : { easeEach: anim.ease }),
  };
}
