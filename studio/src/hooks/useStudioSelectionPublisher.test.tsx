// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import { useStudioSelectionPublisher } from "./useStudioSelectionPublisher";

it("publishes a detached selection once across reloads and clears each new project's context", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const root = createRoot(document.createElement("div"));
  const ref = { current: { element: document.createElement("div") } as DomEditSelection };
  function Harness({ projectId, revision }: { projectId: string; revision: number }) {
    useStudioSelectionPublisher({
      projectId, domEditSelection: { ...ref.current }, domEditSelectionRef: ref,
      refreshKey: revision, previewDocumentVersion: revision, refreshDomEditSelectionFromPreview: async () => {},
    });
    return null;
  }
  try {
    for (const [projectId, revision] of [["a", 0], ["a", 1], ["b", 0]] as const) {
      await act(async () => root.render(createElement(Harness, { projectId, revision })));
    }
    expect(fetch.mock.calls).toMatchObject([
      ["/api/projects/a/selection", { body: JSON.stringify({ selection: null }) }],
      ["/api/projects/b/selection", { body: JSON.stringify({ selection: null }) }],
    ]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
