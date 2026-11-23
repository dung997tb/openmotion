// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { openTimelineSource } from "../player/lib/peerTimeline";
import { knownCompositionSource, rememberCompositionPosterSource } from "../player/lib/compositionPosterSource";
import { usePlayerStore } from "../player/store/playerStore";
import { rememberPeerTimingDocument } from "../player/peerTimingPreview";
import { rememberSource, forgetSource } from "../utils/confirmedTextSources";
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

it("starts the scripted rebuild immediately and reads a changed child only if its previous source is already available", () => {
  const state = usePlayerStore.getState();
  state.beginTimelineSession("p");
  const path = "compositions/intro.html";
  const frame = document.createElement("iframe");
  rememberPeerTimingDocument(frame, "token", undefined, "document");
  const pending = vi.fn(() => new Promise<never>(() => {}));
  const sync = (paths: string[]) => syncPeerComposition("p", "index.html", paths, pending, { current: frame }, null);
  try {
    expect(sync([path])).toBeUndefined();
    expect(pending).not.toHaveBeenCalled();
    rememberSource("p", path, { content: "<p>Hi</p>", version: "first" });
    expect(sync([path, "other.html"])).toBeUndefined();
    expect(pending).not.toHaveBeenCalled();
    expect(sync([path])).toBeUndefined();
    expect(pending).toHaveBeenCalledExactlyOnceWith("p", path);
  } finally {
    forgetSource("p", path);
    state.reset();
  }
});
