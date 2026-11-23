import { clipMoveExample } from '../shared/clip-move-guide.ts';
import { reviewCommentsPrompt } from '../shared/review-comments.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mcpCapabilities, mcpScenarios, platformExportExample, mcpBenefits, mcpReviewGuide, mcpFaq, mcpClientComparison } from '../studio/src/motion/mcpCapabilities.ts';
import { assetNamingInstruction } from '../shared/asset-names.ts';
import { phase1Tools } from '../shared/phase1-tools.ts';
import {
  agentGuide,
  buildCloudIntegrationInfo,
  integrationConfig,
  isIntegrationInfo,
  isStreamableHttpTransport,
  manualConnection,
  setupPrompt,
  supportsChatgptCloud,
  type IntegrationInfo,
} from '../shared/integration.ts';

test('MCP onboarding covers every public domain tool (22 registered) and scenarios only compose real tools', () => {
  const described = mcpCapabilities.flatMap(capability => [...capability.tools]);
  assert.equal(phase1Tools.length, 22);
  assert.deepEqual([...new Set(described)].sort(), phase1Tools.map(tool => tool.name).sort());
  for (const capability of mcpCapabilities) assert.equal(new Set(capability.tools).size, capability.tools.length);
});

test('Streamable HTTP /mcp integration info validates and configures all clients including ChatGPT Cloud', () => {
  const localHttp = buildCloudIntegrationInfo({
    publicOrigin: 'http://127.0.0.1:4173',
    version: '1.0.0',
    workspaceId: 'ws-dev',
    authMode: 'dev',
    tools: phase1Tools,
  });
  assert.equal(isIntegrationInfo(localHttp), true);
  assert.equal(isStreamableHttpTransport(localHttp.transport), true);
  assert.equal(localHttp.transport.type === 'streamable-http' && localHttp.transport.url, 'http://127.0.0.1:4173/mcp');
  assert.equal(supportsChatgptCloud(localHttp), false);
  assert.throws(() => integrationConfig(localHttp, 'chatgpt'), /HTTPS/);
  assert.match(manualConnection(localHttp, 'codex', 'en'), /codex mcp add openmotion --url 'http:\/\/127\.0\.0\.1:4173\/mcp'/);
  assert.match(manualConnection(localHttp, 'claude', 'en'), /claude mcp add --transport http openmotion 'http:\/\/127\.0\.0\.1:4173\/mcp'/);
  assert.match(integrationConfig(localHttp, 'mcp').text, /"type": "http"/);
  assert.match(integrationConfig(localHttp, 'deepseek').text, /transport: streamable-http/);
  assert.doesNotMatch(setupPrompt(localHttp, 'codex', 'en'), /docker exec -i/);
  assert.match(setupPrompt(localHttp, 'codex', 'en'), /upload_ticket/);

  const cloudHttps = buildCloudIntegrationInfo({
    publicOrigin: 'https://motion.open-design.ai',
    version: '1.0.0',
    workspaceId: 'ws-prod',
    authMode: 'oidc',
    oauth2Enabled: true,
    patEnabled: true,
    tools: phase1Tools,
  });
  assert.equal(isIntegrationInfo(cloudHttps), true);
  assert.equal(supportsChatgptCloud(cloudHttps), true);
  const chatgptCfg = integrationConfig(cloudHttps, 'chatgpt');
  assert.equal(chatgptCfg.filename, 'openmotion-chatgpt.json');
  assert.match(chatgptCfg.text, /"authentication": "oauth2"/);
  assert.match(chatgptCfg.text, /https:\/\/motion\.open-design\.ai\/mcp/);
  assert.match(manualConnection(cloudHttps, 'chatgpt', 'en'), /OAuth 2\.1/);
});

