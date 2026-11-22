import type { DomEditPatchBatch } from "../../hooks/domEditCommitTypes";
import { deriveTimelineStoreKey } from "../../player/lib/timelineElementHelpers";
import { MAX_LAYER_ROWS } from "../../../../shared/preview-layer";
import { repositionWithinFamily } from "./canvasContextMenuZOrder";
import { isIsolatedSourceTarget, isolatedPatchTarget, type IsolatedSourceTarget } from "./isolatedSourceTarget";

export interface FamilyEntry extends IsolatedSourceTarget {
  selected?: boolean; stepCandidate?: boolean;
  element: string; zIndex: number; domIndex: number; locked: boolean; makeRelative: boolean;
}

export function isLayerFamily(family: unknown): family is FamilyEntry[] {
  return Array.isArray(family) && family.length <= MAX_LAYER_ROWS && family.every((e, index) =>
    e && typeof e.element === "string" && e.domIndex === index && Number.isSafeInteger(e.zIndex));
}

export function planIsolatedLayerReorder(family: FamilyEntry[] | null, orderedKeys: string[], from: number, to: number) {
  if (!isLayerFamily(family)) return null;
  const byKey = new Map(family.map(e => [e.element, e]));
  const moved = orderedKeys[from];
  if (byKey.size !== family.length || !byKey.has(moved) || !byKey.has(orderedKeys[to])) return null;
  const reordered = [...orderedKeys];
  reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  const desired = reordered.reverse().filter(key => byKey.has(key));
  const changes = repositionWithinFamily(moved, desired, family);
  if (!changes?.length) return null;
  const batches = new Map<string, DomEditPatchBatch>();
  for (const { element, zIndex } of changes) {
    const entry = byKey.get(element)!;
    if (entry.locked || !isIsolatedSourceTarget(entry)) return null;
    const { sourceFile, ifMatch, target } = isolatedPatchTarget(entry);
    const batch = batches.get(sourceFile) ?? { sourceFile, ifMatch, patches: [] };
    if (batch.ifMatch !== ifMatch) return null;
    const operations: DomEditPatchBatch["patches"][number]["operations"] = [];
    if (entry.makeRelative) operations.push({ type: "inline-style", property: "position", value: "relative" });
    operations.push({ type: "inline-style", property: "z-index", value: String(zIndex) });
    batch.patches.push({ target, operations });
    batches.set(sourceFile, batch);
  }
  const storeKey = (key: string) => {
    const entry = byKey.get(key)!;
    return deriveTimelineStoreKey({ domId: entry.elementId, sourceFile: entry.sourceFile,
      selector: entry.hfId ? '[data-hf-id="' + CSS.escape(entry.hfId) + '"]' : undefined });
  };
  return { batches: [...batches.values()], selectionKey: storeKey(moved), desiredOrderKeys: desired.map(key => storeKey(key) ?? null) };
}
