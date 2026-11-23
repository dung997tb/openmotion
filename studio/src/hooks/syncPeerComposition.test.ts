// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { openTimelineSource } from "../player/lib/peerTimeline";
import { knownCompositionSource, rememberCompositionPosterSource } from "../player/lib/compositionPosterSource";
import { usePlayerStore } from "../player/store/playerStore";
import { syncPeerComposition } from "./syncPeerComposition";

it("lets a preview without live timing support start its rebuild while the source read is pending", () => {
  const state = usePlayerStore.getState();
  state.beginTimelineSession("p");
  const close = openTimelineSource("p", "index.html");
  try {
    const frame = document.createElement("iframe");
    Object.defineProperty(frame, "contentDocument", { value: null });
    rememberCompositionPosterSource(usePlayerStore.getState(), "p", "index.html", "<main></main>", "v1");
    const pending = vi.fn(() => new Promise<never>(() => {}));
    const previous = knownCompositionSource(usePlayerStore.getState(), "p", "index.html");
    expect(syncPeerComposition("p", "index.html", ["index.html"], pending, { current: frame }, previous)).toBeUndefined();
    expect(pending).toHaveBeenCalledExactlyOnceWith("p", "index.html");
  } finally {
    close();
    state.reset();
  }
});
