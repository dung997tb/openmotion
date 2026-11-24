import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewComment, ReviewCommentsInput, ReviewCommentsResult } from '../../../shared/review-comments';
import { isDeferredP2Error } from './p2Deferred';
import { requestComments } from './reviewCommentsClient';

/** Abort old reads; stale polling responses never overwrite a newer mutation. */
export function useReviewComments(projectId: string, active: boolean) {
  const [data, setData] = useState<ReviewCommentsResult | null>(null);
  const [error, setError] = useState('');
  const [deferred, setDeferred] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false), running = useRef(false), sequence = useRef(0), deferredRef = useRef(false);
  const read = useRef<AbortController | null>(null);
  const initializedProject = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    const order = ++sequence.current;
    try {
      const result = await requestComments({ action: 'comments', operation: 'list', projectId }, controller.signal);
      if (mounted.current && !controller.signal.aborted && order === sequence.current) {
        initializedProject.current = projectId;
        deferredRef.current = false;
        setDeferred(false);
        setData(result);
        setError('');
      }
      return result;
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && order === sequence.current) {
        if (isDeferredP2Error(cause)) {
          initializedProject.current = projectId;
          deferredRef.current = true;
          setDeferred(true);
          setError('');
          return { projectId, sourceRevision: '', comments: [] } as ReviewCommentsResult;
        }
        setError('Could not load comments');
      }
      throw cause;
    }
  }, [projectId]);
  useEffect(() => {
    mounted.current = true;
    deferredRef.current = false;
    setDeferred(false);
    return () => { mounted.current = false; sequence.current++; read.current?.abort(); };
  }, [projectId]);
  useEffect(() => {
    if (deferred) return;
    const poll = () => {
      if (running.current || document.hidden || deferredRef.current) return;
      void refresh().catch(() => {});
    };
    // Keep the badge useful with one initial read and refreshes when returning to the tab. Only
    // visible review surfaces need a recurring source-revision scan.
    if (active || initializedProject.current !== projectId) poll();
    const timer = active ? window.setInterval(poll, 5000) : undefined;
    document.addEventListener('visibilitychange', poll);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); read.current?.abort(); };
  }, [active, projectId, refresh, deferred]);
  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return;
    running.current = true; setBusy(true); read.current?.abort(); sequence.current++;
    try { return await task(); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function mutate(input: Omit<ReviewCommentsInput, 'action' | 'projectId'>) {
    try {
      const result = await requestComments({ ...input, action: 'comments', projectId });
      if (mounted.current) { sequence.current++; deferredRef.current = false; setDeferred(false); setData(result); setError(''); }
      return result;
    } catch (cause) {
      if (isDeferredP2Error(cause) && mounted.current) {
        deferredRef.current = true;
        setDeferred(true);
        setError('');
      }
      if (cause instanceof Error && /^COMMENT_(CONFLICT|NOT_FOUND):/.test(cause.message)) await refresh().catch(() => {});
      throw cause;
    }
  }
  const change = (comment: ReviewComment, operation: 'update' | 'delete', status?: ReviewComment['status']) => mutate({
    operation, commentId: comment.id, expectedCommentRevision: comment.revision, requestId: crypto.randomUUID(), ...(status ? { status } : {}),
  });
  return { data, error, deferred, busy, refresh, run, mutate, change };
}
