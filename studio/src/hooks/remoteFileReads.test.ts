import { describe, expect, it, vi } from "vitest";
import { createRemoteFileReader } from "./remoteFileReads";

function pendingFile() {
  const file = { content: "source", version: "etag", missing: false };
  let resolve!: (value: typeof file) => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<typeof file>((ok, fail) => { resolve = ok; reject = fail; });
  return { ready, finish: () => resolve(file), fail: () => reject(new Error("offline")) };
}

describe("remote source reads", () => {
  it("shares the changed source across timeline, SDK and open source editor", async () => {
    const file = pendingFile();
    const read = vi.fn(() => file.ready);
    const change = createRemoteFileReader(read)("A", { paths: ["intro.html", "poster.jpg"], affectedCompositions: ["index.html"] });
    const first = change("A", "intro.html");
    expect(change("B", "intro.html")).toBeUndefined();
    expect(change("A", "index.html")).toBeUndefined();
    file.finish();
    await first;
    expect(change("A", "intro.html")).toBe(first);
    expect(read).toHaveBeenCalledExactlyOnceWith("A", "intro.html", "?optional=1");
  });

  it.each([false, true])("coalesces a burst behind a slow read (first read fails = %s)", async (fails) => {
    const first = pendingFile(), last = pendingFile();
    const read = vi.fn().mockReturnValueOnce(first.ready).mockReturnValueOnce(last.ready);
    const reader = createRemoteFileReader(read);
    const fetch = (version: string) => reader("A", { path: "index.html", fileVersions: { "index.html": version } })("A", "index.html");
    const slow = fetch("v1");
    const repeated = fetch("v1");
    const latest = fetch("v2");
    expect(latest).toBe(repeated);
    for (let n = 3; n <= 30; n++) expect(fetch("v" + n)).toBe(latest);
    expect(read).toHaveBeenCalledTimes(1);
    if (fails) first.fail(); else first.finish();
    await slow?.catch(() => {});
    last.finish();
    expect((await latest)?.content).toBe("source");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("skips a trailing GET only when the response already contains the last announced version", async () => {
    const file = pendingFile();
    const read = vi.fn(() => file.ready);
    const reader = createRemoteFileReader(read);
    const change = (version: string) => reader("A", { path: "a.html", fileVersions: { "a.html": version } })("A", "a.html");
    const first = change("old");
    const next = change("etag");
    file.finish();
    await Promise.all([first, next]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("rechecks the head on deletion and on reconnect, including old servers", async () => {
    const read = vi.fn().mockResolvedValue({ content: "recreated", version: "v3" });
    const reader = createRemoteFileReader(read);
    for (const payload of [{ path: "index.html", fileVersions: { "index.html": null } }, { path: "." }]) {
      expect((await reader("A", payload)("A", "index.html"))?.content).toBe("recreated");
    }
    expect(read).toHaveBeenCalledTimes(2);
  });
});
