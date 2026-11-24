// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCachedCloudDisklessMode } from "../../utils/cloudRuntime";
import { emitMediaDerived } from "../../utils/mediaDerivedBus";
import { MockResizeObserver } from "../../hooks/resizeObserverTestUtils";
import { loadWaveform } from "./audioWaveformLoader";
import { loadPeakMap } from "../components/clipPeakMap";
import { decodeVideoThumbnail } from "./thumbnailVideoDecoder";
import { thumbnailScheduler } from "./thumbnailScheduler";
import { createHappyDomRootHarness } from "../components/testRootHarness";
import { VideoThumbnail } from "../components/VideoThumbnail";

vi.mock("./thumbnailVideoDecoder", () => ({ decodeVideoThumbnail: vi.fn() }));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const harness = createHappyDomRootHarness();

describe("cloud timeline media previews", () => {
  beforeEach(() => {
    setCachedCloudDisklessMode(null);
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    setCachedCloudDisklessMode(null);
    thumbnailScheduler.invalidateProject("p1");
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("handles 202 pending in audioWaveformLoader and clipPeakMap without throwing or poisoning cache", async () => {
    let wfCalls = 0;
    let peakCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/waveform/silent.mp4")) {
          return Response.json({ peaks: [], bins: [], binSeconds: 0, hasAudio: false }, { status: 200 });
        }
        if (url.includes("/waveform/")) {
          wfCalls += 1;
          if (wfCalls === 1) {
            return Response.json({ pending: true, sha256: "c".repeat(64) }, { status: 202 });
          }
          return Response.json({ peaks: [0.1, 0.8, 0.4], hasAudio: true }, { status: 200 });
        }
        if (url.includes("/peaks/")) {
          peakCalls += 1;
          if (peakCalls === 1) {
            return Response.json({ pending: true, sha256: "d".repeat(64) }, { status: 202 });
          }
          return Response.json({ binSeconds: 0.5, bins: [0.2, 0.9] }, { status: 200 });
        }
        return new Response("", { status: 404 });
      }),
    );

    // 1. Silent video returns [] cleanly
    const silentPeaks = await loadWaveform(
      "/api/projects/p1/preview/assets/silent.mp4",
      "/api/projects/p1/waveform/silent.mp4",
      new AbortController().signal,
      "video",
    );
    expect(silentPeaks).toEqual([]);

    // 2. Pending 202 waveform wakes up via SSE and never falls back to browser AudioContext decode
    const wfPromise = loadWaveform(
      "/api/projects/p1/preview/assets/song.mp3",
      "/api/projects/p1/waveform/assets/song.mp3",
      new AbortController().signal,
      "audio",
    );
    await vi.waitFor(() => expect(wfCalls).toBe(1));
    emitMediaDerived({
      type: "media-derived-ready",
      projectId: "p1",
      sha256: "c".repeat(64),
      kind: "waveform",
      status: "ready",
    });
    await expect(wfPromise).resolves.toEqual([0.1, 0.8, 0.4]);

    // 3. Pending 202 peakMap wakes up via SSE and returns PeakMap
    const peakPromise = loadPeakMap("/api/projects/p1/peaks/assets/song.mp3");
    await vi.waitFor(() => expect(peakCalls).toBe(1));
    emitMediaDerived({
      type: "media-derived-ready",
      projectId: "p1",
      sha256: "d".repeat(64),
      kind: "waveform",
      status: "ready",
    });
    await expect(peakPromise).resolves.toEqual({ binSeconds: 0.5, bins: [0.2, 0.9] });
  });

  it("decodes the original cloud video without enqueueing or polling poster or sprite jobs", async () => {
    setCachedCloudDisklessMode(true);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.mocked(decodeVideoThumbnail).mockResolvedValue({
      value: { kind: "filmstrip", urls: ["blob:first", "blob:last"], aspect: 16 / 9 }, weight: 512,
    });
    const host = document.body.appendChild(document.createElement("div"));
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 40 });
    const root = harness.mount(host);
    await act(async () => {
      root.render(<VideoThumbnail videoSrc="/api/projects/p1/preview/assets/clip.mp4"
        label="" labelColor="#fff" duration={10} projectId="p1" sessionEpoch={1} />);
    });
    await vi.waitFor(() => expect(host.querySelector('img[src="blob:first"]')).toBeTruthy());
    expect(decodeVideoThumbnail).toHaveBeenCalledWith(expect.objectContaining({
      source: "/api/projects/p1/preview/assets/clip.mp4",
    }), expect.any(AbortSignal));
    expect(fetch).not.toHaveBeenCalled();
    host.remove();
  });
});
