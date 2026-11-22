/* ── Helpers ──────────────────────────────────────────────────────── */
export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ── File path utilities ──────────────────────────────────────────── */
function normalizeStudioFileChangePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

function asPayloadRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

/**
 * Read one string field out of an ALREADY-DECODED file-change payload. Every
 * reader of that payload goes through here, so no reader can disagree with its
 * siblings about the shape. Decoding a raw delivery is the transport's job.
 */
export function readFileChangeField(payload: unknown, key: string): string | null {
  const value = asPayloadRecord(payload)?.[key];
  return typeof value === "string" ? value : null;
}

export function readStudioFileChangePath(payload: unknown): string | null {
  const path = readFileChangeField(payload, "path") ?? readFileChangeField(payload, "filePath");
  if (path !== null) return normalizeStudioFileChangePath(path);
  // Cloud transactions can atomically change several files in one event.
  const paths = asPayloadRecord(payload)?.paths;
  if (!Array.isArray(paths) || !paths.length || !paths.every(p => typeof p === "string" && p)) return null;
  return paths.length === 1 ? normalizeStudioFileChangePath(paths[0]) : ".";
}

export function readFileTreeChanged(payload: unknown): boolean {
  return asPayloadRecord(payload)?.fileTreeChanged !== false;
}

export function readFileChangeAffectsPreview(payload: unknown): boolean {
  return asPayloadRecord(payload)?.affectsPreview !== false;
}

/**
 * The compositions whose thumbnails a change can alter, or `null` for all of them. Anything
 * but a list of paths (an older server, the Vite dev host) reads as "all".
 */
export function readFileChangeAffectedCompositions(payload: unknown): readonly string[] | null {
  const value = asPayloadRecord(payload)?.affectedCompositions;
  if (!Array.isArray(value) || !value.every((path) => typeof path === "string")) return null;
  return value.map(normalizeStudioFileChangePath);
}

export function mergeFileChangePayloads(waiting: unknown, incoming: unknown): unknown {
  const fileTreeChanged = readFileTreeChanged(waiting) || readFileTreeChanged(incoming);
  if (readFileChangeAffectsPreview(waiting) && !readFileChangeAffectsPreview(incoming)) {
    return { ...asPayloadRecord(waiting), fileTreeChanged };
  }
  const before = readFileChangeAffectedCompositions(waiting);
  const after = readFileChangeAffectedCompositions(incoming);
  const merged = before && after ? [...new Set([...before, ...after])] : null;
  const next = asPayloadRecord(incoming);
  const affectsPreview =
    readFileChangeAffectsPreview(waiting) || readFileChangeAffectsPreview(incoming);
  if (readStudioFileChangePath(waiting) === readStudioFileChangePath(incoming)) {
    return { ...next, affectsPreview, fileTreeChanged, affectedCompositions: merged };
  }
  // Changes to two files are owed: only a project-wide reload ("." path) covers both.
  return {
    path: ".",
    projectId: next?.projectId,
    fileTreeChanged,
    affectsPreview,
    affectedCompositions: merged,
  };
}
