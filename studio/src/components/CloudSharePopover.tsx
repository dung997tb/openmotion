import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloudShareKind, CloudShareSnapshot } from '../../../shared/cloud-share';
import type { AccountSummary } from '../../../shared/provider-directory';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useAccountSummary } from '../motion/AccountSettings';
import { gatewayRequest } from '../motion/gatewayClient';
import { notifyProvidersChanged } from '../motion/useProviderDirectory';
import { Popover } from './ui/Popover';
import {
  getCloudShareStatus,
  publishCloudShare,
  resumeCloudShare,
  stopCloudShare,
} from './cloudShareClient';
import './cloudSharePopover.css';

type CloudShareOp = 'publish' | 'stop' | 'resume' | null;

export function CloudSharePopover({
  kind,
  projectId,
  revisionKey,
  onNotify,
  side = 'bottom',
  align = 'end',
}: {
  kind: CloudShareKind;
  projectId: string;
  revisionKey?: string;
  onNotify?: (message: string, tone?: 'info' | 'error') => void;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { account, refresh: refreshAccount, setAccount } = useAccountSummary();
  const [share, setShare] = useState<CloudShareSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeOp, setActiveOp] = useState<CloudShareOp>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [prepublishEnabled, setPrepublishEnabled] = useState(true);
  const deployAfterSignInRef = useRef(false);
  const prevAccountStateRef = useRef<AccountSummary['state'] | undefined>(undefined);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOpen(false);
    setShare(null);
    setError(null);
    setPrepublishEnabled(true);
    setCopied(false);
  }, [kind, projectId]);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const refreshShare = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await getCloudShareStatus(kind, projectId);
      setShare(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not check share status'));
    } finally {
      setLoading(false);
    }
  }, [kind, projectId, t]);

  useEffect(() => {
    if (!open) return;
    void refreshAccount();
    void refreshShare();
  }, [open, projectId, revisionKey, refreshAccount, refreshShare]);

  const copyUrl = useCallback(async (url: string, notifyUser = true) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
      if (notifyUser) onNotify?.(t('Share link copied'), 'info');
      return true;
    } catch {
      if (notifyUser) onNotify?.(t('Could not copy share link'), 'error');
      return false;
    }
  }, [onNotify, t]);

  const runMutation = useCallback(async (op: Exclude<CloudShareOp, null>, copyOnSuccess = false) => {
    if (activeOp) return;
    setActiveOp(op);
    setError(null);
    try {
      const next = op === 'publish'
        ? await publishCloudShare(kind, projectId)
        : op === 'stop'
          ? await stopCloudShare(kind, projectId)
          : await resumeCloudShare(kind, projectId);
      setShare(next);
      if (op === 'publish' && next.url) {
        if (copyOnSuccess) {
          await copyUrl(next.url, false);
          onNotify?.(t('Deployed and copied share link'), 'info');
        } else {
          onNotify?.(t('Cloud preview link updated'), 'info');
        }
      } else if (op === 'stop') {
        onNotify?.(t('Share link disabled'), 'info');
      } else if (op === 'resume') {
        onNotify?.(t('Share link reopened'), 'info');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('Cloud share operation failed');
      setError(msg);
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ACCOUNT_REAUTH_REQUIRED') {
        void refreshAccount();
      }
    } finally {
      setActiveOp(null);
    }
  }, [activeOp, copyUrl, kind, onNotify, projectId, refreshAccount, t]);

  // Automatically continue deploying as soon as an in-popover OpenDesign sign-in finishes.
  useEffect(() => {
    const nextState = account?.state;
    const prevState = prevAccountStateRef.current;
    prevAccountStateRef.current = nextState;
    if (nextState === 'signed-in' && prevState && prevState !== 'signed-in') {
      notifyProvidersChanged();
      window.dispatchEvent(new Event('motion:account-changed'));
      if (deployAfterSignInRef.current) {
        deployAfterSignInRef.current = false;
        void runMutation('publish', true);
      } else if (open) {
        void refreshShare();
      }
    }
  }, [account?.state, open, refreshShare, runMutation]);

  const handleAccountAction = async (action: 'login' | 'cancel') => {
    setAuthBusy(true);
    setError(null);
    if (action === 'login') deployAfterSignInRef.current = true;
    else deployAfterSignInRef.current = false;
    try {
      const next = await gatewayRequest<AccountSummary>(`settings/account/${action}`, 'POST', {});
      setAccount(next);
      notifyProvidersChanged();
      window.dispatchEvent(new Event('motion:account-changed'));
      if (action === 'login' && next.state === 'signed-in') {
        deployAfterSignInRef.current = false;
        void runMutation('publish', true);
      }
    } catch (err) {
      deployAfterSignInRef.current = false;
      setError(err instanceof Error ? err.message : t('Could not connect OpenDesign account'));
    } finally {
      setAuthBusy(false);
    }
  };

  const accountState = account?.state ?? share?.accountState ?? 'signed-out';
  const signedIn = accountState === 'signed-in';
  const authorizing = accountState === 'authorizing';
  const mutating = activeOp !== null;
  const linkStatus = share?.status ?? 'none';
  const linkAccessOn = linkStatus === 'active' || (linkStatus === 'none' && prepublishEnabled);

  const handleToggleLinkAccess = () => {
    if (!signedIn || mutating) return;
    if (linkStatus === 'active') void runMutation('stop');
    else if (linkStatus === 'stopped') void runMutation('resume');
    else setPrepublishEnabled(v => !v);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side={side}
      align={align}
      aria-label={t('Cloud share')}
      className="om-cloud-share-popover"
      trigger={
        <Button
          variant="ghost"
          type="button"
          className="om-button om-cloud-share-trigger h-auto"
          data-primary
          aria-expanded={open}
        >
          <RemixIcon name="share-forward-line" size={14} />
          <span>{t('Share')}</span>
          {linkStatus === 'active' && <span className="om-cloud-share-dot" aria-hidden="true" />}
        </Button>
      }
    >
      <div className="om-cloud-share-head">
        <div className="om-cloud-share-head-title">
          <strong>{t('Share')}</strong>
          <span className="om-cloud-share-tag">
            <RemixIcon name="cloud-line" size={12} />
            <span>{t('Cloud deploy')}</span>
          </span>
        </div>
        <IconButton
          variant="plain"
          aria-label={t('Close')}
          onClick={() => setOpen(false)}
          icon={<RemixIcon name="close-line" size={15} />}
        />
      </div>

      {signedIn ? (
        <>
          {linkStatus === 'stopped' && (
            <p className="om-cloud-share-banner" role="status">
              {t('The link is disabled. Turn Link access back on to reopen this preview.')}
            </p>
          )}

          <div className="om-cloud-share-row">
            <div className="om-cloud-share-row-text">
              <strong>{t('Link access')}</strong>
              <span>{t('Recipients can view and play this live preview — not your conversation or code.')}</span>
            </div>
            <Button
              variant="plain"
              type="button"
              role="switch"
              aria-checked={linkAccessOn}
              aria-label={t('Link access')}
              disabled={mutating || (loading && !share)}
              className="om-cloud-share-switch"
              onClick={handleToggleLinkAccess}
            >
              <span className="om-cloud-share-switch-thumb" aria-hidden="true" />
            </Button>
          </div>

          {linkStatus === 'active' && share?.url && (
            <div className="om-cloud-share-url-row">
              <RemixIcon name="link" size={13} />
              <span className="om-cloud-share-url-text" title={share.url}>{share.url}</span>
              <a
                className="om-cloud-share-url-open"
                href={share.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('Open in new window')}
              >
                <RemixIcon name="external-link-line" size={13} />
              </a>
            </div>
          )}

          {error && (
            <div className="om-cloud-share-error" role="alert">
              <RemixIcon name="error-warning-line" size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="om-cloud-share-actions">
            {linkStatus === 'active' && share?.url ? (
              <>
                <Button
                  variant="ghost"
                  type="button"
                  className="om-button om-cloud-share-full h-auto"
                  data-primary
                  disabled={mutating}
                  onClick={() => void copyUrl(share.url!)}
                >
                  <RemixIcon name={copied ? 'check-line' : 'link'} size={15} />
                  <span>{t(copied ? 'Share link copied' : 'Copy share link')}</span>
                </Button>
                {share.freshness === 'outdated' && (
                  <Button
                    variant="ghost"
                    type="button"
                    className="om-button om-cloud-share-full h-auto"
                    disabled={mutating}
                    onClick={() => void runMutation('publish')}
                  >
                    <RemixIcon
                      name={activeOp === 'publish' ? 'loader-4-line' : 'refresh-line'}
                      size={15}
                      className={activeOp === 'publish' ? 'om-cloud-share-spin' : undefined}
                    />
                    <span>{t(activeOp === 'publish' ? 'Deploying update…' : 'Update live link')}</span>
                  </Button>
                )}
              </>
            ) : linkStatus === 'stopped' ? (
              <Button
                variant="ghost"
                type="button"
                className="om-button om-cloud-share-full h-auto"
                data-primary
                disabled={mutating}
                onClick={() => void runMutation('resume')}
              >
                <RemixIcon
                  name={activeOp === 'resume' ? 'loader-4-line' : 'refresh-line'}
                  size={15}
                  className={activeOp === 'resume' ? 'om-cloud-share-spin' : undefined}
                />
                <span>{t(activeOp === 'resume' ? 'Reopening link…' : 'Reopen share link')}</span>
              </Button>
            ) : (
              <Button
                variant="ghost"
                type="button"
                className="om-button om-cloud-share-full h-auto"
                data-primary
                disabled={mutating || loading || !prepublishEnabled}
                onClick={() => void runMutation('publish', true)}
              >
                <RemixIcon
                  name={activeOp === 'publish' ? 'loader-4-line' : 'upload-line'}
                  size={15}
                  className={activeOp === 'publish' ? 'om-cloud-share-spin' : undefined}
                />
                <span>{t(activeOp === 'publish' ? 'Deploying to OpenDesign Cloud…' : 'Deploy & copy link')}</span>
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="om-cloud-share-row-text">
            <strong>{t('Link access')}</strong>
            <span>
              {t('Sign in with your OpenDesign account to deploy this interactive preview and generate a shareable cloud link.')}
            </span>
          </div>

          {linkStatus === 'active' && share?.url && (
            <>
              <div className="om-cloud-share-url-row">
                <RemixIcon name="link" size={13} />
                <span className="om-cloud-share-url-text" title={share.url}>{share.url}</span>
                <a
                  className="om-cloud-share-url-open"
                  href={share.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('Open in new window')}
                >
                  <RemixIcon name="external-link-line" size={13} />
                </a>
              </div>
              <Button
                variant="ghost"
                type="button"
                className="om-button om-cloud-share-full h-auto"
                onClick={() => void copyUrl(share.url!)}
              >
                <RemixIcon name={copied ? 'check-line' : 'link'} size={15} />
                <span>{t(copied ? 'Share link copied' : 'Copy share link')}</span>
              </Button>
            </>
          )}

          {authorizing && (
            <div className="om-cloud-share-auth-box" role="status">
              <div className="om-cloud-share-auth-row">
                <RemixIcon name="loader-4-line" size={14} className="om-cloud-share-spin" />
                <span>{t('Complete OpenDesign sign-in in your browser…')}</span>
              </div>
              {account?.userCode && (
                <code className="om-cloud-share-auth-code">{account.userCode}</code>
              )}
              {account?.authorizationUrl && (
                <a
                  className="om-cloud-share-auth-link"
                  href={account.authorizationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{t('Open sign-in page')}</span>
                  <RemixIcon name="external-link-line" size={13} />
                </a>
              )}
            </div>
          )}

          {error && (
            <div className="om-cloud-share-error" role="alert">
              <RemixIcon name="error-warning-line" size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="om-cloud-share-actions">
            {authorizing ? (
              <Button
                variant="ghost"
                type="button"
                className="om-button om-cloud-share-full h-auto"
                disabled={authBusy}
                onClick={() => void handleAccountAction('cancel')}
              >
                <span>{t('Cancel sign-in')}</span>
              </Button>
            ) : (
              <Button
                variant="ghost"
                type="button"
                className="om-button om-cloud-share-full h-auto"
                data-primary={!(linkStatus === 'active' && share?.url) || undefined}
                disabled={authBusy}
                onClick={() => void handleAccountAction('login')}
              >
                <span className="om-opendesign-mark" aria-hidden="true" />
                <span>
                  {t(accountState === 'reauth-required' ? 'Sign in again with OpenDesign' : 'Sign in with OpenDesign')}
                </span>
              </Button>
            )}
          </div>
        </>
      )}

      {share && (
        <div className="om-cloud-share-meta">
          <span>
            {share.workspaceName || account?.user?.email || account?.user?.name || t('OpenDesign Cloud')}
          </span>
          <span>
            {t('{count} files', { count: share.fileCount })}
            {share.bundledAssetCount > 0 ? ` · +${share.bundledAssetCount}` : ''}
          </span>
        </div>
      )}
    </Popover>
  );
}
