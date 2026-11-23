import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { mcpGalleryPreview } from './mcpGallery';
import { formatMcpAgentPrompt, mcpShowcaseModules, type McpCaseTarget, type McpShowcaseModule, type McpShowcaseSlide } from './mcpShowcaseData';

type PreviewState = {
  title: string;
  image: string;
  video?: string;
  showcaseIframe?: string;
  target: McpCaseTarget;
  prompt: string;
  id: string;
};

function FeatureModuleCarousel({
  module,
  moduleIndex,
  enabled,
  onCopy,
  onOpenPreview,
}: {
  module: McpShowcaseModule;
  moduleIndex: number;
  enabled: boolean;
  onCopy: (slideId: string, prompt: string) => Promise<boolean>;
  onOpenPreview: (state: PreviewState, trigger: HTMLElement) => void;
}) {
  const { t, locale } = useI18n();
  const lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const slides = module.slides;
  const total = slides.length;
  const current: McpShowcaseSlide = slides[index];
  const prevSlide = slides[(index - 1 + total) % total];
  const nextSlide = slides[(index + 1) % total];
  const currentText = current.content[lang];
  const reducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const playVideo = enabled && !reducedMotion && Boolean(current.video) && !videoErrors[current.id];

  useEffect(() => {
    if (!enabled || hovered || reducedMotion) return;
    let intervalId = 0;
    const delayId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        if (!document.hidden) setIndex(prev => (prev + 1) % total);
      }, 6000);
    }, moduleIndex * 1800);
    return () => {
      window.clearTimeout(delayId);
      window.clearInterval(intervalId);
    };
  }, [enabled, hovered, moduleIndex, reducedMotion, total]);

  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  const step = (delta: number) => setIndex(prev => (prev + delta + total) % total);

  async function handleCopy() {
    const full = formatMcpAgentPrompt(currentText.prompt, current.target);
    if (await onCopy(current.id, full)) setCopiedId(current.id);
  }

  return (
    <div
      className="om-mcp-carousel-module"
      id={module.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="om-mcp-carousel-head" id={module.anchorId}>
        <h2>{module.title[lang]}</h2>
      </div>

      <div className="om-mcp-carousel-tabs" role="tablist" aria-label={module.title[lang]}>
        {slides.map((slide, slideIdx) => {
          const isActive = slideIdx === index;
          return (
            <Button
              key={slide.id}
              variant="plain"
              role="tab"
              aria-selected={isActive}
              className="om-mcp-carousel-tab"
              data-active={isActive || undefined}
              onClick={() => setIndex(slideIdx)}
            >
              <span>{slide.content[lang].tabLabel}</span>
            </Button>
          );
        })}
      </div>

      <div className="om-mcp-carousel-viewport">
        <Button
          variant="plain"
          className="om-mcp-carousel-peek om-mcp-carousel-peek-prev"
          aria-label={t('Previous showcase')}
          onClick={() => step(-1)}
        >
          <img key={prevSlide.id} src={prevSlide.image} alt="" decoding="async" />
        </Button>

        <div className="om-mcp-carousel-shell">
          <Button
            variant="plain"
            className="om-mcp-carousel-nav om-mcp-carousel-nav-prev"
            aria-label={t('Previous showcase')}
            onClick={() => step(-1)}
          >
            <RemixIcon name="arrow-left-line" size={18} />
          </Button>

          <article className="om-mcp-carousel-card">
            {playVideo ? (
              <video
                key={current.id}
                className="om-mcp-carousel-img"
                src={current.video}
                poster={current.image}
                aria-label={currentText.title}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                onError={() => setVideoErrors(prev => ({ ...prev, [current.id]: true }))}
              />
            ) : (
              <img className="om-mcp-carousel-img" src={current.image} alt={currentText.title} decoding="async" />
            )}
            <div className="om-mcp-carousel-content">
              <div className="om-mcp-carousel-top">
                <div className="om-mcp-carousel-scrim" aria-hidden="true" />
                <h3 className="om-mcp-carousel-title">{currentText.title}</h3>
                <p className="om-mcp-carousel-prompt">
                  <span className="om-mcp-at-brand">@OpenDesign</span>
                  {currentText.prompt}
                </p>
              </div>
              <div className="om-mcp-carousel-bottom">
                <div className="om-mcp-carousel-actions">
                  <Button
                    variant="plain"
                    className="om-mcp-carousel-primary"
                    data-copied={copiedId === current.id || undefined}
                    onClick={() => void handleCopy()}
                  >
                    <RemixIcon name="file-copy-line" size={15} />
                    <span>{t(copiedId === current.id ? 'Copied' : 'Copy instruction')}</span>
                  </Button>
                  <Button
                    variant="plain"
                    className="om-mcp-carousel-secondary"
                    onClick={event => onOpenPreview({
                      id: current.id,
                      title: `${currentText.title} · ${t('Studio editable project preview')}`,
                      image: current.image,
                      video: current.video,
                      showcaseIframe: current.showcaseIframe,
                      target: current.target,
                      prompt: formatMcpAgentPrompt(currentText.prompt, current.target),
                    }, event.currentTarget)}
                  >
                    <span>{t('Try in Studio')}</span>
                    <RemixIcon name="arrow-right-up-line" size={15} />
                  </Button>
                </div>
                <div className="om-mcp-model-pills">
                  {module.models.map(model => (
                    <span key={model.label} className="om-mcp-model-pill">
                      <img src={model.icon} alt="" aria-hidden="true" />
                      <span>{model.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </article>

          <Button
            variant="plain"
            className="om-mcp-carousel-nav om-mcp-carousel-nav-next"
            aria-label={t('Next showcase')}
            onClick={() => step(1)}
          >
            <RemixIcon name="arrow-right-line" size={18} />
          </Button>
        </div>

        <Button
          variant="plain"
          className="om-mcp-carousel-peek om-mcp-carousel-peek-next"
          aria-label={t('Next showcase')}
          onClick={() => step(1)}
        >
          <img key={nextSlide.id} src={nextSlide.image} alt="" decoding="async" />
        </Button>
      </div>
    </div>
  );
}

export function McpFeatureCarousels({
  enabled,
  onCopy,
  onOpenTarget,
}: {
  enabled: boolean;
  onCopy: (slideId: string, prompt: string) => Promise<boolean>;
  onOpenTarget: (target: McpCaseTarget, trigger?: HTMLElement) => void;
}) {
  const { t, locale } = useI18n();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [modalCopied, setModalCopied] = useState(false);
  const [modalVideoFailed, setModalVideoFailed] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);
  const previewContent = mcpGalleryPreview[locale === 'zh-CN' ? 'zh-CN' : 'en'];

  useEffect(() => {
    if (!enabled) setPreview(null);
  }, [enabled]);

  useEffect(() => {
    if (!modalCopied) return;
    const timer = window.setTimeout(() => setModalCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [modalCopied]);

  const targetActionLabel = (target: McpCaseTarget) => {
    if (target.kind === 'skill') return t('Open Skill');
    if (target.kind === 'brand-kit') return t('Open Brand Kits');
    return t('Open template');
  };

  return (
    <section className="om-mcp-section" id="showcase" aria-label={t('Featured MCP capabilities')}>
      <div className="om-mcp-carousel-modules">
        {mcpShowcaseModules.map((module, idx) => (
          <FeatureModuleCarousel
            key={module.id}
            module={module}
            moduleIndex={idx}
            enabled={enabled}
            onCopy={onCopy}
            onOpenPreview={(state, trigger) => {
              triggerRef.current = trigger;
              setModalCopied(false);
              setModalVideoFailed(false);
              setPreview(state);
            }}
          />
        ))}
      </div>

      <Dialog.Root open={enabled && preview !== null} onOpenChange={open => { if (!open) setPreview(null); }}>
        <Dialog.Portal>
          <Dialog.Backdrop forceRender className="hf-overlay-backdrop om-settings-backdrop" />
          <Dialog.Popup data-feedback-modal className="om-dialog om-mcp-demo-dialog" finalFocus={triggerRef} onKeyDown={event => event.stopPropagation()}>
            {preview && (
              <>
                <header>
                  <Dialog.Title>{preview.title}</Dialog.Title>
                  <Dialog.Close render={<Button variant="plain" className="om-mcp-demo-dismiss" />} aria-label={t('Close')}>
                    <RemixIcon name="close-line" size={18} />
                  </Dialog.Close>
                </header>
                <div className="om-mcp-demo-preview">
                  {preview.showcaseIframe ? (
                    <iframe
                      src={preview.showcaseIframe}
                      title={preview.title}
                      sandbox="allow-scripts"
                    />
                  ) : preview.video && !modalVideoFailed ? (
                    <video
                      src={preview.video}
                      poster={preview.image}
                      controls
                      autoPlay
                      muted
                      loop
                      playsInline
                      onError={() => setModalVideoFailed(true)}
                    />
                  ) : (
                    <img src={preview.image} alt="" />
                  )}
                </div>
                <div className="om-mcp-demo-timeline" role="img" aria-label={t('Studio timeline example')}>
                  {previewContent.tracks.map(([track, ...clips], trackIndex) => (
                    <div key={track} data-track={trackIndex}>
                      <span>{track}</span>
                      <div>{clips.map(clip => <span key={clip}>{clip}</span>)}</div>
                    </div>
                  ))}
                </div>
                <div className="om-mcp-demo-prompt">
                  <div><span>{t('Copy for Agent')}</span><span>{previewContent.pasteHint}</span></div>
                  <Dialog.Description>{preview.prompt}</Dialog.Description>
                </div>
                <footer>
                  <Button
                    variant="plain"
                    className="om-mcp-demo-copy"
                    onClick={event => {
                      const target = preview.target;
                      setPreview(null);
                      onOpenTarget(target, event.currentTarget);
                    }}
                  >
                    {targetActionLabel(preview.target)}
                  </Button>
                  <Button
                    variant="plain"
                    className="om-mcp-demo-copy om-mcp-demo-confirm"
                    data-copied={modalCopied || undefined}
                    onClick={() => void onCopy(preview.id, preview.prompt).then(ok => { if (ok) setModalCopied(true); })}
                  >
                    {t(modalCopied ? 'Copied' : 'Copy instruction')}
                  </Button>
                </footer>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
