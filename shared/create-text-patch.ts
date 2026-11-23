import { diffChars } from 'diff';
import { MAX_PATCH_BYTES, type TextPatch } from './text-patch.ts';

const encoder = new TextEncoder();
// Tokenizing huge strings on the UI thread can cost more than a full-source submission.
// Limit the changed window before invoking jsdiff, including when its timeout would not yet run.
const MAX_DIFF_WINDOW = 128 * 1024;

export function createTextPatch(before: string, after: string): TextPatch | null {
  if (before === after) return [];
  if (!before.isWellFormed() || !after.isWellFormed()) return null;
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  const lowSurrogate = (n: number) => n >= 0xdc00 && n <= 0xdfff;
  if (lowSurrogate(before.charCodeAt(start)) || lowSurrogate(after.charCodeAt(start))) start--;
  let suffix = 0;
  while (suffix < limit - start && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  if (suffix && lowSurrogate(before.charCodeAt(before.length - suffix))) suffix--;
  const oldWindow = before.slice(start, before.length - suffix);
  const newWindow = after.slice(start, after.length - suffix);
  if (oldWindow.length + newWindow.length > MAX_DIFF_WINDOW) return null;
  const changes = diffChars(oldWindow, newWindow, { maxEditLength: 512, timeout: 20 });
  if (!changes) return null;

  const patch: [number, number, string][] = [];
  let offset = encoder.encode(before.slice(0, start)).length;
  let replacement: [number, number, string] | undefined;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      offset += encoder.encode(change.value).length;
      replacement = undefined;
      continue;
    }
    if (!replacement) {
      replacement = [offset, 0, ''];
      patch.push(replacement);
    }
    if (change.added) {
      replacement[2] += change.value;
    } else {
      const removed = encoder.encode(change.value).length;
      replacement[1] += removed;
      offset += removed;
    }
  }
  const bytes = encoder.encode(JSON.stringify(patch)).length;
  if (bytes > MAX_PATCH_BYTES) return null;
  // UTF-8 needs at least one byte per UTF-16 code unit in a well-formed string.
  if (bytes < after.length) return patch;
  return bytes < encoder.encode(after).length ? patch : null;
}
