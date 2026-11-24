// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player/store/playerStore";
import { TimelinePane } from "./TimelinePane";

vi.mock("../../player", async () => ({
  Timeline: () => <div data-tracks="" />,
  usePlayerStore: (await import("../../player/store/playerStore")).usePlayerStore,
}));
vi.mock("./NLEContext", () => ({ useNLEContext: () => ({
  projectId: "current", compositionStack: [{ id: "master" }], timelineDisabled: false, timelineSessionEpoch: 1,
}) }));
vi.mock("../../contexts/TimelineEditContext", () => ({ useTimelineEditContext: () => ({}) }));
vi.mock("../../motion/MotionTimelineMedia", () => ({ MotionTimelineMedia: () => null }));
vi.mock("./AudioMeterStrip", () => ({ AudioMeterStrip: () => null }));

it("keeps the current project's timeline controls and empty drop zone inert until its own timeline is ready", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    const store = usePlayerStore.getState();
    store.beginTimelineSession("previous");
    store.setTimelineReady(true);
    act(() => root.render(<TimelinePane timelineToolbar={<button>Edit</button>} />));
    const pane = host.querySelector("[data-studio-timeline]")!;
    const controls = host.querySelector("button")!;
    expect(host.querySelector("[data-tracks]")).toBeNull();
    expect(pane.getAttribute("aria-busy")).toBe("true");
    expect(controls.closest("[inert]")).not.toBeNull();
    act(() => store.beginTimelineSession("current"));
    const tracks = host.querySelector("[data-tracks]")!;
    expect(tracks.closest("[inert]")).not.toBeNull();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    act(() => store.setTimelineReady(true));
    expect(controls.closest("[inert]")).toBeNull();
    expect(tracks.closest("[inert]")).toBeNull();
    expect(pane.hasAttribute("aria-busy")).toBe(false);
    expect(host.querySelector('[role="status"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    usePlayerStore.getState().reset();
  }
});
