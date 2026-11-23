import type { CanvasCommand } from './canvas-commands.ts';
import type { ContentCommand } from './content-commands.ts';
import type { MoveClip } from './index.ts';
import type { TimelineCommand } from './timeline-commands.ts';
import { isCanvasCommand } from './canvas-schema.ts';
import { isContentCommand } from './content-schema.ts';
import { isTimelineCommand } from './timeline-schema.ts';

export type BeatGridCommand = { kind: 'setBeatGrid'; assetPath: string; beats: { time: number; strength: number }[] };
export type GradeMedia = { kind: 'gradeMedia'; value: string | null };
export type ProjectEditCommand = BeatGridCommand | GradeMedia | MoveClip | TimelineCommand | CanvasCommand | ContentCommand;
export type CompositionEdit = ProjectEditCommand & { compositionPath: string };

type RequestedEdit = CompositionEdit | BeatGridCommand;
export type EditRequest = RequestedEdit | { kind: 'batch'; commands: RequestedEdit[] };

export function locateEdit(command: RequestedEdit): CompositionEdit {
  if (command.kind !== 'setBeatGrid') return command;
  const path = 'beats/' + command.assetPath + '.json';
  if ('compositionPath' in command && command.compositionPath !== path) throw new Error('Beat grid path does not match the audio source');
  return { ...command, compositionPath: path };
}

/** Applies one intent to the caller's current source. Persistence belongs to the caller. */
export async function applyProjectEdit(source: string, command: CompositionEdit, inputs: ReadonlyMap<string, string>) {
  if (command.kind === 'setBeatGrid') {
    const { writeBeatGrid } = await import('./beat-file.ts');
    return { content: writeBeatGrid(command.assetPath, command.beats), label: 'Edit beat markers' };
  }
  if (command.kind === 'gradeMedia') {
    const { patchMediaColorGradingInHtml } = await import('./color-grading.ts');
    return { content: patchMediaColorGradingInHtml(source, command.value).html, label: command.value ? 'Apply color grading' : 'Clear color grading' };
  }
  if (isCanvasCommand(command)) {
    const { applyCanvasCommand, canvasCommandLabel } = await import('./canvas-commands.ts');
    return { content: await applyCanvasCommand(source, command), label: canvasCommandLabel(command) };
  }
  if (isContentCommand(command)) {
    const { applyContentCommand, contentCommandLabel } = await import('./content-commands.ts');
    return { content: await applyContentCommand(source, command, inputs), label: contentCommandLabel(command) };
  }
  if (isTimelineCommand(command)) {
    const { applyTimelineCommand, timelineCommandLabel } = await import('./timeline-commands.ts');
    return { content: await applyTimelineCommand(source, command), label: timelineCommandLabel(command) };
  }
  if (command.kind !== 'moveClip') throw new Error('Unknown project edit');
  const { applyLegacyClipMove } = await import('./index.ts');
  return { content: await applyLegacyClipMove(source, command), label: 'Move timeline clip' };
}
