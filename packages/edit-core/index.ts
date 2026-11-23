import type { Composition, HyperFramesElement } from '@hyperframes/sdk';

export interface MoveClip {
  kind: 'moveClip';
  hfId: string;
  /** Absolute start in seconds in the clip's own composition. */
  start: number;
}

/** A nested composition or timed container has its own clock. */
function findClip(children: readonly HyperFramesElement[], hfId: string): HyperFramesElement | undefined {
  for (const child of children) {
    const attrs = child.attributes;
    if ('data-timeline-locked' in attrs || 'data-composition-id' in attrs || 'data-composition-src' in attrs) continue;
    if (child.scopedId === hfId && child.id === hfId) return child;
    if ('data-start' in attrs || 'data-duration' in attrs) continue;
    const nested = findClip(child.children, hfId);
    if (nested) return nested;
  }
}

/** Move one independently timed clip within the current composition duration. */
export function canMoveClip(session: Composition, move: MoveClip): boolean {
  if (!Number.isFinite(move.start) || move.start < 0) return false;
  const stages = session.getRootElements().filter(root => 'data-composition-id' in root.attributes);
  if (stages.length !== 1) return false;
  const stage = stages[0]!;
  if ('data-timeline-locked' in stage.attributes) return false;
  const clip = findClip(stage.children, move.hfId);
  if (!clip || 'data-link' in clip.attributes) return false;
  const duration = Number(clip.attributes['data-duration']);
  const end = Number(stage.attributes['data-duration']);
  return Number.isFinite(duration) && duration > 0 && Number.isFinite(end) && move.start + duration <= end;
}

/** The SDK shifts the clip and its targeted tweens together, preserving their offsets. */
export function moveClip(session: Composition, move: MoveClip): void {
  if (!canMoveClip(session, move)) {
    throw new Error('Choose an unlocked, unlinked timed clip and a position within its composition.');
  }
  session.setTiming(move.hfId, { start: move.start });
}
