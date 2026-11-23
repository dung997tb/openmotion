import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseSourceDocument } from '@hyperframes/studio-server/source-mutation';
import { applyContentCommand, contentDependencies } from '../../packages/edit-core/content-commands.ts';

const source =
  "<div data-composition-id='main' data-duration='4' data-width='1280' data-height='720'><img id='cover' data-hf-id='cover-1' src='../media/original.png'></div>";
const compositionPath = 'scenes/intro.html';

test('place media preserves existing ids, sets a nested path and extends the composition', () => {
  const html = applyContentCommand(source, {
    kind: 'placeAsset',
    compositionPath,
    assetPath: 'media/cover.png',
    hfId: 'new-image',
    duration: 2,
    start: 3,
    track: 1,
  });
  const { document } = parseSourceDocument(html);
  const image = document.querySelector('[data-hf-id="new-image"]')!;
  assert.equal(image.getAttribute('src'), '../media/cover.png');
  assert.notEqual(image.getAttribute('id'), 'cover');
  assert.equal(document.querySelector('[data-composition-id]')!.getAttribute('data-duration'), '5');
});

test('media replacement keeps timing and styling and guards against concurrent replacements', () => {
  const source =
    '<div data-composition-id="main"><img data-hf-id="photo" src="../media/old.png" data-start="1" style="opacity:0.8"></div>';
  const command = {
    kind: 'replaceAsset',
    compositionPath,
    assetPath: 'media/my photo.png',
    expectedAssetPath: 'media/old.png',
    hfId: 'photo',
  } as const;
  const replaced = applyContentCommand(source, command);
  const image = parseSourceDocument(replaced).document.querySelector('img')!;
  assert.equal(image.getAttribute('data-start'), '1');
  assert.equal(image.getAttribute('style'), 'opacity:0.8');
  assert.equal(image.getAttribute('src'), '../media/my%20photo.png');
  assert.throws(() => applyContentCommand(replaced, command), /changed/);
  assert.throws(() => applyContentCommand(source, { ...command, assetPath: 'media/movie.mp4' }), /same-kind/);
  assert.throws(
    () => applyContentCommand(source.replace('<div ', '<div data-timeline-locked '), command),
    /unlocked/,
  );
});

test('pasting a project-relative snapshot into a nested file keeps its asset URLs valid', () => {
  const html = applyContentCommand(source, {
    kind: 'pasteClips',
    compositionPath,
    start: 1,
    clips: [
      {
        html: '<video id="film" src="media/film.mp4?t=1" poster="media/cover.png"><source src="scenes/alternate.mp4"></video>',
        start: 0,
        track: 1,
        duration: 2,
      },
    ],
  });
  const video = parseSourceDocument(html).document.querySelector('video')!;
  assert.equal(video.getAttribute('src'), '../media/film.mp4?t=1');
  assert.equal(video.getAttribute('poster'), '../media/cover.png');
  assert.equal(video.querySelector('source')!.getAttribute('src'), 'alternate.mp4');
});

test('a pasted nested composition and its binary media become project file preconditions', () => {
  const command = {
    kind: 'pasteElement',
    compositionPath,
    start: 0,
    html: `<div data-composition-src="scenes/title.html"><video src="./media/my%20film.mp4" poster="https://example.org/cover.jpg"></video></div>`,
  } as const;
  assert.deepEqual(contentDependencies(command), [
    { path: 'scenes/title.html', type: 'text' },
    { path: 'media/my film.mp4', type: 'asset' },
  ]);
});

test('a pasted subtree cannot take a sibling’s original id when generating a new one', () => {
  const html = applyContentCommand(source, {kind: 'pasteElement', compositionPath, start: 1,
    html: '<section id="cover"><div id="cover-2"></div></section>'});
  const document = parseSourceDocument(html).document;
  assert.equal(document.querySelector('section')?.id, 'cover-3');
  assert.equal(document.querySelector('section > div')?.id, 'cover-2');
});
