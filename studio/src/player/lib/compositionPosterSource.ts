import type { usePlayerStore } from "../store/playerStore";
import { thumbnailRevisionOf } from "../store/thumbnailSlice";

type PreviewState = ReturnType<typeof usePlayerStore.getState>;
export type KnownCompositionSource = { content: string; version: string };

interface PosterSource {
  projectId: string;
  epoch: number;
  path: string;
  content: string | null | Promise<string | null | undefined>;
  version?: string | null;
}
// Each edit replaces thumbnailRevisions. A late read stays attached to its original snapshot.
const activeSource = new WeakMap<PreviewState["thumbnailRevisions"], PosterSource>();

export const MAX_POSTER_SOURCE_LENGTH = 1024 * 1024;

export function rememberCompositionPosterSource(state: PreviewState, projectId: string, path: string, content: string, version?: string | null) {
  if (state.timelineProjectId === projectId && content.length <= MAX_POSTER_SOURCE_LENGTH) {
    activeSource.set(state.thumbnailRevisions, { projectId, epoch: state.timelineSessionEpoch, path, content, version });
  }
}

/** A visible poster can join the active editor's read before the response arrives. */
export function shareCompositionPosterRead(
  state: PreviewState,
  projectId: string,
  path: string,
  read: Promise<{ content?: string; version: string | null; missing?: boolean }>,
) {
  if (state.timelineProjectId !== projectId) return;
  const revisions = state.thumbnailRevisions;
  const source: PosterSource = { projectId, epoch: state.timelineSessionEpoch, path, content: null };
  source.content = read.then(file => {
    source.version = file.version;
    source.content = !file.missing && typeof file.content === "string" && file.content.length <= MAX_POSTER_SOURCE_LENGTH
      ? file.content : null;
    return source.content;
  }, () => {
    // Leave the poster's independent read available after a transient editor failure.
    if (activeSource.get(revisions) === source) activeSource.delete(revisions);
    return undefined;
  });
  activeSource.set(revisions, source);
}

export function compositionPosterSource(state: PreviewState, projectId: string, epoch: number, path: string, revision: number) {
  const source = activeSource.get(state.thumbnailRevisions);
  return source?.path === path && source.projectId === projectId && source.epoch === epoch &&
    state.timelineProjectId === projectId && state.timelineSessionEpoch === epoch &&
    thumbnailRevisionOf(state.thumbnailRevisions, path) === revision ? source.content : undefined;
}

/** Exact source already read by Studio, scoped to the current project and thumbnail generation. */
export function knownCompositionSource(state: PreviewState, projectId: string, path: string): KnownCompositionSource | null {
  const source = activeSource.get(state.thumbnailRevisions);
  if (source?.projectId !== projectId || source.path !== path || !source.version || typeof source.content !== "string" ||
      state.timelineProjectId !== projectId || state.timelineSessionEpoch !== source.epoch) return null;
  return { content: source.content, version: source.version };
}
