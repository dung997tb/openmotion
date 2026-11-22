// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefetchPreviewForHash } from "./previewPrefetch";

import { ensureCloudDisklessMode, getCachedCloudDisklessMode, setCachedCloudDisklessMode, warmCloudDisklessMode } from "./cloudRuntime";

describe("prefetchPreviewForHash", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setCachedCloudDisklessMode(null);
    document.head.querySelectorAll('meta[data-test-runtime]').forEach(meta => meta.remove());
  });

  function markShell(name: string, content: string) {
    const meta = document.createElement("meta");
    meta.dataset.testRuntime = "";
    meta.name = name;
    meta.content = content;
    document.head.append(meta);
  }

  it("detects the cloud shell synchronously and warms same-origin HTML without a response body", async () => {
    markShell("openmotion-runtime", "cloud-diskless");
    const fetchStub = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchStub);
    warmCloudDisklessMode();
    expect(getCachedCloudDisklessMode()).toBe(true);
    await expect(ensureCloudDisklessMode()).resolves.toBe(true);
    prefetchPreviewForHash("#project/same-origin");
    expect(fetchStub).toHaveBeenCalledExactlyOnceWith(expect.any(URL), expect.objectContaining({ method: "HEAD" }));
  });

  it("skips main-origin requests for an isolated project even on an older cloud shell", () => {
    markShell("openmotion-preview-origin", "https://preview.example.test");
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    warmCloudDisklessMode();
    prefetchPreviewForHash("#project/isolated");
    expect(getCachedCloudDisklessMode()).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("falls back to config discovery for unmarked shells", async () => {
    const fetchStub = vi.fn(() => Promise.resolve(Response.json({ mode: "native" })));
    vi.stubGlobal("fetch", fetchStub);
    await expect(ensureCloudDisklessMode()).resolves.toBe(false);
    expect(fetchStub).toHaveBeenCalledExactlyOnceWith("/__hyperframes_config", expect.any(Object));
  });

  it("requests the opening project's preview once, not on every hash update", () => {
    const fetchStub = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", fetchStub);

    prefetchPreviewForHash("#project/demo");
    prefetchPreviewForHash("#project/demo?t=2&tab=design");
    prefetchPreviewForHash("#project/other");
    prefetchPreviewForHash("#settings");

    expect(fetchStub.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/api/projects/demo/preview",
      "/api/projects/other/preview",
    ]);
  });
});
