import { planSpeedChanges } from "../../../../packages/edit-core/clip-speed";
import type { TimelineElement } from '../../player/store/playerStore';
import { sameCompositionScope } from '../../player/store/timelineElement';
import { mainVisualTrack } from '../../player/components/timelineLinkage';
import { buildPatchTarget } from '../../hooks/timelineEditingHelpers';
import { readAttributeByTarget, findTagByTarget, type PatchTarget } from '../../utils/sourcePatcher';
import { scanHtmlOpeningTags } from '@hyperframes/parsers';
import { isCompositionTemplate } from '@hyperframes/parsers/hf-ids';
import { parseSavedSource } from '../../utils/authoredSource';
import { rootCompositionDurationOf } from '../../utils/rootDuration';
import { setCompositionDurationToContent } from '../../utils/timelineAssetDrop';
import { furthestClipEndFromDocument } from '../../player/lib/timelineElementHelpers';

type Row = { element: TimelineElement; target: PatchTarget; start: number; duration: number; rate: number; locked: boolean };
export interface SpeedTimingPlan { apply: (html: string) => string; limited: boolean }
const key = (el: TimelineElement) => el.key ?? el.id;

/** Inspect composition templates as mounted markup without reserializing the authored source. */
export function parseClipSpeedSource(html: string): Document {
  const doc = parseSavedSource(html);
  const unwrap = (root: ParentNode) => {
    for (const template of Array.from(root.querySelectorAll('template')).filter(isCompositionTemplate)) {
      unwrap(template.content);
      template.replaceWith(template.content);
    }
  };
  unwrap(doc);
  return doc;
}

/** Preserve the selected source range, and plan every timing write before any mutation. */
export function planClipSpeedTiming(
  html: string,
  self: TimelineElement,
  elements: readonly TimelineElement[],
  memberKeys: ReadonlySet<string>,
  rate: number,
  ripple: boolean,
  linkage: boolean,
): SpeedTimingPlan {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Speed must be greater than zero');
  const scoped = elements.filter(el => sameCompositionScope(el, self));
  const selected = scoped.filter(el => memberKeys.has(key(el)));
  const main = mainVisualTrack(scoped);
  const ripplesMain = ripple && selected.some(el => el.tag !== 'audio' && el.track === main);
  const rows: Row[] = scoped.flatMap(element => {
    // Untimed root text spans the composition implicitly and never moves with media edits.
    if (element.implicitTextTiming) return [];
    const target = buildPatchTarget(element);
    if (!target) return [];
    const attr = (name: string) => readAttributeByTarget(html, target, `data-${name}`);
    const rawStart = attr('start'), rawDuration = attr('duration');
    // Unrelated runtime-derived rows need no authored window. Members and any
    // lane that can collide or move must still be resolved before saving.
    if (rawStart === undefined || rawDuration === undefined) {
      const needed = memberKeys.has(key(element)) || selected.some(el =>
        el.track === element.track && (el.tag === 'audio') === (element.tag === 'audio')) ||
        (ripplesMain && element.tag !== 'audio' && (element.track === main || linkage));
      if (!needed) return [];
      throw new Error('Clip timing changed or is unavailable. Reload the composition and try again');
    }
    const start = Number(rawStart), duration = Number(rawDuration), oldRate = Number(attr('playback-rate') ?? 1);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(oldRate) || oldRate <= 0)
      throw new Error('Clip timing is invalid');
    return [{ element, target, start, duration, rate: oldRate,
      locked: element.timelineLocked === true || scanHtmlOpeningTags(findTagByTarget(html, target)?.tag ?? '')[0]
        ?.attributes.some(attribute => attribute.name === 'data-timeline-locked') === true }];
  });
  const plan = planSpeedChanges(rows, memberKeys, main, rate, ripple, linkage);
  return { limited: plan.limited, apply: source => {
    source = plan.apply(source);
    // Other composition scopes and authored clips outside the visible lane list still count.
    const doc = parseClipSpeedSource(source);
    const end = furthestClipEndFromDocument(doc);
    return setCompositionDurationToContent(source, end, rootCompositionDurationOf(doc));
  } };
}
