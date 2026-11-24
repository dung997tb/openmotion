// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { applyTextPatch } from '../../../shared/text-patch';
import { readProjectFileContent, studioHistoryForWrite } from './studioFileHistory';
import { submitStudioCommands } from './projectEditBatch';
import { observedSourceVersion, confirmedSource } from './confirmedTextSources';
import { placeCatalogComponent, tryStudioTextEdit } from './studioTextEdits';
import { onRebasedFileEdit } from './rebasedFileEdit';
import { readVersionedSource } from './readVersionedSource';

const version = (n: number) => '"patch:' + n.toString(16).padStart(64, '0') + '"';
const sourceResponse = (content: string, n: number) => Response.json({ content, version: version(n) },
  { headers: { 'X-OpenMotion-Text-Edits': '1' } });
const receipt = (paths: string[], n: number) => Response.json({ versions: Object.fromEntries(paths.map(path => [path, version(n)])), changedPaths: paths });

it('sends a cached host patch and the catalog dependency together, without a separate install request', async () => {
  const project = 'catalog-patch', path = 'intro.html';
  const before = '<main data-hf-id="hf-main">' + ' '.repeat(800) + '</main>';
  const fetch = vi.fn().mockResolvedValueOnce(sourceResponse(before, 1)).mockResolvedValueOnce(receipt([path], 2));
  vi.stubGlobal('fetch', fetch);
  await readProjectFileContent(project, path);
  await placeCatalogComponent(project, path, 'blur-in', 'Add component: Blur In', html => html.replace('</main>', 'mounted</main>'));
  expect(fetch).toHaveBeenCalledTimes(2);
  const [url, request] = fetch.mock.calls[1];
  expect(url).toBe('/api/projects/catalog-patch/text-edits');
  const body = JSON.parse(request.body);
  expect(body).toMatchObject({ installComponent: 'blur-in', files: [{ path, baseVersion: version(1) }] });
  expect(applyTextPatch(before, body.files[0].patch)).toContain('mounted</main>');
});

it('marks ongoing typing on the wire and keeps an independently confirmed edit separate', async () => {
  const project = 'continuous-input', path = 'titles.css';
  const fetch = vi.fn().mockResolvedValueOnce(sourceResponse('0', 1))
    .mockResolvedValueOnce(receipt([path], 2)).mockResolvedValueOnce(receipt([path], 3));
  vi.stubGlobal('fetch', fetch);
  await readProjectFileContent(project, path);
  const writer = async () => {};
  const typing = studioHistoryForWrite(writer, 'Typing', 'same-key', 4000, true);
  const confirmed = studioHistoryForWrite(writer, 'Set title', 'same-key');
  expect(confirmed.windowId).toBe(typing.windowId);
  await tryStudioTextEdit(project, [{ path, before: '0', after: '1' }], typing);
  await tryStudioTextEdit(project, [{ path, before: '1', after: '2' }], confirmed);
  expect(JSON.parse(fetch.mock.calls[1][1].body).undoGroup).toBe(typing.windowId);
  expect(JSON.parse(fetch.mock.calls[2][1].body).undoGroup).toBeUndefined();
});

afterEach(() => vi.unstubAllGlobals());

it('submits two sequential edits against the last acknowledged file version', async () => {
  const project = 'patch-chain', path = 'titles.css';
  const before = '.title { font-size: 48px; color: red; }'.repeat(5);
  const first = before.replace('48', '100'), second = first.replace('red', 'blue');
  const fetch = vi.fn().mockResolvedValueOnce(sourceResponse(before, 1)).mockResolvedValueOnce(receipt([path], 2)).mockResolvedValueOnce(receipt([path], 3));
  vi.stubGlobal('fetch', fetch);
  await readProjectFileContent(project, path);
  await tryStudioTextEdit(project, [{ path, before, after: first }]);
  await tryStudioTextEdit(project, [{ path, before: first, after: second }]);
  const bodies = fetch.mock.calls.slice(1).map(([url, init]) => {
    expect(url).toBe('/api/projects/patch-chain/text-edits');
    expect(init.headers['Idempotency-Key']).toBeTruthy();
    return JSON.parse(init.body).files[0];
  });
  expect(bodies.map(body => body.baseVersion)).toEqual([version(1), version(2)]);
  expect(applyTextPatch(applyTextPatch(before, bodies[0].patch), bodies[1].patch)).toBe(second);
  expect(await observedSourceVersion(project, path, second)).toBe(version(3));
});

