import { Button } from 'open-design-ui/button';
import { isAudioKind } from '../../../shared/audio-kind';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { isClientCacheEnabled } from '../utils/clientCacheMode';
import { getFreshCachedAssetList, runCachedAssetList, type AssetListResult } from './assetCache';
import { assetRequest } from './assetClient';
import { SOUND_TABS, type SoundTabId } from './soundTabs';

export function SoundSceneTabs({
  activeTab,
  onSelectTab,
}: {
  activeTab: SoundTabId;
  onSelectTab: (tabId: SoundTabId) => void;
}) {
  const { t } = useI18n();
  const liveTabs = SOUND_TABS.filter(tab => tab.status === 'live');
  const soonTabs = SOUND_TABS.filter(tab => tab.status === 'soon');

  const renderTab = (tab: (typeof SOUND_TABS)[number]) => {
    const active = tab.id === activeTab;
    const prefetchAudioKind = tab.status === 'live' && isAudioKind(tab.id) ? tab.id : null;
    const prefetchTab = prefetchAudioKind
      ? () => {
          if (!isClientCacheEnabled()) return;
          const args = {
            modality: 'audio' as const,
            audioKind: prefetchAudioKind,
            sort: 'newest',
            offset: 0,
            limit: 40,
          };
          if (getFreshCachedAssetList(args)) return;
          void runCachedAssetList(
            args,
            normalized => assetRequest<AssetListResult>({ action: 'list', ...normalized }),
          ).catch(() => {});
        }
      : undefined;
    return (
      <Button
        key={tab.id}
        type="button"
        variant="plain"
        className="om-nav-item om-sound-tab"
        data-sound-tab={tab.id}
        data-status={tab.status}
        aria-current={active ? 'page' : undefined}
        onPointerEnter={prefetchTab}
        onFocus={prefetchTab}
        onClick={() => {
          if (!active) onSelectTab(tab.id);
        }}
      >
        <RemixIcon name={tab.icon} size={14} className="om-sound-tab-icon" />
        <span>{t(tab.label)}</span>
      </Button>
    );
  };

  return (
    <div className="om-sound-tabs-strip">
      <div className="om-sound-tabs-group" data-group="live">
        {liveTabs.map(renderTab)}
      </div>
      {soonTabs.length > 0 && (
        <>
          <span className="om-sound-tabs-divider" aria-hidden="true" />
          <div className="om-sound-tabs-group" data-group="soon">
            {soonTabs.map(renderTab)}
            <span className="om-sound-soon-tag">{t('Soon')}</span>
          </div>
        </>
      )}
    </div>
  );
}
