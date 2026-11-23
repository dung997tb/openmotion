import { deleteCanvasSelection } from "./element-deletion.ts";
import { planArcDrag } from "./arc-drag.ts";
import { applyPatchByTarget } from "./source-patcher.ts";
import { resolveTweenStart, resolveTweenDuration } from "./playhead-edit.ts";
import { canvasBoxOperations } from "./canvas-box.ts";
import {
  findTargetElement,
  parseSourceDocument,
  patchElementInHtml,
} from "@hyperframes/studio-server/source-mutation";
import { findUnsafeDomPatchValues } from "@hyperframes/studio-server/finite-mutation";
import {
  parseGsapAnimationsFromHtml,
  applyGsapMutationsInMemory,
  validateGsapMutationPayload,
} from "./gsap-mutations.ts";
import {
  checkCanvasTargets,
  groupCanvasElements,
  duplicateElementInHtml,
  ensureStudioFontFaceCss,
  isStudioFontFaceCss,
  unwrapGroupWithGsapCleanup,
} from "./canvas-source.ts";
import { writePlainMove } from "./canvas-position.ts";
import type { CanvasCommand, CanvasElementPatch } from "./canvas-schema.ts";
export type { CanvasCommand } from "./canvas-schema.ts";

export function patchCanvasElement(
  source: string,
  patch: CanvasElementPatch,
  takenIds?: ReadonlySet<string>,
) {
  checkCanvasTargets(source, [patch.target], { operations: patch.operations });
  if (findUnsafeDomPatchValues(patch.operations).length) throw new Error("Invalid layout value.");
  const result = patchElementInHtml(source, patch.target, patch.operations, takenIds);
  // The SDK DOM patcher accepts HTML nodes. SVG presentation styles use the same authored-tag writer as Studio.
  if (
    !result.matched &&
    patch.target.hfId &&
    patch.operations.every((op) => op.type === "inline-style" && !op.childSelector)
  ) {
    const el = findTargetElement(parseSourceDocument(source).document, patch.target);
    if (el?.namespaceURI === "http://www.w3.org/2000/svg") {
      result.html = patch.operations.reduce(
        (html, op) =>
          applyPatchByTarget(html, patch.target, {
            ...op,
            type: "inline-style",
          }),
        source,
      );
      result.matched = true;
    }
  }
  if (patch.fontFaceCss !== undefined) {
    if (!isStudioFontFaceCss(patch.fontFaceCss)) throw new Error("Invalid imported font CSS.");
    if (result.matched) result.html = ensureStudioFontFaceCss(result.html, patch.fontFaceCss);
  }
  return result;
}

