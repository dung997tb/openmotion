// @vitest-environment happy-dom
import React, { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtifactViewer } from './ArtifactViewer';
import { I18nProvider } from '../i18n/I18n';
import { usePlayerStore } from '../player/store/playerStore';
import { LivePreviewReadyContext } from './StudioHost';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { readEditorLoadingLayout } from './EditorLoading';
import type { SessionArtifact } from '../../../shared/session';

let liveReady: ((projectId: string) => void) | null, saves: number;
vi.mock('../App', () => ({ StudioApp: ({ resolvedProjectId }: { resolvedProjectId: string }) => {
  liveReady = useContext(LivePreviewReadyContext);
  return <div>
    <header className="motion-studio-header"><input aria-label="Edit" defaultValue={resolvedProjectId} onChange={() => saves++} /></header>
    <div className="hf-dock"><div className="dv-groupview"><div data-preview-pan-surface /><div data-studio-timeline /></div></div>
  </div>;
} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
const opening = () => container.querySelector('.motion-project-editor')?.hasAttribute('inert');
beforeEach(() => {
  saves = 0; liveReady = null;
  usePlayerStore.getState().reset();
  useDockLayoutStore.setState(useDockLayoutStore.getInitialState());
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const artifact = (projectId: string): SessionArtifact => ({ id: projectId, projectId, kind: 'motion-project', title: projectId });
async function render(projectId = 'first') {
  await act(async () => root.render(<I18nProvider><ArtifactViewer key={projectId} artifact={artifact(projectId)} /></I18nProvider>));
}
function ready(projectId = 'first') {
  act(() => liveReady!(projectId));
}

it('presents the current live frame without waiting for sidebar status, timeline readiness or layout polling', async () => {
  await render();
  const measure = vi.spyOn(container.querySelector('.dv-groupview')!, 'getBoundingClientRect');
  expect(opening()).toBe(true);
  ready('other');
  expect(opening()).toBe(true);
  ready();
  expect(usePlayerStore.getState().timelineReady).toBe(false);
  expect(measure).not.toHaveBeenCalled();
  expect(opening()).toBe(false);
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Changed');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(saves).toBe(1);
  act(() => usePlayerStore.getState().reset());
  expect(container.querySelector('input')).toBe(input);
  expect(container.querySelector('.motion-loading')).toBeNull();
});

it('ignores a previous visit to the same project, even when its boot work is done', async () => {
  await render(); const oldReady = liveReady!; ready();
  await render('second'); await render();
  act(() => {
    oldReady('first');
    const store = usePlayerStore.getState();
    store.beginTimelineSession('first'); store.setTimelineReady(true); store.markPreviewBooted();
  });
  expect(opening()).toBe(true);
  ready();
  expect(opening()).toBe(false);
});

function addNotice(attributes: Record<string, string>, hidden = false) {
  const message = document.createElement('div');
  Object.entries(attributes).forEach(([key, value]) => message.setAttribute(key, value));
  message.textContent = 'Preview status'; message.hidden = hidden;
  vi.spyOn(message, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
  container.querySelector('.hf-dock')!.append(message);
  return message;
}

it('presents an actionable error as soon as it becomes visible', async () => {
  await render();
  let message!: Element;
  await act(async () => {
    addNotice({role: 'alert'}); // A sidebar warning is independent of the canvas.
    message = addNotice({'data-testid': 'composition-preview-error'}, true);
  });
  expect(opening()).toBe(true);
  await act(async () => message.removeAttribute('hidden'));
  expect(opening()).toBe(false);
});

it('hands a slow open to the mounted player loader, keeping a bare dock covered', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await render();
  await act(async () => vi.advanceTimersByTime(5000));
  expect(opening()).toBe(true);
  await act(async () => { addNotice({'data-testid': 'composition-loading-overlay'}); });
  expect(opening()).toBe(false);
});

it('opens a restored workspace where the user closed the preview panel', async () => {
  await render();
  act(() => useDockLayoutStore.setState({ controller: {} as NonNullable<ReturnType<typeof useDockLayoutStore.getState>['controller']>, visiblePanels: new Set(['timeline']) }));
  expect(opening()).toBe(false);
});

it('captures only presented geometry for the transition placeholder', async () => {
  await render();
  expect(readEditorLoadingLayout(container)).toBeNull();
  ready();
  const box = (x: number, width: number, height: number) => ({ x, y: 0, left: x, right: x + width, top: 0, bottom: height, width, height, toJSON() {} });
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(box(200, 1000, 800));
  vi.spyOn(container.querySelector('.motion-studio-header')!, 'getBoundingClientRect').mockReturnValue(box(200, 1000, 40));
  vi.spyOn(container.querySelector('[data-studio-timeline]')!, 'getBoundingClientRect').mockReturnValue(box(200, 1000, 260));
  vi.spyOn(container.querySelector('.dv-groupview')!, 'getBoundingClientRect').mockReturnValue(box(400, 752, 500));
  expect(readEditorLoadingLayout(container)).toEqual({ header: 40, timeline: 260, left: 200, right: 48 });
});
