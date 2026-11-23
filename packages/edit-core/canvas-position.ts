import { STUDIO_OFFSET_X_PROP, STUDIO_OFFSET_Y_PROP } from '@hyperframes/core/editing/draft-markers';
export const STUDIO_PATH_OFFSET_ATTR = 'data-hf-studio-path-offset';
export const STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR = 'data-hf-studio-original-inline-translate';
type PositionPatch = { type: 'inline-style' | 'attribute'; property: string; value: string | null };
type Point = { x: number; y: number };
const roundTo3 = (n: number) => Math.round(n * 1000) / 1000;

/** Plain px only: GSAP's CSSPlugin splits `translate` on spaces and drops a calc(). */
function formatTranslatePx(p: Point): string {
  return `${roundTo3(p.x)}px ${roundTo3(p.y)}px`;
}

const LEGACY_OFFSET_VARS = [STUDIO_OFFSET_X_PROP, STUDIO_OFFSET_Y_PROP];

/** Writes a move as the element's own translate; ends a legacy offset's vars and mark. */
export function writePlainMove(el: HTMLElement, p: Point): PositionPatch[] {
  writeTranslatePx(el, p);
  const patches: PositionPatch[] = [
    { type: 'inline-style', property: 'translate', value: formatTranslatePx(p) },
    {
      type: 'attribute',
      property: STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR,
      value: el.getAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR),
    },
  ];
  for (const prop of LEGACY_OFFSET_VARS.filter((v) => el.style.getPropertyValue(v))) {
    el.style.removeProperty(prop);
    patches.push({ type: 'inline-style', property: prop, value: null });
  }
  if (el.hasAttribute(STUDIO_PATH_OFFSET_ATTR)) {
    el.removeAttribute(STUDIO_PATH_OFFSET_ATTR);
    patches.push({ type: 'attribute', property: STUDIO_PATH_OFFSET_ATTR, value: null });
  }
  return patches;
}

/** The first write records the author's own translate ("" for none), which Reset puts back. */
export function writeTranslatePx(el: HTMLElement, p: Point): void {
  if (!el.hasAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR)) {
    const own = el.style.getPropertyValue('translate') || '';
    el.setAttribute(
      STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR,
      LEGACY_OFFSET_VARS.some((prop) => own.includes(prop)) ? '' : own,
    );
  }
  el.style.setProperty('translate', formatTranslatePx(p));
}
