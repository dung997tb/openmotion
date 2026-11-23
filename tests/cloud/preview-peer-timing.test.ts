import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parseHTMLContent } from '@hyperframes/core/compiler/html-document';
import { PREVIEW_BRIDGE_SCRIPT } from '../../src/studio/engine/preview-bridge.ts';

const sha = (n: number) => String(n).repeat(64);
const etag = (n: number) => '"sha256:' + sha(n) + '"';
const root = { compositionId: 'root', tag: 'main', attributes: [['data-duration', '15', '14']] };
const clip = { id: 'clip', tag: 'audio', attributes: [['data-start', '2', '3'], ['data-media-start', null, '1']] };

function preview() {
  const document = parseHTMLContent('<html><body><main data-composition-id="root" data-hf-authored-duration="15"><audio id="clip" data-start="2"></audio></main></body></html>');
  const script = document.createElement('script');
  script.setAttribute('data-openmotion-preview', JSON.stringify({
    projectId: 'p', compositionPath: 'index.html', sourceVersions: { 'index.html': sha(1) }, studioOrigin: 'https://studio.test', canRebindTiming: true,
  }));
  Object.defineProperty(document, 'currentScript', { value: script });
  const replies: { result?: unknown }[] = [];
  const parent = { postMessage: (reply: typeof replies[number]) => replies.push(reply) };
  const hooks: string[] = [];
  const player = { getTime: () => 4, isPlaying: () => true, seek: (time: number) => hooks.push('seek:' + time), play: () => hooks.push('play') };
  let handle!: (event: unknown) => void;
  const window = { parent, __player: player,
    __hfForceTimelineRebind: () => { hooks.push('rebind'); },
    addEventListener: (event: string, handler: typeof handle) => { if (event === 'message') handle = handler; },
  };
  runInNewContext(PREVIEW_BRIDGE_SCRIPT, { window, document, URL, CSS: { escape: (s: string) => s }, crypto: { randomUUID: () => 'document-1' },
    setInterval() {}, location: { href: 'https://preview.test/api/projects/p/preview?pt=grant' } });
  function send(overrides: Record<string, unknown> = {}, origin = 'https://studio.test', source = parent) {
    replies.length = 0;
    handle({ source, origin, data: { source: 'openmotion-studio', version: 1, type: 'peer-timing', projectId: 'p',
      token: 'grant', requestId: 'request', documentId: 'document-1', path: 'index.html', before: etag(1), after: etag(2),
      expiresAt: Date.now() + 350, changes: [root, clip], ...overrides } });
    return replies[0]?.result;
  }
  return { send, document, hooks, window };
}

it('applies a complete version once, preserves the media node and rebinds at the playhead', () => {
  const { send, document, hooks } = preview();
  const audio = document.getElementById('clip')!;
  assert.equal(send(), true);
  assert.deepEqual(hooks, ['seek:4', 'rebind', 'play']);
  assert.equal(document.querySelector('main')!.getAttribute('data-hf-authored-duration'), '14');
  assert.equal(document.getElementById('clip'), audio);
  assert.equal(audio.getAttribute('data-media-start'), '1');
  assert.equal(send(), false);
  const reverse = { before: etag(2), after: '"patch:' + sha(3) + '"',
    changes: [{ id: 'clip', tag: 'audio', attributes: [['data-media-start', '1', null]] }] };
  assert.equal(send(reverse), true);
  assert.equal(audio.hasAttribute('data-media-start'), false);
  assert.equal(send({ ...reverse, before: reverse.after, after: etag(4), changes: [clip] }), false);
});

it('refuses expired, stale, unauthenticated, structural, ambiguous or incomplete work without a partial write', () => {
  const { send, document, hooks } = preview();
  const current = document.querySelector('main')!;
  assert.equal(send({}, 'https://elsewhere.test'), undefined);
  assert.equal(send({ token: 'wrong' }), undefined);
  assert.equal(send({ projectId: 'another' }), undefined);
  assert.equal(send({ documentId: 'retired-document' }), false);
  assert.equal(send({ path: 'other.html' }), false);
  assert.equal(send({ expiresAt: 0 }), false);
  assert.equal(send({ before: etag(9) }), false);
  assert.equal(send({ changes: [root, { ...clip, attributes: [['src', null, '/file']] }] }), false);
  assert.equal(send({ changes: [root, { ...clip, attributes: [['data-start', '8', '9']] }] }), false);
  const duplicate = document.getElementById('clip')!.cloneNode(false);
  current.appendChild(duplicate);
  assert.equal(send(), false);
  assert.equal(current.getAttribute('data-hf-authored-duration'), '15');
  assert.equal(current.hasAttribute('data-duration'), false);
  assert.deepEqual(hooks, []);
});

it('returns false and restores the old fields if runtime rebind fails', () => {
  const { window, document, send } = preview();
  const rebind = window.__hfForceTimelineRebind;
  window.__hfForceTimelineRebind = () => { throw new Error('runtime rejected'); };
  assert.equal(send(), false);
  assert.equal(document.querySelector('main')!.getAttribute('data-hf-authored-duration'), '15');
  assert.equal(document.getElementById('clip')!.getAttribute('data-start'), '2');
  window.__hfForceTimelineRebind = rebind;
  assert.equal(send(), true);
});

it('enables the fast path only for declarative documents with no user startup code to rerun', async () => {
  const { bundlePreviewInMemory } = await import('../../src/studio/engine/preview-bundler.ts');
  const { InMemoryVirtualProject } = await import('../../src/studio/virtual-project-store.ts');
  const { parseHTMLContent } = await import('@hyperframes/core/compiler/html-document');
  async function build(start: number, extra = '', otherFiles: Record<string, string> = {}) {
    const index = '<!doctype html><html><head></head><body><main data-composition-id="main" data-duration="6" data-width="900" data-height="500">' +
      '<div id="title" data-start="' + start + '" data-duration="2">Label</div>' + extra + '</main></body></html>';
    const sources = { 'index.html': index, ...otherFiles };
    const project = new InMemoryVirtualProject({ projectId: 'p', projectName: 'p', revision: sha(start),
      files: Object.entries(sources).map(([path, html]) => ({ path, blobScope: 'workspace', sha256: sha(start), sizeBytes: html.length, mimeType: 'text/html', isText: true, updatedAt: new Date() })),
      textContents: sources });
    const html = await bundlePreviewInMemory(project, { skipDeterministicFonts: true, bridgeOrigin: 'https://preview.test', studioOrigin: 'https://studio.test' });
    const doc = parseHTMLContent(html!);
    const settings = JSON.parse(doc.querySelector('script[data-openmotion-preview]')!.getAttribute('data-openmotion-preview')!);
    return { doc, allowed: settings.canRebindTiming === true };
  }
  const startup = '<script>document.querySelector("#title").textContent = document.querySelector("#title").dataset.start;</script>';
  for (const start of [2, 3]) {
    const { doc, allowed } = await build(start, startup);
    assert.equal(allowed, false);
    const title = doc.getElementById('title')!;
    runInNewContext('document.querySelector("#title").textContent = document.querySelector("#title").dataset.start;', { document: doc });
    assert.equal(title.textContent, String(start));
  }
  assert.equal((await build(2)).allowed, true);
  assert.equal((await build(2, '<img onload="paint()" src="p.png">')).allowed, false);
  assert.equal((await build(2, '<div data-composition-src="scene.html"></div>')).allowed, false);
  assert.equal((await build(2, '', { '.hyperframes/studio-manual-edits.json': '{}' })).allowed, false);
});
