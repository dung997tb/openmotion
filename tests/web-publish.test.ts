import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GameProjects } from '../game-projects.ts';
import type { OpenDesignWorkspaceInfo } from '../gateway/account.ts';
import {
  cloudProjectIdFor,
  WebPublishService,
  type WebPublishAccountClient,
} from '../gateway/web-publish.ts';
import { atomicJson } from '../phase1-versions.ts';
import { startServer } from '../server.ts';
import { MCP_HTTP_PATH, MCP_TOKENS_API } from '../shared/mcp-http.ts';
import { webPublishRoutes } from '../shared/web-publish.ts';
import { fixture } from './fixtures.ts';

function createMockWebPublishAccount() {
  const stagedFilesByPush: Array<{ root: string; metadata: Record<string, unknown> }> = [];
  const catalogByProject = new Map<string, { schemaVersion: 1; revision: number; files: Array<Record<string, unknown>> }>();
  let versionCounter = 0;

  const workspaces: OpenDesignWorkspaceInfo[] = [
    {
      workspaceId: 'ws_web_1',
      workspaceName: 'OpenMotion Cloud',
      workspaceType: 'personal',
      workspaceMemberId: 'member_web_1',
      role: 'owner',
      isDefault: true,
      memberStatus: 'active',
      lifecycleState: 'active',
    },
  ];

  const client: WebPublishAccountClient = {
    async isSignedIn() {
      return true;
    },
    async listWorkspaces() {
      return workspaces;
    },
    async runWithEnv(args) {
      const cmd = args.slice(0, 2).join(' ');
      if (cmd === 'team-projects ensure-private') {
        return JSON.stringify({ projectId: args[2], ok: true });
      }
      if (cmd === 'team-projects register-resource') {
        return JSON.stringify({ ok: true });
      }
      if (cmd === 'team-projects get') {
        const projectId = args[2];
        const state = catalogByProject.get(projectId) ?? { schemaVersion: 1 as const, revision: 0, files: [] };
        return JSON.stringify({
          projectId,
          workspaceId: 'ws_web_1',
          ownerMemberId: 'member_web_1',
          resourceId: `root-${projectId}`,
          metadata: state.revision > 0 || state.files.length > 0 ? { _commentFiles: state } : {},
        });
      }
      if (cmd === 'team-projects upsert') {
        const projectId = args[2];
        const metaIdx = args.indexOf('--metadata-json');
        const payload = JSON.parse(args[metaIdx + 1]) as {
          _commentFiles?: {
            resourceId: string;
            versionId: string;
            files: Array<{ sourceFileId: string; sourceFilePath: string; entryPath: string; retired: boolean }>;
          };
        };
        const current = catalogByProject.get(projectId) ?? { schemaVersion: 1 as const, revision: 0, files: [] };
        const mutation = payload._commentFiles!;
        catalogByProject.set(projectId, {
          schemaVersion: 1,
          revision: current.revision + 1,
          files: mutation.files.map(item => ({
            ...item,
            resourceId: mutation.resourceId,
            versionId: mutation.versionId,
          })),
        });
        return JSON.stringify({ projectId, ok: true });
      }
      if (cmd === 'resource push') {
        const metaIdx = args.indexOf('--metadata-json');
        stagedFilesByPush.push({
          root: args[4],
          metadata: JSON.parse(args[metaIdx + 1]) as Record<string, unknown>,
        });
        versionCounter += 1;
        return JSON.stringify({ id: `ver_${versionCounter}` });
      }
      if (cmd === 'share publish') {
        const slug = args[args.indexOf('--slug') + 1];
        const projectId = args[args.indexOf('--project-id') + 1];
        const versionId = args[args.indexOf('--version-id') + 1];
        return JSON.stringify({
          status: 'published',
          slug,
          version: versionCounter,
          publishedAt: 1_700_100_000_000 + versionCounter,
          snapshot: { versionId },
          url: `https://open-design.app/artifact/${projectId}/${slug}`,
        });
      }
      if (cmd === 'share stop') {
        return JSON.stringify({ status: 'stopped', slug: args[2] });
      }
      throw new Error(`Unexpected mock args: ${args.join(' ')}`);
    },
  };

  return { client, stagedFilesByPush };
}

