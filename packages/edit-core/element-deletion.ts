import {
  findTargetElement,
  parseSourceDocument,
  removeElementsFromHtml,
  type SourceMutationTarget,
} from "@hyperframes/studio-server/source-mutation";
import { walkCompositionDescendants } from "@hyperframes/parsers/hf-ids";
import { assertSafeElementDeletion } from "./delete-dependencies.ts";
import { isTimelineIgnoredElement, syncContentEnd } from "./content-duration.ts";

function clearOrphan(peers: Element[]) {
  if (peers.length !== 1) return;
  const [partner] = peers;
  if (partner.closest("[data-timeline-locked]")) throw new Error("Unlock the affected clip before editing.");
  partner.removeAttribute("data-link");
}

/** Remove the selected members from their groups and clear any partner left alone. */
export function unlinkSelectedMembers(peers: Element[], selected: Element[]) {
  const groups = new Set(selected.map((el) => el.getAttribute("data-link")).filter(Boolean));
  for (const el of selected) el.removeAttribute("data-link");
  for (const group of groups) clearOrphan(peers.filter((el) => el.getAttribute("data-link") === group));
}

/** A link name is local to its authored composition, including repeated inline compositions. */
function scopedLink(el: Element) {
  const link = el.getAttribute("data-link");
  if (!link) return null;
  const scope = [link];
  let ancestor = el.parentElement?.closest("[data-composition-id]");
  while (ancestor) {
    scope.push(ancestor.getAttribute("data-hf-id") || ancestor.getAttribute("data-composition-id")!);
    ancestor = ancestor.parentElement?.closest("[data-composition-id]");
  }
  return JSON.stringify(scope);
}

/** Canvas selection may mix ordinary nodes, whole containers and linked or timed clips. */
export function deleteCanvasSelection(source: string, targets: SourceMutationTarget[]) {
  assertSafeElementDeletion(source, targets);
  const after = removeElementsFromHtml(source, targets);
  if (source === after || !/data-(?:link|start)\s*=/i.test(source)) return after;
  const { document } = parseSourceDocument(source);
  const groups = new Map<string, Element[]>();
  let affectedTiming = false;
  function inspect(el: Element) {
    const link = scopedLink(el);
    if (link) groups.set(link, []);
    if (el.hasAttribute("data-start") && !isTimelineIgnoredElement(el)) affectedTiming = true;
  }
  for (const target of targets) {
    const el = findTargetElement(document, target);
    if (!el) throw new Error("Canvas element was not found.");
    inspect(el);
    walkCompositionDescendants(el, inspect);
  }
  let content = after;
  if (groups.size) {
    const next = parseSourceDocument(after);
    walkCompositionDescendants(next.document, (el) => {
      const link = scopedLink(el);
      if (link) groups.get(link)?.push(el);
    });
    for (const peers of groups.values()) clearOrphan(peers);
    content = next.wrappedFragment ? next.document.body.innerHTML : next.document.toString();
  }
  return affectedTiming ? syncContentEnd(content) : content;
}
