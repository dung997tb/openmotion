// Hyperframes 0.9.7 includes these native Studio manifests in render inputs.
// Everything else in .hyperframes is cache metadata and must not affect revision hashes.
export const STUDIO_MANIFESTS: readonly string[] = [
  '.hyperframes/studio-manual-edits.json',
  '.hyperframes/studio-motion.json',
];

const PREVIEW_AFFECTING_EXT = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.mp4',
  '.mov',
  '.webm',
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.ttc',
  '.cube',
  '.glsl',
  '.vert',
  '.frag',
]);

export const NON_PREVIEW_FILES: ReadonlySet<string> = new Set([
  'motion-project.json',
  'motion-assets.json',
  'LICENSE',
  'NOTICE.md',
]);

/** Extract the inner `<head>...</head>` markup from `index.html` (empty string when absent). */
export function extractIndexHeadMarkup(indexHtml: string | null | undefined): string {
  if (!indexHtml) return '';
  return /<head[^>]*>([\s\S]*?)<\/head>/i.exec(indexHtml)?.[1] ?? '';
}

export interface PreviewImpact {
  affectsPreview: boolean;
  affectedCompositions: string[];
}

/**
 * Determine whether a set of modified paths affects preview rendering and which compositions are affected.
 * Pure in-memory equivalent of Hyperframes' project-signature / preview-read tracking.
 */
export function computePreviewImpact(paths: readonly string[]): PreviewImpact {
  let affectsPreview = false;
  const compositions = new Set<string>();

  for (const rawPath of paths) {
    const normalized = rawPath.replace(/^\/+/, '');
    if (NON_PREVIEW_FILES.has(normalized)) continue;
    if (STUDIO_MANIFESTS.includes(normalized) || normalized === 'hyperframes.json') {
      affectsPreview = true;
      compositions.add('index.html');
      continue;
    }
    const name = normalized.slice(normalized.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
    if (PREVIEW_AFFECTING_EXT.has(ext)) {
      affectsPreview = true;
    }
    if (ext === '.html' || ext === '.htm') {
      compositions.add(normalized);
      if (normalized !== 'index.html') {
        compositions.add('index.html');
      }
    } else if (PREVIEW_AFFECTING_EXT.has(ext)) {
      compositions.add('index.html');
    }
  }

  return {
    affectsPreview,
    affectedCompositions: [...compositions].sort((a, b) => a.localeCompare(b)),
  };
}
