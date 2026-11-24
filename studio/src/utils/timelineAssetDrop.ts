export { buildTimelineAssetId } from "@hyperframes/core/timeline-asset-id";
export { getTimelineAssetKind, resolveTimelineAssetSrc, resolveTimelineAssetCompositionSize, fitTimelineAssetGeometry, buildTimelineAssetInsertHtml, insertTimelineAssetIntoSource, type TimelineAssetKind } from "../../../packages/edit-core/asset-placement";
import { roundToCenti } from "./rounding";
import { patchRootCompositionDuration, readRootCompositionDuration } from "./rootDuration";
export const TIMELINE_ASSET_MIME = "application/x-hyperframes-asset";
export const TIMELINE_BLOCK_MIME = "application/x-hyperframes-block";
const FALLBACK_TIMELINE_FILE_DROP_DURATION = 5;


export function parseTimelineAssetPayload(raw: string): { path: string; duration?: number } | null {
  try {
    const value = JSON.parse(raw) as { path?: unknown; duration?: unknown } | null;
    if (!value || typeof value.path !== "string" || !value.path) return null;
    const duration = typeof value.duration === "number" && Number.isFinite(value.duration) && value.duration > 0
      ? value.duration : undefined;
    return { path: value.path, duration };
  } catch {
    return null;
  }
}

/**
 * Sequence one or more dropped files end-to-end starting at the drop point, all on
 * the track the user dropped onto. The clip lands where the ghost showed it — we do
 * NOT bump to a different track on overlap (that produced surprise "new tracks" and,
 * because it jumped past high indices like a grain-overlay track, wild numbers).
 * HyperFrames allows time-overlap on a track; the user can nudge if they want a gap.
 */
export function buildTimelineFileDropPlacements(
  placement: { start: number; track: number },
  durations: number[],
): Array<{ start: number; track: number }> {
  let nextStart = roundToCenti(Math.max(0, placement.start));
  return durations.map((rawDuration) => {
    const duration =
      Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : FALLBACK_TIMELINE_FILE_DROP_DURATION;
    const start = nextStart;
    nextStart = roundToCenti(nextStart + duration);
    return { start, track: placement.track };
  });
}

/**
 * A clip inserted past the composition end would exist in the HTML but never
 * appear on the timeline or in playback. Extend the root's data-duration to
 * cover it (mirrors blockInstaller's behavior for installed blocks).
 */
export function extendCompositionDurationIfNeeded(source: string, requiredEnd: number): string {
  const rootDur = readRootCompositionDuration(source);
  if (rootDur == null || !Number.isFinite(rootDur) || requiredEnd <= rootDur) return source;
  return patchRootCompositionDuration(source, String(roundToCenti(requiredEnd)));
}

/**
 * Set the composition root's `data-duration` to `contentEnd` (grow OR shrink) so the
 * timeline length tracks content — the content-driven counterpart to
 * extendCompositionDurationIfNeeded's grow-only ratchet. Used after edits that can
 * reduce the furthest clip end (delete/trim). No-op when `contentEnd` is not > 0, so
 * an empty timeline keeps its declared duration instead of collapsing to 0.
 */
export function setCompositionDurationToContent(
  source: string,
  contentEnd: number,
  rootDuration?: number | null,
): string {
  if (!Number.isFinite(contentEnd) || contentEnd <= 0) return source;
  const rootDur = rootDuration === undefined ? readRootCompositionDuration(source) : rootDuration;
  if (rootDur == null) return source;
  const next = roundToCenti(contentEnd);
  if (rootDur === next) return source;
  return patchRootCompositionDuration(source, String(next));
}
