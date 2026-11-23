import { strict as assert } from 'node:assert';
import { it } from 'node:test';
import { createTextPatch } from '../../shared/create-text-patch.ts';
import { applyTextPatch } from '../../shared/text-patch.ts';

it('serializes multiple replacements against UTF-8 byte positions in the same original source', () => {
  const before = '\uFEFF片头🚀\r\nfont-size:48px;\r\ncolor:red;\n' + 'unchanged '.repeat(40);
  const after = before.replace('🚀', '🌙').replace('48', '100').replace('red', '蓝');
  const patch = createTextPatch(before, after);
  assert.ok(patch && patch.length === 3);
  assert.equal(applyTextPatch(before, JSON.parse(JSON.stringify(patch))), after);
  assert.equal(applyTextPatch(before, []), before);
});

it('inserts and deletes at file boundaries and preserves every other input byte', () => {
  const text = 'a'.repeat(4096) + '中';
  for (const next of ['⭐' + text, text + '🙂', text.slice(1), text.slice(0, -1)]) {
    const patch = createTextPatch(text, next);
    assert.ok(patch);
    assert.equal(applyTextPatch(text, patch), next);
  }
  assert.equal(createTextPatch('a'.repeat(2000), 'b'.repeat(2000)), null);
});

it('rejects overlapping, out-of-range and split Unicode operations', () => {
  for (const invalid of [[[1, 0, 'a']], [[0, 1, 'b']], [[0, 3, ''], [2, 1, '']],
    [[4, 1, '']], [[-1, 1, '']], [[0, -1, '']], [[0, 0, '\uD800']], [[null, 0, '']]]) {
    assert.throws(() => applyTextPatch('中a', invalid), RangeError);
  }
});
