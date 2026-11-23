import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  CSS_URL_RE,
  checkSubCompositionUsability,
  isNonRelativeUrl,
  parseHTMLContent,
} from '@hyperframes/core/compiler';
import {
  lintHyperframeHtml,
  shouldBlockRender,
  type HyperframeLintFinding,
  type HyperframeLintResult,
  type HyperframeLinterOptions,
  type ProjectLintResult,
} from '@hyperframes/lint';
import {
  decodedUrlPath,
  encodeUrlPath,
  rewriteAssetPath,
  splitUrlSuffix,
} from '@hyperframes/parsers/asset-paths';
import { readMediaOffsetSeconds } from '@hyperframes/parsers/media-duration';
import {
  MEDIA_START_BASIS_ATTR,
  compositionOriginSeconds,
  cutToHostSlots,
  resolveMediaStartSeconds,
  type HostSlot,
} from '@hyperframes/parsers/media-timing';
import { resolveReferencedDuration, resolveReferencedStart } from '@hyperframes/parsers/reference-resolver';
import {
  normalizeVirtualPath,
  resolveCompositionReference,
  resolveVirtualPath,
  virtualDirname,
  type VirtualProjectReader,
} from '../virtual-project-store.ts';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus', '.aif', '.aiff']);
const PAGES_OPENED_BESIDE_INDEX = new Set(['caption-skin.html', 'podcast-lanes.html']);
const HEVC_CODEC_RE = /^(?:hevc|h265|hev1|hvc1)$/i;

interface HtmlSourceEntry {
  html: string;
  compSrcPath?: string;
}

function contentDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function isRemoteOrInlineUrl(url: string): boolean {
  return /^(?:https?:|data:|blob:|mailto:|tel:|#)/i.test(url.trim());
}

function isPlaceholder(src: string): boolean {
  const trimmed = src.trim();
  return !trimmed || /^__[A-Z0-9_]+__$/.test(trimmed) || /\{\{[^}]+\}\}/.test(trimmed);
}

function cleanAssetUrl(raw: string): string {
  const { basePath } = splitUrlSuffix(raw.trim());
  return decodedUrlPath(basePath);
}

function isSnippetFragment(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed) return true;
  if (/<!doctype|<html\b|<head\b|<body\b|<template\b|data-composition-id/i.test(trimmed)) return false;
  return true;
}

function collectExternalStylesVirtual(
  project: VirtualProjectReader,
  html: string,
  compSrcPath?: string,
): NonNullable<HyperframeLinterOptions['externalStyles']> {
  const doc = parseHTMLContent(html);
  const baseDir = compSrcPath ? virtualDirname(compSrcPath) : '';
  const out: NonNullable<HyperframeLinterOptions['externalStyles']> = [];

  for (const link of [...doc.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = (link.getAttribute('href') || '').trim();
    if (!href || isNonRelativeUrl(href) || href.startsWith('/')) continue;
    const resolved =
      resolveVirtualPath(baseDir, cleanAssetUrl(href)) ?? resolveVirtualPath('', cleanAssetUrl(href));
    if (!resolved) continue;
    const content = project.readText(resolved);
    if (content === null) continue;
    out.push({ href, content, file: resolved, rootRelativePath: resolved });
  }
  return out;
}

function collectExternalScriptsVirtual(
  project: VirtualProjectReader,
  html: string,
  compSrcPath?: string,
): NonNullable<HyperframeLinterOptions['externalScripts']> {
  const doc = parseHTMLContent(html);
  const baseDir = compSrcPath ? virtualDirname(compSrcPath) : '';
  const out: NonNullable<HyperframeLinterOptions['externalScripts']> = [];

  for (const script of [...doc.querySelectorAll('script[src]')]) {
    const src = (script.getAttribute('src') || '').trim();
    if (!src || isNonRelativeUrl(src) || src.startsWith('/')) continue;
    const resolved =
      resolveVirtualPath(baseDir, cleanAssetUrl(src)) ?? resolveVirtualPath('', cleanAssetUrl(src));
    if (!resolved) continue;
    const content = project.readText(resolved);
    if (content === null) continue;
    const attrs = Array.from(script.attributes)
      .map((a) => `${a.name}="${a.value}"`)
      .join(' ');
    out.push({ src, attrs, content, file: resolved, rootRelativePath: resolved });
  }
  return out;
}

function extractDeclaredFontFamilies(project: VirtualProjectReader, htmlSources: readonly HtmlSourceEntry[]): string[] {
  const families = new Set<string>();
  const fontFaceRe = /@font-face\s*\{[^}]*font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;}\n]+))/gi;
  const scan = (text: string) => {
    for (const match of text.matchAll(fontFaceRe)) {
      const fam = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (fam) families.add(fam);
    }
  };
  for (const { html, compSrcPath } of htmlSources) {
    scan(html);
    for (const ext of collectExternalStylesVirtual(project, html, compSrcPath)) {
      scan(ext.content);
    }
  }
  return [...families];
}

