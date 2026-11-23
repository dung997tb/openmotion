// Visual feedback in the mounted frame while Studio saves an inspector edit.
// Pending changes on a single property share its original value, so any order
// of success or failure leaves the latest successful edit on screen.
export const PREVIEW_INSPECTOR_STYLES = `
  const inspectorStyles = new WeakMap();
  const pendingInspectorStyles = new Map();
  const visibleStyleNames = new Set(['color','background-color','font-size','font-weight','text-align','opacity']);
  function showInspectorStyle(el, name, value) {
    if (!visibleStyleNames.has(name) || typeof value !== 'string' || value.length > 256 ||
        (value && !CSS.supports(name, value)) || el.style.getPropertyPriority(name)) return null;
    let properties = inspectorStyles.get(el);
    if (!properties) inspectorStyles.set(el, properties = new Map());
    const actual = el.style.getPropertyValue(name);
    let chain = properties.get(name);
    if (!chain || chain.visible !== actual) {
      chain = {base:actual, visible:actual, steps:[]};
      properties.set(name, chain);
    }
    el.style.setProperty(name, value);
    const step = {value:el.style.getPropertyValue(name), saved:false};
    chain.visible = step.value;
    chain.steps.push(step);
    return saved => {
      if (properties.get(name) !== chain) return;
      if (el.style.getPropertyValue(name) !== chain.visible || el.style.getPropertyPriority(name)) {
        properties.delete(name);
        return;
      }
      step.saved = saved;
      if (!saved) chain.steps.splice(chain.steps.indexOf(step), 1);
      while (chain.steps[0]?.saved) chain.base = chain.steps.shift().value;
      const next = chain.steps.length ? chain.steps[chain.steps.length - 1].value : chain.base;
      if (next !== chain.visible) el.style.setProperty(name, next);
      chain.visible = next;
      if (!chain.steps.length) properties.delete(name);
    };
  }
  function previewInspectorStyles(m) {
    if (typeof m.editId !== 'string' || m.editId.length > 80) return;
    if (m.phase === 'settle') {
      const pending = pendingInspectorStyles.get(m.editId);
      pendingInspectorStyles.delete(m.editId);
      if (pending) pending.forEach(finish => finish(m.saved === true));
      return;
    }
    if (m.phase !== 'show' || pendingInspectorStyles.has(m.editId) || !Array.isArray(m.styles) ||
        m.styles.length > 32 || typeof m.sourceFile !== 'string' ||
        !Object.hasOwn(sourceVersions, m.sourceFile) || sourceIdentity(sourceVersions[m.sourceFile]).fileVersion !== m.fileVersion) return;
    const el = inspectorElement(m);
    if (!el || el.closest('[data-hf-parked-scene]')) return;
    const pending = m.styles.filter(pair => Array.isArray(pair) && pair.length === 2)
      .map(([name, value]) => showInspectorStyle(el, name, value)).filter(Boolean);
    if (pending.length) pendingInspectorStyles.set(m.editId, pending);
  }
`;
