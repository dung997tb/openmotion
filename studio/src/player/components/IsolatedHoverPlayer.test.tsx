// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { IsolatedHoverPlayer } from "./IsolatedHoverPlayer";

const state = vi.hoisted(() => ({
  props: null as null | { passive: boolean; onLoad(): void; onReadyToShowChange(ready: boolean): void },
  send: vi.fn(),
  muted: vi.fn(),
}));
vi.mock("./IsolatedPlayer", async () => {
  const { forwardRef } = await import("react");
  return { IsolatedPlayer: forwardRef<HTMLIFrameElement, NonNullable<typeof state.props>>((props, ref) => {
    state.props = props;
    return <iframe ref={ref} />;
  }) };
});
vi.mock("../lib/previewAdapter", () => ({ createPreviewAdapter: () => ({ send: state.send }) }));
vi.mock("../lib/timelineIframeHelpers", () => ({ setPreviewMediaMuted: state.muted }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.clearAllMocks());

it.each([{ time: 4, action: "pause" }, { time: undefined, action: "play" }])(
  "mutes the passive runtime before its first $action", ({ time, action }) => {
    const root = createRoot(document.createElement("main"));
    const ready = vi.fn();
    const render = (t?: number) => act(() => root.render(<IsolatedHoverPlayer source="/api/projects/p/preview"
      origin="https://preview.test" time={t} onReady={ready} onError={vi.fn()} />));
    try {
      render(time);
      expect(state.props?.passive).toBe(true);
      expect(state.send).not.toHaveBeenCalled();
      act(() => { state.props!.onLoad(); state.props!.onReadyToShowChange(true); });
      expect(state.muted).toHaveBeenCalledWith(expect.any(HTMLIFrameElement), true);
      expect(state.muted.mock.invocationCallOrder[0]).toBeLessThan(state.send.mock.invocationCallOrder[0]!);
      expect(state.send.mock.calls[0]).toEqual(["playback-control", { action }]);
      expect(ready).toHaveBeenLastCalledWith(true);
      if (time !== undefined) {
        expect(state.send).toHaveBeenLastCalledWith("playback-control", { action: "seek", time });
        render(7);
        expect(state.send).toHaveBeenLastCalledWith("playback-control", { action: "seek", time: 7 });
      }
    } finally { act(() => root.unmount()); }
  },
);
