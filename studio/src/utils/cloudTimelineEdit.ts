import type { TimelineElement } from '../player/store/timelineElement';
import { toAuthoredStart } from '../player/store/timelineElement';
import type { CanvasCommand, CanvasElementPatch } from '../../../packages/edit-core/canvas-schema';

import { applyLegacyClipMove, type MoveClip } from '../../../packages/edit-core';
import type { TimelineCommand } from '../../../packages/edit-core/timeline-schema';
import type { RecordEditInput } from './studioFileHistory';
import { readProjectFileContent } from './studioFileHistory';
import { serializeStudioFileMutations } from './studioFileMutationCoordinator';
import { commitStudioEditBatch } from './projectEditBatch';

type Writer = import('./studioFileHistory').ProjectFileWriter;
type ClipLocator = { hfId?: string; domId?: string; selector?: string; selectorIndex?: number };
type ResolveClip = (clip: ClipLocator) => string;
export type TimelineFileEdit = {
  path: string;
  command: TimelineCommand | MoveClip | ((resolve: ResolveClip) => TimelineCommand | MoveClip);
};

export type TimelinePaintPlan =
  | { ranks: { element: ClipLocator & { sourceFile?: string }; zIndex: number; makeRelative?: boolean }[] }
  | { element: TimelineElement; direction: 'up' | 'down' };

type TimingChange = {
  element: TimelineElement;
  start: number;
  track?: number;
  audioGroup?: null;
  duration?: number;
  playbackStart?: number;
};

/** Group timing and paint targets by their authored file. Identifiers from older projects resolve against the saved source. */
export function timelineTimingEdits(
  changes: TimingChange[],
  activePath: string | null,
  paint?: TimelinePaintPlan,
): TimelineFileEdit[] {
  const path = (el: { sourceFile?: string }) => el.sourceFile || activePath || 'index.html';
  const paths = new Set(changes.map((c) => path(c.element)));
  if (paint && 'ranks' in paint) for (const rank of paint.ranks) paths.add(path(rank.element));
  return [...paths].map((file) => ({
    path: file,
    command: (resolve) => {
      const local = changes.filter((c) => path(c.element) === file);
      if (local.some((c) => c.duration !== undefined))
        return {
          kind: 'trimClips',
          changes: local.map((c) => ({
            hfId: resolve(c.element),
            start: toAuthoredStart(c.element, c.start),
            duration: c.duration!,
            playbackStart: c.playbackStart,
          })),
        };
      const ranks = paint && 'ranks' in paint ? paint.ranks.filter((r) => path(r.element) === file) : [];
      const stacking = ranks.length
        ? {
            ranks: ranks.map((r) => ({
              hfId: resolve(r.element),
              zIndex: r.zIndex,
              makeRelative: r.makeRelative,
            })),
          }
        : paint && 'element' in paint && path(paint.element) === file
          ? { hfId: resolve(paint.element), direction: paint.direction }
          : undefined;
      return {
        kind: 'moveClips',
        changes: local.map((c) => ({
          hfId: resolve(c.element),
          start: toAuthoredStart(c.element, c.start),
          track: c.track,
          ...(c.audioGroup === null && { clearAudioGroup: true }),
        })),
        stacking,
      };
    },
  }));
}

export async function saveCloudTimeline(
  projectId: string,
  edits: TimelineFileEdit[],
  write: Writer,
  recordEdit: (entry: RecordEditInput) => Promise<void>,
  label: string,
  onSaved?: (files: RecordEditInput['files']) => Promise<void>,
  onSkippedSelectors?: (selectors: string[]) => void,
): Promise<string[]> {
  return serializeStudioFileMutations(
    write,
    edits.map((edit) => edit.path),
    async () => {
      const { applyTimelineCommand } = await import('../../../packages/edit-core/timeline-commands');
      const { findTargetElement, parseSourceDocument } =
        await import('@hyperframes/studio-server/source-mutation');
      const pending = await Promise.all(
        edits.map(async (edit) => {
          const before = await readProjectFileContent(projectId, edit.path);
          let doc: Document | undefined;
          const resolve: ResolveClip = (locator) => {
            if (locator.hfId) return locator.hfId;
            if (!locator.domId && !locator.selector)
              throw new Error('This preview-only item has no authored source to edit.');
            doc ??= parseSourceDocument(before).document;
            if (
              locator.domId &&
              Array.from(doc.querySelectorAll('[id]')).filter((el) => el.id === locator.domId).length > 1
            )
              throw new Error('The source contains multiple clips with this ID.');
            if (
              !locator.domId &&
              locator.selector &&
              locator.selectorIndex === undefined &&
              doc.querySelectorAll(locator.selector).length > 1
            )
              throw new Error('The source contains multiple clips matching this selector.');
            const el = findTargetElement(doc, {
              id: locator.domId,
              selector: locator.selector,
              selectorIndex: locator.selectorIndex,
            });
            const id = el?.getAttribute('data-hf-id');
            if (!id) throw new Error('This preview-only item has no authored source to edit.');
            return id;
          };
          const command = typeof edit.command === 'function' ? edit.command(resolve) : edit.command;
          return {
            path: edit.path,
            command,
            before,
            after:
              command.kind === 'moveClip'
                ? await applyLegacyClipMove(before, command)
                : applyTimelineCommand(before, command, onSkippedSelectors),
          };
        }),
      );
      const changes = pending.filter((file) => file.before !== file.after);
      if (!changes.length) return [];
      const [only] = changes;
      const needsRefresh = changes.length === 1 && only
        ? Boolean(await write(only.path, only.after, only.before, only.command))
        : (await commitStudioEditBatch(projectId, changes))?.length;

      const files = Object.fromEntries(changes.map(({ path, before, after }) => [path, { before, after }]));
      await recordEdit({ label, files });
      if (onSaved && !needsRefresh) await onSaved(files);
      return Object.keys(files);
    },
  );
}

/** Timeline controls use the same element-property command as the inspector. */
export function timelineAttributeCommand(
  values: Array<{ target: CanvasElementPatch['target']; value: string | null }>,
  attribute: string,
): Extract<CanvasCommand, { kind: 'editElements' }> {
  const property = attribute === 'muted' || attribute.startsWith('data-') ? attribute : 'data-' + attribute;
  return {
    kind: 'editElements',
    patches: values.map(({ target, value }) => ({
      target,
      operations: [{ type: 'html-attribute', property, value }],
    })),
  };
}