test('WebPublishService publishes design, game, and standalone single-file HTML targets uniformly and reads legacy design records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'om-web-publish-unit-'));
  try {
    const dataDir = path.join(root, 'data');
    const designDir = path.join(root, 'design-bundle');
    const gameDir = path.join(root, 'game-bundle');
    const singleHtml = path.join(root, 'architecture-map.html');

    await mkdir(designDir, { recursive: true });
    await mkdir(path.join(gameDir, 'assets'), { recursive: true });
    await writeFile(path.join(designDir, 'index.html'), '<!doctype html><h1>Design</h1>');
    await writeFile(path.join(gameDir, 'index.html'), '<!doctype html><canvas id="game"></canvas>');
    await writeFile(path.join(gameDir, 'assets/sprite.svg'), '<svg></svg>');
    await writeFile(singleHtml, '<!doctype html><h1>Standalone Architecture Map</h1>');

    const mock = createMockWebPublishAccount();
    const service = new WebPublishService(dataDir, mock.client);

    // 1. Design target preserves native design project ID
    const designRes = await service.publish({
      kind: 'design',
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Marketing Page',
      entryPath: 'index.html',
      sourceRevision: 'rev-d1',
      sourcePath: designDir,
    });
    assert.equal(designRes.publication.targetKind, 'design');
    assert.equal(designRes.publication.cloudProjectId, '11111111-1111-4111-8111-111111111111');
    assert.ok(designRes.url?.includes('11111111-1111-4111-8111-111111111111'));

    // 2. Game target derives deterministic collision-free UUID
    const expectedGameCloudId = cloudProjectIdFor('game', 'arcade-shooter');
    assert.match(expectedGameCloudId, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    const gameRes = await service.publish({
      kind: 'game',
      id: 'arcade-shooter',
      title: 'Arcade Shooter',
      entryPath: 'index.html',
      sourceRevision: 'rev-g1',
      sourcePath: gameDir,
    });
    assert.equal(gameRes.publication.targetKind, 'game');
    assert.equal(gameRes.publication.targetId, 'arcade-shooter');
    assert.equal(gameRes.publication.cloudProjectId, expectedGameCloudId);
    assert.equal(gameRes.publication.fileCount, 2);
    assert.equal(mock.stagedFilesByPush[1].metadata.targetKind, 'game');

    // 3. Standalone single HTML file is staged cleanly as entryPath="index.html"
    const htmlRes = await service.publish({
      kind: 'html',
      id: 'arch-map-demo',
      title: 'Architecture Map',
      entryPath: 'index.html',
      sourceRevision: 'rev-h1',
      sourcePath: singleHtml,
    });
    assert.equal(htmlRes.publication.targetKind, 'html');
    assert.equal(htmlRes.publication.fileCount, 1);
    assert.ok(htmlRes.url?.startsWith('https://open-design.app/artifact/'));

    // 4. Unified catalog listAll returns all three target kinds
    const listing = await service.listAll();
    assert.equal(listing.accountSignedIn, true);
    assert.equal(listing.publications.length, 3);
    assert.deepEqual(
      listing.publications.map(p => p.targetKind).sort(),
      ['design', 'game', 'html'],
    );

    // 5. Legacy design-projects/deployments/<id>.json fallback works seamlessly
    const legacyId = '22222222-2222-4222-8222-222222222222';
    await mkdir(path.join(dataDir, 'design-projects', 'deployments'), { recursive: true });
    await atomicJson(path.join(dataDir, 'design-projects', 'deployments', `${legacyId}.json`), {
      schemaVersion: 1,
      reservations: {},
      deployments: {
        'index.html': {
          schemaVersion: 1,
          projectId: legacyId,
          filePath: 'index.html',
          entryPath: 'index.html',
          name: 'Legacy Design',
          workspaceId: 'ws_web_1',
          ownerMemberId: 'member_web_1',
          resourceId: 'res-legacy',
          sourceFileId: 'sf-legacy',
          sourceKey: 'sk-legacy',
          slug: 'legacy-slug',
          version: 1,
          versionId: 'ver-legacy',
          status: 'published',
          url: `https://open-design.app/artifact/${legacyId}/legacy-slug`,
          publishedAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          fileCount: 1,
          totalBytes: 120,
          sourceRevision: 'rev-legacy',
        },
      },
    });
    const legacyStatus = await service.status({
      kind: 'design',
      id: legacyId,
      entryPath: 'index.html',
    });
    assert.equal(legacyStatus.active?.slug, 'legacy-slug');
    assert.equal(legacyStatus.active?.targetKind, 'design');
    assert.equal(legacyStatus.active?.cloudProjectId, legacyId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Unified /motion-api/web-publish HTTP routes and Streamable HTTP openmotion_assets_use action=web_publish enforce validation and auth', () =>
  fixture(async store => {
    // Create a local playable game inside workspace dataDirectory
    const games = new GameProjects(store.directory);
    const createdGame = (await games.create({
      prompt: 'Neon Grid Runner',
      multiplayer: false,
      genre: 'shooter',
    })).game;

    const running = await startServer(store, 0, { editor: false });
    const port = (running.server.address() as { port: number }).port;
    const origin = `http://127.0.0.1:${port}`;

    try {
      // 1. Unified list endpoint returns empty list initially
      const listRes = await fetch(`${origin}${webPublishRoutes.list}`);
      assert.equal(listRes.status, 200);
      const listPayload = (await listRes.json()) as {
        accountSignedIn: boolean;
        publications: unknown[];
      };
      assert.equal(typeof listPayload.accountSignedIn, 'boolean');
      assert.deepEqual(listPayload.publications, []);

      // 2. Game status endpoint resolves GameProjects targets cleanly
      const gameStatusRes = await fetch(`${origin}${webPublishRoutes.target('game', createdGame.id)}`);
      assert.equal(gameStatusRes.status, 200);
      const gameStatus = (await gameStatusRes.json()) as {
        targetKind: string;
        targetId: string;
        active: unknown;
      };
      assert.equal(gameStatus.targetKind, 'game');
      assert.equal(gameStatus.targetId, createdGame.id);
      assert.equal(gameStatus.active, null);

      // 3. Invalid targetKind & unknown game map to 400 / 404
      const badKindRes = await fetch(`${origin}/motion-api/web-publish/unknown-kind/abc`);
      assert.equal(badKindRes.status, 400);
      const missingGameRes = await fetch(`${origin}${webPublishRoutes.target('game', 'missing-game-id')}`);
      assert.equal(missingGameRes.status, 404);

      // 4. Streamable HTTP /mcp openmotion_assets_use action=web_publish list & status + read token guard
      const [readRes, writeRes] = await Promise.all([
        fetch(`${origin}${MCP_TOKENS_API}`, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Read WebPublish Test', scope: 'read' }),
        }),
        fetch(`${origin}${MCP_TOKENS_API}`, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Write WebPublish Test', scope: 'write' }),
        }),
      ]);
      const readToken = ((await readRes.json()) as { token: string }).token;
      const writeToken = ((await writeRes.json()) as { token: string }).token;

      async function mcpRpc(token: string, body: Record<string, unknown>, sessionId?: string) {
        const res = await fetch(`${origin}${MCP_HTTP_PATH}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
          },
          body: JSON.stringify(body),
        });
        const payload = await res.json();
        return { res, payload, sessionId: res.headers.get('Mcp-Session-Id') ?? sessionId };
      }

      const initWrite = await mcpRpc(writeToken, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'web-publish-test', version: '1.0.0' },
        },
      });
      assert.ok(initWrite.sessionId);

      const mcpList = await mcpRpc(
        writeToken,
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'openmotion_assets_use',
            arguments: { action: 'web_publish', webPublish: { command: 'list' } },
          },
        },
        initWrite.sessionId,
      );
      assert.equal(mcpList.payload.error, undefined);
      const parsedList = JSON.parse(mcpList.payload.result.content[0].text) as { publications: unknown[] };
      assert.deepEqual(parsedList.publications, []);

      const mcpGameStatus = await mcpRpc(
        writeToken,
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'openmotion_assets_use',
            arguments: {
              action: 'web_publish',
              webPublish: { command: 'status', targetKind: 'game', targetId: createdGame.id },
            },
          },
        },
        initWrite.sessionId,
      );
      assert.equal(mcpGameStatus.payload.error, undefined);
      const parsedGameStatus = JSON.parse(mcpGameStatus.payload.result.content[0].text) as {
        targetKind: string;
        targetId: string;
      };
      assert.equal(parsedGameStatus.targetKind, 'game');
      assert.equal(parsedGameStatus.targetId, createdGame.id);

      // Read-scoped token cannot call openmotion_assets_use action=web_publish
      const initRead = await mcpRpc(readToken, {
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'readonly-web-publish', version: '1.0.0' },
        },
      });
      const forbidden = await mcpRpc(
        readToken,
        {
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'openmotion_assets_use',
            arguments: {
              action: 'web_publish',
              webPublish: { command: 'publish', targetKind: 'game', targetId: createdGame.id },
            },
          },
        },
        initRead.sessionId,
      );
      assert.equal(forbidden.payload.error?.code, -32003);
      assert.match(String(forbidden.payload.error?.message), /MCP_SCOPE_FORBIDDEN/);
    } finally {
      await running.close();
    }
  }));
