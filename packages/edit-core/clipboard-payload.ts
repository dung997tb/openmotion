import { scanHtmlOpeningTags } from "@hyperframes/parsers/html-attribute-spans";
import { findMatchingClosingTagIndex, findTagByTarget } from "./source-patcher.ts";

const CLIPBOARD_MARKER = "hyperframes-clipboard:v1";

/** One clip's copied markup plus the original placement needed to preserve
 *  relative offsets and tracks across a group paste. */
export interface TimelineClipboardClip {
  html: string;
  start: number;
  duration: number;
  track: number;
}

export type ClipboardPayload =
  | {
      kind: "timeline-clip";
      clips: TimelineClipboardClip[];
      sourceFile: string;
      projectId?: string;
      copiedInComposition?: string;
    }
  | {
      kind: "dom-element";
      html: string;
      sourceFile: string;
      projectId?: string;
      originSelector?: string;
      originSelectorIndex?: number;
    };

type SerializedPayload = { _marker: string } & ClipboardPayload;

export function serializeClipboardPayload(payload: ClipboardPayload): string {
  const data: SerializedPayload = { _marker: CLIPBOARD_MARKER, ...payload };
  return JSON.stringify(data);
}

// Each branch validates one wire shape at the trust boundary; splitting further
// would fragment one parse into partial validators with no independent reuse.
// fallow-ignore-next-line complexity
export function deserializeClipboardPayload(json: string): ClipboardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj._marker !== CLIPBOARD_MARKER) return null;
  if (typeof obj.sourceFile !== "string") return null;
  if (obj.kind === "timeline-clip") {
    if (!Array.isArray(obj.clips)) return null;
    const clips = obj.clips.filter((c): c is TimelineClipboardClip => {
      const clip = c as Partial<TimelineClipboardClip> | null;
      return (
        !!clip &&
        typeof clip === "object" &&
        typeof clip.html === "string" &&
        typeof clip.start === "number" &&
        typeof clip.duration === "number" &&
        typeof clip.track === "number"
      );
    });
    if (clips.length === 0) return null;
    const projectId = typeof obj.projectId === "string" ? obj.projectId : undefined;
    const copiedInComposition =
      typeof obj.copiedInComposition === "string" ? obj.copiedInComposition : undefined;
    return {
      kind: "timeline-clip",
      clips,
      sourceFile: obj.sourceFile,
      projectId,
      copiedInComposition,
    };
  }
  if (obj.kind === "dom-element") {
    if (typeof obj.html !== "string") return null;
    return {
      kind: "dom-element",
      html: obj.html,
      sourceFile: obj.sourceFile,
      projectId: typeof obj.projectId === "string" ? obj.projectId : undefined,
      originSelector: typeof obj.originSelector === "string" ? obj.originSelector : undefined,
      originSelectorIndex:
        typeof obj.originSelectorIndex === "number" ? obj.originSelectorIndex : undefined,
    };
  }
  return null;
}

/**
 * Insert `newHtml` as a sibling immediately after the element matched by
 * `selector` (at `selectorIndex`) in `source`. Falls back to inserting after
 * the composition root if the selector doesn't match — so paste never silently
 * drops the content.
 */
// fallow-ignore-next-line complexity
export function insertAsSibling(
  source: string,
  newHtml: string,
  selector: string | undefined,
  selectorIndex: number | undefined,
): string {
  if (selector) {
    const target = selector.startsWith("#") ? { id: selector.slice(1) } : { selector, selectorIndex };
    const match = findTagByTarget(source, target);
    if (match) {
      const end = findClosingTagPosition(source, match);
      if (end > 0) return source.slice(0, end) + "\n" + newHtml + source.slice(end);
    }
  }

  const root = scanHtmlOpeningTags(source).find(tag => tag.attributes.some(attr => attr.name === "data-composition-id"));
  if (root) return source.slice(0, root.end) + newHtml + source.slice(root.end);
  return source + newHtml;
}

// fallow-ignore-next-line complexity
function findClosingTagPosition(html: string, match: {tag: string; end: number}): number {
  const openTagEnd = match.end;
  const tagName = match.tag.match(/^<([a-z][a-z0-9-]*)/i)?.[1];
  if (!tagName) return -1;
  if (match.tag.endsWith("/") || /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tagName)) return openTagEnd + 1;

  const closing = findMatchingClosingTagIndex(html, tagName, openTagEnd + 1);
  return closing < 0 ? -1 : html.indexOf(">", closing) + 1;
}

/** An `id="..."` attribute, not `data-id="..."` or similar — only matches
 *  when preceded by whitespace, the way every generated attribute is. */
export const ID_ATTR_RE = /(?<=\s)id="([^"]+)"/;

export function deduplicateIds(html: string, existingIds: string[]): string {
  const existingSet = new Set(existingIds);
  const reserved = new Set(Array.from(html.matchAll(new RegExp(ID_ATTR_RE.source, "g")), match => match[1]));
  return html.replace(new RegExp(ID_ATTR_RE.source, "g"), (full, id: string) => {
    if (!existingSet.has(id)) {
      existingSet.add(id);
      return full;
    }
    let counter = 2;
    while (existingSet.has(`${id}-${counter}`) || reserved.has(`${id}-${counter}`)) counter++;
    const newId = `${id}-${counter}`;
    existingSet.add(newId);
    return `id="${newId}"`;
  });
}
