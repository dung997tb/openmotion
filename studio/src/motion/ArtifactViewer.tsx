import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import type { ArtifactKind, SessionArtifact } from '../../../shared/session';
import { EditorLoading, type EditorLoadingLayout } from './EditorLoading';
import { LivePreviewReadyContext } from './StudioHost';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';

// Add a viewer adapter here when a mode introduces a new artifact kind.
// The session and browser shell do not own the editor's internal state.
const viewers: Record<ArtifactKind, ComponentType<{ resolvedProjectId: string }>> = {
  'motion-project': lazy(() => import('../App').then(module => ({ default: module.StudioApp }))),
};

const errorSurface = '.om-recovery-screen, [data-testid="composition-preview-error"]';
const loadingSurface = '[data-testid="composition-loading-overlay"]';

function isVisibleNotice(node: Element, surface: HTMLElement): boolean {
  if (!node.textContent?.trim() || !node.getClientRects().length) return false;
  for (let el: Element | null = node; el && el !== surface; el = el.parentElement) {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' || getComputedStyle(el).display === 'none') return false;
  }
  return true;
}

export function ArtifactViewer({ artifact, loadingLayout }: { artifact: SessionArtifact; loadingLayout?: EditorLoadingLayout | null }) {
  const Viewer = viewers[artifact.kind];
  const surface = useRef<HTMLDivElement>(null);
  const [presented, setPresented] = useState(false);
  // This callback belongs to this viewer mount. A cached boot flag, a shadow frame or a
  // previous visit to the same project must never uncover a newly mounted canvas.
  const onLivePreviewReady = useCallback((projectId: string) => {
    if (projectId === artifact.projectId) setPresented(true);
  }, [artifact.projectId]);

  useLayoutEffect(() => {
    if (presented) return;
    const content = surface.current!;
    let selector = errorSurface;
    const presentNotice = (node: Node) => {
      const element = node instanceof Element ? node : node.parentElement;
      if (!element || !content.contains(element)) return false;
      const notice = element.closest(selector);
      if ((notice && isVisibleNotice(notice, content)) ||
          [...element.querySelectorAll(selector)].some(candidate => isVisibleNotice(candidate, content))) {
        setPresented(true);
        return true;
      }
      return false;
    };
    // A saved layout may deliberately close the preview. In that case the mounted dock
    // is itself the workspace to show; no live player will ever emit a first frame.
    const presentClosedPreview = () => {
      const dock = useDockLayoutStore.getState();
      if (dock.controller && !dock.visiblePanels.has('preview') && content.querySelector('.hf-dock .dv-groupview')) {
        setPresented(true);
      }
    };
    if (presentNotice(content)) return;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          if (presentNotice(record.target)) return;
        } else if ([...record.addedNodes].some(presentNotice)) return;
      }
    });
    observer.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'] });
    // On a slow open, hand off to an actual player loading surface once it exists.
    const timer = setTimeout(() => {
      selector = errorSurface + ', ' + loadingSurface;
      if (!presentNotice(content)) presentClosedPreview();
    }, 5000);
    const unsubscribe = useDockLayoutStore.subscribe((dock, previous) => {
      // attach() precedes the first snapshot and may still contain the last dock's panels.
      if (dock.visiblePanels !== previous.visiblePanels) presentClosedPreview();
    });
    return () => { clearTimeout(timer); observer.disconnect(); unsubscribe(); };
  }, [presented]);

  return <div className="motion-project-presentation" data-editor-initializing={!presented} aria-busy={!presented}>
    <div ref={surface} className="motion-project-editor" inert={!presented} aria-hidden={!presented}>
      <LivePreviewReadyContext.Provider value={onLivePreviewReady}>
        <Suspense fallback={null}><Viewer resolvedProjectId={artifact.projectId} /></Suspense>
      </LivePreviewReadyContext.Provider>
    </div>
    {!presented && <EditorLoading layout={loadingLayout} />}
  </div>;
}
