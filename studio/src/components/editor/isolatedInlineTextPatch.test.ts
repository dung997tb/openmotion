// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { inlineTextBatches, type InlineTextTarget } from "./isolatedInlineTextPatch";

const textTarget = { sourceFile: "scenes/a.html", elementId: "title", sha256: "a".repeat(64) };
const owner = { sourceFile: "index.html", key: "title", sha256: "b".repeat(64) };

it("commits ordinary rich text with only its own version", async () => {
  const read = vi.fn();
  const batches = await inlineTextBatches("p", textTarget, "<b>Updated</b>", undefined, read);
  expect(batches).toEqual([{ sourceFile: textTarget.sourceFile, ifMatch: '"sha256:' + textTarget.sha256 + '"',
    patches: [{ target: { id: "title" }, operations: [{ type: "rich-text", property: "", value: "<b>Updated</b>" }] }] }]);
  expect(read).not.toHaveBeenCalled();
});

it("captures both versions in one batch and edits only the effective default", async () => {
  const entries = [{ id: "other", default: 4 }, { id: "title", type: "string", default: "Old", label: "Welcome" }];
  const source = "<html data-composition-variables='" + JSON.stringify(entries) + "'><body></body></html>";
  const target: InlineTextTarget = { ...textTarget, binding: { ...owner, attribute: "data-composition-variables", htmlRoot: true } };
  const text = "New < & ' title";
  const batches = await inlineTextBatches("p", target, "New &lt; &amp; ' title", text, async () => source);
  expect(batches.map(({ sourceFile, ifMatch }) => [sourceFile, ifMatch])).toEqual([
    [textTarget.sourceFile, '"sha256:' + textTarget.sha256 + '"'], [owner.sourceFile, '"sha256:' + owner.sha256 + '"'],
  ]);
  const patch = batches[1].patches[0];
  expect(patch.target).toEqual({ selector: "html" });
  expect(JSON.parse(patch.operations[0].value!)).toEqual([entries[0], { ...entries[1], default: text }]);
});

it.each([false, true])("edits one instance's override and preserves its other values (existing override %s)", async (existing) => {
  const target: InlineTextTarget = { ...textTarget, sourceFile: owner.sourceFile, sha256: owner.sha256,
    binding: { ...owner, attribute: "data-variable-values", elementId: "second" } };
  const before = existing ? { title: "second", theme: "dim" } : { theme: "dim" };
  const source = '<div id="first" data-composition-src="a.html" data-variable-values=\'{"title":"first"}\'></div>' +
    '<div id="second" data-composition-src="a.html" data-variable-values=\'' + JSON.stringify(before) + "'></div>";
  const batches = await inlineTextBatches("p", target, "New", "New", async () => source);
  expect(batches).toHaveLength(1);
  expect(batches[0].patches[1].target.id).toBe("second");
  expect(JSON.parse(batches[0].patches[1].operations[0].value!)).toEqual({ ...before, title: "New" });
});

it("never substitutes a same-named variable of a different type", async () => {
  const target: InlineTextTarget = { ...textTarget, binding: { ...owner, attribute: "data-composition-variables", htmlRoot: true } };
  await expect(inlineTextBatches("p", target, "New", "New", async () =>
    '<html data-composition-variables=\'[{"id":"title","type":"enum","default":"on"}]\'></html>')).rejects.toThrow("changed");
});
