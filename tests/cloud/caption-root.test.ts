import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCaptionSourceOperations } from '../../shared/transcript-captions.ts';

const ops = await loadCaptionSourceOperations(process.cwd());
const cue = { segments: [{ id: 'cue1', text: 'Parent caption', start: 0, end: 2 }] };
const id = '11111111-1111-4111-8111-111111111111';

test('caption edits remain inside a semantic root and leave nested and sibling tracks intact', () => {
  const nested = '<span data-caption-track="' + id + '" data-timeline-role="caption" data-track-index="2" data-start="0" data-duration="2" data-timeline-locked>Nested</span>';
  const other = '<article data-composition-id="other" data-duration="1"><i class="clip" data-track-index="9"></i></article>';
  for (const tag of ['div','main','section','article']) {
    const html = '<!-- <div data-composition-id="fake"> --><' + tag + ' data-composition-id="parent" data-duration="1"><div class="clip" data-track-index="2" data-composition-id="child">' + nested + '</div></' + tag + '>' + other;
    const added = ops.manualCaptionSource(html, id, cue);
    assert.match(added.content, /data-composition-id="parent" data-duration="2">\s*<!-- openmotion-transcript/);
    assert.match(added.content, /class="clip" data-track-index="3" data-composition-id="child"/);
    assert.ok(added.content.includes(nested) && added.content.endsWith(other));
    assert.equal(ops.captionTracks(added.content)[0]?.cueCount, 1);
    assert.doesNotMatch(ops.exportCaptionSource(added.content, 'srt', id).content, /Nested/);
    const removed = ops.updateCaptionTrackSource(added.content, id, {}, true);
    assert.ok(removed.content.includes(nested) && removed.content.endsWith(other));
    assert.ok(!removed.content.includes('Parent caption'));
  }
});

test('void elements, non-native hosts and missing composition roots cannot receive captions', () => {
  for (const html of ['<img data-composition-id="bad" data-duration="1">','<div data-composition-id="foreign" data-composition-src="child.html" data-duration="5"></div>', '<svg data-composition-id="shape"></svg>', '<p>Missing root</p>', '<main data-composition-id="open" data-duration="2"><p>Missing end</p>']) {
    assert.throws(() => ops.manualCaptionSource(html, id, cue), /native HTML composition/);
  }
});

test('a damaged caption block cannot remove a nested composition between its boundary markers', () => {
  const source = '<main data-composition-id="parent" data-duration="2"></main>';
  const added = ops.manualCaptionSource(source, id, cue).content;
  const end = `<!-- openmotion-transcript:${id}:end -->`;
  const damaged = added.replace(end, '<section data-composition-id="child"></section>'+end);
  assert.throws(() => ops.updateCaptionTrackSource(damaged, id, {}, true), /markers changed/);
  assert.throws(() => ops.manualCaptionSource(damaged, id, cue), /markers changed/);
});
