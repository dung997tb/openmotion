// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { commitStudioEditBatch, submitStudioCommands } from './projectEditBatch';
import { studioFileContentVersion } from './studioFileVersion';
import { confirmedSource, rememberSource } from './confirmedTextSources';
import { acceptFileEditReceipt, onRebasedFileEdit } from './rebasedFileEdit';
import { isolatedEditVersion } from './isolatedEditVersions';

afterEach(() => vi.unstubAllGlobals());

it('reconciles only the files whose predicted HTML differs in an atomic batch', async () => {
  const afterA = await studioFileContentVersion('a blue');
  const afterB = await studioFileContentVersion('b green plus Agent text');
  const command = { kind: 'editElements' as const, patches: [] };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({
    rebased: true, changedPaths: ['a', 'b'], versions: { a: afterA, b: afterB },
  }));
  vi.stubGlobal('fetch', fetch);
  const listener = vi.fn();
  const stop = onRebasedFileEdit(listener);
  try {
    const divergent = await commitStudioEditBatch('project', [
      { path: 'a', before: 'a red', after: 'a blue', command },
      { path: 'b', before: 'b red', after: 'b green', command },
    ]);
    expect(divergent).toEqual([{ path: 'b', version: afterB, changed: true }]);
    expect(listener).toHaveBeenCalledOnce();
    const baseA = await studioFileContentVersion('a red');
    const baseB = await studioFileContentVersion('b red');
    expect(isolatedEditVersion('project', 'a', baseA)).toBe(afterA);
    expect(isolatedEditVersion('project', 'b', baseB)).toBe(baseB);
    expect(fetch).toHaveBeenCalledOnce();
  } finally { stop(); }
});

it('refreshes a rebased isolated-frame command even when the desired change was already made', async () => {
  const file = 'intro.html';
  const version = await studioFileContentVersion('merged');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({
    rebased: true, changedPaths: [], versions: { [file]: version },
  })));
  const result = await submitStudioCommands('project', [
    { compositionPath: file, kind: 'editElements', patches: [] },
  ], { [file]: await studioFileContentVersion('stale frame') });
  expect(result.divergent).toEqual([{ path: file, changed: false, version }]);
});

it('retires the old patch base after a paste, without discarding a newer read or a no-op base', async () => {
  const project = 'clipboard-receipts', path = 'index.html';
  const before = { content: '<div>old</div>', version: '"patch:old"' };
  const version = '"patch:pasted"';
  rememberSource(project, path, before);
  await acceptFileEditReceipt(project, path, before.version, before.content, before.version, {});
  expect(confirmedSource(project, path)).toEqual(before);

  await acceptFileEditReceipt(project, path, before.version, '<div>predicted clone</div>', version, {});
  expect(confirmedSource(project, path)).toBeUndefined();

  const latest = { content: '<div>another edit</div>', version: '"patch:newer"' };
  rememberSource(project, path, latest);
  await acceptFileEditReceipt(project, path, before.version, '<div>predicted clone</div>', version, {});
  expect(confirmedSource(project, path)).toEqual(latest);
});
