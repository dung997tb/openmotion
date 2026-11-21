/** The caret lives in the actual composition. Only Studio can submit a file edit. */
export const PREVIEW_INLINE_TEXT = `
  let inlineText = null;
  function inlineVariableOwner(el, key) {
    const scope = el.closest('[data-composition-id]');
    const scoped = scope && window.__hfVariablesByComp?.[scope.getAttribute('data-composition-id')];
    let owner, attribute;
    if (scoped) {
      // An edit on a mounted composition belongs to this instance, including when
      // its current value is inherited from the shared template's default.
      if (typeof scoped[key] !== 'string') return null;
      owner = scope;
      attribute = 'data-variable-values';
    } else {
      if (Object.hasOwn(window.__hfVariables || {}, key)) return null;
      // Mirrors getVariables(): later unscoped declarers win.
      for (const candidate of document.querySelectorAll('[data-composition-variables]')) {
        const id = candidate.closest('[data-composition-id]')?.getAttribute('data-composition-id');
        if (candidate !== document.documentElement && window.__hfVariablesByComp?.[id]) continue;
        let entries;
        try { entries = JSON.parse(candidate.getAttribute('data-composition-variables')); } catch { continue; }
        if (!Array.isArray(entries)) continue;
        const entry = entries.findLast(v => v && v.id === key && Object.hasOwn(v, 'default'));
        if (entry) owner = entry.type === 'string' && typeof entry.default === 'string' ? candidate : null;
      }
      attribute = 'data-composition-variables';
    }
    if (!owner) return null;
    const { sourceFile, elementId, hfId } = describe(owner);
    const sha256 = sourceVersions[sourceFile];
    const htmlRoot = owner === document.documentElement;
    if (!sha256 || (!htmlRoot && !hfId && !elementId)) return null;
    return { key, attribute, sourceFile, sha256, elementId, hfId, htmlRoot };
  }
  function editInlineText(m) {
    if (m.phase === 'pick') {
      if (inlineText || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return null;
      const x = m.x * innerWidth, y = m.y * innerHeight;
      const el = document.elementFromPoint(x, y)?.closest('[id],[data-hf-id]');
      if (!(el instanceof HTMLElement) || el.isContentEditable || !el.textContent.trim() ||
          !el.matches('span,p,b,i,strong,em,u,div,h1,h2,h3,h4,h5,h6,li,blockquote') ||
          el.matches('[data-composition-id],[data-composition-src],[data-hf-scene]') ||
          el.closest('[data-timeline-locked]') ||
          Array.from(el.querySelectorAll('*')).some(child => !child.matches('span,b,strong,i,em,u,br') ||
            child.hasAttribute('id') || child.hasAttribute('data-var-text'))) return null;
      const { sourceFile, elementId, hfId } = describe(el);
      const sha256 = sourceVersions[sourceFile];
      if (!sha256) return null;
      const key = el.getAttribute('data-var-text')?.trim();
      const binding = key && inlineVariableOwner(el, key);
      // The scalar value controls only the element's own text. A rich-text edit
      // across nested nodes cannot safely represent that single value.
      if (key && (!binding || el.childElementCount)) return null;
      inlineText = { id: m.editId, el, x, y, before: el.innerHTML, editable: el.getAttribute('contenteditable'), binding };
      return { sourceFile, elementId, hfId, sha256, ...(binding && {binding}) };
    }
    const edit = inlineText;
    if (!edit || m.editId !== edit.id) return;
    const { el } = edit;
    const restoreEditable = () => edit.editable === null
      ? el.removeAttribute('contenteditable') : el.setAttribute('contenteditable', edit.editable);
    if (m.phase === 'open' && !edit.events && el.isConnected) {
      const events = edit.events = new AbortController();
      const options = {signal:events.signal};
      const finish = () => {
        if (events.signal.aborted) return;
        edit.after = el.innerHTML;
        const text = el.innerText;
        events.abort();
        restoreEditable();
        if (el === document.activeElement) el.blur();
        post('inline-text-finished', {editId:edit.id, html:edit.after, text, changed:edit.after !== edit.before});
      };
      el.setAttribute('contenteditable','true');
      el.addEventListener('blur', finish, options);
      el.addEventListener('keydown', e => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault(); finish();
        }
      }, options);
      for (const type of ['paste','drop']) el.addEventListener(type, e => {
        e.preventDefault();
        const text = (e.clipboardData || e.dataTransfer)?.getData('text/plain');
        if (text) document.execCommand('insertText', false, text);
      }, options);
      el.focus({preventScroll:true});
      const range = document.caretRangeFromPoint?.(edit.x, edit.y);
      if (range && el.contains(range.startContainer)) {
        const selection = getSelection();
        selection.removeAllRanges(); selection.addRange(range);
      }
    } else if (m.phase === 'cancel' || m.phase === 'commit') {
      edit.events?.abort();
      if (edit.events) restoreEditable();
      if (m.phase === 'cancel' && edit.events && el.isConnected && (edit.after === undefined || el.innerHTML === edit.after) && el.innerHTML !== edit.before)
        el.innerHTML = edit.before;
      inlineText = null;
    }
  }
`;
