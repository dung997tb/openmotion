import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { McpCopyFallback } from './McpCopyFallback';
import { formatMcpAgentPrompt, localizedMcpExample, mcpHeroBeats } from './mcpShowcaseData';

function nextBeat(index: number) {
  return (index + 1) % mcpHeroBeats.length;
}

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
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const latestCopy = useRef(0);

  const current = mcpHeroBeats[activeBeat];
  const currentText = localizedMcpExample(current.content, locale, t);
  const reducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const waitsForVideo = current.loop === false && Boolean(current.video) && !videoErrors[current.id];

  useEffect(() => {
    if (!enabled || hovered || reducedMotion || waitsForVideo) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActiveBeat(nextBeat);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [activeBeat, enabled, hovered, reducedMotion, waitsForVideo]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function selectBeat(index: number) {
    latestCopy.current += 1;
    setManualCopy(null);
    setCopied(false);
    setActiveBeat(index);
  }

  async function handleCopy() {
    const attempt = ++latestCopy.current;
    const instruction = formatMcpAgentPrompt(currentText.prompt, current.target);
    const ok = await onCopyPrompt(instruction);
    if (attempt !== latestCopy.current) return;
    setCopied(ok);
    setManualCopy(ok ? null : instruction);
  }

  return (
    <section className="om-mcp-stage-section" aria-label={t('MCP showcase stage')}>
      <div className="om-mcp-stage-layout">
        <div className="om-mcp-stage-steps">
          {mcpHeroBeats.map((beat, index) => {
            const copy = localizedMcpExample(beat.content, locale, t);
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
                  data-fit={beat.fit}
                  aria-hidden={!isActive}
                >
                  {playVideo ? (
                    <video
                      src={beat.video}
                      poster={beat.image}
                      aria-label={localizedMcpExample(beat.content, locale, t).alt}
                      autoPlay
                      muted
                      loop={beat.loop !== false}
                      playsInline
                      preload="metadata"
                      onEnded={beat.loop === false ? () => setActiveBeat(prev => prev === index ? nextBeat(prev) : prev) : undefined}
                      onError={() => setVideoErrors(prev => ({ ...prev, [beat.id]: true }))}
                    />
                  ) : (
                    <img src={beat.image} alt={localizedMcpExample(beat.content, locale, t).alt} decoding="async" />
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
            <Tooltip label={t(copied ? 'Copied' : 'Copy prompt')}>
              <IconButton
                type="button"
                className="om-mcp-stage-prompt-copy"
                aria-label={t('Copy prompt')}
                icon={<RemixIcon name={copied ? 'check-line' : 'file-copy-line'} size={16} />}
                onClick={() => void handleCopy()}
              />
            </Tooltip>
          </div>
          {manualCopy && <McpCopyFallback instruction={manualCopy} />}
        </div>
      </div>
    </section>
  );
}
