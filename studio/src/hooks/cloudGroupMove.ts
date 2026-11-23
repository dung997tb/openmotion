import { useCallback, type RefObject } from "react";
import { buildDomEditPatchTarget, type DomEditSelection } from "../components/editor/domEditing";
import { stageElementOffset, type ElementOffsetStagerDeps } from "./elementOffsetStager";
import type { CanvasCommand } from "../../../packages/edit-core/canvas-schema";
import { commitStudioEditBatch } from "../utils/projectEditBatch";
import { readProjectFileContent } from "../utils/studioFileHistory";
import {
  serializeStudioFileMutations,
  type StudioProjectFileWriter,
} from "../utils/studioFileMutationCoordinator";

export interface CanvasGroupWrite {
  path: string;
  command: CanvasCommand;
}

/** Hold every affected file queue until all members are saved in one project revision. */
export function commitCloudGroupMove(
  projectId: string,
  writer: StudioProjectFileWriter,
  edits: CanvasGroupWrite[],
) {
  const paths = [...new Set(edits.map((edit) => edit.path))];
  return serializeStudioFileMutations(writer, paths, async () => {
    const sources = new Map(
      await Promise.all(
        paths.map(async (path) => [path, await readProjectFileContent(projectId, path)] as const),
      ),
    );
    const { applyCanvasCommand } = await import("../../../packages/edit-core/canvas-commands");
    const prepared = edits.map((edit) => {
      const before = sources.get(edit.path)!;
      const after = applyCanvasCommand(before, edit.command);
      sources.set(edit.path, after);
      return { ...edit, before, after };
    });
    if (prepared.every((edit) => edit.before === edit.after)) return false;
    await commitStudioEditBatch(projectId, prepared);
    return true;
  });
}

export function stageCloudGroupOffset(
  selection: DomEditSelection,
  next: { x: number; y: number },
  plain: boolean,
  path: string,
  time: number,
  key: string,
  showToast: ElementOffsetStagerDeps["showToast"],
  batch: CanvasGroupWrite[],
) {
  const target = buildDomEditPatchTarget(selection);
  return stageElementOffset(
    {
      showToast,
      commitPositionPatchToHtml: async (_, operations) => {
        batch.push({
          path,
          command: plain
            ? { kind: "moveCanvasElement", target, ...next, time }
            : { kind: "editElements", patches: [{ target, operations }] },
        });
        return undefined;
      },
    },
    selection,
    next,
    plain,
    key,
  );
}

export function useCloudGroupMove(
  project: RefObject<string | null>,
  writer: StudioProjectFileWriter,
  refreshAnimations: () => void,
  reloadPreview: () => void,
) {
  return useCallback(
    async (edits: CanvasGroupWrite[]) => {
      const pid = project.current;
      if (!pid) throw new Error("No project is open");
      const changed = await commitCloudGroupMove(pid, writer, edits);
      if (changed && pid === project.current && edits.some((edit) => edit.command.kind === "editAnimation")) {
        refreshAnimations();
        reloadPreview();
      }
      return changed;
    },
    [project, writer, refreshAnimations, reloadPreview],
  );
}
