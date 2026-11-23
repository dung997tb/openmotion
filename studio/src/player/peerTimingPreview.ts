import { createPreviewAdapter } from "./lib/previewAdapter";
import { TIMING_ATTRIBUTES, type PreviewTimingChange } from "../../../shared/preview-timing";

type FileSnapshot = { content: string; version: string };

// A WindowProxy survives navigation. Bind a request to the document that acknowledged the handshake.
const documents = new WeakMap<HTMLIFrameElement, { token: string; id: string }>();
export function rememberPeerTimingDocument(frame: HTMLIFrameElement, token: string | null, id: unknown): void {
  if (token && typeof id === "string" && id.length > 0 && id.length <= 64) documents.set(frame, { token, id });
  else documents.delete(frame);
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

/** Accept only numeric authored timing changes. Keep scripts, styles, text, tree and identities equal. */
export function diffPreviewTiming(previous: string, current: string): PreviewTimingChange[] | null {
  // This optional fast path runs on the UI thread; large source rewrites use the regular loader.
  if (previous === current || Math.max(previous.length, current.length) > 128 * 1024) return null;
  const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
  const before = parse(previous);
  const after = parse(current);
  if (before.compatMode !== after.compatMode || before.doctype?.publicId !== after.doctype?.publicId ||
      before.doctype?.systemId !== after.doctype?.systemId || before.doctype?.name !== after.doctype?.name) return null;
  const a = elements(before);
  const b = elements(after);
  if (a.length !== b.length) return null;
  const changes: PreviewTimingChange[] = [];
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.localName !== right.localName) return null;
    const attributes: PreviewTimingChange["attributes"] = [];
    for (const name of TIMING_ATTRIBUTES) {
      const from = left.getAttribute(name);
      const to = right.getAttribute(name);
      if (from === to) continue;
      if ([from, to].some(value => value !== null && !/^\d+(?:\.\d+)?$/.test(value))) return null;
      attributes.push([name, from, to]);
      left.removeAttribute(name);
      right.removeAttribute(name);
    }
    if (!attributes.length) continue;
    const hfId = left.getAttribute("data-hf-id");
    const compositionId = left.getAttribute("data-composition-id");
    if (!hfId && !left.id && !compositionId) return null;
    changes.push({ hfId, id: left.id, compositionId, tag: left.localName, attributes });
  }
  if (!changes.length || changes.length > 32 || before.documentElement.outerHTML !== after.documentElement.outerHTML) return null;
  return changes;
}

export async function tryApplyPeerTiming(
  frame: HTMLIFrameElement | null,
  update: PeerTimingUpdate,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (!frame || !isCurrent()) return false;
  const adapter = createPreviewAdapter({ iframe: frame });
  const document = documents.get(frame);
  if (adapter.sameOrigin || !document || document.token !== adapter.token || !adapter.projectId) return false;
  const changes = diffPreviewTiming(update.previous.content, update.current.content);
  if (!changes || !isCurrent()) return false;
  const timeout = 350;
  try {
    const applied = await adapter.request<boolean>("peer-timing", {
      documentId: document.id, path: update.path, before: update.previous.version, after: update.current.version,
      changes, expiresAt: Date.now() + timeout,
    }, timeout);
    return applied === true && document.id === documents.get(frame)?.id && isCurrent();
  } catch { return false; }
}
