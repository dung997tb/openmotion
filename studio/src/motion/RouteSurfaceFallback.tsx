import { OpenDesignLoadingMark } from '../components/ui/OpenDesignLoadingMark';
import { useI18n } from '../i18n/I18n';

export function RouteSurfaceFallback({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div
      className={compact ? 'om-route-fallback om-route-fallback-compact' : 'om-route-fallback'}
      role="status"
      aria-label={t('Loading…')}
    >
      <div className="om-route-fallback-inner">
        <OpenDesignLoadingMark height={compact ? 24 : 32} />
      </div>
    </div>
  );
}
