import { afterEach, expect, it, vi } from 'vitest';
import { StudioFileConflictError } from './studioSaveDiagnostics';
import { clearStudioSaveFailures, getStudioSaveSnapshot, observeStudioSavedAt, subscribeStudioSaves, trackStudioProjectSave } from './studioSaveState';
afterEach(() => vi.restoreAllMocks());

it('reports a discarded stale edit once without claiming a save or hiding an outstanding failure', async () => {
  const project = 'stale-patch';
  const conflict = new StudioFileConflictError({
    filePath: 'index.html', currentContent: null, currentVersion: 'v2', attemptedContent: 'draft', syncLatest: true,
  });
  const rejectPatch = () => trackStudioProjectSave(project, 'index.html', async () => { throw conflict; });
  observeStudioSavedAt(project, 123);
  await expect(rejectPatch()).rejects.toBe(conflict);
  expect(getStudioSaveSnapshot(project)).toEqual({ pending: 0, failed: false, savedAt: 123 });

  const retainedDraft = new StudioFileConflictError({
    filePath: 'index.html', currentContent: null, currentVersion: 'v3', attemptedContent: 'unresolved',
  });
  await expect(trackStudioProjectSave(project, 'index.html', async () => { throw retainedDraft; })).rejects.toBe(retainedDraft);
  await expect(rejectPatch()).rejects.toBe(conflict);
  expect(getStudioSaveSnapshot(project)).toEqual({ pending: 0, failed: true, savedAt: 123 });
});

it('reports only confirmed writes and keeps simultaneous writes and projects independent', async () => {
  const id = 'concurrent-project';
  const changed = vi.fn();
  const unsubscribe = subscribeStudioSaves(changed);
  let finish!: () => void;
  const first = trackStudioProjectSave(id, 'index.html', () => new Promise<void>(resolve => { finish = resolve; }));
  expect(getStudioSaveSnapshot(id)).toEqual({ pending: 1, savedAt: null, failed: false });
  await trackStudioProjectSave(id, 'styles.css', async () => {});
  expect(getStudioSaveSnapshot(id).pending).toBe(1);
  expect(getStudioSaveSnapshot('unopened').savedAt).toBeNull();
  finish(); await first;
  expect(getStudioSaveSnapshot(id)).toMatchObject({ pending: 0, failed: false });
  expect(getStudioSaveSnapshot(id).savedAt).toBeGreaterThan(0);
  expect(changed).toHaveBeenCalledTimes(4);
  unsubscribe();
});

it('does not let an unrelated success or history refresh hide a failed save', async () => {
  const id = 'failed-project';
  observeStudioSavedAt(id, 100);
  await expect(trackStudioProjectSave(id, 'index.html', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  expect(getStudioSaveSnapshot(id)).toEqual({ pending: 0, savedAt: 100, failed: true });
  await trackStudioProjectSave(id, 'styles.css', async () => {});
  observeStudioSavedAt(id, 200);
  expect(getStudioSaveSnapshot(id).failed).toBe(true);
  await trackStudioProjectSave(id, 'index.html', async () => {});
  expect(getStudioSaveSnapshot(id).failed).toBe(false);
  await expect(trackStudioProjectSave(id, 'index.html', async () => { throw new Error('conflict'); })).rejects.toThrow('conflict');
  clearStudioSaveFailures(id);
  expect(getStudioSaveSnapshot(id).failed).toBe(false);
});
