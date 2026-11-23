// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOST_CAPABILITIES,
  hostErr,
  hostOk,
  type AtomDetectResult,
  type HostInvokeResult,
  type UniversalHostBridge,
} from '../../../shared/desktop-contract';
import {
  CONNECT_SCRIPT_ENDPOINTS,
  CONNECT_SCRIPT_TOKEN_HEADER,
} from '../../../shared/connect-script-protocol';
import { I18nProvider } from '../i18n/I18n';
import { disconnectLocalConnectBridge } from '../utils/localConnectBridge';
import {
  DesktopConnectPanel,
  resolveAgentConnectionState,
  type DesktopConnectPanelProps,
} from './DesktopConnectPanel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    node => (node.getAttribute('aria-label') || node.textContent?.trim()) === label,
  );
}

function createDesktopBridgeMock(options: {
  detectResult: () => AtomDetectResult;
  onExec?: (params?: Record<string, unknown>) => HostInvokeResult<unknown>;
}): { bridge: UniversalHostBridge; invokeMock: ReturnType<typeof vi.fn> } {
  const invokeMock = vi.fn(
    async <T = unknown>(
      capability: string,
      _method: string,
      params?: Record<string, unknown>,
    ): Promise<HostInvokeResult<T>> => {
      if (capability === HOST_CAPABILITIES.ATOM_DETECT) {
        return hostOk(options.detectResult()) as HostInvokeResult<T>;
      }
      if (capability === HOST_CAPABILITIES.ATOM_EXEC) {
        if (options.onExec) {
          return options.onExec(params) as HostInvokeResult<T>;
        }
        return hostOk({
          templateId: String(params?.templateId ?? ''),
          program: String(params?.templateId ?? '').startsWith('claude') ? 'claude' : 'codex',
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          durationMs: 12,
        }) as HostInvokeResult<T>;
      }
      return hostErr('UNSUPPORTED', 'Unsupported');
    },
  );

  const bridge: UniversalHostBridge = {
    info: vi.fn(async () => ({
      hostKind: 'desktop' as const,
      shellVersion: '1.0.0',
      contractVersion: '1.0.0',
      platform: 'darwin' as const,
      arch: 'arm64',
      releaseChannel: 'stable' as const,
      isPackaged: true,
    })),
    capabilities: vi.fn(async () => [
      { name: HOST_CAPABILITIES.ATOM_DETECT, version: '1.0.0', status: 'available' as const, methods: ['run'] },
      { name: HOST_CAPABILITIES.ATOM_EXEC, version: '1.0.0', status: 'available' as const, methods: ['run'] },
    ]),
    invoke: invokeMock as UniversalHostBridge['invoke'],
    subscribe: () => () => {},
  };

  return { bridge, invokeMock };
}

async function mount(props: DesktopConnectPanelProps = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <I18nProvider initialLocale="en">
        <DesktopConnectPanel {...props} />
      </I18nProvider>,
    ),
  );
  await flushMicrotasks();
}

async function rerender(props: DesktopConnectPanelProps) {
  await act(async () =>
    root!.render(
      <I18nProvider initialLocale="en">
        <DesktopConnectPanel {...props} />
      </I18nProvider>,
    ),
  );
  await flushMicrotasks();
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  delete window.__OPENMOTION_HOST__;
  disconnectLocalConnectBridge();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveAgentConnectionState', () => {
  it('strictly distinguishes Config written from Authorized & ready', () => {
    expect(resolveAgentConnectionState(undefined, {})).toBe('not-installed');
    expect(
      resolveAgentConnectionState(
        { agentId: 'codex', installed: true, mcpConfigured: false },
        {},
      ),
    ).toBe('not-configured');
    expect(
      resolveAgentConnectionState(
        { agentId: 'codex', installed: true, mcpConfigured: true },
        { hasAuthorizedConnection: false },
      ),
    ).toBe('configured');
    expect(
      resolveAgentConnectionState(
        { agentId: 'codex', installed: true, mcpConfigured: true },
        { hasAuthorizedConnection: true },
      ),
    ).toBe('authorized');
    expect(
      resolveAgentConnectionState(
        { agentId: 'codex', installed: true, mcpConfigured: true, mcpConflict: true },
        { hasAuthorizedConnection: true },
      ),
    ).toBe('conflict');
  });
});

