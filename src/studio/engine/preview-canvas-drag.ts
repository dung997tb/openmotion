/** Runs inside the scoped project frame alongside describe() and sourceVersions.
 * Studio owns pointer capture and authorizes the final source write. */
export const PREVIEW_CANVAS_DRAG = `
  let drag = null;
  const pendingDrags = new Map();

  function restoreStyles(element, original, applied) {
    for (const [property, { value, priority }] of Object.entries(original)) {
      // A runtime animation or another edit may have since taken over this property.
      if (applied && (element.style[property] !== applied[property] || element.style.getPropertyPriority(property))) continue;
      element.style.setProperty(property, value, priority);
    }
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
    restoreStyles(element, original);

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
    if (drag) return null;
    const hit = document.elementFromPoint(message.x * innerWidth, message.y * innerHeight);
    const corner = ['nw','ne','sw','se'].includes(message.corner) ? message.corner : null;
    const element = corner ? picked : hit?.closest('[id],[data-hf-id]');
    if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement ||
        element.matches('[data-composition-id],[data-composition-src],[data-hf-scene]') ||
        element.closest('[data-timeline-locked]')) return null;
    const selection = describe(element);
    if (!Object.hasOwn(sourceVersions, selection.sourceFile)) return null;

    const style = getComputedStyle(element);
    const makeRelative = style.position === 'static';
    const properties = makeRelative ? ['left', 'top', 'position'] : ['left', 'top'];
    const width = parseFloat(style.width), height = parseFloat(style.height);
    if (corner) {
      if (!(width > 0 && height > 0) || style.display === 'inline' || style.transform !== 'none') return null;
      properties.push('width','height');
    }
    const original = Object.fromEntries(properties.map(property => [property, {
      value: element.style[property], priority: element.style.getPropertyPriority(property)
    }]));
    const left = makeRelative ? 0 : parseFloat(style.left) || 0;
    const top = makeRelative ? 0 : parseFloat(style.top) || 0;
    const axes = measureDragAxes(element, left, top, makeRelative, original);
    if (!axes || (corner && (axes.a <= 0 || axes.d <= 0 || Math.abs(axes.b) + Math.abs(axes.c) > 0.001))) return null;

    const localTime = window.__timelines?.[element.closest('[data-composition-id]')?.getAttribute('data-composition-id')]?.time?.();
    const time = Number.isFinite(localTime) ? localTime : (Number(window.__player?.getTime?.()) || 0);
    const pos = axis => parseFloat(window.gsap?.getProperty?.(element, axis)) || 0;
    const startPosition = {time,x:pos('x'),y:pos('y')};
    drag = { startPosition, id: message.gestureId, element, original, left, top, makeRelative, axes, selection, width, height, corner };
    return { geometry: selection.geometry, viewport: selection.viewport };
  }

  function canvasDrag(message) {
    if (message.phase === 'start') return startDrag(message);
    const pending = pendingDrags.get(message.gestureId);
    if (pending && (message.phase === 'commit' || message.phase === 'cancel')) {
      if (message.phase === 'cancel') restoreStyles(pending.element, pending.original, pending.applied);
      // A changed file needs the digest from the authoritative replacement frame.
      if (message.phase === 'cancel' || !message.changed) sourceVersions[pending.selection.sourceFile] = pending.sha256;
      pendingDrags.delete(message.gestureId);
      return null;
    }
    if (!drag || message.gestureId !== drag.id) return null;
    if (message.phase === 'cancel') {
      if (drag.applied) restoreStyles(drag.element, drag.original, drag.applied);
      drag = null;
      return null;
    }
    if (!drag.element.isConnected || !['move', 'finish'].includes(message.phase) ||
        !Number.isFinite(message.dx) || !Number.isFinite(message.dy)) return null;

    const dx = message.dx * innerWidth, dy = message.dy * innerHeight;
    const { a, b, c, d, determinant } = drag.axes;
    const round = n => Math.round(n * 1000) / 1000;
    const offsetX = (d * dx - c * dy) / determinant, offsetY = (a * dy - b * dx) / determinant;
    const { corner } = drag;
    const west = corner?.endsWith('w'), north = corner?.startsWith('n');
    const width = round(Math.max(1, drag.width + (west ? -offsetX : offsetX)));
    const height = round(Math.max(1, drag.height + (north ? -offsetY : offsetY)));
    const left = round(drag.left + (corner ? (west ? drag.width - width : 0) : offsetX));
    const top = round(drag.top + (corner ? (north ? drag.height - height : 0) : offsetY));
    const applied = {};
    const set = (key,value) => { drag.element.style[key] = value; applied[key] = drag.element.style[key]; };
    if (!corner || west || north) {
      if (drag.makeRelative) set('position','relative');
      if (!corner || west) set('left',left + 'px');
      if (!corner || north) set('top',top + 'px');
    }
    if (corner) { set('width',width+'px'); set('height',height+'px'); }
    drag.applied = applied;
    if (message.phase !== 'finish') return null;
    const { sourceFile, elementId, hfId } = drag.selection;
    const { makeRelative, startPosition } = drag;
    const position = {time:startPosition.time, x:round(startPosition.x + offsetX), y:round(startPosition.y + offsetY)};
    const sha256 = sourceVersions[sourceFile];
    // A second edit of this source needs a confirmed base. Other source files remain editable.
    delete sourceVersions[sourceFile];
    pendingDrags.set(drag.id, { ...drag, sha256 });
    drag = null;
    return { sourceFile, elementId, hfId, sha256, left, top, makeRelative, ...(!corner && {position}), ...(corner && {corner,width,height}) };
  }
`;
