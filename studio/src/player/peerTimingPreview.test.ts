// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { diffPreviewChanges } from "./peerTimingPreview";

const source = '<!doctype html><main data-composition-id="root" data-duration="15"><audio id="a" data-start="2" data-duration="3"></audio><script>window.run(1)</script></main>';

describe("peer timing classification", () => {
  it("includes root and media in a single verified set and requires stable identities", () => {
    const next = source.replace('"15"', '"14"').replace('data-start="2"', 'data-start="3" data-media-start="1"');
    expect(diffPreviewChanges(source, next)?.map(change => [change.id || change.compositionId, change.attributes])).toEqual([
      ["root", [["data-duration", "15", "14"]]],
      ["a", [["data-start", "2", "3"], ["data-media-start", null, "1"]]],
    ]);
    expect(diffPreviewChanges(source.replace('id="a"', ''), next.replace('id="a"', ''))).toBeNull();
  });

  it("accepts direct text, inspector styles and a two-axis move on one identified element", () => {
    const before = '<div id="title" style="left: 10px; top: 20px; color: red">Hello</div>';
    const after = '<div id="title" style="left: 40px; top: 32px; color: red; font-size: 52px; text-align: center">Hi!</div>';
    expect(diffPreviewChanges(before, after)).toMatchObject([{
      id: "title", attributes: [], text: ["Hello", "Hi!"],
      styles: [["left", "10px", "40px"], ["top", "20px", "32px"], ["font-size", "", "52px"], ["text-align", "", "center"]],
    }]);
    for (const unsupported of [after.replace("center", "center !important"), after.replace("red", "red; z-index: 2"),
      after.replace("Hi!", "<b>Hi!</b>"), after.replace('id="title"', 'id="other"')]) {
      expect(diffPreviewChanges(before, unsupported)).toBeNull();
    }
    expect(diffPreviewChanges('<script id="x">a()</script>', '<script id="x">b()</script>')).toBeNull();
  });

  it("recognizes only the exact IDs mounted by the preview bundler on the first nested edit", () => {
    const before = '<template><div data-composition-id="intro"><p id="title">Hi</p></div></template>';
    const next = ensureHfIds(before).replace('id="title"', 'id="title" style="font-size: 54px"');
    expect(diffPreviewChanges(before, next, true)).toMatchObject([{ id: "title", styles: [["font-size", "", "54px"]] }]);
    expect(diffPreviewChanges(before, next)).toBeNull();
    expect(diffPreviewChanges(before, next.replace(/data-hf-id="[^"]+"/, 'data-hf-id="unrelated"'), true)).toBeNull();
  });

  it("includes the containing-block change on the first drag of a static layer", () => {
    const before = '<div id="title" style="color:red">Title</div>';
    const after = '<div id="title" style="color:red;position:relative;left:30px;top:12px">Title</div>';
    expect(diffPreviewChanges(before, after)?.[0]?.styles).toEqual([
      ["position", "", "relative"], ["left", "", "30px"], ["top", "", "12px"],
    ]);
  });

  it("falls back for a changed tween, markup, source, label, style or expression in the same edit", () => {
    const trimmed = source.replace('data-start="2"', 'data-start="3"');
    for (const next of [trimmed.replace('run(1)', 'run(2)'), trimmed.replace('</audio>', '</audio><b></b>'),
      trimmed.replace('id="a"', 'id="b"'), trimmed.replace('id="a"', 'id="a" src="asset.m4a"'),
      trimmed.replace('id="a"', 'id="a" style="z-index:2"'), trimmed.replace('"3"', '"=clip.start"')]) {
      expect(diffPreviewChanges(source, next)).toBeNull();
    }
    expect(diffPreviewChanges('<template>' + source + '</template>', '<template>' + trimmed.replace('run(1)', 'run(2)') + '</template>')).toBeNull();
  });
});
