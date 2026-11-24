import { useCallback, useEffect, useRef } from "react";
import { createTypingSave } from "../utils/typingSave";
import { addStudioPendingEditFlushListener } from "../utils/studioPendingEdits";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import {
  StudioFileConflictError,
  buildStudioSaveFailureProperties,
  trackStudioSaveFailure,
  type StudioSaveDrainResult,
} from "../utils/studioSaveDiagnostics";

const FAILURE_BURST_MS = 5_000;

interface RecordEditInput {
  label: string;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UseEditorSaveOptions {
  editingFileRef: React.RefObject<{ path: string; content: string | null } | null>;
  projectIdRef: React.RefObject<string | null>;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  showToast: (message: string, tone?: "error" | "info") => void;
}

export interface EditorSaveCandidate {
  projectId: string;
  path: string;
  content: string;
}

// Keystrokes buffered behind an in-flight save share the last accepted source.
type SourceSession = {
  queue: ReturnType<typeof createTypingSave>;
  baseline: string;
  writing?: { submitted: string; accepted: string };
  draft: EditorSaveCandidate | null;
  failure?: StudioSaveDrainResult;
};

export type EditorSaveDrainResult = StudioSaveDrainResult;

export interface EditorSaveHandle {
  handleContentChange: (content: string) => void;
  acknowledgeSource: (projectId: string, path: string, submitted: string, accepted: string) => void;
  /** Read by the external-reload reconciliation introduced in stack PR #2993. */
  getPendingCandidate: () => EditorSaveCandidate | null;
  /** Wired into the external-reload drain by stack PR #2993. */
  flushPendingSave: () => Promise<EditorSaveDrainResult>;
  /** Used by PR #2993 when the external version wins. */
  discardPendingSave: () => void;
}

export function useEditorSave({
  editingFileRef,
  projectIdRef,
  writeProjectFile,
  recordEdit,
  setRefreshKey,
  showToast,
}: UseEditorSaveOptions): EditorSaveHandle {
  const refreshRafRef = useRef<number | null>(null);
  // One error toast per burst of failures — every keystroke retries the save,
  // and error toasts persist until dismissed, so don't stack duplicates.
  const lastFailureToastAtRef = useRef<number | null>(null);
  const lastFailureReportRef = useRef<{ fingerprint: string; emittedAt: number } | null>(null);
  const sessions = useRef(new Map<string, SourceSession>());
  const projectId = projectIdRef.current;
  const path = editingFileRef.current?.path;
  const fileKey = JSON.stringify([projectId, path]);

  const reportFailure = useCallback(
    (path: string, error: unknown) => {
      const now = Date.now();
      const properties = buildStudioSaveFailureProperties({
        source: "code_editor",
        error,
        filePath: path,
      });
      const errorName = error instanceof Error ? error.name : typeof error;
      const fingerprint = JSON.stringify([
        path,
        errorName,
        properties.error_message,
        properties.status_code,
      ]);
      const previous = lastFailureReportRef.current;
      if (
        previous === null ||
        previous.fingerprint !== fingerprint ||
        now - previous.emittedAt >= FAILURE_BURST_MS
      ) {
        trackStudioSaveFailure({ source: "code_editor", error, filePath: path });
        lastFailureReportRef.current = { fingerprint, emittedAt: now };
      }
      if (
        lastFailureToastAtRef.current === null ||
        now - lastFailureToastAtRef.current >= FAILURE_BURST_MS
      ) {
        lastFailureToastAtRef.current = now;
        showToast(
          `Couldn't save ${path}. Your latest edits are NOT persisted. Check the preview server; editing again retries the save.`,
          "error",
        );
      }
    },
    [showToast],
  );

  const handleContentChange = useCallback((content: string) => {
    const pid = projectIdRef.current;
    const open = editingFileRef.current;
    if (!pid || open?.content == null) return;
    const key = JSON.stringify([pid, open.path]);
    const session: SourceSession = sessions.current.get(key) ?? {
      queue: createTypingSave(), baseline: open.content, draft: null,
    };
    sessions.current.set(key, session);
    const candidate = { projectId: pid, path: open.path, content };
    session.draft = candidate;
    session.failure = undefined;
    // The closure owns the original file, project writer, and accepted baseline.
    session.queue.schedule(async () => {
      session.writing = { submitted: content, accepted: content };
      try {
        await saveProjectFilesWithHistory({
          projectId: pid, label: "Edit source", coalesceKey: `source:${open.path}`,
          continuous: true,
          files: { [open.path]: () => content },
          readFile: async () => session.baseline,
          writeFile: writeProjectFile,
          onFileWritten: (_, submitted) => {
            const write = session.writing;
            session.baseline = write?.submitted === submitted ? write.accepted : submitted;
          },
          recordEdit,
        });
        session.failure = undefined;
        if (sessions.current.get(key) === session && session.draft === candidate) sessions.current.delete(key);
        lastFailureReportRef.current = null;
        if (refreshRafRef.current != null) cancelAnimationFrame(refreshRafRef.current);
        refreshRafRef.current = requestAnimationFrame(() => setRefreshKey(k => k + 1));
      } catch (error) {
        if (error instanceof StudioFileConflictError && error.syncLatest) {
          session.queue.cancel();
          if (sessions.current.get(key) === session) sessions.current.delete(key);
          showToast(error.message, "error");
          return;
        }
        reportFailure(open.path, error);
        session.failure = error instanceof StudioFileConflictError
          ? { status: "conflict", error } : { status: "failed", error };
      } finally {
        session.writing = undefined;
      }
    });
  }, [editingFileRef, projectIdRef, recordEdit, reportFailure, setRefreshKey, showToast, writeProjectFile]);

  const getPendingCandidate = useCallback(() =>
    sessions.current.get(JSON.stringify([projectIdRef.current, editingFileRef.current?.path]))?.draft ?? null,
  [projectIdRef, editingFileRef]);

  const flushPendingSave = useCallback(async (): Promise<EditorSaveDrainResult> => {
    const session = sessions.current.get(JSON.stringify([projectIdRef.current, editingFileRef.current?.path]));
    if (!session) return { status: "clean" };
    if (session.failure && session.draft && !session.queue.busy()) handleContentChange(session.draft.content);
    await session.queue.flush();
    return session.failure ?? { status: "clean" };
  }, [projectIdRef, editingFileRef, handleContentChange]);

  const discardPendingSave = useCallback(() => {
    const key = JSON.stringify([projectIdRef.current, editingFileRef.current?.path]);
    sessions.current.get(key)?.queue.cancel();
    sessions.current.delete(key);
  }, [projectIdRef, editingFileRef]);

  useEffect(() => () => { void sessions.current.get(fileKey)?.queue.flush(); }, [fileKey]);

  useEffect(() => addStudioPendingEditFlushListener(() => {
    if (!getPendingCandidate()) return;
    return flushPendingSave().then(result => { if (result.status !== 'clean') throw result.error; });
  }), [flushPendingSave, getPendingCandidate]);

  const acknowledgeSource = useCallback((pid: string, path: string, submitted: string, accepted: string) => {
    const session = sessions.current.get(JSON.stringify([pid, path]));
    if (session?.writing) session.writing = { submitted, accepted };
  }, []);

  return { handleContentChange, acknowledgeSource, getPendingCandidate, flushPendingSave, discardPendingSave };
}
