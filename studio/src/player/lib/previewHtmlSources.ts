import { studioFileRevision } from "../../utils/studioFileVersion";

type PreviewSources = { projectId: string; paths: Set<string>; writeRevision: number };
const frames = new WeakMap<HTMLIFrameElement, PreviewSources>();

export function forgetPreviewHtmlSources(frame: HTMLIFrameElement) {
  frames.delete(frame);
}

export function rememberPreviewHtmlSources(frame: HTMLIFrameElement, projectId: string, paths: unknown) {
  if (Array.isArray(paths) && paths.length && paths.every(path => typeof path === "string") && paths.includes("index.html")) {
    frames.set(frame, { projectId, paths: new Set(paths), writeRevision: studioFileRevision() });
  } else {
    frames.delete(frame);
  }
}

/** An uncertain graph can owe a reload already. An unrelated event must never cancel that work. */
export function isUnrelatedPreviewHtmlChange(
  frame: HTMLIFrameElement | null, projectId: string | null, activePath: string | null,
  changed: readonly string[] | null, treeChanged: boolean,
): boolean {
  if (!frame) return false;
  const scope = frames.get(frame);
  if (!scope) return false;
  if (scope.projectId === projectId && activePath === "index.html" && scope.writeRevision === studioFileRevision() &&
      !treeChanged && changed?.length && changed.every(path => /\.html?$/i.test(path) && !scope.paths.has(path))) return true;
  // The next document's handshake supplies the graph after a dependency, topology or unknown change.
  frames.delete(frame);
  return false;
}
