import { confirmedSource, type ConfirmedSource } from "../utils/confirmedTextSources";
import { afterStudioPendingEdits } from "../utils/studioPendingEdits";
import { hasPeerLiveEdit, hasPeerTimingDocument, tryApplyPeerChanges } from "./peerTimingPreview";
import { isPreviewChanging } from "./previewReloading";
import { announcePreviewScenesSwapped } from "./sceneSwap";
import { usePlayerStore } from "./store/playerStore";

type TimingReceipt = { before: string; after: string };
type PreviewBatch = {
  projectId: string;
  path: string;
  src: string;
  painting: boolean;
  previous?: ConfirmedSource;
  current?: ConfirmedSource;
};

const pending = new WeakMap<HTMLIFrameElement, PreviewBatch>();

/** Keep each durable edit, but paint directly from the mounted revision to the last accepted one. */
export function scheduleCommittedTimelinePreview(
  frame: HTMLIFrameElement,
  projectId: string,
  path: string,
  files: Record<string, TimingReceipt>,
  previous: ConfirmedSource | undefined,
  reloadPreview: () => void,
) {
  const current = confirmedSource(projectId, path);
  const receipt = files[path];
  const verified = Object.keys(files).length === 1 && receipt && previous && current &&
    receipt.before === previous.content && receipt.after === current.content;
  const prior = pending.get(frame);
  if (prior && !prior.painting && prior.src === frame.src && prior.projectId === projectId && prior.path === path) {
    if (!verified || prior.current?.version !== previous.version) prior.previous = undefined;
    prior.current = current;
    return;
  }

  const batch = { projectId, path, src: frame.src, painting: false, previous: verified ? previous : undefined, current };
  pending.set(frame, batch);
  const ownsFrame = () => pending.get(frame) === batch && frame.isConnected && frame.src === batch.src &&
    usePlayerStore.getState().timelineProjectId === projectId;
  // This runs outside the save queue, including when its last entry failed or changed no bytes.
  afterStudioPendingEdits(() => {
    if (!ownsFrame()) {
      if (pending.get(frame) === batch) pending.delete(frame);
      return;
    }
    batch.painting = true;
    const { previous, current } = batch;
    const isCurrent = () => ownsFrame() && !isPreviewChanging() &&
      confirmedSource(projectId, path)?.version === current?.version;
    if (previous && current && isCurrent() && (hasPeerTimingDocument(frame) || hasPeerLiveEdit(frame, "mediaTiming"))) {
      void tryApplyPeerChanges(frame, { path, previous, current }, isCurrent).then(applied => {
        if (!ownsFrame()) return;
        pending.delete(frame);
        if (applied) announcePreviewScenesSwapped(frame);
        else reloadPreview();
      });
    } else {
      pending.delete(frame);
      reloadPreview();
    }
  });
}
