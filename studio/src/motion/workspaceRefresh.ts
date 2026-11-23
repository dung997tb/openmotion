// Workspace reads have different freshness requirements. Each read chooses its next
// interval after success and allows at most one request in flight per endpoint.
export const activeWorkspaceInterval = 1800;

// The editor already owns the project SSE connection. Unscoped views and older
// servers still reconcile through bounded reads.
type ProjectActivity = (projectId: string, event: 'render-updated' | 'catalog-changed' | 'reconnected') => void;
const activityListeners = new Set<ProjectActivity>();

export const notifyProjectActivity: ProjectActivity = (projectId, event) => {
  for (const listener of activityListeners) listener(projectId, event);
};

export function subscribeProjectActivity(listener: ProjectActivity) {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
}

export function watchWorkspaceRead(
  signal: AbortSignal,
  read: () => Promise<number>,
  settled: (error: string) => void,
) {
  let timer: ReturnType<typeof setTimeout>;
  let due = Infinity;
  let running = false;
  let retry = activeWorkspaceInterval;

  const canRead = () => !signal.aborted && !document.hidden && navigator.onLine !== false;

  function schedule(delay: number) {
    due = Math.min(due, Date.now() + delay);
    clearTimeout(timer);
    if (!running && canRead() && Number.isFinite(due)) {
      timer = setTimeout(run, Math.max(0, due - Date.now()));
    }
  }

  async function run() {
    if (!canRead()) return;
    due = Infinity;
    running = true;
    let delay: number;
    try {
      delay = await read();
      if (!signal.aborted) settled('');
      retry = activeWorkspaceInterval;
    } catch (error) {
      if (!signal.aborted) settled((error as Error).message);
      delay = retry;
      retry = Math.min(30_000, retry * 2);
    } finally {
      running = false;
    }
    schedule(delay);
  }

  const resume = () => schedule(0);
  const onVisibilityChange = () => schedule(Infinity);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', resume);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', resume);
  }, { once: true });
  if (canRead()) void run();
  else schedule(0);
  return schedule;
}
