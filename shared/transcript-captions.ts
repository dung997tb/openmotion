import type * as HtmlParser from '@hyperframes/parsers/html-attribute-spans';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCaptionSourceOperations } from '../packages/edit-core/captions.ts';
export { createCaptionSourceOperations, type CaptionPlacement, type CaptionTrack } from '../packages/edit-core/captions.ts';
import { exportCaptionSource } from './caption-export.ts';

/** Resolve native parsing from the installed runtime, never from the read-only ZIP. */
export async function loadCaptionSourceOperations(runtimeRoot: string) {
  const require = createRequire(path.join(runtimeRoot, 'package.json'));
  const manifest = require.resolve('@hyperframes/parsers/package.json');
  const pkg = JSON.parse(await readFile(manifest, 'utf8'));
  const parser = await import(pathToFileURL(path.join(path.dirname(manifest), pkg.exports['./html-attribute-spans'].import)).href) as typeof HtmlParser;
  // Resolve the native parser's DOM dependency from its own installation.
  const nativeRequire = createRequire(manifest);
  const { parseHTML } = nativeRequire('linkedom') as typeof import('linkedom');
  // linkedom already uses htmlparser2; source offsets let edits preserve the surrounding authored HTML.
  const domRequire = createRequire(nativeRequire.resolve('linkedom'));
  const { parseDocument } = domRequire('htmlparser2') as typeof import('htmlparser2');
  return { parseHTML, ...createCaptionSourceOperations(parser, parseDocument), exportCaptionSource: (html: string, format: 'srt' | 'vtt', trackId?: string) => exportCaptionSource(html, format, parseHTML, trackId) };
}
