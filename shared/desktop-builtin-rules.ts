/**
 * Q1 Frozen Built-in Shell Rules (Security Boundary).
 *
 * Principle (Design Doc §5.6):
 * The shell defines WHAT kinds of operations exist; signed config only
 * chooses WHO to target and WHAT parameter values to supply within these
 * built-in boundaries.
 */

import type { BuiltinConfigFieldType, HostReleaseChannel } from './desktop-contract.ts';

export const DESKTOP_APP_ID = 'io.nexu.openmotion.desktop' as const;
export const DESKTOP_PRODUCT_NAME = 'OpenDesign' as const;
export const DESKTOP_PROTOCOL_SCHEME = 'openmotion' as const;
export const DESKTOP_DATA_LAYOUT_VERSION = 1 as const;
export const DEFAULT_MCP_SERVER_NAME = 'openmotion' as const;

export const DEFAULT_STUDIO_URLS: Record<HostReleaseChannel, string> = {
  stable: 'https://motion.open-design.ai',
  test: 'https://openmotion.powerformer.net',
  dev: 'http://127.0.0.1:4173',
};

export const DEFAULT_UPDATE_BASE_URL = 'https://releases.open-design.ai/open-motion/desktop' as const;
export const DEFAULT_SIGNED_CONFIG_BASE_URL = 'https://releases.open-design.ai/open-motion/desktop/config' as const;

/**
 * Allowed domains baked into the shell.
 * Production ('stable') is strictly locked to open-design.ai and its subdomains.
 * Test/dev builds additionally allow openmotion.powerformer.net (staging).
 */
export const BUILTIN_ALLOWED_DOMAINS_STABLE: readonly string[] = ['open-design.ai'] as const;
export const BUILTIN_ALLOWED_DOMAINS_TEST: readonly string[] = [
  'open-design.ai',
  'openmotion.powerformer.net',
] as const;

/**
 * Built-in config field types allowed for atom.config in v1.
 */
export const BUILTIN_CONFIG_FIELD_TYPES: readonly BuiltinConfigFieldType[] = ['remote_mcp_entry'] as const;

/**
 * Built-in signed binary publisher allowlist (v1).
 * Contains the Apple Developer Team ID(s) authorized to sign first-party
 * components (such as the Murmur engine and future Local Bridge Daemon).
 *
 * NOTE: Verify exact Team ID parity between Murmur engine and OpenMotion
 * desktop signing certificates before shipping Stage 3 / Scene B.
 */
export type BuiltinPublisherEntry = {
  id: string;
  label: string;
  appleTeamId: string;
};

export const BUILTIN_PUBLISHERS: readonly BuiltinPublisherEntry[] = [
  {
    id: 'powerformer-murmur',
    label: 'Powerformer / Murmur Signing Team',
    // Override via build-time injection or update once Murmur Team ID is confirmed (Doc §5.6).
    appleTeamId: 'POWERFORMER_MURMUR_TEAM_ID_PENDING',
  },
] as const;

export type TemplatePlaceholderType =
  | 'identifier'
  | 'url_in_domain_scope'
  | 'agent_id'
  | 'model_id'
  | 'semver'
  | 'boolean';

export type BuiltinThirdPartyTemplate = {
  templateId: string;
  program: 'codex' | 'claude';
  mutating: boolean;
  /** Argv tokens; `{paramName}` denotes a typed placeholder. Never passed to a shell. */
  argv: readonly string[];
  params: Record<string, { type: TemplatePlaceholderType; required?: boolean; defaultValue?: string }>;
  description: string;
};

/**
 * Built-in third-party CLI allowlist (v1): codex and claude only,
 * each with version, remote MCP register, and MCP remove templates.
 */
export const BUILTIN_THIRD_PARTY_PROGRAMS = ['codex', 'claude'] as const;
export type BuiltinThirdPartyProgram = (typeof BUILTIN_THIRD_PARTY_PROGRAMS)[number];

