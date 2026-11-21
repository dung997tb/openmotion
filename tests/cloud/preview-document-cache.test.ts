import assert from 'node:assert/strict';
import { it } from 'node:test';
import { PreviewBuildBusy, PreviewDocumentCache } from '../../src/studio/engine/preview-document-cache.ts';

const doc = (revision: string, html = 'body') => ({ revision, html, templateBase: '/preview/' });

it('shares in-flight work at capacity, releases failed builds, and skips changed revisions', async () => {
  const cache = new PreviewDocumentCache(4096, 1, 1);
  let finish!: (value: ReturnType<typeof doc>) => void;
  const build = () => new Promise<ReturnType<typeof doc>>(resolve => { finish = resolve; });
  const first = cache.get('a', 'v1', build);
  const next = cache.get('a', 'v1', () => assert.fail());
  assert.strictEqual(next, first);
  let ran = false;
  const queued = cache.get('b', 'v1', async () => { ran = true; return doc('v1'); });
  assert.strictEqual(cache.get('b', 'v1', () => assert.fail()), queued);
  assert.throws(() => cache.get('c', 'v1', build), PreviewBuildBusy);
  assert.equal(ran, false);
  finish(doc('v2'));
  assert.deepEqual(await next, doc('v2'));
  assert.deepEqual(await queued, doc('v1'));
  assert.equal(ran, true);
  await assert.rejects(cache.get('a', 'v1', async () => { throw Error('temporary failure'); }));
  assert.deepEqual(await cache.get('a', 'v1', async () => doc('v1')), doc('v1'));
  assert.deepEqual(await cache.get('a', 'v1', () => assert.fail()), doc('v1'));
});

it('evicts least recently used documents by bytes and does not retain oversized or missing documents', async () => {
  const cache = new PreviewDocumentCache(600);
  for (const key of ['a', 'b', 'a', 'c']) {
    await cache.get(key, key, async () => doc(key));
  }
  await cache.get('a', 'a', () => assert.fail());
  assert.deepEqual(await cache.get('b', 'b', async () => null), null);
  const large = doc('b', '大'.repeat(300));
  assert.deepEqual(await cache.get('b', 'b', async () => large), large);
  assert.deepEqual(await cache.get('b', 'b', async () => null), null);
});
