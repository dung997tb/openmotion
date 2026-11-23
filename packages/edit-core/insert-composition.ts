import { parseHTMLContent } from '@hyperframes/core/compiler/html-document';
import { nextUniqueId, parseSourceDocument } from '@hyperframes/studio-server/source-mutation';
import { encodeUrlPath } from '@hyperframes/parsers';
import { resolveTimelineAssetSrc } from './asset-placement.ts';

/**
 * Pure in-memory composition insertion (`POST /file-mutations/insert-composition/*`).
 */
export function insertCompositionInMemory(input: {
  parentSource: string;
  childSource: string;
  targetPath: string;
  sourcePath: string;
  start: number;
  desiredTrack: number;
  canvasPosition?: { left: number; top: number };
}):
  | { ok: true; html: string; hostId: string; track: number; duration: number }
  | { ok: false; status: number; error: string } {
  const childDoc = parseHTMLContent(input.childSource);
  const childRoot =
    childDoc.querySelector('[data-composition-id]') ??
    childDoc.querySelector('template')?.querySelector('[data-composition-id]');
  if (!childRoot) return { ok: false, status: 400, error: 'Composition source has no root' };
  const compId = childRoot.getAttribute('data-composition-id')?.trim() || 'subcomp';
  const duration = Number.parseFloat(
    childRoot.getAttribute('data-composition-duration') ?? childRoot.getAttribute('data-duration') ?? '5',
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    return { ok: false, status: 400, error: 'Composition source has no valid data-composition-duration' };
  }

  const { document, wrappedFragment } = parseSourceDocument(input.parentSource);
  // linkedom's template element (rather than a detached content clone) owns the serialized children.
  const parentRoot =
    document.querySelector('[data-composition-id][data-root="true"]') ??
    document.querySelector('[data-composition-id]') ??
    document.querySelector('template')?.querySelector('[data-composition-id]');
  if (!parentRoot) return { ok: false, status: 400, error: 'Target composition has no root element' };
  if (parentRoot.closest('[data-timeline-locked]'))
    return { ok: false, status: 400, error: 'Target composition is locked' };
  const dimension = (attribute: string, fallback: number) => {
    const value = Number(childRoot.getAttribute(attribute)) || Number(parentRoot.getAttribute(attribute));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const width = dimension('data-width', 1920),
    height = dimension('data-height', 1080);
  const taken = new Set(Array.from(parentRoot.querySelectorAll('[id]'), (el) => el.id));
  taken.add(parentRoot.id);
  const hostId = nextUniqueId(document, compId, taken);
  const start = Math.max(0, Math.round(input.start * 100) / 100);
  const end = start + duration;
  const siblings = Array.from(parentRoot.querySelectorAll<HTMLElement>('[data-track-index]'));
  const occupied = new Set(
    siblings
      .filter((el) => {
        const from = Number(el.getAttribute('data-start')) || 0;
        return start < from + Number(el.getAttribute('data-duration')) && from < end;
      })
      .map((el) => Number(el.getAttribute('data-track-index'))),
  );
  let track = Math.max(0, Math.round(input.desiredTrack));
  while (occupied.has(track)) track++;
  const at = input.canvasPosition;
  const host = document.createElement('div');
  host.id = hostId;
  host.className = 'clip';
  host.setAttribute('data-composition-id', compId);
  host.setAttribute(
    'data-composition-src',
    encodeUrlPath(resolveTimelineAssetSrc(input.targetPath, input.sourcePath)),
  );
  host.setAttribute('data-start', String(start));
  host.setAttribute('data-duration', String(duration));
  host.setAttribute('data-track-index', String(track));
  host.setAttribute('data-width', String(width));
  host.setAttribute('data-height', String(height));
  const styled = Array.from(parentRoot.querySelectorAll<HTMLElement>('[style]'));
  const zIndex = styled.reduce((max, el) => Math.max(max, Number(el.style.zIndex) || 0), 0) + 1;
  host.setAttribute(
    'style',
    `position: absolute; left: ${at ? Math.round(at.left - width / 2) : 0}px; top: ${at ? Math.round(at.top - height / 2) : 0}px; width: ${width}px; height: ${height}px; z-index: ${zIndex}`,
  );
  parentRoot.appendChild(host);
  const durationAttr = parentRoot.hasAttribute('data-duration')
    ? 'data-duration'
    : 'data-composition-duration';
  if (end > Number(parentRoot.getAttribute(durationAttr))) parentRoot.setAttribute(durationAttr, String(end));
  return {
    ok: true,
    html: wrappedFragment ? document.body.innerHTML : document.toString(),
    hostId,
    track,
    duration,
  };
}
