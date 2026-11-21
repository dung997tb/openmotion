// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { ProjectAgentGrantsDialog } from './ProjectAgentGrantsDialog';
import { motionApi } from './useWorkspace';

vi.mock('./useWorkspace', () => ({ motionApi: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('ProjectAgentGrantsDialog (C01 / C02)', () => {
  it('grants a connected agent access to the project and revokes it cleanly', async () => {
    const conn = {
      clientId: 'om_client_codex_1',
      clientName: 'Codex CLI',
      redirectHost: 'Local application (127.0.0.1)',
      firstAuthorizedAt: '2026-11-20T10:00:00.000Z',
      lastUsedAt: '2026-11-20T12:00:00.000Z',
    };
    const grant = {
      id: 'grant-1',
      projectId: 'proj-1',
      clientId: 'om_client_codex_1',
      clientName: 'Codex CLI',
      redirectHost: 'Local application (127.0.0.1)',
      grantedAt: '2026-11-20T12:01:00.000Z',
      lastUsedAt: '2026-11-20T12:00:00.000Z',
    };

    vi.mocked(motionApi)
      .mockResolvedValueOnce({ projectId: 'proj-1', grants: [], availableConnections: [conn] })
      .mockResolvedValueOnce({ grant })
      .mockResolvedValueOnce({ projectId: 'proj-1', grants: [grant], availableConnections: [conn] })
      .mockResolvedValueOnce({ ok: true, revoked: true })
      .mockResolvedValueOnce({ projectId: 'proj-1', grants: [], availableConnections: [conn] });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ProjectAgentGrantsDialog projectId="proj-1" projectTitle="Launch Video" onClose={() => {}} />
        </I18nProvider>,
      );
    });

    expect(document.body.textContent).toContain('Codex CLI');
    const grantBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Grant access')!;
    await act(async () => grantBtn.click());

    expect(motionApi).toHaveBeenCalledWith(
      '/projects/proj-1/grants',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clientId: 'om_client_codex_1' }),
      }),
    );

    const revokeBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Revoke')!;
    await act(async () => revokeBtn.click());

    expect(motionApi).toHaveBeenCalledWith(
      '/projects/proj-1/grants/om_client_codex_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(document.body.textContent).toContain('No external agents are authorized for this project yet.');
  });

  it('offers Connect Agent CTA when no external agents are connected yet', async () => {
    const onClose = vi.fn();
    const onOpenMcpSetup = vi.fn();
    vi.mocked(motionApi).mockResolvedValueOnce({
      projectId: 'proj-1',
      grants: [],
      availableConnections: [],
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ProjectAgentGrantsDialog
            projectId="proj-1"
            projectTitle="Launch Video"
            onClose={onClose}
            onOpenMcpSetup={onOpenMcpSetup}
          />
        </I18nProvider>,
      );
    });

    const connectBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Connect Agent'))!;
    await act(async () => connectBtn.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpenMcpSetup).toHaveBeenCalledOnce();
  });
});
