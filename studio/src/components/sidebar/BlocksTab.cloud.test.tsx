// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { cleanupMounted, mountHost } from "../ui/mountHost.testHelpers";
import { BlocksTab } from "./BlocksTab";

vi.mock("../../utils/studioApiFetch", () => ({ studioApiFetch: vi.fn() }));

afterEach(cleanupMounted);

it("opens an empty cloud catalog and reuses it when reopened", async () => {
  vi.mocked(studioApiFetch).mockResolvedValueOnce(Response.json({ blocks: [] }));

  const host = mountHost(<BlocksTab />);
  await act(async () => {});
  expect(host.textContent).toContain("No blocks match your search");
  expect(studioApiFetch).toHaveBeenCalledWith("/api/registry/blocks");

  cleanupMounted();
  const reopened = mountHost(<BlocksTab />);
  expect(reopened.textContent).toContain("No blocks match your search");
  expect(studioApiFetch).toHaveBeenCalledTimes(1);
});
