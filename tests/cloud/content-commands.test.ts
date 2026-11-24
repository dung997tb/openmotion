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

test('pasting after an attribute-selected wrapper keeps the selected occurrence and its parent', () => {
  const source = `<main data-composition-id="main">
    <section data-hf-group='A &quot;B&quot;' data-anchor></section>
    <aside><section data-hf-group='A &quot;B&quot;' data-anchor><b>Original</b></section><footer></footer></aside>
  </main>`;
  for (const originSelector of ['[data-hf-group="A \\"B\\""]', '[data-anchor]']) {
    const html = applyContentCommand(source, {
      kind: 'pasteElement', compositionPath, start: 0,
      html: '<section id="copy"><b>Copy</b></section>', originSelector, originSelectorIndex: 1,
    });
    const document = parseSourceDocument(html).document;
    assert.equal(document.querySelector('aside > section + #copy + footer')?.localName, 'footer');
    assert.equal(document.querySelector('aside > section > b')?.textContent, 'Original');
  }
});

test('block variables bind by ID and preserve unrelated defaults, markup and script literals', () => {
  const schema = [
    { id: 'cellSize', type: 'number', default: 54 },
    { id: 'neighbor', type: 'number', default: 54 },
    { id: 'title', type: 'string', default: 'Initial' },
    { id: 'quantize', type: 'boolean', default: false },
  ];
  const html = `<template><main data-composition-id="grid" data-composition-variables='${JSON.stringify(schema)}'><script>const fallback = 54;</script></main></template>`;
  const edit = (source: string, id: string, value: string) => applyContentCommand(source, {
    kind: 'setBlockParameter', compositionPath: 'grid.html', key: id, value,
  });
  const number = edit(html, '--cellsize', '55');
  assert.equal(number, html.replace('"default":54', '"default":55'));
  assert.equal(edit(number, 'cellSize', '55'), number);
  assert.match(edit(number, 'quantize', 'true'), /"default":true/);
  const title = edit(number, 'title', "M & S's <intro>");
  assert.match(title, /M &amp; S&#39;s &lt;intro>/);
  assert.equal(edit(title, 'title', 'Initial'), number);
  assert.throws(() => edit(number, 'missing', '54'), /Missing/);
  assert.throws(() => edit(number, 'cellSize', 'NaN'), /Invalid value/);
  assert.throws(() => edit(number, 'quantize', 'unknown'), /Invalid value/);
});

test('updates a named CSS parameter while preserving its documented example and unrelated identical colors', () => {
  const html = '<style>/* --accent: #aaa */ #root {--accent: #aaa; color: #aaa}</style><div data-composition-id="root"></div>';
  const command = { kind: 'setBlockParameter', compositionPath: 'legacy.html', key: '--accent', value: '#bbb' } as const;
  assert.equal(applyContentCommand(html, command), html.replace('{--accent: #aaa', '{--accent: #bbb'));
  assert.throws(() => applyContentCommand(html + '<style>body{--accent:black}</style>', command), /Ambiguous CSS parameter/);
});