export const BUILTIN_THIRD_PARTY_TEMPLATES: readonly BuiltinThirdPartyTemplate[] = [
  {
    templateId: 'codex.version',
    program: 'codex',
    mutating: false,
    argv: ['--version'],
    params: {},
    description: 'Read installed Codex CLI version',
  },
  {
    templateId: 'codex.mcp.add_remote',
    program: 'codex',
    mutating: true,
    argv: ['mcp', 'add', '{serverName}', '--url', '{mcpUrl}'],
    params: {
      serverName: { type: 'identifier', required: false, defaultValue: DEFAULT_MCP_SERVER_NAME },
      mcpUrl: { type: 'url_in_domain_scope', required: true },
    },
    description: 'Register remote OpenMotion MCP server in Codex CLI',
  },
  {
    templateId: 'codex.mcp.remove',
    program: 'codex',
    mutating: true,
    argv: ['mcp', 'remove', '{serverName}'],
    params: {
      serverName: { type: 'identifier', required: false, defaultValue: DEFAULT_MCP_SERVER_NAME },
    },
    description: 'Remove OpenMotion MCP server from Codex CLI',
  },
  {
    templateId: 'claude.version',
    program: 'claude',
    mutating: false,
    argv: ['--version'],
    params: {},
    description: 'Read installed Claude Code CLI version',
  },
  {
    templateId: 'claude.mcp.add_remote',
    program: 'claude',
    mutating: true,
    argv: ['mcp', 'add', '--scope', 'user', '--transport', 'http', '{serverName}', '{mcpUrl}'],
    params: {
      serverName: { type: 'identifier', required: false, defaultValue: DEFAULT_MCP_SERVER_NAME },
      mcpUrl: { type: 'url_in_domain_scope', required: true },
    },
    description: 'Register remote OpenMotion MCP server in Claude Code CLI (user scope)',
  },
  {
    templateId: 'claude.mcp.remove',
    program: 'claude',
    mutating: true,
    argv: ['mcp', 'remove', '--scope', 'user', '{serverName}'],
    params: {
      serverName: { type: 'identifier', required: false, defaultValue: DEFAULT_MCP_SERVER_NAME },
    },
    description: 'Remove OpenMotion MCP server from Claude Code CLI (user scope)',
  },
] as const;

export const BUILTIN_TEMPLATE_MAP: ReadonlyMap<string, BuiltinThirdPartyTemplate> = new Map(
  BUILTIN_THIRD_PARTY_TEMPLATES.map(template => [template.templateId, template]),
);

const IDENTIFIER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const MODEL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

export function getAllowedDomains(channel: HostReleaseChannel): readonly string[] {
  return channel === 'stable' ? BUILTIN_ALLOWED_DOMAINS_STABLE : BUILTIN_ALLOWED_DOMAINS_TEST;
}

export function isHostInAllowedDomains(
  hostname: string,
  channel: HostReleaseChannel = 'stable',
  allowLocalDevLoopback = false,
): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return false;
  if (allowLocalDevLoopback && channel === 'dev' && (normalized === '127.0.0.1' || normalized === 'localhost')) {
    return true;
  }
  const domains = getAllowedDomains(channel);
  return domains.some(domain => normalized === domain || normalized.endsWith(`.${domain}`));
}

export function isUrlInAllowedDomainScope(
  rawUrl: string,
  options?: { channel?: HostReleaseChannel; allowLocalDevLoopback?: boolean },
): boolean {
  const channel = options?.channel ?? 'stable';
  const allowLocalDev = Boolean(options?.allowLocalDevLoopback && channel === 'dev');
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === 'https:') {
      return isHostInAllowedDomains(parsed.hostname, channel, false);
    }
    if (allowLocalDev && parsed.protocol === 'http:') {
      return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    }
    return false;
  } catch {
    return false;
  }
}

export function isBuiltinPublisherId(publisherId: string): boolean {
  return BUILTIN_PUBLISHERS.some(entry => entry.id === publisherId);
}

export function isBuiltinConfigFieldType(value: string): value is BuiltinConfigFieldType {
  return (BUILTIN_CONFIG_FIELD_TYPES as readonly string[]).includes(value);
}

const MURMUR_FORBIDDEN_VERBS = new Set([
  'run',
  'exec',
  'launch',
  'claude-code',
  'claude-desktop',
  'claude-mcp-helper',
  'claude-tui-helper',
  'plugin',
  'plugins',
  'shell',
]);

const MURMUR_SAFE_DAEMON_VERBS = new Set([
  'install',
  'uninstall',
  'start',
  'stop',
  'restart',
  'status',
]);

