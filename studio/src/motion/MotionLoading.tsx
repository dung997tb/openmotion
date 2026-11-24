import { OpenDesignLoadingMark } from '../components/ui/OpenDesignLoadingMark';
import { useI18n } from '../i18n/I18n';

/** Matches the desktop client startup animation across project and editor loading boundaries. */
export function MotionLoading({ overlay = false, label }: { overlay?: boolean; label?: string }) {
  const { t } = useI18n();
  return (
    <div className="motion-loading" role="status" data-overlay={overlay || undefined}>
      <OpenDesignLoadingMark height={32} className="motion-loading-mark" />
      <span className="motion-loading-label">{label ?? t('Opening project…')}</span>
    </div>
  );
}
