import type { DomEditPatchBatchesResult } from "../../hooks/domEditCommitTypes";

type Receipt = { id: string; version: Promise<string | undefined> };
const receipts = new WeakMap<HTMLIFrameElement, Map<string, Receipt>>();

/** A measurement that includes a pending drag depends on that gesture's verified receipt. */
export function saveCanvasDrag(
  frame: HTMLIFrameElement, path: string, id: string, predecessor: string | undefined,
  write: (version?: string) => Promise<DomEditPatchBatchesResult | undefined>,
): Promise<DomEditPatchBatchesResult | undefined> {
  const byFile = receipts.get(frame) ?? new Map<string, Receipt>();
  receipts.set(frame, byFile);
  const previous = byFile.get(path);
  async function save() {
    if (!predecessor) return write();
    if (previous?.id !== predecessor) return;
    const version = await previous.version;
    if (version) return write(version);
  }
  const result = save();
  byFile.set(path, { id, version: result.then(saved => saved?.savedCanvasVersion, () => undefined) });
  return result;
}
