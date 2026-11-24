import { confirmedSource, forgetSource } from "./confirmedTextSources";
import { acknowledgeFileEdit, forgetFileEditChain } from "./isolatedEditVersions";
import { studioFileContentVersion } from "./studioFileVersion";

export type RebasedFileEdit = { path: string; version: string; changed: boolean };
type RebaseListener = (projectId: string, file: RebasedFileEdit) => void;
const listeners = new Set<RebaseListener>();

export function onRebasedFileEdit(listener: RebaseListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Request an authoritative refresh after the displayed result diverges from storage. */
export function reconcileFileEdit(projectId: string, path: string, version?: string | null, changed = true): RebasedFileEdit {
  forgetFileEditChain(projectId, path);
  const file = { path, version: version ?? '', changed };
  for (const listener of listeners) listener(projectId, file);
  return file;
}

/** A receipt may describe a merge onto another writer's source. Never let a stale
 * frame claim those bytes. Ordinary edits keep the no-reload path. */
export async function acceptFileEditReceipt(
  projectId: string, path: string, before: string | null | undefined, predicted: string | undefined,
  committed: string, receipt: { rebased?: boolean; changedPaths?: string[] },
): Promise<RebasedFileEdit | undefined> {
  // Command receipts carry versions, not the final bytes (the server may stamp new element IDs).
  // A following edit must read those bytes before preparing another patch.
  const source = confirmedSource(projectId, path);
  if (source && source.version === before && before !== committed) forgetSource(projectId, path);
  if (receipt.rebased && (predicted === undefined ? before !== committed : await studioFileContentVersion(predicted) !== committed)) {
    return reconcileFileEdit(projectId, path, committed, receipt.changedPaths?.includes(path) ?? true);
  }
  if (predicted !== undefined) acknowledgeFileEdit(projectId, path, before, committed);
}
