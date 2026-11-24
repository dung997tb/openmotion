import type { RemoteFileRead } from "./remoteFileReads";

type ExternalFileReloadListener = (path: string, read?: RemoteFileRead) => void;

const listeners = new Set<ExternalFileReloadListener>();

export function addExternalFileReloadListener(listener: ExternalFileReloadListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyExternalFileReload(...change: Parameters<ExternalFileReloadListener>): void {
  for (const listener of listeners) {
    try {
      listener(...change);
    } catch {
      // A stale SDK owner must not prevent sibling owners from reloading.
    }
  }
}
