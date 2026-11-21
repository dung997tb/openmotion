import { lazy } from 'react';

const loadEditor = () => import('../App').then(module => ({ default: module.StudioApp }));
let preloaded: Promise<Awaited<ReturnType<typeof loadEditor>> | undefined> | undefined;

export function preloadMotionProjectEditor(): void {
  preloaded ??= loadEditor().catch(() => {
    // Let the actual mount retry a speculative chunk request that failed.
    preloaded = undefined;
    return undefined;
  });
}

export const MotionProjectEditor = lazy(async () => (await preloaded) ?? loadEditor());
