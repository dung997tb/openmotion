// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trackStudioSaveFailure = vi.hoisted(() => vi.fn());
vi.mock("../utils/studioSaveDiagnostics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/studioSaveDiagnostics")>()),
  trackStudioSaveFailure,
}));

import { StudioFileConflictError } from "../utils/studioSaveDiagnostics";
import { useEditorSave, type EditorSaveHandle } from "./useEditorSave";
import { flushStudioPendingEdits } from '../utils/studioPendingEdits';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type WriteProjectFile = (path: string, content: string, expectedContent?: string) => Promise<void>;

async function mountEditorSave(writeProjectFile: WriteProjectFile) {
  const captured: { handle: EditorSaveHandle | null } = { handle: null };
  const showToast = vi.fn();

  const editingFileRef = { current: { path: "index.html", content: "before" } };
  const projectIdRef = { current: "project-a" };
  function Probe() {
    captured.handle = useEditorSave({
      editingFileRef, projectIdRef,
      writeProjectFile,
      recordEdit: vi.fn(async () => undefined),
      setRefreshKey: vi.fn(),
      showToast,
    });
    return null;
  }

  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  if (!captured.handle) throw new Error("Editor save handle was not mounted");

  return {
    handle: captured.handle,
    showToast,
    switchFile: async (path: string, content: string) => {
      editingFileRef.current = { path, content };
      await act(async () => root.render(<Probe />));
      return captured.handle!;
    },
    unmount: () => act(async () => root.unmount()),
  };
}

