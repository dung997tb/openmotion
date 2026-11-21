import { useState, useCallback, useRef } from "react";
import { useMountEffect } from "./useMountEffect";
import {
  resolveSourceFile,
  applyPatch,
  applyPatchByTarget,
  findTagByTarget,
  type PatchOperation,
} from "../utils/sourcePatcher";
import {
  acceptStudioRuntimeMessage,
  postRuntimeControlMessage,
} from "../player/lib/runtimeProtocol";
import {
  createPreviewAdapter,
  isPreviewBridgeMessageValue,
  PREVIEW_BRIDGE_SOURCE,
} from "../player/lib/previewAdapter";
import { compositionPathOfPreviewUrl } from "../player/components/CompositionThumbnail";
import { getSourceFileForElement } from "../components/editor/domEditingDom";

export interface PickedElement {
  id: string | null;
  tagName: string;
  selector: string;
  label: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  textContent: string | null;
  src: string | null;
  dataAttributes: Record<string, string>;
  computedStyles: Record<string, string>;
}

interface UseElementPickerReturn {
  isPickMode: boolean;
  pickedElement: PickedElement | null;
  enablePick: () => void;
  disablePick: () => void;
  clearPick: () => void;
  /** Update a CSS property on the picked element live + persist to source */
  setStyle: (prop: string, value: string) => void;
  /** Update a data attribute on the picked element + persist to source */
  setDataAttr: (attr: string, value: string) => void;
  /** Update the text content of the picked element + persist to source */
  setTextContent: (text: string) => void;
  /** Override the active iframe (for zoomed canvas view). Pass null to restore primary. */
  setActiveIframe: (el: HTMLIFrameElement | null) => void;
  /** Ref that always points to the active iframe (focused canvas frame or preview panel) */
  activeIframeRef: React.RefObject<HTMLIFrameElement | null>;
}

interface PickerOptions {
  /** Workspace files for source patching */
  workspaceFiles?: Record<string, string>;
  /** Callback to sync patched files to the project */
  onSyncFiles?: (files: Record<string, string>) => void;
}

/**
 * Hook for element picking via the HyperFrame runtime's picker API.
 * Communicates with the iframe via postMessage.
 */