describe('DesktopConnectPanel', () => {
  it('detects Codex & Claude Code, writes MCP config as Config written, and only shows Authorized & ready with external evidence', async () => {
    let codexConfigured = false;
    const { bridge, invokeMock } = createDesktopBridgeMock({
      detectResult: () => ({
        platform: 'darwin',
        arch: 'arm64',
        agents: [
          {
            agentId: 'codex',
            installed: true,
            version: 'v0.25.0',
            mcpConfigured: codexConfigured,
          },
          {
            agentId: 'claude',
            installed: false,
            mcpConfigured: false,
          },
        ],
        engine: { installed: false, running: false, port: 0, providerKind: 'none' },
        detectedAt: '2026-01-01T00:00:00Z',
      }),
      onExec: () => {
        codexConfigured = true;
        return hostOk({
          templateId: 'codex.mcp.add_remote',
          program: 'codex',
          exitCode: 0,
          stdout: 'added',
          stderr: '',
          durationMs: 25,
        });
      },
    });
    window.__OPENMOTION_HOST__ = bridge;

    const onConfigured = vi.fn();
    await mount({
      mcpUrl: 'https://motion.open-design.ai/mcp',
      hasAuthorizedConnection: false,
      onConfigured,
    });

    const codexRow = document.querySelector('[data-agent-id="codex"]')!;
    const claudeRow = document.querySelector('[data-agent-id="claude"]')!;
    expect(codexRow.getAttribute('data-connection-state')).toBe('not-configured');
    expect(codexRow.textContent).toContain('v0.25.0');
    expect(claudeRow.getAttribute('data-connection-state')).toBe('not-installed');
    expect(document.body.textContent?.toLowerCase()).not.toContain('murmur');

    const connectCodex = findButton('Connect Codex')!;
    expect(connectCodex).toBeDefined();
    await act(async () => connectCodex.click());
    await flushMicrotasks();

    expect(invokeMock).toHaveBeenCalledWith(HOST_CAPABILITIES.ATOM_EXEC, 'run', {
      featureId: 'mcp_connect',
      templateId: 'codex.mcp.add_remote',
      args: {
        serverName: 'openmotion',
        mcpUrl: 'https://motion.open-design.ai/mcp',
      },
      conflictPolicy: 'abort',
    });
    expect(onConfigured).toHaveBeenCalledWith('codex');

    // Must show "Config written" and NOT "Authorized & ready" without external evidence.
    expect(codexRow.getAttribute('data-connection-state')).toBe('configured');
    expect(codexRow.textContent).toContain('Config written');
    expect(codexRow.textContent).not.toContain('Authorized & ready');

    // Once external authorization evidence arrives, badge upgrades to "Authorized & ready".
    await rerender({
      mcpUrl: 'https://motion.open-design.ai/mcp',
      hasAuthorizedConnection: { codex: true },
      onConfigured,
    });
    expect(codexRow.getAttribute('data-connection-state')).toBe('authorized');
    expect(codexRow.textContent).toContain('Authorized & ready');
  });

  it('handles CONFLICT explicitly with non-destructive Keep or Replace choices', async () => {
    const execCalls: Array<Record<string, unknown> | undefined> = [];
    let claudeConfigured = false;

    const { bridge } = createDesktopBridgeMock({
      detectResult: () => ({
        platform: 'darwin',
        arch: 'arm64',
        agents: [
          { agentId: 'codex', installed: false, mcpConfigured: false },
          {
            agentId: 'claude',
            installed: true,
            version: 'v1.4.2',
            mcpConfigured: claudeConfigured,
            mcpUrl: claudeConfigured ? 'https://motion.open-design.ai/mcp' : 'https://old.example/mcp',
          },
        ],
        engine: { installed: false, running: false, port: 0, providerKind: 'none' },
        detectedAt: '2026-01-01T00:00:00Z',
      }),
      onExec: params => {
        execCalls.push(params);
        if (params?.conflictPolicy !== 'replace') {
          return hostErr('CONFLICT', 'openmotion already points to https://old.example/mcp', {
            existingUrl: 'https://old.example/mcp',
          });
        }
        claudeConfigured = true;
        return hostOk({
          templateId: 'claude.mcp.add_remote',
          program: 'claude',
          exitCode: 0,
          stdout: 'replaced',
          stderr: '',
          durationMs: 18,
        });
      },
    });
    window.__OPENMOTION_HOST__ = bridge;

    await mount({ mcpUrl: 'https://motion.open-design.ai/mcp' });

    await act(async () => findButton('Connect Claude Code')!.click());
    await flushMicrotasks();

    const conflictPanel = document.querySelector('[data-conflict-panel="claude"]')!;
    expect(conflictPanel).not.toBeNull();
    expect(conflictPanel.textContent).toContain('https://old.example/mcp');
    expect(conflictPanel.textContent).toContain('https://motion.open-design.ai/mcp');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]?.conflictPolicy).toBe('abort');

    // Keeping current config must NOT mutate or call atom.exec again.
    await act(async () => findButton('Keep current config')!.click());
    await flushMicrotasks();
    expect(document.querySelector('[data-conflict-panel="claude"]')).toBeNull();
    expect(execCalls).toHaveLength(1);

    // Re-trigger conflict, then explicitly approve replacing the URL.
    await act(async () => findButton('Connect Claude Code')!.click());
    await flushMicrotasks();
    expect(document.querySelector('[data-conflict-panel="claude"]')).not.toBeNull();

    await act(async () => findButton('Replace existing URL')!.click());
    await flushMicrotasks();

    expect(execCalls).toHaveLength(3);
    expect(execCalls[2]?.conflictPolicy).toBe('replace');
    expect(document.querySelector('[data-conflict-panel="claude"]')).toBeNull();
    expect(document.querySelector('[data-agent-id="claude"]')?.getAttribute('data-connection-state')).toBe(
      'configured',
    );
  });

  it('shows Connect Script pairing and copyable CLI commands in regular browser, then switches to one-click UI on pair', async () => {
    const copySpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(CONNECT_SCRIPT_ENDPOINTS.HEALTH)) {
        return Response.json({
          ok: true,
          protocolVersion: '1.0.0',
          hostKind: 'connect-script',
          requiresToken: true,
        });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get(CONNECT_SCRIPT_TOKEN_HEADER)).toBe('pair-token-xyz');
      if (url.endsWith(CONNECT_SCRIPT_ENDPOINTS.INFO)) {
        return Response.json({
          hostKind: 'connect-script',
          shellVersion: '1.0.0',
          contractVersion: '1.0.0',
          platform: 'darwin',
          arch: 'arm64',
          releaseChannel: 'stable',
          isPackaged: false,
        });
      }
      if (url.endsWith(CONNECT_SCRIPT_ENDPOINTS.CAPABILITIES)) {
        return Response.json([
          { name: HOST_CAPABILITIES.ATOM_DETECT, version: '1.0.0', status: 'available', methods: ['run'] },
          { name: HOST_CAPABILITIES.ATOM_EXEC, version: '1.0.0', status: 'available', methods: ['run'] },
        ]);
      }
      if (url.endsWith(CONNECT_SCRIPT_ENDPOINTS.INVOKE)) {
        return Response.json(
          hostOk({
            platform: 'darwin',
            arch: 'arm64',
            agents: [
              { agentId: 'codex', installed: true, version: 'v0.30.0', mcpConfigured: false },
              { agentId: 'claude', installed: true, version: 'v1.5.0', mcpConfigured: false },
            ],
            engine: { installed: false, running: false, port: 0, providerKind: 'none' },
            detectedAt: '2026-01-01T00:00:00Z',
          }),
        );
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await mount({ mcpUrl: 'https://motion.open-design.ai/mcp' });

    // Browser mode renders Connect Script pairing form and copyable CLI commands.
    expect(document.querySelector('[data-connect-script-form]')).not.toBeNull();
    const codexFallback = document.querySelector('[data-fallback-command="codex"]')!;
    expect(codexFallback.textContent).toContain(
      'codex mcp add openmotion --url https://motion.open-design.ai/mcp',
    );
    expect(document.body.textContent?.toLowerCase()).not.toContain('murmur');

    // Copying CLI fallback uses clipboard + floating toast.
    await act(async () => codexFallback.querySelector('button')!.click());
    expect(copySpy).toHaveBeenCalledWith(
      'codex mcp add openmotion --url https://motion.open-design.ai/mcp',
    );
    expect(document.querySelector('.motion-feedback-layer [role=status]')?.textContent).toContain(
      'Copied to clipboard',
    );

    // Pair local helper using port + token.
    const tokenField = document.querySelector<HTMLInputElement>('input[aria-label="Pairing token"]')!;
    await act(async () => setInputValue(tokenField, 'pair-token-xyz'));
    await act(async () => findButton('Pair local helper')!.click());
    await flushMicrotasks();

    // Seamlessly transitions to the exact same local Agent detection & one-click UI.
    expect(document.querySelector('[data-desktop-connect-panel]')?.getAttribute('data-host-kind')).toBe(
      'connect-script',
    );
    expect(document.querySelector('[data-agent-id="codex"]')?.textContent).toContain('v0.30.0');
    expect(findButton('Connect Codex')).toBeDefined();
    expect(findButton('Connect Claude Code')).toBeDefined();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    // Disconnecting returns cleanly to browser fallback mode.
    await act(async () => findButton('Disconnect')!.click());
    await flushMicrotasks();
    expect(document.querySelector('[data-connect-script-form]')).not.toBeNull();
  });
});
