import { Button } from 'open-design-ui/button';
import { useEffect, useMemo, useState } from 'react';
import type { Modality, Model } from '../../../shared/gateway';
import { Popover } from '../components/ui/Popover';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { ModelAvatar } from '../motion/settingsPrimitives';
import { providerReady } from '../motion/imageMenuModels';
import { useMediaCatalog } from '../motion/useMediaCatalog';
import type { SuperAgentCreationModeId, SuperAgentModeSpec } from './ModeResourceShowcase';
import type { ResourceCategoryTab } from './ResourcePickerDialog';

export type ModeComposerOptions = {
  // Image Artwork
  imageModelId: string;
  imageAspect: 'auto' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2';
  imageQuality: 'standard' | 'high';
  imageCount: 1 | 2 | 4;

  // Cinema & Audio (also supports switching directly to Motion Code)
  mediaSubMode: 'video' | 'motion' | 'audio';
  videoModelId: string;
  videoAspect: '16:9' | '9:16' | '1:1' | '21:9';
  videoDuration: '5s' | '8s' | '10s' | '15s';
  videoSpeed: 'fast' | 'standard' | 'cinema';
  audioModelId: string;
  audioType: 'music' | 'voiceover' | 'sfx';
  audioDuration: '10s' | '30s' | '60s';

  // Motion Video (also supports switching directly to AI Video models like Seedance)
  motionEngine: 'motion' | 'video-model';
  motionAspect: '16:9' | '9:16' | '1:1' | '4:5';
  motionDuration: '10s' | '15s' | '20s' | '30s';
  motionFps: '30fps' | '60fps';
  motionStyle: 'kinetic' | 'product' | 'editorial' | 'minimal';

  // Slides & Docs
  deckFormat: 'slides' | 'document' | 'report';
  deckSlides: '5-7' | '8-12' | '12-16' | 'auto';
  deckDensity: 'visual' | 'balanced' | 'detailed';

  // Website & App
  webTarget: 'responsive' | 'mobile' | 'dashboard';
  webReferenceUrl: string;

  // HTML Game
  gameEngine: 'canvas2d' | 'webgl' | 'dom';
  gameViewport: '16:9' | '9:16' | 'fullscreen';
  gameControls: 'keyboard-mouse' | 'touch' | 'both';
};

export const DEFAULT_MODE_COMPOSER_OPTIONS: ModeComposerOptions = {
  imageModelId: 'auto',
  imageAspect: '16:9',
  imageQuality: 'standard',
  imageCount: 1,

  mediaSubMode: 'video',
  videoModelId: 'auto',
  videoAspect: '16:9',
  videoDuration: '5s',
  videoSpeed: 'standard',
  audioModelId: 'auto',
  audioType: 'music',
  audioDuration: '30s',

  motionEngine: 'motion',
  motionAspect: '16:9',
  motionDuration: '15s',
  motionFps: '30fps',
  motionStyle: 'kinetic',

  deckFormat: 'slides',
  deckSlides: '8-12',
  deckDensity: 'visual',

  webTarget: 'responsive',
  webReferenceUrl: '',

  gameEngine: 'canvas2d',
  gameViewport: '16:9',
  gameControls: 'keyboard-mouse',
};

const WEB_TARGET_LABELS: Record<ModeComposerOptions['webTarget'], string> = {
  responsive: 'Responsive Web',
  mobile: 'Mobile App',
  dashboard: 'Dashboard',
};

const DECK_FORMAT_LABELS: Record<ModeComposerOptions['deckFormat'], string> = {
  slides: 'Slides (16:9)',
  document: 'Document (A4)',
  report: 'Visual Report',
};

const DECK_DENSITY_LABELS: Record<ModeComposerOptions['deckDensity'], string> = {
  visual: 'Visual',
  balanced: 'Balanced',
  detailed: 'Detailed',
};

const MOTION_STYLE_LABELS: Record<ModeComposerOptions['motionStyle'], string> = {
  kinetic: 'Kinetic Type',
  product: 'Product Launch',
  editorial: 'Editorial',
  minimal: 'Minimal',
};

const GAME_ENGINE_LABELS: Record<ModeComposerOptions['gameEngine'], string> = {
  canvas2d: 'Canvas 2D',
  webgl: 'WebGL / 3D',
  dom: 'DOM Arcade',
};

const GAME_CONTROL_LABELS: Record<ModeComposerOptions['gameControls'], string> = {
  'keyboard-mouse': 'Keyboard + Mouse',
  touch: 'Touch / Mobile',
  both: 'Keyboard + Touch',
};

const AUDIO_TYPE_LABELS: Record<ModeComposerOptions['audioType'], string> = {
  music: 'Music',
  voiceover: 'Voiceover',
  sfx: 'Sound FX',
};

const VIDEO_SPEED_LABELS: Record<ModeComposerOptions['videoSpeed'], string> = {
  fast: 'Fast',
  standard: 'Standard',
  cinema: 'Cinema',
};

export function getModeComposerPlaceholder(
  mode: SuperAgentModeSpec | null,
  options: ModeComposerOptions,
  t: (text: string) => string,
): string {
  if (!mode) return t('Ask Super Agent to build a game, website, video, deck, or asset…');
  if (mode.id === 'media') {
    if (options.mediaSubMode === 'audio') {
      return t('Describe the soundtrack, voiceover, or sound effect you want to create…');
    }
    if (options.mediaSubMode === 'motion') {
      return t('Describe the editable HyperFrames motion video you want to build with code…');
    }
    return t('Describe the cinema video shot, camera motion, and lighting you want to generate…');
  }
  if (mode.id === 'motion' && options.motionEngine === 'video-model') {
    return t('Describe the AI video shot you want to generate with Seedance or your video model…');
  }
  return t(mode.placeholder);
}

