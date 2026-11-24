import { decodedUrlPath } from '@hyperframes/parsers';
import { decodeAuthoredAttribute, scanHtmlOpeningTags } from '@hyperframes/parsers/html-attribute-spans';
import type { TimelineClipboardClip } from './clipboard-payload.ts';
import type { TrackPlacement } from './asset-track-layout.ts';
import type { ProjectEditCommand } from './commands.ts';

type Placement = {
  compositionPath: string;
  start: number;
  track: number;
  canvasPosition?: { left: number; top: number };
};
export type PasteCommand = { compositionPath: string; start: number; copyLook?: boolean } & (
  | { kind: 'pasteClips'; clips: TimelineClipboardClip[] }
  | { kind: 'pasteElement'; html: string; originSelector?: string; originSelectorIndex?: number }
);
export type ReplaceAsset = {
  kind: 'replaceAsset';
  compositionPath: string;
  hfId: string;
  assetPath: string;
  expectedAssetPath?: string;
};
export type ContentCommand =
  | PasteCommand
  | { kind: 'setBlockParameter'; compositionPath: string; key: string; value: string; previous?: string }
  | ReplaceAsset
  | (Placement &
      (
        | {
            kind: 'placeAsset';
            assetPath: string;
            hfId: string;
            duration: number;
            trackLayout?: TrackPlacement[];
            hasAudio?: boolean;
            zIndex?: number;
          }
        | { kind: 'insertComposition'; sourcePath: string }
      ));

const path = { type: 'string', minLength: 1, maxLength: 240 };
const nonnegative = { type: 'number', minimum: 0 };
const placement = {
  compositionPath: path,
  start: nonnegative,
  track: { type: 'integer' },
  canvasPosition: {
    type: 'object',
    properties: { left: { type: 'number' }, top: { type: 'number' } },
    required: ['left', 'top'],
    additionalProperties: false,
  },
};
export const contentCommandSchemas = [
  {
    type: 'object',
    properties: {
      kind: { enum: ['setBlockParameter'] },
      compositionPath: path,
      key: { type: 'string', minLength: 1, maxLength: 240 },
      previous: { type: 'string', maxLength: 524288 },
      value: { type: 'string', maxLength: 524288 },
    },
    required: ['kind', 'compositionPath', 'key', 'value'],
    additionalProperties: false,
  },
  {
    type: 'object',
    description:
      'Replace a clip with same-kind project media while preserving its timing, styles and animations.',
    properties: {
      kind: { enum: ['replaceAsset'] },
      compositionPath: path,
      assetPath: path,
      expectedAssetPath: path,
      hfId: { type: 'string', minLength: 1, maxLength: 100 },
    },
    required: ['kind', 'compositionPath', 'assetPath', 'hfId'],
    additionalProperties: false,
  },
  {
    type: 'object',
    description:
      'Place existing project media or a font on an authored track, at composition-local seconds. Use a unique hfId for the inserted clip.',
    properties: {
      ...placement,
      kind: { enum: ['placeAsset'] },
      assetPath: path,
      hfId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,100}$' },
      trackLayout: {
        type: 'array',
        maxItems: 1000,
        items: {
          type: 'object',
          properties: {
            target: {
              type: 'object',
              properties: {
                hfId: { type: 'string' },
                id: { type: ['string', 'null'] },
                selector: { type: 'string' },
                selectorIndex: { type: 'integer', minimum: 0 },
              },
              additionalProperties: false,
            },
            track: { type: 'integer' },
            start: nonnegative,
            duration: { type: 'number', exclusiveMinimum: 0 },
          },
          required: ['track', 'target'],
          additionalProperties: false,
        },
      },
      duration: { type: 'number', exclusiveMinimum: 0 },
      hasAudio: { type: 'boolean' },
      zIndex: { type: 'integer', minimum: 1 },
    },
    required: ['compositionPath', 'kind', 'assetPath', 'hfId', 'start', 'track', 'duration'],
    additionalProperties: false,
  },
  {
    type: 'object',
    description:
      'Place a project HTML composition on the timeline. Reads the saved child dimensions and duration, checks cycles and chooses an available track.',
    properties: { ...placement, kind: { enum: ['insertComposition'] }, sourcePath: path },
    required: ['compositionPath', 'kind', 'sourcePath', 'start', 'track'],
    additionalProperties: false,
  },
  {
    type: 'object',
    description: 'Paste saved clip snapshots at composition-local seconds, preserving relative offsets. Local asset and child composition URLs in each HTML snapshot are project-relative.',
    properties: {
      kind: { enum: ['pasteClips'] },
      compositionPath: path,
      start: nonnegative,
      copyLook: { type: 'boolean' },
      clips: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          properties: {
            html: { type: 'string', minLength: 1, maxLength: 524288 },
            start: nonnegative,
            duration: { type: 'number', exclusiveMinimum: 0 },
            track: { type: 'integer' },
          },
          required: ['html', 'start', 'duration', 'track'],
          additionalProperties: false,
        },
      },
    },
    required: ['kind', 'compositionPath', 'start', 'clips'],
    additionalProperties: false,
  },
  {
    type: 'object',
    description: 'Paste one saved element snapshot. Its local URLs are project-relative; copyLook also copies same-file styles and tweens that target its id.',
    properties: {
      kind: { enum: ['pasteElement'] },
      compositionPath: path,
      start: nonnegative,
      copyLook: { type: 'boolean' },
      html: { type: 'string', minLength: 1, maxLength: 524288 },
      originSelector: { type: 'string', maxLength: 1000 },
      originSelectorIndex: { type: 'integer', minimum: 0 },
    },
    required: ['kind', 'compositionPath', 'start', 'html'],
    additionalProperties: false,
  },
];

