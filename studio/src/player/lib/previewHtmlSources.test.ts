// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { forgetPreviewHtmlSources, isUnrelatedPreviewHtmlChange, rememberPreviewHtmlSources } from "./previewHtmlSources";

it("uses the mounted graph through verified in-place changes and clears it when the frame will reload", () => {
  const frame = document.createElement("iframe");
  const change = (paths: string[] | null, tree = false) => isUnrelatedPreviewHtmlChange(frame, "project", "index.html", paths, tree);
  const loaded = () => rememberPreviewHtmlSources(frame, "project", ["index.html", "intro.html", "nested/title.html"]);
  loaded();
  for (let i = 0; i < 5; i++) expect(change(["other.html", "more.htm"])).toBe(true);
  expect(change(["nested/title.html", "other.html"])).toBe(false);
  expect(change(["other.html"])).toBe(true);
  expect(change(["new.html"], true)).toBe(false);
  loaded();
  expect(change(null)).toBe(false);
  loaded();
  expect(change(["video.mp4"])).toBe(false);
  loaded();
  forgetPreviewHtmlSources(frame);
  expect(change(["other.html"])).toBe(false);
});
