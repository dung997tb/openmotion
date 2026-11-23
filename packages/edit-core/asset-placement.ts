import { decodeAuthoredAttribute, scanHtmlOpeningTags } from '@hyperframes/parsers/html-attribute-spans';
import { fontFamilyFromAssetPath, importedFontFaceCss } from './font-asset.ts';
import { encodeUrlPath } from '@hyperframes/parsers';
import { IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, FONT_EXT } from '../../shared/asset-names.ts';
import designTokens from '../design-system/tokens.json' with { type: 'json' };
export type TimelineAssetKind = 'image' | 'video' | 'audio' | 'text';
export function collectHtmlIds(source: string, tags = scanHtmlOpeningTags(source)): string[] {
  return tags.flatMap(({ attributes }) => {
    const id = attributes.find((attr) => attr.name === 'id');
    return id?.kind === 'value' ? [decodeAuthoredAttribute(id.value)] : [];
  });
}

export function getTimelineAssetKind(assetPath: string): TimelineAssetKind | null {
  if (IMAGE_EXT.test(assetPath)) return 'image';
  if (VIDEO_EXT.test(assetPath)) return 'video';
  if (AUDIO_EXT.test(assetPath)) return 'audio';
  if (FONT_EXT.test(assetPath)) return 'text';
  return null;
}

export function resolveTimelineAssetSrc(targetPath: string, assetPath: string): string {
  const targetDir = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
  if (!targetDir) return assetPath;

  const fromParts = targetDir.split('/').filter(Boolean);
  const toParts = assetPath.split('/').filter(Boolean);
  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }

  const up = fromParts.map(() => '..');
  const relative = [...up, ...toParts].join('/');
  return relative || assetPath.split('/').pop() || assetPath;
}

export function resolveTimelineAssetCompositionSize(source: string): {
  width: number;
  height: number;
} {
  const width = Number.parseFloat(source.match(/\bdata-width=(["'])([^"']+)\1/i)?.[2] ?? '');
  const height = Number.parseFloat(source.match(/\bdata-height=(["'])([^"']+)\1/i)?.[2] ?? '');
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 640,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : 360,
  };
}

/**
 * CapCut-style placement: natural size when it fits, scaled-to-fit when
 * oversized, always centered. Unknown natural size → full-frame.
 */
export function fitTimelineAssetGeometry(
  natural: { width: number; height: number } | null,
  comp: { width: number; height: number },
  center?: { left: number; top: number },
): { left: number; top: number; width: number; height: number } {
  const size = natural && natural.width > 0 && natural.height > 0 ? natural : comp;
  const scale = Math.min(1, comp.width / size.width, comp.height / size.height);
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  return {
    left: Math.round((center?.left ?? comp.width / 2) - width / 2),
    top: Math.round((center?.top ?? comp.height / 2) - height / 2),
    width,
    height,
  };
}

export function buildTimelineAssetInsertHtml(input: {
  id: string;
  hfId: string;
  assetPath: string;
  kind: TimelineAssetKind;
  start: number;
  duration: number;
  track: number;
  zIndex: number;
  geometry?: { left: number; top: number; width: number; height: number };
  /** Video only: true inserts `data-has-audio="true"` with no `muted`. Unknown or false stays muted. */
  hasAudio?: boolean;
}): string {
  const sharedAttrs = `id="${input.id}" data-hf-id="${input.hfId}" class="clip" src="${encodeUrlPath(input.assetPath)}" data-start="${input.start}" data-duration="${input.duration}" data-track-index="${input.track}"`;
  const geometry = input.geometry ?? { left: 0, top: 0, width: 640, height: 360 };
  const visualStyles = `position: absolute; left: ${geometry.left}px; top: ${geometry.top}px; width: ${geometry.width}px; height: ${geometry.height}px; object-fit: contain; z-index: ${input.zIndex}`;

  if (input.kind === 'text') {
    // Unique CSS family aliases keep files with the same family/name independent.
    const family = `font-${input.hfId}`;
    const face = importedFontFaceCss({ family, path: input.assetPath, url: encodeUrlPath(input.assetPath) });
    const label = fontFamilyFromAssetPath(input.assetPath).replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char]!,
    );
    const fontSize = Math.max(16, Math.round(geometry.height / 10));
    // Persist concrete neutral defaults: authored text must not depend on editor theme variables.
    const color = designTokens.shared['neutral-n0'];
    const shadow = designTokens.shared['neutral-n11'];
    return `<style>${face}</style><p id="${input.id}" data-hf-id="${input.hfId}" class="clip" data-start="${input.start}" data-duration="${input.duration}" data-track-index="${input.track}" style="position: absolute; left: ${geometry.left + geometry.width * 0.1}px; top: ${geometry.top + geometry.height * 0.4}px; width: ${geometry.width * 0.8}px; margin: 0; text-align: center; font-family: '${family}'; font-size: ${fontSize}px; line-height: 1.2; color: ${color}; text-shadow: 0 1px 3px ${shadow}; z-index: ${input.zIndex}">${label}</p>`;
  }

  if (input.kind === 'image') {
    return `<img ${sharedAttrs} style="${visualStyles}" />`;
  }

  if (input.kind === 'video') {
    // `muted` and `data-has-audio="true"` are mutually exclusive by the lint
    // contract (video_has_audio_but_muted): an audible drop takes the latter.
    const audio = input.hasAudio ? 'data-has-audio="true"' : 'muted';
    return `<video ${sharedAttrs} ${audio} playsinline style="${visualStyles}"></video>`;
  }

  return `<audio ${sharedAttrs} data-volume="1" style="z-index: ${input.zIndex}"></audio>`;
}

export function insertTimelineAssetIntoSource(source: string, assetHtml: string): string {
  const root = scanHtmlOpeningTags(source).find((tag) =>
    tag.attributes.some((attr) => attr.name === 'data-composition-id'),
  );
  if (!root) throw new Error('No composition root found in target source');
  const insertAt = root.end;
  const lineStart = source.lastIndexOf('\n', root.start);
  const leadingWhitespace = source.slice(lineStart + 1, root.start).match(/^(\s*)/)?.[1] ?? '';
  const childIndent = leadingWhitespace + '  ';
  const indented = assetHtml
    .split('\n')
    .map((line, i) => (i === 0 ? line : childIndent + line))
    .join('\n');
  return `${source.slice(0, insertAt)}\n${childIndent}${indented}${source.slice(insertAt)}`;
}
