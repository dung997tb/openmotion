import { Button } from 'open-design-ui/button';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { formatMcpAgentPrompt, mcpShowcaseModules, type McpShowcaseModule, type McpShowcaseSlide } from './mcpShowcaseData';

function FeatureModuleCarousel({
  module,
  moduleIndex,
  enabled,
  onCopy,
}: {
  module: McpShowcaseModule;
  moduleIndex: number;
  enabled: boolean;
  onCopy: (slideId: string, prompt: string) => Promise<boolean>;
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
}: {
  enabled: boolean;
  onCopy: (slideId: string, prompt: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
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
          />
        ))}
      </div>
    </section>
  );
}
