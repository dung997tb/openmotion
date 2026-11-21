/** Runs inside the scoped project frame alongside describe() and sourceVersions.
 * Studio owns pointer capture and authorizes the final source write. */
export const PREVIEW_CANVAS_DRAG = `
  let drag = null;

  function resetDrag() {
    if (drag) Object.assign(drag.element.style, drag.original);
    drag = null;
  }

  function measureDragAxes(element, left, top, makeRelative, original) {
    // Measure the effect of 32 CSS pixels on each axis. The inverse of that
    // matrix accounts for transformed ancestors as well as scaled compositions.
    const before = element.getBoundingClientRect();
    if (makeRelative) element.style.position = 'relative';
    element.style.left = left + 'px';
    element.style.top = top + 'px';
    const zero = element.getBoundingClientRect();
    element.style.left = (left + 32) + 'px';
    const horizontal = element.getBoundingClientRect();
    element.style.left = left + 'px';
    element.style.top = (top + 32) + 'px';
    const vertical = element.getBoundingClientRect();
    Object.assign(element.style, original);

    const a = (horizontal.x - zero.x) / 32;
    const b = (horizontal.y - zero.y) / 32;
    const c = (vertical.x - zero.x) / 32;
    const d = (vertical.y - zero.y) / 32;
    const determinant = a * d - b * c;
    const resizes = [zero, horizontal, vertical].some(rect =>
      Math.abs(rect.width - before.width) > 1 || Math.abs(rect.height - before.height) > 1
    );
    if (resizes || Math.abs(determinant) < 0.0001 ||
        Math.abs(zero.x - before.x) > 1 || Math.abs(zero.y - before.y) > 1) return null;
    return { a, b, c, d, determinant };
  }

  function startDrag(message) {
    resetDrag();
    const hit = document.elementFromPoint(message.x * innerWidth, message.y * innerHeight);
    const element = hit?.closest('[id],[data-hf-id]');
    if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement ||
        element.matches('[data-composition-id],[data-composition-src],[data-hf-scene]') ||
        element.closest('[data-timeline-locked]')) return null;
    const selection = describe(element);
    if (!Object.hasOwn(sourceVersions, selection.sourceFile)) return null;

    const style = getComputedStyle(element);
    const makeRelative = style.position === 'static';
    const original = { position: element.style.position, left: element.style.left, top: element.style.top };
    const left = makeRelative ? 0 : parseFloat(style.left) || 0;
    const top = makeRelative ? 0 : parseFloat(style.top) || 0;
    const axes = measureDragAxes(element, left, top, makeRelative, original);
    if (!axes) return null;

    drag = { id: message.gestureId, element, original, left, top, makeRelative, axes, selection };
    return { geometry: selection.geometry, viewport: selection.viewport };
  }

  function canvasDrag(message) {
    if (message.phase === 'start') return startDrag(message);
    if (!drag || message.gestureId !== drag.id) return null;
    if (message.phase === 'cancel' || !drag.element.isConnected ||
        !Number.isFinite(message.dx) || !Number.isFinite(message.dy)) {
      resetDrag();
      return null;
    }

    const dx = message.dx * innerWidth, dy = message.dy * innerHeight;
    const { a, b, c, d, determinant } = drag.axes;
    const left = Math.round((drag.left + (d * dx - c * dy) / determinant) * 1000) / 1000;
    const top = Math.round((drag.top + (a * dy - b * dx) / determinant) * 1000) / 1000;
    if (drag.makeRelative) drag.element.style.position = 'relative';
    drag.element.style.left = left + 'px';
    drag.element.style.top = top + 'px';
    if (message.phase !== 'finish') return null;

    const { sourceFile, elementId, hfId } = drag.selection;
    const result = { sourceFile, elementId, hfId, sha256: sourceVersions[sourceFile],
      left, top, makeRelative: drag.makeRelative };
    resetDrag();
    return result;
  }
`;
