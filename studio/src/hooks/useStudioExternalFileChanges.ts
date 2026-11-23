import { useCallback, useMemo, type MutableRefObject } from "react";
import { changedFilePaths, readFileChangeAffectsPreview } from "../components/editor/manualEditsParsing";
import { syncPeerComposition } from "./syncPeerComposition";
import { createRemoteFileReader } from "./remoteFileReads";
import { knownCompositionSource } from "../player/lib/compositionPosterSource";
import { usePlayerStore } from "../player/store/playerStore";
import { clearStudioSaveFailures } from "../utils/studioSaveState";
import {
  deleteExternalConflictSnapshot,
  loadExternalConflictSnapshot,
  persistExternalConflictSnapshot,
  persistExternalFailureSnapshot,
} from "../utils/externalConflictStorage";
import { notifyExternalFileReload } from "./externalFileReloadBus";
import { useExternalFileChangeCoordinator } from "./useExternalFileChangeCoordinator";
import type { useFileManager } from "./useFileManager";
import type { usePreviewPersistence } from "./usePreviewPersistence";

type FileManager = Pick<
  ReturnType<typeof useFileManager>,
  | "editingFile"
  | "flushPendingSourceSave"
  | "discardPendingSourceSave"
  | "getPendingSourceCandidate"
  | "overwriteExternalConflict"
  | "readProjectFile"
  | "updateEditingFileContent"
  | "refreshOpenSource"
  | "refreshFileTree"
>;

type PreviewPersistence = Pick<
  ReturnType<typeof usePreviewPersistence>,
  "drainPendingDomEditSaves" | "resetDomEditSaveQueueBreaker"
>;

interface UseStudioExternalFileChangesOptions {
  projectId: string | null;
  activeCompPath: string | null;
  masterCompPath: string | null;
  previewIframeRef: MutableRefObject<HTMLIFrameElement | null>;
  fileManager: FileManager;
  previewPersistence: PreviewPersistence;
  pendingTimelineEditPathRef: MutableRefObject<Set<string>>;
  reloadPreview: (path?: string) => void;
  onOutsideChange?: () => void;
  onHistoryChanged?: (writeToken?: string) => void | Promise<void>;
}

/** Connects the app's save queues, recovery storage, and reload surfaces to one owner. */
export function useStudioExternalFileChanges({
  projectId,
  activeCompPath,
  masterCompPath,
  previewIframeRef,
  fileManager,
  previewPersistence,
  pendingTimelineEditPathRef,
  reloadPreview,
  onOutsideChange,
  onHistoryChanged,
}: UseStudioExternalFileChangesOptions) {
  const { flushPendingSourceSave, discardPendingSourceSave } = fileManager;
  const { drainPendingDomEditSaves, resetDomEditSaveQueueBreaker } = previewPersistence;
  const bumpThumbnailRevisions = usePlayerStore((state) => state.bumpThumbnailRevisions);
  const onAcceptedPersistedFileChange = useCallback(
    (path: string, affectedCompositions: readonly string[] | null) => {
      onOutsideChange?.();
      bumpThumbnailRevisions(affectedCompositions, path);
    },
    [bumpThumbnailRevisions, onOutsideChange],
  );
  const filesForChange = useMemo(() => createRemoteFileReader(), []);
  const refreshFileViews = useCallback((payload: unknown, acceptChange: () => void) => {
    const activePath = activeCompPath ?? masterCompPath;
    const previous = projectId && activePath
      ? knownCompositionSource(usePlayerStore.getState(), projectId, activePath)
      : null;
    // Capture the displayed source first. All readers below belong to the new thumbnail revision.
    acceptChange();
    if (!projectId) return;
    const paths = changedFilePaths(payload);
    const read = filesForChange(projectId, payload);
    const preview = readFileChangeAffectsPreview(payload)
      ? syncPeerComposition(projectId, activePath, paths, read, previewIframeRef, previous)
      : undefined;
    for (const path of paths ?? ["."]) {
      notifyExternalFileReload(path, read);
      fileManager.refreshOpenSource(path, read);
    }
    return preview;
  }, [projectId, activeCompPath, masterCompPath, previewIframeRef, filesForChange, fileManager.refreshOpenSource]);

  const drainPendingChanges = useCallback(async () => {
    const source = await flushPendingSourceSave();
    if (source.status !== "clean") return source;
    return drainPendingDomEditSaves();
  }, [drainPendingDomEditSaves, flushPendingSourceSave]);

  const discardPendingChanges = useCallback(() => {
    discardPendingSourceSave();
    resetDomEditSaveQueueBreaker();
    if (projectId) clearStudioSaveFailures(projectId);
  }, [discardPendingSourceSave, resetDomEditSaveQueueBreaker, projectId]);

  return useExternalFileChangeCoordinator({
    projectId,
    activeCompPath,
    recoveryFilePath: fileManager.editingFile?.path ?? activeCompPath ?? masterCompPath,
    pendingTimelineEditPathRef,
    drainPendingChanges,
    getPendingCandidate: fileManager.getPendingSourceCandidate,
    discardPendingChanges,
    reloadPreview,
    refreshFileViews,
    persistConflictSnapshot: persistExternalConflictSnapshot,
    persistFailureSnapshot: persistExternalFailureSnapshot,
    loadConflictSnapshot: loadExternalConflictSnapshot,
    deleteConflictSnapshot: deleteExternalConflictSnapshot,
    overwriteConflict: fileManager.overwriteExternalConflict,
    readProjectFile: fileManager.readProjectFile,
    onUseExternalFile: fileManager.updateEditingFileContent,
    resetSaveQueues: resetDomEditSaveQueueBreaker,
    onAcceptedPersistedFileChange,
    refreshFileTree: fileManager.refreshFileTree,
    onHistoryChanged,
  });
}
