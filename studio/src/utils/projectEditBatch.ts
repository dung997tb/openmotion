import type { ProjectEditCommand } from "../../../packages/edit-core/commands";
import { acknowledgeFileEdit } from "./isolatedEditVersions";
import { studioApiFetch } from "./studioApiFetch";
import { createStudioWriteToken, studioFileContentVersion, studioWriteHeaders } from "./studioFileVersion";
import { createStudioSaveHttpError, retryStudioSave, StudioFileConflictError, StudioSaveNetworkError } from "./studioSaveDiagnostics";
import { trackStudioProjectSave } from "./studioSaveState";

type BatchItem = { path: string; before: string; after: string; command: ProjectEditCommand };

/** The caller holds the file queues. Persist the complete gesture as one version. */
export async function commitStudioEditBatch(projectId: string, edits: readonly BatchItem[]): Promise<void> {
  if (!edits.length) return;
  const original = new Map<string, string>();
  for (const { path, before } of edits) {
    if (!original.has(path)) original.set(path, before);
  }
  const versions = Object.fromEntries(await Promise.all(Array.from(original, async ([path, source]) =>
    [path, await studioFileContentVersion(source)] as const)));
  const requestId = createStudioWriteToken();
  const body = JSON.stringify({
    versions, edit: { kind: "batch", commands: edits.map(({ path, command }) => ({ ...command, compositionPath: path })) },
  });
  await trackStudioProjectSave(projectId, edits[0]!.path, () => retryStudioSave(async () => {
    let response: Response;
    try {
      response = await studioApiFetch(`/api/projects/${encodeURIComponent(projectId)}/edits`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId, ...studioWriteHeaders() },
        body,
      });
    } catch (cause) {
      throw new StudioSaveNetworkError("Failed to save the project edit", { cause });
    }
    if (response.status === 409) {
      const details = await response.json();
      throw new StudioFileConflictError({ filePath: details.path ?? edits[0]!.path,
        currentVersion: details.currentVersion ?? null, currentContent: details.currentContent ?? null,
        attemptedContent: edits.findLast(edit => edit.path === details.path)?.after ?? edits[0]!.after });
    }
    if (!response.ok) throw await createStudioSaveHttpError(response, "Failed to save the project edit");
    const result = await response.json() as { versions: Record<string, string> };
    for (const [path, before] of Object.entries(versions)) {
      acknowledgeFileEdit(projectId, path, before, result.versions[path]);
    }
  }));
}
