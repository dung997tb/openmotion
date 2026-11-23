import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useState } from 'react';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
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
  const [selectedByUser, setSelectedByUser] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const current = mcpHeroBeats[activeBeat];
  const currentText = current.content[lang];
  const reducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  useEffect(() => {
    if (!enabled || hovered || reducedMotion || selectedByUser) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActiveBeat(prev => (prev + 1) % mcpHeroBeats.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [enabled, hovered, reducedMotion, selectedByUser]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    const ok = await onCopyPrompt(formatMcpAgentPrompt(currentText.prompt, current.target));
    if (ok) setCopied(true);
  }

  function selectBeat(index: number) {
    setSelectedByUser(true);
    setActiveBeat(index);
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
                onClick={() => selectBeat(index)}
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
                      loop={beat.loop !== false}
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
                  onClick={() => selectBeat(index)}
                />
              ))}
            </div>
          </div>

          <div className="om-mcp-stage-prompt-bar">
            <span className="om-mcp-stage-prompt-text">
              <span className="om-mcp-at-brand">@OpenDesign</span>
              {currentText.prompt}
            </span>
            <Tooltip label={t(copied ? 'Copied' : 'Copy')}>
              <IconButton
                type="button"
                className="om-mcp-stage-prompt-copy"
                aria-label={t('Copy')}
                icon={<RemixIcon name={copied ? 'check-line' : 'file-copy-line'} size={16} />}
                onClick={() => void handleCopy()}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </section>
  );
}
