// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  VariablePromoteProvider,
  useVariablePromoteChannel,
  type ChannelPromote,
} from "./VariablePromoteContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("VariablePromoteProvider save failures", () => {
  it("returns the save outcome for a text field bound to a variable", async () => {
    const session = {
      getElement: () => ({ attributes: { "data-var-text": "title" }, inlineStyles: {}, children: [], text: "first" }),
      getVariableDeclarations: () => [{ id: "title", type: "string", default: "first" }],
      on: () => () => {},
    } as unknown as Composition;
    const selection = { hfId: "hf-title", tagName: "p", capabilities: {}, computedStyles: {} } as DomEditSelection;
    const error = new Error("offline");
    const persist = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onPersistError = vi.fn();
    let commit!: ChannelPromote["setDefault"];
    function Consumer() {
      commit = useVariablePromoteChannel({ kind: "text" })!.setDefault;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(
      <VariablePromoteProvider session={session} selection={selection} persist={persist} onPersistError={onPersistError}>
        <Consumer />
      </VariablePromoteProvider>,
    ));
    expect(await commit("updated")).toBe(false);
    expect(onPersistError).toHaveBeenCalledWith(error);
    expect(await commit("updated")).toBe(false);
    expect(await commit("updated")).toBe(true);
    act(() => root.unmount());
  });

  it("reports a rejected promote instead of leaving an unhandled promise", async () => {
    const snapshot = {
      attributes: { id: "box" },
      inlineStyles: {},
      text: "",
      children: [],
    };
    const session = {
      getElement: vi.fn().mockReturnValue(snapshot),
      getVariableDeclarations: vi.fn().mockReturnValue([]),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Composition;
    const selection = {
      hfId: "hf-box",
      tagName: "div",
      label: "Box",
      capabilities: { canEditStyles: true },
      computedStyles: { color: "rgb(255, 0, 0)" },
    } as unknown as DomEditSelection;
    const error = new Error("write failed");
    const persist = vi.fn().mockRejectedValue(error);
    const onPersistError = vi.fn();
    let channel: ChannelPromote | null = null;

    function Consumer() {
      channel = useVariablePromoteChannel({ kind: "style", prop: "color" });
      return null;
    }

    const root = createRoot(document.createElement("div"));
    act(() => {
      root.render(
        <VariablePromoteProvider
          session={session}
          selection={selection}
          persist={persist}
          onPersistError={onPersistError}
        >
          <Consumer />
        </VariablePromoteProvider>,
      );
    });
    act(() => channel?.promote());
    await act(async () => {
      await Promise.resolve();
    });

    expect(persist).toHaveBeenCalledOnce();
    expect(onPersistError).toHaveBeenCalledWith(error);
    act(() => root.unmount());
  });
});
