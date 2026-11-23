import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import type { AuthContext } from '../../src/contracts/auth.ts';
import { createDbHandle } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { StorageService, archiveKey, workspaceBlobKey } from '../../src/infra/storage.ts';
import { ProjectArchiveService } from '../../src/services/project-archive-service.ts';
import { ProjectFilesService } from '../../src/services/project-files-service.ts';
import { VersionHistoryService } from '../../src/services/version-history-service.ts';
import { WorkspaceService } from '../../src/services/workspace-service.ts';
import { bundlePreviewInMemory } from '../../src/studio/engine/preview-bundler.ts';
import { sha256Hex } from '../../src/studio/etag.ts';
import { hydrateSnapshotFilesToDir } from '../../src/workers/render-export.ts';
import { readProjectZip } from '../../shared/project-zip.ts';
import { applyTextPatch, TEXT_PATCH_BASE_HEADER } from '../../shared/text-patch.ts';
import { readMcpProjectFile, type ProjectFileQuery } from '../../src/mcp/project-file-read.ts';
import { AssetNamesService } from '../../src/services/asset-names-service.ts';
import { createStudioFilesRoutes } from '../../src/studio/routes/files.ts';
import { createStudioGsapRoutes } from '../../src/studio/routes/gsap.ts';

// Only the object bucket is replaced. Logical references still use the production storage adapter,
// database, manifest, authoring services, signing, archive writer and renderer hydration.
class LocalBucket extends StorageService {
  readonly objects = new Map<string, Buffer>();
  reads = 0;
  writes = 0;
  override async putBlobIfAbsent(key: string, data: Buffer) {
    this.writes++;
    const uploaded = !this.objects.has(key);
    this.objects.set(key, Buffer.from(data));
    return { uploaded };
  }
  override async getObjectBuffer(key: string, limit?: number) {
    const bytes = this.objects.get(key);
    if (!bytes) return super.getObjectBuffer(key, limit);
    this.reads++;
    return bytes;
  }
  override async putObject(key: string, data: Buffer) {
    this.objects.set(key, Buffer.from(data));
  }
}

const connectionString = process.env.OPENMOTION_TEST_DATABASE_URL;
async function fixture() {
  await runMigrations({ connectionString });
  const { db, pool, close } = createDbHandle({ connectionString: connectionString! });
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const auth: AuthContext = { workspaceId, userId, role: 'owner', authMode: 'dev', authMethod: 'dev_bypass', scopes: ['workspace:admin'] };
  const storage = new LocalBucket({ textRevisionDb: db, bucket: 'test', region: 'us-east-1', endpoint: 'http://localhost:9901',
    accessKeyId: 'fixture', secretAccessKey: 'fixture' });
  const events: string[] = [];
  const files = new ProjectFilesService({ db, storage, historyCoalesceWindowMs: 0, textPatchWrites: true,
    eventBus: { async publish(_channel, event) { events.push((event as {type: string}).type); return 1; } },
  });
  const workspace = new WorkspaceService({ db, storage, files });
  const archive = new ProjectArchiveService({ db, storage, files, workspace });
  const history = new VersionHistoryService({ db, storage, historyCoalesceWindowMs: 0 });
  await pool.query('INSERT INTO users(id,oidc_sub,display_name) VALUES ($1,$2,$2)', [userId, userId]);
  await pool.query('INSERT INTO workspaces(id,slug,name,owner_user_id) VALUES ($1,$2,$2,$3)', [workspaceId, workspaceId, userId]);
  return { db, pool, events, storage, auth, workspaceId, files, workspace, archive, history,
    async cleanup() {
      await pool.query('DELETE FROM workspaces WHERE id=$1', [workspaceId]);
      await pool.query('DELETE FROM users WHERE id=$1', [userId]);
      await close();
    },
  };
}

