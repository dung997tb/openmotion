// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { diffPreviewTiming } from "./peerTimingPreview";

const source = '<!doctype html><main data-composition-id="root" data-duration="15"><audio id="a" data-start="2" data-duration="3"></audio><script>window.run(1)</script></main>';

describe("peer timing classification", () => {
  it("includes root and media in a single verified set and requires stable identities", () => {
    const next = source.replace('"15"', '"14"').replace('data-start="2"', 'data-start="3" data-media-start="1"');
    expect(diffPreviewTiming(source, next)?.map(change => [change.id || change.compositionId, change.attributes])).toEqual([
      ["root", [["data-duration", "15", "14"]]],
      ["a", [["data-start", "2", "3"], ["data-media-start", null, "1"]]],
    ]);
    expect(diffPreviewTiming(source.replace('id="a"', ''), next.replace('id="a"', ''))).toBeNull();
  });

  it("falls back for a changed tween, markup, source, label, style or expression in the same edit", () => {
    const trimmed = source.replace('data-start="2"', 'data-start="3"');
    for (const next of [trimmed.replace('run(1)', 'run(2)'), trimmed.replace('</audio>', '</audio><b></b>'),
      trimmed.replace('id="a"', 'id="b"'), trimmed.replace('id="a"', 'id="a" src="asset.m4a"'),
      trimmed.replace('id="a"', 'id="a" style="z-index:2"'), trimmed.replace('"3"', '"=clip.start"')]) {
      expect(diffPreviewTiming(source, next)).toBeNull();
    }
    expect(diffPreviewTiming('<template>' + source + '</template>', '<template>' + trimmed.replace('run(1)', 'run(2)') + '</template>')).toBeNull();
  });
});
