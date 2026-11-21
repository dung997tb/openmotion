// @vitest-environment happy-dom
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { patchTimelineChangesInSource } from "../../hooks/timelineEditingHelpers";
import { applyPatchByTarget } from "../../utils/sourcePatcher";
import { expect, it, vi } from "vitest";
import { isCurrentIsolatedManifest } from "../lib/isolatedTimelineManifest";
import { PREVIEW_BRIDGE_SOURCE, PREVIEW_BRIDGE_VERSION } from "../lib/previewAdapter";
import { buildTimelineElementsFromClips } from "./timelineSyncHydration";
import { createPreviewMessageHandler, type ClipManifestMessage } from "./previewMessageRouter";

it("keeps authored identity across runtime notifications and only accepts it from the current frame", () => {
  const origin = "https://preview.test";
  const child = { postMessage: vi.fn() };
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", { value: child });
  iframe.src = origin + "/api/projects/p/preview?pt=active";
  const process = vi.fn<(message: ClipManifestMessage) => void>();
  const route = createPreviewMessageHandler({ iframeRef: { current: iframe },
    processTimelineMessageRef: { current: process }, enrichMissingCompositionsRef: { current: vi.fn() },
    lastTimelineMessageRef: { current: 0 }, getAdapter: () => null, syncTimelineElements: vi.fn() });
  const clip = { id: "voice", kind: "audio", tagName: "audio", start: 0, duration: 2, track: 1 };
  const send = (data: unknown) => route(new MessageEvent("message", { origin, source: iframe.contentWindow, data }));
  send({ source: "hf-preview", type: "timeline", clips: [clip], durationInFrames: 60 });
  expect(process).not.toHaveBeenCalled();
  expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "handshake", timelineOnly: true }), origin);
  const payload = { source: PREVIEW_BRIDGE_SOURCE, version: PREVIEW_BRIDGE_VERSION, type: "timeline-state", projectId: "p",
    clips: [{ ...clip, authored: { sourceFile: "parts/scene.html", hfId: "source-voice", hidden: true, timelineLocked: true, muted: true } }],
    durationInFrames: 60 };
  send({ ...payload, token: "older" });
  expect(process).not.toHaveBeenCalled();
  send({ ...payload, token: "active" });
  const clips = process.mock.calls[0]![0].clips;
  expect(isCurrentIsolatedManifest(iframe, clips)).toBe(true);
  expect(buildTimelineElementsFromClips(clips, null)[0]).toMatchObject({
    sourceFile: "parts/scene.html", hfId: "source-voice", selector: '[data-hf-id="source-voice"]',
    timelineLocked: true, hidden: true, muted: true,
  });
  iframe.src = origin + "/api/projects/p/preview?pt=replacement";
  expect(isCurrentIsolatedManifest(iframe, clips)).toBe(false);
});

it("patches an anonymous legacy clip using exactly the same hf-id as its preview", () => {
  const source = '<html><body><img data-start="0" data-duration="4"></body></html>';
  const hfId = ensureHfIds(source).match(/<img[^>]*data-hf-id="([^"]+)"/)?.[1];
  expect(hfId).toBeTruthy();
  const element = { id: "runtime-clip", hfId, tag: "img", start: 0, duration: 4, track: 0 };
  const patched = patchTimelineChangesInSource(source, "index.html", [{ element,
    buildPatches: (current, target) => applyPatchByTarget(current, target, { type: "attribute", property: "duration", value: "2" }),
  }]);
  expect(patched).toContain('data-duration="2"');
  expect(patched).toContain(`data-hf-id="${hfId}"`);
  expect(patchTimelineChangesInSource(source, "index.html", [{ element, buildPatches: current => current }])).toBe(source);
});
