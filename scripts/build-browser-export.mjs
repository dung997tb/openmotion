import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

// @hyperframes/parsers re-exports AST/DOM parsers from its root barrel, while
// preview-browser-export only reads pure helpers (decodedUrlPath, CANVAS_DIMENSIONS).
// Stubbing those unused CJS/Node-only parser imports mirrors studio/vite.config.ts's
// treeshake rule and keeps preview-browser-export.js lean and browser-safe.
const UNUSED_PARSER_DEPS = /^(?:@babel\/parser|recast|acorn|acorn-walk|esprima|linkedom|cssomnom|os)$/;

await build({
  entryPoints: [fileURLToPath(new URL('studio/src/render/previewBrowserExportEntry.ts', root))],
  outfile: fileURLToPath(new URL('studio/build/preview-browser-export.js', root)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  define: { 'import.meta.env': '{}' },
  minify: true,
  logLevel: 'silent',
  plugins: [
    {
      name: 'drop-unused-hyperframes-parsers',
      setup(b) {
        b.onResolve({ filter: UNUSED_PARSER_DEPS }, (args) => ({
          path: args.path,
          namespace: 'unused-parser-stub',
          sideEffects: false,
        }));
        b.onLoad({ filter: /.*/, namespace: 'unused-parser-stub' }, () => ({
          contents: 'module.exports = {};',
        }));
      },
    },
  ],
});