export function formatModePromptPrefix(
  mode: SuperAgentModeSpec,
  options: ModeComposerOptions,
  mediaModels: Model[],
): string {
  const parts: string[] = [];
  const findModelLabel = (id: string) => {
    if (!id || id === 'auto') return null;
    const found = mediaModels.find(item => item.id === id);
    return found ? `${found.label} (${found.id})` : id;
  };

  if (mode.id === 'image') {
    parts.push('Mode: Image Artwork');
    const modelLabel = findModelLabel(options.imageModelId);
    if (modelLabel) parts.push(`Image Model: ${modelLabel}`);
    if (options.imageAspect !== 'auto') parts.push(`Aspect: ${options.imageAspect}`);
    if (options.imageQuality === 'high') parts.push('Quality: High / 2K');
    if (options.imageCount > 1) parts.push(`Count: ${options.imageCount} variations`);
  } else if (mode.id === 'media') {
    if (options.mediaSubMode === 'video') {
      parts.push('Mode: AI Cinema Video (Video Model)');
      const modelLabel = findModelLabel(options.videoModelId);
      if (modelLabel) parts.push(`Video Model: ${modelLabel}`);
      parts.push(`Format: ${options.videoAspect} · ${options.videoDuration} · ${VIDEO_SPEED_LABELS[options.videoSpeed]}`);
    } else if (options.mediaSubMode === 'motion') {
      parts.push('Mode: Motion Video (Editable HyperFrames Code)');
      parts.push(`Format: ${options.motionAspect} · ${options.motionDuration} · ${options.motionFps}`);
      parts.push(`Style: ${MOTION_STYLE_LABELS[options.motionStyle]}`);
    } else {
      parts.push('Mode: Audio Studio');
      const modelLabel = findModelLabel(options.audioModelId);
      if (modelLabel) parts.push(`Audio Model: ${modelLabel}`);
      parts.push(`Type: ${AUDIO_TYPE_LABELS[options.audioType]}`);
      parts.push(`Duration: ${options.audioDuration}`);
    }
  } else if (mode.id === 'motion') {
    if (options.motionEngine === 'video-model') {
      parts.push('Mode: AI Cinema Video (Video Model)');
      const modelLabel = findModelLabel(options.videoModelId);
      if (modelLabel) parts.push(`Video Model: ${modelLabel}`);
      parts.push(`Format: ${options.videoAspect} · ${options.videoDuration} · ${VIDEO_SPEED_LABELS[options.videoSpeed]}`);
    } else {
      parts.push('Mode: Motion Video (Editable HyperFrames Code)');
      parts.push(`Format: ${options.motionAspect} · ${options.motionDuration} · ${options.motionFps}`);
      parts.push(`Style: ${MOTION_STYLE_LABELS[options.motionStyle]}`);
    }
  } else if (mode.id === 'deck') {
    parts.push('Mode: Slides & Docs');
    parts.push(`Format: ${DECK_FORMAT_LABELS[options.deckFormat]}`);
    if (options.deckSlides !== 'auto') parts.push(`Length: ${options.deckSlides} slides`);
    parts.push(`Style: ${DECK_DENSITY_LABELS[options.deckDensity]}`);
  } else if (mode.id === 'website') {
    parts.push('Mode: Website & App');
    parts.push(`Target: ${WEB_TARGET_LABELS[options.webTarget]}`);
    if (options.webReferenceUrl.trim()) parts.push(`Reference URL: ${options.webReferenceUrl.trim()}`);
  } else if (mode.id === 'game') {
    parts.push('Mode: HTML Game');
    parts.push(`Engine: ${GAME_ENGINE_LABELS[options.gameEngine]}`);
    parts.push(`Viewport: ${options.gameViewport}`);
    parts.push(`Controls: ${GAME_CONTROL_LABELS[options.gameControls]}`);
  } else {
    parts.push(`Mode: ${mode.label}`);
  }

  return `[${parts.join(' | ')}]`;
}

function modelShortDescription(model: Model, t: (text: string) => string): string {
  if (model.description?.trim()) return model.description.trim();
  const hints: string[] = [];
  if (model.modality === 'image' && model.supportsImageReference) hints.push(t('Supports image reference & edit'));
  if (model.modality === 'video' && (model.maxInputImages ?? 0) > 0) hints.push(t('Supports start-frame reference'));
  if (model.modality === 'audio' && model.mode) hints.push(model.mode);
  if (hints.length) return hints.join(' · ');
  return model.provider;
}

