// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IsolatedCanvasOverlay } from "./IsolatedCanvasOverlay";
import { PREVIEW_BRIDGE_SOURCE, type PreviewBridgeMessage } from "../../player/lib/previewAdapter";
import { announcePreviewPromoted } from "../../player/sceneSwap";

const state = vi.hoisted(() => ({
  previewIframeRef: { current: null as HTMLIFrameElement | null },
  compositionRect: { left: 10, top: 10, width: 200, height: 100 },
  commitDomEditPatchBatches: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock("../../contexts/DomEditContext", () => ({ useDomEditActionsContext: () => state }));
vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ ...state, projectId: "project-1", writeBlockedReason: null }),
}));
vi.mock("./PreviewOverlayProvider", () => ({ usePreviewOverlayContext: () => ({ state }) }));
vi.mock("../../i18n/I18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let host: HTMLElement, frame: HTMLIFrameElement, root: Root, canvas: HTMLElement;
let messages: PreviewBridgeMessage[];
const origin = "https://preview.test";
const result = { sourceFile: "compositions/title.html", sha256: "a".repeat(64),
  elementId: "title", left: 12, top: 34, makeRelative: true };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const meta = document.createElement("meta");
  meta.name = "openmotion-preview-origin";
  meta.content = origin;
  document.head.append(meta);
  host = document.createElement("main");
  frame = document.createElement("iframe");
  Object.defineProperty(frame, "contentWindow", { value: { postMessage: vi.fn() } });
  document.body.append(host);
  // Keep the test frame local while the adapter reads its production scoped URL.
  vi.spyOn(frame, "getAttribute").mockReturnValue(origin + "/api/projects/project-1/preview?pt=one");
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10, 200, 100));
  state.previewIframeRef.current = frame;
  messages = [];
  state.compositionRect = { left: 10, top: 10, width: 200, height: 100 };
  state.commitDomEditPatchBatches.mockReset().mockResolvedValue({ durable: true, changed: true });
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(message => { messages.push(message); });
  root = createRoot(host);
  act(() => root.render(<IsolatedCanvasOverlay />));
  canvas = host.querySelector("div")!;
  canvas.setPointerCapture = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  state.previewIframeRef.current = null;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

function pointer(type: string, x: number) {
  act(() => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: 60,
  })));
}

async function reply(phase: string, result: unknown) {
  const request = messages.findLast(message => message.phase === phase)!;
  expect(request).toBeDefined();
  await act(async () => {
    const event = new MessageEvent("message", { origin, source: frame.contentWindow,
      data: { ...request, source: PREVIEW_BRIDGE_SOURCE, type: "response", ok: true, result },
    });
    expect(event.source === frame.contentWindow).toBe(true);
    expect(event.origin).toBe(origin);
    window.dispatchEvent(event);
  });
}

it("captures a scaled drag, commits once on release and uses the shown file version", async () => {
  pointer("pointerdown", 60);
  expect(messages[0]).toMatchObject({ phase: "start", x: 0.25, y: 0.5 });
  pointer("pointermove", 76);
  pointer("pointermove", 90);
  expect(state.commitDomEditPatchBatches).not.toHaveBeenCalled();
  expect(messages.at(-1)).toMatchObject({ phase: "move", dx: 0.15, dy: 0 });
  pointer("pointerup", 90);
  pointer("lostpointercapture", 90);
  await reply("start", null);
  await reply("finish", result);
  expect(state.commitDomEditPatchBatches).toHaveBeenCalledExactlyOnceWith([{
    box: expect.objectContaining({ left: 12, top: 34, makeRelative: true }),
    sourceFile: result.sourceFile, ifMatch: '"sha256:' + result.sha256 + '"',
    patches: [{ target: { id: "title" }, operations: [
      { type: "inline-style", property: "position", value: "relative" },
      { type: "inline-style", property: "left", value: "12px" },
      { type: "inline-style", property: "top", value: "34px" },
    ] }],
  }], { label: "Move layer", coalesceKey: messages[0]?.gestureId });
  expect(messages.at(-1)).toMatchObject({ phase: "commit", gestureId: messages[0]?.gestureId, changed: true });
});

it.each(["pointercancel", "lostpointercapture"])("cancels before release on %s", async type => {
  pointer("pointerdown", 60);
  pointer("pointermove", 90);
  pointer(type, 90);
  pointer("pointerup", 90);
  await reply("start", null);
  expect(messages.map(message => message.phase)).toEqual(["start", "move", "cancel"]);
  expect(state.commitDomEditPatchBatches).not.toHaveBeenCalled();
});

it.each(["replacement", "navigation"])("ignores a late finish after frame %s", async change => {
  pointer("pointerdown", 60);
  pointer("pointerup", 90);
  if (change === "replacement") state.previewIframeRef.current = document.createElement("iframe");
  else vi.mocked(frame.getAttribute).mockReturnValue(origin + "/api/projects/project-1/preview?pt=two");
  await reply("start", null);
  await reply("finish", result);
  expect(state.commitDomEditPatchBatches).not.toHaveBeenCalled();
});

async function openText() {
  act(() => canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 60, clientY: 60 })));
  const pick = messages.findLast(message => message.type === "inline-text" && message.phase === "pick")!;
  expect(pick).toMatchObject({ x: 0.25, y: 0.5 });
  await reply("pick", result);
  expect(messages.at(-1)).toMatchObject({ type: "inline-text", phase: "open", editId: pick.editId });
  return pick;
}

