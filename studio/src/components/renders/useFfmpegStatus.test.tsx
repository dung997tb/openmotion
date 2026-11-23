// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useFfmpegStatus } from './useFfmpegStatus';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('reads remote-worker heartbeat from /api/environment/ffmpeg and rechecks on demand without idle polling', async () => {
  vi.useFakeTimers();
  let ready = false;
  let result: ReturnType<typeof useFfmpegStatus>;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    expect(String(url)).toContain('/api/environment/ffmpeg');
    return new Response(JSON.stringify({
      ok: ready,
      available: ready,
      version: ready ? 'remote-worker' : null,
      mode: 'remote-worker',
      workers: ready
        ? [{ workerId: 'render-1', ffmpeg: true, ffprobe: true, chromium: true, concurrency: 2, activeJobs: 0, updatedAt: new Date().toISOString() }]
        : [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  function View() { result = useFfmpegStatus(); return <span>{String(result.status?.ok)}</span>; }
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => { root.render(<View />); });
  expect(result!.status?.ok).toBe(false);
  expect(result!.status?.mode).toBe('remote-worker');
  expect(result!.status?.title).toContain('Render worker');
  const initialReads = fetcher.mock.calls.length;
  ready = true;
  window.dispatchEvent(new Event('focus'));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(fetcher).toHaveBeenCalledTimes(initialReads);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(fetcher).toHaveBeenCalledTimes(initialReads);
  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(fetcher).toHaveBeenCalledTimes(initialReads + 1);
  expect(result!.status?.ok).toBe(true);
  expect(result!.status?.workers).toHaveLength(1);
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  act(() => root.unmount());
});

it('keeps a completed recheck when an older status request finishes later', async () => {
  let ready = false, reads = 0, release: (response: Response) => void;
  let result: ReturnType<typeof useFfmpegStatus>;
  const response = (available: boolean) => new Response(JSON.stringify({
    ok: available,
    available,
    version: available ? 'remote-worker' : null,
    mode: 'remote-worker',
    workers: available ? [{ workerId: 'render-1', ffmpeg: true, ffprobe: true, chromium: true, concurrency: 2, activeJobs: 0, updatedAt: new Date().toISOString() }] : [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (++reads === 2) return new Promise(resolve => { release = resolve; });
    return response(ready);
  });
  function View() { result = useFfmpegStatus(); return null; }
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => { root.render(<View />); });
    expect(result!.status?.ok).toBe(false);
    await act(async () => { result!.recheck(); });
    ready = true;
    await act(async () => { result!.recheck(); });
    expect(result!.status?.ok).toBe(true);
    await act(async () => { release!(response(false)); });
    expect(result!.status?.ok).toBe(true);
  } finally { act(() => root.unmount()); }
});
