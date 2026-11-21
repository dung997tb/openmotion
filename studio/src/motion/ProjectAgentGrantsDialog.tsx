import { useCallback, useEffect, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { SettingsDialog, SettingsLoading } from './settingsPrimitives';
import { motionApi } from './useWorkspace';

export interface ProjectGrantRecord {
  readonly id: string;
  readonly projectId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectHost: string;
  readonly grantedAt: string;
  readonly lastUsedAt: string | null;
}

export interface AvailableAgentConnection {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectHost: string;
  readonly firstAuthorizedAt: string;
  readonly lastUsedAt: string | null;
}

interface ProjectGrantsResponse {
  readonly projectId: string;
  readonly grants: ProjectGrantRecord[];
  readonly availableConnections: AvailableAgentConnection[];
}

export interface ProjectAgentGrantsDialogProps {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly onClose: () => void;
  readonly onOpenMcpSetup?: () => void;
  readonly returnFocus?: HTMLElement | null;
}

/**
 * Project-level agent authorization manager (C01 / C02):
 * Lets the project owner grant this project to a specific connected external agent
 * ("Hand off to Codex / Agent") or immediately revoke its access without affecting
 * the web session or other devices.
 */
export function ProjectAgentGrantsDialog({
  projectId,
  projectTitle,
  onClose,
  onOpenMcpSetup,
  returnFocus,
}: ProjectAgentGrantsDialogProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grants, setGrants] = useState<ProjectGrantRecord[]>([]);
  const [availableConnections, setAvailableConnections] = useState<AvailableAgentConnection[]>([]);
  const [busyClientId, setBusyClientId] = useState<string | null>(null);

  const loadGrants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await motionApi<ProjectGrantsResponse>(`/projects/${encodeURIComponent(projectId)}/grants`);
      setGrants(Array.isArray(data.grants) ? data.grants : []);
      setAvailableConnections(Array.isArray(data.availableConnections) ? data.availableConnections : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load project agent access.'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const grantedClientIds = new Set(grants.map((g) => g.clientId));
  const ungrantedConnections = availableConnections.filter((conn) => !grantedClientIds.has(conn.clientId));

  async function handleGrant(conn: AvailableAgentConnection) {
    setBusyClientId(conn.clientId);
    try {
      await motionApi(`/projects/${encodeURIComponent(projectId)}/grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: conn.clientId }),
      });
      toast.showToast(t('Granted access to {name}', { name: conn.clientName }), 'info', 'feedback');
      await loadGrants();
    } catch (err) {
      toast.showToast(
        err instanceof Error ? err.message : t('Could not grant agent access.'),
        'error',
        'feedback',
      );
    } finally {
      setBusyClientId(null);
    }
  }

  async function handleRevoke(grant: ProjectGrantRecord) {
    setBusyClientId(grant.clientId);
    try {
      await motionApi(
        `/projects/${encodeURIComponent(projectId)}/grants/${encodeURIComponent(grant.clientId)}`,
        { method: 'DELETE' },
      );
      toast.showToast(t('Revoked access for {name}', { name: grant.clientName }), 'info', 'feedback');
      await loadGrants();
    } catch (err) {
      toast.showToast(
        err instanceof Error ? err.message : t('Could not revoke agent access.'),
        'error',
        'feedback',
      );
    } finally {
      setBusyClientId(null);
    }
  }

  return (
    <SettingsDialog
      title={t('Agent access · {title}', { title: projectTitle })}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <div className="om-project-grants" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p className="om-muted">
          {t(
            'Choose which connected external agents (such as Codex or Claude Code) can read and edit this project. Revoking access takes effect immediately without affecting your web session.',
          )}
        </p>

        {loading ? (
          <SettingsLoading />
        ) : error ? (
          <div className="om-card om-card-stack" role="alert">
            <p className="om-muted">{error}</p>
            <div>
              <Button variant="ghost" className="om-button h-auto" onClick={() => void loadGrants()}>
                {t('Retry')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <section className="om-card om-card-stack" aria-label={t('Authorized agents')}>
              <h3 className="om-subtitle">{t('Authorized agents')}</h3>
              {grants.length === 0 ? (
                <p className="om-muted">{t('No external agents are authorized for this project yet.')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {grants.map((grant) => (
                    <div
                      key={grant.clientId}
                      className="om-settings-row"
                      data-testid={`project-grant-${grant.clientId}`}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div>
                          <strong>{grant.clientName}</strong>{' '}
                          <span className="om-badge">{grant.redirectHost}</span>
                        </div>
                        <div className="om-muted" style={{ fontSize: '12px' }}>
                          {t('Granted {date}', { date: new Date(grant.grantedAt).toLocaleString() })}
                          {grant.lastUsedAt
                            ? ` · ${t('Last used {date}', { date: new Date(grant.lastUsedAt).toLocaleString() })}`
                            : ''}
                        </div>
                      </div>
                      <Button
                        variant="danger"
                        disabled={busyClientId !== null}
                        onClick={() => void handleRevoke(grant)}
                      >
                        {busyClientId === grant.clientId ? t('Revoking…') : t('Revoke')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="om-card om-card-stack" aria-label={t('Hand off to connected agent')}>
              <h3 className="om-subtitle">{t('Connected agents available to authorize')}</h3>
              {ungrantedConnections.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p className="om-muted">
                    {availableConnections.length === 0
                      ? t('No external agents are connected to this account yet. Connect Codex or another MCP host first.')
                      : t('All connected agents already have access to this project.')}
                  </p>
                  {availableConnections.length === 0 && onOpenMcpSetup && (
                    <div>
                      <Button
                        variant="ghost"
                        className="om-button h-auto"
                        data-primary
                        onClick={() => {
                          onClose();
                          onOpenMcpSetup();
                        }}
                      >
                        <RemixIcon name="plug-line" size={15} />
                        {t('Connect Agent')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {ungrantedConnections.map((conn) => (
                    <div
                      key={conn.clientId}
                      className="om-settings-row"
                      data-testid={`available-agent-${conn.clientId}`}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div>
                          <strong>{conn.clientName}</strong>{' '}
                          <span className="om-badge">{conn.redirectHost}</span>
                        </div>
                        <div className="om-muted" style={{ fontSize: '12px' }}>
                          {conn.lastUsedAt
                            ? t('Last used {date}', { date: new Date(conn.lastUsedAt).toLocaleString() })
                            : t('Connected {date}', { date: new Date(conn.firstAuthorizedAt).toLocaleString() })}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        className="om-button h-auto"
                        data-primary
                        disabled={busyClientId !== null}
                        onClick={() => void handleGrant(conn)}
                      >
                        {busyClientId === conn.clientId ? t('Granting…') : t('Grant access')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <StudioToastViewport {...toast} />
    </SettingsDialog>
  );
}
