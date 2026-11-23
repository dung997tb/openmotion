import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseHTMLContent } from '@hyperframes/core/compiler';
import { bundlePreviewInMemory } from '../../src/studio/engine/preview-bundler.ts';
import { staticPreviewHtmlSources } from '../../src/studio/engine/preview-html-sources.ts';
import { InMemoryVirtualProject } from '../../src/studio/virtual-project-store.ts';

const scene = (body: string, id = 'main') =>
  `<html><head></head><body><main data-composition-id="${id}" data-duration="3">${body}</main></body></html>`;
const mount = (path: string, id: string) => `<div data-composition-id="${id}" data-composition-src="${path}"></div>`;

async function htmlSources(files: Record<string, string>) {
  const project = new InMemoryVirtualProject({
    projectId: 'probe', projectName: 'Probe', revision: 'a'.repeat(64), textContents: files,
    files: Object.entries(files).map(([path, content]) => ({ path, blobScope: 'workspace', sha256: 'a'.repeat(64),
      sizeBytes: Buffer.byteLength(content), mimeType: 'text/html', isText: true, updatedAt: new Date() })),
  });
  const html = await bundlePreviewInMemory(project, { bridgeOrigin: 'https://preview.test', skipDeterministicFonts: true });
  const config = parseHTMLContent(html!).querySelector('script[data-openmotion-preview]')!.getAttribute('data-openmotion-preview');
  return JSON.parse(config!).htmlSources;
}

it('records only the HTML actually assembled, including descendants resolved relative to their owner', async () => {
  const files = {
    'index.html': scene(mount('compositions/intro.html', 'intro')),
    'compositions/intro.html': scene(mount('title.html', 'title'), 'intro'),
    'compositions/title.html': scene('<h1>Hello</h1>', 'title'),
    'unused.html': scene('<script>loadSomething()</script>'),
  };
  assert.deepEqual(await htmlSources(files), ['index.html', 'compositions/intro.html', 'compositions/title.html']);
  assert.deepEqual(await htmlSources({ ...files, 'index.html': scene('<aside>Solo</aside>') }), ['index.html']);
});

it('retains full refresh for dynamic or unknown inputs, including those inside a nested template', async () => {
  for (const dynamic of ['<script>fetch("more.html")</script>', '<img src="image.png" onload="loadMore()">',
    '<iframe src="frame.html"></iframe>', '<style>@import "style.css"</style>', '<img src="photo.html">']) {
    const child = `<template><section data-composition-id="child">${dynamic}</section></template>`;
    assert.equal(await htmlSources({ 'index.html': scene(mount('child.html', 'child')), 'child.html': child }), undefined);
  }
  assert.equal(await htmlSources({ 'index.html': scene(mount('missing.html', 'missing')) }), undefined);
});

it('tracks referenced HTML through static RGB and HSL color declarations', async () => {
  const files = {
    'index.html': scene('<style>.card{color:RGB(255, 0, 1);background:hsl(210 60% 40% / 50%)}</style>' + mount('child.html', 'child')),
    'child.html': scene('<span style="color:rgba(2,3,4,.5);background:hsla(.5turn 30% 40% / 1)">Title</span>', 'child'),
    'unused.html': scene('<p>Unused</p>'),
  };
  assert.deepEqual(await htmlSources(files), ['index.html', 'child.html']);
});

it('keeps full refresh for mixed and unrecognized CSS even when it also contains numeric colors', () => {
  for (const value of [
    'rgb(1 2 3) url("a.png")', 'image-set("a.png" 1x)', 'color-mix(in srgb,rgb(1 2 3),hsl(0 40% 50%))',
    'rgb(var(--r) 2 3)', '--paint-rgb(1 2 3)', 'unknown\u00a0rgb(1 2 3)', 'rgb(1 2 3) /* hsl(0 40% 50%) */',
    String.raw`u\72l(a.png)`, '"rgb(1 2 3)"', 'rgb(1 2 3);@import "theme.css"',
  ]) {
    const nested = parseHTMLContent(scene(`<template><span></span><style>.a{background:${value}}</style></template>`));
    assert.equal(staticPreviewHtmlSources('index.html', nested, '/runtime.js').paths(), undefined, value);
  }
});
