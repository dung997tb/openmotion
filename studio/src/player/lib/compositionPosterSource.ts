import type { usePlayerStore } from "../store/playerStore";
import { thumbnailRevisionOf } from "../store/thumbnailSlice";

type PreviewState = ReturnType<typeof usePlayerStore.getState>;

// Each edit replaces thumbnailRevisions. A late read stays attached to its original snapshot.
const activeSource = new WeakMap<PreviewState["thumbnailRevisions"], {
  projectId: string;
  epoch: number;
  path: string;
  content: string;
  version?: string | null;
}>();

export const MAX_POSTER_SOURCE_LENGTH = 1024 * 1024;

export function rememberCompositionPosterSource(state: PreviewState, projectId: string, path: string, content: string, version?: string | null) {
  if (state.timelineProjectId === projectId && content.length <= MAX_POSTER_SOURCE_LENGTH) {
    activeSource.set(state.thumbnailRevisions, { projectId, epoch: state.timelineSessionEpoch, path, content, version });
  }
}

export function compositionPosterSource(state: PreviewState, projectId: string, epoch: number, path: string, revision: number) {
  const source = activeSource.get(state.thumbnailRevisions);
  return source?.path === path && source.projectId === projectId && source.epoch === epoch &&
    state.timelineProjectId === projectId && state.timelineSessionEpoch === epoch &&
    thumbnailRevisionOf(state.thumbnailRevisions, path) === revision ? source.content : undefined;
}

/** Exact source already read by Studio, scoped to the current project and thumbnail generation. */
export function knownCompositionSource(state: PreviewState, projectId: string, path: string) {
  const source = activeSource.get(state.thumbnailRevisions);
  if (source?.projectId !== projectId || source.path !== path || !source.version ||
      state.timelineProjectId !== projectId || state.timelineSessionEpoch !== source.epoch) return null;
  return { content: source.content, version: source.version };
}
