// The mounted player can show a click before its project revision is accepted.
// Preserve each authored attribute separately so verified file receipts still
// compare against their exact base while the user is toggling the same track.
export const PREVIEW_TIMELINE_CONTROLS = `
  const previewControls = new WeakMap();
  function previewTimelineControls(message) {
    const name = message.attr;
    if (!['data-hidden','data-timeline-locked','muted'].includes(name) || !Array.isArray(message.changes)) return;
    let changed = false;
    for (const item of message.changes) {
      if (!item || typeof item.enabled !== 'boolean' || typeof item.settled !== 'boolean' ||
          !Object.hasOwn(sourceVersions, item.sourceFile)) continue;
      const node = inspectorElement(item);
      if (!node || node.closest('[data-hf-parked-scene]')) continue;
      let controls = previewControls.get(node);
      if (!controls) previewControls.set(node, controls = new Map());
      let entry = controls.get(name);
      if (!entry) {
        if (item.settled) continue;
        entry = {base:node.getAttribute(name)};
        controls.set(name,entry);
      }
      entry.settled = item.settled;
      if (node.hasAttribute(name) !== item.enabled) {
        node.toggleAttribute(name, item.enabled);
        changed = true;
      }
      if (item.settled && (entry.base !== null) === item.enabled) controls.delete(name);
    }
    if (changed && name === 'data-hidden') {
      const p = player();
      if (p?.seek && p.getTime) {
        const playing = p.isPlaying?.();
        p.seek(p.getTime());
        if (playing) p.play?.();
      }
    }
  }
  function applyTimelineReceipt(node, name, value) {
    const controls = previewControls.get(node);
    const entry = controls?.get(name);
    if (entry) {
      entry.base = value;
      if (!entry.settled) return;
      controls.delete(name);
    }
    if (value === null) node.removeAttribute(name);
    else node.setAttribute(name,value);
  }
`;
