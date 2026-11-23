import { decodedUrlPath } from '@hyperframes/parsers';
import { parseHTMLContent } from '@hyperframes/core/compiler/html-document';
import { resolveTimelineAssetSrc } from './asset-placement.ts';

const PATH_ATTRS = ['src', 'href', 'poster', 'data-composition-src'];
const CSS_URL = /\burl\(\s*(["']?)([^)"'\s](?:[^)"']*[^)"'\s])?)\1\s*\)/g;

function isRelative(path: string): boolean {
  return !!path && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(path);
}

function toProjectPath(sourceFile: string, path: string): string {
  const parts = sourceFile.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

function livePathsOf(live: Element): Set<string> {
  const paths = new Set<string>();
  for (const el of [live, ...Array.from(live.querySelectorAll('*'))]) {
    for (const attr of PATH_ATTRS) paths.add(el.getAttribute(attr) ?? '');
    for (const match of (el.getAttribute('style') ?? '').matchAll(CSS_URL)) paths.add(match[2]);
  }
  return paths;
}

// The preview inlines a sub-composition with its relative asset paths rebased to the project
// root (rewriteAssetPath in @hyperframes/parsers, which is not browser-safe); copy does the same.
export function authoredMarkup(
  authored: Element,
  live: Element | null,
  sourceFile: string,
  files: readonly string[] = [],
): string {
  if (!sourceFile.includes('/')) return authored.outerHTML;
  const livePaths = live ? livePathsOf(live) : null;
  const rebase = (path: string): string => {
    if (!isRelative(path)) return path;
    const cut = path.search(/[?#]/);
    const suffix = cut < 0 ? '' : path.slice(cut);
    const sibling = toProjectPath(sourceFile, cut < 0 ? path : path.slice(0, cut));
    const rebased = sibling + suffix;
    return path.startsWith('../') ||
      (livePaths ? livePaths.has(rebased) : files.includes(decodedUrlPath(sibling)))
      ? rebased
      : path;
  };
  const copy = authored.cloneNode(true) as Element;
  rewriteClipPaths(copy, rebase);
  return copy.outerHTML;
}

function rewriteClipPaths(copy: Element, rebase: (url: string) => string) {
  for (const el of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
    for (const attr of PATH_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) el.setAttribute(attr, rebase(value.trim()));
    }
    const style = el.getAttribute('style');
    if (style) {
      el.setAttribute(
        'style',
        style.replace(CSS_URL, (_, quote: string, url: string) => `url(${quote}${rebase(url)}${quote})`),
      );
    }
  }
}

/** Studio clipboard URLs are project-relative; nested destination files need their own relative URLs. */
export function clipboardMarkupForFile(html: string, targetPath: string): string {
  if (!targetPath.includes('/')) return html;
  const root = parseHTMLContent(html).body.firstElementChild;
  if (!root) return html;
  rewriteClipPaths(root, (url) => (isRelative(url) ? resolveTimelineAssetSrc(targetPath, url) : url));
  return root.outerHTML;
}