export function useElementPicker(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  options?: PickerOptions,
): UseElementPickerReturn {
  const [isPickMode, setIsPickMode] = useState(false);
  const [pickedElement, setPickedElement] = useState<PickedElement | null>(null);

  // Secondary/override iframe ref — set when a zoomed frame is active.
  // When set, all postMessage sends and DOM reads go to this ref instead.
  const activeOverrideRef = useRef<HTMLIFrameElement | null>(null);

  const getActiveIframe = useCallback((): HTMLIFrameElement | null => {
    return activeOverrideRef.current ?? iframeRef.current;
  }, [iframeRef]);

  // Exposed so the host page can wire the focused view's iframe into the picker
  const setActiveIframe = useCallback((el: HTMLIFrameElement | null) => {
    activeOverrideRef.current = el;
  }, []);

  const enablePick = useCallback(() => {
    try {
      const iframe = getActiveIframe();
      const adapter = iframe ? createPreviewAdapter({ iframe }) : null;
      if (adapter?.token) adapter.send("pick-mode", { enabled: true });
      else postRuntimeControlMessage(iframe?.contentWindow, "enable-pick-mode");
      setIsPickMode(true);
    } catch {
      /* cross-origin */
    }
  }, [getActiveIframe]);

  const disablePick = useCallback(() => {
    try {
      const iframe = getActiveIframe();
      const adapter = iframe ? createPreviewAdapter({ iframe }) : null;
      if (adapter?.token) adapter.send("pick-mode", { enabled: false });
      else postRuntimeControlMessage(iframe?.contentWindow, "disable-pick-mode");
    } catch {
      /* cross-origin */
    }
    setIsPickMode(false);
  }, [getActiveIframe]);

  const clearPick = useCallback(() => {
    setPickedElement(null);
  }, []);

  const bridgeSelection = useRef<{ iframe: HTMLIFrameElement; token: string; sourceFile: string; hfId?: string } | null>(null);
  const windowsThatWerePrimary = useRef(new WeakSet<MessageEventSource>());

  // Listen for picker messages from the iframe
  useMountEffect(() => {
    // One guard per message field, then one branch per message type.
    // fallow-ignore-next-line complexity
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      // The primary frame, the active override, or a primary frame a reload just swapped out.
      const activeIframe = getActiveIframe();
      if (!activeIframe) return;
      if (!e.source) return;

      if (isPreviewBridgeMessageValue(data) && data.source === PREVIEW_BRIDGE_SOURCE) {
        const adapter = createPreviewAdapter({ iframe: activeIframe });
        if (!adapter.accepts(e) || data.type !== "select-element") return;
        const selection = isRecord(data.selection) ? data.selection : null;
        if (!selection) return;
        const geometry = isRecord(selection.geometry) ? selection.geometry : {};
        const picked = {
          id: typeof selection.elementId === "string" ? selection.elementId : null,
          tagName: typeof selection.tagName === "string" ? selection.tagName : "div",
          selector: typeof selection.selector === "string" ? selection.selector : "",
          label: typeof selection.text === "string" && selection.text ? selection.text.slice(0, 48) : "Element",
          textContent: typeof selection.textContent === "string" ? selection.textContent : typeof selection.text === "string" ? selection.text : null,
          boundingBox: {
            x: typeof geometry.x === "number" ? geometry.x : 0,
            y: typeof geometry.y === "number" ? geometry.y : 0,
            width: typeof geometry.width === "number" ? geometry.width : 0,
            height: typeof geometry.height === "number" ? geometry.height : 0,
          },
        };
        bridgeSelection.current = {
          iframe: activeIframe, token: data.token,
          sourceFile: typeof selection.sourceFile === "string" ? selection.sourceFile : compositionPathOfPreviewUrl(activeIframe.src),
          hfId: typeof selection.hfId === "string" ? selection.hfId : undefined,
        };
        setPickedElement(toPickedElement(picked, activeIframe));
        setIsPickMode(false);
        return;
      }

      if (data?.source !== "hf-preview" || !createPreviewAdapter({ iframe: activeIframe }).sameOrigin) return;
      if (!acceptStudioRuntimeMessage(data)) return;
      if (e.source === iframeRef.current?.contentWindow)
        windowsThatWerePrimary.current.add(e.source);
      else if (
        e.source !== activeIframe.contentWindow &&
        !windowsThatWerePrimary.current.has(e.source)
      )
        return;

      if (data.type === "element-picked" && data.elementInfo) {
        setPickedElement(toPickedElement(data.elementInfo, activeIframe));
        setIsPickMode(false);
      } else if (data.type === "element-pick-candidates") {
        // Multiple candidates at click point — pick the first one
        const el = data.candidates?.[data.selectedIndex ?? 0];
        if (el) setPickedElement(toPickedElement(el, activeIframe));
      }

      if (data.type === "pick-mode-cancelled") {
        setIsPickMode(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  // Ref for options to avoid stale closures in debounced callback
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pendingWritesRef = useRef(new Map<string, PendingWrite>());
  settlePendingWrites(pendingWritesRef.current, options?.workspaceFiles);

  // Sync immediately (not debounced) — save on every change for reliability
  const syncToSource = useCallback(
    (picked: PickedElement, live: HTMLElement, iframe: HTMLIFrameElement, op: PatchOperation) => {
      const opts = optionsRef.current;
      if (!opts?.workspaceFiles || !opts.onSyncFiles) return;
      // No id: the preview's hf-id names the element, in the file it was served from.
      const hfId = live.getAttribute("data-hf-id");
      const pending = pendingWritesRef.current;
      const files = withPendingWrites(opts.workspaceFiles, pending);
      const patch = picked.id
        ? patchById(files, picked.id, picked.selector, op)
        : hfId
          ? patchByHfId(files, hfId, ownSourceFile(live, iframe), op)
          : null;
      if (!patch || patch.after === patch.before) return;
      recordPendingWrite(pending, patch.path, opts.workspaceFiles[patch.path], patch.after);
      opts.onSyncFiles({ [patch.path]: patch.after });
    },
    [],
  );

  const editPicked = useCallback((op: PatchOperation & { value: string }) => {
    const iframe = getActiveIframe();
    if (!iframe || !pickedElement?.selector) return;
    const adapter = createPreviewAdapter({ iframe });
    if (!adapter.sameOrigin) {
      const selected = bridgeSelection.current;
      if (!selected || selected.iframe !== iframe || selected.token !== adapter.token) return;
      const opts = optionsRef.current;
      if (opts?.workspaceFiles && opts.onSyncFiles) {
        const pending = pendingWritesRef.current;
        const path = selected.sourceFile;
        const before = withPendingWrites(opts.workspaceFiles, pending)[path];
        const target = { id: pickedElement.id ?? undefined, hfId: selected.hfId };
        if (typeof before !== "string" || !findTagByTarget(before, target)) return;
        const after = applyPatchByTarget(before, target, op);
        if (after !== before) {
          recordPendingWrite(pending, path, opts.workspaceFiles[path], after);
          opts.onSyncFiles({ [path]: after });
        }
      }
      adapter.send("edit-element", { selector: pickedElement.selector, operation: op });
    } else {
      let el: HTMLElement | null | undefined;
      try {
        el = iframe.contentDocument?.querySelector<HTMLElement>(pickedElement.selector);
      } catch {
        return;
      }
      if (!el) return;
      if (op.type === "inline-style") el.style.setProperty(op.property, op.value);
      else if (op.type === "attribute") el.setAttribute(`data-${op.property}`, op.value);
      else el.textContent = op.value;
      syncToSource(pickedElement, el, iframe, op);
    }
    setPickedElement(prev => {
      if (!prev) return prev;
      if (op.type === "inline-style") return { ...prev, computedStyles: { ...prev.computedStyles, [op.property]: op.value } };
      if (op.type === "attribute") return { ...prev, dataAttributes: { ...prev.dataAttributes, [op.property]: op.value } };
      return { ...prev, textContent: op.value };
    });
  }, [getActiveIframe, pickedElement, syncToSource]);

  const setStyle = useCallback((property: string, value: string) =>
    editPicked({ type: "inline-style", property, value }), [editPicked]);
  const setDataAttr = useCallback((property: string, value: string) =>
    editPicked({ type: "attribute", property, value }), [editPicked]);
  const setTextContent = useCallback((value: string) =>
    editPicked({ type: "text-content", property: "textContent", value }), [editPicked]);

  // Ref-like object that always points to the active iframe (override or primary)
  const activeIframeRef = useRef<HTMLIFrameElement | null>(null);
  activeIframeRef.current = getActiveIframe();

  return {
    isPickMode,
    pickedElement,
    enablePick,
    disablePick,
    clearPick,
    setStyle,
    setDataAttr,
    setTextContent,
    setActiveIframe,
    /** Ref that always points to the active iframe (focused canvas frame or preview panel) */
    activeIframeRef,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type PickedElementInfo = Partial<Omit<PickedElement, "computedStyles">>;

// workspaceFiles lags this hook's own writes until the host rerenders.
interface PendingWrite {
  hostSource: string | undefined;
  writes: string[];
}

function settlePendingWrites(
  pending: Map<string, PendingWrite>,
  files: Record<string, string> | undefined,
): void {
  for (const [path, write] of pending) {
    const hostSource = files?.[path];
    if (hostSource === write.hostSource) continue;
    const caughtUpTo = hostSource === undefined ? -1 : write.writes.indexOf(hostSource);
    if (caughtUpTo < 0 || caughtUpTo === write.writes.length - 1) {
      pending.delete(path);
    } else {
      write.hostSource = hostSource;
      write.writes = write.writes.slice(caughtUpTo + 1);
    }
  }
}

function withPendingWrites(
  files: Record<string, string>,
  pending: Map<string, PendingWrite>,
): Record<string, string> {
  const merged = { ...files };
  for (const [path, write] of pending) merged[path] = write.writes.at(-1) ?? merged[path];
  return merged;
}

function recordPendingWrite(
  pending: Map<string, PendingWrite>,
  path: string,
  hostSource: string | undefined,
  after: string,
): void {
  const write = pending.get(path) ?? { hostSource, writes: [] };
  write.writes.push(after);
  pending.set(path, write);
}

// A default per field of the runtime's element info.
// fallow-ignore-next-line complexity
function toPickedElement(el: PickedElementInfo, iframe: HTMLIFrameElement): PickedElement {
  return {
    id: el.id ?? null,
    tagName: el.tagName ?? "div",
    selector: el.selector ?? "",
    label: el.label ?? el.tagName ?? "Element",
    boundingBox: el.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
    textContent: el.textContent ?? null,
    src: el.src ?? null,
    dataAttributes: el.dataAttributes ?? {},
    computedStyles: readComputedStyles(iframe, el.selector ?? ""),
  };
}

interface SourcePatch {
  path: string;
  before: string;
  after: string;
}

function patchById(
  files: Record<string, string>,
  id: string,
  selector: string,
  op: PatchOperation,
): SourcePatch | null {
  const path = resolveSourceFile(id, selector, files);
  const before = path ? files[path] : undefined;
  return path && before ? { path, before, after: applyPatch(before, id, op) } : null;
}

function ownSourceFile(live: HTMLElement, iframe: HTMLIFrameElement): string {
  const previewed = compositionPathOfPreviewUrl(iframe.getAttribute("src") ?? "");
  return getSourceFileForElement(live, previewed).sourceFile;
}

function patchByHfId(
  files: Record<string, string>,
  hfId: string,
  ownFile: string,
  op: PatchOperation,
): SourcePatch | null {
  const matches = Object.keys(files).filter((file) => findTagByTarget(files[file] ?? "", { hfId }));
  const path = matches.includes(ownFile) ? ownFile : matches.length === 1 ? matches[0] : undefined;
  const before = path ? files[path] : undefined;
  return path && before ? { path, before, after: applyPatchByTarget(before, { hfId }, op) } : null;
}

/** Read a subset of computed styles from an element in the iframe */
function readComputedStyles(iframe: HTMLIFrameElement, selector: string): Record<string, string> {
  const styles: Record<string, string> = {};
  try {
    const doc = iframe.contentDocument;
    const el = doc?.querySelector(selector);
    if (!el) return styles;
    const computed = iframe.contentWindow?.getComputedStyle(el);
    if (!computed) return styles;

    const props = [
      "position",
      "top",
      "left",
      "right",
      "bottom",
      "width",
      "height",
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "font-size",
      "font-weight",
      "font-family",
      "color",
      "background-color",
      "background",
      "opacity",
      "border-radius",
      "transform",
      "z-index",
    ];

    for (const prop of props) {
      const val = computed.getPropertyValue(prop);
      if (val) styles[prop] = val;
    }
  } catch {
    /* cross-origin */
  }
  return styles;
}
