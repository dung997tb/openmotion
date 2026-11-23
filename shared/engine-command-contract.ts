/**
 * Q1 Frozen Contract — Murmur Engine Command & Status Contract (M9 alignment).
 *
 * Additive-only contract between signed config first-party command templates
 * and the external Murmur engine binary installed outside the app bundle.
 */

export const MURMUR_COMPONENT_ID = 'murmur-engine' as const;
export const MURMUR_ENGINE_HOST = '127.0.0.1' as const;
export const MURMUR_ENGINE_PORT = 3425 as const;
export const MURMUR_PERSONAL_IDENTITY_PREFIX = 'murmurant-personal-' as const;
export const OPENDESIGN_PROVIDER_ID = 'opendesign' as const;

/**
 * Supported `murmur status --json` schema version range.
 * If an independently upgraded engine reports a schemaVersion higher than
 * MURMUR_STATUS_MAX_SCHEMA_VERSION, the client degrades gracefully and waits
 * for a signed config update rather than guessing fields.
 */
export const MURMUR_STATUS_MIN_SCHEMA_VERSION = 1 as const;
export const MURMUR_STATUS_MAX_SCHEMA_VERSION = 1 as const;

/**
 * Security invariant tracked in M9:
 * First-party component command templates come from signed config; this remains
 * safe under signing-key compromise ONLY while Murmur exposes no subcommand
 * that executes arbitrary caller-supplied commands.
 */
export const MURMUR_NO_ARBITRARY_EXEC_INVARIANT =
  'murmur binary must never expose a subcommand that executes arbitrary caller-supplied commands without prior client security alignment' as const;

export const MURMUR_COMMAND_TEMPLATES = {
  VERSION: {
    templateId: 'murmur.version',
    componentId: MURMUR_COMPONENT_ID,
    mutating: false,
    argv: ['--version'] as const,
  },
  STATUS: {
    templateId: 'murmur.status',
    componentId: MURMUR_COMPONENT_ID,
    mutating: false,
    argv: ['status', '--json'] as const,
  },
  DAEMON_INSTALL: {
    templateId: 'murmur.daemon.install',
    componentId: MURMUR_COMPONENT_ID,
    mutating: true,
    argv: ['magpie', 'daemon', 'install'] as const,
  },
  DAEMON_UNINSTALL: {
    templateId: 'murmur.daemon.uninstall',
    componentId: MURMUR_COMPONENT_ID,
    mutating: true,
    argv: ['magpie', 'daemon', 'uninstall'] as const,
  },
  PROVIDER_UPSERT: {
    templateId: 'murmur.provider.upsert',
    componentId: MURMUR_COMPONENT_ID,
    mutating: true,
    /** Secret runtime key is delivered strictly via stdin, never argv. */
    stdinSecret: true,
    argv: ['magpie', 'provider', 'upsert', '--id', '{providerId}', '--api-key-stdin'] as const,
  },
  PROVIDER_REMOVE: {
    templateId: 'murmur.provider.remove',
    componentId: MURMUR_COMPONENT_ID,
    mutating: true,
    argv: ['magpie', 'provider', 'remove', '--id', '{providerId}'] as const,
  },
  AGENT_ENABLE: {
    templateId: 'murmur.agent.enable',
    componentId: MURMUR_COMPONENT_ID,
    mutating: true,
    argv: ['magpie', '{agentId}', '{modelId}'] as const,
  },
  AGENT_RESTORE: {
    templateId: 'murmur.agent.restore',
    componentId: MURMUR_COMPONENT_ID,
    mutating: true,
    argv: ['magpie', '{agentId}', 'default'] as const,
  },
} as const;

export type MurmurStatusPayload = {
  schemaVersion: number;
  version: string;
  mode: 'personal' | 'pool';
  daemonRunning: boolean;
  desktopMagpieActive?: boolean;
  loggedInToTeamGateway?: boolean;
  providers?: Array<{
    id: string;
    enabled: boolean;
    models?: string[];
  }>;
  agents?: Record<
    string,
    {
      managed: boolean;
      providerId?: string;
      modelId?: string;
    }
  >;
};
