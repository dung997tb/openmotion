import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parseHTMLContent } from '@hyperframes/core/compiler/html-document';
import { createPreviewBridgeScript } from '../../src/studio/engine/preview-bundler.ts';

it('binds clips to authored files, including nested hosts and repeated scene-local IDs', () => {
  const document = parseHTMLContent(`<html><body><main data-composition-id="root">
    <section id="host" data-hf-id="host-hf" data-composition-id="a" data-composition-file="a.html">
      <audio id="voice" data-hf-id="a-voice" data-volume="0" muted data-hidden data-timeline-locked></audio>
      <section id="inner-host" data-composition-id="b" data-composition-file="b.html">
        <span data-hf-id="only-hf"></span><audio id="voice" data-hf-id="b-voice" data-volume="1.35"></audio>
      </section>
    </section>
  </main></body></html>`);
  const clips = [
    { id: 'host', compositionAncestors: ['root'] },
    { id: 'inner-host', compositionAncestors: ['root', 'a'] },
    { id: 'voice', compositionAncestors: ['root', 'a'] },
    { id: 'voice', compositionAncestors: ['root', 'a', 'b'] },
    { id: 'only-hf', compositionAncestors: ['root', 'a', 'b'] },
    { id: 'voice' }, { id: 'missing' },
  ];
  const messages: Array<{ type: string; clips?: Array<{ authored?: Record<string, unknown> }> }> = [];
  const parent = { postMessage: (message: typeof messages[number]) => messages.push(message) };
  const listeners: Record<string, (event: unknown) => void> = {};
  const window = { parent, __clipManifest: { clips }, addEventListener: (type: string, cb: (event: unknown) => void) => { listeners[type] = cb; } };
  runInNewContext(createPreviewBridgeScript('p', 'index.html', { 'index.html': 'v1', 'a.html': 'v2', 'b.html': 'v3' }), {
    document, window, URL, location: { href: 'https://preview.test/api/projects/p/preview?pt=grant' }, setInterval() {},
  });
  listeners.message!({ source: parent, data: { source: 'openmotion-studio', version: 1,
    projectId: 'p', token: 'grant', type: 'handshake', timelineOnly: true } });
  const rows = Array.from(messages.find(m => m.type === 'timeline-state')!.clips!);
  assert.deepEqual(rows.map(row => row.authored?.sourceFile), ['index.html', 'a.html', 'a.html', 'b.html', 'b.html', undefined, undefined]);
  assert.equal(rows[2]?.authored?.hfId, 'a-voice');
  assert.equal(rows[2]?.authored?.muted, true);
  assert.equal(rows[2]?.authored?.volume, 0);
  assert.equal(rows[3]?.authored?.volume, 1.35);
  assert.equal(rows[0]?.authored?.volume, undefined);
  assert.equal(rows[2]?.authored?.timelineLocked, true);
  assert.equal(rows[2]?.authored?.hidden, true);
  assert.equal(rows[3]?.authored?.hfId, 'b-voice');
  assert.equal(rows[4]?.authored?.hfId, 'only-hf');
  assert.equal(rows[4]?.authored?.domId, undefined);
});
