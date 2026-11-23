// @vitest-environment jsdom
import { expect, it } from "vitest";
import { applyHeldTimelineChanges, holdIsolatedTimelineChanges } from "./isolatedTimelineEdits";
import type { TimelineElement } from "../store/playerStore";

it("shows the release position through stale frame reports and accepts a new preview or a failed write", () => {
  const frame = document.createElement("iframe");
  frame.src = "https://preview.example/api/projects/p/preview/?pt=first";
  const element = { key: "intro#music", id: "music", start: 0, duration: 16 } as TimelineElement;
  const update = (duration: number) => holdIsolatedTimelineChanges(frame, [{ element, start: 0, duration }]);
  const releaseFirst = update(10);
  const releaseSecond = update(7);
  releaseFirst();
  // The clip's timing is optimistic. Other frame fields continue to reflect playback.
  expect(applyHeldTimelineChanges(frame, [{ ...element, muted: true, playbackStart: 4 }])[0]).toMatchObject({duration: 7, muted: true, playbackStart: 4});
  releaseSecond();
  expect(applyHeldTimelineChanges(frame, [element])[0]).toBe(element);
  update(10);
  frame.src = frame.src.replace("first", "second");
  expect(applyHeldTimelineChanges(frame, [element])[0]).toBe(element);
});

it("keeps the moved start and authored lane during old-frame reports, including after a trim", () => {
  const frame = document.createElement("iframe");
  frame.src = "https://preview.example/api/projects/p/preview/?pt=first";
  const clip = { key: "music", id: "music", start: 2, duration: 8, playbackStart: 3, track: 7 } as TimelineElement;
  holdIsolatedTimelineChanges(frame, [{ element: clip, start: 2, duration: 6 }]);
  holdIsolatedTimelineChanges(frame, [{ element: clip, start: 5, track: 4 }]);
  expect(applyHeldTimelineChanges(frame, [clip])[0]).toMatchObject({
    start: 5, duration: 6, track: 4, authoredTrack: 4, playbackStart: 3,
  });
  const replacement = document.createElement("iframe");
  replacement.src = frame.src;
  expect(applyHeldTimelineChanges(replacement, [clip])[0]).toBe(clip);
});
