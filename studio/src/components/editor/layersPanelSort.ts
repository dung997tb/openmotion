import type { DomEditLayerItem } from "./domEditingTypes";
import { getElementZIndex } from "../../player/lib/layerOrdering";

interface CollapsedState {
  [key: string]: boolean;
}

// ── Pure helpers ──────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function sortLayersByZIndex(layers: DomEditLayerItem[]): DomEditLayerItem[] {
  return sortLayerRows(layers, item => getElementZIndex(item.element));
}

export function sortLayerRows<T extends { depth: number }>(layers: T[], zIndex: (item: T) => number): T[] {
  if (layers.length <= 1) return layers;

  const minDepth = layers[0].depth;
  for (let i = 1; i < layers.length; i++) {
    if (layers[i].depth < minDepth) return layers;
  }

  const chunks: Array<{ root: T; children: T[]; domIndex: number }> =
    [];

  for (let i = 0; i < layers.length; i++) {
    if (layers[i].depth === minDepth) {
      const children: T[] = [];
      let j = i + 1;
      while (j < layers.length && layers[j].depth > minDepth) {
        children.push(layers[j]);
        j++;
      }
      chunks.push({ root: layers[i], children, domIndex: chunks.length });
    }
  }

  if (chunks.length <= 1) {
    if (chunks.length === 1 && chunks[0].children.length > 0) {
      const sorted = sortLayerRows(chunks[0].children, zIndex);
      return [chunks[0].root, ...sorted];
    }
    return layers;
  }

  chunks.sort((a, b) => {
    const zA = zIndex(a.root);
    const zB = zIndex(b.root);
    if (zA !== zB) return zB - zA;
    return b.domIndex - a.domIndex;
  });

  const result: T[] = [];
  for (const chunk of chunks) {
    result.push(chunk.root);
    if (chunk.children.length > 0) {
      result.push(...sortLayerRows(chunk.children, zIndex));
    }
  }
  return result;
}

export function getVisibleLayers<T extends { key: string; depth: number; childCount: number }>(
  layers: T[],
  collapsed: CollapsedState,
): T[] {
  if (Object.keys(collapsed).length === 0) return layers;

  const result: T[] = [];
  let skipDepth = -1;

  for (const layer of layers) {
    if (skipDepth >= 0 && layer.depth > skipDepth) continue;
    skipDepth = -1;

    result.push(layer);

    if (collapsed[layer.key] && layer.childCount > 0) {
      skipDepth = layer.depth;
    }
  }

  return result;
}
