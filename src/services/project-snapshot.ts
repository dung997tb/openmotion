import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/client.ts';
import { applyWorkspaceBlobRefDeltas } from '../db/cas.ts';
import { asInsert, asUpdate } from '../db/helpers.ts';
import { projectFiles, projectVersionFiles, projectVersions } from '../db/schema/project-files.ts';
import { projects } from '../db/schema/projects.ts';

/** Capture the current live manifest under the caller's project row lock. No undo entry or blob read. */
export async function freezeProjectSnapshot(
  tx: DbTransaction, project: typeof projects.$inferSelect,
  files: readonly (typeof projectFiles.$inferSelect)[], summary: string,
): Promise<string> {
  const id = randomUUID();
  const projectId = project.id, workspaceId = project.workspaceId;
  const versionNumber = project.currentVersionNumber + 1;
  const now = new Date();
  await tx.insert(projectVersions).values(asInsert(projectVersions, {
    id, workspaceId, projectId, versionNumber, revision: project.revision, source: 'studio', summary, createdAt: now,
  }));
  if (files.length) {
    await tx.insert(projectVersionFiles).values(files.map(file => asInsert(projectVersionFiles, {
      versionId: id, workspaceId, projectId, path: file.path, blobScope: file.blobScope,
      sha256: file.sha256, sizeBytes: Number(file.sizeBytes), mimeType: file.mimeType,
    })));
    const deltas = files.filter(file => file.blobScope === 'workspace').map(file => ({
      sha256: file.sha256, delta: 1, sizeBytes: Number(file.sizeBytes), mimeType: file.mimeType,
    }));
    await applyWorkspaceBlobRefDeltas(tx, workspaceId, deltas);
  }
  await tx.update(projects).set(asUpdate(projects, {
    currentVersionId: id, currentVersionNumber: versionNumber, updatedAt: now,
  })).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
  return id;
}
