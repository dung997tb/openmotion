import { Button } from 'open-design-ui/button';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MotionIcon } from './icons';
import { GitHubLink } from './GitHubLink';
import { useI18n } from '../i18n/I18n';
import { Skeleton } from '../components/ui/Skeleton';
import { RemixIcon } from '../icons/RemixIcons';
import { ModelAvatar } from './settingsPrimitives';
import { useMediaCatalog } from './useMediaCatalog';
import { useAccountSummary } from './AccountSettings';
import { mediaLabels, sceneDestination, type StudioDestination } from './creativeStudios';
import { isOpenDesignProvider } from './imageMenuModels';
import type { AssetDraft } from './AssetComposer';
import { findModelHub, type HubShowcaseCase } from './modelHubs';
import { HubVideoWall } from './HubVideoWall';
import { reportHubClick, reportHubPageView } from './exploreTracking';
import { campaignPricingUrl, newCampaignEntryId, useBlackFridayActive } from './campaignAttribution';
import { BackToExploreButton } from './BackToExploreButton';

function useMasonryColumns() {
  const compute = () => (window.innerWidth >= 1180 ? 4 : window.innerWidth >= 820 ? 3 : window.innerWidth >= 520 ? 2 : 1);
  const [count, setCount] = useState(compute);
  useEffect(() => {
    const onResize = () => setCount(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return count;
}

function packMasonryColumns(items: HubShowcaseCase[], columnCount: number): HubShowcaseCase[][] {
  const columns: HubShowcaseCase[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array<number>(columnCount).fill(0);
  for (const item of items) {
    const target = heights.indexOf(Math.min(...heights));
    columns[target].push(item);
    heights[target] += 1 / Math.max(0.5, item.aspectRatio || 16 / 9) + 0.06;
  }
  return columns;
}

function aspectRatioLabel(ratio: number): string {
  if (ratio <= 0.62) return '9:16';
  if (ratio <= 0.85) return '3:4';
  if (ratio <= 1.12) return '1:1';
  if (ratio <= 1.29) return '5:4';
  if (ratio <= 1.42) return '4:3';
  if (ratio <= 1.6) return '3:2';
  return '16:9';
}

/** Aggregates one model family: what it is, what to make with it, and whether this installation can use it. */
export function ModelHub({ id, onExplore, onProvider, onModel, onUse, onScene, onSettings, onStartScenario, hasProject = false }: {
  id: string; hasProject?: boolean; onExplore: () => void; onProvider: (provider: string) => void; onModel: (id: string) => void;
  onUse: () => void; onScene?: (destination: StudioDestination, seed?: string | AssetDraft) => void; onSettings: (section: 'account' | 'subscription') => void; onStartScenario?: () => void;
}) {
  const { t, locale } = useI18n();
  const zh = locale.startsWith('zh');
  const bfActive = useBlackFridayActive();
  const [entryId, setEntryId] = useState(newCampaignEntryId);
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [lightboxPrompt, setLightboxPrompt] = useState('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const masonryCount = useMasonryColumns();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabIndicator, setTabIndicator] = useState<{ left: number; width: number; ready: boolean }>({ left: 0, width: 0, ready: false });
  const search = useRef<HTMLInputElement>(null);
  const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  const hub = findModelHub(id);
  const { catalog, failed, retry } = useMediaCatalog(Boolean(hub));
  const account = useAccountSummary();
  const signedIn = account.account?.state === 'signed-in';
  // One view per visit, once the sign-in state is known (or could not be read).
  const viewed = useRef(false);
  const accountKnown = account.account !== null || account.error;
  useEffect(() => {
    setSelectedTag('all');
    setActiveCaseId(null);
  }, [id]);
  useEffect(() => {
    if (!activeCaseId || !hub?.cases) return;
    const found = hub.cases.find(item => item.id === activeCaseId);
    if (found) {
      setLightboxPrompt(zh ? found.promptZh : found.prompt);
      setCopiedPrompt(false);
    }
  }, [activeCaseId, hub, zh]);
  useEffect(() => {
    if (!activeCaseId || !hub?.cases) return;
    const pool = hub.cases.filter(item => selectedTag === 'all' || item.tag === selectedTag);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setActiveCaseId(null);
        return;
      }
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const idx = pool.findIndex(item => item.id === activeCaseId);
        if (idx === -1 || pool.length <= 1) return;
        event.preventDefault();
        const nextIdx = (idx + (event.key === 'ArrowRight' ? 1 : -1) + pool.length) % pool.length;
        setActiveCaseId(pool[nextIdx].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeCaseId, hub, selectedTag]);
  useLayoutEffect(() => {
    const sync = () => {
      const container = tabsRef.current;
      if (!container) return;
      const active = container.querySelector<HTMLButtonElement>('[data-active="true"]');
      if (!active) return;
      setTabIndicator(prev => ({
        left: active.offsetLeft,
        width: active.offsetWidth,
        ready: prev.width > 0 || prev.ready,
      }));
    };
    sync();
    // Enable smooth glide after initial placement
    const raf = requestAnimationFrame(() => {
      setTabIndicator(prev => (prev.width > 0 ? { ...prev, ready: true } : prev));
    });
    window.addEventListener('resize', sync);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sync);
    };
  }, [selectedTag, id, locale]);
  useEffect(() => {
    if (!hub || viewed.current || !accountKnown) return;
    viewed.current = true;
    reportHubPageView(hub.id, hasProject, signedIn);
  }, [hub, accountKnown, signedIn, hasProject]);
  if (!hub) return <main className="om-explore"><div className="om-discovery-page">
    <div><BackToExploreButton onClick={onExplore} /></div>
    <section><h1 className="om-title">{t('Page unavailable')}</h1><p className="om-muted">{id}</p></section>
  </div></main>;
  const isShowcaseHub = Boolean(hub.cases && hub.cases.length > 0 && hub.videos.length === 0);
  const availableProviders = new Set(
    (catalog?.status.providers ?? [])
      .filter(item => item.available && item.mediaEntitlement !== 'not-included')
      .map(item => item.id),
  );
  const served = (catalog?.models ?? [])
    .filter(model => hub.modelPattern.test(model.id) || hub.modelPattern.test(model.modelId) || hub.modelPattern.test(model.label))
    .sort((a, b) => {
      const aOpen = Number(isOpenDesignProvider(a.provider));
      const bOpen = Number(isOpenDesignProvider(b.provider));
      if (bOpen !== aOpen) return bOpen - aOpen;
      const aAvail = Number(availableProviders.has(a.provider));
      const bAvail = Number(availableProviders.has(b.provider));
      return bAvail - aAvail;
    });
  const companions = catalog?.models.filter(model => !served.includes(model) && (hub.companionPattern.test(model.id) || hub.companionPattern.test(model.modelId))) ?? [];
  const provider = catalog?.status.providers.find(item => item.id === hub.provider);
  const preferredModelId = served[0]?.id;
  const track = (area: Parameters<typeof reportHubClick>[1], element: Parameters<typeof reportHubClick>[2], fields: Parameters<typeof reportHubClick>[3] = {}) =>
    reportHubClick(hub.id, area, element, { signedIn, ...fields });

  const openDestination = (destination: StudioDestination, seed?: string | AssetDraft) => {
    const resolved = preferredModelId
      ? sceneDestination(destination.scene, destination, preferredModelId)
      : destination;
    if (onScene) onScene(resolved, seed);
    else onUse();
  };

  const launchShowcaseRemix = (item: HubShowcaseCase, promptOverride?: string) => {
    const prompt = (promptOverride ?? (zh ? item.promptZh : item.prompt)).trim();
    const aspect = aspectRatioLabel(item.aspectRatio);
    const modality = item.destination.scene.modality;
    const draft: AssetDraft = {
      modality,
      prompt,
      preferredModel: preferredModelId,
      shotPreferences: { aspect, duration: modality === 'video' ? 5 : undefined },
      references: [],
    };
    setActiveCaseId(null);
    track('hub_hero', 'open_in_studio', { model: preferredModelId ?? hub.id });
    openDestination(item.destination, draft);
  };

  const eyebrowText = zh && hub.eyebrowZh ? hub.eyebrowZh : t(hub.eyebrow);
  const summaryText = zh && hub.summaryZh ? hub.summaryZh : t(hub.summary);
  const primaryCtaText = zh && hub.primaryCtaZh ? hub.primaryCtaZh : (hub.primaryCta ? t(hub.primaryCta) : t('Open in {studio}', { studio: t('Motion Studio') }));
  const promoBadgeText = zh && hub.promoBadgeZh ? hub.promoBadgeZh : hub.promoBadge;
  const pricingHref = campaignPricingUrl(locale, 'openmotion_bf_banner', entryId);

  const showcaseTags = Array.from(new Map(
    (hub.cases ?? []).map(item => [item.tag, zh ? item.tagZh : item.tag])
  ).entries());

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCases: HubShowcaseCase[] = (hub.cases ?? []).filter(item => {
    if (isShowcaseHub && selectedTag !== 'all' && item.tag !== selectedTag) return false;
    if (!normalizedQuery) return true;
    return [item.title, item.titleZh, item.tag, item.tagZh, item.prompt, item.promptZh]
      .some(field => field.toLowerCase().includes(normalizedQuery));
  });

  const masonryColumns = packMasonryColumns(filteredCases, Math.min(masonryCount, Math.max(1, filteredCases.length)));

  if (isShowcaseHub) {
    return (
      <main className="om-explore om-model-hub-page om-model-hub-minimal">
        <div className="om-discovery-page om-model-hub om-model-hub-showcase" data-hub={hub.id}>
          <header className="om-hub-editorial-header">
            <div className="om-hub-editorial-main">
              <div className="om-hub-editorial-title-block">
                <div className="om-hub-editorial-heading-row">
                  <h1>{hub.latestModel}</h1>
                  {bfActive && promoBadgeText && (
                    <a
                      className="om-hub-promo-pill"
                      href={pricingHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={event => {
                        event.currentTarget.href = campaignPricingUrl(locale, 'openmotion_bf_banner', entryId);
                        window.setTimeout(() => setEntryId(newCampaignEntryId()), 0);
                      }}
                    >
                      {promoBadgeText}
                    </a>
                  )}
                </div>
                <p>{summaryText}</p>
              </div>

              <div className="om-hub-editorial-controls">
                {showcaseTags.length > 1 && (
                  <div ref={tabsRef} className="om-hub-editorial-tabs" role="tablist" aria-label={zh ? '作品分类' : 'Categories'}>
                    <Button
                      type="button"
                      variant="plain"
                      role="tab"
                      aria-selected={selectedTag === 'all'}
                      className="om-hub-editorial-tab"
                      data-active={selectedTag === 'all' ? 'true' : undefined}
                      onClick={() => setSelectedTag('all')}
                    >
                      {zh ? '全部' : 'All'}
                    </Button>
                    {showcaseTags.map(([tagKey, tagLabel]) => (
                      <Button
                        key={tagKey}
                        type="button"
                        variant="plain"
                        role="tab"
                        aria-selected={selectedTag === tagKey}
                        className="om-hub-editorial-tab"
                        data-active={selectedTag === tagKey ? 'true' : undefined}
                        onClick={() => setSelectedTag(tagKey)}
                      >
                        {tagLabel}
                      </Button>
                    ))}
                    <span
                      className="om-hub-editorial-indicator"
                      aria-hidden="true"
                      data-ready={tabIndicator.ready ? 'true' : undefined}
                      style={{
                        width: `${tabIndicator.width}px`,
                        transform: `translate3d(${tabIndicator.left}px, 0, 0)`,
                        opacity: tabIndicator.width > 0 ? 1 : 0,
                      }}
                    />
                  </div>
                )}

                {hub.primaryDestination && (
                  <>
                    <span className="om-hub-editorial-divider" aria-hidden="true" />
                    <Button
                      type="button"
                      variant="plain"
                      className="om-hub-editorial-cta"
                      onClick={() => {
                        track('hub_hero', 'open_in_studio');
                        openDestination(hub.primaryDestination!);
                      }}
                    >
                      <span>{primaryCtaText}</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          </header>

          <section className="om-hub-showcase" aria-label={hub.latestModel}>
            <div key={`${hub.id}-${selectedTag}`} className="om-hub-masonry">
              {masonryColumns.map((column, colIndex) => (
                <div
                  key={colIndex}
                  className="om-hub-masonry-col"
                  style={{ animationDelay: `${colIndex * 28}ms` }}
                >
                  {column.map(item => {
                    const itemTitle = zh ? item.titleZh : item.title;
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        className="om-hub-showcase-card"
                        aria-label={itemTitle}
                        onClick={() => setActiveCaseId(item.id)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setActiveCaseId(item.id);
                          }
                        }}
                      >
                        <div className="om-hub-showcase-media" style={{ aspectRatio: String(item.aspectRatio) }}>
                          <img src={item.poster} alt={itemTitle} loading="lazy" />
                          <div className="om-hub-showcase-overlay">
                            <strong className="om-hub-showcase-title">{itemTitle}</strong>
                            <Button
                              type="button"
                              variant="plain"
                              className="om-hub-showcase-cta"
                              onClick={event => {
                                event.stopPropagation();
                                launchShowcaseRemix(item);
                              }}
                            >
                              <span>{zh ? '做同款' : 'Remix'}</span>
                              <RemixIcon name="arrow-right-up-line" size={13} />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        </div>

        {activeCaseId && (() => {
          const currentIndex = filteredCases.findIndex(entry => entry.id === activeCaseId);
          const activeCase = currentIndex >= 0 ? filteredCases[currentIndex] : hub.cases?.find(entry => entry.id === activeCaseId);
          if (!activeCase) return null;
          const activeTitle = zh ? activeCase.titleZh : activeCase.title;
          const activeAspect = aspectRatioLabel(activeCase.aspectRatio);
          const isVideoCase = activeCase.destination.scene.modality === 'video';
          const canCycle = filteredCases.length > 1 && currentIndex >= 0;
          const stepCase = (delta: number) => {
            if (!canCycle) return;
            const nextIdx = (currentIndex + delta + filteredCases.length) % filteredCases.length;
            setActiveCaseId(filteredCases[nextIdx].id);
          };
          const handleCopyPrompt = () => {
            const text = lightboxPrompt.trim();
            if (!text) return;
            navigator.clipboard?.writeText(text).then(() => {
              setCopiedPrompt(true);
              window.setTimeout(() => setCopiedPrompt(false), 1800);
            }).catch(() => {});
          };
          return (
            <div
              className="om-hub-lightbox-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label={activeTitle}
              onClick={event => {
                if (event.target === event.currentTarget) setActiveCaseId(null);
              }}
            >
              <div
                className="om-hub-lightbox-shell"
                onClick={event => {
                  if (event.target === event.currentTarget) setActiveCaseId(null);
                }}
              >
                {canCycle && (
                  <Button
                    type="button"
                    variant="plain"
                    className="om-hub-lightbox-nav om-hub-lightbox-prev"
                    aria-label={zh ? '上一个作品' : 'Previous'}
                    onClick={() => stepCase(-1)}
                  >
                    <RemixIcon name="arrow-left-s-line" size={22} />
                  </Button>
                )}

                <div className="om-hub-lightbox">
                  <img
                    className="om-hub-lightbox-aura"
                    src={activeCase.poster}
                    alt=""
                    aria-hidden="true"
                  />
                  <div className="om-hub-lightbox-stage">
                    <div
                      className="om-hub-lightbox-media"
                      data-portrait={activeCase.aspectRatio < 0.9 ? 'true' : undefined}
                      style={{ aspectRatio: String(activeCase.aspectRatio) }}
                    >
                      <img src={activeCase.poster} alt={activeTitle} />
                    </div>
                  </div>

                  <aside className="om-hub-lightbox-panel">
                    <div className="om-hub-lightbox-top">
                      <span className="om-hub-lightbox-index">
                        {currentIndex >= 0
                          ? `${String(currentIndex + 1).padStart(2, '0')} / ${String(filteredCases.length).padStart(2, '0')}`
                          : hub.latestModel}
                      </span>
                      <Button
                        type="button"
                        variant="plain"
                        className="om-hub-lightbox-close"
                        aria-label={zh ? '关闭预览' : 'Close'}
                        onClick={() => setActiveCaseId(null)}
                      >
                        <RemixIcon name="close-line" size={18} />
                      </Button>
                    </div>

                    <div className="om-hub-lightbox-heading">
                      <h2 className="om-hub-lightbox-title">{activeTitle}</h2>
                      <div className="om-hub-lightbox-chips">
                        <span>{hub.latestModel}</span>
                        <span>{activeAspect}</span>
                        {isVideoCase && <span>5s</span>}
                      </div>
                    </div>

                    <div className="om-hub-lightbox-prompt-box">
                      <div className="om-hub-lightbox-prompt-head">
                        <span>{zh ? '提示词' : 'Prompt'}</span>
                        <Button type="button" variant="plain" className="om-hub-lightbox-copy" onClick={handleCopyPrompt}>
                          <RemixIcon name={copiedPrompt ? 'check-line' : 'file-copy-line'} size={13} />
                          <span>{copiedPrompt ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}</span>
                        </Button>
                      </div>
                      <textarea
                        className="om-hub-lightbox-prompt"
                        value={lightboxPrompt}
                        onChange={event => setLightboxPrompt(event.target.value)}
                        rows={5}
                        aria-label={zh ? '同款提示词' : 'Prompt'}
                      />
                    </div>

                    <div className="om-hub-lightbox-actions">
                      <Button
                        type="button"
                        variant="plain"
                        className="om-hub-lightbox-cta"
                        onClick={() => launchShowcaseRemix(activeCase, lightboxPrompt)}
                      >
                        <span>{zh ? '一键做同款' : 'Remix this look'}</span>
                      </Button>
                    </div>
                  </aside>
                </div>

                {canCycle && (
                  <Button
                    type="button"
                    variant="plain"
                    className="om-hub-lightbox-nav om-hub-lightbox-next"
                    aria-label={zh ? '下一个作品' : 'Next'}
                    onClick={() => stepCase(1)}
                  >
                    <RemixIcon name="arrow-right-s-line" size={22} />
                  </Button>
                )}
              </div>
            </div>
          );
        })()}
      </main>
    );
  }

  return <main className="om-explore om-model-hub-page" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.current?.focus(); }
  }}>
    <div className="om-gallery-sticky-header"><header className="om-gallery-header">
      <div className="om-gallery-wordmark"><BackToExploreButton onClick={() => { track('hub_header', 'back_to_explore'); onExplore(); }} /><span className="om-gallery-page-label">{hub.latestModel}</span></div>
      <div className="om-control-row om-gallery-header-actions">
        <label className="om-field om-search-field"><MotionIcon name="search" size={16} /><input ref={search} type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} onFocus={() => track('hub_header', 'search_focus')}
          placeholder={t('Search videos, creators, scenes…')} aria-label={t('Search videos')} /><kbd>{searchShortcut}</kbd></label>
        <GitHubLink className="om-button" />
      </div>
    </header></div>
    <div className="om-discovery-page om-model-hub" data-hub={hub.id}>

    <header className="om-model-hub-hero">
      <img src={hub.poster} alt="" />
      <div className="om-model-hub-hero-copy">
        <span className="om-model-hub-eyebrow"><RemixIcon name="sparkling-line" size={16} />{eyebrowText} · {hub.vendor}</span>
        <h1>{hub.latestModel}</h1>
        <p>{summaryText}</p>
        <div className="om-model-hub-actions">
          {signedIn
            ? <>
              <Button variant="ghost" className="om-button h-auto" data-primary="media" onClick={() => { track('hub_hero', 'open_in_studio'); onUse(); }}>{t('Open in {studio}', { studio: t('Motion Studio') })}<RemixIcon name="arrow-right-line" size={16} /></Button>
              <Button variant="plain" className="om-button om-model-hub-connected" onClick={() => { track('hub_hero', 'manage_connection'); onProvider('account'); }} title={t('Manage connection')}><RemixIcon name="checkbox-circle-fill" size={16} />{t('Connected to {provider}', { provider: 'OpenDesign' })}</Button>
            </>
            : <>
              <Button variant="ghost" className="om-button h-auto" data-primary="media" onClick={() => { track('hub_hero', 'sign_in'); onSettings('account'); }}>{t('Sign in to use {model} now', { model: hub.latestModel })}<RemixIcon name="arrow-right-line" size={16} /></Button>
              {provider?.available
                ? <Button variant="plain" className="om-button om-model-hub-connected" onClick={() => { track('hub_hero', 'manage_connection'); onProvider(hub.provider); }} title={t('Manage connection')}><RemixIcon name="checkbox-circle-fill" size={16} />{t('Connected to {provider}', { provider: provider.label })}</Button>
                : <Button variant="ghost" className="om-button h-auto" onClick={() => { track('hub_hero', 'connect_key'); onProvider(hub.provider); }}><RemixIcon name="plug-line" size={16} />{t('Connect your own API key')}</Button>}
            </>}
          {onStartScenario && (
            <Button variant="ghost" type="button" className="om-button h-auto" onClick={() => { track('hub_hero', 'open_in_studio'); onStartScenario(); }}>
              <RemixIcon name="route-line" size={16} />{t('Start Gemini 4 Neon workflow')}
            </Button>
          )}
        </div>
      </div>
    </header>

    {hub.videos.length > 0 && <HubVideoWall hubId={hub.id} signedIn={accountKnown ? signedIn : undefined} videos={hub.videos} query={query} title={hub.title} />}

    <section aria-live="polite">
      <h2 className="om-subtitle">{t('Availability in OpenMotion')}</h2>
      {failed ? <Button variant="ghost" className="om-button h-auto" onClick={retry}>{t('Retry loading models')}</Button>
        : !catalog ? <Skeleton className="om-featured-template-skeleton" />
        : served.length ? <div className="om-model-hub-models">{served.map((model, index) => <Button variant="plain" key={model.id} className="om-model-hub-model" onClick={() => { track('hub_availability', 'select_model', { model: model.id, position: index }); onModel(model.id); }}>
            <ModelAvatar name={model.label} modelId={model.modelId} provider={{ id: model.provider, custom: model.source === 'custom' }} />
            <span><strong>{model.label}</strong><small>{model.provider} · {model.modelId}</small></span><RemixIcon name="arrow-right-s-line" size={16} />
          </Button>)}</div>
        : <div className="om-model-hub-paths">
            <p className="om-muted">{t('Two ways to use {model}:', { model: hub.modelName })}</p>
            <div className="om-model-hub-path" data-recommended="true">
              <span className="om-model-hub-path-label">{t('Recommended')}</span>
              {/* Signed-in people are never asked to sign in again; they see what their plan needs instead. */}
              <strong><RemixIcon name="account-circle-line" size={16} />{t(signedIn ? 'Use it with your OpenDesign plan' : 'Sign in and subscribe')}</strong>
              <p>{t(signedIn ? '{model} appears here as soon as OpenDesign serves it on your plan. No API key needed.' : 'Sign in to OpenDesign with a paid plan and use {model} right away. No API key needed.', { model: hub.modelName })}</p>
              <Button variant="ghost" className="om-button h-auto" data-primary onClick={() => { track('hub_availability', signedIn ? 'view_plans' : 'sign_in'); onSettings(signedIn ? 'subscription' : 'account'); }}>{t(signedIn ? 'View plans' : 'Sign in')}<RemixIcon name="arrow-right-line" size={16} /></Button>
            </div>
            <div className="om-model-hub-path">
              <strong><RemixIcon name="plug-line" size={16} />{t('Connect your own API key')}</strong>
              <p>{t(provider?.available ? 'Your Gemini API key is connected. {model} appears here once your key has access.' : 'Add a Gemini API key with paid access. Usage is billed by Google.', { model: hub.modelName })}</p>
              <Button variant="ghost" className="om-button h-auto" onClick={() => { track('hub_availability', provider?.available ? 'manage_connection' : 'connect_key'); onProvider(hub.provider); }}><RemixIcon name="plug-line" size={16} />{t(provider?.available ? 'Model providers' : 'Connect {provider}', { provider: provider?.label ?? 'Gemini' })}</Button>
            </div>
          </div>}
    </section>

    {companions.length > 0 && <section>
      <h2 className="om-subtitle">{t('Pair with {vendor} media models', { vendor: 'Google' })}</h2>
      <div className="om-model-hub-models">{companions.map((model, index) => <Button variant="plain" key={model.id} className="om-model-hub-model" onClick={() => { track('hub_availability', 'select_model', { model: model.id, position: served.length + index }); onModel(model.id); }}>
        <ModelAvatar name={model.label} modelId={model.modelId} provider={{ id: model.provider, custom: model.source === 'custom' }} />
        <span><strong>{model.label}</strong><small>{t(mediaLabels[model.modality])} · {model.provider}</small></span><RemixIcon name="arrow-right-s-line" size={16} />
      </Button>)}</div>
    </section>}

  </div></main>;
}
