import { isLiveMediaMove } from '../../../shared/preview-live-media.ts';
import { TIMING_ATTRIBUTES, PRESENTATION_TAGS, PRESENTATION_STYLES, MAX_PREVIEW_TEXT_LENGTH, isLivePositionEdit } from '../../../shared/preview-timing.ts';

// Runs inside the token-scoped iframe. Each change targets a verified live node and file revision.
export const PREVIEW_PEER_TIMING = `
  const timingAttributes = new Set(${JSON.stringify(TIMING_ATTRIBUTES)});
  const presentationTags = new Set(${JSON.stringify(PRESENTATION_TAGS)});
  const presentationStyles = new Set(${JSON.stringify(PRESENTATION_STYLES)});
  const styleDocumentId = globalThis.crypto?.randomUUID?.();
  const timingDocumentId = settings.canRebindTiming === true ? styleDocumentId : undefined;
  function timingVersion(tag) {
    if (typeof tag !== 'string') return null;
    const match = /^"(sha256|patch):([a-f0-9]{64})"$/.exec(tag);
    return match ? (match[1] === 'patch' ? tag : match[2]) : null;
  }
  function stagePresentation(node, change, effects, local, pending) {
    if (!change.styles && !change.text) return true;
    if (!presentationTags.has(node.localName)) return false;
    if (change.styles) {
      if (!Array.isArray(change.styles) || !change.styles.length || change.styles.length > presentationStyles.size) return false;
      for (const [name, from, to] of change.styles) {
        const actual = node.style.getPropertyValue(name) || '';
        const applied = pending?.element === node ? pending.applied?.[name] : undefined;
        const newer = newerDragStyle(pending, node, name);
        if (!presentationStyles.has(name) || typeof from !== 'string' || typeof to !== 'string' ||
            (newer !== undefined && actual !== newer) ||
            Math.max(from.length,to.length) > 256 || (actual !== from && !(local && (actual === to || actual === applied || actual === newer))) ||
            (typeof node.style.getPropertyPriority === 'function' && node.style.getPropertyPriority(name))) return false;
        // This receipt advances storage. A later gesture owns the live CSS value.
        if (local && actual === newer) continue;
        effects.push(forward => {
          const value = forward ? to : actual;
          if (value) node.style.setProperty(name, value);
          else node.style.removeProperty(name);
        });
      }
    }
    if (change.text) {
      const text = node.firstChild;
      if (!Array.isArray(change.text) || change.text.length !== 2 || change.text.some(value =>
          typeof value !== 'string' || value.length > ${MAX_PREVIEW_TEXT_LENGTH}) ||
          text?.nodeType !== 3 || text.nextSibling || (text.data !== change.text[0] && !(local && text.data === change.text[1]))) return false;
      const actual = text.data;
      effects.push(forward => { text.data = forward ? change.text[1] : actual; });
    }
    return true;
  }
  const isPositionEdit = ${isLivePositionEdit.toString()};
  const isMediaMove = ${isLiveMediaMove.toString()};
  function applyPeerTiming(m) {
    const before = timingVersion(m.before), after = timingVersion(m.after), p = player();
    const temporary = m.type === 'peer-presentation' && m.temporary === true;
    const local = !temporary && m.type === 'peer-presentation' && m.localSave === true;
    const pending = local && pendingDrags.get(m.gestureId);
    const ownDrag = pending && pendingForSource(m.path)[0] === pending;
    const base = ownDrag ? pending.confirmedVersion || pending.sha256 : sourceVersions[m.path];
    const position = settings.liveEdits?.position === true && m.type === 'peer-presentation' &&
      Array.isArray(m.changes) && m.changes.length <= 32 && isPositionEdit(m.changes);
    const media = settings.liveEdits?.mediaTiming === true && m.type === 'peer-timing' &&
      Array.isArray(m.changes) && m.changes.length <= 32 && isMediaMove(m.changes);
    const target = temporary || position || media ? styleDocumentId : timingDocumentId;
    if (!target || m.documentId !== target || (temporary ? !!timingDocumentId : !position && m.path !== compositionPath) ||
        !before || !after || before !== base ||
        !Number.isFinite(m.expiresAt) || Date.now() >= m.expiresAt ||
        (!ownDrag && (drag || pendingDrags.size)) ||
        (inlineText && !(local && inlineText.id === m.gestureId && inlineText.after !== undefined)) || !p || typeof p.seek !== 'function' ||
        typeof p.getTime !== 'function' || typeof window.__hfForceTimelineRebind !== 'function' ||
        !Array.isArray(m.changes) || !m.changes.length || m.changes.length > 32) return false;
    const edits = [], effects = [];
    for (const change of m.changes) {
      if (!change || (!change.hfId && !change.id && !change.compositionId) || !Array.isArray(change.attributes) ||
          (!change.attributes.length && !change.styles && !change.text) || change.attributes.length > timingAttributes.size) return false;
      if ((temporary || ownDrag) && (!change.styles || change.text || change.attributes.length)) return false;
      const selector = change.hfId ? '[data-hf-id="'+CSS.escape(change.hfId)+'"]' :
        change.id ? '#'+CSS.escape(change.id) : '[data-composition-id="'+CSS.escape(change.compositionId)+'"]';
      const matches = Array.from(document.querySelectorAll(selector)).filter(node =>
        node.localName === change.tag && sourceFileForElement(node) === m.path);
      if (matches.length !== 1 || matches[0].closest('[data-hf-parked-scene]')) return false;
      const node = matches[0];
      if (media && change.tag !== 'audio' && node !== document.querySelector('[data-composition-id]')) return false;
      if (!stagePresentation(node, change, effects, local, pending)) return false;
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
      for (const effect of effects) effect(key === 'to');
      if (!edits.length) return;
      p.seek(time);
      window.__hfForceTimelineRebind();
      window.__hfStudioManualEditsApply?.();
      if (playing) p.play?.();
    }
    const run = cb => window.__hfSuppressSceneMutations ? window.__hfSuppressSceneMutations(cb) : cb();
    try { run(() => update('to')); }
    catch (_) { try { run(() => update('old')); } catch (_) {} return false; }
    // Only a complete rebind advances the revision used for future edits and selections.
    if (!temporary) {
      if (ownDrag) pending.verifiedVersion = after;
      confirmCanvasVersion(m.path, after);
    }
    return true;
  }
`;