function finishText(pick: PreviewBridgeMessage, override: Record<string, unknown> = {}) {
  window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin,
    data: { ...pick, source: PREVIEW_BRIDGE_SOURCE, type: "inline-text-finished",
      changed: true, html: "<b>Updated</b>", ...override },
  }));
}

it("persists one text edit against the file and element picked by the user", async () => {
  state.commitDomEditPatchBatches.mockResolvedValue({ changed: true, durable: true });
  const pick = await openText();
  await act(async () => {
    // A frame may supply the new markup. It cannot pick another write target on finish.
    finishText(pick, { sourceFile: "index.html", elementId: "other" });
    finishText(pick);
  });
  expect(state.commitDomEditPatchBatches).toHaveBeenCalledExactlyOnceWith([{
    sourceFile: result.sourceFile, ifMatch: '"sha256:' + result.sha256 + '"',
    patches: [{ target: { id: result.elementId }, operations: [{ type: "rich-text", property: "", value: "<b>Updated</b>" }] }],
  }], { label: "Edit text", coalesceKey: pick.editId });
  expect(messages.at(-1)).toMatchObject({ phase: "commit", editId: pick.editId });
});

it("never saves an unrequested text edit or a completion from a replaced document", async () => {
  const pick = await openText();
  await act(async () => finishText(pick, { editId: "unrequested" }));
  vi.mocked(frame.getAttribute).mockReturnValue(origin + "/api/projects/project-1/preview?pt=two");
  await act(async () => finishText(pick));
  expect(state.commitDomEditPatchBatches).not.toHaveBeenCalled();
});

it("outlines only the verified frame's layer selection at its scaled coordinates", () => {
  const selection = { geometry: { x: 12, y: 15, width: 32, height: 20 }, viewport: { width: 100, height: 50 } };
  const deliver = (token: string) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin, source: frame.contentWindow, data: {
      version: 1, source: PREVIEW_BRIDGE_SOURCE, type: "select-element", projectId: "project-1", token,
      layerKey: "doc:1", selection,
    }}));
  });
  deliver("stale");
  expect(canvas.firstElementChild).toBeNull();
  deliver("one");
  const style = (canvas.firstElementChild as HTMLElement).style;
  expect([style.left, style.top, style.width, style.height]).toEqual(["34px", "40px", "64px", "40px"]);
  state.compositionRect = { left: 30, top: 20, width: 300, height: 150 };
  act(() => root.render(<IsolatedCanvasOverlay />));
  expect([style.left, style.top, style.width, style.height]).toEqual(["66px", "65px", "96px", "60px"]);
  expect(messages).toHaveLength(0);
  act(() => frame.dispatchEvent(new Event("load")));
  expect(canvas.firstElementChild).toBeNull();
});

it("shows the released bounds even when the initial pick arrives after pointerup", async () => {
  pointer("pointerdown", 60);
  pointer("pointermove", 72);
  pointer("pointerup", 90);
  await reply("start", { geometry: { x: 1, y: 2, width: 20, height: 10 }, viewport: { width: 200, height: 100 } });
  expect((canvas.firstElementChild as HTMLElement).style.left).toBe("41px");
  await reply("finish", result);
});

it.each(["rejection", "unmatched"])("rolls back only the failed gesture on %s", async outcome => {
  const saving = Promise.withResolvers<{ durable: boolean; changed: boolean }>();
  state.commitDomEditPatchBatches.mockReturnValueOnce(saving.promise);
  pointer("pointerdown", 60);
  pointer("pointerup", 90);
  await reply("start", null);
  await reply("finish", result);
  const first = messages[0]?.gestureId;
  expect(messages.map(message => message.phase)).toEqual(["start", "finish"]);

  pointer("pointerdown", 70);
  const second = messages.at(-1)?.gestureId;
  expect(second).not.toEqual(first);
  await reply("start", { geometry: { x: 1, y: 2, width: 20, height: 10 }, viewport: { width: 200, height: 100 } });
  await act(async () => {
    if (outcome === "rejection") saving.reject(new Error("save failed"));
    else saving.resolve({ durable: false, changed: false });
  });
  expect(messages.at(-1)).toMatchObject({ phase: "cancel", gestureId: first });
  expect(canvas.firstElementChild).not.toBeNull();
  pointer("pointermove", 80);
  expect(messages.at(-1)).toMatchObject({ phase: "move", gestureId: second });
});

it("cancels a finish with an invalid write target", async () => {
  pointer("pointerdown", 60);
  pointer("pointerup", 90);
  await reply("start", null);
  await reply("finish", { ...result, sourceFile: "../index.html" });
  expect(state.commitDomEditPatchBatches).not.toHaveBeenCalled();
  expect(messages.at(-1)).toMatchObject({ phase: "cancel", gestureId: messages[0]?.gestureId });
});

it("detaches the retired iframe load listener when a shadow preview is promoted", () => {
  const removeSpy = vi.spyOn(frame, "removeEventListener");
  pointer("pointerdown", 60);
  pointer("pointerup", 60);
  const replacement = document.createElement("iframe");
  act(() => {
    announcePreviewPromoted({ retired: frame, live: replacement });
  });
  expect(removeSpy).toHaveBeenCalledWith("load", expect.any(Function));
});
