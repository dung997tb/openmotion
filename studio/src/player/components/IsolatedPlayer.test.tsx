// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bindPreviewLease } from "../lib/previewLease";
import { PREVIEW_BRIDGE_SOURCE, PREVIEW_BRIDGE_VERSION } from "../lib/previewAdapter";
import { IsolatedPlayer } from "./IsolatedPlayer";

vi.mock("../lib/previewLease", () => ({ bindPreviewLease: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mountPlayer() {
  const origin = "https://preview.test";
  let grant = 0;
  const retry = vi.fn<() => Promise<void>>();
  vi.mocked(bindPreviewLease).mockImplementation((source, _, navigate) => {
    const open = () => navigate(new URL(source.pathname + "?pt=grant-" + ++grant, origin));
    open();
    retry.mockImplementation(async () => open());
    return { retry, dispose: vi.fn() };
  });
  const host = document.createElement("main");
  const root = createRoot(host);
  const ready = vi.fn();
  const error = vi.fn();
  act(() => root.render(<IsolatedPlayer projectId="p" origin={origin} onLoad={ready} onPreviewError={error} />));
  const frame = host.querySelector("iframe")!;
  Object.defineProperty(frame, "contentWindow", { value: window });
  const notify = (type: string, token = "grant-" + grant) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin, source: frame.contentWindow,
      data: { source: PREVIEW_BRIDGE_SOURCE, version: PREVIEW_BRIDGE_VERSION, projectId: "p", token,
        type, duration: 5, retryAfterMs: 1000 } }));
  });
  return { retry, ready, error, notify, host, unmount: () => act(() => root.unmount()) };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

it("retries only authenticated busy documents and stops retrying when ready", () => {
  const player = mountPlayer();
  try {
    player.notify("preview-build-busy", "wrong-grant");
    advance(2000);
    expect(player.retry).not.toHaveBeenCalled();
    player.notify("preview-build-busy");
    player.notify("preview-build-busy");
    advance(1499);
    expect(player.retry).not.toHaveBeenCalled();
    advance(1);
    expect(player.retry).toHaveBeenCalledTimes(1);
    player.notify("preview-build-busy", "grant-1");
    player.notify("timeline-state");
    player.notify("preview-build-busy");
    advance(20_000);
    expect(player.ready).toHaveBeenCalledTimes(1);
    expect(player.error).not.toHaveBeenCalled();
    expect(player.retry).toHaveBeenCalledTimes(1);
  } finally { player.unmount(); }
});

it("caps repeated overload, gives manual retry a fresh budget and cancels on unmount", () => {
  const player = mountPlayer();
  try {
    for (const delay of [1500, 3000, 6000]) {
      player.notify("preview-build-busy");
      advance(delay);
    }
    expect(player.retry).toHaveBeenCalledTimes(3);
    player.notify("preview-build-busy");
    advance(20_000);
    expect(player.error).toHaveBeenCalledOnce();
    act(() => player.host.querySelector("button")!.click());
    player.notify("preview-build-busy");
    advance(1500);
    expect(player.retry).toHaveBeenCalledTimes(5);
    player.notify("preview-build-busy");
  } finally { player.unmount(); }
  advance(20_000);
  expect(player.retry).toHaveBeenCalledTimes(5);
});