it('reads the same saved patch in preview, history, render, download, ZIP and an independent project copy', {
  skip: !connectionString,
}, async () => {
  const { db, pool, storage, auth, workspaceId, files, workspace, archive, history, cleanup } = await fixture();
  const dir = await mkdtemp(path.join(tmpdir(), 'om-patch-readers-'));
  try {
    const initial = '<!DOCTYPE html><html><body><h1>暖冬片头</h1>' + ' '.repeat(600) + '</body></html>';
    const source = await workspace.createProject(auth, { title: 'Test readers', initialFiles: [{ path: 'index.html', content: initial }] });
    const indexRows = await pool.query('SELECT block_index FROM project_text_boundary_blocks WHERE project_id=$1 AND snapshot_sha=$2',
      [source.projectId, sha256Hex(initial)]);
    assert.equal(indexRows.rowCount, 1);
    const before = (await files.readTextFile(auth, source.projectId, 'index.html'))!;
    const offset = Buffer.byteLength(initial.slice(0, initial.indexOf('暖冬')));
    const expected = initial.replace('暖冬', '🎄圣诞');
    const { versionId, revision, versionsByPath } = await files.commitTextEdits(auth, source.projectId, {
      files: [{ path: 'index.html', baseVersion: before.version, patch: [[offset, Buffer.byteLength('暖冬'), '🎄圣诞']] }],
    }, { requestId: randomUUID(), source: 'studio' });
    const token = versionsByPath['index.html'];
    assert.match(token, /^"patch:[0-9a-f]{64}"$/);
    assert.notEqual(token.slice(7, -1), sha256Hex(expected));
    const virtual = await files.loadVirtualProject(auth, source.projectId);
    assert.equal(virtual.readText('index.html'), expected);
    assert.equal(virtual.getFileVersion('index.html'), token);
    assert.match((await bundlePreviewInMemory(virtual, { skipDeterministicFonts: true }))!, /🎄圣诞片头/);
    await hydrateSnapshotFilesToDir({ storage, workspaceId, files: virtual.listFiles(), projectDir: dir, compositionPath: 'index.html' });
    assert.equal(await readFile(path.join(dir, 'index.html'), 'utf8'), expected);
    assert.equal(storage.objects.has(workspaceBlobKey(workspaceId, sha256Hex(expected))), false);

    const zip = await archive.exportProjects(auth, { projectIds: [source.projectId], expectedRevisions: { [source.projectId]: revision }, requestId: randomUUID() });
    const exported = zip.projects[0];
    assert.equal(exported.revision, revision);
    const zipContent = readProjectZip(storage.objects.get(archiveKey(workspaceId, zip.archiveId))!).get(`${exported.folder}/index.html`)!.toString();
    assert.equal(zipContent, expected);

    const point = await workspace.getProject(auth, source.projectId);
    const undoEntries = await history.listHistory(auth, source.projectId);
    const mcpFile = (query: Omit<ProjectFileQuery, 'path'>) => readMcpProjectFile(
      { db, storage, files, expiresInSec: 60 }, auth, source.projectId, { ...query, path: 'index.html', atProjectVersion: versionId! });
    const text = await mcpFile({ mode: 'read' });
    assert.equal(text.fileVersion, token);
    assert.ok('content' in text && text.content === zipContent);
    const delta = await mcpFile({ mode: 'sync', fromFileVersion: before.version });
    assert.ok('patches' in delta && !('baseline' in delta));
    assert.equal(delta.patches.length, 1);
    assert.equal(delta.patches[0].from, before.version);
    assert.equal(delta.patches[0].to, token);
    assert.equal(applyTextPatch(initial, delta.patches[0].patch), zipContent);
    const fresh = await mcpFile({ mode: 'sync' });
    assert.ok('baseline' in fresh && fresh.baseline);
    assert.equal(fresh.baseline.fileVersion, before.version);
    assert.deepEqual(fresh.patches, delta.patches);

    const signed = (await files.presignFileGet(auth, source.projectId, 'index.html'))!;
    const cas = workspaceBlobKey(workspaceId, sha256Hex(expected));
    assert.ok(new URL(signed.url).pathname.endsWith('/' + cas));
    assert.equal(signed.etag, token);
    assert.equal(storage.objects.get(cas)?.toString(), expected);
    const link = await mcpFile({ mode: 'download', atFileVersion: token });
    assert.ok('downloadUrl' in link && new URL(link.downloadUrl).pathname.endsWith('/' + cas));
    assert.equal(link.fileVersion, token);
    const partial = await mcpFile({ mode: 'read', length: 5 });
    assert.ok('nextOffset' in partial);
    await mcpFile({ mode: 'read', offset: partial.nextOffset, atFileVersion: token });
    assert.deepEqual(await workspace.getProject(auth, source.projectId), point);
    assert.deepEqual(await history.listHistory(auth, source.projectId), undoEntries);
    await history.step(auth, source.projectId, 'back');
    assert.equal((await files.readTextFile(auth, source.projectId, 'index.html'))?.content, initial);
    const historical = (await history.peekPoint(auth, source.projectId, versionId!, 'index.html')).file!;
    assert.equal(historical.content, expected);
    assert.equal(historical.version, token);
    assert.equal(historical.sha256, sha256Hex(expected));
    for (const id of [historical.blobId, historical.sha256]) {
      assert.equal((await history.readHistoryBlob(auth, source.projectId, id)).buffer.toString(), expected);
    }
    await history.step(auth, source.projectId, 'forward');
    assert.equal((await files.readTextFile(auth, source.projectId, 'index.html'))?.version, token);
    const copy = await archive.duplicateProject(auth, source.projectId);
    await pool.query('DELETE FROM projects WHERE id=$1', [source.projectId]);
    assert.equal((await files.readTextFile(auth, copy.projectId, 'index.html'))?.content, expected);
    assert.equal((await files.getFile(auth, copy.projectId, 'index.html'))?.blobScope, 'workspace');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await cleanup();
  }
});

