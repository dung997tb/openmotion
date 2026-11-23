type ClipMove = { hfId: string; start: number; track?: number; clearAudioGroup?: boolean };
type ClipTrim = { hfId: string; start: number; duration: number; playbackStart?: number };
export type ClipStacking = { hfId: string; direction: "up" | "down" } | { ranks: { hfId: string; zIndex: number }[] };
export type TimelineCommand =
  | { kind: 'moveClips'; changes: ClipMove[]; includeLinked?: boolean; stacking?: ClipStacking }
  | { kind: 'trimClips'; changes: ClipTrim[]; includeLinked?: boolean }
  | {
      kind: 'splitClips';
      hfIds: string[];
      at: number;
      measured?: Array<{ hfId: string; start: number; duration: number; track?: number }>;
    }
  | { kind: 'deleteClips'; hfIds: string[]; rippleTrack?: number }
  | { kind: 'linkClips' | 'unlinkClips'; hfIds: string[] }
  | { kind: 'setClipState'; hfIds: string[]; state: 'locked' | 'hidden' | 'muted'; enabled: boolean }
  | { kind: 'detachAudio' | 'moveIntoSync' | 'slipIntoSync'; hfId: string }
  | {
      kind: 'setClipSpeed';
      hfId: string;
      rate: number;
      includeLinked?: boolean;
      ripple?: boolean;
      linkage?: boolean;
    }
  | { kind: 'mergeAudio'; videoId: string; audioId: string }
  | { kind: 'closeTrackGaps'; track: number; at?: number };

const id = { type: 'string', minLength: 1, maxLength: 100 };
const seconds = { type: 'number', minimum: 0 };
const track = { type: 'integer' };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const array = (items: unknown) => ({ type: 'array', items, minItems: 1, maxItems: 200 });
const hfIds = { ...array(id), uniqueItems: true };
const schema = (
  kind: TimelineCommand['kind'],
  properties: Record<string, unknown>,
  optional: Record<string, unknown> = {},
) =>
  object(
    {
      kind: { enum: [kind] },
      compositionPath: { type: 'string', minLength: 1, maxLength: 240 },
      ...properties,
      ...optional,
    },
    ['kind', 'compositionPath', ...Object.keys(properties)],
  );
export const timelineCommandSchemas = [
  schema(
    'moveClips',
    {
      changes: { ...array(
        object({ hfId: id, start: seconds, track, clearAudioGroup: { type: 'boolean' } }, ['hfId', 'start']),
      ), minItems: 0 },
    },
    { includeLinked: { type: 'boolean' }, stacking: { oneOf: [
        object({ hfId:id, direction:{enum:['up','down']} }, ['hfId','direction']),
        object({ ranks: array(object({hfId:id,zIndex:{type:'integer'}},['hfId','zIndex'])) }, ['ranks']),
      ] } },
  ),
  schema(
    'trimClips',
    {
      changes: array(
        object(
          {
            hfId: id,
            start: seconds,
            duration: { type: 'number', exclusiveMinimum: 0 },
            playbackStart: seconds,
          },
          ['hfId', 'start', 'duration'],
        ),
      ),
    },
    { includeLinked: { type: 'boolean' } },
  ),
  schema(
    'splitClips',
    { hfIds, at: seconds },
    {
      measured: array(
        object({ hfId: id, start: seconds, duration: { type: 'number', exclusiveMinimum: 0 }, track }, [
          'hfId',
          'start',
          'duration',
        ]),
      ),
    },
  ),
  schema('deleteClips', { hfIds }, { rippleTrack: track }),
  schema('linkClips', { hfIds }),
  schema('unlinkClips', { hfIds }),
  schema('setClipState', {
    hfIds,
    state: { enum: ['locked', 'hidden', 'muted'] },
    enabled: { type: 'boolean' },
  }),
  schema(
    'setClipSpeed',
    { hfId: id, rate: { type: 'number', exclusiveMinimum: 0 } },
    {
      includeLinked: { type: 'boolean' },
      ripple: { type: 'boolean' },
      linkage: { type: 'boolean' },
    },
  ),
  schema('detachAudio', { hfId: id }),
  schema('moveIntoSync', { hfId: id }),
  schema('slipIntoSync', { hfId: id }),
  schema('mergeAudio', { videoId: id, audioId: id }),
  schema('closeTrackGaps', { track }, { at: seconds }),
];
export const timelineKinds = timelineCommandSchemas.map(
  (item) => (item.properties.kind as { enum: string[] }).enum[0]!,
);
export const isTimelineCommand = (command: { kind: string }): command is TimelineCommand =>
  timelineKinds.includes(command.kind);
