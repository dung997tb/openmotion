import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  BUILTIN_TEMPLATES, builtinTemplateMetadata, getBuiltinTemplateSource,
} from '../../src/services/builtin-template-source.ts';

it('lists built-in cards without bytes and shares each lazily loaded source across readers', async () => {
  assert.equal(await getBuiltinTemplateSource('../index.html'), null);
  for (const definition of BUILTIN_TEMPLATES) {
    const summary = builtinTemplateMetadata(definition);
    assert.deepEqual(summary.files, []);
    const [source, concurrent] = await Promise.all([
      getBuiltinTemplateSource(definition.id), getBuiltinTemplateSource(definition.id),
    ]);
    assert.ok(source);
    assert.equal(source, concurrent);
    assert.deepEqual(source.metadata, summary.metadata);
    assert.ok(source.files.find(file => file.path === 'index.html')?.isProjectFile);
    assert.ok(source.files.some(file => file.path === 'poster.jpg' && !file.isProjectFile));
    assert.ok(source.files.every(file => file.bytes?.length === file.sizeBytes));
  }
});
