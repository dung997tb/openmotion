// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { clearLocalUploadPreview, clearProjectUploadPreviews, getLocalUploadPreview, setLocalUploadPreview } from "./localUploadPreviewStore";

it("releases replaced and offscreen file URLs without touching another project's identically named asset", () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  try {
    setLocalUploadPreview("a", "image", "blob:old");
    setLocalUploadPreview("a", "image", "blob:new");
    setLocalUploadPreview("a", "video", "data:image/jpeg,x", false);
    setLocalUploadPreview("b", "image", "blob:other");
    clearProjectUploadPreviews("a");
    expect(revoke.mock.calls).toEqual([["blob:old"], ["blob:new"]]);
    expect(getLocalUploadPreview("a", "video")).toBeNull();
    expect(getLocalUploadPreview("b", "image")).toBe("blob:other");
    clearLocalUploadPreview("b", "image");
    expect(revoke).toHaveBeenCalledWith("blob:other");
  } finally { revoke.mockRestore(); }
});
