import { useEffect, useRef } from 'react';
import type { TimelineElement } from '../player/store/timelineElement';
import type { TimelineEditCallbacks } from '../player/components/timelineCallbacks';
import { findTimelineElementInIframe } from './timelineEditingHelpers';
import { usePlayerStore } from '../player/store/playerStore';
import { buildProjectApiPath } from '../utils/projectRouting';
import { isCurrentIsolatedManifest } from '../player/lib/isolatedTimelineManifest';
import { encodePreviewPath } from '../player/components/thumbnailUtils';

type Input = {
  projectId: string | null;
  activeCompPath: string | null;
  elements: readonly TimelineElement[];
  iframe: HTMLIFrameElement | null;
  ready: boolean;
  save: NonNullable<TimelineEditCallbacks['onSetElementsAttributeQuiet']>;
};

// A new iframe.src can point to the destination while its outgoing document and
// store snapshot are still on screen. Wait for discovery for the actual destination.
function savedLocks(
  iframe: HTMLIFrameElement,
  previewPath: string,
  elements: readonly TimelineElement[],
  activeCompPath: string | null,
): readonly TimelineElement[] | null {
  if (!iframe.contentDocument) {
    const { clipManifest } = usePlayerStore.getState();
    if (!isCurrentIsolatedManifest(iframe, clipManifest)
        || new URL(iframe.src).pathname !== previewPath) return null;
    return elements.filter(element => element.timelineLocked);
  }

  if (new URL(iframe.contentDocument.URL).pathname !== previewPath) return null;
  const resolved = elements.map(element => ({
    element, node: findTimelineElementInIframe(iframe, element, activeCompPath),
  }));
  if (!resolved.some(item => item.node)) return null;
  return resolved.filter(({ element, node }) =>
    element.timelineLocked || node?.hasAttribute('data-timeline-locked')).map(item => item.element);
}

/** Locks protect one editing session; a new Studio page releases the previous session's locks.
 * Use the ordinary queued, conflict-checked source save so captions and public operations
 * observe the same unlocked state. Preview reloads inside this page keep newly applied locks.
 */
export function useTimelineSessionLocks({ projectId, activeCompPath, elements, iframe, ready, save }: Input) {
  const initialized = useRef(new Set<string>());
  useEffect(() => {
    if (!ready || !projectId || !iframe || !elements.length) return;
    // Composition navigation clears the store in a child effect. This render may
    // still hold the old elements, even after that effect has run.
    if (usePlayerStore.getState().elements !== elements) return;
    const path = activeCompPath || 'index.html';
    const previewPath = buildProjectApiPath(projectId, path === 'index.html'
      ? '/preview' : `/preview/comp/${encodePreviewPath(path)}`);
    const key = JSON.stringify([projectId, path]);
    if (initialized.current.has(key)) return;
    const locked = savedLocks(iframe, previewPath, elements, activeCompPath);
    if (!locked) return;
    initialized.current.add(key);
    if (!locked.length) return;
    // The save path reports failures and only patches DOM/store after a successful write.
    void save(locked.map(element => ({ element, value: null })), 'data-timeline-locked', 'Release previous session track locks');
  }, [projectId, activeCompPath, elements, iframe, ready, save]);
}
