// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { PREVIEW_INSPECTOR } from "../../../../src/studio/engine/preview-inspector";
import type { PreviewAdapter } from "../../player/lib/previewAdapter";
import { inspectIsolatedElement } from "./isolatedInspector";
import { planIsolatedLayerReorder } from "./isolatedLayerReorder";

const sha256 = "b".repeat(64);
function inspect(html: string, lookup: {elementId: string; sourceFile?: string}) {
  document.body.innerHTML = html;
  const request = new Function("sourceFileForElement","describe","sourceVersions","picked","inlineVariableOwner",
    PREVIEW_INSPECTOR + "\nreturn inspectPreviewElement;")(
      (el: HTMLElement) => el.closest("[data-file]")?.getAttribute("data-file") || "index.html",
      (el: HTMLElement) => ({ sourceFile: "index.html", elementId: el.id, geometry: { x: 1, y: 2, width: 4, height: 5 }}),
      { "index.html": sha256 }, null, () => null);
  const adapter = { request: vi.fn(async (_command, payload) => request(payload)) } as unknown as PreviewAdapter;
  return inspectIsolatedElement(adapter, lookup, false);
}
afterEach(() => document.body.replaceChildren());

it("projects only the requested authored layer, with caret text and presentation facts in an inert document", async () => {
  const selection = await inspect('<h1 id="t" style="color:red" onclick="ignored()">A &amp; B</h1>', {elementId:"t"});
  expect(selection?.textFields[0]).toMatchObject({ source: "self", value: "A & B" });
  expect(selection?.inlineStyles.color).toBe("red");
  expect(selection?.element.ownerDocument.defaultView).toBeNull();
  expect(selection?.element.getAttribute("onclick")).toBeNull();
  expect(selection?.isolatedTarget?.sha256).toBe(sha256);
  expect(await inspect('<p id="t">first</p><p id="t">second</p>', {elementId:"t"})).toBeNull();
  expect(await inspect('<p id="t">word</p>', {elementId:"t",sourceFile:"missing.html"})).toBeNull();
});

it("keeps empty shapes out of text editing and preserves media controls without copying resource URLs", async () => {
  expect((await inspect('<p id="p"></p>', {elementId:"p"}))?.textFields[0]?.value).toBe("");
  expect((await inspect('<h1 id="p">One<br>two</h1>', {elementId:"p"}))?.textFields[0]).toMatchObject({
    value: "One\ntwo", preserveLineBreaks: true });
  expect((await inspect('<div id="shape"></div>',{elementId:"shape"}))?.textFields).toEqual([]);
  const selection = await inspect('<video id="v" loop muted src="https://preview.example/asset?pt=temp" data-volume=".5"></video>',{elementId:"v"});
  expect(selection?.tagName).toBe("video");
  expect(selection?.element.hasAttribute("loop")).toBe(true);
  expect(selection?.element.hasAttribute("muted")).toBe(true);
  expect(selection?.element.hasAttribute("src")).toBe(false);
  expect(selection?.dataAttributes.volume).toBe(".5");
});

it("computes layer drag patches with the native z resolver and refuses a locked or cross-parent destination", () => {
  const family = ["a","b","c"].map((element, domIndex) => ({ element, domIndex, zIndex: domIndex, locked: false,
    makeRelative: true, elementId: element, sourceFile: "index.html", sha256 }));
  const plan = planIsolatedLayerReorder(family, ["c","b","a"], 2, 0);
  expect(plan?.batches).toMatchObject([{ sourceFile: "index.html", ifMatch: '"sha256:'+sha256+'"',
    patches: [{ target: {id:"a"}, operations: [{property:"position",value:"relative"},{property:"z-index",value:"3"}] }] }]);
  expect(planIsolatedLayerReorder(family, ["other-parent","a"], 1, 0)).toBeNull();
  family[0].locked = true;
  expect(planIsolatedLayerReorder(family, ["c","b","a"], 2, 0)).toBeNull();
});
