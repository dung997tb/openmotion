import assert from "node:assert/strict";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import { parseHTMLContent } from "@hyperframes/core/compiler/html-document";
import { PREVIEW_INLINE_TEXT } from "../../src/studio/engine/preview-inline-text.ts";

function pick(html: string, variables?: Record<string, unknown>, scoped?: Record<string, unknown>) {
  const document = parseHTMLContent(html);
  const el = document.getElementById("text")!;
  document.elementFromPoint = () => el;
  return runInNewContext(PREVIEW_INLINE_TEXT + ';editInlineText({phase:"pick",editId:"1",x:0.5,y:0.5})', {
    document, window: { __hfVariables: variables, __hfVariablesByComp: scoped },
    HTMLElement: document.defaultView!.HTMLElement, innerWidth: 100, innerHeight: 100,
    sourceVersions: { "index.html": "sha" },
    describe: (node: Element) => ({ sourceFile: "index.html", elementId: node.id }),
  });
}

const declaration = "data-composition-variables='" + JSON.stringify([{ id: "message", type: "string", default: "Root" }]) + "'";
const label = '<span id="text" data-var-text="message">Text</span>';

it("uses the last effective declaration, while a transient render override cannot become a file edit", () => {
  const html = '<html ' + declaration + '><body><div id="later" ' + declaration + '></div>' + label + '</body></html>';
  assert.equal(pick(html)?.binding.elementId, "later");
  assert.equal(pick(html, { message: "Preview only" }), null);
});

it("targets the exact instance for a scoped value and never falls through to an unrelated global", () => {
  const html = '<html ' + declaration + '><body><div id="second" data-composition-id="instance-b">' + label + '</div></body></html>';
  assert.equal(pick(html, { message: "global override" }, { "instance-b": { message: "Scoped" } })?.binding.attribute, "data-variable-values");
  assert.equal(pick(html, {}, { "instance-b": { message: "Scoped" } })?.binding.elementId, "second");
  assert.equal(pick(html, {}, { "instance-b": { different: "unrelated" } }), null);
});

it("leaves ordinary rich text editable and refuses to overwrite child layers with a bound scalar", () => {
  assert.equal(pick('<html><body><p id="text">A <b>word</b></p></body></html>')?.elementId, "text");
  assert.equal(pick('<html ' + declaration + '><body><p id="text" data-var-text="message">A <b>word</b></p></body></html>'), null);
});
