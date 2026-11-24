import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { Tabs, TabsList, Tab, TabPanel } from '../components/ui/Tabs';
import { RemixIcon } from '../icons/RemixIcons';
import { McpCopyFallback } from './McpCopyFallback';
import { mcpGalleryCards, mcpGalleryCategories, recordMcpGalleryPosition, type McpGalleryCard, type McpGalleryCategory } from './mcpGallery';
import { formatMcpAgentPrompt, localizedMcpExample, type McpCaseTarget } from './mcpShowcaseData';

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

export function McpTemplateShowcase({ enabled, initialCategory, onCopy, openLibrary, onOpenTarget, onCategory, onPreview }: {
  enabled: boolean;
  initialCategory: McpGalleryCategory;
  onCopy: (id: string, prompt: string) => Promise<boolean>;
  openLibrary: (trigger: HTMLElement) => void;
  onOpenTarget: (target: Exclude<McpCaseTarget, { kind: 'template' }>) => void;
  onCategory: (category: McpGalleryCategory) => void;
  onPreview: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState(initialCategory);
  const [preview, setPreview] = useState<McpGalleryCard | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const [copiedCardId, setCopiedCardId] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<{ id: string; instruction: string } | null>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const latestCopy = useRef(0);
  const content = (card: McpGalleryCard) => localizedMcpExample(card.content, locale, t);
  const visible = mcpGalleryCards.filter(card => category === 'all' || card.category === category);
  const reducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  const kindLabel = (kind: McpGalleryCard['kind']) => {
    if (kind === 'skill') return t('Skill');
    if (kind === 'brand-kit') return t('Brand Kit');
    return t('Template');
  };

  useEffect(() => {
    if (!copiedCardId) return;
    const timer = setTimeout(() => setCopiedCardId(null), 1600);
    return () => clearTimeout(timer);
  }, [copiedCardId]);

  useEffect(() => {
    if (!enabled) setPreview(null);
  }, [enabled]);

  async function copyPrompt(card: McpGalleryCard) {
    const attempt = ++latestCopy.current;
    setCopiedCardId(null);
    setManualCopy(null);
    const target = cardTarget(card, content(card).title);
    const instruction = formatMcpAgentPrompt(content(card).prompt, target);
    const copied = await onCopy(card.id, instruction);
    if (attempt !== latestCopy.current) return;
    if (copied) setCopiedCardId(card.id);
    else setManualCopy({ id: card.id, instruction });
  }

  const copyFallback = (card: McpGalleryCard) => manualCopy?.id === card.id &&
    <McpCopyFallback instruction={manualCopy.instruction} />;

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
            const copiedPrompt = copiedCardId === card.id;
            const playHoverVideo = enabled && !reducedMotion && hoveredCard === card.id && Boolean(card.video) && !videoErrors[card.id];
            return <article
              key={card.id}
              className="om-mcp-demo-card"
              data-mcp-gallery-card={card.id}
              onMouseEnter={() => setHoveredCard(card.id)}
              onMouseLeave={() => setHoveredCard(prev => (prev === card.id ? null : prev))}
            >
              <Button variant="plain" className="om-mcp-demo-cover" aria-label={t('Preview {title}', { title: content(card).title })}
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
              </Button>
              <div className="om-mcp-template-caption">
                <h3>{content(card).title}</h3>
                <p title={content(card).prompt}>{content(card).prompt}</p>
                <div className="om-mcp-demo-actions">
                  <Button variant="plain" className="om-mcp-demo-copy" data-copied={copiedPrompt || undefined} onClick={() => void copyPrompt(card)}>
                    {t(copiedPrompt ? 'Copied' : 'Copy example prompt')}
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
              <Dialog.Close render={<IconButton
                variant="plain"
                className="om-mcp-demo-dismiss inline-grid shrink-0 place-items-center"
                aria-label={t('Close')}
                icon={<RemixIcon name="close-line" size={18} />}
              />} />
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
            <div className="om-mcp-demo-prompt">
              <div><span>{t('Copy for Agent')}</span></div>
              <Dialog.Description>{content(preview).prompt}</Dialog.Description>
            </div>
            {copyFallback(preview)}
            <footer>
              {(() => {
                const target = cardTarget(preview, content(preview).title);
                return target && target.kind !== 'template' ? (
                  <Button
                    variant="plain"
                    className="om-mcp-demo-copy"
                    onClick={() => {
                      recordMcpGalleryPosition({ category, cardId: preview.id });
                      setPreview(null);
                      onOpenTarget(target);
                    }}
                  >
                    {target.kind === 'skill' ? t('Open Skill') : t('Browse Brand Kits')}
                  </Button>
                ) : null;
              })()}
              <Button variant="plain" className="om-mcp-demo-copy om-mcp-demo-confirm" data-copied={copiedCardId === preview.id || undefined} onClick={() => void copyPrompt(preview)}>
                {t(copiedCardId === preview.id ? 'Copied' : 'Copy Prompt')}
              </Button>
            </footer>
          </>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
