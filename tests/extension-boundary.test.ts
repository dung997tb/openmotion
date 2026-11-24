import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getWorkflow } from '../shared/workflow.ts';
import { phase1Tools } from '../shared/phase1-tools.ts';
import { parseConfig } from '../src/infra/config.ts';
import {
  InMemoryMcpSessionStore,
  McpStreamableHttpHandler,
  McpToolDispatcher,
} from '../src/mcp/index.ts';
import { PAT_SCOPES, type AuthContext } from '../src/contracts/auth.ts';

test('default production preserves specialist workflows while template reuse and openmotion-video-to-template have separate real entries', async () => {
  const sections = ['start', 'intake', 'templates', 'production', 'verification'];
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
  const handler = new McpStreamableHttpHandler({
    config,
    dispatcher: new McpToolDispatcher(config, {}),
    sessionStore: new InMemoryMcpSessionStore(),
  });
  const initRes = await handler.handle(
    new Request('http://127.0.0.1:4173/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Host: '127.0.0.1:4173',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    }),
    auth,
  );
  const initial = (await initRes.json()) as any;
  assert.match(initial.result.instructions, /motion:\/\/workflow\/production\/start/);
  assert.ok(initial.result.instructions.includes('openmotion-video-to-template'));
  assert.ok(initial.result.instructions.includes('openmotion-template-to-video'));
  assert.match(initial.result.instructions, /production is not a prerequisite/);

  for (const section of sections) {
    const value = await getWorkflow(section, 'production');
    assert.equal(value.workflow, 'production');
    for (const legacySection of sections) {
      assert.ok(value.sections.includes(legacySection), `Missing legacy section: ${legacySection}`);
    }
    assert.ok(value.path.includes('/skills/openmotion-production/'));
    assert.equal(value.content, await readFile(value.path, 'utf8'));
  }

  const start = await getWorkflow();
  assert.equal(start.section, 'start');
  assert.ok(start.path.endsWith('/openmotion-production/SKILL.md'));

  const template = await getWorkflow('start', 'template');
  assert.equal(template.documentId, 'skills/openmotion-template-to-video/SKILL.md');
  assert.equal(template.status, 'ready');

  const manufacturing = await getWorkflow('start', 'video-to-template');
  assert.equal(manufacturing.documentId, 'skills/openmotion-video-to-template/SKILL.md');
  assert.equal(manufacturing.status, 'ready');

  const recreate = await getWorkflow('start', 'recreate');
  assert.equal(recreate.documentId, 'skills/openmotion-recreate/SKILL.md');
  assert.equal(recreate.status, 'ready');

  await assert.rejects(readFile(new URL('../skills/motion-template/SKILL.md', import.meta.url)), /ENOENT/);
  assert.ok(!phase1Tools.some((tool) => tool.name === 'openmotion_save_template'));
});
