import type { RefObject } from "react";
import type { CompositionEdit } from "../../../packages/edit-core/commands";
import { hasPeerTimingDocument, tryApplyPeerChanges } from "../player/peerTimingPreview";
import { isPreviewChanging } from "../player/previewReloading";
import { announcePreviewScenesSwapped } from "../player/sceneSwap";
import { confirmedSource } from "../utils/confirmedTextSources";
import { submitStudioCommands } from "../utils/projectEditBatch";
import type { StudioWriteHistory } from "../utils/studioFileHistory";

/** Use the snapshots already held by the patch writer to confirm what the mounted canvas shows. */
export async function submitIsolatedCanvasEdit(
  project: string, commands: CompositionEdit[], versions: Record<string, string>, history: StudioWriteHistory | undefined,
  frameRef: RefObject<HTMLIFrameElement | null>, gestureId?: string,
) {
  const path = commands[0]?.compositionPath;
  const frame = frameRef.current;
  const previous = path && frame && hasPeerTimingDocument(frame) ? confirmedSource(project, path) : undefined;
  const result = await submitStudioCommands(project, commands, versions, history);
  const current = path && previous && confirmedSource(project, path);
  let previewApplied = false;
  if (frame && path && previous && current && result.changedPaths.length === 1 && result.changedPaths[0] === path &&
      !result.divergent.length && current.version === result.versions[path]) {
    const isCurrent = () => frame === frameRef.current && !isPreviewChanging() && confirmedSource(project, path)?.version === current.version;
    previewApplied = await tryApplyPeerChanges(frame, { path, previous, current }, isCurrent, { gestureId });
    if (previewApplied) announcePreviewScenesSwapped(frame);
  }
  return { ...result, previewApplied };
}
