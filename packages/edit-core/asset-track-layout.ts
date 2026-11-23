import { stampHfIdsInPlace, walkCompositionDescendants } from '@hyperframes/parsers/hf-ids';
import { findTargetElement, parseSourceDocument } from '@hyperframes/studio-server/source-mutation';
import { applyPatchByTarget, readTagSnippetByTarget, type PatchTarget } from './source-patcher.ts';

export interface TrackPlacement {
  target: PatchTarget;
  track: number;
  start?: number;
  duration?: number;
}

/** Opening a display row can move existing clips. All placements belong to the same asset edit. */
export function applyAssetTrackLayout(source: string, placements: readonly TrackPlacement[]): string {
  if (!placements.length) return source;
  const { document } = parseSourceDocument(source);
  const idCounts = new Map<string, number>();
  walkCompositionDescendants(document, (el) => {
    if (el.id) idCounts.set(el.id, (idCounts.get(el.id) ?? 0) + 1);
  });
  for (const { target, track, start, duration } of placements) {
    const node = findTargetElement(document, target);
    if (!node) throw new Error('Cannot renumber a missing clip.');
    // Validate and patch the exact same element, even when an old selection carries conflicting locators.
    const hfId = node.getAttribute('data-hf-id');
    if (!hfId) throw new Error('Cannot renumber a clip without a stable identity.');
    let canonical: PatchTarget = { hfId };
    if (!readTagSnippetByTarget(source, canonical)) {
      // Parsing computes handles for legacy sources. A unique authored DOM id
      // identifies the same clip without adding handles to every unaffected tag.
      if (node.id && idCounts.get(node.id) === 1) canonical = { id: node.id };
      else source = stampHfIdsInPlace(source);
    }
    if (node.closest('[data-timeline-locked]'))
      throw new Error('Cannot open a new track here: a locked clip would have to move.');
    if (!Number.isSafeInteger(track)) throw new Error('Invalid track.');
    for (const [property, value] of [
      ['start', start],
      ['duration', duration],
      ['track-index', track],
    ] as const) {
      if (value === undefined) continue;
      if (
        !Number.isFinite(value) ||
        (property === 'start' && value < 0) ||
        (property === 'duration' && value <= 0)
      )
        throw new Error('Invalid clip timing.');
      source = applyPatchByTarget(source, canonical, { type: 'attribute', property, value: String(value) });
    }
  }
  return source;
}
