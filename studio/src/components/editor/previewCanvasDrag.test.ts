// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import { PREVIEW_CANVAS_DRAG } from "../../../../src/studio/engine/preview-canvas-drag";

const originalHash = "a".repeat(64);

function createScene() {
  const elements = ["one", "two"].map(id => {
    const element = document.createElement("div");
    element.id = id;
    document.body.append(element);
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() =>
      new DOMRect(parseFloat(element.style.left) || 0, parseFloat(element.style.top) || 0, 20, 10));
    return element;
  });
  vi.spyOn(document, "elementFromPoint").mockImplementation(x => elements[x < 50 ? 0 : 1]!);
  // Execute the exact child-frame script with deterministic layout measurements.
  const dispatch = new Function("document", "getComputedStyle", "HTMLElement", "sourceVersions", "describe",
    "innerWidth", "innerHeight", PREVIEW_CANVAS_DRAG + "\nreturn canvasDrag;")(
    document, (el: HTMLElement) => ({ position: el.style.position || "static", left: el.style.left, top: el.style.top }),
    HTMLElement, { "one.html": originalHash, "two.html": originalHash },
    (el: HTMLElement) => ({ sourceFile: el.id + ".html", elementId: el.id, geometry: el.getBoundingClientRect(),
      viewport: { width: 100, height: 100 } }), 100, 100,
  );
  return { one: elements[0]!, two: elements[1]!,
    gesture: (phase: string, gestureId: string, fields: Record<string, unknown> = {}) =>
      dispatch({ phase, gestureId, x: 0, y: 0, dx: 0.25, dy: 0.5, ...fields }) };
}

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it("holds the released layer, allows an unrelated source to move, and waits for a fresh digest on the saved source", () => {
  const { one, two, gesture } = createScene();
  expect(gesture("start", "first")).toBeTruthy();
  expect(gesture("finish", "first")).toMatchObject({ sourceFile: "one.html", sha256: originalHash, left: 25, top: 50 });
  expect(one.style.left).toBe("25px");
  expect(gesture("start", "same-source")).toBeNull();
  expect(gesture("start", "second", { x: 1 })).toBeTruthy();
  gesture("move", "second");
  gesture("commit", "first", { changed: true });
  gesture("cancel", "first");
  expect(one.style.left).toBe("25px");
  expect(two.style.left).toBe("25px");
  gesture("cancel", "second");
  expect(two.style.left).toBe("");
  expect(gesture("start", "stale-source")).toBeNull();
});

it("rolls back only properties still owned by the failed gesture and permits a retry", () => {
  const { one, gesture } = createScene();
  one.style.setProperty("top", "4px", "important");
  one.style.position = "absolute";
  gesture("start", "first");
  gesture("finish", "first");
  one.style.left = "100px";
  gesture("cancel", "first");
  expect(one.style.left).toBe("100px");
  expect(one.style.top).toBe("4px");
  expect(one.style.getPropertyPriority("top")).toBe("important");
  expect(gesture("start", "retry")).toBeTruthy();
  expect(gesture("finish", "retry")).toMatchObject({ left: 125, top: 54, sha256: originalHash });
  gesture("cancel", "first");
  expect(one.style.left).toBe("125px");
  gesture("commit", "retry", { changed: false });
  expect(gesture("start", "after-noop")).toBeTruthy();
});
