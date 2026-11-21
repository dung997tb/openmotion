// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindPreviewLease } from "./previewLease";
import { studioApiFetch } from "../../utils/studioApiFetch";

vi.mock("../../utils/studioApiFetch", () => ({ studioApiFetch: vi.fn() }));
const fetch = vi.mocked(studioApiFetch);
const origin = "https://preview.example.test";
const source = new URL("https://studio.example.test/api/projects/p/preview/comp/title.html?variables=test");
function grant(lease: string, token: string, previewOrigin = origin) {
  return Response.json({ assetLease: lease, token, previewOrigin, expiresAt: new Date(Date.now() + 20_000).toISOString() });
}

describe("preview lease", () => {
  const navigate = vi.fn();
  const failed = vi.fn();
  let lease: ReturnType<typeof bindPreviewLease>;
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => { lease.dispose(); vi.useRealTimers(); });

  it("renews the same read lease in place and reconnects only if the server issues a replacement", async () => {
    fetch.mockImplementationOnce(async () => grant("A", "first"))
      .mockImplementationOnce(async () => grant("A", "second"))
      .mockImplementationOnce(async () => grant("B", "third"));
    lease = bindPreviewLease(source, origin, navigate, failed);
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate.mock.calls[0][0].href).toBe(origin + source.pathname + "?variables=test&pt=first");
    await vi.advanceTimersByTimeAsync(16_000);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ assetLease: "A" });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(navigate.mock.calls[1][0].searchParams.get("pt")).toBe("third");
    expect(failed).not.toHaveBeenCalled();
  });

  it("preserves the frame on transient failure and stops automatic renewal after refused access", async () => {
    fetch.mockImplementationOnce(async () => grant("A", "first"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    lease = bindPreviewLease(source, origin, navigate, failed);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(failed).toHaveBeenCalledWith(expect.stringContaining("403"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects a grant targeting another origin and ignores an in-flight response after teardown", async () => {
    let resolve!: (res: Response) => void;
    fetch.mockResolvedValueOnce(grant("A", "first", "https://other.example.test"))
      .mockImplementationOnce(() => new Promise(callback => { resolve = callback; }));
    lease = bindPreviewLease(source, origin, navigate, failed);
    await vi.advanceTimersByTimeAsync(0);
    expect(failed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    lease.dispose();
    resolve(grant("A", "late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(navigate).not.toHaveBeenCalled();
  });
});
