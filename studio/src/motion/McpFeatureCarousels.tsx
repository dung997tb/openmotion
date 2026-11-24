import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState } from 'react';
import { Tab, TabPanel, Tabs, TabsIndicator, TabsList } from '../components/ui/Tabs';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { McpCopyFallback } from './McpCopyFallback';
import { formatMcpAgentPrompt, localizedMcpExample, mcpShowcaseModules, type McpShowcaseModule, type McpShowcaseSlide } from './mcpShowcaseData';

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
  const { t } = useI18n();
  const moduleTitle = t(module.title);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const latestCopy = useRef(0);
  const slides = module.slides;
  const total = slides.length;
  const current: McpShowcaseSlide = slides[index];
  const prevSlide = slides[(index - 1 + total) % total];
  const nextSlide = slides[(index + 1) % total];
  const currentText = localizedMcpExample(current.content, t);
  const reducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const playVideo = enabled && !reducedMotion && Boolean(current.video) && !videoErrors[current.id];

  useEffect(() => {
    if (!enabled || hovered || keyboardFocus || reducedMotion) return;
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
  }, [enabled, hovered, keyboardFocus, moduleIndex, reducedMotion, total]);

  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  function selectSlide(next: number | ((previous: number) => number)) {
    latestCopy.current += 1;
    setManualCopy(null);
    setIndex(next);
  }

  const step = (delta: number) => selectSlide(prev => (prev + delta + total) % total);

  async function handleCopy() {
    const attempt = ++latestCopy.current;
    const instruction = formatMcpAgentPrompt(currentText.prompt, current.target);
    const ok = await onCopy(current.id, instruction);
    if (attempt !== latestCopy.current) return;
    setCopiedId(ok ? current.id : null);
    setManualCopy(ok ? null : instruction);
  }

  return (
    <Tabs
      value={current.id}
      onValueChange={value => {
        const next = slides.findIndex(slide => slide.id === value);
        if (next >= 0) selectSlide(next);
      }}
      className="om-mcp-carousel-module"
      id={module.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={event => setKeyboardFocus(event.target.matches(':focus-visible'))}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false); }}
    >
      <div className="om-mcp-carousel-head" id={module.anchorId}>
        <h2>{moduleTitle}</h2>
      </div>

      <TabsList className="om-mcp-carousel-tabs bg-transparent p-0" aria-label={moduleTitle}>
        {slides.map(slide => (
          <Tab key={slide.id} value={slide.id} className="om-mcp-carousel-tab">
            <span>{t(slide.content.tabLabel)}</span>
          </Tab>
        ))}
        <TabsIndicator className="om-mcp-tab-indicator" aria-hidden="true" />
      </TabsList>

      <TabPanel value={current.id} className="om-mcp-carousel-viewport">
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
      </TabPanel>
      {manualCopy && <div className="om-mcp-carousel-copy-fallback"><McpCopyFallback instruction={manualCopy} /></div>}
    </Tabs>
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
