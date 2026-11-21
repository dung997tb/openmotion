import { afterEach, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { rememberPreviewPosition, takePreviewPosition } from "./previewReconnect";

afterEach(() => usePlayerStore.setState(usePlayerStore.getInitialState()));

it("restores the paused runtime position once, including the time since the last UI tick", () => {
  const frame = {} as HTMLIFrameElement;
  usePlayerStore.setState({ currentTime: 2.60, isPlaying: false });
  rememberPreviewPosition(frame, 3.01);
  expect(takePreviewPosition(frame)).toEqual({ time: 3.01, playing: false });
  expect(takePreviewPosition(frame)).toBeUndefined();
});

it("remembers whether playback should resume before stopping the old transport", () => {
  const frame = {} as HTMLIFrameElement;
  const requestPlayback = vi.fn();
  usePlayerStore.setState({ isPlaying: true, requestPlayback });
  rememberPreviewPosition(frame, 8.25);
  expect(requestPlayback).toHaveBeenCalledWith(false);
  expect(takePreviewPosition(frame)).toEqual({ time: 8.25, playing: true });
});
