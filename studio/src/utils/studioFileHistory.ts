import { readVersionedSource } from "./readVersionedSource";
import { confirmedSource, observeSourceRead } from "./confirmedTextSources";
import { tryStudioTextEdit } from "./studioTextEdits";
import type { RebasedFileEdit } from "./rebasedFileEdit";
import type { ProjectEditCommand } from "../../../packages/edit-core/commands";
import { getCachedCloudDisklessMode } from "./cloudRuntime";
import type { HistoryTarget } from "@hyperframes/studio-server";
import { buildProjectApiPath } from "./projectRouting";
import type { MutableRefObject } from "react";
import { serializeStudioFileMutations } from "./studioFileMutationCoordinator";
import { createStudioSaveHttpError } from "./studioSaveDiagnostics";

export type EditContextTarget = HistoryTarget;

export interface RecordEditInput {
  targets?: EditContextTarget[];
  label: string;
  coalesceKey?: string;
  coalesceMs?: number;
  files: Record<string, { before: string; after: string }>;
  created?: string[];
}

export interface DomEditCommitBaseParams {
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: ProjectFileWriter;
  editHistory: { recordEdit: (entry: RecordEditInput) => Promise<void> };
  projectIdRef: MutableRefObject<string | null>;
  reloadPreview: () => void;
  clearDomSelection: () => void;
}

export type StudioWriteHistory = { label: string; windowId: string };
export interface ProjectFileWriter {
  (path: string, content: string, expectedContent?: string): Promise<void>;
  (path: string, content: string, expectedContent: string | undefined, command: ProjectEditCommand | undefined, history?: StudioWriteHistory): Promise<void | RebasedFileEdit>;
}

const lastWindow = new WeakMap<ProjectFileWriter, { key: string | undefined; id: string; startedAt: number }>();

/** A writer belongs to one Studio project. A different gesture starts a new history entry. */
export function studioHistoryForWrite(writer: ProjectFileWriter, label: string, key?: string, coalesceMs = 4000): StudioWriteHistory {
  const now = Date.now();
  const previous = lastWindow.get(writer);
  if (key && previous?.key === key && now - previous.startedAt < coalesceMs) return { label, windowId: previous.id };
  const id = crypto.randomUUID();
  lastWindow.set(writer, { key, id, startedAt: now });
  return { label, windowId: id };
}

type HistoryGesture = Pick<RecordEditInput, "label" | "coalesceKey" | "coalesceMs">;

export function cloudHistoryForWrite(writer: ProjectFileWriter | undefined, gesture: HistoryGesture): StudioWriteHistory | undefined {
  if (!writer || !getCachedCloudDisklessMode()) return undefined;
  return studioHistoryForWrite(writer, gesture.label, gesture.coalesceKey, gesture.coalesceMs);
}

interface SaveProjectFilesWithHistoryInput {
  projectId: string;
  label: string;
  coalesceKey?: string;
  coalesceMs?: number;
  files: Record<string, (contentInsideFileQueue: string) => string>;
  commandForWrite?: (path: string) => ProjectEditCommand | undefined;
  readFile: (path: string) => Promise<string>;
  writeFile: ProjectFileWriter;
  recordEdit: (entry: RecordEditInput) => Promise<void>;
  /**
   * What a path holds ON DISK right now, when that is not the same as the
   * history's "before".
   *
   * The two are normally one value, so the write's optimistic-concurrency
   * expectation was taken straight from the undo baseline. They come apart when
   * a server-side mutation has already written part of the edit: deleting a clip
   * POSTs `remove-element`, which rewrites the file, and only then saves the
   * duration shrink — expecting the pre-delete content it read at the start. The
   * server had moved the file on, so the write was refused as a conflict, the
   * save queue paused, and the clip stayed on the timeline until a reload.
   *
   * Undo still restores `before`; this only says what to expect on disk.
   */
  diskContent?: Record<string, string>;
}

export async function readProjectFileContent(pid: string, path: string): Promise<string> {
  const response = await readVersionedSource(
    buildProjectApiPath(pid, `/files/${encodeURIComponent(path)}`),
    confirmedSource(pid, path),
  );
  if (!response.ok) {
    throw await createStudioSaveHttpError(response, `Failed to read ${path}`);
  }
  const data = (await response.json()) as { content?: string };
  if (typeof data.content !== "string") {
    throw new Error(`Missing file contents for ${path}`);
  }
  observeSourceRead(pid, path, response, data);
  return data.content;
}

