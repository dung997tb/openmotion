export interface PreviewLayer {
  key: string;
  label: string;
  depth: number;
  childCount: number;
  kind: PreviewLayerKind;
  isCompHost: boolean;
  z: number;
}

const layerKinds = ["image", "video", "audio", "vector", "group", "text", "shape"] as const;
export type PreviewLayerKind = typeof layerKinds[number];
const kinds = new Set<string>(layerKinds);
/** UI display budget, shared by the frame and Studio. */
export const MAX_LAYER_ROWS = 80;

export function isPreviewLayerList(rows: unknown): rows is PreviewLayer[] {
  return Array.isArray(rows) && rows.length <= MAX_LAYER_ROWS && rows.every(row =>
    row && typeof row.key === "string" && typeof row.label === "string" && kinds.has(row.kind) &&
    Number.isInteger(row.depth) && row.depth >= 0 && row.depth < MAX_LAYER_ROWS && Number.isFinite(row.z) &&
    Number.isInteger(row.childCount) && row.childCount >= 0 && typeof row.isCompHost === "boolean");
}
