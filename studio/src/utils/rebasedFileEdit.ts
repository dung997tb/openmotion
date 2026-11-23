import { acknowledgeFileEdit, forgetFileEditChain } from "./isolatedEditVersions";
import { studioFileContentVersion } from "./studioFileVersion";

export type RebasedFileEdit = { path: string; version: string; changed: boolean };
type RebaseListener = (projectId: string, file: RebasedFileEdit) => void;
const listeners = new Set<RebaseListener>();

export function onRebasedFileEdit(listener: RebaseListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A receipt may describe a merge onto another writer's source. Never let a stale
 * frame claim those bytes. Ordinary edits keep the no-reload path. */
export async function acceptFileEditReceipt(
  projectId: string, path: string, before: string | null | undefined, predicted: string | undefined,
  committed: string, receipt: { rebased?: boolean; changedPaths?: string[] },
): Promise<RebasedFileEdit | undefined> {
  if (receipt.rebased && (predicted === undefined ? before !== committed : await studioFileContentVersion(predicted) !== committed)) {
    forgetFileEditChain(projectId, path);
    const file = { path, version: committed, changed: receipt.changedPaths?.includes(path) ?? true };
    for (const listener of listeners) listener(projectId, file);
    return file;
  }
  if (predicted !== undefined) acknowledgeFileEdit(projectId, path, before, committed);
}
