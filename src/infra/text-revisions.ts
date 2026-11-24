import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { sql } from 'drizzle-orm';
import { applyTextPatchBytes, type TextPatch } from '../../shared/text-patch.ts';
import { CloudError } from '../contracts/errors.ts';
import type { BlobScope, StoragePort } from '../contracts/storage.ts';
import { withBlobGcRetry } from '../db/cas.ts';
import type { Database, DbExecutor } from '../db/client.ts';
import { formatFileVersion } from '../studio/etag.ts';
import { MAX_TEXT_BYTES, prepareFullBaseline } from './text-snapshot-boundaries.ts';
import { catalogBlobKey, workspaceBlobKey } from './storage.ts';

export const TEXT_REVISION_MAX_DEPTH = 32;
export const TEXT_REVISION_MAX_CHAIN_BYTES = 256 * 1024;
type Ref = { scope: BlobScope; id: string; sha256?: string };
type RevisionRow = {
  id: string; parent_scope: BlobScope; parent_id: string; checkpoint_sha: string | null;
  patch: TextPatch; size_bytes: number; mime_type: string;
};

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const missing = () => new CloudError('NOT_FOUND', 'Text revision not found.', { status: 404 });
const corrupt = () => new CloudError('STORAGE_ERROR', 'Text revision cannot be reconstructed.', { status: 500 });

/** Walk only the immutable ancestors needed for this target, in one database round trip. */
export async function loadTextRevisionChain(db: DbExecutor, workspace: string, id: string, fromVersion?: string) {
  const fromId = /^"patch:([a-f0-9]{64})"$/.exec(fromVersion ?? '')?.[1] ?? '';
  const { rows } = await db.execute<RevisionRow>(sql`
    WITH RECURSIVE chain AS (
      SELECT r.*, 0 AS hop FROM project_text_revisions r WHERE workspace_id = ${workspace} AND id = ${id}
      UNION ALL
      SELECT p.*, c.hop + 1 FROM chain c JOIN project_text_revisions p
        ON p.workspace_id = c.workspace_id AND p.id = c.parent_id AND p.project_id = c.project_id
      WHERE c.parent_scope = 'patch' AND c.checkpoint_sha IS NULL AND c.id <> ${fromId}
        AND c.hop < ${TEXT_REVISION_MAX_DEPTH}
    )
    SELECT id, parent_scope, parent_id, checkpoint_sha, size_bytes, mime_type,
      CASE WHEN checkpoint_sha IS NULL AND id <> ${fromId} THEN patch END AS patch
    FROM chain ORDER BY hop DESC
  `);
  if (!rows.length) throw missing();
  const oldest = rows[0];
  let base: Ref;
  let changes = rows;
  if (oldest.checkpoint_sha || oldest.id === fromId) {
    base = { scope: 'patch', id: oldest.id, ...(oldest.checkpoint_sha && { sha256: oldest.checkpoint_sha }) };
    changes = rows.slice(1);
  } else {
    if (oldest.parent_scope === 'patch') throw corrupt();
    base = { scope: oldest.parent_scope, id: oldest.parent_id, sha256: oldest.parent_id };
  }
  if (changes.length > TEXT_REVISION_MAX_DEPTH) throw corrupt();
  const target = rows[rows.length - 1];
  return {
    base, sizeBytes: target.size_bytes, mimeType: target.mime_type,
    changes: changes.map(row => ({
      from: formatFileVersion(row.parent_scope, row.parent_id),
      to: formatFileVersion('patch', row.id),
      patch: row.patch,
    })),
  };
}

export class TextRevisionStorage {
  readonly db: Database;
  readonly blobs: Pick<StoragePort, 'getObjectBuffer' | 'putBlobIfAbsent'>;
  constructor(db: Database, blobs: TextRevisionStorage['blobs']) {
    this.db = db;
    this.blobs = blobs;
  }

  async head(workspace: string, id: string) {
    const result = await this.db.execute<{size_bytes: number; mime_type: string}>(sql`
      SELECT size_bytes, mime_type FROM project_text_revisions WHERE workspace_id = ${workspace} AND id = ${id}
    `);
    return result.rows[0] ? { contentLength: result.rows[0].size_bytes, contentType: result.rows[0].mime_type } : null;
  }

  async read(workspace: string, id: string, maxBytes = MAX_TEXT_BYTES, db: DbExecutor = this.db): Promise<Buffer> {
    const { base, changes, sizeBytes } = await loadTextRevisionChain(db, workspace, id);
    if (sizeBytes > maxBytes) throw new CloudError('INVALID_ARGUMENT', 'Revision exceeds read size limit.', { status: 413 });
    const hash = base.sha256!;
    const key = base.scope === 'catalog' ? catalogBlobKey(hash) : workspaceBlobKey(workspace, hash);
    const snapshot = await this.blobs.getObjectBuffer(key, MAX_TEXT_BYTES);
    if (digest(snapshot) !== hash) throw corrupt();
    if (!isUtf8(snapshot)) throw corrupt();
    let bytes: Uint8Array = snapshot;
    for (const change of changes) bytes = applyTextPatchBytes(bytes, change.patch, MAX_TEXT_BYTES);
    if (bytes.byteLength !== sizeBytes) throw corrupt();
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Lock this immutable revision only. Other projects and subsequent reads remain concurrent. */
  async checkpoint(workspace: string, id: string): Promise<string> {
    // This revision is immutable. Reuse its materialization if the collector still owns the CAS row.
    let materialized: { bytes: Buffer; sha: string } | undefined;
    return withBlobGcRetry(() => this.db.transaction(async tx => {
      const result = await tx.execute<{ project_id: string; checkpoint_sha: string | null; mime_type: string }>(sql`
        SELECT project_id, checkpoint_sha, mime_type FROM project_text_revisions
        WHERE workspace_id = ${workspace} AND id = ${id} FOR UPDATE
      `);
      const row = result.rows[0];
      if (!row) throw missing();
      if (row.checkpoint_sha) return row.checkpoint_sha;
      if (!materialized) {
        const bytes = await this.read(workspace, id, MAX_TEXT_BYTES, tx);
        materialized = { bytes, sha: digest(bytes) };
      }
      const { bytes, sha } = materialized;
      const key = workspaceBlobKey(workspace, sha);
      // Lock the content row before publishing the bytes. The GC claim must either precede
      // this transaction (retry) or observe the new checkpoint reference after it commits.
      const claim = await tx.execute(sql`
        INSERT INTO workspace_blobs (workspace_id, sha256, s3_key, size_bytes, mime_type, ref_count, zero_ref_since)
        VALUES (${workspace}, ${sha}, ${key}, ${bytes.length}, ${row.mime_type}, 0, now())
        ON CONFLICT (workspace_id, sha256) DO UPDATE SET sha256 = excluded.sha256 WHERE workspace_blobs.gc_state = 'active'
        RETURNING sha256
      `);
      if (!claim.rows.length) throw new CloudError('BLOB_GC_IN_PROGRESS', 'Checkpoint object is being collected.', { status: 409, applied: false });
      await prepareFullBaseline(tx, { workspaceId: workspace, projectId: row.project_id, scope: 'workspace', id: sha, bytes });
      await this.blobs.putBlobIfAbsent(key, bytes, row.mime_type);
      await tx.execute(sql`UPDATE project_text_revisions SET checkpoint_sha = ${sha} WHERE workspace_id = ${workspace} AND id = ${id}`);
      return sha;
    }));
  }
}
