// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { applyTextPatch } from '../../../shared/text-patch';
import { readProjectFileContent } from './studioFileHistory';
import { submitStudioCommands } from './projectEditBatch';
import { observedSourceVersion, confirmedSource } from './confirmedTextSources';
import { tryStudioTextEdit } from './studioTextEdits';
import { onRebasedFileEdit } from './rebasedFileEdit';
import { readVersionedSource } from './readVersionedSource';

const version = (n: number) => '"patch:' + n.toString(16).padStart(64, '0') + '"';
const sourceResponse = (content: string, n: number) => Response.json({ content, version: version(n) },
  { headers: { 'X-OpenMotion-Text-Edits': '1' } });
const receipt = (paths: string[], n: number) => Response.json({ versions: Object.fromEntries(paths.map(path => [path, version(n)])), changedPaths: paths });

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
    .mockResolvedValueOnce(Response.json({ path, currentVersion: version(2) }, { status: 409 }));
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

it('reads a patch-version source with one GET and retains the write capability', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ baseVersion:version(1), version:version(2), patch:[[0,1,'新']] },
    { headers: { ETag:version(2), 'X-OpenMotion-Representation':'text-patch', 'X-OpenMotion-Text-Edits':'1' } }));
  vi.stubGlobal('fetch',fetch);
  const res = await readVersionedSource('/api/file',{content:'x文',version:version(1)});
  expect((await res.json()).content).toBe('新文');
  expect(res.headers.get('X-OpenMotion-Text-Edits')).toBe('1');
  expect(fetch).toHaveBeenCalledOnce();
});

it('keeps its confirmed source when revalidation returns 304', async () => {
  const base = { content: 'same', version: version(1) };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: base.version } }));
  vi.stubGlobal('fetch', fetch);
  const response = await readVersionedSource('/api/file', base);
  expect(await response.json()).toEqual({ ...base, missing: false });
  expect(fetch.mock.calls[0][1].headers['If-None-Match']).toBe(base.version);
  expect(fetch).toHaveBeenCalledOnce();
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
