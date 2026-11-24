import { lazy } from 'react';

type Editor = typeof import('../App').StudioApp;
let loadedEditor: Editor | undefined;

const loadEditor = () => import('../App').then(({ StudioApp }) => {
  loadedEditor = StudioApp;
  return { default: StudioApp };
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
