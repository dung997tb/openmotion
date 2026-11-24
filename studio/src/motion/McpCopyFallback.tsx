import { useI18n } from '../i18n/I18n';

export function McpCopyFallback({ instruction }: { instruction: string }) {
  const { t } = useI18n();
  return <textarea className="om-field w-full" aria-label={t('Creation instruction')} readOnly rows={5}
    value={instruction} onFocus={event => event.currentTarget.select()} />;
}
