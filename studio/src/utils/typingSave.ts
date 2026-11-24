// Each field keeps one pending value. A slow request can accumulate another burst,
// but only the latest confirmed input in that burst needs to be written.
export const TYPING_IDLE_MS = 400;
export const TYPING_MAX_WAIT_MS = 2_000;

export function createTypingSave(idleMs = TYPING_IDLE_MS) {
  let pending: (() => Promise<unknown> | void) | null = null;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let burstStart: number | undefined;

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
    burstStart = undefined;
  }

  async function flush(): Promise<void> {
    clearTimer();
    if (inFlight) {
      try {
        await inFlight;
      } catch (error) {
        if (!pending) throw error;
      }
      // A new keystroke may have opened another debounce window during the request.
      if (timer !== undefined) return;
      if (pending) return flush();
      return inFlight ?? undefined;
    }
    if (!pending) return;
    const write = pending;
    pending = null;
    inFlight = Promise.resolve().then(write).then(() => {}).finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    schedule(write: () => Promise<unknown> | void) {
      pending = write;
      const now = Date.now();
      burstStart ??= now;
      clearTimeout(timer);
      timer = setTimeout(() => { void flush().catch(() => {}); },
        Math.min(idleMs, Math.max(0, burstStart + TYPING_MAX_WAIT_MS - now)));
    },
    flush,
    cancel() { clearTimer(); pending = null; },
    busy: () => pending !== null || inFlight !== null,
    writing: () => inFlight !== null,
  };
}
