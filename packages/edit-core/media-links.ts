import { mediaAssetIdentity } from "./media-asset-identity.ts";
import { HF_AUDIO_AUTOMATION_ATTR } from "@hyperframes/core/audio-automation";
import {
  MEDIA_LINK_ATTR,
  SYNC_ORIGIN_ATTR,
  mintLinkId,
} from "@hyperframes/core/media-link";


import {
  applyPatchByTarget,
  findTagByTarget,
  readAttributeByTarget,
  type PatchOperation,
  type PatchTarget,
} from "./source-patcher.ts";


import {
  COPIED_TIMING_ATTRS,
  MOVED_SOUND_ATTRS,
  firstFreeName,
  formatAttrs,
  insertBeforeTarget,
  readAuthoredSrc,
  splitAutomation,
} from "./audio-source.ts";

const collectHtmlIds = (source: string) => Array.from(source.matchAll(/\bid=(["'])(.*?)\1/g), m => m[2]!);
const LINK_PROPERTY = MEDIA_LINK_ATTR.slice("data-".length);
const HIDDEN_ATTR = "data-hidden";
const SYNC_ORIGIN_PROPERTY = SYNC_ORIGIN_ATTR.slice("data-".length);


const dataOp = (property: string, value: string | null): PatchOperation => ({
  type: "attribute",
  property: property.startsWith("data-") ? property.slice("data-".length) : property,
  value,
});

const htmlOp = (property: string, value: string | null): PatchOperation => ({
  type: "html-attribute",
  property,
  value,
});

function applyOps(source: string, target: PatchTarget, ops: readonly PatchOperation[]): string {
  return ops.reduce((html, op) => applyPatchByTarget(html, target, op), source);
}

function mintLinkIdForSource(source: string): string {
  const links = Array.from(
    source.matchAll(/\bdata-(?:link|sync-origin)=["']([^"']+)["']/g),
    (match) => match[1] ?? "",
  );
  return mintLinkId([...collectHtmlIds(source), ...links]);
}

/** Write (or with `null`, remove) `data-link` on every target. */
export function setLinkInSource(
  source: string,
  targets: readonly PatchTarget[],
  linkId: string | null,
): string {
  return targets.reduce(
    (html, target) => applyPatchByTarget(html, target, dataOp(LINK_PROPERTY, linkId)),
    source,
  );
}

/** Link the targets under one fresh id, also their sync origin when they share a source file. */
export function linkInSource(
  source: string,
  targets: readonly PatchTarget[],
  options: { syncOrigin: boolean } = { syncOrigin: true },
): string {
  const linkId = mintLinkIdForSource(source);
  const ops = options.syncOrigin
    ? [dataOp(LINK_PROPERTY, linkId), dataOp(SYNC_ORIGIN_PROPERTY, linkId)]
    : [dataOp(LINK_PROPERTY, linkId)];
  return targets.reduce((html, target) => applyOps(html, target, ops), source);
}

/** Remove one element (open tag through its matching close tag) and its line's indentation. */
export function removeElementInSource(source: string, target: PatchTarget): string {
  const match = findTagByTarget(source, target);
  if (!match) return source;
  const tagName = /^<([a-zA-Z][\w-]*)/.exec(match.tag)?.[1]?.toLowerCase() ?? "";
  const closing = `</${tagName}>`;
  const closeAt = match.tag.endsWith("/>")
    ? -1
    : source.toLowerCase().indexOf(closing, match.end + 1);
  let end = closeAt >= 0 ? closeAt + closing.length : match.end + 1;
  let start = match.start;
  const lineStart = source.lastIndexOf("\n", start) + 1;
  if (/^[ \t]*$/.test(source.slice(lineStart, start)) && source[end] === "\n") {
    start = lineStart;
    end += 1;
  }
  return source.slice(0, start) + source.slice(end);
}

function hasBooleanAttr(source: string, target: PatchTarget, name: string): boolean {
  const tag = findTagByTarget(source, target)?.tag ?? "";
  return new RegExp(`\\s${name}(?=[\\s=/>]|$)`, "i").test(tag);
}

export interface DetachAudioResult {
  html: string;
  audioId: string;
  linkId: string;
}

/**
 * Detach audio: insert a linked `<audio>` over the same file and window, move the
 * sound attributes onto it, and mute the video. Renders identically.
 */
export function detachAudioInSource(
  source: string,
  input: { target: PatchTarget; videoId: string | null; track: number },
): DetachAudioResult | null {
  const { target } = input;
  if (!findTagByTarget(source, target)) return null;
  const linkId = mintLinkIdForSource(source);
  const audioId = firstFreeName(
    `${input.videoId || "video"}-audio`,
    new Set(collectHtmlIds(source)),
  );

  const moved: Array<[string, string]> = [];
  const videoOps: PatchOperation[] = [htmlOp("muted", "true"), dataOp("has-audio", null)];
  for (const name of MOVED_SOUND_ATTRS) {
    const value = readAttributeByTarget(source, target, name);
    if (value === undefined) continue;
    moved.push([name, value]);
    videoOps.push(dataOp(name, null));
  }
  const automation = readAttributeByTarget(source, target, HF_AUDIO_AUTOMATION_ATTR);
  if (automation !== undefined) {
    const { videoKeeps, audioTakes } = splitAutomation(automation);
    moved.push([HF_AUDIO_AUTOMATION_ATTR, audioTakes]);
    videoOps.push(dataOp(HF_AUDIO_AUTOMATION_ATTR, videoKeeps));
  }
  videoOps.push(dataOp(LINK_PROPERTY, linkId), dataOp(SYNC_ORIGIN_PROPERTY, linkId));

  const timing: Array<[string, string]> = [];
  for (const name of COPIED_TIMING_ATTRS) {
    const value = readAttributeByTarget(source, target, name);
    if (value !== undefined) timing.push([`data-${name}`, value]);
  }
  const attrs: Array<[string, string]> = [
    ["id", audioId],
    ["data-hf-id", firstFreeName("hf-" + audioId, new Set(Array.from(source.matchAll(/\bdata-hf-id=["']([^"']+)/g), match => match[1]!)))],
    ["class", "clip"],
    ["src", readAuthoredSrc(source, target)],
    ...timing,
    ["data-track-index", String(input.track)],
    [MEDIA_LINK_ATTR, linkId],
    [SYNC_ORIGIN_ATTR, linkId],
    ...moved,
  ];
  if (hasBooleanAttr(source, target, "loop")) attrs.push(["loop", ""]);
  if (hasBooleanAttr(source, target, HIDDEN_ATTR)) attrs.push([HIDDEN_ATTR, ""]);
  const inserted = insertBeforeTarget(source, target, `<audio ${formatAttrs(attrs)}></audio>`);
  return { html: applyOps(inserted, target, videoOps), audioId, linkId };
}

/**
 * Merge back: move the audio's sound attributes onto its video, unmute the
 * video, drop the link, and delete the audio. The inverse of detach.
 */
export function mergeAudioInSource(
  source: string,
  input: { videoTarget: PatchTarget; audioTarget: PatchTarget },
): string | null {
  const { videoTarget, audioTarget } = input;
  if (!findTagByTarget(source, videoTarget) || !findTagByTarget(source, audioTarget)) return null;
  const assetOf = (target: PatchTarget) =>
    mediaAssetIdentity({ src: readAuthoredSrc(source, target) });
  const videoAsset = assetOf(videoTarget);
  if (!videoAsset || videoAsset !== assetOf(audioTarget)) return null;
  const hiddenOf = (target: PatchTarget) => hasBooleanAttr(source, target, HIDDEN_ATTR);
  if (hiddenOf(videoTarget) !== hiddenOf(audioTarget)) return null;
  const videoOps: PatchOperation[] = [];
  for (const name of MOVED_SOUND_ATTRS) {
    const value = readAttributeByTarget(source, audioTarget, name);
    videoOps.push(dataOp(name, value ?? null));
  }
  const automation = readAttributeByTarget(source, audioTarget, HF_AUDIO_AUTOMATION_ATTR);
  if (automation !== undefined) videoOps.push(dataOp(HF_AUDIO_AUTOMATION_ATTR, automation));
  videoOps.push(
    htmlOp("muted", null),
    dataOp(LINK_PROPERTY, null),
    dataOp(SYNC_ORIGIN_PROPERTY, null),
    dataOp("has-audio", "true"),
  );
  return applyOps(removeElementInSource(source, audioTarget), videoTarget, videoOps);
}

type TrackedElement = { tag: string; track: number; start: number; duration: number;
  authoredTrack?: number;
};

/**
 * The detached audio's track: the first audio-only track below every visual
 * track that is free for the clip's window, else a new track at the bottom.
 */
export function pickDetachedAudioTrack(
  elements: readonly TrackedElement[],
  window: { start: number; duration: number },
): number {
  const trackOf = (el: TrackedElement) => el.authoredTrack ?? el.track;
  const visualTracks = elements.filter((el) => el.tag.toLowerCase() !== "audio").map(trackOf);
  const lowestAudio = Math.max(-1, ...visualTracks) + 1;
  const end = window.start + window.duration;
  const allTracks = elements.map(trackOf);
  const bottom = Math.max(lowestAudio - 1, ...allTracks) + 1;
  for (let track = lowestAudio; track < bottom; track += 1) {
    const occupants = elements.filter((el) => trackOf(el) === track);
    const free = occupants.every(
      (el) => el.tag.toLowerCase() === "audio" && (el.start >= end || el.start + el.duration <= window.start),
    );
    if (free) return track;
  }
  return bottom;
}