function resolveProjectRelativeAsset(
  project: VirtualProjectReader,
  rawSrc: string,
  compSrcPath?: string,
): { resolved: string | null; clean: string } {
  const clean = cleanAssetUrl(rawSrc);
  if (!clean) return { resolved: null, clean };
  const exists = (p: string) => project.exists(p);
  const rootRel = compSrcPath ? rewriteAssetPath(compSrcPath, clean, exists) : clean;
  const normalized = normalizeVirtualPath(rootRel);
  if (project.exists(normalized)) return { resolved: normalized, clean };
  if (compSrcPath) {
    const fromComp = resolveVirtualPath(virtualDirname(compSrcPath), clean);
    if (fromComp && project.exists(fromComp)) return { resolved: fromComp, clean };
  }
  return { resolved: null, clean };
}

function lintProjectAudioFilesVirtual(
  project: VirtualProjectReader,
  htmlSources: readonly HtmlSourceEntry[],
): HyperframeLintFinding[] {
  const rootAudio = project
    .listFiles()
    .map((f) => f.path)
    .filter((p) => !p.includes('/') && AUDIO_EXTENSIONS.has(path.posix.extname(p).toLowerCase()));
  if (rootAudio.length === 0) return [];
  const hasAudio = htmlSources.some(({ html }) => /<audio\b/i.test(html));
  const hasAudibleVideo = htmlSources.some(({ html }) =>
    (html.match(/<video\b[^>]*>/gi) ?? []).some((tag) => !/\bmuted\b/i.test(tag)),
  );
  if (hasAudio || hasAudibleVideo) return [];
  return [
    {
      code: 'audio_file_without_element',
      severity: 'warning',
      message: `Found audio file(s) in project (${rootAudio.join(', ')}) but no <audio> element in any composition. The rendered video will be silent.`,
      fixHint: `Add an <audio id="my-audio" src="${rootAudio[0]}" data-start="0" data-duration="__DURATION__" data-track-index="0" data-volume="1"></audio> element inside the composition root.`,
    },
  ];
}

