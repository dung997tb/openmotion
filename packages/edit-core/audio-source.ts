import {
  HF_AUDIO_AUTOMATION_ATTR,
  RATE_TARGET,
  parseAutomation,
  serializeAutomation,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import { HF_AUDIO_CARVE_ATTR } from "@hyperframes/core/audio-carve";
import { HF_AUDIO_FADE_IN_ATTR, HF_AUDIO_FADE_OUT_ATTR } from "@hyperframes/core/audio-fade";
import { HF_AUDIO_FX_ATTR } from "@hyperframes/core/audio-fx";
import { HF_AUDIO_GROUP_ATTR } from "@hyperframes/core/audio-groups";
import { escapeHtmlAttribute, findTagByTarget, readTagAttribute, type PatchTarget } from "./source-patcher.ts";

export const MOVED_SOUND_ATTRS = [
  "data-volume",
  HF_AUDIO_FADE_IN_ATTR,
  HF_AUDIO_FADE_OUT_ATTR,
  HF_AUDIO_FX_ATTR,
  HF_AUDIO_CARVE_ATTR,
  HF_AUDIO_GROUP_ATTR,
];

export const COPIED_TIMING_ATTRS = [
  "start",
  "end",
  "duration",
  "media-start",
  "playback-start",
  "playback-rate",
  "source-duration",
];

export function firstFreeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function splitAutomation(raw: string): { videoKeeps: string | null; audioTakes: string } {
  let lanes: HfAutomationLane[];
  try {
    lanes = parseAutomation(raw).lanes;
  } catch {
    return { videoKeeps: null, audioTakes: raw };
  }
  const rateLanes = lanes.filter((lane) => lane.target === RATE_TARGET);
  const soundLanes = lanes.filter((lane) => lane.target !== RATE_TARGET);
  return {
    videoKeeps: rateLanes.length > 0 ? serializeAutomation({ version: 1, lanes: rateLanes }) : null,
    audioTakes: serializeAutomation({ version: 1, lanes: [...soundLanes, ...rateLanes] }),
  };
}

export function formatAttrs(attrs: Array<[string, string]>): string {
  return attrs.map(([name, value]) => `${name}="${escapeHtmlAttribute(value)}"`).join(" ");
}

export function readAuthoredSrc(source: string, target: PatchTarget): string {
  const tag = findTagByTarget(source, target);
  if (!tag) return "";
  const own = readTagAttribute(tag.tag, "src");
  if (own) return own;
  const firstSource = /^\s*<source\b[^>]*>/i.exec(source.slice(tag.end + 1));
  return (firstSource && readTagAttribute(firstSource[0], "src")) || "";
}

export function insertBeforeTarget(source: string, target: PatchTarget, markup: string): string {
  const match = findTagByTarget(source, target);
  if (!match) return source;
  const lineStart = source.lastIndexOf("\n", match.start) + 1;
  const indent = /^[ \t]*$/.test(source.slice(lineStart, match.start))
    ? source.slice(lineStart, match.start)
    : "";
  const separator = indent ? `\n${indent}` : "";
  return `${source.slice(0, match.start)}${markup}${separator}${source.slice(match.start)}`;
}
