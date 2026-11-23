// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { MotionHistoryPanel } from './MotionHistoryPanel';
import { notifyProjectActivity } from './workspaceRefresh';
import { setCachedCloudDisklessMode } from '../utils/cloudRuntime';

const shell = vi.hoisted(() => ({
  projectId: 'project', waitForPendingDomEditSaves: vi.fn<() => Promise<void>>(),
  showToast: vi.fn(),
  writeBlockedReason: null as string | null, renderQueue: { isRendering: false },
}));
vi.mock('../contexts/StudioContext', () => ({ useStudioShellContext: () => shell }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let entries: Array<{ id: string; label: string; startedAt: number; endedAt: number; pinned: boolean; undone: boolean; who: { kind: string; name: string }; files: Array<{ path: string; before: string; after: string }> }>;
let calls: Array<{ path: string; body?: Record<string, unknown> }>;
let restoreError: boolean;
const onRestored = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  shell.projectId = 'project';
  shell.waitForPendingDomEditSaves.mockResolvedValue();
  shell.writeBlockedReason = null; shell.renderQueue.isRendering = false;
  entries = ['first', 'second'].map((id, index) => ({ id, label: `${id} edit`, startedAt: 1000 + index, endedAt: 1000 + index,
    pinned: false, undone: false, who: { kind: 'person', name: 'You' }, files: [{ path: 'index.html', before: 'a', after: 'b' }] }));
  calls = []; restoreError = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('/api/projects/project/history', '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    if (path === '/restore' && restoreError) return new Response(JSON.stringify({ error: 'Version is no longer kept' }), { status: 409 });
    if (path === '/pin') entries.find(entry => entry.id === body.entryId)!.pinned = body.pinned;
    return new Response(JSON.stringify(path ? { ok: true } : { entries }));
  }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setCachedCloudDisklessMode(null); vi.useRealTimers(); vi.unstubAllGlobals(); });
const button = (text: string) => [...container.querySelectorAll('button')].find(el => el.textContent?.includes(text))!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const render = async () => { await act(async () => root.render(<I18nProvider initialLocale="zh-CN"><MotionHistoryPanel onRestored={onRestored} /></I18nProvider>)); };
const advance = async (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

it('reads cloud history on open, matching edits and reconnect without polling while idle', async () => {
  vi.useFakeTimers();
  setCachedCloudDisklessMode(true);
  await render();
  expect(calls).toHaveLength(1);
  await advance(30_000);
  notifyProjectActivity('other', 'history-changed');
  notifyProjectActivity('project', 'render-updated');
  await advance(200);
  expect(calls).toHaveLength(1);

  entries[1].label = 'Remote edit';
  notifyProjectActivity('project', 'history-changed');
  notifyProjectActivity('project', 'history-changed');
  await advance(200);
  expect(button('Remote edit')).toBeTruthy();
  expect(calls).toHaveLength(2);
  notifyProjectActivity('project', 'connected');
  await advance(200);
  await advance(30_000);
  expect(calls).toHaveLength(3);
});

it('catches up on changes received during a read, and discards a previous project response', async () => {
  vi.useFakeTimers();
  setCachedCloudDisklessMode(true);
  const resolvers: Array<(response: Response) => void> = [];
  const fetch = vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve)));
  vi.stubGlobal('fetch', fetch);
  await render();
  notifyProjectActivity('project', 'history-changed');
  await advance(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => resolvers.shift()!(Response.json({ entries })));
  await advance(200);
  expect(fetch).toHaveBeenCalledTimes(2);
  shell.projectId = 'second-project';
  await render();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(container.textContent).not.toContain('first edit');
  await act(async () => resolvers.pop()!(Response.json({ entries: [{ ...entries[0], label: 'Second project edit' }] })));
  await act(async () => resolvers.pop()!(Response.json({ entries })));
  expect(button('Second project edit')).toBeTruthy();
  expect(container.textContent).not.toContain('first edit');
});

it('refreshes after its own pin and folds an in-flight event into that same read', async () => {
  vi.useFakeTimers();
  setCachedCloudDisklessMode(true);
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    if (url.endsWith('/pin')) notifyProjectActivity('project', 'history-changed');
    return nativeFetch(url, init);
  });
  await render();
  await click('first edit');
  await click('保留选中版本');
  await advance(200);
  expect(calls.map(call => call.path)).toEqual(['', '/pin', '']);
  expect(entries[0].pinned).toBe(true);
});

it('continues refreshing legacy histories without the cloud event channel', async () => {
  vi.useFakeTimers();
  setCachedCloudDisklessMode(false);
  await render();
  await advance(3200);
  expect(calls).toHaveLength(2);
});

