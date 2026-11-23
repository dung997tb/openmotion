import { applyPatchByTarget, type PatchTarget } from './source-patcher.ts';
interface SpeedTarget {
  id: string;
  key?: string;
  tag: string;
  track: number;
}
const key = (el: SpeedTarget) => el.key ?? el.id;
export type SpeedRow = {
  element: SpeedTarget;
  target: PatchTarget;
  start: number;
  duration: number;
  rate: number;
  locked: boolean;
};
type Change = { row: SpeedRow; start: number; duration: number; rate?: number };
export function planSpeedChanges(
  rows: SpeedRow[],
  memberKeys: ReadonlySet<string>,
  main: number | null,
  rate: number,
  ripple: boolean,
  linkage: boolean,
) {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Speed must be greater than zero');
  const members = rows.filter((row) => memberKeys.has(key(row.element)));
  if (!members.length || members.some((row) => row.element.tag !== 'video' && row.element.tag !== 'audio'))
    throw new Error('Select a video or audio clip with editable timing');
  const changes = new Map<string, Change>();
  let limited = false;
  let rangeScale = 1;
  for (const row of members) {
    if (row.locked) throw new Error('Unlock linked clips before changing speed');
    const requestedDuration = (row.duration * row.rate) / rate;
    let duration = requestedDuration;
    if (!(ripple && row.element.tag !== 'audio' && row.element.track === main)) {
      const next = rows.filter(
        (other) =>
          !memberKeys.has(key(other.element)) &&
          other.element.track === row.element.track &&
          (other.element.tag === 'audio') === (row.element.tag === 'audio') &&
          other.start >= row.start + row.duration - 1e-6,
      );
      const boundary = Math.min(Infinity, ...next.map((other) => other.start));
      if (row.start + duration > boundary + 1e-6) {
        if (next.some((other) => other.locked && other.start < row.start + duration))
          throw new Error('Speed change would overlap a locked clip');
        duration = boundary - row.start;
        rangeScale = Math.min(rangeScale, duration / requestedDuration);
        limited = true;
      }
    }
    changes.set(key(row.element), { row, start: row.start, duration, rate });
  }
  // A gap restriction must not trim only one half of an aligned audio/video pair.
  if (limited)
    for (const change of changes.values())
      change.duration = ((change.row.duration * change.row.rate) / rate) * rangeScale;
  const mainEdits = [...changes.values()].filter(
    (change) => ripple && change.row.element.tag !== 'audio' && change.row.element.track === main,
  );
  for (const row of rows) {
    if (changes.has(key(row.element)) || row.element.tag === 'audio' || row.element.track !== main) continue;
    const delta = mainEdits
      .filter((change) => change.row.start + change.row.duration <= row.start + 1e-6)
      .reduce((sum, change) => sum + change.duration - change.row.duration, 0);
    if (Math.abs(delta) < 1e-6) continue;
    if (row.locked) throw new Error('Speed change would move a locked clip');
    changes.set(key(row.element), { row, start: row.start + delta, duration: row.duration });
    if (!linkage) continue;
    for (const overlay of rows) {
      if (
        overlay.element.track === main ||
        overlay.element.tag === 'audio' ||
        overlay.locked ||
        changes.has(key(overlay.element))
      )
        continue;
      if (overlay.start >= row.start && overlay.start < row.start + row.duration)
        changes.set(key(overlay.element), {
          row: overlay,
          start: overlay.start + delta,
          duration: overlay.duration,
        });
    }
  }
  return {
    limited,
    apply: (source: string) => {
      for (const change of changes.values()) {
        for (const [property, value] of Object.entries({
          start: change.start,
          duration: change.duration,
          'playback-rate': change.rate,
        })) {
          if (value === undefined) continue;
          source = applyPatchByTarget(source, change.row.target, {
            type: 'attribute',
            property,
            value: String(Math.round(value * 1e6) / 1e6),
          });
        }
      }
      return source;
    },
  };
}