test('cloud clip move example uses the public edit contract in the handbook and guide', () => {
  const card = mcpCapabilities.find(item => item.id === 'clip-move')!;
  const locales = JSON.parse(readFileSync(new URL('../studio/src/i18n/mcp-ui.json', import.meta.url), 'utf8'));
  for (const strings of Object.values(locales) as Record<string, string>[]) {
    for (const key of [card.title, card.description, card.prompt]) assert.ok(strings[key]);
  }
  const guide = agentGuide(buildCloudIntegrationInfo({
    publicOrigin: 'https://motion.example.com', version: '1', workspaceId: 'w', authMode: 'dev', tools: phase1Tools,
  }), 'codex');
  for (const text of [card.prompt, card.description, clipMoveExample]) assert.ok(guide.includes(text));
  const args = JSON.parse(clipMoveExample.slice('openmotion_edit_project('.length, -1));
  assert.deepEqual(Object.keys(args).sort(), ['edit', 'expectedRevision', 'expectedVersionId', 'projectId', 'requestId']);
  assert.deepEqual(args.edit, { kind: 'moveClip', compositionPath: 'index.html', hfId: '<data-hf-id>', start: 5 });
  const reference = readFileSync(new URL('../docs/mcp-phase1-tools.md', import.meta.url), 'utf8');
  assert.ok(reference.includes(clipMoveExample));
});

test('every capability and benefit has a real shared icon', () => {
  const sprite = readFileSync(new URL('../packages/design-system/icons.svg', import.meta.url), 'utf8');
  for (const { icon } of [...mcpCapabilities, ...mcpScenarios, ...mcpBenefits]) assert.ok(sprite.includes(`id="ri-${icon}"`), icon);
});

test('review comments and their handbook scenario are localized across all interface languages', () => {
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/review-ui.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(translations).length, 10);
  const keys = Object.keys(translations['zh-CN']).sort();
  const scenario = mcpScenarios.find(item => item.id === 'review-comments')!;
  for (const [language, values] of Object.entries(translations) as [string, Record<string, string>][]) {
    assert.deepEqual(Object.keys(values).sort(), keys, language);
    for (const key of [scenario.title, scenario.description, 'Review data and Agent actions', ...mcpReviewGuide.flat(), ...keys]) assert.ok(values[key]?.trim(), `${language}: ${key}`);
    assert.equal(values.Open, undefined, 'Review status must not override the general Open action');
  }
});

test('handbook scenarios compose public tools and keep their copyable instructions aligned', () => {
  const names = new Set(phase1Tools.map(tool => tool.name));
  for (const scenario of mcpScenarios) {
    assert.ok(scenario.title && scenario.description);
    if (scenario.id === 'review-comments') assert.equal(scenario.prompt, reviewCommentsPrompt());
    if (scenario.id === 'asset-naming') assert.equal(scenario.prompt, assetNamingInstruction);
    for (const tool of scenario.tools) {
      assert.ok(names.has(tool), tool);
      assert.ok((scenario.id === 'platform-export' ? platformExportExample('en') : scenario.prompt).includes(tool), tool);
    }
  }
});

test('guide-draft handoff is discoverable and translated with its actual recovery boundaries', () => {
  const scenario = mcpScenarios.find(item => item.id === 'template-guide')!;
  assert.match(scenario.prompt, /guideDraft.*stable requestId/);
  assert.match(scenario.prompt, /applied=false.*new requestId.*unknown outcomes/);
  assert.match(scenario.prompt, /not a reconstruction of the reference film/);
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/mcp-ui.json', import.meta.url), 'utf8'));
  for (const [locale, values] of Object.entries(translations) as [string, Record<string, string>][]) {
    for (const text of [scenario.title, scenario.description, scenario.prompt]) assert.ok(values[text]?.trim(), locale + ': ' + text);
  }
  const shared = readFileSync(new URL('../shared/integration.ts', import.meta.url), 'utf8');
  assert.match(shared, /\$\{templateGuideContinuationInstruction\}/);
  const templateSkill = readFileSync(new URL('../skills/openmotion-template-to-video/SKILL.md', import.meta.url), 'utf8');
  const reference = readFileSync(new URL('../skills/openmotion-production/references/templates.md', import.meta.url), 'utf8');
  assert.match(templateSkill, /guideDraft.*narrow exception/);
  assert.match(reference, /guideDraft.*projectType|projectType.*guideDraft/s);
  assert.match(reference, /applied=false.*unknown outcomes/s);
});

