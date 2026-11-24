import { parseHTMLContent } from '@hyperframes/core/compiler';
import { CANVAS_DIMENSIONS } from '@hyperframes/parsers';
import {
  readDataDurationSeconds,
  readMediaOffsetSeconds,
  readPlaybackRate,
  resolveMediaDuration,
  type MediaDurationSource,
  type MediaTag,
} from '@hyperframes/parsers/media-duration';
import {
  MEDIA_START_BASIS_ATTR,
  compositionOriginSeconds,
  cutToHostSlots,
  hostInPointSeconds,
  resolveMediaStartSeconds,
  type HostSlot,
} from '@hyperframes/parsers/media-timing';
import { resolveReferencedDuration, resolveReferencedStart } from '@hyperframes/parsers/reference-resolver';
import {
  isSubCompositionHost,
  topLevelElements,
  trackKindOf,
  type StructureNode,
  type TrackKind,
} from '@hyperframes/parsers/top-level-elements';
import {
  normalizeVirtualPath,
  resolveVirtualPath,
  virtualDirname,
  type VirtualProjectReader,
} from '../virtual-project-store.ts';

export interface ProjectInfoResult {
  readonly name: string;
  readonly resolution: 'landscape' | 'portrait' | 'square';
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly elements: number;
  readonly tracks: number;
  readonly types: Record<string, number>;
  readonly size: number;
  readonly fileCount: number;
}

function orientation(width: number, height: number): 'landscape' | 'portrait' | 'square' {
  if (width > height) return 'landscape';
  if (height > width) return 'portrait';
  return 'square';
}

