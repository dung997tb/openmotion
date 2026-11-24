import test from 'node:test';
import assert from 'node:assert/strict';
import { phase1TransportTool } from '../shared/phase1-tools.ts';
import { publicToolResult } from '../shared/public-names.mjs';
import { parseConfig } from '../src/infra/config.ts';
import {
  InMemoryMcpSessionStore,
  McpStreamableHttpHandler,
  McpToolDispatcher,
  readCloudMcpResource,
} from '../src/mcp/index.ts';
import { PAT_SCOPES, type AuthContext } from '../src/contracts/auth.ts';

function makeMcpHarness() {
  const config = parseConfig({
    DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/openmotion',
    REDIS_URL: 'redis://127.0.0.1:6379',
    AUTH_MODE: 'dev',
    MODEL_GATEWAY_MODE: 'mock',
  });
  const auth: AuthContext = {
    workspaceId: config.DEV_WORKSPACE_ID,
    userId: config.DEV_USER_ID,
    role: 'owner',
    scopes: [...PAT_SCOPES],
    authMode: 'dev',
    authMethod: 'dev_bypass',
  };
  const createdByRequest = new Map<string, Record<string, unknown>>();
  const dispatcher = new McpToolDispatcher(config, {
    projects: {
      async getProject(_a, args) {
        return { projectId: args.projectId, revision: 'a'.repeat(64) };
      },
      async createProject(_a, args) {
        const key = String(args.requestId);
        const existing = createdByRequest.get(key);
        if (existing) return { ...existing, replayed: true };
        const created = {
          projectId: '11111111-1111-4111-8111-111111111111',
          sessionId: '22222222-2222-4222-8222-222222222222',
          revision: 'a'.repeat(64),
          version: { versionId: '33333333-3333-4333-8333-333333333333', versionNumber: 1 },
          replayed: false,
        };
        createdByRequest.set(key, created);
        return created;
      },
      async editProject(_a, args) {
        return {
          projectId: args.projectId,
          revision: 'b'.repeat(64),
          version: { versionId: '44444444-4444-4444-8444-444444444444', versionNumber: 2 },
          previewHandoff: {
            nextAction: { tool: 'motion_open_preview' },
            instructions: 'Read motion://workflow/production/native before delivering.',
          },
        };
      },
      async openPreview() {
        return { ok: true };
      },
      async manageProject() {
        return { ok: true };
      },
    },
  });
  const handler = new McpStreamableHttpHandler({
    config,
    dispatcher,
    sessionStore: new InMemoryMcpSessionStore(),
  });
  const rpc = async (body: unknown) => {
    const res = await handler.handle(
      new Request('http://127.0.0.1:4173/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Host: '127.0.0.1:4173',
        },
        body: JSON.stringify(body),
      }),
      auth,
    );
    return res.json() as Promise<any>;
  };
  return { rpc, config };
}

test('default MCP discovery publishes only OpenMotion tool and resource names', async () => {
  const { rpc } = makeMcpHarness();
  const list = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.ok(list.result.tools.every((tool: any) => tool.name.startsWith('openmotion_')));

  const resources = await rpc({ jsonrpc: '2.0', id: 2, method: 'resources/list' });
  assert.ok(
    resources.result.resources.every(
      (resource: any) =>
        resource.uri.startsWith('openmotion://') || resource.uri === 'ui://openmotion/inline-video/v2/player.html',
    ),
  );
});

test('new and legacy tool names share validation, authorization and write idempotency', async () => {
  const { rpc } = makeMcpHarness();
  for (const names of [
    ['openmotion_edit_project', 'motion_edit_project'],
    ['openmotion_write_files', 'motion_write_files'],
  ]) {
    const results = await Promise.all(
      names.map((name) => rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } })),
    );
    assert.equal(results[0].result.structuredContent.error.code, results[1].result.structuredContent.error.code);
    assert.equal(results[0].result.isError, true);
  }

  const input = {
    requestId: 'same-create',
    projectType: 'natural_language',
    title: 'Naming compatibility',
    requirements: 'Preserve native behavior',
  };
  const original = await rpc({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'motion_create_project', arguments: input },
  });
  const replay = await rpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'openmotion_create_project', arguments: input },
  });
  assert.equal(replay.result.structuredContent.projectId, original.result.structuredContent.projectId);
  assert.equal(replay.result.structuredContent.replayed, true);

  const edited = await rpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'openmotion_edit_project',
      arguments: {
        requestId: 'same-edit',
        projectId: original.result.structuredContent.projectId,
        expectedRevision: original.result.structuredContent.revision,
        expectedVersionId: original.result.structuredContent.version.versionId,
        files: [{ path: 'note.txt', content: 'Same source' }],
      },
    },
  });
  assert.equal(edited.result.structuredContent.previewHandoff.nextAction.tool, 'openmotion_open_preview');
  assert.match(edited.result.structuredContent.previewHandoff.instructions, /\bopenmotion:\/\/workflow\//);
  assert.doesNotMatch(edited.result.structuredContent.previewHandoff.instructions, /openopenmotion/);
});

test('legacy resource addresses read the same canonical workflow as OpenMotion addresses', async () => {
  const a = await readCloudMcpResource('openmotion://workflow/director/start');
  const b = await readCloudMcpResource('motion://workflow/director/start');
  assert.equal(a.text, b.text);
});

test('transport negotiation supports old and new running backends without changing the API protocol', () => {
  for (const backendName of ['motion_get_project', 'openmotion_get_project']) {
    const health = { mcp: { protocol: 1, tools: [backendName] } };
    for (const callerName of ['motion_get_project', 'openmotion_get_project']) {
      assert.equal(phase1TransportTool(health, callerName), backendName);
    }
  }
  assert.equal(phase1TransportTool({ mcp: { protocol: 1, tools: ['motion_write_files'] } }, 'openmotion_write_files'), undefined);
});

test('old backend hints use canonical names without changing project content or double-prefixing new URIs', () => {
  const original = {
    source: 'motion://user-content',
    previewHandoff: {
      nextAction: { tool: 'motion_open_preview' },
      instructions: 'Read motion://workflow/production/native or openmotion://workflow/production/native.',
    },
  };
  const normalized = publicToolResult(original);
  assert.equal(normalized.source, original.source);
  assert.equal(normalized.previewHandoff.nextAction.tool, 'openmotion_open_preview');
  assert.equal(
    normalized.previewHandoff.instructions,
    'Read openmotion://workflow/production/native or openmotion://workflow/production/native.',
  );
  assert.equal(original.previewHandoff.nextAction.tool, 'motion_open_preview');
  assert.deepEqual(publicToolResult(normalized), normalized);
});
