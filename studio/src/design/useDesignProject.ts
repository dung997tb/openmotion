import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignComment, DesignEditorApp, DesignProjectDetail, DesignVersion } from '../../../shared/design-project';
import { isDeferredP2Error } from '../motion/p2Deferred';
import { designClient } from './designClient';

export type DesignProjectState = {
  project: DesignProjectDetail | null;
  versions: DesignVersion[];
  currentVersionId: string | null;
  comments: DesignComment[];
  editors: DesignEditorApp[];
  loading: boolean;
  error: string | null;
  deferred: boolean;
  refresh: () => Promise<void>;
  setProject: (next: DesignProjectDetail) => void;
  setComments: (next: DesignComment[]) => void;
};

/**
 * Loads a Design Studio project and polls its lightweight state endpoint while visible
 * so external Agent writes via MCP automatically refresh the preview, files and comments.
 */
export function useDesignProject(projectId: string): DesignProjectState {
  const [project, setProject] = useState<DesignProjectDetail | null>(null);
  const [versions, setVersions] = useState<DesignVersion[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [comments, setComments] = useState<DesignComment[]>([]);
  const [editors, setEditors] = useState<DesignEditorApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deferred, setDeferred] = useState(false);
  const revRef = useRef<string | null>(null);
  const commentsCountRef = useRef<number | null>(null);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [{ project: detail }, verRes, comRes] = await Promise.all([
        designClient.getProject(projectId),
        designClient.listVersions(projectId),
        designClient.listComments(projectId),
      ]);
      revRef.current = detail.revision;
      commentsCountRef.current = detail.openComments;
      setProject(detail);
      setVersions(verRes.versions);
      setCurrentVersionId(verRes.currentVersionId);
      setComments(comRes.comments);
      setDeferred(false);
      setError(null);
    } catch (err) {
      if (isDeferredP2Error(err)) {
        setDeferred(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load design project');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadAll(false);
    designClient.detectEditors().then(res => setEditors(res.editors)).catch(() => setEditors([]));
  }, [loadAll]);

  useEffect(() => {
    if (!projectId || deferred) return;
    let active = true;
    const tick = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      try {
        const state = await designClient.getState(projectId);
        if (!active) return;
        if (state.revision !== revRef.current || state.openComments !== commentsCountRef.current) {
          await loadAll(true);
        }
      } catch (err) {
        if (active && isDeferredP2Error(err)) {
          setDeferred(true);
        }
      }
    };
    const timer = window.setInterval(tick, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, deferred, loadAll]);

  return {
    project, versions, currentVersionId, comments, editors, loading, error, deferred,
    refresh: () => loadAll(true),
    setProject: (next) => { revRef.current = next.revision; commentsCountRef.current = next.openComments; setProject(next); },
    setComments,
  };
}
