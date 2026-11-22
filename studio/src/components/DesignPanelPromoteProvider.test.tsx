// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { Composition } from "@hyperframes/sdk";
import { expect, it, vi } from "vitest";
import type { VariablePromoteProvider } from "../contexts/VariablePromoteContext";
import type { DomEditSelection } from "./editor/domEditingTypes";
import { DesignPanelPromoteProvider } from "./DesignPanelPromoteProvider";

const { openSeparate, variablePersist, provide } = vi.hoisted(() => ({
  openSeparate: vi.fn(),
  variablePersist: vi.fn(),
  provide: vi.fn((_props: ComponentProps<typeof VariablePromoteProvider>) => null),
}));
vi.mock("../hooks/useSdkSession", () => ({ useSdkSession: openSeparate }));
vi.mock("../hooks/useVariablesPersist", () => ({ useVariablesPersist: variablePersist }));
vi.mock("../contexts/VariablePromoteContext", () => ({ VariablePromoteProvider: provide }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("opens a separate SDK session only for a selection outside the active file", async () => {
  const projectId = "film";
  const activeCompPath = "index.html";
  const shared = {} as Composition;
  const child = {} as Composition;
  const publish = vi.fn();
  const childPublish = vi.fn();
  const forceReload = vi.fn();
  openSeparate.mockImplementation((_project: string, path: string | null) => ({
    session: path ? child : null, publish: childPublish,
  }));
  variablePersist.mockReturnValue(vi.fn().mockResolvedValue(true));
  const root = createRoot(document.createElement("div"));
  const render = (selection: Partial<DomEditSelection> | null) => act(() => root.render(
    <DesignPanelPromoteProvider selection={selection as DomEditSelection | null}
      projectId={projectId} activeCompPath={activeCompPath}
      sdkSession={shared} publishSdkSession={publish} forceReloadSharedSdkSession={forceReload}
      readProjectFile={vi.fn()} writeProjectFile={vi.fn()} recordEdit={vi.fn()}
      reloadPreview={vi.fn()} showToast={vi.fn()}>
      {null}
    </DesignPanelPromoteProvider>,
  ));
  const promote = async () => {
    const props = provide.mock.lastCall![0];
    await props.persist("Bind color", vi.fn());
  };
  try {
    render(null);
    expect(openSeparate).toHaveBeenLastCalledWith(projectId, null);
    expect(provide.mock.lastCall![0].session).toBeNull();

    render({ hfId: "title" });
    expect(openSeparate).toHaveBeenLastCalledWith(projectId, null);
    expect(variablePersist.mock.lastCall![0]).toMatchObject({
      activeCompPath, sdkSession: shared, publishSdkSession: publish,
    });
    await promote();
    expect(forceReload).not.toHaveBeenCalled();

    const sourceFile = "compositions/intro.html";
    render({ hfId: "intro-title", sourceFile });
    expect(openSeparate).toHaveBeenLastCalledWith(projectId, sourceFile);
    expect(variablePersist.mock.lastCall![0]).toMatchObject({
      activeCompPath: sourceFile, sdkSession: child, publishSdkSession: childPublish,
    });
    await promote();
    expect(forceReload).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
  }
});
