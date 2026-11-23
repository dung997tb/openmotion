import type { TimelineElement } from "./timelineElement";
import { collectElementPatches, patchElements } from "./elementPatchQueue";
import { usePlayerStore } from "./playerStore";

/** `updateElement` calls inside `run` land as one store update: one pass over the list, one notification. */
export function batchElementUpdates(
  run: () => void,
  layout?: (elements: TimelineElement[]) => TimelineElement[],
): void {
  const patches = collectElementPatches(run);
  if (!patches || patches.size === 0) return;
  usePlayerStore.setState((state) => {
    const elements = patchElements(state.elements, patches);
    return { elements: layout ? layout(elements) : elements };
  });
}