it('waits for the first history response before enabling legacy polling and catches up after a late subscription', async () => {
  vi.useFakeTimers();
  const replies: Array<(response: Response) => void> = [];
  const fetch = vi.fn(() => new Promise<Response>(resolve => replies.push(resolve)));
  vi.stubGlobal('fetch', fetch);
  await render();
  await advance(12_000);
  await act(async () => replies.shift()!(Response.json({ entries, currentSeq: 2 })));
  await advance(4000);
  expect(fetch).toHaveBeenCalledTimes(1);
  notifyProjectActivity('project', 'connected');
  await advance(200);
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => replies.shift()!(Response.json({ entries, currentSeq: 3 })));
  await advance(4000);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('opens cloud history with ISO timestamps and selects the newest entry first', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    currentSeq: 2,
    entries: [...entries].reverse().map((entry, i) => ({
      ...entry, seq: 2 - i, endedAt: new Date(entry.endedAt).toISOString(),
      files: [{ path: 'index.html', status: 'added' }],
    })),
  })));
  await render();
  const rows = [...container.querySelectorAll('.motion-history-entry')];
  expect(rows[0]?.textContent).toContain('second edit');
  expect(rows[0]?.getAttribute('aria-pressed')).toBe('true');
  expect(rows[0]?.querySelector('time')?.dateTime).toBe(new Date(1001).toISOString());
  await click('first edit');
  expect(rows[1]?.getAttribute('aria-pressed')).toBe('true');
});

it('keeps the current version only after native saves and a checkpoint finish', async () => {
  await render();
  await click('保留当前版本');
  expect(shell.waitForPendingDomEditSaves).toHaveBeenCalledOnce();
  expect(calls.filter(call => call.body)).toEqual([
    { path: '/checkpoint', body: {} }, { path: '/pin', body: { entryId: 'second', pinned: true } },
  ]);
  expect(shell.showToast).toHaveBeenCalledWith('Current version pinned', 'info');
  expect(container.textContent).not.toContain('已保留当前版本');
});

it('restores the selected version with the native API and reloads only after success', async () => {
  await render(); await click('first edit'); await click('恢复此版本');
  expect(shell.waitForPendingDomEditSaves).toHaveBeenCalledOnce();
  expect(calls.filter(call => call.body)).toEqual([
    { path: '/checkpoint', body: {} }, { path: '/restore', body: { point: 'first' } },
  ]);
  expect(onRestored).toHaveBeenCalledOnce();
});

it('omits pinning controls in the MVP while keeping all versions restorable', async () => {
  entries[0].pinned = true;
  await act(async () => root.render(<I18nProvider initialLocale="zh-CN"><MotionHistoryPanel compact allowPinning={false} onRestored={onRestored} /></I18nProvider>));
  expect(container.querySelector('.motion-history-toolbar')).toBeNull();
  expect(container.querySelector('.motion-history-filters')).toBeNull();
  expect(container.textContent).not.toContain('已保留');
  expect(button('保留')).toBeUndefined();
  expect(container.querySelector('.motion-history-detail-title')).toBeNull();
  expect(container.querySelector('.motion-history-detail ul')).toBeNull();
  expect(container.querySelector('.motion-history-detail')?.textContent).toBe('恢复此版本');
  await click('first edit'); await click('恢复此版本');
  expect(calls.filter(call => call.body)).toEqual([
    { path: '/checkpoint', body: {} }, { path: '/restore', body: { point: 'first' } },
  ]);
  expect(onRestored).toHaveBeenCalledOnce();
});

it('does not replace the project when pending edits fail to save', async () => {
  shell.waitForPendingDomEditSaves.mockRejectedValue(new Error('Save conflict'));
  await render(); await click('first edit'); await click('恢复此版本');
  expect(calls.filter(call => call.body)).toEqual([]);
  expect(onRestored).not.toHaveBeenCalled();
  expect(shell.showToast).toHaveBeenCalledWith('Save conflict', 'error');
});

it('shows native restore refusals and keeps the current editor open', async () => {
  restoreError = true;
  await render(); await click('first edit'); await click('恢复此版本');
  expect(onRestored).not.toHaveBeenCalled();
  expect(shell.showToast).toHaveBeenCalledWith('Version is no longer kept', 'error');
});

it('blocks restoring and pinning during a render', async () => {
  shell.renderQueue.isRendering = true;
  await render(); await click('first edit');
  for (const text of ['恢复此版本', '保留选中版本', '保留当前版本']) expect(button(text).disabled).toBe(true);
});