export function isContentCommand(command: ProjectEditCommand): command is ContentCommand {
  return (
    command.kind === 'setBlockParameter' ||
    command.kind === 'replaceAsset' ||
    command.kind === 'pasteClips' ||
    command.kind === 'pasteElement' ||
    command.kind === 'placeAsset' ||
    command.kind === 'insertComposition'
  );
}

export function contentDependencies(
  command: ContentCommand,
): readonly { path: string; type: 'text' | 'asset' }[] {
  if (command.kind === 'setBlockParameter') return [];
  if (command.kind === 'pasteClips' || command.kind === 'pasteElement') {
    const markup = command.kind === 'pasteClips' ? command.clips.map((clip) => clip.html) : [command.html];
    const paths = new Map<string, 'text' | 'asset'>();
    for (const html of markup) {
      for (const tag of scanHtmlOpeningTags(html)) {
        for (const attr of tag.attributes) {
          const composition = attr.name === 'data-composition-src';
          const media =
            (attr.name === 'src' && ['img', 'audio', 'video', 'source'].includes(tag.name)) ||
            (attr.name === 'poster' && tag.name === 'video');
          if (attr.kind !== 'value' || (!composition && !media)) continue;
          const url = decodeAuthoredAttribute(attr.value).trim();
          if (!url || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) continue;
          const path = decodedUrlPath(new URL(url, 'https://project.invalid/').pathname.slice(1));
          if (path && paths.get(path) !== 'text') paths.set(path, composition ? 'text' : 'asset');
        }
      }
    }
    return Array.from(paths, ([path, type]) => ({ path, type }));
  }
  return command.kind === 'replaceAsset' || command.kind === 'placeAsset'
    ? [{ path: command.assetPath, type: 'asset' }]
    : [{ path: command.sourcePath, type: 'text' }];
}

export function contentCommandLabel(command: ContentCommand) {
  if (command.kind === 'setBlockParameter') return 'Edit block parameter';
  if (command.kind === 'replaceAsset') return 'Replace clip media';
  if (command.kind === 'pasteElement') return 'Paste element';
  if (command.kind === 'pasteClips') return command.clips.length > 1 ? 'Paste clips' : 'Paste clip';
  return command.kind === 'placeAsset' ? 'Add timeline asset' : 'Add composition to timeline';
}
