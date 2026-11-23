import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { createPreviewAdapter } from "./lib/previewAdapter";
import { MAX_PEER_PREVIEW_SOURCE_LENGTH, TIMING_ATTRIBUTES, PRESENTATION_STYLES, PRESENTATION_TAGS, MAX_PREVIEW_TEXT_LENGTH, type PreviewChange } from "../../../shared/preview-timing";

type FileSnapshot = { content: string; version: string };

// A WindowProxy survives navigation. Bind a request to the document that acknowledged the handshake.
const documents = new WeakMap<HTMLIFrameElement, { token: string; id: string; canRebind: boolean }>();
export function rememberPeerTimingDocument(frame: HTMLIFrameElement, token: string | null, timingId: unknown, styleId?: unknown): void {
  const id = timingId ?? styleId;
  if (token && typeof id === "string" && id.length > 0 && id.length <= 64) documents.set(frame, { token, id, canRebind: id === timingId });
  else documents.delete(frame);
}

/** A scripted or older document can start rebuilding in parallel with the source read. */
export function hasPeerTimingDocument(frame: HTMLIFrameElement): boolean {
  return documents.get(frame)?.canRebind === true;
}

export function hasScriptedStylePreview(frame: HTMLIFrameElement) {
  return documents.get(frame)?.canRebind === false;
}

export interface PeerTimingUpdate {
  path: string;
  previous: FileSnapshot;
  current: FileSnapshot;
}

function elements(doc: Document | DocumentFragment): Element[] {
  return [...doc.querySelectorAll("*")].flatMap(node =>
    node instanceof HTMLTemplateElement ? [node, ...elements(node.content)] : [node]);
}

const presentationTags = new Set<string>(PRESENTATION_TAGS);

function simpleText(element: Element): Text | null {
  const node = element.firstChild;
  return node?.nodeType === Node.TEXT_NODE && !node.nextSibling ? node as Text : null;
}

/** Compare the browser's CSS declarations, including fallback order and shorthands. */
function changedStyles(left: HTMLElement, right: HTMLElement): PreviewChange["styles"] | null {
  const next = right.style;
  const projected = left.cloneNode(false) as HTMLElement;
  const styles: NonNullable<PreviewChange["styles"]> = [];
  for (const name of PRESENTATION_STYLES) {
    const from = left.style.getPropertyValue(name);
    const to = next.getPropertyValue(name);
    if (from === to) continue;
    if (left.style.getPropertyPriority(name) || next.getPropertyPriority(name)) return null;
    styles.push([name, from, to]);
    if (to) projected.style.setProperty(name, to);
    else projected.style.removeProperty(name);
  }
  return styles.length && projected.style.cssText === next.cssText ? styles : null;
}

/** Strip only supported changes, then compare the entire remaining document before touching the player. */
export function diffPreviewChanges(previous: string, current: string, temporary = false): PreviewChange[] | null {
  // This optional fast path runs on the UI thread; large source rewrites use the regular loader.
  if (previous === current || Math.max(previous.length, current.length) > MAX_PEER_PREVIEW_SOURCE_LENGTH) return null;
  const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
  // The first visual edit can persist the same IDs already mounted by the preview compiler.
  const newlyStamped = temporary && !previous.includes("data-hf-id=") && current.includes("data-hf-id=");
  const before = parse(newlyStamped ? ensureHfIds(previous) : previous);
  const after = parse(current);
  if (before.compatMode !== after.compatMode || before.doctype?.publicId !== after.doctype?.publicId ||
      before.doctype?.systemId !== after.doctype?.systemId || before.doctype?.name !== after.doctype?.name) return null;
  const a = elements(before);
  const b = elements(after);
  if (a.length !== b.length) return null;
  const changes: PreviewChange[] = [];
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.localName !== right.localName) return null;
    const attributes: PreviewChange["attributes"] = [];
    for (const name of TIMING_ATTRIBUTES) {
      const from = left.getAttribute(name);
      const to = right.getAttribute(name);
      if (from === to) continue;
      if ([from, to].some(value => value !== null && !/^\d+(?:\.\d+)?$/.test(value))) return null;
      attributes.push([name, from, to]);
      left.removeAttribute(name);
      right.removeAttribute(name);
    }
    let styles: PreviewChange["styles"];
    let text: PreviewChange["text"];
    if (presentationTags.has(left.localName) && left instanceof HTMLElement && right instanceof HTMLElement) {
      if (left.getAttribute("style") !== right.getAttribute("style")) {
        styles = changedStyles(left, right) ?? undefined;
        if (!styles) return null;
        left.removeAttribute("style");
        right.removeAttribute("style");
      }
      const from = simpleText(left), to = simpleText(right);
      if (from && to && from.data !== to.data) {
        if (Math.max(from.length, to.length) > MAX_PREVIEW_TEXT_LENGTH) return null;
        text = [from.data, to.data];
        from.data = to.data;
      }
    }
    if (!attributes.length && !styles && !text) continue;
    const hfId = left.getAttribute("data-hf-id");
    const compositionId = left.getAttribute("data-composition-id");
    if (!hfId && !left.id && !compositionId) return null;
    changes.push({ hfId, id: left.id, compositionId, tag: left.localName, attributes, styles, text });
  }
  if (!changes.length || changes.length > 32 || before.documentElement.outerHTML !== after.documentElement.outerHTML) return null;
  return changes;
}

export async function tryApplyPeerChanges(
  frame: HTMLIFrameElement | null,
  update: PeerTimingUpdate,
  isCurrent: () => boolean,
  options?: "temporary" | { gestureId?: string },
): Promise<boolean> {
  if (!frame || !isCurrent()) return false;
  const adapter = createPreviewAdapter({ iframe: frame });
  const document = documents.get(frame);
  if (adapter.sameOrigin || !document || document.token !== adapter.token || !adapter.projectId) return false;
  const temporary = options === "temporary";
  if (temporary ? document.canRebind : !document.canRebind) return false;
  const localSave = typeof options === "object" ? options : undefined;
  const changes = diffPreviewChanges(update.previous.content, update.current.content, temporary);
  if (!changes || !isCurrent()) return false;
  if (temporary && changes.some(change => !change.styles || change.attributes.length || change.text)) return false;
  const presentation = changes.some(c => c.styles || c.text);
  if (localSave && (!presentation || changes.some(c => c.attributes.length))) return false;
  const timeout = 350;
  try {
    const applied = await adapter.request<boolean>(presentation ? "peer-presentation" : "peer-timing", {
      documentId: document.id, path: update.path, before: update.previous.version, after: update.current.version,
      changes, ...(temporary && { temporary: true }), ...(localSave && { localSave: true, gestureId: localSave.gestureId }), expiresAt: Date.now() + timeout,
    }, timeout);
    return applied === true && document.id === documents.get(frame)?.id && isCurrent();
  } catch { return false; }
}
