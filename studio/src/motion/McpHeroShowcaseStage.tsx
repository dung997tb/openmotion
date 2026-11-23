import { Button } from 'open-design-ui/button';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { formatMcpAgentPrompt, mcpHeroBeats } from './mcpShowcaseData';

export function McpHeroShowcaseStage({
  enabled,
  onCopyPrompt,
}: {
  enabled: boolean;
  onCopyPrompt: (prompt: string) => Promise<boolean>;
}) {
  const { t, locale } = useI18n();
  const [activeBeat, setActiveBeat] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const current = mcpHeroBeats[activeBeat];
  const currentText = current.content[lang];
  const reducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  useEffect(() => {
    if (!enabled || hovered || reducedMotion) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActiveBeat(prev => (prev + 1) % mcpHeroBeats.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [enabled, hovered, reducedMotion]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    const ok = await onCopyPrompt(formatMcpAgentPrompt(currentText.prompt, current.target));
    if (ok) setCopied(true);
  }

  return (
    <section className="om-mcp-stage-section" aria-label={t('MCP showcase stage')}>
      <div className="om-mcp-stage-layout">
        <div className="om-mcp-stage-steps">
          {mcpHeroBeats.map((beat, index) => {
            const copy = beat.content[lang];
            const isActive = index === activeBeat;
            return (
              <Button
                key={beat.id}
                variant="plain"
                className="om-mcp-stage-step"
                data-active={isActive || undefined}
                aria-pressed={isActive}
                onClick={() => setActiveBeat(index)}
              >
                <span className="om-mcp-stage-step-head">
                  <span className="om-mcp-stage-step-num">{beat.num}</span>
                  <span>{copy.title}</span>
                </span>
                <span className="om-mcp-stage-step-desc">{copy.desc}</span>
              </Button>
            );
          })}
        </div>

        <div
          className="om-mcp-stage-col"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div className="om-mcp-stage-frame">
            {mcpHeroBeats.map((beat, index) => {
              const isActive = index === activeBeat;
              const playVideo = isActive && enabled && !reducedMotion && Boolean(beat.video) && !videoErrors[beat.id];
              return (
                <div
                  key={beat.id}
                  className="om-mcp-stage-slide"
                  data-active={isActive || undefined}
                  aria-hidden={!isActive}
                >
                  {playVideo ? (
                    <video
                      src={beat.video}
                      poster={beat.image}
                      aria-label={beat.content[lang].alt}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      onError={() => setVideoErrors(prev => ({ ...prev, [beat.id]: true }))}
                    />
                  ) : (
                    <img src={beat.image} alt={beat.content[lang].alt} decoding="async" />
                  )}
                </div>
              );
            })}
            <div className="om-mcp-stage-vignette" aria-hidden="true" />
            <div className="om-mcp-stage-dots">
              {mcpHeroBeats.map((beat, index) => (
                <Button
                  key={beat.id}
                  variant="plain"
                  className="om-mcp-beat-dot"
                  data-active={index === activeBeat || undefined}
                  aria-label={t('Showcase step {index}', { index: index + 1 })}
                  onClick={() => setActiveBeat(index)}
                />
              ))}
            </div>
          </div>

          <div className="om-mcp-stage-prompt-bar">
            <span className="om-mcp-stage-prompt-text">
              <span className="om-mcp-at-brand">@OpenDesign</span>
              {currentText.prompt}
            </span>
            <Button
              variant="plain"
              className="om-mcp-stage-prompt-copy"
              data-copied={copied || undefined}
              onClick={() => void handleCopy()}
            >
              {t(copied ? 'Copied' : 'Copy')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
