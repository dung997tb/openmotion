import { TIMING_ATTRIBUTES } from '../../../shared/preview-timing.ts';

// Runs inside the token-scoped iframe. Source text and animation scripts never cross this channel.
export const PREVIEW_PEER_TIMING = `
  const timingAttributes = new Set(${JSON.stringify(TIMING_ATTRIBUTES)});
  const timingDocumentId = settings.canRebindTiming === true ? globalThis.crypto?.randomUUID?.() : undefined;
  function timingVersion(tag) {
    if (typeof tag !== 'string') return null;
    const match = /^"(sha256|patch):([a-f0-9]{64})"$/.exec(tag);
    return match ? (match[1] === 'patch' ? tag : match[2]) : null;
  }
  function applyPeerTiming(m) {
    const before = timingVersion(m.before), after = timingVersion(m.after), p = player();
    if (!timingDocumentId || m.documentId !== timingDocumentId || m.path !== compositionPath ||
        !before || !after || before !== sourceVersions[m.path] ||
        !Number.isFinite(m.expiresAt) || Date.now() >= m.expiresAt ||
        drag || pendingDrags.size || inlineText || !p || typeof p.seek !== 'function' ||
        typeof p.getTime !== 'function' || typeof window.__hfForceTimelineRebind !== 'function' ||
        !Array.isArray(m.changes) || !m.changes.length || m.changes.length > 32) return false;
    const edits = [];
    for (const change of m.changes) {
      if (!change || (!change.hfId && !change.id && !change.compositionId) || !Array.isArray(change.attributes) ||
          !change.attributes.length || change.attributes.length > timingAttributes.size) return false;
      const selector = change.hfId ? '[data-hf-id="'+CSS.escape(change.hfId)+'"]' :
        change.id ? '#'+CSS.escape(change.id) : '[data-composition-id="'+CSS.escape(change.compositionId)+'"]';
      const matches = Array.from(document.querySelectorAll(selector)).filter(node =>
        node.localName === change.tag && sourceFileForElement(node) === m.path);
      if (matches.length !== 1 || matches[0].closest('[data-hf-parked-scene]')) return false;
      const node = matches[0];
      for (const [name, from, to] of change.attributes) {
        if (!timingAttributes.has(name) || [from,to].some(value => value !== null &&
            (typeof value !== 'string' || !/^\\d+(?:\\.\\d+)?$/.test(value) || !Number.isFinite(Number(value))))) return false;
        const preserved = name === 'data-duration' || name === 'data-end' ? name.replace('data-','data-hf-authored-') : null;
        const names = preserved && node.hasAttribute(preserved) ? [preserved,name] : [name];
        const actual = node.getAttribute(names[0]);
        if (actual !== from && !(actual !== null && from !== null && Number(actual) === Number(from))) return false;
        for (const attr of names) edits.push({node,attr,old:node.getAttribute(attr),to});
      }
    }
    const time = p.getTime(), playing = p.isPlaying?.() === true;
    if (!Number.isFinite(time) || Date.now() >= m.expiresAt) return false;
    function update(key) {
      for (const e of edits) {
        if (e[key] === null) e.node.removeAttribute(e.attr);
        else e.node.setAttribute(e.attr,e[key]);
      }
      p.seek(time);
      window.__hfForceTimelineRebind();
      window.__hfStudioManualEditsApply?.();
      if (playing) p.play?.();
    }
    const run = cb => window.__hfSuppressSceneMutations ? window.__hfSuppressSceneMutations(cb) : cb();
    try { run(() => update('to')); }
    catch (_) { try { run(() => update('old')); } catch (_) {} return false; }
    sourceVersions[m.path] = after;
    return true;
  }
`;