test('reference-image and audio guidance is translated in every interface language', () => {
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/mcp-ui.json', import.meta.url), 'utf8'));
  for (const locale of Object.values(translations) as Record<string, string>[]) {
    for (const [question, answer] of mcpFaq.slice(0, 2)) { assert.ok(locale[question]); assert.ok(locale[answer]); }
  }
});

test('cloud Streamable HTTP and legacy connection guidance expose the maintained media workflow and 3-way cloud import', () => {
  const cloudInfo = buildCloudIntegrationInfo({
    publicOrigin: 'https://motion.open-design.ai',
    version: '1.0.0',
    workspaceId: 'ws-1',
    authMode: 'oidc',
    tools: phase1Tools,
  });
  const cloudGuide = agentGuide(cloudInfo, 'codex');
  assert.ok(cloudGuide.includes(reviewCommentsPrompt({ dataDirectory: cloudInfo.dataDirectory, previewUrl: cloudInfo.previewUrl })));
  for (const token of [
    'https://motion.open-design.ai/mcp',
    'prepare_upload',
    'upload_ticket',
    'library_asset',
    'OpenDesign Model Gateway',
    'openmotion_media_use',
    'openmotion_assets_use generate',
    'FEATURE_DEFERRED_P2',
  ]) {
    assert.ok(cloudGuide.includes(token), token);
  }

  const stdioInfo: IntegrationInfo = {
    name: 'OpenMotion', version: '1.0.0', dataDirectory: '/fixture/data', previewUrl: 'http://127.0.0.1:4567', tools: phase1Tools,
    transport: { type: 'stdio', command: 'node', args: ['/fixture/mcp.ts'], cwd: '/fixture', env: { MOTION_DATA_DIR: '/fixture/data' } },
  };
  const guide = agentGuide(stdioInfo, 'codex');
  assert.ok(guide.includes(reviewCommentsPrompt({ dataDirectory: stdioInfo.dataDirectory, previewUrl: stdioInfo.previewUrl })));
  for (const operation of ['openmotion_media_use', 'inspect', 'reference', 'models', 'schema', 'generate', 'status', 'cancel', 'requestId', 'jobId']) assert.ok(guide.includes(operation), operation);
  assert.doesNotMatch(guide, /不公开生成/);
  assert.match(guide, /openmotion_assets_use generate/);
});

test('media example uses unified OpenDesign Model Gateway and preserves setup continuation across languages', async () => {
  const media = mcpCapabilities.find(capability => capability.id === 'media')!;
  const assets = mcpCapabilities.find(capability => capability.id === 'assets')!;
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/mcp-ui.json', import.meta.url), 'utf8'));
  assert.match(media.prompt, /inspect/);
  assert.match(media.prompt, /Plus or above/);
  assert.match(media.prompt, /not-included.*openmotion_open_preview with target=providers.*page handoff/);
  assert.match(media.prompt, /Only when signed in.*unknown, continue model discovery/);
  assert.match(media.prompt, /mediaEntitlement/);
  assert.match(media.prompt, /OpenDesign Cloud/);
  assert.match(media.prompt, /OpenDesign Model Gateway/);
  assert.doesNotMatch(media.prompt, /BYOK API key/);
  assert.match(media.prompt, /target=providers/);
  assert.match(media.prompt, /inspect again/);
  assert.match(media.prompt, /original request/);
  assert.match(assets.description, /prepare_upload \+ upload_ticket.*HTTPS URL.*library_asset/);
  assert.ok(translations['zh-CN'][media.prompt]);
  assert.ok(translations['zh-CN'][assets.description]);

  const skill = readFileSync(new URL('../skills/openmotion-media/SKILL.md', import.meta.url), 'utf8');
  const setupLink = skill.match(/\[Discovery and setup\]\(([^)]+)\)/);
  assert.ok(setupLink, 'Media entry must expose provider setup');
  const setup = readFileSync(new URL(setupLink[1], new URL('../skills/openmotion-media/SKILL.md', import.meta.url)), 'utf8');
  assert.match(setup, /target: "providers"/);
  assert.match(setup, /## Media handbook handoff/);
  assert.match(setup, /not-included.*openmotion_open_preview.*target: "providers".*page handoff/);
  assert.match(setup, /Signed-in account.*available: true.*unknown/);
  assert.match(setup, /MCP handbook media-generation example/);
  assert.match(setup, /read-only `inspect`/);
  assert.match(skill, /MCP handbook example \| \[Discovery and setup\]/);
});

