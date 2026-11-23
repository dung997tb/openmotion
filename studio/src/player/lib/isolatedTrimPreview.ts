import type { TimelineElement } from "../store/playerStore";
import { createPreviewAdapter } from "./previewAdapter";

type Trim = Pick<TimelineElement, "start" | "duration" | "playbackStart">;
type ClipTrim = Trim & { element: TimelineElement };

// An isolated document keeps publishing its old manifest until the replacement
// preview loads. Its own URL/lease identifies exactly which snapshot is stale.
const trims = new WeakMap<HTMLIFrameElement, { source: string; clips: Map<string, Trim> }>();

export function holdIsolatedTrims(frame: HTMLIFrameElement | null, changes: readonly ClipTrim[]) {
  if (!frame) return () => {};
  const adapter = createPreviewAdapter({ iframe: frame });
  if (adapter.sameOrigin || !adapter.token) return () => {};
  let snapshot = trims.get(frame);
  if (!snapshot || snapshot.source !== frame.src) {
    snapshot = { source: frame.src, clips: new Map() };
    trims.set(frame, snapshot);
  }
  const { clips } = snapshot;
  const entries = changes.map(({ element, start, duration, playbackStart }) => {
    const key = element.key ?? element.id;
    const trim = { start, duration, ...(playbackStart !== undefined && { playbackStart }) };
    clips.set(key, trim);
    return { key, trim };
  });
  return () => {
    for (const { key, trim } of entries) if (clips.get(key) === trim) clips.delete(key);
  };
}

export function applyHeldTrims(frame: HTMLIFrameElement | null, elements: TimelineElement[]) {
  const snapshot = frame && trims.get(frame);
  if (!snapshot || snapshot.source !== frame?.src || !snapshot.clips.size) return elements;
  return elements.map(element => {
    const trim = snapshot.clips.get(element.key ?? element.id);
    return trim ? { ...element, ...trim } : element;
  });
}
