import { batchElementUpdates } from "../player/store/batchElementUpdates";
import { usePlayerStore, type TimelineElement } from "../player/store/playerStore";
import { createPreviewAdapter } from "../player/lib/previewAdapter";
import { setPreviewMediaMuted } from "../player/lib/timelineIframeHelpers";
import { findTimelineElementInIframe } from "./timelineEditingHelpers";
import { applySoftReloadFinalization } from "../utils/gsapSoftReload";

const fields = { "data-hidden": "hidden", "data-timeline-locked": "timelineLocked", muted: "muted" } as const;
export type TimelineControl = keyof typeof fields;
type Step = { enabled: boolean; saved?: boolean };
type Pending = { base: boolean; steps: Step[] };
const pending = new Map<string, Pending>();

/** Project a whole gesture onto the timeline and its mounted preview. Only the
 * owning steps settle, so a slow first receipt cannot reverse a second click. */
export function projectTimelineControl(
  projectId: string, path: string | null, frame: HTMLIFrameElement | null, attr: TimelineControl,
  edits: readonly { element: TimelineElement; enabled: boolean }[],
): (saved: boolean) => void {
  const field = fields[attr];
  const store = usePlayerStore.getState();
  const originalProject = store.timelineProjectId;
  const frameSrc = frame?.src;
  const displayed = new Map(store.elements.map(el => [el.key ?? el.id, el]));
  const entries = edits.map(({ element, enabled }) => {
    const key = element.key ?? element.id;
    const sourceFile = element.sourceFile || path || "index.html";
    const address = [projectId, sourceFile, key, attr].join("\0");
    let state = pending.get(address);
    if (!state) {
      state = { base: !!(displayed.get(key) ?? element)[field], steps: [] };
      pending.set(address, state);
    }
    const step: Step = { enabled };
    state.steps.push(step);
    return { key, element, address, state, step, sourceFile };
  });

  function paint(saved?: boolean) {
    const current = usePlayerStore.getState();
    const active = current.timelineProjectId === originalProject;
    const preview = active && frame?.src === frameSrc ? frame : null;
    const changes: { hfId?: string; elementId?: string; sourceFile: string; enabled: boolean; settled: boolean }[] = [];
    let domChanged = false;
    batchElementUpdates(() => {
      for (const { key, element, address, state, step, sourceFile } of entries) {
        if (saved !== undefined) {
          step.saved = saved;
          while (state.steps[0]?.saved !== undefined) {
            const settled = state.steps.shift()!;
            if (settled.saved) state.base = settled.enabled;
          }
        }
        const remaining = state.steps.filter(s => s.saved !== false);
        const enabled = remaining.at(-1)?.enabled ?? state.base;
        if (!state.steps.length) pending.delete(address);
        if (!active) continue;
        current.updateElement(key, { [field]: enabled });
        const node = findTimelineElementInIframe(preview, element, path);
        if (node && node.hasAttribute(attr) !== enabled) {
          node.toggleAttribute(attr, enabled);
          domChanged = true;
        }
        changes.push({ hfId: element.hfId, elementId: element.domId, sourceFile, enabled, settled: !state.steps.length });
      }
    });
    if (!preview || !changes.length) return;
    if (!preview.contentDocument) createPreviewAdapter({ iframe: preview }).send("timeline-controls", { attr, changes });
    else if ((domChanged || saved === undefined) && attr === "data-hidden") applySoftReloadFinalization(preview, current.currentTime);
    if (attr === "muted") setPreviewMediaMuted(preview, current.audioMuted);
  }
  paint();
  return paint;
}
