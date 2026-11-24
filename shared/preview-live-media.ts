import type { PreviewChange } from './preview-timing.ts';

/** A move may extend the containing timeline. The bridge also checks that the duration target is its root. */
export function isLiveMediaMove(changes: PreviewChange[]): boolean {
  let audio = false;
  let root = false;
  if (!Array.isArray(changes) || !changes.length) return false;
  for (const change of changes) {
    if (!change || change.styles || change.text || !Array.isArray(change.attributes) || change.attributes.length !== 1) return false;
    const attr = change.attributes[0]?.[0];
    if (change.tag === 'audio' && attr === 'data-start') audio = true;
    else if (!root && change.compositionId && attr === 'data-duration') root = true;
    else return false;
  }
  return audio;
}
