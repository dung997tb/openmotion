import type { TimelineElement } from "../store/playerStore";
import { createPreviewAdapter } from "./previewAdapter";

type Timing = Partial<Pick<TimelineElement, "start" | "duration" | "playbackStart" | "track" | "authoredTrack">>;
type Change = { element: TimelineElement; start: number; track?: number; duration?: number; playbackStart?: number };

// An isolated document keeps publishing its old manifest until the replacement
// preview loads. Its own URL/lease identifies exactly which snapshot is stale.
const held = new WeakMap<HTMLIFrameElement, { source: string; clips: Map<string, Timing> }>();

export function holdIsolatedTimelineChanges(frame: HTMLIFrameElement | null, changes: readonly Change[]) {
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
    const timing: Timing = { ...clips.get(key), start };
    if (duration !== undefined) timing.duration = duration;
    if (playbackStart !== undefined) timing.playbackStart = playbackStart;
    if (track !== undefined) {
      // This overlay is applied before normalizeToZones, in authored lane space.
      timing.track = track;
      timing.authoredTrack = track;
    }
    clips.set(key, timing);
    return { key, timing };
  });
  return () => {
    for (const { key, timing } of entries) if (clips.get(key) === timing) clips.delete(key);
  };
}

export function applyHeldTimelineChanges(frame: HTMLIFrameElement | null, elements: TimelineElement[]) {
  const snapshot = frame && held.get(frame);
  if (!snapshot || snapshot.source !== frame?.src || !snapshot.clips.size) return elements;
  return elements.map(element => {
    const timing = snapshot.clips.get(element.key ?? element.id);
    return timing ? { ...element, ...timing } : element;
  });
}
