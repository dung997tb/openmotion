import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_PATCH_BYTES, type TextPatch } from '../../shared/text-patch.ts';
import type { AuthContext } from '../contracts/auth.ts';
import { CloudError } from '../contracts/errors.ts';
import type { BlobScope, StoragePort } from '../contracts/storage.ts';
import type { Database, DbTransaction } from '../db/client.ts';
import { projectFiles, projectTextRevisions } from '../db/schema/project-files.ts';
import { TEXT_REVISION_MAX_DEPTH, TEXT_REVISION_MAX_CHAIN_BYTES } from '../infra/text-revisions.ts';
import { formatFileVersion } from '../studio/etag.ts';
import {
  canonicalInputHash, loadProjectOrThrow, MAX_TEXT_FILE_BYTES, normalizeSafeProjectPath, readCommitReceipt,
  type CommitProjectFilesResult, type ProjectFileOp, type ProjectFilesService,
} from './project-files-service.ts';
import { getMotionComponent, prepareMotionComponent } from './motion-component-registry.ts';
import { validateTextPatch } from './text-patch-boundaries.ts';

const version = z.string().regex(/^"(?:sha256|patch):[a-f0-9]{64}"$/);
const splice = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.string()])
  .transform(([offset, removed, insert]) => [offset, removed, insert] as const);
const file = {path: z.string(), baseVersion: version.nullable()};
const batchSchema = z.strictObject({
  files: z.array(z.union([
    z.strictObject({...file, baseVersion: version, patch: z.array(splice).max(4096)}),
    z.strictObject({...file, content: z.string()}),
  ])).min(1).max(256),
  dependencies: z.record(z.string(), version.nullable()).optional(),
  label: z.string().trim().min(1).max(256).optional(),
  undoGroup: z.uuid().optional(),
  installComponent: z.string().min(1).max(200).optional(),
});

function invalid(message: string) {
  return new CloudError('INVALID_ARGUMENT', message, {status: 400, applied: false});
}
export interface PendingTextRevision {
  path: string; parentScope: BlobScope; parentId: string; sizeBytes: number;
  mimeType: string; depth: number; chainPatchBytes: number; patch: TextPatch;
}
export interface TextEditIdentity {
  requestId: string; writeToken?: string; source: 'studio'|'agent';
  // Semantic MCP requests retain their original identity before generating bytes.
  command?: {scope: string; hash: string; result: Record<string, unknown>};
}

/** Called inside the existing project lock, after receipt replay and all file preconditions. */
export async function appendTextRevisions(tx: DbTransaction, workspaceId: string, projectId: string,
  revisions: readonly PendingTextRevision[]) {
  const rows = revisions.map(({path, ...revision}) => ({
    path, record: {...revision, workspaceId, projectId, id: randomBytes(32).toString('hex')},
  }));
  await tx.insert(projectTextRevisions).values(rows.map(({record}) => record));
  return rows.map(({path, record}) => ({
    op: 'upsert' as const, path, blobScope: 'patch' as const, sha256: record.id,
    sizeBytes: record.sizeBytes, mimeType: record.mimeType, isText: true,
  }));
}

