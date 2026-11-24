import { parseSourceDocument } from "@hyperframes/studio-server/source-mutation";
import { HF_AUDIO_GROUP_TAG } from "@hyperframes/core/audio-groups";

export function readDurationAttribute(el: Element | null | undefined): number {
  if (!el) return 0;
  const duration =
    Number.parseFloat(el.getAttribute("data-duration") ?? "") ||
    Number.parseFloat(el.getAttribute("data-hf-authored-duration") ?? "");
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function isTimelineIgnoredElement(el: Element): boolean {
  // Canvas framing is structural, even if the native runtime infers a timing window for it.
  // Its authored children remain ordinary clips, so do not use an ancestor/closest check here.
  if (el.hasAttribute('data-canvas-frame') || el.hasAttribute('data-canvas-content')) return true;
  // An `<hf-audio-group>` is a mixer bus with no timing of its own, drawn as a group row, never a clip.
  if (el.tagName.toLowerCase() === HF_AUDIO_GROUP_TAG) return true;
  return Boolean(
    el.closest(
      [
        "[data-hyperframes-ignore]",
        "[data-hyperframes-picker-ignore]",
        "[data-hf-ignore]",
        "[data-hf-color-grading-canvas]",
      ].join(","),
    ),
  );
}

/**
 * Furthest clip end (start + RAW `data-duration`) over every non-root clip in the
 * document. Reads the authored attribute, NOT any runtime-computed value — so it
 * is immune to the runtime's clamp that truncates a clip's live duration to the
 * composition length. This is the source of truth for content-driven duration:
 * computing it from the store instead would feed the truncated value back in and
 * make the composition length ratchet down (research HANDOFF-3 §6.1 feedback loop).
 */
export function furthestClipEndFromDocument(doc: Document | null | undefined): number {
  if (!doc) return 0;
  const root = doc.querySelector("[data-composition-id]");
  let maxEnd = 0;
  for (const node of Array.from(doc.querySelectorAll("[data-start]"))) {
    if (node === root || isTimelineIgnoredElement(node)) continue;
    const start = Number.parseFloat(node.getAttribute("data-start") ?? "");
    const duration = readDurationAttribute(node);
    if (!Number.isFinite(start) || start < 0 || duration <= 0) continue;
    maxEnd = Math.max(maxEnd, start + duration);
  }
  return maxEnd;
}

/** Match the editor's content duration after deleting or resizing an authored clip. */
export function syncContentEnd(source: string) {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const root = document.querySelector('[data-composition-id]');
  if (!root?.hasAttribute('data-duration')) return source;
  const end = furthestClipEndFromDocument(document);
  const value = Math.round(end * 100) / 100;
  if (value <= 0 || value === Number(root.getAttribute('data-duration'))) return source;
  root.setAttribute('data-duration', String(value));
  return wrappedFragment ? document.body.innerHTML : document.toString();
}
