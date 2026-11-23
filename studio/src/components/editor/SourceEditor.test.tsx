// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { SourceEditor } from "./SourceEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("source editor acknowledgements during IME input", () => {
  it.each([["confirm", "saved中", "saved中"], ["cancel", "saved", "saved!"]])(
    "preserves an active candidate and reconciles the delayed receipt on %s",
    async (_action, finalText, expected) => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      let pending = false;
      const change = vi.fn(() => { pending = true; });
      const render = (content: string) => root.render(<SourceEditor filePath="intro.html"
        content={content} submitted="saved" onChange={change} hasPendingChange={() => pending} />);
      try {
        await act(async () => render("before"));
        const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
        view.focus();
        const replace = (text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
        replace("saved");
        view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        replace("savedzhong");
        pending = false;
        // The previous write was normalized and acknowledged while the next candidate was open.
        await act(async () => render("saved!"));
        expect(view.state.doc.toString()).toBe("savedzhong");
        expect(change.mock.calls).toEqual([["saved"]]);
        await act(async () => {
          replace(finalText);
          view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
        });
        expect(view.state.doc.toString()).toBe(expected);
        expect(change.mock.calls).toEqual(finalText === "saved" ? [["saved"]] : [["saved"], [finalText]]);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
});
