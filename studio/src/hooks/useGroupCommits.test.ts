// @vitest-environment jsdom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { rememberSource } from "../utils/confirmedTextSources";
import type { TimelineElement } from "../player";
import { computeGroupGeometry, resolveGroupChildTracks, useGroupCommits } from "./useGroupCommits";
import { installReactActEnvironment, makeSelection, mountReactHarness } from "./domSelectionTestHarness";

const timelineElement = (over: Partial<TimelineElement> = {}): TimelineElement => ({
  id: "clip",
  domId: "clip",
  tag: "div",
  start: 0,
  duration: 4,
  track: 0,
  sourceFile: "index.html",
  ...over,
});

describe("computeGroupGeometry — track threading", () => {
  it("carries each member's authored track onto its rebase entry, so the server can pin it through the wrap", () => {
    const elA = document.createElement("div");
    elA.id = "clip-a";
    const elB = document.createElement("div");
    elB.id = "clip-b";
    const members = [makeSelection("A", elA), makeSelection("B", elB)];
    const timelineElements = [
      timelineElement({ id: "clip-a", domId: "clip-a", authoredTrack: 2 }),
      timelineElement({ id: "clip-b", domId: "clip-b" }),
    ];

    const { rebases } = computeGroupGeometry(members, timelineElements);

    expect(rebases[0]?.track).toBe(2);
    expect(rebases[1]?.track).toBe(0);
  });
});

describe("resolveGroupChildTracks", () => {
  it("resolves each child's authored track by DOM id, so ungroup can pin it through the unwrap", () => {
    const group = document.createElement("div");
    group.id = "group-1";
    const childA = document.createElement("div");
    childA.id = "child-a";
    const childB = document.createElement("div");
    childB.id = "child-b";
    group.append(childA, childB);

    const timelineElements = [
      timelineElement({ id: "child-a", domId: "child-a", authoredTrack: 1 }),
      timelineElement({ id: "child-b", domId: "child-b" }),
    ];

    const result = resolveGroupChildTracks(makeSelection("Group 1", group), timelineElements);

    expect(result).toEqual([
      { target: { id: "child-a", hfId: undefined }, track: 1 },
      { target: { id: "child-b", hfId: undefined }, track: 0 },
    ]);
  });

  it("resolves a child's track by hfId when it has no DOM id, so an unauthored ungroup child can't drift to a new row", () => {
    const group = document.createElement("div");
    group.id = "group-1";
    const child = document.createElement("div");
    child.setAttribute("data-hf-id", "hf-child-a");
    group.append(child);

    const timelineElements = [timelineElement({ hfId: "hf-child-a", authoredTrack: 3 })];

    const result = resolveGroupChildTracks(makeSelection("Group 1", group), timelineElements);

    expect(result).toEqual([{ target: { id: undefined, hfId: "hf-child-a" }, track: 3 }]);
  });

  it("skips a child with neither a DOM id nor an hfId", () => {
    const group = document.createElement("div");
    const anonymous = document.createElement("div");
    group.append(anonymous);

    const result = resolveGroupChildTracks(makeSelection("Group 1", group), []);

    expect(result).toEqual([]);
  });

  it("falls back to the runtime's resolved track for an implicit child with no authoredTrack", () => {
    const group = document.createElement("div");
    group.id = "group-1";
    const child = document.createElement("div");
    child.id = "child-a";
    group.append(child);

    const timelineElements = [timelineElement({ id: "child-a", domId: "child-a", track: 3 })];

    const result = resolveGroupChildTracks(makeSelection("Group 1", group), timelineElements);

    expect(result).toEqual([{ target: { id: "child-a", hfId: undefined }, track: 3 }]);
  });
});

it("writes one guarded change for grouping and ungrouping, and records each accepted change once", async () => {
  installReactActEnvironment();
  const projectId = "group-command-receipts", path = "index.html";
  const before = '<main id="stage" data-composition-id="main"><div id="a"></div><div id="b"></div></main>';
  const parse = (source: string) => new DOMParser().parseFromString(source, "text/html");
  const original = parse(before);
  rememberSource(projectId, path, { content: before, version: '"source-1"' });
  const recordEdit = vi.fn(), writeProjectFile = vi.fn(async (_path: string, content: string) => {
    rememberSource(projectId, path, { content, version: '"source-2"' });
  });
  const params = { projectIdRef: { current: projectId }, activeCompPath: path, timelineElements: [],
    writeProjectFile, editHistory: { recordEdit }, clearDomSelection: vi.fn(), reloadPreview: vi.fn(), showToast: vi.fn() };
  let hooks!: ReturnType<typeof useGroupCommits>;
  function Harness() { hooks = useGroupCommits(params); return null; }
  const root = mountReactHarness(createElement(Harness));
  try {
    const members = ["a", "b"].map(id => makeSelection(id, original.getElementById(id)!));
    const groupId = await hooks.groupSelection(members);
    expect(writeProjectFile).toHaveBeenCalledTimes(1);
    const grouped = writeProjectFile.mock.calls[0]![1];
    expect(writeProjectFile.mock.calls[0]?.[0]).toBe(path);
    expect(writeProjectFile).toHaveBeenNthCalledWith(1, path, grouped, before);
    const wrapper = parse(grouped).querySelector<HTMLElement>('[data-hf-group]');
    expect(wrapper?.getAttribute('data-hf-group')).toBe(groupId);
    expect(Array.from(wrapper!.children, e => e.id)).toEqual(["a", "b"]);
    await hooks.ungroupSelection(makeSelection(groupId!, wrapper!));
    const ungrouped = writeProjectFile.mock.calls[1]![1];
    expect(writeProjectFile).toHaveBeenNthCalledWith(2, path, ungrouped, grouped);
    expect(parse(ungrouped).getElementById("a")?.parentElement?.id).toBe("stage");
    expect(recordEdit.mock.calls.map(([entry]) => entry.label)).toEqual(["Group elements", "Ungroup elements"]);
    expect(params.showToast).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
});
