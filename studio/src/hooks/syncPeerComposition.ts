import type { RefObject } from "react";
import { shareCompositionPosterRead, type KnownCompositionSource, MAX_POSTER_SOURCE_LENGTH } from "../player/lib/compositionPosterSource";
import { beginPeerTimelineUpdate } from "../player/lib/peerTimeline";
import { hasPeerTimingDocument, tryApplyPeerChanges } from "../player/peerTimingPreview";
import { isPreviewChanging } from "../player/previewReloading";
import { announcePreviewScenesSwapped, notePeerPreviewChange, previewSourceRevision } from "../player/sceneSwap";
import { usePlayerStore } from "../player/store/playerStore";
import { isStudioEditSaving } from "../utils/studioPendingEdits";
import type { RemoteFileRead } from "./remoteFileReads";

/** Project the latest source immediately. Only a verified in-place preview can waive a refresh. */
export function syncPeerComposition(
  projectId: string, path: string | null, paths: readonly string[] | null,
  read: RemoteFileRead, frameRef: RefObject<HTMLIFrameElement | null>,
  previous: KnownCompositionSource | null,
): Promise<boolean> | undefined {
  const frame = frameRef.current;
  const apply = path && (!paths || paths.includes(path)) && beginPeerTimelineUpdate(projectId, path, frame);
  if (!path || !apply) {
    notePeerPreviewChange();
    return;
  }
  const file = read(projectId, path);
  if (!file) return;
  shareCompositionPosterRead(usePlayerStore.getState(), projectId, path, file);
  const timeline = file.then(result => {
    if (!result.missing && typeof result.content === "string") apply(result.content, frameRef.current);
    return result;
  });
  if (!frame || !hasPeerTimingDocument(frame) || paths?.length !== 1 || !previous || isPreviewChanging()) {
    void timeline.catch(() => {});
    return;
  }
  const revision = previewSourceRevision();
  const isCurrent = () => frame === frameRef.current && revision === previewSourceRevision() &&
    usePlayerStore.getState().timelineProjectId === projectId && !isPreviewChanging() && !isStudioEditSaving();
  return timeline.then(async ({ content, version, missing }) => {
    if (missing || !version || typeof content !== "string" || content.length > MAX_POSTER_SOURCE_LENGTH || !isCurrent()) return false;
    const applied = await tryApplyPeerChanges(frame, { path, previous, current: { content, version } }, isCurrent);
    if (applied && isCurrent()) {
      announcePreviewScenesSwapped(frame);
      return true;
    }
    return false;
  });
}
