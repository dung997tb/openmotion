import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { designProjectsFor } from '../design-projects.ts';
import { gameProjectsFor } from '../game-projects.ts';
import { OpenDesignAccount, AccountRequestError } from '../gateway/account.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { CloudShareError, CloudShareService } from '../gateway/cloud-share.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import { WorkspaceStore } from '../workspace.ts';
import { transport } from './http.ts';

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function withTempWorkspace(run: (store: WorkspaceStore) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'om-cloud-share-test-'));
  try {
    const store = new WorkspaceStore(dir);
    await store.initialize(pluginRoot);
    await run(store);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function seedSignedInAccount(account: OpenDesignAccount, apiUrl = 'https://api.example.test') {
  await mkdir(account.home, { recursive: true, mode: 0o700 });
  await writeFile(path.join(account.root, 'session.json'), JSON.stringify({ id: 'session-test-1' }), 'utf8');
  await writeFile(path.join(account.home, 'config.json'), JSON.stringify({
    profiles: {
      prod: {
        apiUrl,
        controlKey: 'ctrl_test_key',
        controlKeyId: 'ctrl_key_1',
        runtimeKey: 'rt_test_key',
        user: {
          id: 'user_test_1',
          name: 'Maker',
          email: 'maker@example.com',
        },
      },
    },
  }), 'utf8');
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

test('CloudShareService bundles game files and local workspace media assets into relative paths without mutating disk', async () => {
  await withTempWorkspace(async store => {
    const games = gameProjectsFor(store.directory);
    const created = (await games.create({ prompt: 'Bundle Quest arcade game', multiplayer: false })).game;

    const pngPath = path.join(store.directory, 'hero-sprite.png');
    const pngBytes = Buffer.from(TINY_PNG_BASE64, 'base64');
    await writeFile(pngPath, pngBytes);
    const asset = await new AssetLibrary(store).importFile(pngPath, { requestId: 'sprite-1', name: 'Hero Sprite' });
    const assetVersionId = asset.currentVersionId!;
    const mediaUrl = `/motion-api/assets/${asset.id}/versions/${assetVersionId}/media`;
    const localLogicUrl = `/motion-api/games/${created.id}/play/logic.js`;

    await games.write(created.id, [
      {
        path: 'index.html',
        content: `<!doctype html><html><body><img src="${mediaUrl}?v=1" /><script type="module" src="${localLogicUrl}"></script></body></html>`,
      },
      {
        path: 'logic.js',
        content: `export const SPRITE = "${mediaUrl}"; export const score = 10;\n`,
      },
    ]);

    const located = await games.locate(created.id);
    await mkdir(path.join(located.dir, 'trailer'), { recursive: true });
    await writeFile(path.join(located.dir, 'trailer', 'clip.mp4'), 'trailer-placeholder');

    const account = new OpenDesignAccount(store.directory);
    const cloud = new CloudShareService(store, account);

    const bundle = await cloud.buildShareBundle('game-project', created.id);
    assert.equal(bundle.entryPath, 'index.html');
    assert.equal(bundle.bundledAssetCount, 1);

    const expectedAssetPath = `_shared-assets/${asset.id}-${assetVersionId}.png`;
    const bundledAsset = bundle.files.find(f => f.file === expectedAssetPath);
    assert.ok(bundledAsset, `expected bundled asset at ${expectedAssetPath}`);
    assert.deepEqual(bundledAsset.data, pngBytes);

    const htmlFile = bundle.files.find(f => f.file === 'index.html');
    const logicFile = bundle.files.find(f => f.file === 'logic.js');
    assert.ok(htmlFile && logicFile);
    const htmlText = htmlFile.data.toString('utf8');
    const logicText = logicFile.data.toString('utf8');
    assert.match(htmlText, new RegExp(`\\./_shared-assets/${asset.id}-${assetVersionId}\\.png`));
    assert.match(htmlText, /src="\.\/logic\.js"/);
    assert.ok(!htmlText.includes('/motion-api/'), 'rewritten HTML must not leak local /motion-api/ URLs');
    assert.match(logicText, new RegExp(`"\\./_shared-assets/${asset.id}-${assetVersionId}\\.png"`));

    assert.ok(!bundle.files.some(f => f.file.toLowerCase() === 'game.json'), 'game.json must not be uploaded');
    assert.ok(!bundle.files.some(f => f.file.toLowerCase().startsWith('trailer/')), 'trailer/ must not be uploaded');

    // Original files on disk remain untouched.
    const diskHtml = await readFile(path.join(located.dir, 'index.html'), 'utf8');
    assert.ok(diskHtml.includes(mediaUrl));
    assert.ok(diskHtml.includes(localLogicUrl));

    // Signed-out status & publish guard.
    const status = await cloud.status('game-project', created.id);
    assert.equal(status.accountState, 'signed-out');
    assert.equal(status.status, 'none');
    assert.equal(status.url, null);
    assert.equal(status.bundledAssetCount, 1);
    assert.ok(status.fileCount >= 3);

    await assert.rejects(
      () => cloud.publish('game-project', created.id),
      (err: unknown) => err instanceof CloudShareError && err.status === 401 && err.code === 'ACCOUNT_SIGN_IN_REQUIRED',
    );
  });
});

test('OpenDesignAccount workspacePrincipal and CloudShareService publish, detect outdated, stop, resume, and republish', async () => {
  await withTempWorkspace(async store => {
    const games = gameProjectsFor(store.directory);
    const created = (await games.create({ prompt: 'Cloud Orbit', multiplayer: false })).game;
    await games.write(created.id, [
      { path: 'index.html', content: '<!doctype html><html><body><canvas id="c"></canvas><script type="module" src="./logic.js"></script></body></html>' },
      { path: 'logic.js', content: 'export const speed = 1;\n' },
    ]);

    const invocations: Array<{ workspaceId: string; args: string[] }> = [];
    let stagedDirChecked = '';
    let pushCount = 0;

    const fetcher: typeof fetch = async (input, init) => {
      assert.equal(String(input), 'https://api.example.test/api/v1/workspaces');
      assert.equal(init?.method, 'GET');
      assert.equal((init?.headers as Record<string, string>)?.Authorization, 'Bearer ctrl_test_key');
      return new Response(JSON.stringify({
        items: [
          {
            workspaceId: 'ws_team_1',
            workspaceName: 'Team Workspace',
            workspaceMemberId: 'mem_team_1',
            workspaceType: 'team',
            memberStatus: 'active',
            lifecycleState: 'active',
            isDefault: false,
          },
          {
            workspaceId: 'ws_personal_1',
            workspaceName: 'Maker Personal',
            workspaceMemberId: 'mem_personal_1',
            workspaceType: 'personal',
            memberStatus: 'active',
            lifecycleState: 'active',
            isDefault: true,
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const catalogByProject = new Map<string, {
      projectId: string;
      workspaceId: string;
      ownerMemberId: string;
      resourceId: string;
      metadata: Record<string, unknown>;
    }>();

    const account = new OpenDesignAccount(store.directory, {
      fetcher,
      runInWorkspace: async (workspaceId, args) => {
        invocations.push({ workspaceId, args });
        assert.equal(workspaceId, 'ws_personal_1');
        if (args[0] === 'team-projects' && args[1] === 'ensure-private') {
          const cloudProjectId = args[2];
          if (!catalogByProject.has(cloudProjectId)) {
            catalogByProject.set(cloudProjectId, {
              projectId: cloudProjectId,
              workspaceId,
              ownerMemberId: 'mem_personal_1',
              resourceId: 'project-root-1',
              metadata: {},
            });
          }
          return JSON.stringify({ projectId: cloudProjectId, workspaceId });
        }
        if (args[0] === 'team-projects' && args[1] === 'register-resource') {
          return JSON.stringify({ ok: true, projectId: args[2], resourceId: args[3] });
        }
        if (args[0] === 'team-projects' && args[1] === 'get') {
          const cloudProjectId = args[2];
          const row = catalogByProject.get(cloudProjectId);
          if (!row) throw new AccountRequestError('API request failed with status 404: team_project_not_found');
          return JSON.stringify(row);
        }
        if (args[0] === 'team-projects' && args[1] === 'upsert') {
          const cloudProjectId = args[2];
          const row = catalogByProject.get(cloudProjectId);
          assert.ok(row, `expected team project ${cloudProjectId} before upsert`);
          assert.equal(flagValue(args, '--resource-id'), row.resourceId);
          const nextMeta = JSON.parse(flagValue(args, '--metadata-json') || '{}') as Record<string, unknown>;
          const mutation = nextMeta._commentFiles as {
            schemaVersion: number;
            baseRevision: number;
            resourceId: string;
            versionId: string;
            files: Array<{ sourceFileId: string; sourceFilePath: string; entryPath: string; retired: boolean }>;
          };
          assert.equal(mutation?.schemaVersion, 1);
          const current = (row.metadata._commentFiles as {
            schemaVersion: 1;
            revision: number;
            files: Array<{
              sourceFileId: string;
              sourceFilePath: string;
              entryPath: string;
              resourceId: string;
              versionId: string;
              retired: boolean;
            }>;
          } | undefined) ?? { schemaVersion: 1 as const, revision: 0, files: [] };
          assert.equal(mutation.baseRevision, current.revision);
          const files = [...current.files];
          for (const entry of mutation.files) {
            const idx = files.findIndex(f => f.sourceFileId === entry.sourceFileId);
            const fact = {
              sourceFileId: entry.sourceFileId,
              sourceFilePath: entry.sourceFilePath,
              entryPath: entry.entryPath,
              resourceId: mutation.resourceId,
              versionId: mutation.versionId,
              retired: entry.retired,
            };
            if (idx >= 0) files[idx] = fact;
            else files.push(fact);
          }
          row.metadata = {
            ...nextMeta,
            _commentFiles: { schemaVersion: 1, revision: current.revision + 1, files },
          };
          return JSON.stringify({ ok: true });
        }
        if (args[0] === 'resource' && args[1] === 'push') {
          stagedDirChecked = args[4];
          const stagedHtml = await readFile(path.join(stagedDirChecked, 'index.html'), 'utf8');
          assert.match(stagedHtml, /logic\.js/);
          pushCount++;
          return JSON.stringify({ id: `ver_${pushCount}` });
        }
        if (args[0] === 'share' && args[1] === 'publish') {
          const fileResourceId = args[2];
          const cloudProjectId = flagValue(args, '--project-id')!;
          const slug = flagValue(args, '--slug')!;
          const sourceFilePath = flagValue(args, '--source-file-path')!;
          const entryPath = flagValue(args, '--entry-path')!;
          const sourceKey = flagValue(args, '--source-key')!;
          const versionId = flagValue(args, '--version-id')!;
          const row = catalogByProject.get(cloudProjectId);
          const admitted = (row?.metadata._commentFiles as {
            files?: Array<{
              sourceFileId: string;
              sourceFilePath: string;
              entryPath: string;
              resourceId: string;
              versionId: string;
              retired: boolean;
            }>;
          } | undefined)?.files?.find(
            fact => !fact.retired
              && fact.sourceFilePath === sourceFilePath
              && fact.entryPath === entryPath
              && fact.resourceId === fileResourceId
              && fact.versionId === versionId,
          );
          if (!admitted) {
            throw new AccountRequestError(JSON.stringify({
              error: 'publish share: API request failed with status 409: SHARE_GENERATION_MISMATCH',
              errorCode: 'SHARE_GENERATION_MISMATCH',
              status: 409,
            }));
          }
          const expectedSourceKey = `comment-file-v1:${Buffer.from(cloudProjectId, 'utf8').toString('base64url')}:${admitted.sourceFileId}`;
          assert.equal(sourceKey, expectedSourceKey);
          const url = `https://open-design.app/artifact/${encodeURIComponent(cloudProjectId)}/${encodeURIComponent(slug)}`;
          return JSON.stringify({
            status: 'published',
            slug,
            entryPath,
            version: pushCount,
            publishedAt: 1700000000000 + pushCount,
            url,
            snapshot: { versionId },
            receipt: { slug, versionId, entryPath, version: pushCount },
          });
        }
        if (args[0] === 'share' && args[1] === 'stop') {
          return JSON.stringify({ status: 'stopped', slug: args[2] });
        }
        if (args[0] === 'share' && args[1] === 'resume-existing') {
          const slug = args[2];
          const cloudProjectId = flagValue(args, '--project-id')!;
          return JSON.stringify({
            status: 'active',
            slug,
            projectId: cloudProjectId,
            url: `https://open-design.app/artifact/${encodeURIComponent(cloudProjectId)}/${encodeURIComponent(slug)}`,
            version: pushCount,
            versionId: `ver_${pushCount}`,
            publishedAt: 1700000000000 + pushCount,
          });
        }
        throw new Error(`Unexpected Vela args: ${args.join(' ')}`);
      },
    });
    await seedSignedInAccount(account);

    const principal = await account.workspacePrincipal();
    assert.deepEqual(principal, {
      workspaceId: 'ws_personal_1',
      workspaceName: 'Maker Personal',
      workspaceMemberId: 'mem_personal_1',
      workspaceType: 'personal',
    });

    const cloud = new CloudShareService(store, account);
    const published = await cloud.publish('game-project', created.id);
    assert.equal(published.status, 'active');
    assert.equal(published.freshness, 'fresh');
    assert.equal(published.version, 1);
    assert.equal(published.workspaceName, 'Maker Personal');
    assert.equal(published.accountEmail, 'maker@example.com');
    assert.match(published.url ?? '', new RegExp(`^https://open-design\\.app/artifact/om-game-${created.id}/[0-9a-f-]+$`));
    assert.ok(stagedDirChecked);
    await assert.rejects(() => stat(stagedDirChecked), /ENOENT/);

    // Editing a local file makes the live link outdated without discarding the URL.
    await games.write(created.id, [{ path: 'logic.js', content: 'export const speed = 3;\n' }]);
    const outdated = await cloud.status('game-project', created.id);
    assert.equal(outdated.status, 'active');
    assert.equal(outdated.freshness, 'outdated');
    assert.equal(outdated.url, published.url);

    // Stopping disables public access while preserving slug reservation.
    const stopped = await cloud.stop('game-project', created.id);
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.slug, published.slug);

    // Resuming reopens the exact same slug and URL.
    const resumed = await cloud.resume('game-project', created.id);
    assert.equal(resumed.status, 'active');
    assert.equal(resumed.slug, published.slug);
    assert.equal(resumed.url, published.url);

    // Republishing from a stopped state automatically runs share resume-existing before share publish and reuses slug.
    await cloud.stop('game-project', created.id);
    const invStart = invocations.length;
    const republished = await cloud.publish('game-project', created.id);
    const republishCommands = invocations.slice(invStart).map(entry => `${entry.args[0]}:${entry.args[1]}`);
    assert.deepEqual(republishCommands, [
      'team-projects:ensure-private',
      'team-projects:register-resource',
      'resource:push',
      'team-projects:get',
      'team-projects:upsert',
      'team-projects:get',
      'share:resume-existing',
      'share:publish',
    ]);
    assert.equal(republished.status, 'active');
    assert.equal(republished.freshness, 'fresh');
    assert.equal(republished.slug, published.slug);
    assert.equal(republished.url, published.url);
    assert.equal(republished.version, 2);

    const parsedJsonErr = new AccountRequestError(JSON.stringify({
      error: 'publish share: API request failed with status 409: SHARE_GENERATION_MISMATCH',
      errorCode: 'SHARE_GENERATION_MISMATCH',
      status: 409,
    }));
    assert.equal(parsedJsonErr.status, 409);
    assert.equal(parsedJsonErr.code, 'SHARE_GENERATION_MISMATCH');
  });
});

test('HTTP /motion-api/cloud-share and MCP openmotion_cloud_share share the same CloudShareService semantics', async () => {
  await withTempWorkspace(async store => {
    const games = gameProjectsFor(store.directory);
    const created = (await games.create({ prompt: 'Transport Check', multiplayer: false })).game;
    const api = transport(store, { runtimeRoot: pluginRoot } as any);

    const statusRes = await api(`/motion-api/cloud-share/game-project/${created.id}`);
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.kind, 'game-project');
    assert.equal(statusBody.projectId, created.id);
    assert.equal(statusBody.status, 'none');
    assert.equal(statusBody.accountState, 'signed-out');

    const publishRes = await api(`/motion-api/cloud-share/game-project/${created.id}/publish`, { method: 'POST' });
    assert.equal(publishRes.status, 401);
    const publishBody = await publishRes.json();
    assert.equal(publishBody.code, 'ACCOUNT_SIGN_IN_REQUIRED');

    const malformedRes = await api('/motion-api/cloud-share/game-project/%E0%A4%A');
    assert.equal(malformedRes.status, 400);
    const malformedBody = await malformedRes.json();
    assert.equal(malformedBody.code, 'CLOUD_SHARE_INVALID_PROJECT_ID');

    const phase1 = new Phase1Service(store, pluginRoot, {
      origin: () => 'http://127.0.0.1:4173',
      nativeUrl: () => undefined,
      openProject: async () => {},
      exportProject: async () => ({}),
      cancelExport: async () => ({}),
    });
    const mcpStatus = await phase1.call('openmotion_cloud_share', {
      action: 'status',
      kind: 'game-project',
      projectId: created.id,
    });
    assert.equal(mcpStatus.projectId, created.id);
    assert.equal(mcpStatus.status, 'none');
    assert.equal(mcpStatus.accountState, 'signed-out');
  });
});

test('CloudShareService supports design-project bundling, relative URL rewriting, status, publish, and missing error mapping', async () => {
  await withTempWorkspace(async store => {
    const design = designProjectsFor(store.directory);
    const created = await design.create({
      requestId: 'design-share-1',
      scenario: 'prototype',
      title: 'Landing / Demo',
    });
    await design.write(created.id, {
      requestId: 'design-share-write-1',
      expectedRevision: created.revision,
      files: [
        {
          path: 'index.html',
          content: `<!doctype html><html><body><script type="module" src="/motion-api/design/raw/${created.id}/app.js?v=1"></script></body></html>`,
        },
        {
          path: 'app.js',
          content: 'export const ready = true;\n',
        },
      ],
    });

    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      items: [
        {
          workspaceId: 'ws_personal_1',
          workspaceName: 'Maker Personal',
          workspaceMemberId: 'mem_personal_1',
          workspaceType: 'personal',
          memberStatus: 'active',
          lifecycleState: 'active',
          isDefault: true,
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const catalogMetadata: Record<string, unknown> = {};
    let publishedName = '';
    let publishedCloudProjectId = '';

    const account = new OpenDesignAccount(store.directory, {
      fetcher,
      runInWorkspace: async (workspaceId, args) => {
        if (args[0] === 'team-projects' && args[1] === 'ensure-private') {
          return JSON.stringify({ projectId: args[2], workspaceId });
        }
        if (args[0] === 'team-projects' && args[1] === 'register-resource') {
          return JSON.stringify({ ok: true });
        }
        if (args[0] === 'team-projects' && args[1] === 'get') {
          return JSON.stringify({
            projectId: args[2],
            workspaceId,
            ownerMemberId: 'mem_personal_1',
            resourceId: 'project-root-design-1',
            metadata: catalogMetadata,
          });
        }
        if (args[0] === 'team-projects' && args[1] === 'upsert') {
          const nextMeta = JSON.parse(flagValue(args, '--metadata-json') || '{}') as Record<string, unknown>;
          const mut = nextMeta._commentFiles as {
            resourceId: string;
            versionId: string;
            files: Array<{ sourceFileId: string; sourceFilePath: string; entryPath: string; retired: boolean }>;
          };
          catalogMetadata._commentFiles = {
            schemaVersion: 1,
            revision: 1,
            files: mut.files.map(f => ({ ...f, resourceId: mut.resourceId, versionId: mut.versionId })),
          };
          return JSON.stringify({ ok: true });
        }
        if (args[0] === 'resource' && args[1] === 'push') {
          return JSON.stringify({ id: 'ver_design_1' });
        }
        if (args[0] === 'share' && args[1] === 'publish') {
          publishedCloudProjectId = flagValue(args, '--project-id')!;
          publishedName = flagValue(args, '--name')!;
          const slug = flagValue(args, '--slug')!;
          const entryPath = flagValue(args, '--entry-path')!;
          const versionId = flagValue(args, '--version-id')!;
          assert.ok((catalogMetadata._commentFiles as { files?: unknown[] } | undefined)?.files?.length === 1);
          return JSON.stringify({
            status: 'published',
            slug,
            entryPath,
            version: 1,
            publishedAt: 1700000001000,
            url: `https://open-design.app/artifact/${encodeURIComponent(publishedCloudProjectId)}/${encodeURIComponent(slug)}`,
            snapshot: { versionId },
            receipt: { slug, versionId, entryPath, version: 1 },
          });
        }
        throw new Error(`Unexpected Vela args: ${args.join(' ')}`);
      },
    });
    await seedSignedInAccount(account);

    const cloud = new CloudShareService(store, account);
    const bundle = await cloud.buildShareBundle('design-project', created.id);
    const htmlFile = bundle.files.find(f => f.file === 'index.html');
    const appFile = bundle.files.find(f => f.file === 'app.js');
    assert.ok(htmlFile && appFile);
    assert.match(htmlFile.data.toString('utf8'), /src="\.\/app\.js\?v=1"/);

    const initialStatus = await cloud.status('design-project', created.id);
    assert.equal(initialStatus.kind, 'design-project');
    assert.equal(initialStatus.status, 'none');

    const published = await cloud.publish('design-project', created.id);
    assert.equal(published.kind, 'design-project');
    assert.equal(published.status, 'active');
    assert.equal(publishedCloudProjectId, `om-design-${created.id}`);
    assert.equal(publishedName, 'Landing Demo');

    await assert.rejects(
      () => cloud.status('design-project', '00000000-0000-0000-0000-000000000000'),
      (err: unknown) => err instanceof CloudShareError && err.status === 404 && err.code === 'CLOUD_SHARE_NOT_FOUND',
    );
  });
});

test('CloudShareService allocates a new share file identity on entry change and allows stop after project deletion', async () => {
  await withTempWorkspace(async store => {
    const design = designProjectsFor(store.directory);
    const created = await design.create({
      requestId: 'entry-switch-create-1',
      scenario: 'prototype',
      title: 'Entry Switch Demo',
    });
    const w1 = await design.write(created.id, {
      requestId: 'entry-switch-write-1',
      expectedRevision: created.revision,
      files: [{ path: 'index.html', content: '<!doctype html><html><body>v1</body></html>' }],
    });

    const admittedFiles: Array<{ sourceFileId: string; sourceFilePath: string; entryPath: string; retired: boolean; resourceId: string; versionId: string }> = [];
    let catalogRevision = 0;
    let pushCount = 0;
    let stoppedSlug = '';
    const seenSourceKeys: string[] = [];

    const account = new OpenDesignAccount(store.directory, {
      workspacePrincipal: async () => ({
        workspaceId: 'ws_personal_1',
        workspaceName: 'Maker Personal',
        workspaceMemberId: 'mem_personal_1',
        workspaceType: 'personal',
      }),
      runInWorkspace: async (_workspaceId, args) => {
        if (args[0] === 'team-projects' && args[1] === 'ensure-private') {
          return JSON.stringify({
            projectId: args[2],
            workspaceId: 'ws_personal_1',
            ownerMemberId: 'mem_personal_1',
            resourceId: `root-${args[2]}`,
          });
        }
        if (args[0] === 'team-projects' && args[1] === 'register-resource') {
          return JSON.stringify({ ok: true });
        }
        if (args[0] === 'resource' && args[1] === 'push') {
          pushCount += 1;
          return JSON.stringify({ id: `ver_entry_${pushCount}` });
        }
        if (args[0] === 'team-projects' && args[1] === 'get') {
          return JSON.stringify({
            projectId: args[2],
            workspaceId: 'ws_personal_1',
            ownerMemberId: 'mem_personal_1',
            resourceId: `root-${args[2]}`,
            metadata: {
              _commentFiles: {
                schemaVersion: 1,
                revision: catalogRevision,
                files: admittedFiles,
              },
            },
          });
        }
        if (args[0] === 'team-projects' && args[1] === 'upsert') {
          const parsed = JSON.parse(flagValue(args, '--metadata-json')!) as { _commentFiles?: { resourceId: string; versionId: string; files: Array<{ sourceFileId: string; sourceFilePath: string; entryPath: string; retired: boolean }> } };
          const mutation = parsed._commentFiles!;
          catalogRevision += 1;
          for (const fact of mutation.files) {
            admittedFiles.push({
              ...fact,
              resourceId: mutation.resourceId,
              versionId: mutation.versionId,
            });
          }
          return JSON.stringify({ ok: true });
        }
        if (args[0] === 'share' && args[1] === 'publish') {
          const slug = flagValue(args, '--slug')!;
          const cloudProjectId = flagValue(args, '--project-id')!;
          const entryPath = flagValue(args, '--entry-path')!;
          const sourceKey = flagValue(args, '--source-key')!;
          const versionId = flagValue(args, '--version-id')!;
          seenSourceKeys.push(sourceKey);
          return JSON.stringify({
            status: 'published',
            slug,
            entryPath,
            version: pushCount,
            publishedAt: 1700000002000 + pushCount,
            url: `https://open-design.app/artifact/${encodeURIComponent(cloudProjectId)}/${encodeURIComponent(slug)}`,
            snapshot: { versionId },
            receipt: { slug, versionId, entryPath, version: pushCount },
          });
        }
        if (args[0] === 'share' && args[1] === 'stop') {
          stoppedSlug = args[2];
          return JSON.stringify({ status: 'stopped', slug: args[2] });
        }
        throw new Error(`Unexpected Vela args: ${args.join(' ')}`);
      },
    });
    await seedSignedInAccount(account);

    const cloud = new CloudShareService(store, account);
    const first = await cloud.publish('design-project', created.id);
    assert.equal(first.status, 'active');
    assert.equal(first.entryPath, 'index.html');

    // Change the design project's entry file; republishing must allocate a fresh file identity instead of 409 conflict.
    const rev1 = (await design.get(created.id)).revision;
    await design.write(created.id, {
      requestId: 'entry-switch-write-2',
      expectedRevision: rev1,
      entry: 'alt.html',
      files: [{ path: 'alt.html', content: '<!doctype html><html><body>v2 alt</body></html>' }],
    });
    const second = await cloud.publish('design-project', created.id);
    assert.equal(second.status, 'active');
    assert.equal(second.entryPath, 'alt.html');
    assert.equal(second.slug, first.slug);
    assert.equal(seenSourceKeys.length, 2);
    assert.notEqual(seenSourceKeys[0], seenSourceKeys[1]);

    // Delete the local design project; stop() must still revoke the active cloud link from the persisted share record.
    await design.trash(created.id, 'entry-switch-trash-1');
    await design.remove(created.id, 'entry-switch-delete-1');
    const stopped = await cloud.stop('design-project', created.id);
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.slug, first.slug);
    assert.equal(stopped.freshness, 'unknown');
    assert.equal(stoppedSlug, first.slug);
  });
});