test('asset naming scenario is localized in all eleven interface languages', () => {
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/mcp-ui.json', import.meta.url), 'utf8'));
  const scenario = mcpScenarios.find(item => item.id === 'asset-naming')!;
  for (const locale of Object.values(translations) as Record<string, string>[]) {
    for (const message of [scenario.title, scenario.description, scenario.prompt]) assert.ok(locale[message], message);
  }
});

test('Streamable HTTP client comparison and final-video recovery are localized across all interface languages', () => {
  const answer = mcpFaq.find(([question]) => question === 'What if the final video cannot load?')![1];
  const matrix = mcpClientComparison.find(([capability]) => capability === 'Inline template cards and final video')!;
  const connectionRow = mcpClientComparison.find(([capability]) => capability === 'Connection')!;
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/mcp-ui.json', import.meta.url), 'utf8'));
  assert.match(connectionRow[1], /Streamable HTTP \(\/mcp\)/);
  assert.match(connectionRow[3], /HTTPS \+ OAuth 2\.1/);
  assert.match(answer, /Codex normally shows it in the final reply/);
  assert.match(answer, /never both for the same video/);
  assert.match(answer, /without rendering again/);
  for (const [language, values] of Object.entries(translations) as [string, Record<string, string>][]) {
    for (const key of [answer, matrix[1], matrix[2], connectionRow[3]]) {
      assert.ok(values[key]?.trim(), `${language}: missing localized guidance for "${key}"`);
      assert.notEqual(values[key], key, `${language}: English fallback for "${key}"`);
    }
  }
});

test('canvas and caption controls expose atomic operations and an actionable handbook example', () => {
  const capability = mcpCapabilities.find(item => item.id === 'canvas-captions')!;
  assert.match(capability.prompt, /openmotion_edit_project.*canvas=/);
  assert.match(capability.prompt, /caption_toggle/);
  assert.match(capability.prompt, /stable requestId/);
  assert.match(capability.description, /Locked tracks.*Conflicts.*without automatic subject detection/);
  const schema = phase1Tools.find(tool => tool.name === 'openmotion_edit_project')!.inputSchema;
  assert.ok(schema.properties.canvas); assert.ok(!schema.required.includes('files'));
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/canvas-ui.json', import.meta.url), 'utf8'));
  for (const [language, values] of Object.entries(translations) as [string, Record<string, string>][]) {
    for (const key of [capability.title, capability.description, capability.prompt]) assert.ok(values[key]?.trim() && values[key] !== key, `${language}: missing canvas guidance`);
  }
});

test('fullscreen guidance distinguishes browser presentation from an Agent project operation', () => {
  const capability = mcpCapabilities.find(item => item.id === 'fullscreen')!;
  assert.deepEqual(capability.tools, ['openmotion_open_preview']);
  assert.match(capability.description, /Embedded hosts may block/); assert.match(capability.prompt, /do not render or edit/);
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/fullscreen-ui.json', import.meta.url), 'utf8'));
  for (const [language, values] of Object.entries(translations) as [string, Record<string, string>][]) {
    for (const key of [capability.title, capability.description, capability.prompt]) assert.ok(values[key]?.trim() && values[key] !== key, `${language}: missing fullscreen guidance`);
  }
});

test('timeline hover inspection remains a localized, non-mutating preview scenario', () => {
  const capability = mcpCapabilities.find(item => item.id === 'timeline-hover')!;
  assert.deepEqual(capability.tools, ['openmotion_open_preview']);
  assert.match(capability.description, /Pause playback.*Click the ruler.*if loading fails/);
  assert.match(capability.prompt, /Preserve the source and selection; do not export or generate media/);
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/timeline-hover-ui.json', import.meta.url), 'utf8'));
  for (const [language, values] of Object.entries(translations) as [string, Record<string, string>][]) {
    for (const key of [capability.title, capability.description, capability.prompt]) assert.ok(values[key]?.trim() && values[key] !== key, `${language}: missing hover guidance`);
  }
});
