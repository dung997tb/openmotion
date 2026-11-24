import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { CloudError } from '../contracts/errors.ts';
import type { DbExecutor } from '../db/client.ts';
import { textBoundaryBlocks } from '../db/schema/text-boundaries.ts';

export const BLOCK_BYTES = 64 * 1024;
export const MAX_TEXT_BYTES = 16 * 1024 * 1024;
type Snapshot = { workspaceId: string; projectId: string; scope: 'workspace' | 'catalog'; id: string; bytes: Uint8Array };

function snapshotBlocks({ bytes, id, projectId, workspaceId }: Snapshot) {
  if (bytes.length > MAX_TEXT_BYTES || !isUtf8(bytes)) throw new CloudError('INVALID_ARGUMENT', 'File is not editable UTF-8 text', { status: 400, applied: false });
  if (createHash('sha256').update(bytes).digest('hex') !== id) {
    throw new CloudError('STORAGE_ERROR', 'Snapshot integrity check failed', { status: 500 });
  }
  const rows = [];
  for (let blockIndex = 0; blockIndex < Math.max(1, Math.ceil(bytes.length / BLOCK_BYTES)); blockIndex++) {
    const start = blockIndex * BLOCK_BYTES;
    const length = Math.min(BLOCK_BYTES, bytes.length - start);
    let bitmap: Buffer | undefined;
    for (let i = 0; i < length; i++) {
      if ((bytes[start + i] & 0xc0) !== 0x80) continue;
      bitmap ??= Buffer.alloc(Math.ceil(length / 8));
      bitmap[i >>> 3] |= 1 << (i & 7);
    }
    rows.push({ workspaceId, projectId, snapshotSha: id, blockIndex, continuations: bitmap ?? Buffer.alloc(0) });
  }
  return rows;
}

/** Index the known immutable bytes in the caller's transaction; ASCII blocks cost no bitmap bytes. */
export async function prepareFullBaseline(db: DbExecutor, snapshot: Snapshot): Promise<void> {
  await db.insert(textBoundaryBlocks).values(snapshotBlocks(snapshot)).onConflictDoNothing();
}
