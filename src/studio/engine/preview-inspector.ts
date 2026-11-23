// Only scalar presentation facts cross the frame boundary. The host supplies its
// curated style-property list and persists edits against the authored file.
export const PREVIEW_INSPECTOR = `
  function inspectPreviewElement(message) {
    const id = typeof message.elementId === 'string' && message.elementId;
    const hf = typeof message.hfId === 'string' && message.hfId;
    if (!id && !hf) return null;
    const selector = hf ? '[data-hf-id="' + CSS.escape(hf) + '"]' : '#' + CSS.escape(id);
    const matches = Array.from(document.querySelectorAll(selector)).filter(el =>
      (!message.sourceFile || sourceFileForElement(el) === message.sourceFile) &&
      (!id || el.id === id));
    // A layer/canvas pick identifies the actual mounted instance, even for a
    // shared composition. Ambiguous lookups from the timeline fail closed.
    const el = matches.includes(picked) ? picked : matches.length === 1 ? matches[0] : null;
    if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return null;
    const detail = describe(el);
    const sha256 = sourceVersions[detail.sourceFile];
    if (!sha256) return null;
    const inline = {}, computed = {}, data = {};
    const style = getComputedStyle(el);
    for (const name of (Array.isArray(message.properties) ? message.properties : []).slice(0,64)) {
      if (typeof name !== 'string' || !/^[a-z-]{1,40}$/.test(name)) continue;
      const value = el.style.getPropertyValue(name);
      if (value) inline[name] = value.slice(0,2048);
      computed[name] = style.getPropertyValue(name).slice(0,2048);
    }
    for (const name of el.getAttributeNames().filter(name => name.startsWith('data-')).slice(0,64))
      data[name.slice(5)] = el.getAttribute(name).slice(0,8192);
    const key = el.getAttribute('data-var-text');
    const binding = key && inlineVariableOwner(el,key);
    const textTag = el.matches('div,span,p,h1,h2,h3,h4,h5,h6,li,strong,em,b,i,blockquote,label,button');
    const onlyBreaks = Array.from(el.children).every(child => child.localName === 'br');
    const editable = el.localName !== 'div' || el.textContent.trim() || el.hasAttribute('data-hf-text-key') ||
      ['font','font-family','font-size','font-weight','text-align'].some(prop => el.style.getPropertyValue(prop));
    const text = textTag && onlyBreaks && editable && (!key || (binding && !el.childElementCount)) &&
      el.textContent.length + el.childElementCount <= 16384;
    const leafText = text ? Array.from(el.childNodes, n => n.nodeName === 'BR' ? '\\n' : n.textContent || '').join('') : null;
    const src = el.getAttribute('src');
    return {elementId: detail.elementId, hfId: detail.hfId, sourceFile: detail.sourceFile, ...sourceIdentity(sha256),
      tag: el.localName, geometry: detail.geometry, inline, computed, data, leafText, lineBreaks: text && el.childElementCount > 0, binding: binding || undefined,
      compositionHost: el.matches('[data-composition-src],[data-composition-file]'),
      compositionRoot: el === document.querySelector('[data-composition-id]'),
      locked: !!el.closest('[data-timeline-locked]'), muted: el.hasAttribute('muted'), loop: el.hasAttribute('loop'),
      src: src && !/^(?:[a-z]+:|[/#?])/i.test(src) ? src.split(/[?#]/)[0].slice(0,1024) : null};
  }
`;
