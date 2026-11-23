import { studioFileContentVersion } from "./studioFileVersion";

// Sources belong to the exact revision observed on a capability-advertising cloud read.
// Keep recent active compositions only. An eviction always has an authoritative read fallback.
export interface ConfirmedSource { content: string; version: string }
const sources = new Map<string, ConfirmedSource>();
let codeUnits = 0;
const key = (projectId: string, path: string) => JSON.stringify([projectId, path]);

export function confirmedSource(projectId: string, path: string) {
  return sources.get(key(projectId, path));
}

export function supportsProjectTextEdits(projectId: string) {
  const prefix = '[' + JSON.stringify(projectId) + ',';
  return Array.from(sources.keys()).some(id => id.startsWith(prefix));
}

export async function observedSourceVersion(projectId: string, path: string, content: string) {
  const known = confirmedSource(projectId, path);
  if (known?.content === content) return known.version;
  return studioFileContentVersion(content);
}

export function forgetSource(projectId: string, path: string) {
  forget(key(projectId, path));
}

function forget(id: string) {
  const previous = sources.get(id);
  if (previous) codeUnits -= previous.content.length;
  sources.delete(id);
}

export function rememberSource(projectId: string, path: string, source: ConfirmedSource) {
  const id = key(projectId, path);
  forget(id);
  sources.set(id, source);
  codeUnits += source.content.length;
  // A single large active file still needs its revision for the next write.
  while (sources.size > 1 && (sources.size > 64 || codeUnits > 4 * 1024 * 1024)) {
    forget(sources.keys().next().value!);
  }
}

export function observeSourceRead(projectId: string, path: string, response: Response, data: { content?: string; version?: string | null }) {
  const version = data.version ?? response.headers?.get('etag');
  if (response.headers?.get('X-OpenMotion-Text-Edits') === '1' && typeof data.content === 'string' && version) {
    rememberSource(projectId, path, { content: data.content, version });
  } else {
    forgetSource(projectId, path);
  }
}
