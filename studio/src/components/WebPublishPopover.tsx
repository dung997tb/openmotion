import { useCallback, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import type {
  WebPublicationRecord,
  WebPublishMode,
  WebPublishStatusResponse,
  WebPublishTargetKind,
} from '../../../shared/web-publish';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { WebPublishApiError, webPublishClient } from './webPublishClient';

export interface WebPublishPopoverProps {
  targetKind: WebPublishTargetKind;
  targetId: string;
  filePath?: string;
  sourcePath?: string;
  title?: string;
  disabled?: boolean;
  triggerLabel?: string;
  onNotify: (message: string, variant: 'info' | 'error') => void;
  onCopyUrl: (url: string) => void | Promise<void>;
  onOpenAccount?: () => void;
}

function mergePublicationStatus(
  prev: WebPublishStatusResponse | null,
  targetKind: WebPublishTargetKind,
  targetId: string,
  publication: WebPublicationRecord,
): WebPublishStatusResponse {
  const previousList = prev?.publications ?? [];
  const nextList = [publication, ...previousList.filter(item => item.filePath !== publication.filePath)];
  return {
    targetKind: prev?.targetKind ?? targetKind,
    targetId: prev?.targetId ?? targetId,
    projectId: prev?.projectId ?? targetId,
    accountSignedIn: true,
    publications: nextList,
    deployments: nextList,
    active: publication,
  };
}

/**
 * Shared header/toolbar popover for publishing any HTML-expressed OpenMotion artifact
 * (Design page, playable Game, Motion HTML bundle, or static HTML page) to Open Design Cloud
 * and managing its live share URL (update, resume, stop sharing).
 * Status is fetched lazily when opened so mounts stay light.
 */
export function WebPublishPopover({
  targetKind,
  targetId,
  filePath,
  sourcePath,
  title,
  disabled,
  triggerLabel,
  onNotify,
  onCopyUrl,
  onOpenAccount,
}: WebPublishPopoverProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<WebPublishMode | 'unpublish' | null>(null);
  const [status, setStatus] = useState<WebPublishStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(
    async (refreshRemote = true) => {
      setLoading(true);
      setError(null);
      try {
        const next = await webPublishClient.getStatus(targetKind, targetId, {
          filePath,
          sourcePath,
          refresh: refreshRemote,
        });
        setStatus(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [filePath, sourcePath, targetId, targetKind],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        void refreshStatus(true);
      }
    },
    [refreshStatus],
  );

  const handlePublish = useCallback(
    async (mode: WebPublishMode = 'publish') => {
      setBusyAction(mode);
      setError(null);
      const wasPublished = status?.active?.status === 'published';
      try {
        const result = await webPublishClient.publish(targetKind, targetId, {
          filePath,
          sourcePath,
          deployMode: mode,
          name: title,
        });
        setStatus(prev => mergePublicationStatus(prev, targetKind, targetId, result.publication));
        const notice =
          mode === 'resume'
            ? t('Resumed existing link')
            : (wasPublished && mode === 'publish') || result.updated
              ? t('Live page updated')
              : t('Live page published');
        onNotify(notice, 'info');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        onNotify(msg, 'error');
        if (err instanceof WebPublishApiError && (err.status === 401 || err.status === 409)) {
          void refreshStatus(false);
        }
      } finally {
        setBusyAction(null);
      }
    },
    [filePath, onNotify, refreshStatus, sourcePath, status?.active?.status, t, targetId, targetKind, title],
  );

  const handleUnpublish = useCallback(async () => {
    setBusyAction('unpublish');
    setError(null);
    try {
      const result = await webPublishClient.unpublish(targetKind, targetId, {
        filePath,
        sourcePath,
      });
      setStatus(prev => mergePublicationStatus(prev, targetKind, targetId, result.publication));
      onNotify(t('Live page stopped'), 'info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      onNotify(msg, 'error');
    } finally {
      setBusyAction(null);
    }
  }, [filePath, onNotify, sourcePath, t, targetId, targetKind]);

  const openAccountSettings = useCallback(() => {
    setOpen(false);
    if (onOpenAccount) {
      onOpenAccount();
      return;
    }
    window.location.assign('/settings/account');
  }, [onOpenAccount]);

  const pub = status?.active ?? null;
  const isPublished = pub?.status === 'published' && Boolean(pub.url);
  const isStopped = pub?.status === 'stopped';
  const busy = busyAction !== null;

  return (
    <Popover.Root modal={false} open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <Button
            type="button"
            size="sm"
            variant={isPublished ? 'secondary' : 'ghost'}
            disabled={disabled}
            loading={busy}
            icon={<RemixIcon name="global-line" size={14} />}
          >
            {triggerLabel ?? t('Share live')}
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="om-web-publish-positioner">
          <Popover.Popup className="om-web-publish-popover">
            <div className="om-web-publish-header">
              <div className="om-web-publish-title-row">
                <strong>{t('Live share link')}</strong>
                {isPublished && (
                  <span className="om-web-publish-status" data-state="published">
                    {t('Published')}
                    {pub?.version ? ` · v${pub.version}` : ''}
                  </span>
                )}
                {isStopped && (
                  <span className="om-web-publish-status" data-state="stopped">
                    {t('Stopped')}
                  </span>
                )}
              </div>
              <IconButton
                aria-label={t('Refresh status')}
                disabled={loading || busy}
                icon={<RemixIcon name="refresh-line" size={14} className={loading ? 'om-busy-icon' : undefined} />}
                onClick={() => void refreshStatus(true)}
              />
            </div>

            {pub && (pub.workspaceName || pub.slug) && (
              <div className="om-web-publish-meta">
                <span>{pub.workspaceName ?? pub.filePath}</span>
                {pub.slug && <span>{pub.slug}</span>}
              </div>
            )}

            {status && !status.accountSignedIn ? (
              <>
                <span className="om-web-publish-muted">
                  {t('OpenDesign sign-in is required before publishing a live web link.')}
                </span>
                <div className="om-web-publish-actions">
                  <Button type="button" size="sm" variant="primary" onClick={openAccountSettings}>
                    {t('Open account settings')}
                  </Button>
                </div>
              </>
            ) : isPublished && pub?.url ? (
              <>
                <div className="om-web-publish-url">{pub.url}</div>
                <div className="om-web-publish-actions">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    icon={<RemixIcon name="external-link-line" size={14} />}
                    onClick={() => window.open(pub.url!, '_blank', 'noopener,noreferrer')}
                  >
                    {t('Open live page')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    icon={<RemixIcon name="file-copy-line" size={14} />}
                    onClick={() => void onCopyUrl(pub.url!)}
                  >
                    {t('Copy share link')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    loading={busyAction === 'publish'}
                    disabled={busy}
                    icon={<RemixIcon name="upload-2-line" size={14} />}
                    onClick={() => void handlePublish('publish')}
                  >
                    {t('Update live page')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    loading={busyAction === 'unpublish'}
                    disabled={busy}
                    icon={<RemixIcon name="close-line" size={14} />}
                    onClick={() => void handleUnpublish()}
                  >
                    {t('Stop sharing')}
                  </Button>
                </div>
              </>
            ) : isStopped ? (
              <>
                <span className="om-web-publish-muted">
                  {t('An earlier share link for this file was stopped.')}
                </span>
                {pub?.url && <div className="om-web-publish-url">{pub.url}</div>}
                <div className="om-web-publish-actions">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    loading={busyAction === 'resume'}
                    disabled={busy}
                    icon={<RemixIcon name="play-fill" size={13} />}
                    onClick={() => void handlePublish('resume')}
                  >
                    {t('Resume existing link')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    loading={busyAction === 'new_link'}
                    disabled={busy}
                    icon={<RemixIcon name="upload-2-line" size={14} />}
                    onClick={() => void handlePublish('new_link')}
                  >
                    {t('Publish new link')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span className="om-web-publish-muted">
                  {t('Publish a live web link and share it with others.')}
                </span>
                <div className="om-web-publish-actions">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    loading={busy}
                    disabled={loading || busy}
                    icon={<RemixIcon name="upload-2-line" size={14} />}
                    onClick={() => void handlePublish('publish')}
                  >
                    {loading ? t('Refreshing...') : t('Deploy to web')}
                  </Button>
                </div>
              </>
            )}

            {error && <div className="om-web-publish-error">{error}</div>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
