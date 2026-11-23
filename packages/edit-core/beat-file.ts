import { serializeBeats } from '@hyperframes/core/beats';
import type { UserBeat } from './beat-grid.ts';

/** Times are seconds in the source audio, independent of timeline placement. */
export function writeBeatGrid(audio: string, beats: readonly UserBeat[]): string {
  const ordered = [...beats].sort((left, right) => left.time - right.time);
  return serializeBeats(ordered.map(beat => beat.time), ordered.map(beat => beat.strength), audio);
}