function parsePositiveInt(value: string | null): number | null {
  if (!value || !value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNumeric(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseFpsNumber(raw: string | null): number {
  if (!raw || !raw.trim()) return 30;
  const trimmed = raw.trim();
  const ratio = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (ratio) {
    const num = Number(ratio[1]);
    const den = Number(ratio[2]);
    if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) {
      return num / den;
    }
  }
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/**
 * Pure in-memory equivalent of `hyperframes info --json`.
 * Parses `index.html` via `@hyperframes/core/compiler` + `@hyperframes/parsers` and sums
 * `sizeBytes` from `VirtualProjectReader` (zero disk access).
 */
export function infoInMemory(project: VirtualProjectReader, entryFile = 'index.html'): ProjectInfoResult {
  const normalizedEntry = normalizeVirtualPath(entryFile);
  const html = project.readText(normalizedEntry) ?? '';
  const doc = parseHTMLContent(html);
  const root =
    doc.querySelector('[data-composition-id][data-root="true"]') ??
    doc.querySelector('[data-composition-id]') ??
    doc.body;

  const timeline = timelineInMemory(project, normalizedEntry);
  const allRows = timeline.tracks.flatMap((track) => track.rows);
  const trackIndices = new Set<number>(allRows.map((row) => row.trackIndex));
  let maxEnd = 0;
  const typeCounts: Record<string, number> = {};
  for (const row of allRows) {
    maxEnd = Math.max(maxEnd, row.absEnd);
    typeCounts[row.kind] = (typeCounts[row.kind] ?? 0) + 1;
  }

  const declaredRes = root?.getAttribute('data-resolution')?.trim() ?? 'landscape';
  const dimensionsMap = CANVAS_DIMENSIONS as Record<string, { readonly width: number; readonly height: number }>;
  const fallback = dimensionsMap[declaredRes] ?? { width: 1920, height: 1080 };
  const width = parsePositiveInt(root?.getAttribute('data-width') ?? null) ?? fallback.width;
  const height = parsePositiveInt(root?.getAttribute('data-height') ?? null) ?? fallback.height;
  const duration = readDataDurationSeconds((name) => root?.getAttribute(name)) ?? maxEnd;
  const fps = parseFpsNumber(root?.getAttribute('data-fps') ?? null);

  let totalSize = 0;
  const files = project.listFiles();
  for (const file of files) {
    totalSize += file.sizeBytes;
  }

  return {
    name: project.projectName,
    resolution: orientation(width, height),
    width,
    height,
    fps,
    duration,
    elements: allRows.length,
    tracks: trackIndices.size,
    types: typeCounts,
    size: totalSize,
    fileCount: files.length,
  };
}

// ---------------------------------------------------------------------------
// timelineInMemory — Pure in-memory equivalent of `hyperframes timeline --json`
// ---------------------------------------------------------------------------

interface DomStructureNode extends StructureNode<DomStructureNode> {
  readonly el: Element;
}

function toDomStructureNode(el: Element): DomStructureNode {
  const attrs: Record<string, string | undefined> = {};
  for (const attr of Array.from(el.attributes)) {
    attrs[attr.name] = attr.value;
  }
  const children: DomStructureNode[] = [];
  for (const child of Array.from(el.children)) {
    children.push(toDomStructureNode(child));
  }
  return {
    tag: el.tagName.toLowerCase(),
    attrs,
    children,
    el,
  };
}

export interface TimelineRow {
  readonly id: string;
  readonly kind: string;
  readonly trackKind: TrackKind;
  readonly start: number;
  readonly duration: number;
  readonly end: number;
  readonly absStart: number;
  readonly absEnd: number;
  readonly file: string;
  readonly trackIndex: number;
  readonly src: string | null;
  readonly sourceFile: string | null;
  readonly volume: number | null;
  readonly playbackRate: number | null;
  readonly durationAuthored: boolean;
  readonly durationSource: MediaDurationSource | 'inner' | null;
  readonly pendingReason: string | null;
  readonly elementId: string | null;
  readonly hfId: string | null;
  readonly mediaStart: number | null;
  readonly ref: string;
  readonly index: number;
  readonly nested: boolean;
  readonly host: string | null;
  readonly warnings: string[];
}

export interface TimelineTrack {
  readonly kind: TrackKind;
  readonly rows: readonly TimelineRow[];
}

export interface ProjectTimelineResult {
  readonly duration: number;
  readonly fps: number;
  readonly tracks: readonly TimelineTrack[];
}

interface RawRow {
  id: string;
  kind: string;
  trackKind: TrackKind;
  start: number;
  duration: number;
  end: number;
  absStart: number;
  absEnd: number;
  file: string;
  trackIndex: number;
  src: string | null;
  sourceFile: string | null;
  volume: number | null;
  playbackRate: number | null;
  durationAuthored: boolean;
  durationSource: MediaDurationSource | 'inner' | null;
  pendingReason: string | null;
  elementId: string | null;
  hfId: string | null;
  mediaStart: number | null;
  children: RawRow[];
  inside: RawRow[];
}

const TRACK_ORDER: readonly TrackKind[] = ['video', 'graphics', 'captions', 'audio'];
const MEDIA_TAG_RE = /^(?:video|audio|img)$/;
const roundMs = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Pure in-memory equivalent of `hyperframes timeline --json` (`describeProject`).
 * Resolves sub-compositions from `VirtualProjectReader` and media durations from PG `blobs.metadata.durationSec`
 * (zero local disk I/O, zero `ffprobe`).
 */
export function timelineInMemory(
  project: VirtualProjectReader,
  entryFile = 'index.html',
): ProjectTimelineResult {
  const normalizedEntry = normalizeVirtualPath(entryFile);
  const source = project.readText(normalizedEntry);
  if (source === null) {
    return { duration: 0, fps: 30, tracks: [] };
  }

  const rootDoc = parseHTMLContent(source);
  const rootEl =
    rootDoc.querySelector('[data-composition-id][data-root="true"]') ??
    rootDoc.querySelector('[data-composition-id]') ??
    rootDoc.body;
  const fps = parseFpsNumber(rootEl?.getAttribute('data-fps') ?? null);

  interface Scope {
    doc: Document;
    dir: string;
    file: string;
    origin: number;
    startCache: Map<Element, number>;
  }

  const measureMediaDuration = (scope: Scope, el: Element): { seconds: number | null; reason?: string } => {
    const src = el.getAttribute('src')?.trim();
    if (!src) return { seconds: null, reason: 'no src attribute' };
    if (/^https?:\/\//i.test(src)) return { seconds: null, reason: 'remote source not probed' };
    const resolved = resolveVirtualPath(scope.dir, src) ?? normalizeVirtualPath(src);
    const meta = project.getBlobMetadata(resolved);
    if (meta && typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec) && meta.durationSec > 0) {
      return { seconds: meta.durationSec };
    }
    return {
      seconds: null,
      reason: project.exists(resolved) ? 'media metadata pending probe' : 'source file not found',
    };
  };

  const mainTimelineStart = (scope: Scope, el: Element, start: number): number => {
    const ordinaryStart = () => scope.origin + start;
    if (!/^(?:video|audio)$/i.test(el.tagName)) return ordinaryStart();
    return resolveMediaStartSeconds({
      authoredStart: parseNumeric(el.getAttribute('data-start')),
      hostStart: scope.origin,
      hasAutoStart: el.hasAttribute('data-hf-auto-start'),
      basis: el.getAttribute(MEDIA_START_BASIS_ATTR),
      ordinaryStart,
    });
  };

  const cutRow = (row: RawRow, slots: readonly HostSlot[]): RawRow[] => {
    const kept = cutToHostSlots({ start: row.absStart, end: row.absEnd }, slots);
    if (kept.end === kept.start && row.absEnd > row.absStart) return [];
    const skipped = (kept.start - row.absStart) * (row.playbackRate ?? 1);
    const mediaStart = row.mediaStart === null ? null : roundMs(row.mediaStart + skipped);
    const inside = row.inside.flatMap((inner) => cutRow(inner, slots));
    return [{ ...row, absStart: roundMs(kept.start), absEnd: roundMs(kept.end), mediaStart, inside }];
  };

  const readSubComposition = (
    src: string,
    parent: Scope,
    origin: number,
    slots: readonly HostSlot[],
  ): RawRow[] => {
    const resolved = resolveVirtualPath(parent.dir, src) ?? normalizeVirtualPath(src);
    const subHtml = project.readText(resolved);
    if (subHtml === null) return [];
    const subDoc = parseHTMLContent(subHtml);
    const template = subDoc.querySelector('template') as HTMLTemplateElement | null;
    const subRoot = (template?.content ?? subDoc).querySelector('[data-composition-id]');
    if (!subRoot) return [];
    const subScope: Scope = {
      doc: subDoc,
      dir: virtualDirname(resolved),
      file: resolved,
      origin,
      startCache: new Map(),
    };
    const subRows = topLevelElements(toDomStructureNode(subRoot)).map((node) => describeRow(subScope, node, 1));
    return subRows
      .flatMap((row) => cutRow(row, slots))
      .sort((a, b) => a.absStart - b.absStart);
  };

  const describeRow = (scope: Scope, node: DomStructureNode, depth: number): RawRow => {
    const { el } = node;
    const start = resolveReferencedStart(scope.doc, el, scope.startCache, new Set());
    const authored = resolveReferencedDuration(scope.doc, el, scope.startCache, new Set());
    const hostSrc = el.getAttribute('data-composition-src');
    const absStart = mainTimelineStart(scope, el, start);
    const slots: HostSlot[] =
      hostInPointSeconds(el) > 0 ? [{ start: absStart, end: absStart + (authored ?? Infinity) }] : [];
    const children =
      hostSrc && depth === 0
        ? readSubComposition(hostSrc, scope, compositionOriginSeconds(absStart, el), slots)
        : [];
    const inside = isSubCompositionHost(node)
      ? []
      : topLevelElements(node).map((inner) => describeRow(scope, inner, depth));

    const kind = el.tagName.toLowerCase();
    let duration = 0;
    let durationSource: MediaDurationSource | 'inner' | null = null;
    let pendingReason: string | null = null;

    if (MEDIA_TAG_RE.test(kind)) {
      const getAttr = (name: string) => el.getAttribute(name);
      const mediaStart = readMediaOffsetSeconds(getAttr);
      const playbackRate = readPlaybackRate(getAttr);
      const unprobed = resolveMediaDuration({
        tag: kind as MediaTag,
        authoredDurationSeconds: authored,
        mediaStartSeconds: mediaStart,
        playbackRate,
        sourceDurationSeconds: null,
      });
      if (unprobed.source !== 'pending') {
        duration = unprobed.seconds ?? 0;
        durationSource = unprobed.source;
      } else {
        const probe = measureMediaDuration(scope, el);
        const resolved = resolveMediaDuration({
          tag: kind as MediaTag,
          authoredDurationSeconds: authored,
          mediaStartSeconds: mediaStart,
          playbackRate,
          sourceDurationSeconds: probe.seconds,
        });
        duration = resolved.seconds ?? 0;
        durationSource = resolved.source;
        pendingReason = resolved.source === 'pending' ? (probe.reason ?? resolved.reason ?? null) : null;
      }
    } else if (authored !== null) {
      duration = authored;
      durationSource = 'authored';
    } else if (children.length > 0) {
      duration = children.reduce((max, c) => Math.max(max, c.end), 0);
      durationSource = 'inner';
    }

    const rate = parseNumeric(el.getAttribute('data-playback-rate'));
    return {
      id: el.id || el.getAttribute('data-composition-id') || kind,
      kind,
      trackKind: trackKindOf(node).kind,
      start,
      duration,
      end: start + duration,
      absStart: roundMs(absStart),
      absEnd: roundMs(absStart + duration),
      file: scope.file,
      trackIndex: parseNumeric(el.getAttribute('data-track-index')) ?? 0,
      src: el.getAttribute('src') ?? hostSrc,
      sourceFile: hostSrc,
      volume: parseNumeric(el.getAttribute('data-volume')),
      playbackRate: rate === 1 ? null : rate,
      durationAuthored: authored !== null,
      durationSource,
      pendingReason,
      elementId: el.id || null,
      hfId: el.getAttribute('data-hf-id'),
      mediaStart: /^(?:video|audio)$/.test(kind) ? readMediaOffsetSeconds((name) => el.getAttribute(name)) : null,
      children,
      inside,
    };
  };

  const rootScope: Scope = {
    doc: rootDoc,
    dir: virtualDirname(normalizedEntry),
    file: normalizedEntry,
    origin: 0,
    startCache: new Map(),
  };

  const topRows = rootEl
    ? topLevelElements(toDomStructureNode(rootEl))
        .map((node) => describeRow(rootScope, node, 0))
        .sort((a, b) => a.absStart - b.absStart)
    : [];

  // Flatten rows into ordered tracks matching `hyperframes timeline --json`
  const entries: Array<{ clip: RawRow; host: RawRow | null; parent: RawRow | null }> = [];
  const collect = (clip: RawRow, host: RawRow | null, parent: RawRow | null) => {
    entries.push({ clip, host, parent });
    for (const inner of clip.inside) collect(inner, host, clip);
    for (const child of clip.children) collect(child, clip, null);
  };
  for (const row of topRows) collect(row, null, null);

  const fileIdCounts = new Map<string, Map<string, number>>();
  for (const { clip } of entries) {
    if (!clip.elementId) continue;
    const ids = fileIdCounts.get(clip.file) ?? new Map<string, number>();
    ids.set(clip.elementId, (ids.get(clip.elementId) ?? 0) + 1);
    fileIdCounts.set(clip.file, ids);
  }

  const tracks: TimelineTrack[] = [];
  for (const kind of TRACK_ORDER) {
    const kindEntries = entries
      .filter((entry) => entry.clip.trackKind === kind)
      .sort((a, b) => a.clip.absStart - b.clip.absStart);
    if (kindEntries.length === 0) continue;

    const rows: TimelineRow[] = kindEntries.map(({ clip, host, parent }, index) => {
      const uniqueId = Boolean(clip.elementId && fileIdCounts.get(clip.file)?.get(clip.elementId) === 1);
      const ref = uniqueId ? `#${clip.elementId}` : clip.hfId ? `hf:${clip.hfId}` : `${kind}/${index}`;
      const warnings: string[] = [];
      if (!uniqueId && !clip.hfId) {
        warnings.push('row has no stable name; add id="<name>" to the element in this file');
      }
      if (
        parent &&
        clip.kind !== 'audio' &&
        clip.absEnd > clip.absStart &&
        parent.absEnd > parent.absStart &&
        !(clip.absEnd > parent.absStart && clip.absStart < parent.absEnd)
      ) {
        warnings.push(
          `never visible: plays ${clip.absStart}-${clip.absEnd}s, outside parent ${parent.absStart}-${parent.absEnd}s`,
        );
      }
      return {
        id: clip.id,
        kind: clip.kind,
        trackKind: clip.trackKind,
        start: clip.start,
        duration: clip.duration,
        end: clip.end,
        absStart: clip.absStart,
        absEnd: clip.absEnd,
        file: clip.file,
        trackIndex: clip.trackIndex,
        src: clip.src,
        sourceFile: clip.sourceFile,
        volume: clip.volume,
        playbackRate: clip.playbackRate,
        durationAuthored: clip.durationAuthored,
        durationSource: clip.durationSource,
        pendingReason: clip.pendingReason,
        elementId: clip.elementId,
        hfId: clip.hfId,
        mediaStart: clip.mediaStart,
        ref,
        index,
        nested: host !== null,
        host: host ? host.id : null,
        warnings,
      };
    });
    tracks.push({ kind, rows });
  }

  const declared = parseNumeric(rootEl?.getAttribute('data-duration') ?? null);
  const duration = declared ?? topRows.reduce((max, row) => Math.max(max, row.end), 0);
  return { duration, fps, tracks };
}
