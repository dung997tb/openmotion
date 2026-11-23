import { createElement, lazy, type FunctionComponent } from 'react';
import type { StudioAppProps } from '../App';

type Editor = FunctionComponent<StudioAppProps>;
let loadedEditor: Editor | undefined;
let thumbnailLifecycleBound = false;

const loadEditor = () => Promise.all([
  import('../App'),
  import('./MotionStudioHost'),
  import('../player/lib/thumbnailPageLifecycle'),
]).then(([{ StudioApp }, { MotionEditorHost }, { bindThumbnailPageLifecycle }]) => {
  if (!thumbnailLifecycleBound && typeof window !== 'undefined' && typeof document !== 'undefined') {
    thumbnailLifecycleBound = true;
    const unbind = bindThumbnailPageLifecycle(window, document);
    import.meta.hot?.dispose(() => {
      thumbnailLifecycleBound = false;
      unbind();
    });
  }
  const EditorComponent: Editor = StudioApp;
  const HostedStudioApp: Editor = (props) =>
    createElement(MotionEditorHost, null, createElement(EditorComponent, props));
  loadedEditor = HostedStudioApp;
  return { default: HostedStudioApp };
});
let preloaded: Promise<Awaited<ReturnType<typeof loadEditor>> | undefined> | undefined;

export function preloadMotionProjectEditor(): void {
  preloaded ??= loadEditor().catch(() => {
    // Let the actual mount retry a speculative chunk request that failed.
    preloaded = undefined;
    return undefined;
  });
}

const LazyEditor = lazy(async () => (await preloaded) ?? loadEditor());

// A finished preload can mount immediately, without a new Suspense fallback.
export const getMotionProjectEditor = () => loadedEditor ?? LazyEditor;