it('compiles a canvas edit across two files locally and submits one transaction', async () => {
  const project = 'patch-canvas', paths = ['first.html', 'second.html'];
  const html = '<h1 id="heading" data-hf-id="title">Before</h1>' + ' '.repeat(500);
  const fetch = vi.fn().mockResolvedValueOnce(sourceResponse(html, 1)).mockResolvedValueOnce(sourceResponse(html, 2)).mockResolvedValueOnce(receipt(paths, 3));
  vi.stubGlobal('fetch', fetch);
  for (const path of paths) await readProjectFileContent(project, path);
  await submitStudioCommands(project, paths.map(path => ({
    kind: 'editElements', compositionPath: path,
    patches: [{target: {hfId: 'title'}, operations: [{type: 'inline-style', property: 'color', value: 'red'}]}],
  })), Object.fromEntries(paths.map((path, i) => [path,version(i+1)])));
  expect(fetch).toHaveBeenCalledTimes(3);
  const [url, init] = fetch.mock.calls[2];
  expect(url).toBe('/api/projects/' + project + '/text-edits');
  const files = JSON.parse(init.body).files;
  expect(files.map((file: {path: string}) => file.path)).toEqual(paths);
  for (const file of files) expect(applyTextPatch(html,file.patch)).toMatch(/color:\s*red/);
});

