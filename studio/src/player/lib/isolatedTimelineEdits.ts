import type { TimelineElement } from "../store/playerStore";
import { createPreviewAdapter } from "./previewAdapter";

type Timing = Partial<Pick<TimelineElement, "start" | "duration" | "playbackStart" | "track" | "authoredTrack">>;
type Change = { element: TimelineElement; start: number; track?: number; duration?: number; playbackStart?: number };
type HeldClip = { path: string; timing: Timing };

// An isolated document keeps publishing its old manifest until the replacement
// preview loads. Its own URL/lease identifies exactly which snapshot is stale.
const held = new WeakMap<HTMLIFrameElement, { source: string; clips: Map<string, HeldClip> }>();

function releaseEntries(clips: Map<string, HeldClip>, entries: ReadonlyArray<readonly [string, HeldClip]>) {
  return () => {
    for (const [key, entry] of entries) if (clips.get(key) === entry) clips.delete(key);
  };
}

export function holdIsolatedTimelineChanges(frame: HTMLIFrameElement | null, changes: readonly Change[], activePath?: string | null) {
  if (!frame) return () => {};
  const adapter = createPreviewAdapter({ iframe: frame });
  if (adapter.sameOrigin || !adapter.token) return () => {};
  let snapshot = held.get(frame);
  if (!snapshot || snapshot.source !== frame.src) {
    snapshot = { source: frame.src, clips: new Map() };
    held.set(frame, snapshot);
  }
  const { clips } = snapshot;
  const entries = changes.map(({ element, start, track, duration, playbackStart }) => {
    const key = element.key ?? element.id;
    const timing: Timing = { ...clips.get(key)?.timing, start };
    if (duration !== undefined) timing.duration = duration;
    if (playbackStart !== undefined) timing.playbackStart = playbackStart;
    if (track !== undefined) {
      // This overlay is applied before normalizeToZones, in authored lane space.
      timing.track = track;
      timing.authoredTrack = track;
    }
    const entry = { path: element.sourceFile || activePath || "index.html", timing };
    clips.set(key, entry);
    return [key, entry] as const;
  });
  return releaseEntries(clips, entries);
}

/** A verified in-place update may retire this file's old gestures. A newer gesture keeps its hold. */
export function capturePresentedTimelineChanges(frame: HTMLIFrameElement, path: string) {
  const snapshot = held.get(frame);
  if (snapshot?.source !== frame.src) return;
  return releaseEntries(snapshot.clips, [...snapshot.clips].filter(([, entry]) => entry.path === path));
}

export function applyHeldTimelineChanges(frame: HTMLIFrameElement | null, elements: TimelineElement[]) {
  const snapshot = frame && held.get(frame);
  if (!snapshot || snapshot.source !== frame?.src || !snapshot.clips.size) return elements;
  return elements.map(element => {
    const timing = snapshot.clips.get(element.key ?? element.id)?.timing;
    return timing ? { ...element, ...timing } : element;
  });
}
