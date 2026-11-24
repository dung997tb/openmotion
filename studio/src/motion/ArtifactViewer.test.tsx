// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtifactViewer } from './ArtifactViewer';
import { I18nProvider } from '../i18n/I18n';
import { readEditorLoadingLayout } from './EditorLoading';
import type { SessionArtifact } from '../../../shared/session';

const navigate = vi.fn();
vi.mock('../App', () => ({ StudioApp: ({ resolvedProjectId }: { resolvedProjectId: string }) => {
  return <div>
    <header className="motion-studio-header"><button onClick={() => navigate(resolvedProjectId)}>Assets</button></header>
    <div className="hf-dock"><div className="dv-groupview"><div data-preview-pan-surface role="status">Loading preview</div><div data-studio-timeline /></div></div>
  </div>;
} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  navigate.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const artifact = (projectId: string): SessionArtifact => ({ id: projectId, projectId, kind: 'motion-project', title: projectId });
async function render(projectId = 'first') {
  await act(async () => root.render(<I18nProvider><ArtifactViewer key={projectId} artifact={artifact(projectId)} /></I18nProvider>));
}
it('lets the user navigate the current project while its preview is loading', async () => {
  await render();
  await render('second');
  const editor = container.querySelector<HTMLElement>('.motion-project-editor')!;
  expect(editor.dataset.projectId).toBe('second');
  expect(editor.querySelector('[role="status"]')?.textContent).toBe('Loading preview');
  expect(container.querySelector('.motion-editor-loading')).toBeNull();
  const button = editor.querySelector('button')!;
  expect(button.closest('[inert], [aria-hidden="true"]')).toBeNull();
  act(() => button.click());
  expect(navigate).toHaveBeenCalledWith('second');
});

it('captures only presented geometry for the transition placeholder', async () => {
  await render();
  expect(readEditorLoadingLayout(container)).toBeNull();
  const box = (x: number, width: number, height: number) => ({ x, y: 0, left: x, right: x + width, top: 0, bottom: height, width, height, toJSON() {} });
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(box(200, 1000, 800));
  vi.spyOn(container.querySelector('.motion-studio-header')!, 'getBoundingClientRect').mockReturnValue(box(200, 1000, 40));
  vi.spyOn(container.querySelector('[data-studio-timeline]')!, 'getBoundingClientRect').mockReturnValue(box(200, 1000, 260));
  vi.spyOn(container.querySelector('.dv-groupview')!, 'getBoundingClientRect').mockReturnValue(box(400, 752, 500));
  expect(readEditorLoadingLayout(container)).toEqual({ header: 40, timeline: 260, left: 200, right: 48 });
});