function lintMissingMediaAssetsVirtual(
  project: VirtualProjectReader,
  htmlSources: readonly HtmlSourceEntry[],
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  const missingAudioByFile = new Map<string, Set<string>>();
  const missingVisualByFileTag = new Map<string, { file: string; tag: string; srcs: Set<string> }>();

  for (const { html, compSrcPath } of htmlSources) {
    const file = compSrcPath ?? 'index.html';
    const doc = parseHTMLContent(html);
    for (const el of [...doc.querySelectorAll('audio, video, img, source')]) {
      const tag = el.tagName.toLowerCase();
      const rawSrc = (el.getAttribute('src') || '').trim();
      if (!rawSrc || isPlaceholder(rawSrc) || isRemoteOrInlineUrl(rawSrc)) continue;
      const { resolved, clean } = resolveProjectRelativeAsset(project, rawSrc, compSrcPath);
      if (resolved) continue;
      if (tag === 'audio') {
        const set = missingAudioByFile.get(file) ?? new Set<string>();
        set.add(clean || rawSrc);
        missingAudioByFile.set(file, set);
      } else {
        const key = `${file}\0${tag}`;
        const bucket = missingVisualByFileTag.get(key) ?? { file, tag, srcs: new Set<string>() };
        bucket.srcs.add(clean || rawSrc);
        missingVisualByFileTag.set(key, bucket);
      }
    }
  }

  for (const [file, srcs] of missingAudioByFile) {
    const unique = [...srcs];
    findings.push({
      code: 'audio_src_not_found',
      severity: 'error',
      file,
      message: `<audio> element references file(s) not found in the project: ${unique.join(', ')}. The rendered video will be silent.`,
      fixHint: `Add ${unique.map((s) => `"${s}"`).join(', ')} to the project or update the src attribute.`,
    });
  }

  for (const { file, tag, srcs } of missingVisualByFileTag.values()) {
    const unique = [...srcs];
    const urlEncodedHint =
      unique.length === 1 && /[?#]/.test(unique[0]) && project.exists(normalizeVirtualPath(unique[0]))
        ? `Write the src as "${encodeUrlPath(unique[0])}".`
        : `Add ${unique.map((s) => `"${s}"`).join(', ')} to the project or update the src attribute.`;
    findings.push({
      code: 'missing_local_asset',
      severity: 'error',
      file,
      message: `<${tag}> element references local file(s) not found in the project: ${unique.join(', ')}. The renderer will silently skip these and produce a video with missing visuals.`,
      fixHint: urlEncodedHint,
    });
  }
  return findings;
}

function lintStylesheetAndMaskAssetsVirtual(
  project: VirtualProjectReader,
  htmlSources: readonly HtmlSourceEntry[],
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  const maskMissingByFile = new Map<string, Set<string>>();
  const seenStylesheetMissing = new Set<string>();

  for (const { html, compSrcPath } of htmlSources) {
    const file = compSrcPath ?? 'index.html';
    const doc = parseHTMLContent(html);

    // Check inline <style> mask-image urls
    for (const styleEl of [...doc.querySelectorAll('style')]) {
      const css = styleEl.textContent || '';
      for (const match of css.matchAll(/(?:-webkit-)?mask-image\s*:\s*[^;{}]*url\(\s*(["']?)([^)"']+)\1\s*\)/gi)) {
        const rawUrl = (match[2] ?? '').trim();
        if (!rawUrl || isPlaceholder(rawUrl) || isRemoteOrInlineUrl(rawUrl)) continue;
        const { resolved, clean } = resolveProjectRelativeAsset(project, rawUrl, compSrcPath);
        if (!resolved) {
          const set = maskMissingByFile.get(file) ?? new Set<string>();
          set.add(clean || rawUrl);
          maskMissingByFile.set(file, set);
        }
      }
    }

    // Check linked stylesheets
    for (const ext of collectExternalStylesVirtual(project, html, compSrcPath)) {
      const cssDir = virtualDirname(ext.rootRelativePath ?? '');
      for (const match of ext.content.matchAll(CSS_URL_RE)) {
        const rawUrl = (match[2] ?? '').trim();
        if (!rawUrl || isPlaceholder(rawUrl) || isRemoteOrInlineUrl(rawUrl) || rawUrl.startsWith('/')) continue;
        const clean = cleanAssetUrl(rawUrl);
        const beside = resolveVirtualPath(cssDir, clean);
        if (beside && project.exists(beside)) continue;
        const key = `${ext.rootRelativePath}\0${clean}`;
        if (seenStylesheetMissing.has(key)) continue;
        seenStylesheetMissing.add(key);
        findings.push({
          code: 'missing_stylesheet_asset',
          severity: 'warning',
          file: ext.rootRelativePath,
          message: `${ext.rootRelativePath} references url(${clean}), which is not found beside the stylesheet.`,
          fixHint: `Add "${clean}" beside ${ext.rootRelativePath} or update the url().`,
        });
      }
    }
  }

  for (const [file, urls] of maskMissingByFile) {
    findings.push({
      code: 'texture_mask_asset_not_found',
      severity: 'error',
      file,
      message: `CSS mask-image references file(s) not found in the project: ${[...urls].join(', ')}.`,
      fixHint: 'Add the missing texture mask files or update mask-image URLs.',
    });
  }

  return findings;
}

function lintMultipleRootCompositionsVirtual(project: VirtualProjectReader): HyperframeLintFinding[] {
  const rootComps: string[] = [];
  for (const file of project.listFiles()) {
    if (file.path.includes('/') || !file.path.endsWith('.html') || file.path.startsWith('._')) continue;
    if (PAGES_OPENED_BESIDE_INDEX.has(file.path)) continue;
    const html = project.readText(file.path);
    if (html && /data-composition-id/i.test(html)) {
      rootComps.push(file.path);
    }
  }
  if (rootComps.length <= 1) return [];
  return [
    {
      code: 'multiple_root_compositions',
      severity: 'error',
      message: `Multiple root-level HTML files with data-composition-id: ${rootComps.join(', ')}.`,
      fixHint: 'A project should have exactly one root index.html with data-composition-id.',
    },
  ];
}

function lintBlankRootWithStandaloneVirtual(
  rootHtml: string,
  htmlSources: readonly HtmlSourceEntry[],
): HyperframeLintFinding[] {
  const rootDoc = parseHTMLContent(rootHtml);
  const root = rootDoc.querySelector('body [data-composition-id]');
  if (!root || root.querySelector('*:not(script):not(style):not(link):not(meta):not(template)')) {
    return [];
  }
  const standalone: string[] = [];
  for (const src of htmlSources) {
    if (!src.compSrcPath) continue;
    const doc = parseHTMLContent(src.html);
    const comp = doc.querySelector('body [data-composition-id]');
    if (!comp) continue;
    const hasContent = Array.from(
      comp.querySelectorAll('.clip, [data-start], [data-end], video, audio, img, svg, canvas'),
    ).some((el) => !el.hasAttribute('data-composition-src'));
    if (hasContent) standalone.push(src.compSrcPath);
  }
  if (standalone.length === 0) return [];
  return [
    {
      code: 'blank_root_with_standalone_composition',
      severity: 'error',
      message: `The default index.html composition has no renderable content, but ${standalone.join(', ')} contains a standalone timed composition.`,
      fixHint: `Move the authored composition into index.html or mount it with data-composition-src.`,
      suggestedComposition: standalone[0],
    },
  ];
}

function lintMissingOrEmptySubCompositionsVirtual(
  project: VirtualProjectReader,
  rootHtml: string,
  entryFile: string,
): HyperframeLintFinding[] {
  const visited = new Set<string>();
  const findings: HyperframeLintFinding[] = [];
  const subSrcRe = /\bdata-composition-src\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;

  const walk = (html: string, containingPath: string) => {
    for (const match of html.matchAll(subSrcRe)) {
      const srcPath = (match[1] ?? match[2] ?? '').trim();
      if (!srcPath || isPlaceholder(srcPath) || isRemoteOrInlineUrl(srcPath)) continue;
      const normalized = resolveCompositionReference(project, containingPath, decodedUrlPath(srcPath));
      if (normalized && visited.has(normalized)) continue;
      if (normalized) visited.add(normalized);
      const subHtml = normalized ? project.readText(normalized) : null;
      if (subHtml === null || !normalized) {
        findings.push({
          code: 'missing_or_empty_sub_composition',
          severity: 'error',
          message: `data-composition-src references "${srcPath}", but the file does not exist.`,
          fixHint: `Write valid HTML into "${srcPath}" with a data-composition-id root.`,
        });
        continue;
      }
      const validity = checkSubCompositionUsability(subHtml, parseHTMLContent);
      if (!validity.ok) {
        findings.push({
          code: 'missing_or_empty_sub_composition',
          severity: 'error',
          message: `data-composition-src references "${srcPath}", but ${validity.detail ?? 'the file is empty or invalid'}.`,
          fixHint: `Write valid HTML into "${srcPath}" containing an element with data-composition-id, data-width, and data-height.`,
        });
        continue;
      }
      walk(subHtml, normalized);
    }
  };
  walk(rootHtml, entryFile);
  return findings;
}

function lintDuplicateAudioTracksVirtual(
  project: VirtualProjectReader,
  rootHtml: string,
  entryFile: string,
): HyperframeLintFinding[] {
  interface AudioSpan {
    trackIndex: number;
    start: number;
    end: number;
    src: string;
  }
  const spans: AudioSpan[] = [];
  const parseNumeric = (raw: string | null): number | null => {
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const visit = (
    parent: ParentNode,
    doc: Document,
    starts: Map<Element, number>,
    origin: number,
    slots: HostSlot[],
    mounting: string[],
  ) => {
    for (const el of Array.from(parent.children)) {
      if (el.tagName === 'TEMPLATE') {
        const tmpl = el as HTMLTemplateElement;
        if (tmpl.content) visit(tmpl.content, doc, starts, origin, slots, mounting);
        continue;
      }
      const tag = el.tagName.toLowerCase();
      if (tag === 'audio' || (tag === 'video' && !el.hasAttribute('muted') && el.getAttribute('data-muted') !== 'true')) {
        const trackStr = el.getAttribute('data-track-index');
        if (trackStr && el.hasAttribute('data-start')) {
          const start = resolveMediaStartSeconds({
            authoredStart: parseNumeric(el.getAttribute('data-start')),
            hostStart: origin,
            hasAutoStart: el.hasAttribute('data-hf-auto-start'),
            basis: el.getAttribute(MEDIA_START_BASIS_ATTR),
            ordinaryStart: () => origin + resolveReferencedStart(doc, el, starts, new Set()),
          });
          const dur =
            parseNumeric(el.getAttribute('data-duration')) ??
            resolveReferencedDuration(doc, el, starts, new Set());
          const kept = cutToHostSlots({ start, end: start + (dur ?? Infinity) }, slots);
          if (kept.end > kept.start) {
            spans.push({
              trackIndex: Number.parseInt(trackStr, 10),
              start: kept.start,
              end: kept.end,
              src: el.getAttribute('src') || 'unknown',
            });
          }
        }
      }
      if (el.hasAttribute('data-composition-id') || el.hasAttribute('data-composition-src')) {
        const localStart = origin + resolveReferencedStart(doc, el, starts, new Set());
        const localDur = resolveReferencedDuration(doc, el, starts, new Set());
        const nextSlots: HostSlot[] =
          localDur === null ? slots : [...slots, { start: localStart, end: localStart + localDur }];
        const nextOrigin = compositionOriginSeconds(localStart, el);
        const subSrc = el.getAttribute('data-composition-src')?.trim();
        if (subSrc && !isPlaceholder(subSrc) && !isRemoteOrInlineUrl(subSrc)) {
          const normalized = resolveCompositionReference(project, mounting.at(-1)!, decodedUrlPath(subSrc));
          if (normalized && !mounting.includes(normalized)) {
            const subHtml = project.readText(normalized);
            if (subHtml) {
              const subDoc = parseHTMLContent(subHtml);
              const subRoot = subDoc.querySelector('[data-composition-id]') ?? subDoc.body;
              if (subRoot) {
                visit(subRoot, subDoc, new Map(), nextOrigin, nextSlots, [...mounting, normalized]);
              }
            }
          }
        }
        visit(el, doc, starts, nextOrigin, nextSlots, mounting);
      } else {
        visit(el, doc, starts, origin, slots, mounting);
      }
    }
  };

  const rootDoc = parseHTMLContent(rootHtml);
  visit(rootDoc, rootDoc, new Map(), 0, [], [entryFile]);

  const findings: HyperframeLintFinding[] = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i];
      const b = spans[j];
      if (a.trackIndex !== b.trackIndex) continue;
      if (a.start < b.end - 0.001 && b.start < a.end - 0.001) {
        findings.push({
          code: 'duplicate_audio_track',
          severity: 'warning',
          message: `Multiple audible <audio>/<video> elements on track ${a.trackIndex} overlap (${a.src} and ${b.src}).`,
          fixHint: 'Use non-overlapping time windows or different track indices.',
        });
      }
    }
  }
  return findings;
}

/**
 * Satisfies video metadata rules (`video_media_start_past_eof` and `hevc_preview_codec`)
 * purely from PG `workspace_blobs.metadata` / `catalog_template_files.metadata` — ZERO `ffprobe`!
 */
function lintVideoMetadataVirtual(
  project: VirtualProjectReader,
  htmlSources: readonly HtmlSourceEntry[],
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  const seenHevc = new Set<string>();

  for (const { html, compSrcPath } of htmlSources) {
    const file = compSrcPath ?? 'index.html';
    const doc = parseHTMLContent(html);
    for (const el of [...doc.querySelectorAll('video')]) {
      const rawSrc = (el.getAttribute('src') || '').trim();
      if (!rawSrc || isPlaceholder(rawSrc) || isRemoteOrInlineUrl(rawSrc)) continue;
      const { resolved } = resolveProjectRelativeAsset(project, rawSrc, compSrcPath);
      if (!resolved) continue;
      const meta = project.getBlobMetadata(resolved);
      if (!meta) continue;

      const mediaStart = readMediaOffsetSeconds((name) => el.getAttribute(name));
      if (
        typeof meta.durationSec === 'number' &&
        Number.isFinite(meta.durationSec) &&
        meta.durationSec > 0 &&
        mediaStart >= meta.durationSec
      ) {
        findings.push({
          code: 'video_media_start_past_eof',
          severity: 'error',
          file,
          elementId: el.id || undefined,
          message: `<video src="${rawSrc}"> sets media start (${mediaStart}s) at or past video duration (${meta.durationSec.toFixed(2)}s).`,
          fixHint: `Set data-playback-start below ${meta.durationSec.toFixed(2)}s.`,
        });
      }

      if (meta.codec && HEVC_CODEC_RE.test(meta.codec) && !seenHevc.has(resolved)) {
        seenHevc.add(resolved);
        findings.push({
          code: 'hevc_preview_codec',
          severity: 'warning',
          file,
          elementId: el.id || undefined,
          message: `<video src="${rawSrc}"> uses HEVC (${meta.codec}) which may not decode in all browsers.`,
          fixHint: 'Transcode to H.264 (avc1) for universal Studio preview and export compatibility.',
        });
      }
    }
  }
  return findings;
}

export interface DisklessLintSummary extends ProjectLintResult {
  readonly findings: HyperframeLintFinding[];
  readonly diagnostics: HyperframeLintFinding[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly blocksRender: boolean;
}

/**
 * Pure in-memory project linter replacing `@hyperframes/lint`'s filesystem `lintProject`.
 * Reads text from `VirtualProjectReader` and media metadata from PG `blobs.metadata` (ZERO disk, ZERO ffprobe).
 */
export async function lintProjectInMemory(
  project: VirtualProjectReader,
  options: { entryFile?: string; host?: 'studio' | 'cli'; distributed?: boolean } = {},
): Promise<DisklessLintSummary> {
  const entryFile = normalizeVirtualPath(options.entryFile ?? 'index.html');
  const rootHtml = project.readText(entryFile);
  if (rootHtml === null) {
    const missing: HyperframeLintFinding = {
      code: 'missing_entry_html',
      severity: 'error',
      file: entryFile,
      message: `${entryFile} not found in project.`,
    };
    const emptyRes: HyperframeLintResult = {
      ok: false,
      errorCount: 1,
      warningCount: 0,
      infoCount: 0,
      findings: [missing],
    };
    return {
      results: [{ file: entryFile, result: emptyRes, contentHash: contentDigest('') }],
      totalErrors: 1,
      totalWarnings: 0,
      totalInfos: 0,
      findings: [missing],
      diagnostics: [missing],
      errorCount: 1,
      warningCount: 0,
      infoCount: 0,
      blocksRender: true,
    };
  }

  const host = options.host ?? 'studio';
  const distributed = options.distributed ?? true;
  const rootCompSrcPath = entryFile === 'index.html' ? undefined : entryFile;

  const allHtmlSources: HtmlSourceEntry[] = [{ html: rootHtml, compSrcPath: rootCompSrcPath }];
  const subCompEntries: Array<{ path: string; html: string }> = [];

  if (!options.entryFile) {
    for (const file of project.listFiles()) {
      if (
        file.path.startsWith('compositions/') &&
        !file.path.startsWith('compositions/components/') &&
        file.path.endsWith('.html') &&
        !path.posix.basename(file.path).startsWith('._')
      ) {
        const html = project.readText(file.path);
        if (html !== null) {
          allHtmlSources.push({ html, compSrcPath: file.path });
          subCompEntries.push({ path: file.path, html });
        }
      }
    }
  }

  const projectFontFamilies = extractDeclaredFontFamilies(project, allHtmlSources);
  const results: ProjectLintResult['results'] = [];

  const rootResult = await lintHyperframeHtml(rootHtml, {
    filePath: entryFile,
    compSrcPath: entryFile,
    host,
    distributed,
    projectFontFamilies,
    externalStyles: collectExternalStylesVirtual(project, rootHtml, rootCompSrcPath),
    externalScripts: collectExternalScriptsVirtual(project, rootHtml, rootCompSrcPath),
  });
  results.push({ file: entryFile, result: rootResult, contentHash: contentDigest(rootHtml) });

  for (const sub of subCompEntries) {
    if (isSnippetFragment(sub.html)) continue;
    const subResult = await lintHyperframeHtml(sub.html, {
      filePath: sub.path,
      isSubComposition: true,
      compSrcPath: sub.path,
      host,
      distributed,
      projectFontFamilies,
      externalStyles: collectExternalStylesVirtual(project, sub.html, sub.path),
      externalScripts: collectExternalScriptsVirtual(project, sub.html, sub.path),
    });
    results.push({ file: sub.path, result: subResult, contentHash: contentDigest(sub.html) });
  }

  const projectFindings: HyperframeLintFinding[] = [
    ...lintProjectAudioFilesVirtual(project, allHtmlSources),
    ...lintMissingMediaAssetsVirtual(project, allHtmlSources),
    ...lintStylesheetAndMaskAssetsVirtual(project, allHtmlSources),
    ...(!options.entryFile ? lintMultipleRootCompositionsVirtual(project) : []),
    ...(!options.entryFile ? lintBlankRootWithStandaloneVirtual(rootHtml, allHtmlSources) : []),
    ...lintDuplicateAudioTracksVirtual(project, rootHtml, entryFile),
    ...lintMissingOrEmptySubCompositionsVirtual(project, rootHtml, entryFile),
    ...lintVideoMetadataVirtual(project, allHtmlSources),
  ];

  for (const finding of projectFindings) {
    const owner =
      (finding.file ? results.find((entry) => entry.file === finding.file)?.result : undefined) ?? rootResult;
    owner.findings.push(finding);
    if (finding.severity === 'error') {
      owner.errorCount += 1;
      owner.ok = false;
    } else if (finding.severity === 'warning') {
      owner.warningCount += 1;
    } else {
      owner.infoCount += 1;
    }
  }

  const flatFindings: HyperframeLintFinding[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;
  for (const entry of results) {
    totalErrors += entry.result.errorCount;
    totalWarnings += entry.result.warningCount;
    totalInfos += entry.result.infoCount;
    for (const finding of entry.result.findings) {
      flatFindings.push(finding.file ? finding : { ...finding, file: entry.file });
    }
  }

  return {
    results,
    totalErrors,
    totalWarnings,
    totalInfos,
    findings: flatFindings,
    diagnostics: flatFindings,
    errorCount: totalErrors,
    warningCount: totalWarnings,
    infoCount: totalInfos,
    blocksRender: shouldBlockRender(true, false, totalErrors, totalWarnings),
  };
}
