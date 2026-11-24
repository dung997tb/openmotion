import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { parseHTMLContent } from '@hyperframes/core/compiler/html-document';
import { assembleBuiltinTemplate, BUILTIN_TEMPLATES } from '../../src/services/builtin-template-source.ts';
import { bundlePreviewInMemory } from '../../src/studio/engine/preview-bundler.ts';
import { verifiedPreviewLiveEdits } from '../../src/studio/engine/preview-live-edits.ts';
import { InMemoryVirtualProject } from '../../src/studio/virtual-project-store.ts';

test('only an author-reviewed script set opts into position and media timing updates', async () => {
  const template = await assembleBuiltinTemplate(BUILTIN_TEMPLATES[0]!);
  const initial = Object.fromEntries(template.files.filter(f => f.isProjectFile).map(f => {
    assert.ok(f.bytes);
    return [f.path, f.bytes] as const;
  }));
  function fixture(replacements: Record<string, string> = {}) {
    const contents = {...initial, ...Object.fromEntries(Object.entries(replacements).map(([path, value]) => [path, Buffer.from(value)]))};
    return new InMemoryVirtualProject({ projectId: 'user-copy', projectName: 'Renamed template', revision: '1',
      files: Object.entries(contents).map(([path, bytes]) => ({path, blobScope:'workspace', sha256:createHash('sha256').update(bytes).digest('hex'),
        sizeBytes:bytes.length, mimeType:'application/octet-stream', isText:/\.(?:html|js|css)$/.test(path), updatedAt:new Date(0)})),
      textContents: Object.fromEntries(Object.entries(contents).filter(([path]) => /\.(?:html|js|css)$/.test(path)).map(([path, bytes]) => [path, bytes.toString()])),
    });
  }
  const project = fixture();
  const capabilities = {mediaTiming:true, position:true};
  assert.deepEqual(verifiedPreviewLiveEdits(project), capabilities);
  const html = await bundlePreviewInMemory(project, {bridgeOrigin:'https://preview.test', studioOrigin:'https://studio.test',skipDeterministicFonts:true});
  const settings = JSON.parse(parseHTMLContent(html!).querySelector('script[data-openmotion-preview]')!.getAttribute('data-openmotion-preview')!);
  assert.deepEqual(settings.liveEdits, capabilities);
  const index = project.readText('index.html')!;
  const moved = index.replace('src="assets/soundtrack.m4a" data-start="0"', 'src="assets/soundtrack.m4a" data-start="2"');
  assert.notEqual(moved, index);
  assert.deepEqual(verifiedPreviewLiveEdits(fixture({'index.html':moved})), capabilities);
  const changes: Record<string, string>[] = [
    {'index.html': index.replace(/<meta name="openmotion-live-edits"[^>]*>/, '')},
    {'index.html': index.replace('</body>', '<script>document.title=document.querySelector("audio").dataset.start</script></body>')},
    {'compositions/intro.html': '<template><script>window.titleX=document.body.offsetLeft</script></template>'},
    {'assets/artwork.js': 'window.titleX=document.body.offsetLeft'},
    {'compositions/new.html': '<img src="title.png" onload="changeTimeline()">'},
  ];
  for (const change of changes) assert.equal(verifiedPreviewLiveEdits(fixture(change)), undefined);
});
