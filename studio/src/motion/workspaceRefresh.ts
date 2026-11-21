// Workspace reads have different freshness requirements. Each read chooses its next
// interval after success and allows at most one request in flight per endpoint.
export const activeWorkspaceInterval = 1800;

export function watchWorkspaceRead(
  signal: AbortSignal,
  read: () => Promise<number>,
  settled: (error: string) => void,
) {
  let timer: ReturnType<typeof setTimeout>;
  let due = Infinity;
  let running = false;
  let retry = activeWorkspaceInterval;

  function schedule(delay: number) {
    due = Math.min(due, Date.now() + delay);
    clearTimeout(timer);
    if (!running && !signal.aborted && !document.hidden && Number.isFinite(due)) {
      timer = setTimeout(run, Math.max(0, due - Date.now()));
    }
  }

  async function run() {
    if (signal.aborted || document.hidden) return;
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
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
  }, { once: true });
  void run();
  return schedule;
}
