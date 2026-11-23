import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import {
  HOST_CAPABILITIES,
  type AtomDetectResult,
  type AtomExecResult,
  type DetectedAgentCli,
} from '../../../shared/desktop-contract';
import { DEFAULT_MCP_SERVER_NAME } from '../../../shared/desktop-builtin-rules';
import { CONNECT_SCRIPT_DEFAULT_PORT } from '../../../shared/connect-script-protocol';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { Skeleton } from '../components/ui/Skeleton';
import { Tooltip } from '../components/ui/Tooltip';
import { ProviderAvatar } from './settingsPrimitives';
import {
  invokeHostAtom,
  resolveCapabilityMethod,
  useHostCapabilities,
} from '../utils/platformHost';
import {
  connectLocalConnectBridge,
  disconnectLocalConnectBridge,
  getLocalConnectStatus,
} from '../utils/localConnectBridge';

export type DesktopConnectAgentId = 'codex' | 'claude';

export type DesktopConnectAgentConnectionState =
  | 'not-installed'
  | 'not-configured'
  | 'conflict'
  | 'configured'
  | 'authorized';

export type DesktopConnectPanelProps = {
  /** Streamable HTTP MCP endpoint URL to register. Defaults to `${window.location.origin}/mcp`. */
  mcpUrl?: string;
  /** Optional MCP server identifier. Defaults to `openmotion`. */
  serverName?: string;
  /**
   * External evidence confirming that an Agent has completed OAuth authorization
   * or an authenticated MCP tool call. "Authorized & ready" is only displayed when
   * this evidence is true; local config writes alone only show "Config written".
   */
  hasAuthorizedConnection?: boolean | Partial<Record<DesktopConnectAgentId, boolean>>;
  /** Optional callback fired after an Agent MCP configuration is written. */
  onConfigured?: (agentId: DesktopConnectAgentId) => void;
  /** Optional callback allowing the user to re-check cloud authorization status. */
  onCheckAuthorization?: () => void | Promise<void>;
  /** Compact spacing for narrow containers. */
  compact?: boolean;
};

type AgentMeta = {
  id: DesktopConnectAgentId;
  label: string;
  providerIconId: string;
  templateId: 'codex.mcp.add_remote' | 'claude.mcp.add_remote';
  buildFallbackCommand: (serverName: string, mcpUrl: string) => string;
};

type AgentConflictState = {
  existingUrl?: string;
  message: string;
};

const SUPPORTED_AGENTS: readonly AgentMeta[] = [
  {
    id: 'codex',
    label: 'Codex',
    providerIconId: 'codex',
    templateId: 'codex.mcp.add_remote',
    buildFallbackCommand: (serverName, mcpUrl) =>
      `codex mcp add ${serverName} --url ${mcpUrl}`,
  },
  {
    id: 'claude',
    label: 'Claude Code',
    providerIconId: 'claude-code',
    templateId: 'claude.mcp.add_remote',
    buildFallbackCommand: (serverName, mcpUrl) =>
      `claude mcp add --scope user --transport http ${serverName} ${mcpUrl}`,
  },
] as const;

function isAgentAuthorized(
  evidence: DesktopConnectPanelProps['hasAuthorizedConnection'],
  agentId: DesktopConnectAgentId,
): boolean {
  if (typeof evidence === 'boolean') return evidence;
  if (!evidence) return false;
  return Boolean(evidence[agentId]);
}

/**
 * Resolve the user-facing connection state for a local Agent CLI.
 * Strictly separates "Config written" (`configured`) from evidenced
 * "Authorized & ready" (`authorized`).
 */
export function resolveAgentConnectionState(
  agent: DetectedAgentCli | undefined,
  options: {
    hasConflict?: boolean;
    conflictKept?: boolean;
    configWritten?: boolean;
    hasAuthorizedConnection?: boolean;
  },
): DesktopConnectAgentConnectionState {
  if (!agent?.installed) return 'not-installed';
  if (options.hasConflict || (agent.mcpConflict && !options.conflictKept)) {
    return 'conflict';
  }
  const configured = Boolean(options.configWritten || (agent.mcpConfigured && !agent.mcpConflict));
  if (!configured) return 'not-configured';
  if (options.hasAuthorizedConnection) return 'authorized';
  return 'configured';
}

function defaultMcpUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin.replace(/\/$/, '')}/mcp`;
  }
  return 'https://motion.open-design.ai/mcp';
}

export function DesktopConnectPanel({
  mcpUrl,
  serverName = DEFAULT_MCP_SERVER_NAME,
  hasAuthorizedConnection = false,
  onConfigured,
  onCheckAuthorization,
  compact = false,
}: DesktopConnectPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const host = useHostCapabilities();

  const resolvedMcpUrl = useMemo(() => (mcpUrl?.trim() || defaultMcpUrl()), [mcpUrl]);
  const resolvedServerName = serverName.trim() || DEFAULT_MCP_SERVER_NAME;

  const [detection, setDetection] = useState<AtomDetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [connectingAgent, setConnectingAgent] = useState<DesktopConnectAgentId | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [writtenAgents, setWrittenAgents] = useState<Partial<Record<DesktopConnectAgentId, boolean>>>({});
  const [conflicts, setConflicts] = useState<Partial<Record<DesktopConnectAgentId, AgentConflictState>>>({});
  const [keptConflicts, setKeptConflicts] = useState<Partial<Record<DesktopConnectAgentId, boolean>>>({});

  // Web Connect Script pairing state (token stays strictly in React state / memory, never localStorage).
  const [portInput, setPortInput] = useState(String(CONNECT_SCRIPT_DEFAULT_PORT));
  const [tokenInput, setTokenInput] = useState('');
  const [pairing, setPairing] = useState(false);

  const canDetect = Boolean(host.bridge && host.has(HOST_CAPABILITIES.ATOM_DETECT, '1.0.0'));
  const canExec = Boolean(host.bridge && host.has(HOST_CAPABILITIES.ATOM_EXEC, '1.0.0'));
  const localConnectStatus = host.hostKind === 'connect-script' ? getLocalConnectStatus() : null;

  const runDetection = useCallback(
    async (options?: { notify?: boolean }) => {
      if (!host.bridge || !canDetect) return;
      setDetecting(true);
      setDetectError(null);
      try {
        const primaryMethod = resolveCapabilityMethod(
          host.capabilities,
          HOST_CAPABILITIES.ATOM_DETECT,
          ['run', 'detect', 'scan'],
        );
        let result = await invokeHostAtom<AtomDetectResult>(
          HOST_CAPABILITIES.ATOM_DETECT,
          primaryMethod,
          undefined,
          { bridge: host.bridge },
        );
        if (!result.ok && result.error.code === 'UNSUPPORTED' && primaryMethod === 'run') {
          result = await invokeHostAtom<AtomDetectResult>(
            HOST_CAPABILITIES.ATOM_DETECT,
            'detect',
            undefined,
            { bridge: host.bridge },
          );
        }
        if (result.ok) {
          setDetection(result.data);
          if (options?.notify) {
            toast.showToast(t('Local Agent status updated'), 'info', 'feedback');
          }
        } else {
          setDetectError(result.error.message);
          if (options?.notify) {
            toast.showToast(result.error.message, 'error', 'feedback');
          }
        }
      } finally {
        setDetecting(false);
      }
    },
    [host.bridge, host.capabilities, canDetect, t, toast.showToast],
  );

  useEffect(() => {
    if (!host.bridge || host.loading || !canDetect) {
      if (!host.bridge) {
        setDetection(null);
        setDetectError(null);
        setConflicts({});
        setKeptConflicts({});
        setWrittenAgents({});
      }
      return;
    }
    void runDetection();
  }, [host.bridge, host.loading, canDetect, runDetection]);

  const connectAgent = useCallback(
    async (meta: AgentMeta, conflictPolicy: 'abort' | 'replace' = 'abort') => {
      if (!host.bridge || !canExec) {
        toast.showToast(t('One-click setup is unavailable for this connection.'), 'error', 'feedback');
        return;
      }
      setConnectingAgent(meta.id);
      try {
        const params = {
          featureId: 'mcp_connect',
          templateId: meta.templateId,
          args: {
            serverName: resolvedServerName,
            mcpUrl: resolvedMcpUrl,
          },
          conflictPolicy,
        };
        const primaryMethod = resolveCapabilityMethod(
          host.capabilities,
          HOST_CAPABILITIES.ATOM_EXEC,
          ['run', 'exec'],
        );
        let result = await invokeHostAtom<AtomExecResult>(
          HOST_CAPABILITIES.ATOM_EXEC,
          primaryMethod,
          params,
          { bridge: host.bridge },
        );
        if (!result.ok && result.error.code === 'UNSUPPORTED' && primaryMethod === 'run') {
          result = await invokeHostAtom<AtomExecResult>(
            HOST_CAPABILITIES.ATOM_EXEC,
            'exec',
            params,
            { bridge: host.bridge },
          );
        }

        if (result.ok) {
          setWrittenAgents(previous => ({ ...previous, [meta.id]: true }));
          setConflicts(previous => {
            const next = { ...previous };
            delete next[meta.id];
            return next;
          });
          setKeptConflicts(previous => {
            const next = { ...previous };
            delete next[meta.id];
            return next;
          });
          onConfigured?.(meta.id);
          toast.showToast(
            t('Config written for {agent}. Open {agent} to complete sign-in.', { agent: meta.label }),
            'info',
            'feedback',
          );
          void runDetection();
          return;
        }

        if (result.error.code === 'CONFLICT') {
          const detected = detection?.agents.find(item => item.agentId === meta.id);
          const existingUrl =
            typeof result.error.details?.existingUrl === 'string'
              ? result.error.details.existingUrl
              : detected?.mcpUrl;
          setConflicts(previous => ({
            ...previous,
            [meta.id]: {
              existingUrl,
              message: result.error.message,
            },
          }));
          setKeptConflicts(previous => {
            const next = { ...previous };
            delete next[meta.id];
            return next;
          });
          toast.showToast(
            t('An existing OpenMotion MCP entry was found in {agent}. Choose whether to replace or keep it.', {
              agent: meta.label,
            }),
            'info',
            'feedback',
          );
          return;
        }

        if (result.error.code === 'USER_DENIED') {
          toast.showToast(t('Connection canceled.'), 'info', 'feedback');
          return;
        }

        toast.showToast(result.error.message || t('Could not write MCP configuration.'), 'error', 'feedback');
      } finally {
        setConnectingAgent(null);
      }
    },
    [
      host.bridge,
      host.capabilities,
      canExec,
      resolvedServerName,
      resolvedMcpUrl,
      detection,
      onConfigured,
      runDetection,
      t,
      toast.showToast,
    ],
  );

  const keepExistingConfig = useCallback(
    (meta: AgentMeta) => {
      setConflicts(previous => {
        const next = { ...previous };
        delete next[meta.id];
        return next;
      });
      setKeptConflicts(previous => ({ ...previous, [meta.id]: true }));
      toast.showToast(
        t('Kept your existing {agent} configuration.', { agent: meta.label }),
        'info',
        'feedback',
      );
    },
    [t, toast.showToast],
  );

  const copyCommand = useCallback(
    async (command: string) => {
      try {
        await navigator.clipboard.writeText(command);
        toast.showToast(t('Copied to clipboard'), 'info', 'feedback');
      } catch {
        toast.showToast(t('Could not copy. Select and copy the command manually.'), 'error', 'feedback');
      }
    },
    [t, toast.showToast],
  );

  const handleCheckAuthorization = useCallback(async () => {
    if (!onCheckAuthorization) return;
    setCheckingAuth(true);
    try {
      await onCheckAuthorization();
    } catch {
      toast.showToast(t('Could not refresh connection status.'), 'error', 'feedback');
    } finally {
      setCheckingAuth(false);
    }
  }, [onCheckAuthorization, t, toast.showToast]);

  const handlePairConnectScript = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const parsedPort = Number.parseInt(portInput.trim(), 10);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        toast.showToast(t('Enter a valid port number between 1 and 65535.'), 'error', 'feedback');
        return;
      }
      if (!tokenInput.trim()) {
        toast.showToast(t('Enter the pairing token shown by the local helper.'), 'error', 'feedback');
        return;
      }
      setPairing(true);
      try {
        const result = await connectLocalConnectBridge({
          port: parsedPort,
          token: tokenInput,
        });
        if (result.ok) {
          setTokenInput('');
          toast.showToast(t('Connected to local helper.'), 'info', 'feedback');
        } else {
          toast.showToast(result.error.message, 'error', 'feedback');
        }
      } finally {
        setPairing(false);
      }
    },
    [portInput, tokenInput, t, toast.showToast],
  );

  const handleDisconnectHelper = useCallback(() => {
    disconnectLocalConnectBridge();
    toast.showToast(t('Disconnected from local helper.'), 'info', 'feedback');
  }, [t, toast.showToast]);

  const detectedMap = useMemo(() => {
    const map = new Map<string, DetectedAgentCli>();
    for (const agent of detection?.agents ?? []) {
      map.set(agent.agentId, agent);
    }
    return map;
  }, [detection]);

  return (
    <section
      className="om-card om-card-stack"
      data-desktop-connect-panel
      data-host-kind={host.hostKind ?? 'web'}
      data-compact={compact || undefined}
      aria-label={t('Connect local Agents')}
    >
      <div className="om-settings-row" style={{ width: '100%' }}>
        <div style={{ display: 'grid', gap: 'var(--motion-space-4)', minWidth: 0 }}>
          <div className="om-settings-tags">
            <h2 className="om-subtitle">{t('Connect local Agents')}</h2>
            {host.hostKind === 'desktop' && (
              <span className="om-badge" data-active="true">
                <RemixIcon name="computer-line" size={12} />
                {t('Desktop app')}
              </span>
            )}
            {host.hostKind === 'connect-script' && (
              <span className="om-badge" data-active="true">
                <RemixIcon name="link" size={12} />
                {t('Local helper · 127.0.0.1:{port}', {
                  port: localConnectStatus?.port ?? CONNECT_SCRIPT_DEFAULT_PORT,
                })}
              </span>
            )}
          </div>
          <p className="om-muted" style={{ margin: 0 }}>
            {host.bridge
              ? t(
                  'Configure Codex or Claude Code for this workspace in one click, then approve sign-in inside your Agent.',
                )
              : t(
                  'Pair a local helper for one-click setup in the browser, or copy the command to connect manually.',
                )}
          </p>
        </div>

        <div className="om-settings-actions">
          {host.bridge && canDetect && (
            <Tooltip label={t('Rescan local Agents')} wrap>
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('Rescan local Agents')}
                disabled={detecting}
                onClick={() => void runDetection({ notify: true })}
                icon={<RemixIcon name="refresh-line" size={15} />}
              />
            </Tooltip>
          )}
          {host.hostKind === 'connect-script' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDisconnectHelper}
            >
              {t('Disconnect')}
            </Button>
          )}
        </div>
      </div>

      {host.bridge ? (
        <div style={{ width: '100%', display: 'grid', gap: 'var(--motion-space-12)' }}>
          {host.loading || (detecting && !detection) ? (
            <div
              role="status"
              aria-label={t('Checking local Agents…')}
              style={{ display: 'grid', gap: 'var(--motion-space-10)', width: '100%' }}
            >
              <Skeleton style={{ width: '100%', height: 56 }} />
              <Skeleton style={{ width: '100%', height: 56 }} />
            </div>
          ) : !canDetect ? (
            <div className="om-inset" style={{ display: 'grid', gap: 'var(--motion-space-8)' }}>
              <p className="om-muted" style={{ margin: 0 }}>
                {t('This version of the desktop app does not support automatic Agent detection yet. Copy a CLI command below to connect manually.')}
              </p>
              <FallbackCommandList
                serverName={resolvedServerName}
                mcpUrl={resolvedMcpUrl}
                onCopy={copyCommand}
              />
            </div>
          ) : detectError && !detection ? (
            <div className="om-inset" style={{ display: 'grid', gap: 'var(--motion-space-10)', justifyItems: 'start' }}>
              <p className="om-muted" style={{ margin: 0 }}>
                {t('Could not inspect local Agents: {reason}', { reason: detectError })}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void runDetection({ notify: true })}
                icon={<RemixIcon name="refresh-line" size={14} />}
              >
                {t('Try again')}
              </Button>
            </div>
          ) : (
            <div style={{ width: '100%', display: 'grid' }}>
              {SUPPORTED_AGENTS.map((meta, index) => {
                const detected = detectedMap.get(meta.id);
                const conflict = conflicts[meta.id];
                const conflictKept = Boolean(keptConflicts[meta.id]);
                const authorizedEvidence = isAgentAuthorized(hasAuthorizedConnection, meta.id);
                const state = resolveAgentConnectionState(detected, {
                  hasConflict: Boolean(conflict),
                  conflictKept,
                  configWritten: Boolean(writtenAgents[meta.id]),
                  hasAuthorizedConnection: authorizedEvidence,
                });
                const existingUrl = conflict?.existingUrl ?? detected?.mcpUrl;
                const busy = connectingAgent === meta.id;

                return (
                  <div
                    key={meta.id}
                    data-agent-id={meta.id}
                    data-connection-state={state}
                    style={{
                      display: 'grid',
                      gap: 'var(--motion-space-10)',
                      paddingBlock: 'var(--motion-space-14)',
                      borderTop: index > 0 ? '1px solid var(--motion-border-subtle)' : undefined,
                      paddingTop: index === 0 ? 0 : 'var(--motion-space-14)',
                      paddingBottom: index === SUPPORTED_AGENTS.length - 1 ? 0 : 'var(--motion-space-14)',
                    }}
                  >
                    <div className="om-settings-row" style={{ flexWrap: 'wrap', gap: 'var(--motion-space-12)' }}>
                      <div className="om-provider-heading" style={{ minWidth: 0, flex: '1 1 220px' }}>
                        <ProviderAvatar
                          name={meta.label}
                          provider={{ id: meta.providerIconId, custom: false }}
                        />
                        <div style={{ display: 'grid', gap: 'var(--motion-space-2)', minWidth: 0 }}>
                          <div className="om-settings-tags">
                            <strong style={{ color: 'var(--motion-strong)', fontSize: 'var(--motion-text-body)' }}>
                              {meta.label}
                            </strong>
                            {detected?.version && (
                              <span className="om-muted" style={{ fontSize: 'var(--motion-text-xs)' }}>
                                {detected.version}
                              </span>
                            )}
                            <ConnectionStateBadge state={state} />
                          </div>
                          <p className="om-muted" style={{ margin: 0 }}>
                            {state === 'not-installed' &&
                              t('Not found on this computer. Install {agent}, then rescan.', {
                                agent: meta.label,
                              })}
                            {state === 'not-configured' &&
                              t('Installed and ready to connect to this workspace.')}
                            {state === 'conflict' &&
                              t('An existing "{name}" MCP entry points to a different address.', {
                                name: resolvedServerName,
                              })}
                            {state === 'configured' &&
                              t('Config written. Open {agent} and approve sign-in when prompted.', {
                                agent: meta.label,
                              })}
                            {state === 'authorized' &&
                              t('{agent} is authorized and ready to work in this workspace.', {
                                agent: meta.label,
                              })}
                          </p>
                        </div>
                      </div>

                      <div className="om-settings-actions">
                        {state === 'not-configured' && (
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            loading={busy}
                            disabled={!canExec || (connectingAgent !== null && !busy)}
                            onClick={() => void connectAgent(meta, 'abort')}
                            icon={<RemixIcon name="plug-line" size={14} />}
                          >
                            {t('Connect {agent}', { agent: meta.label })}
                          </Button>
                        )}
                        {state === 'configured' && (
                          <>
                            {onCheckAuthorization && (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                loading={checkingAuth}
                                onClick={() => void handleCheckAuthorization()}
                                icon={<RemixIcon name="refresh-line" size={14} />}
                              >
                                {t('Check sign-in')}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              loading={busy}
                              disabled={!canExec || (connectingAgent !== null && !busy)}
                              onClick={() => void connectAgent(meta, 'abort')}
                            >
                              {t('Re-apply config')}
                            </Button>
                          </>
                        )}
                        {state === 'authorized' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            loading={busy}
                            disabled={!canExec || (connectingAgent !== null && !busy)}
                            onClick={() => void connectAgent(meta, 'abort')}
                          >
                            {t('Re-apply config')}
                          </Button>
                        )}
                        {state === 'not-installed' && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled
                          >
                            {t('Connect {agent}', { agent: meta.label })}
                          </Button>
                        )}
                      </div>
                    </div>

                    {state === 'conflict' && (
                      <div
                        className="om-inset"
                        data-conflict-panel={meta.id}
                        style={{ display: 'grid', gap: 'var(--motion-space-10)' }}
                      >
                        <div style={{ display: 'grid', gap: 'var(--motion-space-4)' }}>
                          <strong style={{ color: 'var(--motion-strong)', fontSize: 'var(--motion-text-sm)' }}>
                            {t('Replace existing MCP address?')}
                          </strong>
                          <p className="om-muted" style={{ margin: 0 }}>
                            {conflict?.message ||
                              t(
                                'Your {agent} configuration already has an "{name}" entry. Choose whether to update it to this workspace or keep your current setup.',
                                { agent: meta.label, name: resolvedServerName },
                              )}
                          </p>
                          {existingUrl && (
                            <p className="om-muted" style={{ margin: 0, fontFamily: 'var(--motion-font-mono)' }}>
                              {t('Current: {url}', { url: existingUrl })}
                            </p>
                          )}
                          <p className="om-muted" style={{ margin: 0, fontFamily: 'var(--motion-font-mono)' }}>
                            {t('New: {url}', { url: resolvedMcpUrl })}
                          </p>
                        </div>
                        <div className="om-settings-actions">
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            loading={busy}
                            disabled={!canExec || (connectingAgent !== null && !busy)}
                            onClick={() => void connectAgent(meta, 'replace')}
                          >
                            {t('Replace existing URL')}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => keepExistingConfig(meta)}
                          >
                            {t('Keep current config')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div style={{ width: '100%', display: 'grid', gap: 'var(--motion-space-16)' }}>
          <form
            onSubmit={event => void handlePairConnectScript(event)}
            data-connect-script-form
            style={{ display: 'grid', gap: 'var(--motion-space-12)', width: '100%' }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'minmax(110px, 140px) minmax(0, 1fr)',
                gap: 'var(--motion-space-10)',
                width: '100%',
              }}
            >
              <label className="om-label">
                <span>{t('Local port')}</span>
                <span className="om-field">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={portInput}
                    onChange={event => setPortInput(event.target.value)}
                    aria-label={t('Local port')}
                    placeholder={String(CONNECT_SCRIPT_DEFAULT_PORT)}
                    disabled={pairing}
                  />
                </span>
              </label>

              <label className="om-label">
                <span>{t('Pairing token')}</span>
                <span className="om-field">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={tokenInput}
                    onChange={event => setTokenInput(event.target.value)}
                    aria-label={t('Pairing token')}
                    placeholder={t('Paste token from your terminal')}
                    disabled={pairing}
                  />
                </span>
              </label>
            </div>

            <div className="om-settings-actions">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={pairing}
                icon={<RemixIcon name="link" size={14} />}
              >
                {t('Pair local helper')}
              </Button>
              <span className="om-muted">
                {t('Token stays in memory for this tab only.')}
              </span>
            </div>
          </form>

          <div
            style={{
              display: 'grid',
              gap: 'var(--motion-space-10)',
              paddingTop: 'var(--motion-space-12)',
              borderTop: '1px solid var(--motion-border-subtle)',
            }}
          >
            <p className="om-muted" style={{ margin: 0 }}>
              {t('Or connect directly from your terminal:')}
            </p>
            <FallbackCommandList
              serverName={resolvedServerName}
              mcpUrl={resolvedMcpUrl}
              onCopy={copyCommand}
            />
          </div>
        </div>
      )}

      <StudioToastViewport {...toast} />
    </section>
  );
}

function ConnectionStateBadge({ state }: { state: DesktopConnectAgentConnectionState }) {
  const { t } = useI18n();
  if (state === 'authorized') {
    return (
      <span className="om-badge" data-active="true" data-state-badge="authorized">
        <RemixIcon name="checkbox-circle-line" size={12} />
        {t('Authorized & ready')}
      </span>
    );
  }
  if (state === 'configured') {
    return (
      <span className="om-badge" data-state-badge="configured">
        <RemixIcon name="check-line" size={12} />
        {t('Config written')}
      </span>
    );
  }
  if (state === 'conflict') {
    return (
      <span
        className="om-badge"
        data-state-badge="conflict"
        style={{
          color: 'var(--motion-warning)',
          background: 'var(--motion-warning-soft)',
          borderColor: 'var(--motion-warning)',
        }}
      >
        <RemixIcon name="alert-line" size={12} />
        {t('Existing config found')}
      </span>
    );
  }
  if (state === 'not-configured') {
    return (
      <span className="om-badge" data-state-badge="not-configured">
        {t('Not connected')}
      </span>
    );
  }
  return (
    <span className="om-badge" data-state-badge="not-installed">
      {t('Not installed')}
    </span>
  );
}

function FallbackCommandList({
  serverName,
  mcpUrl,
  onCopy,
}: {
  serverName: string;
  mcpUrl: string;
  onCopy: (command: string) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'grid', gap: 'var(--motion-space-10)', width: '100%' }}>
      {SUPPORTED_AGENTS.map(meta => {
        const command = meta.buildFallbackCommand(serverName, mcpUrl);
        return (
          <div
            key={meta.id}
            data-fallback-command={meta.id}
            style={{ display: 'grid', gap: 'var(--motion-space-6)', width: '100%' }}
          >
            <div className="om-settings-row">
              <strong
                className="font-medium"
                style={{ color: 'var(--motion-strong)', fontSize: 'var(--motion-text-sm)' }}
              >
                {meta.label}
              </strong>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void onCopy(command)}
                icon={<RemixIcon name="file-copy-line" size={14} />}
              >
                {t('Copy command')}
              </Button>
            </div>
            <pre className="om-code-block">{command}</pre>
          </div>
        );
      })}
    </div>
  );
}
