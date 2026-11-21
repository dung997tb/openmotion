import { MAX_LAYER_ROWS } from '../../../shared/preview-layer.ts';

/** Document-scoped handles distinguish repeated composition instances and never leave the frame as DOM nodes. */
export const PREVIEW_LAYERS = `
  const layerMediaKinds = { img: 'image', picture: 'image', video: 'video', audio: 'audio', svg: 'vector' };
  const layerHandles = new WeakMap(), layerElements = new Map();
  const layerDocumentId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  let nextLayerId = 0, layerObserver = null, layerTimer = null, layerSubscription = null;

  function collectPreviewLayers(limit) {
    const root = document.querySelector('[data-composition-id]') || document.body;
    const rows = [];
    layerElements.clear();
    if (!root) return rows;

    // Skip runtime scaffolding; a wrapper without an author identity is transparent in the tree.
    function visit(element, parent, stampedAncestor) {
      if (rows.length >= limit || element.matches('script,style,template,link,meta,base,br,source,track')) return;
      let row = parent;
      const file = element.getAttribute('data-composition-file') || element.getAttribute('data-composition-src');
      const stamped = element.hasAttribute('data-hf-id');
      // Legacy HTML can have class-only layers. In stamped source, unmarked
      // descendants include animation-generated letters, clones and particles.
      const editableLayer = stamped || element.id || file || element.hasAttribute('data-hf-group') ||
        (!stampedAncestor && element.classList.length);
      if (element !== root && editableLayer) {
        const tag = element.localName;
        const group = element.getAttribute('data-hf-group');
        const ownText = element.children.length === 0 ? (element.textContent || '').trim() : '';
        const key = layerHandles.get(element) || layerDocumentId + ':' + (++nextLayerId);
        layerHandles.set(element, key);
        layerElements.set(key, element);
        row = { key, depth: parent ? parent.depth + 1 : 0, childCount: 0, isCompHost: Boolean(file),
          label: (group || file || element.id || ownText || element.classList.item(0) || tag).slice(0, 100),
          kind: layerMediaKinds[tag] || (group || file ? 'group' : ownText ? 'text' : 'shape'),
          z: Number.parseInt(getComputedStyle(element).zIndex, 10) || 0 };
        rows.push(row);
        if (parent) { parent.childCount++; if (parent.kind === 'shape') parent.kind = 'group'; }
      }
      for (let child = element.firstElementChild; child && rows.length < limit; child = child.nextElementSibling) {
        visit(child, row, !file && (stamped || stampedAncestor));
      }
    }
    visit(root, null, false);
    return rows;
  }

  function closeLayerTree() {
    layerObserver?.disconnect();
    clearTimeout(layerTimer);
    layerObserver = layerTimer = layerSubscription = null;
    layerElements.clear();
  }

  function previewLayerTree(message) {
    if (message.close) {
      if (message.subscription === layerSubscription) closeLayerTree();
      return;
    }
    closeLayerTree();
    layerSubscription = message.subscription;
    const limit = Math.max(1, Math.min(${MAX_LAYER_ROWS}, Math.trunc(message.limit) || ${MAX_LAYER_ROWS}));
    const sendRows = () => {
      layerTimer = null;
      post('layer-tree', { subscription: layerSubscription, rows: collectPreviewLayers(limit) });
    };
    const root = document.body;
    if (root) {
      layerObserver = new MutationObserver(() => {
        if (layerTimer === null) layerTimer = setTimeout(sendRows, 100);
      });
      // Animation style writes do not change structure. Source updates promote a fresh frame.
      layerObserver.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['id','class','data-hf-id','data-hf-group','data-composition-src','data-composition-file'] });
    }
    sendRows();
  }

  function reportLayerSelection(element, detail) {
    const key = layerHandles.get(element);
    if (!layerElements.has(key)) return;
    picked = element;
    post('select-element', { layerKey: key, subscription: layerSubscription, selection: detail });
  }

  function selectPreviewLayer(message) {
    const element = layerElements.get(message.key);
    if (message.subscription !== layerSubscription || !element?.isConnected) return false;
    reportLayerSelection(element, describe(element));
    return true;
  }
`;