/**
 * Built-in shell bound for first-party component command templates (M9 security audit).
 *
 * Audit of murmurant (`pool/internal/cli/start_cli.go`) confirmed that
 * `murmur magpie <agent> run [args...]` executes external agent binaries via
 * `syscall.Exec`. To preserve the two-tier compromise boundary (a leaked daily
 * signing key must never execute arbitrary agent tasks), the shell rejects any
 * launcher/exec subcommand for `murmur-engine` and restricts it to management
 * subcommands only.
 */
export function validateFirstPartyCommandArgvBounds(
  componentId: string,
  argv: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, reason: 'First-party command argv must be a non-empty array' };
  }
  for (const token of argv) {
    if (typeof token !== 'string' || !token.trim() || /[\r\n\0]/.test(token)) {
      return { ok: false, reason: 'First-party command argv contains invalid token' };
    }
  }
  if (componentId !== 'murmur-engine') {
    return { ok: true };
  }

  for (const token of argv) {
    if (MURMUR_FORBIDDEN_VERBS.has(token.toLowerCase())) {
      return {
        ok: false,
        reason: `Forbidden launcher/exec subcommand "${token}" in murmur-engine template`,
      };
    }
  }

  const [first, second, third] = argv;
  if (first === '--version' || first === 'version') {
    return argv.length === 1
      ? { ok: true }
      : { ok: false, reason: 'murmur version command must not take extra arguments' };
  }
  if (first === 'status') {
    return argv.every(tok => tok === 'status' || tok === '--json')
      ? { ok: true }
      : { ok: false, reason: 'murmur status command only allows --json' };
  }
  if (first === 'magpie') {
    if (second === 'daemon') {
      return argv.length === 3 && third !== undefined && MURMUR_SAFE_DAEMON_VERBS.has(third)
        ? { ok: true }
        : { ok: false, reason: 'murmur magpie daemon only allows install|uninstall|start|stop|restart|status' };
    }
    if (second === 'provider') {
      return argv.length >= 3
        ? { ok: true }
        : { ok: false, reason: 'murmur magpie provider requires a subcommand' };
    }
    // Agent toggle / restore: `magpie <agentId> <modelId|default>` (exactly 3 tokens, no `run`/`env`)
    if (
      argv.length === 3 &&
      second !== undefined &&
      third !== undefined &&
      second !== 'serve' &&
      second !== 'mcp' &&
      second !== 'import' &&
      third !== 'env'
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `Disallowed murmur magpie subcommand shape: ${argv.join(' ')}`,
    };
  }

  return {
    ok: false,
    reason: `Disallowed murmur-engine root subcommand: "${first}"`,
  };
}

export function validateTypedPlaceholderValue(
  type: TemplatePlaceholderType,
  rawValue: unknown,
  options?: { channel?: HostReleaseChannel; allowLocalDevLoopback?: boolean },
): { ok: true; value: string } | { ok: false; reason: string } {
  if (type === 'boolean') {
    if (typeof rawValue === 'boolean') return { ok: true, value: rawValue ? 'true' : 'false' };
    if (rawValue === 'true' || rawValue === 'false') return { ok: true, value: rawValue };
    return { ok: false, reason: 'Expected boolean value' };
  }
  if (typeof rawValue !== 'string') {
    return { ok: false, reason: `Expected string for placeholder type "${type}"` };
  }
  const trimmed = rawValue.trim();
  if (!trimmed || /[\r\n\0]/.test(trimmed)) {
    return { ok: false, reason: 'Value must be non-empty single-line text' };
  }
  switch (type) {
    case 'identifier':
    case 'agent_id':
      return IDENTIFIER_RE.test(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, reason: `Invalid ${type}: "${trimmed}"` };
    case 'model_id':
      return MODEL_ID_RE.test(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, reason: `Invalid model_id: "${trimmed}"` };
    case 'semver':
      return SEMVER_RE.test(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, reason: `Invalid semver: "${trimmed}"` };
    case 'url_in_domain_scope':
      return isUrlInAllowedDomainScope(trimmed, options)
        ? { ok: true, value: trimmed }
        : { ok: false, reason: `URL is outside allowed domain scope: "${trimmed}"` };
  }
}
