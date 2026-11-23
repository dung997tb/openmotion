import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_PUBLISHERS,
  BUILTIN_TEMPLATE_MAP,
  BUILTIN_THIRD_PARTY_PROGRAMS,
  isUrlInAllowedDomainScope,
  validateTypedPlaceholderValue,
} from '../shared/desktop-builtin-rules.ts';
import { isValidDesktopLoopbackRedirectUri } from '../shared/desktop-auth-handoff.ts';
import { HOST_CAPABILITIES, HOST_CONTRACT_VERSION, hostErr, hostOk } from '../shared/desktop-contract.ts';
import { MURMUR_COMMAND_TEMPLATES, MURMUR_ENGINE_PORT } from '../shared/engine-command-contract.ts';
import { validateSignedConfigPayloadBounds } from '../shared/signed-config.ts';

test('Q1 built-in third-party allowlist contains codex and claude with 3 templates each', () => {
  assert.deepEqual([...BUILTIN_THIRD_PARTY_PROGRAMS], ['codex', 'claude']);
  for (const id of [
    'codex.version',
    'codex.mcp.add_remote',
    'codex.mcp.remove',
    'claude.version',
    'claude.mcp.add_remote',
    'claude.mcp.remove',
  ]) {
    assert.ok(BUILTIN_TEMPLATE_MAP.has(id), `missing built-in template ${id}`);
  }
  const claudeAdd = BUILTIN_TEMPLATE_MAP.get('claude.mcp.add_remote')!;
  assert.ok(claudeAdd.argv.includes('--scope') && claudeAdd.argv.includes('user'));
});

test('Q1 domain scope strictly confines stable builds to open-design.ai subdomains', () => {
  assert.equal(isUrlInAllowedDomainScope('https://motion.open-design.ai/mcp', { channel: 'stable' }), true);
  assert.equal(isUrlInAllowedDomainScope('https://open-design.ai', { channel: 'stable' }), true);
  assert.equal(isUrlInAllowedDomainScope('https://openmotion.powerformer.net', { channel: 'stable' }), false);
  assert.equal(isUrlInAllowedDomainScope('https://openmotion.powerformer.net', { channel: 'test' }), true);
  assert.equal(isUrlInAllowedDomainScope('https://evil-open-design.ai', { channel: 'stable' }), false);
  assert.equal(isUrlInAllowedDomainScope('http://motion.open-design.ai', { channel: 'stable' }), false);
  assert.equal(
    isUrlInAllowedDomainScope('http://127.0.0.1:4173', { channel: 'dev', allowLocalDevLoopback: true }),
    true,
  );
  assert.equal(
    isUrlInAllowedDomainScope('http://127.0.0.1:4173', { channel: 'stable', allowLocalDevLoopback: true }),
    false,
  );
});

test('Q1 signed config payload validation rejects out-of-bounds templates, domains, publishers, and paths', () => {
  const validIssues = validateSignedConfigPayloadBounds(
    {
      studioUrl: 'https://motion.open-design.ai',
      agents: {
        codex: {
          agentId: 'codex',
          displayName: 'Codex',
          binaryName: 'codex',
          versionTemplateId: 'codex.version',
          mcpAddTemplateId: 'codex.mcp.add_remote',
          mcpRemoveTemplateId: 'codex.mcp.remove',
        },
      },
      configRules: {
        codexMcp: {
          ruleId: 'codexMcp',
          agentId: 'codex',
          displayName: 'Codex MCP',
          fileFormat: 'toml',
          homeRelativePath: '.codex/config.toml',
          fieldType: 'remote_mcp_entry',
          sectionPath: 'mcp_servers',
        },
      },
      components: {
        'murmur-engine': {
          componentId: 'murmur-engine',
          displayName: 'Engine',
          minVersion: '0.1.0',
          platforms: {
            'darwin-arm64': {
              url: 'https://releases.open-design.ai/engine/murmur-darwin-arm64',
              sha256: 'a'.repeat(64),
              publisherId: BUILTIN_PUBLISHERS[0]!.id,
            },
          },
        },
      },
    },
    { channel: 'stable' },
  );
  assert.deepEqual(validIssues, []);

  const badIssues = validateSignedConfigPayloadBounds(
    {
      studioUrl: 'https://attacker.example.com',
      agents: {
        codex: {
          agentId: 'codex',
          displayName: 'Codex',
          binaryName: 'codex',
          mcpAddTemplateId: 'codex.exec_arbitrary',
        },
      },
      configRules: {
        escape: {
          ruleId: 'escape',
          agentId: 'codex',
          displayName: 'Escape',
          fileFormat: 'json',
          homeRelativePath: '../etc/passwd',
          fieldType: 'remote_mcp_entry',
          sectionPath: 'mcpServers',
        },
      },
      components: {
        evil: {
          componentId: 'evil',
          displayName: 'Evil',
          minVersion: '1.0.0',
          platforms: {
            'darwin-arm64': {
              url: 'https://evil.example.com/bin',
              sha256: 'not-a-hash',
              publisherId: 'unknown-team',
            },
          },
        },
      },
    },
    { channel: 'stable' },
  );
  assert.ok(badIssues.length >= 6);
});

test('Q1 loopback redirect URI, placeholders, and engine contract checks', () => {
  assert.equal(isValidDesktopLoopbackRedirectUri('http://127.0.0.1:48123/callback'), true);
  assert.equal(isValidDesktopLoopbackRedirectUri('http://localhost:48123/callback'), true);
  assert.equal(isValidDesktopLoopbackRedirectUri('https://127.0.0.1:48123/callback'), false);
  assert.equal(isValidDesktopLoopbackRedirectUri('http://127.0.0.1:80/callback'), false);
  assert.equal(isValidDesktopLoopbackRedirectUri('http://evil.com:48123/callback'), false);

  assert.equal(validateTypedPlaceholderValue('identifier', 'openmotion').ok, true);
  assert.equal(validateTypedPlaceholderValue('identifier', 'openmotion; rm -rf /').ok, false);
  assert.equal(
    validateTypedPlaceholderValue('url_in_domain_scope', 'https://motion.open-design.ai/mcp').ok,
    true,
  );
  assert.equal(validateTypedPlaceholderValue('url_in_domain_scope', 'https://evil.com/mcp').ok, false);

  assert.equal(HOST_CONTRACT_VERSION, '1.0.0');
  assert.equal(HOST_CAPABILITIES.ATOM_DETECT, 'atom.detect');
  assert.equal(MURMUR_ENGINE_PORT, 3425);
  assert.equal(MURMUR_COMMAND_TEMPLATES.PROVIDER_UPSERT.stdinSecret, true);
  assert.deepEqual(hostOk({ x: 1 }), { ok: true, data: { x: 1 } });
  assert.equal(hostErr('UNSUPPORTED', 'missing').ok, false);
});
