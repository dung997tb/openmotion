// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { beginStudioPendingEdit } from "../utils/studioPendingEdits";
import { rememberSource } from "../utils/confirmedTextSources";
import { usePlayerStore } from "./store/playerStore";
import { scheduleCommittedTimelinePreview } from "./committedTimelinePreview";
import { hasPeerTimingDocument, tryApplyPeerChanges } from "./peerTimingPreview";

vi.mock("./peerTimingPreview", () => ({
  hasPeerTimingDocument: vi.fn(() => true), hasPeerLiveEdit: () => false,
  tryApplyPeerChanges: vi.fn(async () => true),
}));

const update = vi.mocked(tryApplyPeerChanges);
const pid = "project-a";
const path = "index.html";
const source = (version: string) => ({ version, content: "<p>" + version + "</p>" });
function setup() {
  const frame = document.body.appendChild(document.createElement("iframe"));
  usePlayerStore.setState({ timelineProjectId: pid });
  const reload = vi.fn();
  const accepted = (from: string, to: string) => {
    rememberSource(pid, path, source(to));
    scheduleCommittedTimelinePreview(frame, pid, path, { [path]: {
      before: source(from).content, after: source(to).content,
    } }, source(from), reload);
  };
  return { frame, reload, accepted };
}
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it("applies a burst directly from the mounted revision to the last receipt, even if the final edit is a no-op", async () => {
  const { frame, reload, accepted } = setup();
  const last = beginStudioPendingEdit(null);
  accepted("v1", "v2");
  accepted("v2", "v3");
  accepted("v3", "v4");
  expect(update).not.toHaveBeenCalled();
  last.settle();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith(frame, { path, previous: source("v1"), current: source("v4") }, expect.any(Function));
  expect(reload).not.toHaveBeenCalled();
});

it("uses the last accepted receipt when the final write fails", async () => {
  const { accepted } = setup();
  const last = beginStudioPendingEdit(null);
  accepted("v1", "v2");
  last.settle(Promise.reject(new Error("save failed")));
  await vi.waitFor(() => expect(update).toHaveBeenCalledWith(expect.anything(), {
    path, previous: source("v1"), current: source("v2"),
  }, expect.any(Function)));
});

it.each(["conflict", "script", "discontinuity"])("rebuilds just once on %s", async (reason) => {
  const { reload, accepted } = setup();
  const last = beginStudioPendingEdit(null);
  accepted("v1", "v2");
  accepted(reason === "discontinuity" ? "remote" : "v2", "v3");
  if (reason === "conflict") rememberSource(pid, path, source("remote"));
  if (reason === "script") vi.mocked(hasPeerTimingDocument).mockReturnValueOnce(false);
  last.settle();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(update).not.toHaveBeenCalled();
});

it.each(["project", "navigation"])("drops a queued receipt after a %s switch", async (reason) => {
  const { frame, reload, accepted } = setup();
  const last = beginStudioPendingEdit(null);
  accepted("v1", "v2");
  if (reason === "project") usePlayerStore.setState({ timelineProjectId: "project-b" });
  else frame.setAttribute("src", "about:blank#other");
  last.settle();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(update).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
