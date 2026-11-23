import { findElementForSelection } from '../components/editor/domEditingElement';
import type { TimelinePaintPlan } from '../utils/cloudTimelineEdit';

/** Preview authored paint ranks immediately, retaining the CSS position needed for z-index to take effect. */
export function previewTimelinePaint(
  paint: TimelinePaintPlan | undefined,
  iframe: HTMLIFrameElement | null,
  activePath: string | null,
) {
  const restores: Array<() => void> = [];
  const rollback = () => restores.reverse().forEach((restore) => restore());
  const doc = iframe?.contentDocument;
  if (!doc || !paint || !('ranks' in paint)) return { paint, rollback };
  const ranks = paint.ranks.map((rank) => {
    const el = findElementForSelection(doc, { ...rank.element, id: rank.element.domId }, activePath);
    if (!el) return rank;
    const beforeZ = el.style.zIndex;
    const beforePosition = el.style.position;
    const makeRelative = doc.defaultView?.getComputedStyle(el).position === 'static';
    const next = String(rank.zIndex);
    el.style.zIndex = next;
    if (makeRelative) el.style.position = 'relative';
    restores.push(() => {
      if (el.style.zIndex !== next) return;
      el.style.zIndex = beforeZ;
      if (makeRelative && el.style.position === 'relative') el.style.position = beforePosition;
    });
    return { ...rank, makeRelative };
  });
  return { paint: { ranks }, rollback };
}