it('reconciles a 409 without trying a command or a full-file write', async () => {
  const project = 'patch-conflict', path = 'intro.css';
  const fetch = vi.fn().mockResolvedValueOnce(sourceResponse('a'.repeat(80), 1))
    .mockResolvedValueOnce(Response.json({ code: 'VERSION_CONFLICT', path, currentVersion: version(2) }, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  const listener = vi.fn(), stop = onRebasedFileEdit(listener);
  try {
    const before = await readProjectFileContent(project,path);
    await expect(tryStudioTextEdit(project,[{path,before,after:before+'!'}])).rejects.toMatchObject({currentVersion:version(2)});
    expect(listener).toHaveBeenCalledOnce();
    expect(confirmedSource(project,path)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { stop(); }
});

it('keeps the confirmed source for unrelated 409s and retries temporary storage failures with the same edit', async () => {
  const project = 'patch-busy', path = 'intro.css', before = 'a'.repeat(80);
  const edit = [{ path, before, after: before + '!' }];
  const fetch = vi.fn().mockResolvedValueOnce(sourceResponse(before, 1))
    .mockResolvedValueOnce(Response.json({ code: 'REQUEST_ID_CONFLICT' }, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ code: 'BLOB_GC_IN_PROGRESS', applied: false }, { status: 503 }))
    .mockResolvedValueOnce(receipt([path], 2));
  vi.stubGlobal('fetch', fetch);
  const refresh = vi.fn(), stop = onRebasedFileEdit(refresh);
  try {
    await readProjectFileContent(project, path);
    await expect(tryStudioTextEdit(project, edit)).rejects.toMatchObject({ name: 'StudioSaveHttpError', statusCode: 409 });
    expect(confirmedSource(project, path)).toEqual({ content: before, version: version(1) });
    await tryStudioTextEdit(project, edit);
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[3][1].body);
    expect(fetch.mock.calls[2][1].headers['Idempotency-Key']).toBe(fetch.mock.calls[3][1].headers['Idempotency-Key']);
    expect(confirmedSource(project, path)).toEqual({ content: before + '!', version: version(2) });
    expect(refresh).not.toHaveBeenCalled();
  } finally { stop(); }
});

it.each(['', 'W/'])('reads a patch-version source with one GET for a %s validator', async prefix => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ baseVersion:version(1), version:version(2), patch:[[0,1,'新']] },
    { headers: { ETag:prefix + version(2), 'X-OpenMotion-Representation':'text-patch', 'X-OpenMotion-Text-Edits':'1' } }));
  vi.stubGlobal('fetch',fetch);
  const res = await readVersionedSource('/api/file',{content:'x文',version:version(1)});
  expect(await res.json()).toMatchObject({ content: '新文', version: version(2) });
  expect(res.headers.get('etag')).toBe(version(2));
  expect(res.headers.get('X-OpenMotion-Text-Edits')).toBe('1');
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(['', 'W/'])('keeps the confirmed source for a 304 with a %s validator', async prefix => {
  const base = { content: 'same', version: version(1) };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: prefix + base.version } }));
  vi.stubGlobal('fetch', fetch);
  const response = await readVersionedSource('/api/file', base);
  expect(await response.json()).toEqual({ ...base, missing: false });
  expect(fetch.mock.calls[0][1].headers['If-None-Match']).toBe(base.version);
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([200, 304])('refetches the full source for a mismatched weak ETag on a %i read', async status => {
  const headers = { ETag: 'W/' + version(3), 'X-OpenMotion-Representation': 'text-patch' };
  const conditional = status === 304
    ? new Response(null, { status, headers })
    : Response.json({ baseVersion: version(1), version: version(2), patch: [[0, 1, 'y']] }, { headers });
  const fetch = vi.fn().mockResolvedValueOnce(conditional)
    .mockResolvedValueOnce(Response.json({ content: 'authoritative', version: version(3) }));
  vi.stubGlobal('fetch', fetch);
  const response = await readVersionedSource('/api/file', { content: 'x', version: version(1) });
  expect(await response.json()).toEqual({ content: 'authoritative', version: version(3) });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('changes only the title style in an authored composition with large, unrelated SVG', async () => {
  const { applyProjectEdit } = await import('../../../packages/edit-core/commands');
  const { createTextPatch } = await import('../../../shared/create-text-patch');
  const { stampHfIdsInPlace } = await import('@hyperframes/parsers/hf-ids');
  const svg = '<svg>' + '<path d="M0 0 L20 40"></path>'.repeat(6000) + '</svg>';
  const before = stampHfIdsInPlace("<template><h1 data-hf-id='title' title='Keep quoted'>Hi</h1><template id='drawing'>" + svg + '</template></template>');
  const edit = { kind: 'editElements' as const, compositionPath: 'intro.html', patches: [{ target: {hfId: 'title', id: 'other', selector: '#unrelated'},
    operations: [{type: 'inline-style' as const, property: 'color', value: '#204060'}] }] };
  const {content} = await applyProjectEdit(before, edit, new Map());
  expect(content).toBe(before.replace("title='Keep quoted'>", "title='Keep quoted' style=\"color: #204060\">"));
  expect(createTextPatch(before, content)).toHaveLength(1);
});


it('changes only the text of a plain authored heading and escapes markup through the SDK', async () => {
  const { applyProjectEdit } = await import('../../../packages/edit-core/commands');
  const source = "<template><h1 id='a' data-hf-id='title'>原文 🌿</h1><svg><path d='M0 0'></path></svg></template>";
  const edit = { kind: 'editElements' as const, compositionPath: 'intro.html', patches: [{ target: { hfId: 'title' },
    operations: [{ type: 'text-content' as const, property: 'textContent', value: '中 🎈 <em> & OK' }] }] };
  const { content } = await applyProjectEdit(source, edit, new Map());
  expect(content).toBe(source.replace('原文 🌿', '中 🎈 &lt;em&gt; &amp; OK'));
  const nested = source.replace('原文 🌿', '<strong>旧文</strong>');
  const after = await applyProjectEdit(nested, edit, new Map());
  expect(after.content).toMatch(/<strong[^>]*>中 🎈 &lt;em&gt; &amp; OK<\/strong>/);
});


it('joins the selected file read already in flight, using it only on an exact version match', async () => {
  const { observePendingSourceRead, rememberSource } = await import('./confirmedTextSources');
  const { resolveEditSource } = await import('./studioTextEdits');
  const project = 'reading-source', path = 'intro.html';
  const fetch = vi.fn().mockResolvedValue(sourceResponse('remote', 3));
  vi.stubGlobal('fetch', fetch);
  let release!: () => void;
  const read = new Promise<void>(resolve => { release = resolve; }).then(() =>
    rememberSource(project, path, { content: 'known', version: version(2) }));
  const seen = observePendingSourceRead(project, path, read);
  const save = resolveEditSource(project, path, file => file.version === version(2), 'edit', true);
  release();
  await seen;
  await expect(save).resolves.toEqual({ content: 'known', version: version(2) });
  expect(fetch).not.toHaveBeenCalled();
  await expect(resolveEditSource(project, path, file => file.version === version(1), 'stale', true)).rejects.toMatchObject({ syncLatest: true });
  expect(fetch).toHaveBeenCalledOnce();
});
