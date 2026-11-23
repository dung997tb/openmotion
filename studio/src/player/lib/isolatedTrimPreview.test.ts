// @vitest-environment jsdom
import { expect, it } from "vitest";
import { applyHeldTrims, holdIsolatedTrims } from "./isolatedTrimPreview";
import type { TimelineElement } from "../store/playerStore";

it("shows the release position through stale frame reports and accepts a new preview or a failed write", () => {
  const frame = document.createElement("iframe");
  frame.src = "https://preview.example/api/projects/p/preview/?pt=first";
  const element = { key: "intro#music", id: "music", start: 0, duration: 16 } as TimelineElement;
  const update = (duration: number) => holdIsolatedTrims(frame, [{ element, start: 0, duration }]);
  const releaseFirst = update(10);
  const releaseSecond = update(7);
  releaseFirst();
  // The clip's timing is optimistic. Other frame fields continue to reflect playback.
  expect(applyHeldTrims(frame, [{ ...element, muted: true, playbackStart: 4 }])[0]).toMatchObject({duration: 7, muted: true, playbackStart: 4});
  releaseSecond();
  expect(applyHeldTrims(frame, [element])[0]).toBe(element);
  update(10);
  frame.src = frame.src.replace("first", "second");
  expect(applyHeldTrims(frame, [element])[0]).toBe(element);
});
