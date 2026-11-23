import { usePlayerStore } from "../store/playerStore";
import { thumbnailRevisionOf } from "../store/thumbnailSlice";
import { MAX_PEER_PREVIEW_SOURCE_LENGTH } from "../../../../shared/preview-timing";
import { confirmedSource, rememberSource } from "../../utils/confirmedTextSources";
import { optionalProjectSourceUrl } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { MAX_POSTER_SOURCE_LENGTH } from "./compositionPosterSource";

type Revisions = ReturnType<typeof usePlayerStore.getState>["thumbnailRevisions"];

interface PendingRead {
  controller: AbortController;
  result: Promise<string | null>;
  readers: number;
}

interface PosterFiles {
  pending: Map<string, PendingRead>;
  recent: Map<string, string | null>;
}

// The store replaces this object when content changes. Old responses stay with the old generation.
const filesByGeneration = new WeakMap<Revisions, PosterFiles>();
const MAX_RECENT_FILES = 4;

export async function readPosterFile(projectId: string, epoch: number, path: string, revision: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const isCurrent = () => {
    const state = usePlayerStore.getState();
    return state.timelineProjectId === projectId && state.timelineSessionEpoch === epoch &&
      thumbnailRevisionOf(state.thumbnailRevisions, path) === revision;
  };
  async function download(signal: AbortSignal): Promise<string | null> {
    const response = await studioApiFetch(optionalProjectSourceUrl(projectId, path), { signal, priority: "low" });
    if (!response.ok) throw new Error(`Composition source unavailable (${response.status})`);
    const source = await response.json();
    signal.throwIfAborted();
    const content = source.content;
    const version = source.version ?? response.headers.get("etag");
    if (typeof content === "string" && content.length <= MAX_PEER_PREVIEW_SOURCE_LENGTH &&
        typeof version === "string" && response.headers.get("X-OpenMotion-Text-Edits") === "1" &&
        isCurrent() && !confirmedSource(projectId, path)) {
      rememberSource(projectId, path, { content, version });
    }
    return typeof content === "string" && content.length <= MAX_POSTER_SOURCE_LENGTH ? content : null;
  }
  if (!isCurrent()) return download(signal);
  const revisions = usePlayerStore.getState().thumbnailRevisions;
  let files = filesByGeneration.get(revisions);
  if (!files) {
    files = { pending: new Map(), recent: new Map() };
    filesByGeneration.set(revisions, files);
  }
  const key = JSON.stringify([projectId, epoch, path]);
  const cached = files.recent.get(key);
  if (cached !== undefined) return cached;
  const { pending, recent } = files;
  let read = pending.get(key);
  if (!read) {
    const controller = new AbortController();
    const result = download(controller.signal).then(content => {
      controller.signal.throwIfAborted();
      if (!isCurrent()) throw new DOMException("Superseded composition poster", "AbortError");
      if (recent.size === MAX_RECENT_FILES) recent.delete(recent.keys().next().value!);
      recent.set(key, content);
      return content;
    }).finally(() => {
      if (pending.get(key)?.controller === controller) pending.delete(key);
    });
    read = { controller, result, readers: 0 };
    pending.set(key, read);
  }
  const entry = read;
  entry.readers++;
  return new Promise<string | null>((resolve, reject) => {
    const onAbort = () => {
      if (--entry.readers === 0 && pending.get(key) === entry) {
        pending.delete(key);
        entry.controller.abort();
      }
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    entry.result.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