export function applyCanvasCommand(source: string, command: CanvasCommand): string {
  switch (command.kind) {
    case "setCanvasBox":
      return applyCanvasCommand(source, {
        kind: "editElements",
        patches: [
          {
            target: command.target,
            operations: canvasBoxOperations(command.box),
          },
        ],
      });
    case "editElements": {
      let html = source;
      for (const patch of command.patches) {
        const result = patchCanvasElement(html, patch);
        if (!result.matched) throw new Error("Canvas element or child was not found.");
        html = result.html;
      }
      return html;
    }
    case "moveCanvasElement": {
      checkCanvasTargets(source, [command.target]);
      if (!Number.isFinite(command.x) || !Number.isFinite(command.y))
        throw new Error("Invalid canvas position.");
      const { document } = parseSourceDocument(source);
      const el = findTargetElement(document, command.target) as HTMLElement | null;
      if (!el?.style || el.closest("[data-timeline-locked]"))
        throw new Error("Choose an unlocked canvas element.");
      const animations = /<script\b/i.test(source) ? parseGsapAnimationsFromHtml(source).animations : [];
      const candidates = animations.filter((anim) => {
        if (anim.properties?.data === "hf-hold") return false;
        const channels = [
          anim.properties,
          anim.fromProperties,
          ...(anim.keyframes?.keyframes ?? []).map((k) => k.properties),
        ];
        if (
          !anim.arcPath?.enabled &&
          !channels.some(
            (props) =>
              props &&
              ["x", "y", "xPercent", "yPercent", "translate", "transform", "motionPath"].some(
                (key) => key in props,
              ),
          )
        )
          return false;
        if (anim.hasUnresolvedSelector || anim.hasPartialSelector)
          throw new Error("Cannot resolve the animated position target.");
        let hits: Element[];
        try {
          hits = Array.from((el.closest("template") ?? document).querySelectorAll(anim.targetSelector));
        } catch {
          throw new Error("Cannot resolve the animated position selector.");
        }
        if (!hits.includes(el)) return false;
        if (hits.length !== 1)
          throw new Error(
            "The position tween targets multiple elements. Choose the shared animation explicitly.",
          );
        return true;
      });
      if (candidates.length) {
        if (command.time === undefined)
          throw new Error("Specify the composition time for the animated layer.");
        const active = candidates.filter((anim) => {
          const start = resolveTweenStart(anim);
          return (
            start != null && start <= command.time! && command.time! <= start + resolveTweenDuration(anim)
          );
        });
        const owner = active.length === 1 ? active[0] : candidates.length === 1 ? candidates[0] : undefined;
        if (!owner)
          throw new Error("Multiple position tweens could own this move. Select the animation explicitly.");
        if (owner.arcPath?.enabled) {
          const mutation = planArcDrag(owner, command.time, {
            x: command.x,
            y: command.y,
          });
          if (!mutation) throw new Error("Cannot resolve the motion path at this composition time.");
          return applyCanvasCommand(source, {
            kind: "editAnimation",
            mutations: [mutation],
          });
        }
        if (owner.method === "set")
          return applyCanvasCommand(source, {
            kind: "editAnimation",
            mutations: [
              {
                type: "update-properties",
                animationId: owner.id,
                properties: { x: command.x, y: command.y },
              },
            ],
          });
        return applyCanvasCommand(source, {
          kind: "setAnimatedValues",
          animationId: owner.id,
          at: { time: command.time },
          samples: command.samples,
          values: { x: command.x, y: command.y },
        });
      }
      if (command.staticBox)
        return applyCanvasCommand(source, {
          kind: "setCanvasBox",
          target: command.target,
          box: command.staticBox,
        });
      const operations = writePlainMove(el, command);
      return applyCanvasCommand(source, {
        kind: "editElements",
        patches: [{ target: command.target, operations }],
      });
    }
    case "setAnimatedValues":
      return applyCanvasCommand(source, {
        kind: "editAnimation",
        mutations: [
          {
            type: "set-animated-values",
            animationId: command.animationId,
            at: command.at,
            samples: command.samples,
            values: command.values,
          },
        ],
      });
    case "editAnimation": {
      for (const mutation of command.mutations) {
        const valid = validateGsapMutationPayload(mutation);
        if (!valid.ok) throw new Error(valid.error);
      }
      const result = applyGsapMutationsInMemory(source, command.mutations);
      if (!result.ok) throw new Error(result.error);
      return result.after;
    }
    case "deleteCanvasElements": {
      checkCanvasTargets(source, command.targets, {
        requireAll: true,
        subtree: true,
      });
      return deleteCanvasSelection(source, command.targets);
    }
    case "duplicateElement": {
      const result = duplicateElementInHtml(source, command.target, command);
      if (!result.matched) throw new Error("Canvas element was not found.");
      return result.html;
    }
    case "groupElements": {
      const result = groupCanvasElements(
        source,
        command.targets,
        command.groupId,
        command.bbox,
        command.rebases,
      );
      if (!result.matched) throw new Error(result.error || "Cannot group the selected elements.");
      return result.html;
    }
    case "ungroupElements": {
      const result = unwrapGroupWithGsapCleanup(source, command.target, command.childTracks);
      if (!result.unwrapped) throw new Error("Group was not found.");
      return result.html;
    }
  }
}
export function canvasCommandLabel(command: CanvasCommand): string {
  switch (command.kind) {
    case "setCanvasBox":
      return command.box.corner ? "Resize layer" : "Move layer";
    case "moveCanvasElement":
      return "Move layer";
    case "editElements":
      return "Edit layer properties";
    case "setAnimatedValues":
      return "Edit animated properties";
    case "editAnimation":
      return "Edit animation";
    case "groupElements":
      return "Group layers";
    case "ungroupElements":
      return "Ungroup layers";
    case "deleteCanvasElements":
      return command.targets.length === 1 ? "Delete layer" : "Delete layers";
    case "duplicateElement":
      return "Duplicate layer";
  }
}