export async function commitTextEdits(files: ProjectFilesService, db: Database, storage: StoragePort,
  ctx: AuthContext, projectId: string, body: unknown, identity: TextEditIdentity): Promise<CommitProjectFilesResult> {
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success || !identity.requestId || identity.requestId.length > 100) throw invalid('Supply a valid text edit and request ID');
  const input = parsed.data;
  if (input.installComponent && (input.files.length !== 1 || input.files[0].baseVersion === null ||
      (!files.textPatchWrites && 'patch' in input.files[0]))) {
    throw invalid('Place a component by editing one existing host composition');
  }
  if (input.undoGroup && identity.source !== 'studio') throw invalid('Only continuous Studio edits can share an undo step');
  const targets = new Set<string>();
  const guards = new Map(Object.entries(input.dependencies ?? {}));
  for (const item of input.files) {
    if (item.path !== normalizeSafeProjectPath(item.path, true) || targets.has(item.path)) throw invalid('Use distinct, canonical file paths');
    if (guards.has(item.path) && guards.get(item.path) !== item.baseVersion) throw invalid('Conflicting file versions');
    targets.add(item.path);
    guards.set(item.path, item.baseVersion);
  }
  if (guards.size > 256) throw invalid('Too many files in a text edit');
  for (const path of guards.keys()) if (path !== normalizeSafeProjectPath(path)) throw invalid('Invalid dependency path');

  const scope = identity.command?.scope ?? `project:${projectId}:${identity.source}:text-edits`;
  const hash = identity.command?.hash ?? canonicalInputHash(input);
  await loadProjectOrThrow(db, ctx.workspaceId, projectId, {auth: ctx, allowTrashed: false});
  const item = input.installComponent ? getMotionComponent(input.installComponent) : undefined;
  const catalogPaths = item?.files.map(file => file.target) ?? [];
  if (catalogPaths.some(path => guards.has(path)) || guards.size + catalogPaths.length > 256) {
    throw invalid('Component dependencies must fit this edit and be separate from its text files');
  }
  const observed = await db.select().from(projectFiles).where(and(eq(projectFiles.workspaceId, ctx.workspaceId),
    eq(projectFiles.projectId, projectId), inArray(projectFiles.path, [...guards.keys(), ...catalogPaths])));
  const replay = await readCommitReceipt(db, ctx.workspaceId, scope, identity.requestId, hash);
  if (replay) return replay;
  const rows = new Map(observed.map(row => [row.path, row]));
  for (const [path, expected] of guards) {
    const row = rows.get(path);
    const currentVersion = row ? formatFileVersion(row.blobScope, row.sha256) : null;
    if (expected !== currentVersion) throw new CloudError('VERSION_CONFLICT', 'File changed before this edit', {
      status: 409, applied: false, details: {path, currentVersion, code: 'VERSION_MISMATCH'},
    });
  }
  const revisions: PendingTextRevision[] = [];
  const ops: ProjectFileOp[] = [];
  for (const item of input.files) {
    const parent = rows.get(item.path);
    if (parent && !parent.isText) throw invalid('This file contains binary data');
    if ('content' in item) {
      if (!item.content.isWellFormed() || item.content.includes('\0') || Buffer.byteLength(item.content) > MAX_TEXT_FILE_BYTES) {
        throw invalid('Invalid project text');
      }
      ops.push({op: 'upsert_text', path: item.path, content: item.content, mimeType: parent?.mimeType});
      continue;
    }
    const patchBytes = Buffer.byteLength(JSON.stringify(item.patch));
    if (!parent || patchBytes > MAX_PATCH_BYTES) throw invalid('Invalid patch base or size');
    if (!item.patch.length) continue;
    const sizeBytes = await validateTextPatch(db, {workspaceId: ctx.workspaceId, projectId, base: parent, patch: item.patch, storage});
    let depth = 1;
    let chainPatchBytes = patchBytes;
    if (parent.blobScope === 'patch') {
      const [stored] = await db.select({depth: projectTextRevisions.depth, chainBytes: projectTextRevisions.chainPatchBytes,
        checkpoint: projectTextRevisions.checkpointSha})
        .from(projectTextRevisions).where(and(eq(projectTextRevisions.workspaceId, ctx.workspaceId),
          eq(projectTextRevisions.projectId, projectId), eq(projectTextRevisions.id, parent.sha256)));
      if (!stored) throw new CloudError('STORAGE_ERROR', 'Missing text revision', {status: 500});
      if (!stored.checkpoint && (stored.depth >= TEXT_REVISION_MAX_DEPTH ||
          stored.chainBytes + patchBytes > TEXT_REVISION_MAX_CHAIN_BYTES)) {
        if (!storage.ensureTextCheckpoint) throw new CloudError('STORAGE_ERROR', 'Checkpoint storage is unavailable', {status: 503});
        await storage.ensureTextCheckpoint(ctx.workspaceId, parent.sha256);
      } else if (!stored.checkpoint) {
        depth = stored.depth + 1;
        chainPatchBytes += stored.chainBytes;
      }
    }
    revisions.push({path: item.path, parentScope: parent.blobScope, parentId: parent.sha256, sizeBytes,
      mimeType: parent.mimeType, depth, chainPatchBytes, patch: item.patch});
  }
  if (item) {
    for (const path of catalogPaths) {
      const row = rows.get(path);
      guards.set(path, row ? formatFileVersion(row.blobScope, row.sha256) : null);
    }
    ops.push(...await prepareMotionComponent(item, new Set(rows.keys()), true));
  }
  return files.commitChanges(ctx, {
    projectId, requestId: identity.requestId, idempotencyScope: scope, source: identity.source,
    commandReceipt: {inputHash: hash, result: identity.command?.result ?? {}},
    summary: input.label, writeToken: identity.writeToken, ops, textRevisions: revisions,
    undoGroup: input.undoGroup && `${ctx.userId}:${input.undoGroup}`,
    filePreconditions: [...guards].map(([path, expected]) => expected === null ? {path, ifNoneMatch: '*'} : {path, ifMatch: expected}),
  });
}
