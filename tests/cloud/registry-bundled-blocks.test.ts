import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import { compositionVariableValues, setBlockParameter } from '../../packages/edit-core/composition-variable.ts';
import { getMotionComponent, motionComponentCards, prepareMotionComponent } from '../../src/services/motion-component-registry.ts';
import { primaryFile } from '../../src/services/motion-component-source.ts';

test('bundled blocks install offline and each advertised control has one editable binding', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('A bundled block must install offline'); });
  const sources = await readdir(new URL('../../library/components/registry/blocks/', import.meta.url));
  assert.deepEqual(sources.sort(), [
    'data-chart.html', 'logo-outro.html', 'vfx-liquid-background.html',
    'vfx-liquid-glass.html', 'vfx-magnetic.html', 'vfx-portal.html',
  ]);
  for (const filename of sources) {
    const name = filename.replace(/\.html$/, '');
    const item = getMotionComponent(name);
    assert.ok(item.type === 'hyperframes:block', name);
    const path = primaryFile(item).target;
    const [file] = await prepareMotionComponent(item, new Set(), true);
    assert.ok(file?.op === 'upsert_binary' && file.path === path, name);
    const source = file.data.toString('utf8');
    const params = item.params ?? [];
    const keys = params.map(param => param.key);
    const values = compositionVariableValues(source, keys);
    assert.ok(values?.size && values.size === params.length, name);
    for (const param of params) {
      assert.equal(values.get(param.key)?.toLowerCase(), param.default.toLowerCase(), name + ' ' + param.key);
      const after = setBlockParameter(source, param.key, '#426d8e', path);
      assert.deepEqual(compositionVariableValues(after, keys), new Map(values).set(param.key, '#426d8e'));
    }
    assert.deepEqual(await prepareMotionComponent(item, new Set([path])), [], 'Preserve installed ' + name);
  }
  const magnetic = motionComponentCards.find(card => card.name === 'vfx-magnetic');
  assert.deepEqual(magnetic?.params?.map(param => param.key), ['--bg-color']);
});
