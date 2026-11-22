import { isolatedPreviewOrigin, preparePreviewLease, type PreparedPreviewLease } from "../player/lib/previewLease";
import { InitialPreviewLeaseContext } from "./StudioHost";
import { Button } from 'open-design-ui/button';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { WorkspaceFrame, WorkspaceMenuButton, useWorkspaceChrome } from './WorkspaceFrame';
import { requestedProject, validWorkspaceProject, type WorkspaceRoute } from './workspaceRouting';
import { resolveWorkspaceRoute } from './resolveWorkspaceRoute';
import { preloadMotionProjectEditor } from './MotionProjectEditor';
import { ArtifactViewer } from './ArtifactViewer';
import { EditorLoading, readEditorLoadingLayout, type EditorLoadingLayout } from './EditorLoading';
import { RecoveryScreen } from '../components/RecoveryScreen';
import { trackMotion } from './tracking';
import { WORKSPACE_LOCATION_CHANGED, writeWorkspaceHistory } from '../utils/workspaceHistory';
import { isWorkspaceSettingsPage } from '../../../shared/workspace-url';

const noPendingSaves = async () => {};

/** Resolve the native service before mounting any editor that could read or save files. */
export function MotionApp() {
  const { t } = useI18n();
  const [route, setRoute] = useState(() => ({ projectId: requestedProject(location.search, location.hash), sessionId: new URLSearchParams(location.search).get('session') }));
  const { projectId, sessionId } = route;
  const [settingsPage, setSettingsPage] = useState(() => isWorkspaceSettingsPage(location.search, location.hash));
  useEffect(() => {
    const sync = () => setSettingsPage(isWorkspaceSettingsPage(location.search, location.hash));
    window.addEventListener(WORKSPACE_LOCATION_CHANGED, sync);
    return () => window.removeEventListener(WORKSPACE_LOCATION_CHANGED, sync);
  }, []);
  const [libraryOnly, setLibraryOnly] = useState(() => new URLSearchParams(location.search).get('templates') === '1' && projectId === null && !sessionId);
  const [ready, setReady] = useState<(WorkspaceRoute & { previewLease?: PreparedPreviewLease }) | null>(null);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const [loadingLayout, setLoadingLayout] = useState<EditorLoadingLayout | null>(null);
  const onNavigate = useCallback((opened?: WorkspaceRoute) => {
    const layout = readEditorLoadingLayout(surface.current);
    if (layout) setLoadingLayout(layout);
    setReady(opened ?? null);
    setError('');
    setLibraryOnly(new URLSearchParams(location.search).get('templates') === '1');
    setRoute({ projectId: requestedProject(location.search, location.hash), sessionId: new URLSearchParams(location.search).get('session') });
  }, []);
  const view = useRef({ id: crypto.randomUUID(), started: performance.now(), sent: false });
  useEffect(() => {
    if (view.current.sent || (!ready && !error && !libraryOnly)) return;
    view.current.sent = true;
    const embedded = new URLSearchParams(location.search).get('embed') === '1';
    if (ready || libraryOnly) void trackMotion('page_view', { page_name: 'studio', view_id: view.current.id, embedded, has_project: Boolean(ready?.artifact) });
    if (error) void trackMotion('studio_load_result', { load_id: view.current.id, outcome: 'failure', embedded,
      duration_ms: Math.min(86_400_000, Math.round(performance.now() - view.current.started)) });
  }, [projectId, sessionId, ready, error, libraryOnly]);
  useEffect(() => {
    if (ready || settingsPage) return;
    const controller = new AbortController();
    let previewLease: PreparedPreviewLease | undefined;
    if (projectId && validWorkspaceProject(projectId) && (sessionId === null || validWorkspaceProject(sessionId))
      && new URLSearchParams(location.search).get('templates') !== '1') {
      preloadMotionProjectEditor();
      const origin = isolatedPreviewOrigin();
      if (origin) previewLease = preparePreviewLease(projectId, origin, controller.signal);
    }
    setError('');
    async function resolve() {
      const resolved = await resolveWorkspaceRoute(projectId, sessionId, libraryOnly, controller.signal);
      if (!resolved || controller.signal.aborted) return;
      if (resolved.artifact) {
        const url = new URL(location.href);
        url.searchParams.set('session', resolved.sessionId);
        url.searchParams.set('project', resolved.artifact.projectId);
        if (!url.hash.startsWith(`#project/${resolved.artifact.projectId}`)) url.hash = `project/${resolved.artifact.projectId}`;
        writeWorkspaceHistory(url, true);
      }
      setReady({ ...resolved, previewLease });
    }
    void resolve().catch(err => {
      if (controller.signal.aborted) return;
      controller.abort();
      setError((err as Error).message);
    });
    return () => controller.abort();
  }, [route, attempt, libraryOnly, settingsPage]);
  const closeLibrary = () => {
    setLibraryOnly(false);
  };
  return <WorkspaceFrame waitForSaves={noPendingSaves} projectId={ready?.artifact?.projectId ?? (error ? undefined : projectId ?? undefined)}
    sessionId={libraryOnly ? undefined : ready?.sessionId ?? sessionId ?? undefined} onNavigate={onNavigate}
    blocked={!ready && !error && !libraryOnly && !settingsPage} onLibraryClose={libraryOnly ? closeLibrary : undefined}>
    <div ref={surface} className="motion-project-surface">
    {error ? <><div className="motion-home-navigation"><WorkspaceMenuButton /></div><RecoveryScreen title={t('Could not open project')} message={error}><Button variant="ghost" className="om-button h-auto" data-primary onClick={() => retry(value => value + 1)}>{t('Retry')}</Button><a className="om-button" href="/?page=editor">{t('Open active project')}</a></RecoveryScreen></>
      : ready ? ready.artifact ? (
        <InitialPreviewLeaseContext.Provider value={ready.previewLease}>
          <ArtifactViewer key={ready.artifact.projectId} artifact={ready.artifact} loadingLayout={loadingLayout} />
        </InitialPreviewLeaseContext.Provider>
      ) : <div className="motion-route-state"><WorkspaceMenuButton />{t('Create a project with your Agent to start editing.')}</div>
      : libraryOnly ? <TemplateLibraryLanding /> : <EditorLoading layout={loadingLayout} />}
    </div>
  </WorkspaceFrame>;
}

function TemplateLibraryLanding() {
  const { t } = useI18n();
  const { openLibrary } = useWorkspaceChrome();
  return <div className="motion-route-state"><WorkspaceMenuButton /><h1>{t('Template library')}</h1>
    <Button variant="plain" className="motion-button" onClick={event => openLibrary(event.currentTarget)}>{t('View all templates')}</Button>
  </div>;
}