export function ModeComposerControls({
  active = true,
  modeId,
  options,
  disabled,
  onChange,
  onCatalogModelsChange,
  onOpenResourcePicker,
  onOpenModelSettings,
}: {
  active?: boolean;
  modeId: SuperAgentCreationModeId;
  options: ModeComposerOptions;
  disabled?: boolean;
  onChange: (patch: Partial<ModeComposerOptions>) => void;
  onCatalogModelsChange?: (models: Model[]) => void;
  onOpenResourcePicker: (category: ResourceCategoryTab) => void;
  onOpenModelSettings: () => void;
}) {
  const { t } = useI18n();
  const needsMediaCatalog = active && (modeId === 'image' || modeId === 'media' || modeId === 'motion');
  const { catalog } = useMediaCatalog(needsMediaCatalog);
  const [openMenu, setOpenMenu] = useState<'pipeline' | 'model' | 'params' | 'import' | null>(null);
  const [urlDraft, setUrlDraft] = useState(options.webReferenceUrl);

  useEffect(() => {
    setUrlDraft(options.webReferenceUrl);
  }, [options.webReferenceUrl]);

  useEffect(() => {
    if (!active) setOpenMenu(null);
  }, [active]);

  useEffect(() => {
    setOpenMenu(null);
  }, [modeId]);

  useEffect(() => {
    if (catalog?.models && onCatalogModelsChange) {
      onCatalogModelsChange(catalog.models);
    }
  }, [catalog?.models, onCatalogModelsChange]);

  const activeModality: Modality | null = modeId === 'image'
    ? 'image'
    : modeId === 'media'
      ? (options.mediaSubMode === 'audio' ? 'audio' : options.mediaSubMode === 'video' ? 'video' : null)
      : modeId === 'motion' && options.motionEngine === 'video-model'
        ? 'video'
        : null;

  const modalityModels = useMemo(() => {
    if (!activeModality || !catalog?.models) return [];
    const providers = catalog.status.providers ?? [];
    const filtered = catalog.models.filter(item => item.modality === activeModality);
    return filtered.sort((a, b) => {
      const aReady = providerReady(providers, a.provider) ? 0 : 1;
      const bReady = providerReady(providers, b.provider) ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return a.label.localeCompare(b.label);
    });
  }, [activeModality, catalog]);

  const providers = catalog?.status.providers ?? [];
  const defaultRouteId = activeModality ? catalog?.status.routes?.[activeModality] : undefined;
  const defaultRouteModel = defaultRouteId ? modalityModels.find(item => item.id === defaultRouteId) : modalityModels[0];

  const renderMediaModelSelector = (
    selectedId: string,
    onSelect: (id: string) => void,
    modalityLabel: string,
  ) => {
    const selectedModel = selectedId !== 'auto' ? modalityModels.find(item => item.id === selectedId) : undefined;
    const triggerLabel = selectedModel?.label ?? (defaultRouteModel ? defaultRouteModel.label : t('Auto model'));
    const triggerProvider = selectedModel?.provider ?? defaultRouteModel?.provider ?? 'opendesign';

    return (
      <Popover
        open={openMenu === 'model'}
        onOpenChange={next => setOpenMenu(next ? 'model' : null)}
        side="top"
        align="start"
        aria-label={modalityLabel}
        className="om-agent-settings-popover om-sa-mode-popover om-sa-mode-model-popover"
        trigger={
          <Button
            variant="plain"
            type="button"
            className="om-sa-mode-param-trigger"
            data-active={selectedId !== 'auto' || openMenu === 'model' || undefined}
            disabled={disabled}
          >
            <span className="om-sa-mode-param-avatar" aria-hidden="true">
              {selectedModel || defaultRouteModel ? (
                <ModelAvatar
                  name={triggerLabel}
                  modelId={selectedModel?.modelId ?? defaultRouteModel?.modelId ?? triggerLabel}
                  provider={{ id: triggerProvider, custom: false }}
                />
              ) : (
                <RemixIcon name="sparkling-line" size={13} />
              )}
            </span>
            <span className="om-sa-mode-param-label">{triggerLabel}</span>
            <RemixIcon name="arrow-down-s-line" size={14} />
          </Button>
        }
      >
        <div className="om-sa-mode-menu">
          <div className="om-sa-mode-menu-head">
            <span className="om-sa-popover-label">{modalityLabel}</span>
            <span className="om-sa-mode-menu-count">{modalityModels.length}</span>
          </div>
          <div className="om-sa-mode-model-list" role="listbox" aria-label={modalityLabel}>
            <Button
              variant="plain"
              type="button"
              role="option"
              aria-selected={selectedId === 'auto'}
              data-active={selectedId === 'auto' || undefined}
              className="om-sa-mode-model-row"
              onClick={() => {
                onSelect('auto');
                setOpenMenu(null);
              }}
            >
              <span className="om-sa-mode-model-avatar" aria-hidden="true">
                <RemixIcon name="sparkling-fill" size={14} />
              </span>
              <span className="om-sa-mode-model-copy">
                <strong>{t('Auto (Recommended)')}</strong>
                <span>{defaultRouteModel ? `${t('Uses')} ${defaultRouteModel.label}` : t('Pick best configured model automatically')}</span>
              </span>
              {selectedId === 'auto' && <RemixIcon name="check-line" size={15} />}
            </Button>

            {modalityModels.map(model => {
              const isSelected = selectedId === model.id;
              const ready = providerReady(providers, model.provider);
              return (
                <Button
                  key={model.id}
                  variant="plain"
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-active={isSelected || undefined}
                  className="om-sa-mode-model-row"
                  onClick={() => {
                    onSelect(model.id);
                    setOpenMenu(null);
                  }}
                >
                  <span className="om-sa-mode-model-avatar" aria-hidden="true">
                    <ModelAvatar name={model.label} modelId={model.modelId} provider={{ id: model.provider, custom: false }} />
                  </span>
                  <span className="om-sa-mode-model-copy">
                    <span className="om-sa-mode-model-title-line">
                      <strong>{model.label}</strong>
                      <span className="om-sa-model-group-dot" data-ready={ready || undefined} aria-hidden="true" />
                    </span>
                    <span>{modelShortDescription(model, t)}</span>
                  </span>
                  {isSelected && <RemixIcon name="check-line" size={15} />}
                </Button>
              );
            })}

            {modalityModels.length === 0 && (
              <div className="om-sa-model-unavailable">
                <p className="om-muted">{t('No configured models yet. Connect a provider in Settings.')}</p>
              </div>
            )}
          </div>
          <div className="om-sa-model-menu-foot">
            <Button
              variant="plain"
              type="button"
              className="om-sa-popover-link-row"
              onClick={() => {
                setOpenMenu(null);
                onOpenModelSettings();
              }}
            >
              <RemixIcon name="settings-3-line" size={15} />
              <span>{t('Manage Model Providers')}</span>
              <RemixIcon name="arrow-right-up-line" size={14} />
            </Button>
          </div>
        </div>
      </Popover>
    );
  };

  if (modeId === 'image') {
    const aspectSummary = options.imageAspect === 'auto' ? t('Auto') : options.imageAspect;
    const countSummary = options.imageCount > 1 ? ` · ${options.imageCount}×` : '';
    const qualitySummary = options.imageQuality === 'high' ? ' · 2K' : '';

    return (
      <div className="om-sa-mode-controls" role="group" aria-label={t('Image options')}>
        {renderMediaModelSelector(options.imageModelId, id => onChange({ imageModelId: id }), t('Image model'))}

        <Popover
          open={openMenu === 'params'}
          onOpenChange={next => setOpenMenu(next ? 'params' : null)}
          side="top"
          align="start"
          aria-label={t('Image parameters')}
          className="om-agent-settings-popover om-sa-mode-popover"
          trigger={
            <Button
              variant="plain"
              type="button"
              className="om-sa-mode-param-trigger"
              data-active={openMenu === 'params' || undefined}
              disabled={disabled}
            >
              <RemixIcon name="layout-line" size={13} />
              <span className="om-sa-mode-param-label">{`${aspectSummary}${qualitySummary}${countSummary}`}</span>
              <RemixIcon name="arrow-down-s-line" size={14} />
            </Button>
          }
        >
          <div className="om-sa-mode-menu">
            <div className="om-sa-mode-field">
              <span className="om-sa-popover-label">{t('Aspect ratio')}</span>
              <div className="om-sa-popover-pills">
                {(['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2'] as const).map(ratio => (
                  <Button
                    key={ratio}
                    variant="plain"
                    type="button"
                    className="om-sa-popover-pill"
                    aria-pressed={options.imageAspect === ratio}
                    data-active={options.imageAspect === ratio || undefined}
                    onClick={() => onChange({ imageAspect: ratio })}
                  >
                    {ratio === 'auto' ? t('Auto') : ratio}
                  </Button>
                ))}
              </div>
            </div>
            <div className="om-sa-mode-field">
              <span className="om-sa-popover-label">{t('Quality')}</span>
              <div className="om-sa-popover-pills">
                {(['standard', 'high'] as const).map(q => (
                  <Button
                    key={q}
                    variant="plain"
                    type="button"
                    className="om-sa-popover-pill"
                    aria-pressed={options.imageQuality === q}
                    data-active={options.imageQuality === q || undefined}
                    onClick={() => onChange({ imageQuality: q })}
                  >
                    {q === 'high' ? t('High · 2K') : t('Standard')}
                  </Button>
                ))}
              </div>
            </div>
            <div className="om-sa-mode-field">
              <span className="om-sa-popover-label">{t('Variations')}</span>
              <div className="om-sa-popover-pills">
                {([1, 2, 4] as const).map(count => (
                  <Button
                    key={count}
                    variant="plain"
                    type="button"
                    className="om-sa-popover-pill"
                    aria-pressed={options.imageCount === count}
                    data-active={options.imageCount === count || undefined}
                    onClick={() => onChange({ imageCount: count })}
                  >
                    {`${count} ${count === 1 ? t('image') : t('images')}`}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </Popover>
      </div>
    );
  }

  const renderVideoParamsPopover = () => {
    const paramSummary = `${options.videoAspect} · ${options.videoDuration} · ${t(VIDEO_SPEED_LABELS[options.videoSpeed])}`;
    return (
      <Popover
        open={openMenu === 'params'}
        onOpenChange={next => setOpenMenu(next ? 'params' : null)}
        side="top"
        align="start"
        aria-label={t('Video parameters')}
        className="om-agent-settings-popover om-sa-mode-popover"
        trigger={
          <Button
            variant="plain"
            type="button"
            className="om-sa-mode-param-trigger"
            data-active={openMenu === 'params' || undefined}
            disabled={disabled}
          >
            <RemixIcon name="clapperboard-line" size={13} />
            <span className="om-sa-mode-param-label">{paramSummary}</span>
            <RemixIcon name="arrow-down-s-line" size={14} />
          </Button>
        }
      >
        <div className="om-sa-mode-menu">
          <div className="om-sa-mode-field">
            <span className="om-sa-popover-label">{t('Aspect ratio')}</span>
            <div className="om-sa-popover-pills">
              {(['16:9', '9:16', '1:1', '21:9'] as const).map(ratio => (
                <Button
                  key={ratio}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.videoAspect === ratio}
                  data-active={options.videoAspect === ratio || undefined}
                  onClick={() => onChange({ videoAspect: ratio })}
                >
                  {ratio}
                </Button>
              ))}
            </div>
          </div>
          <div className="om-sa-mode-field">
            <span className="om-sa-popover-label">{t('Duration')}</span>
            <div className="om-sa-popover-pills">
              {(['5s', '8s', '10s', '15s'] as const).map(dur => (
                <Button
                  key={dur}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.videoDuration === dur}
                  data-active={options.videoDuration === dur || undefined}
                  onClick={() => onChange({ videoDuration: dur })}
                >
                  {dur}
                </Button>
              ))}
            </div>
          </div>
          <div className="om-sa-mode-field">
            <span className="om-sa-popover-label">{t('Generation mode')}</span>
            <div className="om-sa-popover-pills">
              {(['fast', 'standard', 'cinema'] as const).map(speed => (
                <Button
                  key={speed}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.videoSpeed === speed}
                  data-active={options.videoSpeed === speed || undefined}
                  onClick={() => onChange({ videoSpeed: speed })}
                >
                  {t(VIDEO_SPEED_LABELS[speed])}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Popover>
    );
  };

  const renderMotionParamsPopover = () => {
    const motionSummary = `${options.motionAspect} · ${options.motionDuration} · ${options.motionFps}`;
    return (
      <Popover
        open={openMenu === 'params'}
        onOpenChange={next => setOpenMenu(next ? 'params' : null)}
        side="top"
        align="start"
        aria-label={t('Motion Video parameters')}
        className="om-agent-settings-popover om-sa-mode-popover"
        trigger={
          <Button
            variant="plain"
            type="button"
            className="om-sa-mode-param-trigger"
            data-active={openMenu === 'params' || undefined}
            disabled={disabled}
          >
            <RemixIcon name="movie-line" size={13} />
            <span className="om-sa-mode-param-label">{motionSummary}</span>
            <RemixIcon name="arrow-down-s-line" size={14} />
          </Button>
        }
      >
        <div className="om-sa-mode-menu">
          <div className="om-sa-mode-field">
            <span className="om-sa-popover-label">{t('Aspect ratio')}</span>
            <div className="om-sa-popover-pills">
              {(['16:9', '9:16', '1:1', '4:5'] as const).map(ratio => (
                <Button
                  key={ratio}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.motionAspect === ratio}
                  data-active={options.motionAspect === ratio || undefined}
                  onClick={() => onChange({ motionAspect: ratio })}
                >
                  {ratio}
                </Button>
              ))}
            </div>
          </div>
          <div className="om-sa-mode-field">
            <span className="om-sa-popover-label">{t('Duration')}</span>
            <div className="om-sa-popover-pills">
              {(['10s', '15s', '20s', '30s'] as const).map(dur => (
                <Button
                  key={dur}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.motionDuration === dur}
                  data-active={options.motionDuration === dur || undefined}
                  onClick={() => onChange({ motionDuration: dur })}
                >
                  {dur}
                </Button>
              ))}
            </div>
          </div>
          <div className="om-sa-mode-field">
            <span className="om-sa-popover-label">{t('Frame rate & style')}</span>
            <div className="om-sa-popover-pills">
              {(['30fps', '60fps'] as const).map(fps => (
                <Button
                  key={fps}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.motionFps === fps}
                  data-active={options.motionFps === fps || undefined}
                  onClick={() => onChange({ motionFps: fps })}
                >
                  {fps}
                </Button>
              ))}
            </div>
            <div className="om-sa-popover-pills">
              {(['kinetic', 'product', 'editorial', 'minimal'] as const).map(style => (
                <Button
                  key={style}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.motionStyle === style}
                  data-active={options.motionStyle === style || undefined}
                  onClick={() => onChange({ motionStyle: style })}
                >
                  {t(MOTION_STYLE_LABELS[style])}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Popover>
    );
  };

  if (modeId === 'media') {
    const subMode = options.mediaSubMode;
    const subModeMeta = subMode === 'motion'
      ? { icon: 'code-s-slash-line', label: t('Motion Code') }
      : subMode === 'audio'
        ? { icon: 'music-2-line', label: t('Audio') }
        : { icon: 'clapperboard-line', label: t('AI Video') };
    const audioSummary = `${t(AUDIO_TYPE_LABELS[options.audioType])} · ${options.audioDuration}`;

    return (
      <div className="om-sa-mode-controls" role="group" aria-label={t('Cinema & Audio options')}>
        <Popover
          open={openMenu === 'pipeline'}
          onOpenChange={next => setOpenMenu(next ? 'pipeline' : null)}
          side="top"
          align="start"
          aria-label={t('Video or audio pipeline')}
          className="om-agent-settings-popover om-sa-mode-popover"
          trigger={
            <Button
              variant="plain"
              type="button"
              className="om-sa-mode-param-trigger"
              data-active={openMenu === 'pipeline' || undefined}
              disabled={disabled}
            >
              <RemixIcon name={subModeMeta.icon} size={13} />
              <span className="om-sa-mode-param-label">{subModeMeta.label}</span>
              <RemixIcon name="arrow-down-s-line" size={14} />
            </Button>
          }
        >
          <div className="om-sa-mode-menu">
            <span className="om-sa-popover-label">{t('Generation pipeline')}</span>
            <div className="om-sa-mode-model-list" role="listbox" aria-label={t('Generation pipeline')}>
              {(
                [
                  { id: 'video', icon: 'clapperboard-line', title: t('AI Video (Models)'), desc: t('Generate cinema shots with Seedance, Veo, or configured video models') },
                  { id: 'motion', icon: 'code-s-slash-line', title: t('Motion Video (Code)'), desc: t('Build editable HyperFrames HTML & GSAP timeline animations') },
                  { id: 'audio', icon: 'music-2-line', title: t('Audio & Sound'), desc: t('Compose music, narration voiceovers, or sound effects') },
                ] as const
              ).map(entry => {
                const isSelected = subMode === entry.id;
                return (
                  <Button
                    key={entry.id}
                    variant="plain"
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected || undefined}
                    className="om-sa-mode-model-row"
                    onClick={() => {
                      onChange({ mediaSubMode: entry.id });
                      setOpenMenu(null);
                    }}
                  >
                    <span className="om-sa-mode-model-avatar" aria-hidden="true">
                      <RemixIcon name={entry.icon} size={14} />
                    </span>
                    <span className="om-sa-mode-model-copy">
                      <strong>{entry.title}</strong>
                      <span>{entry.desc}</span>
                    </span>
                    {isSelected && <RemixIcon name="check-line" size={15} />}
                  </Button>
                );
              })}
            </div>
          </div>
        </Popover>

        {subMode === 'video' && renderMediaModelSelector(options.videoModelId, id => onChange({ videoModelId: id }), t('Video model'))}
        {subMode === 'audio' && renderMediaModelSelector(options.audioModelId, id => onChange({ audioModelId: id }), t('Audio model'))}

        {subMode === 'video' && renderVideoParamsPopover()}
        {subMode === 'motion' && renderMotionParamsPopover()}
        {subMode === 'audio' && (
          <Popover
            open={openMenu === 'params'}
            onOpenChange={next => setOpenMenu(next ? 'params' : null)}
            side="top"
            align="start"
            aria-label={t('Audio parameters')}
            className="om-agent-settings-popover om-sa-mode-popover"
            trigger={
              <Button
                variant="plain"
                type="button"
                className="om-sa-mode-param-trigger"
                data-active={openMenu === 'params' || undefined}
                disabled={disabled}
              >
                <RemixIcon name="music-2-line" size={13} />
                <span className="om-sa-mode-param-label">{audioSummary}</span>
                <RemixIcon name="arrow-down-s-line" size={14} />
              </Button>
            }
          >
            <div className="om-sa-mode-menu">
              <div className="om-sa-mode-field">
                <span className="om-sa-popover-label">{t('Audio type')}</span>
                <div className="om-sa-popover-pills">
                  {(['music', 'voiceover', 'sfx'] as const).map(kind => (
                    <Button
                      key={kind}
                      variant="plain"
                      type="button"
                      className="om-sa-popover-pill"
                      aria-pressed={options.audioType === kind}
                      data-active={options.audioType === kind || undefined}
                      onClick={() => onChange({ audioType: kind })}
                    >
                      {t(AUDIO_TYPE_LABELS[kind])}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="om-sa-mode-field">
                <span className="om-sa-popover-label">{t('Duration')}</span>
                <div className="om-sa-popover-pills">
                  {(['10s', '30s', '60s'] as const).map(dur => (
                    <Button
                      key={dur}
                      variant="plain"
                      type="button"
                      className="om-sa-popover-pill"
                      aria-pressed={options.audioDuration === dur}
                      data-active={options.audioDuration === dur || undefined}
                      onClick={() => onChange({ audioDuration: dur })}
                    >
                      {dur}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Popover>
        )}
      </div>
    );
  }

  if (modeId === 'motion') {
    const isCodeMotion = options.motionEngine === 'motion';
    return (
      <div className="om-sa-mode-controls" role="group" aria-label={t('Motion Video options')}>
        <Popover
          open={openMenu === 'pipeline'}
          onOpenChange={next => setOpenMenu(next ? 'pipeline' : null)}
          side="top"
          align="start"
          aria-label={t('Motion or AI video engine')}
          className="om-agent-settings-popover om-sa-mode-popover"
          trigger={
            <Button
              variant="plain"
              type="button"
              className="om-sa-mode-param-trigger"
              data-active={openMenu === 'pipeline' || !isCodeMotion || undefined}
              disabled={disabled}
            >
              <RemixIcon name={isCodeMotion ? 'code-s-slash-line' : 'clapperboard-line'} size={13} />
              <span className="om-sa-mode-param-label">{isCodeMotion ? t('Motion Code') : t('AI Video')}</span>
              <RemixIcon name="arrow-down-s-line" size={14} />
            </Button>
          }
        >
          <div className="om-sa-mode-menu">
            <span className="om-sa-popover-label">{t('Video generation engine')}</span>
            <div className="om-sa-mode-model-list" role="listbox" aria-label={t('Video generation engine')}>
              {(
                [
                  { id: 'motion', icon: 'code-s-slash-line', title: t('Motion Video (Code)'), desc: t('Editable HyperFrames HTML & GSAP timeline film') },
                  { id: 'video-model', icon: 'clapperboard-line', title: t('AI Video (Seedance / Models)'), desc: t('Generate video clips directly with configured AI video models') },
                ] as const
              ).map(entry => {
                const isSelected = options.motionEngine === entry.id;
                return (
                  <Button
                    key={entry.id}
                    variant="plain"
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected || undefined}
                    className="om-sa-mode-model-row"
                    onClick={() => {
                      onChange({ motionEngine: entry.id });
                      setOpenMenu(null);
                    }}
                  >
                    <span className="om-sa-mode-model-avatar" aria-hidden="true">
                      <RemixIcon name={entry.icon} size={14} />
                    </span>
                    <span className="om-sa-mode-model-copy">
                      <strong>{entry.title}</strong>
                      <span>{entry.desc}</span>
                    </span>
                    {isSelected && <RemixIcon name="check-line" size={15} />}
                  </Button>
                );
              })}
            </div>
          </div>
        </Popover>

        {!isCodeMotion && renderMediaModelSelector(options.videoModelId, id => onChange({ videoModelId: id }), t('Video model'))}
        {isCodeMotion ? renderMotionParamsPopover() : renderVideoParamsPopover()}
      </div>
    );
  }

  if (modeId === 'deck') {
    const slidesLabel = options.deckSlides === 'auto' ? t('Auto length') : `${options.deckSlides} ${t('slides')}`;
    return (
      <div className="om-sa-mode-controls" role="group" aria-label={t('Slides & Docs options')}>
        <Popover
          open={openMenu === 'params'}
          onOpenChange={next => setOpenMenu(next ? 'params' : null)}
          side="top"
          align="start"
          aria-label={t('Deck format & length')}
          className="om-agent-settings-popover om-sa-mode-popover"
          trigger={
            <Button
              variant="plain"
              type="button"
              className="om-sa-mode-param-trigger"
              data-active={openMenu === 'params' || undefined}
              disabled={disabled}
            >
              <RemixIcon name="slideshow-line" size={13} />
              <span className="om-sa-mode-param-label">{`${t(DECK_FORMAT_LABELS[options.deckFormat])} · ${slidesLabel}`}</span>
              <RemixIcon name="arrow-down-s-line" size={14} />
            </Button>
          }
        >
          <div className="om-sa-mode-menu">
            <div className="om-sa-mode-field">
              <span className="om-sa-popover-label">{t('Output format')}</span>
              <div className="om-sa-popover-pills">
                {(['slides', 'document', 'report'] as const).map(fmt => (
                  <Button
                    key={fmt}
                    variant="plain"
                    type="button"
                    className="om-sa-popover-pill"
                    aria-pressed={options.deckFormat === fmt}
                    data-active={options.deckFormat === fmt || undefined}
                    onClick={() => onChange({ deckFormat: fmt })}
                  >
                    {t(DECK_FORMAT_LABELS[fmt])}
                  </Button>
                ))}
              </div>
            </div>
            <div className="om-sa-mode-field">
              <span className="om-sa-popover-label">{t('Length')}</span>
              <div className="om-sa-popover-pills">
                {(['5-7', '8-12', '12-16', 'auto'] as const).map(len => (
                  <Button
                    key={len}
                    variant="plain"
                    type="button"
                    className="om-sa-popover-pill"
                    aria-pressed={options.deckSlides === len}
                    data-active={options.deckSlides === len || undefined}
                    onClick={() => onChange({ deckSlides: len })}
                  >
                    {len === 'auto' ? t('Auto') : len}
                  </Button>
                ))}
              </div>
            </div>
            <div className="om-sa-mode-field">
              <span className="om-sa-popover-label">{t('Density')}</span>
              <div className="om-sa-popover-pills">
                {(['visual', 'balanced', 'detailed'] as const).map(density => (
                  <Button
                    key={density}
                    variant="plain"
                    type="button"
                    className="om-sa-popover-pill"
                    aria-pressed={options.deckDensity === density}
                    data-active={options.deckDensity === density || undefined}
                    onClick={() => onChange({ deckDensity: density })}
                  >
                    {t(DECK_DENSITY_LABELS[density])}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </Popover>
      </div>
    );
  }

  if (modeId === 'website') {
    const hasUrl = Boolean(options.webReferenceUrl.trim());
    return (
      <div className="om-sa-mode-controls" role="group" aria-label={t('Website & App options')}>
        <Popover
          open={openMenu === 'params'}
          onOpenChange={next => setOpenMenu(next ? 'params' : null)}
          side="top"
          align="start"
          aria-label={t('Target viewport')}
          className="om-agent-settings-popover om-sa-mode-popover"
          trigger={
            <Button
              variant="plain"
              type="button"
              className="om-sa-mode-param-trigger"
              data-active={openMenu === 'params' || undefined}
              disabled={disabled}
            >
              <RemixIcon name="layout-line" size={13} />
              <span className="om-sa-mode-param-label">{t(WEB_TARGET_LABELS[options.webTarget])}</span>
              <RemixIcon name="arrow-down-s-line" size={14} />
            </Button>
          }
        >
          <div className="om-sa-mode-menu">
            <div className="om-sa-mode-field">
              <span className="om-sa-popover-label">{t('Target layout')}</span>
              <div className="om-sa-popover-pills">
                {(['responsive', 'mobile', 'dashboard'] as const).map(target => (
                  <Button
                    key={target}
                    variant="plain"
                    type="button"
                    className="om-sa-popover-pill"
                    aria-pressed={options.webTarget === target}
                    data-active={options.webTarget === target || undefined}
                    onClick={() => {
                      onChange({ webTarget: target });
                      setOpenMenu(null);
                    }}
                  >
                    {t(WEB_TARGET_LABELS[target])}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </Popover>

        <Popover
          open={openMenu === 'import'}
          onOpenChange={next => setOpenMenu(next ? 'import' : null)}
          side="top"
          align="start"
          aria-label={t('Import from URL or Brand Kit')}
          className="om-agent-settings-popover om-sa-mode-popover"
          trigger={
            <Button
              variant="plain"
              type="button"
              className="om-sa-mode-param-trigger"
              data-active={hasUrl || openMenu === 'import' || undefined}
              disabled={disabled}
            >
              <RemixIcon name="global-line" size={13} />
              <span className="om-sa-mode-param-label">
                {hasUrl ? options.webReferenceUrl.replace(/^https?:\/\//, '').slice(0, 22) : t('Import from…')}
              </span>
              <RemixIcon name="arrow-down-s-line" size={14} />
            </Button>
          }
        >
          <div className="om-sa-mode-menu">
            <div className="om-sa-mode-field">
              <span className="om-sa-popover-label">{t('Reference website URL')}</span>
              <div className="om-sa-mode-url-row">
                <input
                  type="url"
                  className="om-sa-mode-url-input"
                  value={urlDraft}
                  placeholder="https://example.com"
                  onChange={event => setUrlDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onChange({ webReferenceUrl: urlDraft.trim() });
                      setOpenMenu(null);
                    }
                  }}
                />
                <Button
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  data-active
                  onClick={() => {
                    onChange({ webReferenceUrl: urlDraft.trim() });
                    setOpenMenu(null);
                  }}
                >
                  {t('Apply')}
                </Button>
                {hasUrl && (
                  <Button
                    variant="plain"
                    type="button"
                    className="om-sa-popover-pill"
                    onClick={() => {
                      setUrlDraft('');
                      onChange({ webReferenceUrl: '' });
                      setOpenMenu(null);
                    }}
                  >
                    {t('Clear')}
                  </Button>
                )}
              </div>
            </div>
            <div className="om-sa-model-menu-foot">
              <Button
                variant="plain"
                type="button"
                className="om-sa-popover-link-row"
                onClick={() => {
                  setOpenMenu(null);
                  onOpenResourcePicker('brand-kit');
                }}
              >
                <RemixIcon name="palette-line" size={15} />
                <span>{t('Attach Brand Kit')}</span>
                <RemixIcon name="arrow-right-up-line" size={14} />
              </Button>
              <Button
                variant="plain"
                type="button"
                className="om-sa-popover-link-row"
                onClick={() => {
                  setOpenMenu(null);
                  onOpenResourcePicker('design-template');
                }}
              >
                <RemixIcon name="layout-line" size={15} />
                <span>{t('Attach Design Template')}</span>
                <RemixIcon name="arrow-right-up-line" size={14} />
              </Button>
            </div>
          </div>
        </Popover>
      </div>
    );
  }

  // game mode
  const gameSummary = `${t(GAME_ENGINE_LABELS[options.gameEngine])} · ${options.gameViewport}`;
  return (
    <div className="om-sa-mode-controls" role="group" aria-label={t('HTML Game options')}>
      <Popover
        open={openMenu === 'params'}
        onOpenChange={next => setOpenMenu(next ? 'params' : null)}
        side="top"
        align="start"
        aria-label={t('Game engine & viewport')}
        className="om-agent-settings-popover om-sa-mode-popover"
        trigger={
          <Button
            variant="plain"
            type="button"
            className="om-sa-mode-param-trigger"
            data-active={openMenu === 'params' || undefined}
            disabled={disabled}
          >
            <RemixIcon name="code-s-slash-line" size={13} />
            <span className="om-sa-mode-param-label">{gameSummary}</span>
            <RemixIcon name="arrow-down-s-line" size={14} />
          </Button>
        }
      >
        <div className="om-sa-mode-menu">
          <div className="om-sa-mode-field">
            <span className="om-sa-popover-label">{t('Renderer')}</span>
            <div className="om-sa-popover-pills">
              {(['canvas2d', 'webgl', 'dom'] as const).map(engine => (
                <Button
                  key={engine}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.gameEngine === engine}
                  data-active={options.gameEngine === engine || undefined}
                  onClick={() => onChange({ gameEngine: engine })}
                >
                  {t(GAME_ENGINE_LABELS[engine])}
                </Button>
              ))}
            </div>
          </div>
          <div className="om-sa-mode-field">
            <span className="om-sa-popover-label">{t('Viewport')}</span>
            <div className="om-sa-popover-pills">
              {(['16:9', '9:16', 'fullscreen'] as const).map(vp => (
                <Button
                  key={vp}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.gameViewport === vp}
                  data-active={options.gameViewport === vp || undefined}
                  onClick={() => onChange({ gameViewport: vp })}
                >
                  {vp === 'fullscreen' ? t('Fullscreen') : vp}
                </Button>
              ))}
            </div>
          </div>
          <div className="om-sa-mode-field">
            <span className="om-sa-popover-label">{t('Controls')}</span>
            <div className="om-sa-popover-pills">
              {(['keyboard-mouse', 'touch', 'both'] as const).map(ctrl => (
                <Button
                  key={ctrl}
                  variant="plain"
                  type="button"
                  className="om-sa-popover-pill"
                  aria-pressed={options.gameControls === ctrl}
                  data-active={options.gameControls === ctrl || undefined}
                  onClick={() => onChange({ gameControls: ctrl })}
                >
                  {t(GAME_CONTROL_LABELS[ctrl])}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Popover>
    </div>
  );
}