it('checks GSAP ETags before fetching either a full blob or a patch, and parses the authorized version on a miss', {
  skip: !connectionString,
}, async () => {
  const { db, auth, storage, files, workspace, history, cleanup } = await fixture();
  try {
    const path = 'scene.html';
    const content = '<html><script>const tl = gsap.timeline(); tl.to("#first", { opacity: 1, duration: 1 }, 0);</script></html>';
    const { projectId } = await workspace.createProject(auth, { initialFiles: [{ path, content }] });
    const app = createStudioGsapRoutes({
      db, files, storage, workspace, history, assetNames: new AssetNamesService({ db, files }), resolveAuth: () => auth,
    });
    const read = (etag?: string) => app.request(`/api/projects/${projectId}/gsap-animations/${path}`,
      { headers: etag ? { 'If-None-Match': etag } : {} });
    const getFile = files.getFile.bind(files);
    const base = `"sha256:${sha256Hex(content)}"`;
    let metaReads = 0;
    let committedVersion: string | undefined;
    let saveAfterLookup = false;
    files.getFile = async (...args) => {
      metaReads++;
      const ref = await getFile(...args);
      if (saveAfterLookup) {
        saveAfterLookup = false;
        const saved = await files.commitTextEdits(auth, projectId, { files: [
          { path, baseVersion: base, patch: [[content.indexOf('#first'), 6, '#second']] },
        ] }, { source: 'studio', requestId: randomUUID() });
        committedVersion = saved.versionsByPath[path];
      }
      return ref;
    };

    const first = await read();
    const baseEtag = first.headers.get('etag')!;
    assert.equal((await first.json()).version, base);
    storage.reads = 0;
    assert.equal((await read(baseEtag)).status, 304);
    assert.equal(storage.reads, 0);

    saveAfterLookup = true;
    metaReads = 0;
    const captured = await read();
    const older = await captured.json();
    assert.equal(metaReads, 1);
    assert.equal(storage.reads, 1);
    assert.equal(captured.headers.get('etag'), baseEtag);
    assert.equal(older.version, base);
    assert.equal(older.animations[0].targetSelector, '#first');

    const patched = await read(baseEtag);
    const patchEtag = patched.headers.get('etag')!;
    const latest = await patched.json();
    assert.equal(patched.status, 200);
    assert.match(patchEtag, /^"patch:/);
    assert.equal(latest.version, committedVersion);
    assert.equal(latest.animations[0].targetSelector, '#second');
    assert.equal(storage.reads, 2);
    storage.reads = metaReads = 0;
    assert.equal((await read(patchEtag)).status, 304);
    assert.equal(storage.reads, 0);
    assert.equal(metaReads, 1);
  } finally {
    await cleanup();
  }
});

it('retains only promised MCP pages and download bytes through coalesced Studio writes', { skip: !connectionString }, async () => {
  const { db, storage, workspace, auth, pool, cleanup } = await fixture();
  try {
    const path = 'notes.txt';
    const { projectId } = await workspace.createProject(auth, { initialFiles: [{ path, content: 'initial' }] });
    const files = new ProjectFilesService({ db, storage, historyCoalesceWindowMs: 60_000 });
    const windowId = randomUUID();
    const save = (content: string, skipVersion = false) => files.commitChanges(auth, {
      projectId, windowId, skipVersion, source: 'studio', ops: [{ op: 'upsert_text', path, content }],
    });
    const read = (query: Omit<ProjectFileQuery, 'path'> = {}) => readMcpProjectFile(
      { db, storage, files, expiresInSec: 60 }, auth, projectId, { path, ...query });

    const first = await save('first generation');
    await read();
    const second = await save('second generation');
    assert.equal(second.coalesced, true);
    assert.equal(first.versionId, second.versionId);

    const point = await workspace.getProject(auth, projectId);
    const ledger = () => pool.query('SELECT id, seq, version_id, pinned, undone FROM project_history_entries WHERE project_id=$1 ORDER BY seq', [projectId]);
    const undo = (await ledger()).rows;
    const page = await read({ length: 6 });
    await read({ mode: 'download', atFileVersion: page.fileVersion });
    assert.deepEqual(await workspace.getProject(auth, projectId), point);
    assert.deepEqual((await ledger()).rows, undo);
    const third = await save('third generation');
    assert.notEqual(third.versionId, second.versionId);
    const tail = await read({ offset: 6, atProjectVersion: second.versionId!, atFileVersion: page.fileVersion });
    assert.ok('content' in page && 'content' in tail);
    assert.equal(page.content + tail.content, 'second generation');

    const link = await read({ mode: 'download' });
    await save('fourth generation');
    const renewed = await read({ mode: 'download', atFileVersion: link.fileVersion });
    assert.ok('downloadUrl' in link && 'downloadUrl' in renewed);
    assert.equal(new URL(renewed.downloadUrl).pathname, new URL(link.downloadUrl).pathname);
    const pinned = await pool.query('SELECT count(*) FROM project_history_entries WHERE project_id=$1 AND pinned', [projectId]);
    assert.equal(Number(pinned.rows[0].count), 0);

    // If the editor wins while the first page is in flight, no invalid continuation is published.
    const readTextBlob = files.readTextBlob.bind(files);
    files.readTextBlob = async (...args) => {
      files.readTextBlob = readTextBlob;
      await save('racing writer');
      return readTextBlob(...args);
    };
    await assert.rejects(read({ length: 2 }), { code: 'VERSION_CONFLICT' });
    const retried = await read({ length: 2 });
    assert.ok('content' in retried && retried.content === 'ra');

    // A live metadata file can be newer than every saved manifest. Retaining it
    // creates one immutable manifest, without inventing a user action or reading any blob.
    await save('unversioned metadata', true);
    const unversioned = await read({ mode: 'download' });
    await save('later metadata', true);
    const frozen = await read({ atFileVersion: unversioned.fileVersion });
    assert.ok('content' in frozen && frozen.content === 'unversioned metadata');
  } finally {
    await cleanup();
  }
});

it('serves a direct parent delta, a skipped-version full file, and readable snapshots after disabling patch writes', {
  skip: !connectionString,
}, async () => {
  const { db, auth, storage, files, workspace, history, cleanup } = await fixture();
  try {
    const path = 'title.txt', initial = 'title 48px';
    const { projectId } = await workspace.createProject(auth, { initialFiles: [{ path, content: initial }] });
    const assetNames = new AssetNamesService({ db, files });
    const routes = (files: ProjectFilesService) => createStudioFilesRoutes({
      db, files, storage, workspace, history, assetNames, resolveAuth: () => auth,
    });
    const app = routes(files);
    const url = `/api/projects/${projectId}/files/${path}`;
    const baseline = (await files.readTextFile(auth, projectId, path))!.version;
    const save = async (baseVersion: string, size: string) => (await files.commitTextEdits(auth, projectId, {
      files: [{ path, baseVersion, patch: [[6, 2, size]] }],
    }, { requestId: randomUUID(), source: 'studio' })).versionsByPath[path];
    const one = await save(baseline, '52'), two = await save(one, '64');
    const same = await app.request(url, { headers: { 'If-None-Match': two } });
    assert.equal(same.status, 304);
    assert.equal(same.headers.get('ETag'), two);

    storage.reads = 0;
    const direct = await app.request(url, { headers: { [TEXT_PATCH_BASE_HEADER]: one } });
    assert.equal(direct.headers.get('X-OpenMotion-Representation'), 'text-patch');
    assert.equal(applyTextPatch('title 52px', (await direct.json()).patch), 'title 64px');
    assert.equal(storage.reads, 0);
    const missed = await app.request(url, { headers: { [TEXT_PATCH_BASE_HEADER]: baseline } });
    assert.equal(missed.headers.get('X-OpenMotion-Representation'), null);
    assert.equal((await missed.json()).content, 'title 64px');

    const disabled = new ProjectFilesService({ db, storage });
    const full = await routes(disabled).request(url, { headers: { [TEXT_PATCH_BASE_HEADER]: one } });
    assert.equal(full.headers.get('X-OpenMotion-Text-Edits'), null);
    assert.equal((await full.json()).content, 'title 64px');
    const sync = await readMcpProjectFile({ db, files: disabled, storage, expiresInSec: 60 }, auth, projectId,
      { path, mode: 'sync', fromFileVersion: one });
    assert.ok('baseline' in sync && sync.baseline?.fileVersion === two);
    assert.deepEqual(sync.patches, []);
  } finally {
    await cleanup();
  }
});

it('serializes writes per file, preserves batch atomicity and retries, and avoids object I/O on small edits', {
  skip: !connectionString,
}, async () => {
  const { pool, events, storage, auth, files, workspace, cleanup } = await fixture();
  try {
    const initial = '🎄' + 'A'.repeat(256);
    const paths = ['one.txt', 'two.txt', 'left.txt', 'right.txt'];
    const { projectId } = await workspace.createProject(auth, {
      initialFiles: paths.map(path => ({ path, content: initial })),
    });
    const baseline = `"sha256:${sha256Hex(initial)}"`;
    const edit = (path: string, baseVersion: string, text: string) => ({ path, baseVersion, patch: [[4, 1, text]] });
    const save = (changes: unknown[], dependencies?: Record<string, string>, requestId: string = randomUUID()) =>
      files.commitTextEdits(auth, projectId, { files: changes, dependencies }, { source: 'studio', requestId });
    const versions = async () => Number((await pool.query('SELECT count(*) AS n FROM project_versions WHERE project_id=$1', [projectId])).rows[0].n);
    storage.reads = storage.writes = 0;
    const [one, two] = await Promise.all([save([edit(paths[0], baseline, '1')]), save([edit(paths[1], baseline, '2')])]);
    assert.equal(await versions(), 3);
    const oneVersion = one.versionsByPath[paths[0]];
    const twoVersion = two.versionsByPath[paths[1]];
    assert.deepEqual([storage.reads, storage.writes], [0, 0]);

    // The winning batch updates its companion. The rejected batch cannot alter its companion.
    const compete = (n: number) => save([edit(paths[0], oneVersion, String(n)), edit(paths[n], baseline, String(n))]);
    const raced = await Promise.allSettled([compete(2), compete(3)]);
    const loser = raced.findIndex(outcome => outcome.status === 'rejected');
    assert.equal(raced.filter(outcome => outcome.status === 'rejected').length, 1);
    assert.equal((raced[loser] as PromiseRejectedResult).reason.status, 409);
    const untouched = paths[loser + 2];
    assert.equal((await files.getFile(auth, projectId, untouched))?.sha256, sha256Hex(initial));
    assert.equal(await versions(), 4);

    const sameEdit = [edit(untouched, baseline, 'x')];
    const requestId = randomUUID();
    const beforeEvents = events.length;
    const receipts = await Promise.all([save(sameEdit, undefined, requestId), save(sameEdit, undefined, requestId)]);
    assert.equal(receipts.filter(r => r.replayed).length, 1);
    assert.equal(receipts[0].versionId, receipts[1].versionId);
    assert.deepEqual(events.slice(beforeEvents).sort(), ['file-change', 'history-changed']);
    assert.equal(await versions(), 5);
    await assert.rejects(save([edit(paths[1], twoVersion, '!')], { [paths[0]]: oneVersion }), { status: 409 });
    await assert.rejects(save([{ path: paths[1], baseVersion: twoVersion, patch: [[1, 1, 'x']] }]), { status: 400 });
    assert.equal(await versions(), 5);
    assert.deepEqual([storage.reads, storage.writes], [0, 0]);

    // A generated checkpoint already owns its UTF-8 index. Editing the middle of its
    // original text takes no further object read to validate byte offsets.
    await storage.ensureTextCheckpoint(auth.workspaceId, twoVersion.slice(7, -1));
    storage.reads = storage.writes = 0;
    const checked = await save([{ path: paths[1], baseVersion: twoVersion, patch: [[100, 1, 'q']] }]);
    assert.deepEqual([storage.reads, storage.writes], [0, 0]);
    const rewritten = 'a complete replacement\n';
    const full = await save([{ path: paths[1], baseVersion: checked.versionsByPath[paths[1]], content: rewritten }]);
    assert.equal(full.versionsByPath[paths[1]], `"sha256:${sha256Hex(rewritten)}"`);
    assert.deepEqual([storage.reads, storage.writes], [0, 1]);
    assert.equal((await files.readTextFile(auth, projectId, paths[1]))?.content, rewritten);
  } finally {
    await cleanup();
  }
});

it('checkpoints the parent before cumulative UTF-8 patch bytes would exceed 256 KiB', { skip: !connectionString }, async () => {
  const { auth, files, workspace, storage, pool, cleanup } = await fixture();
  try {
    const { projectId } = await workspace.createProject(auth, { initialFiles: [{ path: 'index.html', content: 'x' }] });
    let version = `"sha256:${sha256Hex('x')}"`;
    const inserted = '🌙'.repeat(14_000); // 56,000 UTF-8 bytes
    const patch = [[1, 0, inserted]];
    const encodedBytes = Buffer.byteLength(JSON.stringify(patch));
    storage.reads = storage.writes = 0;
    for (let i = 1; i <= 5; i++) {
      const previous = version;
      version = (await files.commitTextEdits(auth, projectId, { files: [{ path: 'index.html', baseVersion: version, patch }] },
        { requestId: randomUUID(), source: 'studio' })).versionsByPath['index.html'];
      const { rows: [row] } = await pool.query('SELECT depth,chain_patch_bytes FROM project_text_revisions WHERE workspace_id=$1 AND id=$2',
        [auth.workspaceId, version.slice(7, -1)]);
      const depth = i === 5 ? 1 : i;
      assert.deepEqual(row, { depth, chain_patch_bytes: depth * encodedBytes });
      assert.deepEqual([storage.reads, storage.writes], i === 5 ? [1, 1] : [0, 0]);
      if (i === 5) {
        const { rows: [parent] } = await pool.query('SELECT checkpoint_sha FROM project_text_revisions WHERE workspace_id=$1 AND id=$2',
          [auth.workspaceId, previous.slice(7, -1)]);
        assert.equal(parent.checkpoint_sha, sha256Hex('x' + inserted.repeat(4)));
      }
    }
    assert.equal((await files.readTextFile(auth, projectId, 'index.html'))?.content, 'x' + inserted.repeat(5));
  } finally {
    await cleanup();
  }
});
