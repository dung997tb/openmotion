import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { Tabs, TabsList, Tab, TabPanel } from '../components/ui/Tabs';
import { RemixIcon } from '../icons/RemixIcons';
import { mcpGalleryCards, mcpGalleryCategories, mcpGalleryPreview, type McpGalleryCard, type McpGalleryCategory } from './mcpGallery';
import { formatMcpAgentPrompt, type McpCaseTarget } from './mcpShowcaseData';

function cardTarget(card: McpGalleryCard, title: string): McpCaseTarget | null {
  if (card.kind === 'template' && card.templateId) {
    return { kind: 'template', templateId: card.templateId, title, posterUrl: card.image, previewUrl: card.video ?? '' };
  }
  if (card.kind === 'skill' && card.skillId) {
    return { kind: 'skill', skillId: card.skillId };
  }
  if (card.kind === 'brand-kit' && card.brandKitId && card.showcaseIframe) {
    return { kind: 'brand-kit', brandKitId: card.brandKitId, showcaseUrl: card.showcaseIframe };
  }
  return null;
}

export function McpTemplateShowcase({ client, enabled, canTry, onCopy, openLibrary, onOpenTarget, onCategory, onPreview }: {
  client: string;
  enabled: boolean;
  canTry: boolean;
  onCopy: (id: string, prompt: string, includeSetup: boolean) => Promise<string | undefined>;
  openLibrary: (trigger: HTMLElement) => void;
  onOpenTarget: (target: McpCaseTarget, trigger?: HTMLElement) => void;
  onCategory: (category: McpGalleryCategory) => void;
  onPreview: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState<McpGalleryCategory>('all');
  const [preview, setPreview] = useState<McpGalleryCard | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<{ id: string; instruction: string } | null>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const latestCopy = useRef(0);
  const content = (card: McpGalleryCard) => card.content[locale] ?? card.content.en;
  const previewContent = mcpGalleryPreview[locale === 'zh-CN' ? 'zh-CN' : 'en'];
  const visible = mcpGalleryCards.filter(card => category === 'all' || card.category === category);
  const reducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  const kindLabel = (kind: McpGalleryCard['kind']) => {
    if (kind === 'skill') return t('Skill');
    if (kind === 'brand-kit') return t('Brand Kit');
    return t('Template');
  };

  const openActionLabel = (kind: McpGalleryCard['kind']) => {
    if (kind === 'skill') return t('Open Skill');
    if (kind === 'brand-kit') return t('Open Brand Kits');
    return t('Open template');
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!enabled) setPreview(null);
  }, [enabled]);

  async function copyPrompt(card: McpGalleryCard, includeSetup = false) {
    const attempt = ++latestCopy.current;
    setCopied(null);
    setManualCopy(null);
    const target = cardTarget(card, content(card).title);
    const failedInstruction = await onCopy(card.id, formatMcpAgentPrompt(content(card).prompt, target), includeSetup);
    if (attempt !== latestCopy.current) return;
    if (failedInstruction) setManualCopy({ id: card.id, instruction: failedInstruction });
    else setCopied(card.id);
  }

  const copyFallback = (card: McpGalleryCard) => manualCopy?.id === card.id &&
    <textarea className="om-field w-full" aria-label={t('Creation instruction')} readOnly rows={5}
      value={manualCopy.instruction} onFocus={event => event.currentTarget.select()} />;

  return <section className="om-mcp-section om-mcp-demo-gallery" aria-labelledby="mcp-templates" id="gallery">
    <h2 id="mcp-templates">{t('Explore more scene templates')}</h2>
    <Tabs value={category} onValueChange={value => {
      const selected = mcpGalleryCategories.find(([key]) => key === value)?.[0];
      if (!selected) return;
      setCategory(selected);
      onCategory(selected);
    }}>
      <TabsList className="om-mcp-category-tabs" aria-label={t('Template categories')}>
        {mcpGalleryCategories.map(([value, label]) => <Tab key={value} value={value}>
          {t(label)}{' '}{value === 'all' ? mcpGalleryCards.length : '(' + mcpGalleryCards.filter(card => card.category === value).length + ')'}
        </Tab>)}
      </TabsList>
      <TabPanel value={category}>
        <div className="om-mcp-template-grid">
          {visible.map(card => {
            const playHoverVideo = enabled && !reducedMotion && hoveredCard === card.id && Boolean(card.video) && !videoErrors[card.id];
            return <article
              key={card.id}
              className="om-mcp-demo-card"
              data-mcp-gallery-card={card.id}
              onMouseEnter={() => setHoveredCard(card.id)}
              onMouseLeave={() => setHoveredCard(prev => (prev === card.id ? null : prev))}
            >
              <Button variant="plain" className="om-mcp-demo-cover" aria-label={t('Preview template {title}', { title: content(card).title })}
                onClick={event => {
                  previewTrigger.current = event.currentTarget;
                  setPreview(card);
                  onPreview(card.id);
                }}>
                {playHoverVideo ? (
                  <video
                    src={card.video}
                    poster={card.image}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onError={() => setVideoErrors(prev => ({ ...prev, [card.id]: true }))}
                  />
                ) : (
                  <img src={card.image} alt="" loading="lazy" decoding="async" />
                )}
                <span className="om-mcp-demo-shade" />
                <span className="om-mcp-demo-kind">{kindLabel(card.kind)}</span>
                <span className="om-mcp-demo-duration">{card.duration}</span>
                <span className="om-mcp-demo-play" aria-hidden="true">▶</span>
              </Button>
              <div className="om-mcp-template-caption">
                <h3>{content(card).title}</h3>
                <p title={content(card).prompt}>{content(card).prompt}</p>
                <div className="om-mcp-demo-actions">
                  <Button variant="plain" className="om-mcp-demo-copy" data-copied={copied === card.id || undefined} onClick={() => void copyPrompt(card)}>
                    {t(copied === card.id ? 'Copied' : 'Copy example prompt')}
                  </Button>
                  <Button variant="plain" className="om-mcp-demo-try" disabled={!canTry} onClick={() => void copyPrompt(card, true)}>
                    {t('Try in {client}', { client })}
                  </Button>
                </div>
                {!preview && copyFallback(card)}
              </div>
            </article>;
          })}
        </div>
      </TabPanel>
    </Tabs>
    <div className="om-mcp-gallery-more">
      <Button variant="plain" className="om-mcp-demo-library" onClick={event => openLibrary(event.currentTarget)}>
        <span>{t('All 30+ templates')}</span>
        <RemixIcon name="arrow-right-line" size={16} />
      </Button>
    </div>
    <Dialog.Root open={enabled && preview !== null} onOpenChange={open => { if (!open) setPreview(null); }}>
      <Dialog.Portal>
        <Dialog.Backdrop forceRender className="hf-overlay-backdrop om-settings-backdrop" />
        <Dialog.Popup data-feedback-modal className="om-dialog om-mcp-demo-dialog" finalFocus={previewTrigger} onKeyDown={event => event.stopPropagation()}>
          {preview && <>
            <header>
              <Dialog.Title>{content(preview).title}</Dialog.Title>
              <Dialog.Close render={<Button variant="plain" className="om-mcp-demo-dismiss" />} aria-label={t('Close')}><RemixIcon name="close-line" size={18} /></Dialog.Close>
            </header>
            <div className="om-mcp-demo-preview">
              {preview.showcaseIframe ? (
                <iframe
                  src={preview.showcaseIframe}
                  title={content(preview).title}
                  sandbox="allow-scripts"
                />
              ) : preview.video && !videoErrors[preview.id] ? (
                <video
                  src={preview.video}
                  poster={preview.image}
                  controls
                  autoPlay
                  muted
                  loop
                  playsInline
                  onError={() => setVideoErrors(prev => ({ ...prev, [preview.id]: true }))}
                />
              ) : (
                <img src={preview.image} alt="" />
              )}
            </div>
            <div className="om-mcp-demo-timeline" role="img" aria-label={t('Studio timeline example')}>
              {previewContent.tracks.map(([track, ...clips], index) => <div key={track} data-track={index}>
                <span>{track}</span><div>{clips.map(clip => <span key={clip}>{clip}</span>)}</div>
              </div>)}
            </div>
            <div className="om-mcp-demo-prompt">
              <div><span>{t('Copy for Agent')}</span><span>{previewContent.pasteHint}</span></div>
              <Dialog.Description>{content(preview).prompt}</Dialog.Description>
            </div>
            {copyFallback(preview)}
            <footer>
              {(() => {
                const target = cardTarget(preview, content(preview).title);
                return target ? (
                  <Button
                    variant="plain"
                    className="om-mcp-demo-copy"
                    onClick={event => {
                      setPreview(null);
                      onOpenTarget(target, event.currentTarget);
                    }}
                  >
                    {openActionLabel(preview.kind)}
                  </Button>
                ) : null;
              })()}
              <Dialog.Close render={<Button variant="plain" className="om-mcp-demo-copy" />}>{t('Close')}</Dialog.Close>
              <Button variant="plain" className="om-mcp-demo-copy om-mcp-demo-confirm" data-copied={copied === preview.id || undefined} onClick={() => void copyPrompt(preview)}>
                {t(copied === preview.id ? 'Copied' : 'Copy Prompt')}
              </Button>
            </footer>
          </>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
