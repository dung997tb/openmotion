// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

// The module-scope kick in Player.tsx consumes the first attempt at import time,
// so this starts failing; the first test asserts that kick happened.
const state = vi.hoisted(() => ({ attempts: 0, failing: true }));

vi.mock("@hyperframes/player", () => {
  state.attempts += 1;
  if (state.failing) throw new Error("chunk load failed");
  return {};
});

import { loadPlayerModule, Player } from "./Player";

describe("loadPlayerModule", () => {
  it("kicks the import at module scope, before any mount", () => {
    expect(state.attempts).toBe(1);
  });

  it("replaces a failed player download with the editor reload action", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    try {
      await act(async () => root.render(createElement(Player, {
        projectId: "project", showInitialLoading: true, onLoad: vi.fn(),
      })));
      await vi.waitFor(() => expect(host.textContent).toContain("Reload editor"));
      expect(host.querySelector('[data-testid="composition-loading-overlay"]')).toBeNull();
      act(() => host.querySelector("button")!.click());
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      reload.mockRestore();
    }
  });

  it("does not hand a later mount the promise a failed load already rejected", async () => {
    // vitest rewraps a throwing mock factory, so assert the rejection, not its text.
    await expect(loadPlayerModule()).rejects.toThrow();
    const failedAttempts = state.attempts;

    state.failing = false;

    await expect(loadPlayerModule()).resolves.toBeDefined();
    expect(state.attempts).toBeGreaterThan(failedAttempts);
  });

  it("hands every mount the same resolved promise", async () => {
    state.failing = false;
    const first = loadPlayerModule();
    await first;

    expect(loadPlayerModule()).toBe(first);
    expect(loadPlayerModule()).toBe(first);
  });
});
