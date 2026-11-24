import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { PREVIEW_INSPECTOR_STYLES } from '../../src/studio/engine/preview-inspector-styles.ts';

function inspector() {
  let size = '42px';
  const element = { closest: () => null, style: {
    getPropertyValue: () => size,
    getPropertyPriority: () => '',
    setProperty: (_name: string, value: string) => { size = value; },
  } };
  const send = runInNewContext(PREVIEW_INSPECTOR_STYLES + '\npreviewInspectorStyles', {
    inspectorElement: (message: { hfId?: string }) => message.hfId === 'title' ? element : null,
    CSS: { supports: () => true }, sourceVersions: { 'intro.html': 'v1' },
    sourceIdentity: (version: string) => ({fileVersion: version}),
  });
  return {
    get: () => size, scriptSets: (value: string) => { size = value; },
    show: (id: string, value: string, version = 'v1') => send({phase: 'show', editId: id, hfId: 'title',
      sourceFile: 'intro.html', fileVersion: version, styles: [['font-size', value]]}),
    settle: (id: string, saved: boolean) => send({phase: 'settle', editId: id, saved}),
  };
}

it('paints without waiting for persistence and rolls back only rejected inspector changes', () => {
  for (const older of [true, false]) for (const newer of [true, false]) for (const reverse of [true, false]) {
    const view = inspector();
    view.show('a', '44px');
    assert.equal(view.get(), '44px');
    view.show('b', '48px');
    assert.equal(view.get(), '48px');
    if (reverse) {
      view.settle('b', newer);
      view.settle('a', older);
    } else {
      view.settle('a', older);
      assert.equal(view.get(), '48px');
      view.settle('b', newer);
    }
    assert.equal(view.get(), newer ? '48px' : older ? '44px' : '42px');
  }
});

it('ignores stale targets and leaves a later runtime style alone on failure', () => {
  const view = inspector();
  view.show('wrong', '44px', 'retired');
  assert.equal(view.get(), '42px');
  view.show('a', '44px');
  view.scriptSets('54px');
  view.settle('a', false);
  assert.equal(view.get(), '54px');
});
