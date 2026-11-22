// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCloudCompositionPoster } from "./cloudCompositionPoster";
import { decodeImageThumbnail } from "./thumbnailImageDecoder";
import { usePlayerStore } from "../store/playerStore";

vi.mock("./thumbnailImageDecoder", () => ({ decodeImageThumbnail: vi.fn() }));
const picture = { value: { kind: "image" as const, url: "blob:representative", aspect: 1 }, weight: 32 };
const url = (query = "") => new URL("/api/projects/p/thumbnail/compositions/scene.html" + query, location.origin);
const signal = () => new AbortController().signal;
const original = usePlayerStore.getState();
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); usePlayerStore.setState(original); });

describe("cloud composition representatives", () => {
  it("uses the exact current-project manifest without reading HTML", async () => {
    usePlayerStore.setState({ previewBooted: true, timelineProjectId: "p", timelineSessionEpoch: 4,
      elements: [{ id: "photo", tag: "img", src: "../assets/hero.png", sourceFile: "compositions/scene.html", start: 0, duration: 4, track: 0 }] });
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(decodeImageThumbnail).mockResolvedValue(picture);
    expect(await loadCloudCompositionPoster(url(), "p", 4, signal())).toEqual(picture);
    expect(decodeImageThumbnail).toHaveBeenCalledWith(new URL("/api/projects/p/preview/assets/hero.png", location.origin).href, expect.anything());
    expect(fetch).not.toHaveBeenCalled();
  });
  it("respects the selected occurrence in an inert template without external fetches", async () => {
    const html = '<template><div class="tile"><img src="https://example.invalid/logo.png"></div><div class="tile"><video poster="assets/2.jpg"></video></div></template>';
    const fetch = vi.fn(async () => Response.json({ content: html }));
    vi.stubGlobal("fetch", fetch);
    vi.mocked(decodeImageThumbnail).mockResolvedValue(picture);
    await loadCloudCompositionPoster(url("?selector=.tile&selectorIndex=1"), "p", 0, signal());
    expect(decodeImageThumbnail).toHaveBeenCalledWith(new URL("/api/projects/p/preview/assets/2.jpg", location.origin).href, expect.anything());
    expect(fetch.mock.calls).toHaveLength(1);
  });
  it("uses only this file's real title for text, external assets or traversal; releases the object URL", async () => {
    usePlayerStore.setState({ previewBooted: true, timelineProjectId: "other", timelineSessionEpoch: 1,
      elements: [{ id: "wrong", tag: "img", src: "assets/private.png", sourceFile: "compositions/scene.html", start: 0, duration: 9, track: 0 }] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: '<template><script>steal()</script><h1>Real &amp; Safe</h1><img src="../../../../other/preview/asset.jpg"></template>' })));
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:scene");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const result = await loadCloudCompositionPoster(url(), "p", 1, signal());
    expect(decodeImageThumbnail).not.toHaveBeenCalled();
    const svg = await (create.mock.calls[0]![0] as Blob).text();
    expect(svg).toContain("Real &amp; Safe");
    expect(svg).not.toMatch(/script|steal|private.png/);
    result.dispose?.();
    expect(revoke).toHaveBeenCalledWith("blob:scene");
  });
  it("propagates a transient media failure so the scheduler can retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: '<img src="assets/poster.jpg">' })));
    vi.mocked(decodeImageThumbnail).mockRejectedValue(new Error("network"));
    await expect(loadCloudCompositionPoster(url(), "p", 0, signal())).rejects.toThrow("network");
    vi.mocked(decodeImageThumbnail).mockResolvedValue(picture);
    await expect(loadCloudCompositionPoster(url(), "p", 0, signal())).resolves.toEqual(picture);
  });
  it("rejects a mismatched project before requesting its file", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(loadCloudCompositionPoster(url(), "other", 0, signal())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
