import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { applyTextPatch, validateTextPatchStructure, type TextPatch } from '../../shared/text-patch.ts';
import type { BlobScope } from '../../src/contracts/storage.ts';
import { createDbHandle } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { workspaceBlobKey } from '../../src/infra/storage.ts';
import { mapPatchBoundariesToParent, prepareFullBaseline, validateTextPatch } from '../../src/services/text-patch-boundaries.ts';
import { sha256Hex } from '../../src/studio/etag.ts';

it('rejects ambiguous, overlapping and non-text splices before accessing storage', () => {
  for (const patch of [
    [[1, 0, '']], [[1, 0, '!'], [1, 1, 'x']], [[0, 2, ''], [1, 0, '!']],
    [[3, 1, '']], [[0, -1, 'a']], [[0, 0, '\0']], [[0, 0, '\uD800']], [[Number.MAX_SAFE_INTEGER, 1, '']],
  ]) assert.throws(() => validateTextPatchStructure(patch, 3, 20), RangeError);
  assert.throws(() => validateTextPatchStructure([[0, 0, '🚀']], 2, 5), RangeError);
  assert.equal(validateTextPatchStructure([[0, 2, '🚀']], 2, 4), 4);
});

it('maps every possible cut through simultaneous edits to the correct UTF-8 boundary', () => {
  const before = '🤖abc中文😀!abc中文🚀a';
  const base = Buffer.from(before);
  const boundaries = Array.from({ length: base.length }, (_, i) => i).filter(i => (base[i] & 0xc0) !== 0x80);
  boundaries.push(base.length);
  for (let i = 0; i < boundaries.length - 5; i++) {
    const patch: TextPatch = [
      [boundaries[i], 0, '😊中'], [boundaries[i+1], boundaries[i+3]-boundaries[i+1], ''],
      [boundaries[i+4], boundaries[i+5]-boundaries[i+4], '🟢!'],
    ];
    const edited = Buffer.from(applyTextPatch(before, patch));
    for (let cut = 0; cut <= edited.length; cut++) {
      const check = () => {
        const inherited = mapPatchBoundariesToParent([cut], patch);
        for (const point of inherited) assert.notEqual(base[point] & 0xc0, 0x80);
      };
      if ((edited[cut] & 0xc0) === 0x80) assert.throws(check);
      else check();
    }
  }
});

const connectionString = process.env.OPENMOTION_TEST_DATABASE_URL;
it('validates cold and warm physical snapshots, cross-block characters, inherited and inserted bytes and checkpoints', { skip: !connectionString }, async () => {
  await runMigrations({ connectionString });
  const { db, pool, close } = createDbHandle({ connectionString: connectionString! });
  const workspaceId = randomUUID(), projectId = randomUUID(), user = randomUUID(), session = randomUUID();
  const prefix = 'a'.repeat(65535), text = prefix + '🚀中' + 'x'.repeat(65536);
  const bytes = Buffer.from(text), baseId = sha256Hex(bytes);
  let reads = 0;
  const storage = { async getObjectBuffer(key: string) {
    assert.equal(key, workspaceBlobKey(workspaceId, baseId));
    reads++;
    return bytes;
  } };
  const scope = { workspaceId, projectId };
  const check = (blobScope: BlobScope, sha256: string, sizeBytes: number, patch: unknown) =>
    validateTextPatch(db, { ...scope, storage, base: { blobScope, sha256, sizeBytes }, patch });
  try {
    await pool.query('INSERT INTO users(id,oidc_sub,display_name) VALUES($1,$2,$2)', [user, user]);
    await pool.query('INSERT INTO workspaces(id,slug,name,owner_user_id) VALUES($1,$2,$2,$3)', [workspaceId, workspaceId, user]);
    await pool.query("INSERT INTO sessions(id,workspace_id,title) VALUES($1,$2,'test')", [session, workspaceId]);
    await pool.query("INSERT INTO projects(id,workspace_id,session_id,title,revision) VALUES($1,$2,$3,'test',$4)", [projectId, workspaceId, session, '0'.repeat(64)]);
    assert.equal(await check('workspace', baseId, bytes.length, [[65535, 4, 'Q']]), bytes.length - 3);
    assert.equal(reads, 1);
    await assert.rejects(check('workspace', baseId, bytes.length, [[65536, 0, '!']]), /UTF-8 character/);
    assert.equal(reads, 1);
    const prior: TextPatch = [[0,0,'🚀'],[65535,4,'x']];
    const sizeBytes = bytes.length + 1, id = randomBytes(32).toString('hex');
    await pool.query("INSERT INTO project_text_revisions(workspace_id,project_id,id,parent_scope,parent_id,patch,size_bytes,depth,chain_patch_bytes) VALUES($1,$2,$3,'workspace',$4,$5::jsonb,$6,1,$7)",
      [workspaceId, projectId, id, baseId, JSON.stringify(prior), sizeBytes, Buffer.byteLength(JSON.stringify(prior))]);
    await assert.rejects(check('patch', id, sizeBytes, [[2,0,'!']]), /UTF-8 character/);
    await assert.rejects(check('patch', id, sizeBytes, [[65541,0,'!']]), /UTF-8 character/);
    assert.equal(await check('patch', id, sizeBytes, [[65539,1,'!']]), sizeBytes);
    assert.equal(reads, 1);
    const next = Buffer.from(applyTextPatch(text, prior));
    const checkpoint = sha256Hex(next);
    await prepareFullBaseline(db, { ...scope, scope: 'workspace', bytes: next, id: checkpoint });
    await pool.query('UPDATE project_text_revisions SET checkpoint_sha=$1 WHERE id=$2', [checkpoint,id]);
    await assert.rejects(check('patch', id, sizeBytes, [[2,0,'!']]), /UTF-8 character/);
    assert.equal(await check('patch', id, sizeBytes, [[65539,1,'!']]), sizeBytes);
    assert.equal(reads, 1);
    assert.deepEqual((await pool.query('SELECT octet_length(continuations) AS n FROM project_text_boundary_blocks WHERE project_id=$1 AND snapshot_sha=$2 ORDER BY block_index', [projectId, baseId])).rows.map(r => r.n), [0, 8192, 0]);
  } finally {
    await pool.query('DELETE FROM workspaces WHERE id=$1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id=$1', [user]);
    await close();
  }
});
