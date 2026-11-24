import type { TimelineElement } from "../store/playerStore";
import { isUntimedRootText } from "../../../../packages/edit-core/text-tag";
import { createTimelineElementFromManifestClip } from "./timelineDOM";

/** Root text without an explicit window is visible for the whole composition.
 * Discover it without rewriting user sources on open. The first edit materializes
 * the timing through the normal authored-file patch/undo path. Nested composition
 * children continue to use their existing expandable rows and local clock. */
export function appendUntimedText(
  doc: Document | null,
  elements: TimelineElement[],
  duration: number,
): TimelineElement[] {
  const root = doc?.querySelector("[data-composition-id]");
  if (!doc || !root || !(duration > 0)) return elements;
  const extra: TimelineElement[] = [];
  let track = -root.querySelectorAll("[data-hf-id], [id]").length;
  for (const node of Array.from(root.querySelectorAll("[data-hf-id], [id]"))) {
    if (!isUntimedRootText(node, root)) continue;
    if (elements.some(el => el.hfId === node.getAttribute("data-hf-id") || el.domId && el.domId === node.id)) continue;
    const id = node.id || node.getAttribute("data-hf-id")!;
    const element = createTimelineElementFromManifestClip({
      clip: { compositionId: null, parentCompositionId: null, compositionSrc: null, assetUrl: null, id, kind: "element", tagName: node.localName, label: node.textContent.trim().slice(0, 80), start: 0, duration, track: track++ },
      fallbackIndex: elements.length + extra.length, doc, hostEl: node,
    });
    extra.push({ ...element, authoredTrack: 0, implicitTextTiming: true });
  }
  return extra.length ? [...elements, ...extra] : elements;
}