describe("useEditorSave pending work", () => {
  beforeEach(() => {
    trackStudioSaveFailure.mockClear();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 41),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('includes the source buffer in the shared autosave drain without duplicate writes', async () => {
    const write = vi.fn(async () => undefined);
    const mounted = await mountEditorSave(write);
    try {
      act(() => mounted.handle.handleContentChange('latest source'));
      await expect(flushStudioPendingEdits({ blur: false })).resolves.toEqual({ status: 'clean' });
      expect(write).toHaveBeenCalledExactlyOnceWith('index.html', 'latest source', 'before');
      await flushStudioPendingEdits({ blur: false });
      expect(write).toHaveBeenCalledOnce();
    } finally { await mounted.unmount(); }
  });

  it("exposes and flushes the latest buffered source candidate", async () => {
    const writeProjectFile = vi.fn(async () => undefined);
    const mounted = await mountEditorSave(writeProjectFile);
    act(() => mounted.handle.handleContentChange("studio candidate"));

    expect(mounted.handle.getPendingCandidate()).toMatchObject({
      projectId: "project-a",
      path: "index.html",
      content: "studio candidate",
    });
    await expect(mounted.handle.flushPendingSave()).resolves.toEqual({ status: "clean" });
    expect(writeProjectFile).toHaveBeenCalledWith("index.html", "studio candidate", "before");

    await mounted.unmount();
  });

  it("joins an in-flight source save instead of writing the frozen candidate twice", async () => {
    let finishWrite!: () => void;
    const writeProjectFile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const mounted = await mountEditorSave(writeProjectFile);
    act(() => mounted.handle.handleContentChange("candidate"));
    void mounted.handle.flushPendingSave();
    await vi.waitFor(() => expect(writeProjectFile).toHaveBeenCalledOnce());

    const drained = mounted.handle.flushPendingSave();
    expect(writeProjectFile).toHaveBeenCalledOnce();
    finishWrite();
    await expect(drained).resolves.toEqual({ status: "clean" });
    expect(writeProjectFile).toHaveBeenCalledOnce();
    await mounted.unmount();
  });

  it("queues rapid keystrokes against the displayed source, then advances only after the preceding save", async () => {
    let finish!: () => void;
    const write = vi.fn<WriteProjectFile>()
      .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(undefined);
    const mounted = await mountEditorSave(write);
    try {
      act(() => mounted.handle.handleContentChange("human edit"));
      const one = mounted.handle.flushPendingSave();
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      act(() => mounted.handle.handleContentChange("continued human edit"));
      const two = mounted.handle.flushPendingSave();
      finish();
      await Promise.all([one, two]);
      expect(write.mock.calls).toEqual([
        ["index.html", "human edit", "before"],
        ["index.html", "continued human edit", "human edit"],
      ]);
    } finally { await mounted.unmount(); }
  });

  it("flushes the original file on a switch and keeps only the latest text while a write is pending", async () => {
    let release!: () => void;
    const write = vi.fn<WriteProjectFile>().mockImplementationOnce(() => new Promise<void>(r => { release = r; }))
      .mockResolvedValue(undefined);
    const mounted = await mountEditorSave(write);
    try {
      mounted.handle.handleContentChange("first");
      const nextFile = await mounted.switchFile("other.html", "other");
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      nextFile.handleContentChange("next");
      await nextFile.flushPendingSave();
      const previousFile = await mounted.switchFile("index.html", "before");
      for (const text of ["second", "third", "last"]) {
        previousFile.handleContentChange(text);
        void previousFile.flushPendingSave();
      }
      expect(write.mock.calls).toEqual([["index.html", "first", "before"], ["other.html", "next", "other"]]);
      release();
      await previousFile.flushPendingSave();
      expect(write.mock.calls.at(-1)).toEqual(["index.html", "last", "first"]);
      expect(write).toHaveBeenCalledTimes(3);
    } finally { await mounted.unmount(); }
  });

  it("uses the exact accepted source when a write added stable element IDs", async () => {
    const write = vi.fn<WriteProjectFile>().mockImplementation(async (path, submitted) => {
      mounted.handle.acknowledgeSource("project-a", path, submitted, submitted.replace("<p>", "<p data-hf-id='title'>"));
    });
    const mounted = await mountEditorSave(write);
    try {
      mounted.handle.handleContentChange("<p>One</p>");
      const first = mounted.handle.flushPendingSave();
      mounted.handle.handleContentChange("<p>Two</p>");
      await Promise.all([first, mounted.handle.flushPendingSave()]);
      expect(write.mock.calls.map(call => call[2])).toEqual(["before", "<p data-hf-id='title'>One</p>"]);
    } finally { await mounted.unmount(); }
  });

  it("discards text queued behind a conflicting base, then accepts fresh input on the new revision", async () => {
    let refuse!: (e: Error) => void;
    const write = vi.fn<WriteProjectFile>().mockImplementationOnce(() => new Promise<void>((_,r) => { refuse = r; }))
      .mockResolvedValue(undefined);
    const mounted = await mountEditorSave(write);
    try {
      mounted.handle.handleContentChange("old draft");
      const first = mounted.handle.flushPendingSave();
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
      mounted.handle.handleContentChange("another stale edit");
      const queued = mounted.handle.flushPendingSave();
      refuse(new StudioFileConflictError({ syncLatest: true, filePath: "index.html", currentContent: "remote", currentVersion: "v2", attemptedContent: "old draft" }));
      await Promise.all([first, queued]);
      expect(mounted.handle.getPendingCandidate()).toBeNull();
      expect(write).toHaveBeenCalledOnce();
      const fresh = await mounted.switchFile("index.html", "remote");
      fresh.handleContentChange("new edit");
      await fresh.flushPendingSave();
      expect(write).toHaveBeenLastCalledWith("index.html", "new edit", "remote");
    } finally { await mounted.unmount(); }
  });

  it("preserves conflict details when flushing a buffered source candidate", async () => {
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "external-v2",
      currentContent: "external",
      attemptedContent: "studio candidate",
    });
    const mounted = await mountEditorSave(async () => {
      throw conflict;
    });
    act(() => mounted.handle.handleContentChange("studio candidate"));

    await expect(mounted.handle.flushPendingSave()).resolves.toEqual({
      status: "conflict",
      error: conflict,
    });
    expect(trackStudioSaveFailure).toHaveBeenCalledWith({
      source: "code_editor",
      error: conflict,
      filePath: "index.html",
    });

    await mounted.unmount();
  });

  it("emits one identical failure per five-second burst", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const error = new Error("Load failed");
    const mounted = await mountEditorSave(async () => {
      throw error;
    });

    act(() => mounted.handle.handleContentChange("first candidate"));
    await mounted.handle.flushPendingSave();
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    act(() => mounted.handle.handleContentChange("second candidate"));
    await mounted.handle.flushPendingSave();

    expect(trackStudioSaveFailure).toHaveBeenCalledOnce();
    expect(mounted.showToast).toHaveBeenCalledOnce();
    await mounted.unmount();
  });

  it("emits a changed failure immediately and repeats after the burst window", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const writeProjectFile = vi
      .fn<WriteProjectFile>()
      .mockRejectedValueOnce(new Error("Load failed"))
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockRejectedValueOnce(new Error("Failed to fetch"));
    const mounted = await mountEditorSave(writeProjectFile);

    act(() => mounted.handle.handleContentChange("first candidate"));
    await mounted.handle.flushPendingSave();
    now.mockReturnValue(2_000);
    act(() => mounted.handle.handleContentChange("second candidate"));
    await mounted.handle.flushPendingSave();
    now.mockReturnValue(8_000);
    act(() => mounted.handle.handleContentChange("third candidate"));
    await mounted.handle.flushPendingSave();

    expect(trackStudioSaveFailure).toHaveBeenCalledTimes(3);
    await mounted.unmount();
  });

  it("emits the same failure again after a successful save", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const writeProjectFile = vi
      .fn<WriteProjectFile>()
      .mockRejectedValueOnce(new Error("Load failed"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Load failed"));
    const mounted = await mountEditorSave(writeProjectFile);

    act(() => mounted.handle.handleContentChange("first candidate"));
    await mounted.handle.flushPendingSave();
    act(() => mounted.handle.handleContentChange("successful candidate"));
    await mounted.handle.flushPendingSave();
    act(() => mounted.handle.handleContentChange("third candidate"));
    await mounted.handle.flushPendingSave();

    expect(trackStudioSaveFailure).toHaveBeenCalledTimes(2);
    await mounted.unmount();
  });

  it("discards an buffered candidate without persisting it", async () => {
    const writeProjectFile = vi.fn(async () => undefined);
    const mounted = await mountEditorSave(writeProjectFile);
    act(() => mounted.handle.handleContentChange("discard me"));
    act(() => mounted.handle.discardPendingSave());

    expect(mounted.handle.getPendingCandidate()).toBeNull();
    await expect(mounted.handle.flushPendingSave()).resolves.toEqual({ status: "clean" });
    expect(writeProjectFile).not.toHaveBeenCalled();


    await mounted.unmount();
  });
});