export async function saveProjectFilesWithHistory(
  input: SaveProjectFilesWithHistoryInput,
): Promise<string[]> {
  return serializeStudioFileMutations(input.writeFile, Object.keys(input.files), () =>
    writeProjectFilesWithHistoryInQueue(input),
  );
}

/**
 * A server-side rewrite and its undo entry, holding the file's queue from the read to the history write.
 * `rewrite` returns what the server left on disk (and the edit's final content if it goes further), or null.
 */
export async function saveServerRewriteWithHistory(input: {
  projectId: string;
  path: string;
  label: string;
  coalesceKey?: string;
  coalesceMs?: number;
  writeFile: ProjectFileWriter;
  recordEdit: (entry: RecordEditInput) => Promise<void>;
  rewrite: (original: string, history?: StudioWriteHistory) => Promise<{ disk: string; after?: string } | null>;
}): Promise<boolean> {
  const { projectId, path, writeFile } = input;
  return serializeStudioFileMutations(writeFile, [path], async () => {
    const original = await readProjectFileContent(projectId, path);
    const history = cloudHistoryForWrite(writeFile, input);
    const result = await input.rewrite(original, history);
    if (!result) return false;
    await writeProjectFilesWithHistoryInQueue({
      ...input,
      files: { [path]: () => result.after ?? result.disk },
      readFile: async () => original,
      diskContent: { [path]: result.disk },
    }, history);
    return true;
  });
}

export async function writeProjectFilesWithHistoryInQueue({
  projectId,
  label,
  coalesceKey,
  coalesceMs,
  files,
  readFile,
  writeFile,
  recordEdit,
  diskContent,
  commandForWrite,
}: SaveProjectFilesWithHistoryInput, existingHistory?: StudioWriteHistory): Promise<string[]> {
  const snapshots: Record<string, { before: string; after: string }> = {};
  for (const [path, build] of Object.entries(files)) {
    const before = await readFile(path);
    const after = build(before);
    if (before !== after) {
      snapshots[path] = { before, after };
    }
  }

  const changedPaths = Object.keys(snapshots);
  if (changedPaths.length === 0) return [];

  const history = existingHistory ?? cloudHistoryForWrite(writeFile, { label, coalesceKey, coalesceMs });
  if (changedPaths.length > 1 && !commandForWrite) {
    const sources = changedPaths.map(path => ({ path, before: diskContent?.[path] ?? snapshots[path].before, after: snapshots[path].after }));
    if (await tryStudioTextEdit(projectId, sources, history)) {
      await recordEdit({ label, coalesceKey, coalesceMs, files: snapshots });
      return changedPaths;
    }
  }
  if (changedPaths.length > 1 && commandForWrite) {
    const edits = changedPaths.flatMap(path => {
      const command = commandForWrite(path);
      return command ? [{ path, before: diskContent?.[path] ?? snapshots[path].before, after: snapshots[path].after, command }] : [];
    });
    if (edits.length === changedPaths.length) {
      const { commitStudioEditBatch } = await import('./projectEditBatch');
      await commitStudioEditBatch(projectId, edits, history);
      await recordEdit({ label, coalesceKey, coalesceMs, files: snapshots });
      return changedPaths;
    }
  }

  const writtenPaths: string[] = [];
  try {
    for (const path of changedPaths) {
      const expected = diskContent?.[path] ?? snapshots[path].before;
      const command = commandForWrite?.(path);
      if (history) await writeFile(path, snapshots[path].after, expected, command, history);
      else if (command) await writeFile(path, snapshots[path].after, expected, command);
      else await writeFile(path, snapshots[path].after, expected);
      writtenPaths.push(path);
    }

    await recordEdit({ label, coalesceKey, coalesceMs, files: snapshots });
  } catch (error) {
    try {
      for (const path of writtenPaths.reverse()) {
        await writeFile(path, snapshots[path].before, snapshots[path].after);
      }
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Failed to save project files and rollback did not complete",
      );
    }
    throw error;
  }
  return changedPaths;
}
