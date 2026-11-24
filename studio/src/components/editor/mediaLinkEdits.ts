import { sourceZeroTime } from "@hyperframes/core/media-link";
import { sameCompositionScope, type TimelineElement } from "../../player/store/timelineElement";
import { mediaAssetIdentity, sharesLinkGroup } from "../../player/components/audioClipLink";
export * from "../../../../packages/edit-core/media-links";
const SYNC_TOLERANCE_S = 1e-3;

type TimedElement = Pick<
  TimelineElement,
  "id" | "key" | "tag" | "src" | "start" | "duration" | "playbackStart" | "playbackRate" | "link"
> &
  Pick<TimelineElement, "muted" | "hasAudio" | "hidden" | "sourceFile" | "compositionScope">;

const tagOf = (el: Pick<TimelineElement, "tag">) => el.tag.trim().toLowerCase();
const keyOf = (el: Pick<TimelineElement, "id" | "key">) => el.key ?? el.id;
const near = (a: number, b: number) => Math.abs(a - b) <= SYNC_TOLERANCE_S;

function hasIdenticalTiming(a: TimedElement, b: TimedElement): boolean {
  return (
    near(a.start, b.start) &&
    near(a.duration, b.duration) &&
    near(a.playbackStart ?? 0, b.playbackStart ?? 0) &&
    near(a.playbackRate ?? 1, b.playbackRate ?? 1)
  );
}

const sameAssetInScope = (a: TimedElement, b: TimedElement) => {
  const asset = mediaAssetIdentity(a);
  return asset !== null && asset === mediaAssetIdentity(b) && sameCompositionScope(a, b);
};

/** A video whose sound is on the video itself: what Detach audio acts on. */
export function canDetachAudio(el: TimedElement): boolean {
  return tagOf(el) === "video" && el.muted !== true && el.hasAudio === true;
}

/**
 * The (muted video, audio) pair Merge back acts on, found from either member:
 * same file, and linked to each other or with identical timing.
 */
export function findMergePair<T extends TimedElement>(
  element: T,
  elements: readonly T[],
): { video: T; audio: T } | null {
  const isVideo = tagOf(element) === "video";
  if (!isVideo && tagOf(element) !== "audio") return null;
  const partnerTag = isVideo ? "audio" : "video";
  const candidates = elements.filter(
    (el) =>
      keyOf(el) !== keyOf(element) && tagOf(el) === partnerTag && sameAssetInScope(el, element),
  );
  const partner =
    candidates.find((el) => sharesLinkGroup(el, element)) ??
    candidates.find((el) => hasIdenticalTiming(el, element));
  if (!partner) return null;
  const video = isVideo ? element : partner;
  const audio = isVideo ? partner : element;
  if ((video.hidden === true) !== (audio.hidden === true)) return null;
  return video.muted === true ? { video, audio } : null;
}

/** One video and one audio in one composition, neither linked: timing and file don't matter. */
export function canLinkPair(selected: readonly TimedElement[]): boolean {
  if (selected.length !== 2) return false;
  const [a, b] = selected;
  if (!a || !b || a.link || b.link) return false;
  const tags = new Set([tagOf(a), tagOf(b)]);
  return tags.has("video") && tags.has("audio") && sameCompositionScope(a, b);
}

export function sharesSourceFile(selected: readonly TimedElement[]): boolean {
  const [a, b] = selected;
  return selected.length === 2 && !!a && !!b && sameAssetInScope(a, b);
}

export function isPairInSync(a: TimedElement, b: TimedElement): boolean {
  const timing = (el: TimedElement) => ({
    start: el.start,
    mediaStart: el.playbackStart ?? 0,
    playbackRate: el.playbackRate ?? 1,
  });
  const [x, y] = [timing(a), timing(b)];
  return near(x.playbackRate, y.playbackRate) && near(sourceZeroTime(x), sourceZeroTime(y));
}
