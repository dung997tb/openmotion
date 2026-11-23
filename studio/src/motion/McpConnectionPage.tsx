import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GalleryTemplate } from '../../../shared/catalog';
import { manualConnection, setupGuideUrl, setupPrompt, transcriptExamplePrompt, type IntegrationInfo } from '../../../shared/integration';
import { reviewCommentsPrompt } from '../../../shared/review-comments';
import { findScenario, scenarioAgentPrompt } from '../../../shared/scenarios';
import { findTechniqueStudio } from '../../../shared/studio-catalog';
import { brand, designSystemAsset } from '../../../packages/design-system/index.js';
import { Tabs, TabsList, Tab } from '../components/ui/Tabs';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useCommunityLink } from './CommunityLink';
import { HorizontalRail } from './HorizontalRail';
import { McpClientAvatar } from './McpClientAvatar';
import { McpDeveloperDrawer } from './McpDeveloperDrawer';
import { McpFeatureCarousels } from './McpFeatureCarousels';
import { McpHeroAmbientCanvas } from './McpHeroAmbientCanvas';
import { McpHeroShowcaseStage } from './McpHeroShowcaseStage';
import { McpSiteFooter } from './McpSiteFooter';
import { McpTemplateShowcase } from './McpTemplateShowcase';
import { mcpCapabilities, mcpScenarios, platformExportExample, searchRecoveryExample } from './mcpCapabilities';
import { mcpClients as clients, supportsLocalConnection, type McpClient } from './mcpClients';
import { mcpAdvantagePillars, mcpQuickFaq } from './mcpShowcaseData';
import * as tracking from './pageTracking';
import { SettingsError, SettingsLoading } from './settingsPrimitives';
import { localizedSkillPrompt, motionSkills, skillShotPrompt, studioSkillDefaults } from './skillCatalog';
import { useIntegrationInfo } from './useIntegrationInfo';
import { readWorkspacePage, type WorkspacePage } from './workspacePageRouting';
import type { WorkspaceChrome } from './WorkspaceChromeContext';
import './McpConnectionPage.css';

type PrimaryTabId = 'codex' | 'claude' | 'cursor' | 'deepseek' | 'mcp';

const PRIMARY_TABS: readonly { id: PrimaryTabId; labelKey: string; clientId: McpClient }[] = [
  { id: 'codex', labelKey: 'Codex', clientId: 'codex' },
  { id: 'claude', labelKey: 'Claude', clientId: 'claude' },
  { id: 'cursor', labelKey: 'Cursor', clientId: 'cursor' },
  { id: 'deepseek', labelKey: 'DeepSeek Harness', clientId: 'deepseek' },
  { id: 'mcp', labelKey: 'Other MCP clients', clientId: 'mcp' },
];

const DSH_PLUGIN_URL = 'https://github.com/nexu-io/openmotion/tree/main/integrations/dsh';

function buildCursorDeeplink(info: IntegrationInfo | null): string | null {
  if (!info || info.deployment?.type === 'docker') return null;
  const payload = {
    command: info.transport.command,
    args: info.transport.args,
    env: info.transport.env,
  };
  try {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=openmotion&config=${encodeURIComponent(btoa(binary))}`;
  } catch {
    return null;
  }
}

export function McpConnectionPage({
  openLibrary: openLibraryRaw,
  openProviders: openProvidersRaw,
  previewsEnabled = true,
  route,
  onRouteChange,
  entry = 'direct_link',
  hasProject = false,
  projectId,
  breadcrumb,
  inSettings = false,
}: {
  openLibrary: WorkspaceChrome['openLibrary'];
  openProviders: () => void;
  previewsEnabled?: boolean;
  route?: WorkspacePage;
  onRouteChange?: (patch: Partial<WorkspacePage>) => void;
  entry?: tracking.McpEntry;
  hasProject?: boolean;
  projectId?: string;
  breadcrumb?: ReactNode;
  inSettings?: boolean;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const community = useCommunityLink();
  const { info, failed, retry } = useIntegrationInfo();
  const [manualScenario, setManualScenario] = useState<{ id: string; text: string } | null>(null);
  const [localRoute, setLocalRoute] = useState(() => readWorkspacePage(location.search, location.hash, location.pathname));
  const [pulseTrigger, setPulseTrigger] = useState(0);
  const [nextStepVisible, setNextStepVisible] = useState(false);
  const [nextStepMessage, setNextStepMessage] = useState('');
  const [setupCopied, setSetupCopied] = useState(false);
  const [manualCopied, setManualCopied] = useState(false);

  const { client: clientId, setup: setupMode } = route ?? localRoute;
  const changeRoute = (patch: Partial<WorkspacePage>) => {
    if (onRouteChange) onRouteChange(patch);
    else setLocalRoute(previous => ({ ...previous, ...patch }));
  };
  const setClientId = (nextClient: string) => changeRoute({ client: clients.find(item => item.id === nextClient)?.id ?? 'codex' });
  const client = clients.find(item => item.id === clientId) ?? clients[0];
  const clientKey = client.id as tracking.McpClient;
  const isClaudeGroup = client.id === 'claude' || client.id === 'desktop';
  const activePrimaryTab: PrimaryTabId | 'chatgpt' = client.id === 'desktop' ? 'claude' : client.id;
  const manualOpen = setupMode === 'manual';

  // One page view per opening, with the control that opened it and the client tab it opened on.
  useEffect(() => { tracking.reportMcpPageView(entry, clientKey, hasProject); }, []);

  useEffect(() => {
    if (!setupCopied) return;
    const timer = window.setTimeout(() => setSetupCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [setupCopied]);

  useEffect(() => {
    if (!manualCopied) return;
    const timer = window.setTimeout(() => setManualCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [manualCopied]);

  const click = (
    area: Parameters<typeof tracking.reportMcpClick>[0],
    element: Parameters<typeof tracking.reportMcpClick>[1],
    fields: Parameters<typeof tracking.reportMcpClick>[2] = {},
  ) => tracking.reportMcpClick(area, element, { mcp_client: clientKey, ...fields });

  const openLibrary = (area: 'mcp_start' | 'mcp_templates' | 'mcp_footer') => (trigger?: HTMLElement, template?: GalleryTemplate) => {
    click(area, template ? 'open_detail' : 'open_library', template ? { template: template.id } : {});
    openLibraryRaw(trigger, template);
  };
  const openProviders = (area: 'mcp_resources' | 'mcp_footer') => () => {
    click(area, 'manage_providers');
    openProvidersRaw();
  };
  const docLink = (area: 'mcp_resources' | 'mcp_footer', doc: 'mcp_tools' | 'skills' | 'agent_adapters' | 'docs_home' | 'repository') => () =>
    click(area, 'view_documentation', { doc_id: doc });

  const page = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const example = (route ?? localRoute).mcpExample;

  useEffect(() => {
    const gallery = location.hash === '#gallery' && page.current?.querySelector<HTMLElement>('#mcp-templates');
    if (gallery) {
      gallery.scrollIntoView({ block: 'start' });
      return;
    }
    const card = example && document.getElementById('mcp-example-' + example);
    if (card && page.current?.contains(card)) {
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'center' });
    } else if (!inSettings) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [example, inSettings]);

  const scrollTo = (id: string) => {
    click('mcp_footer', 'scroll_to_section', { section_id: id });
    page.current?.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ block: 'start' });
  };

  const supported = supportsLocalConnection(client);
  const language = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const prompt = setupPrompt(info, client.host, language).replace('MCP / CLI', client.name);
  const manual = info ? manualConnection(info, client.host, language) : '';
  const cursorDeeplink = client.id === 'cursor' ? buildCursorDeeplink(info) : null;

  type CopyReport = {
    kind: Parameters<typeof tracking.reportMcpCopyResult>[0];
    capability?: string;
    template?: string;
    includesSetup?: boolean;
  };

  async function copy(text: string, report: CopyReport) {
    const extra = { setup: setupMode, capability: report.capability, template: report.template, includesSetup: report.includesSetup };
    try {
      await navigator.clipboard.writeText(text);
      toast.showToast(t('Copied to clipboard'), 'info', 'feedback');
      tracking.reportMcpCopyResult(report.kind, 'clipboard_written', clientKey, extra);
      return true;
    } catch {
      toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback');
      tracking.reportMcpCopyResult(report.kind, 'failed', clientKey, extra);
      return false;
    }
  }

  const copyCreation = (text: string, includeSetup: boolean, kind: 'starter' | 'capability_example', capability: string) =>
    copy(includeSetup ? `${prompt}\n\n${t(text)}` : t(text), { kind, capability, includesSetup: includeSetup });

  const copyCapability = async (item: (typeof mcpCapabilities)[number] | (typeof mcpScenarios)[number]) => {
    let instruction: string;
    const studio = findTechniqueStudio(item.id === 'spatial-scene' ? '3d' : item.id);
    if (studio) {
      const skill = motionSkills.find(entryItem => entryItem.id === studio.techniques[0])!;
      instruction = localizedSkillPrompt(skill, studioSkillDefaults(studio.id), locale, setupGuideUrl(info), t) + '\n\n' + t(item.prompt);
    } else if (item.id === 'studio-shot') {
      const explainer = findTechniqueStudio('explainer')!;
      const starterSkill = motionSkills.find(entryItem => entryItem.id === explainer.techniques[0])!;
      instruction = [prompt, t(item.prompt), skillShotPrompt(starterSkill, studioSkillDefaults(explainer.id), t)].join('\n\n');
    } else if (item.id === 'review-comments') {
      instruction = reviewCommentsPrompt({ projectId, dataDirectory: info?.dataDirectory, previewUrl: info?.previewUrl });
    } else if (item.id === 'transcript') {
      instruction = `${prompt}\n\n${transcriptExamplePrompt(info, locale)}`;
    } else if (item.id === 'scenario-black-friday') {
      instruction = `${prompt}\n\n${scenarioAgentPrompt(findScenario('black-friday')!, { locale, integration: info })}`;
    } else if (item.id === 'scenario-workflows' || item.id === 'scenario-agent-writeback') {
      instruction = `${prompt}\n\n${t(item.prompt)}`;
    } else if (item.id === 'anime-opening') {
      instruction = [prompt, t(item.prompt)].join('\n\n');
    } else if (item.id === 'search-recovery') {
      instruction = `${prompt}\n\n${searchRecoveryExample(t)}`;
    } else if (item.id === 'platform-export') {
      instruction = platformExportExample(locale, info ?? undefined);
    } else {
      await copyCreation(item.prompt, item.id !== 'media', 'capability_example', item.id);
      return;
    }
    setManualScenario(null);
    try {
      await navigator.clipboard.writeText(instruction);
      toast.showToast(t('Copied. Paste into your Agent.'), 'info', 'feedback');
      tracking.reportMcpCopyResult('capability_example', 'clipboard_written', clientKey, {
        capability: item.id,
        includesSetup: item.id !== 'platform-export' && item.id !== 'review-comments',
      });
    } catch {
      setManualScenario({ id: item.id, text: instruction });
      toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback');
      tracking.reportMcpCopyResult('capability_example', 'failed', clientKey, {
        capability: item.id,
        includesSetup: item.id !== 'platform-export' && item.id !== 'review-comments',
      });
    }
  };

  function handleSelectPrimaryTab(value: string) {
    const target = PRIMARY_TABS.find(item => item.id === value);
    if (!target) return;
    const nextId: McpClient = target.id === 'claude'
      ? (client.id === 'desktop' ? 'desktop' : 'claude')
      : target.clientId;
    setClientId(nextId);
    setNextStepVisible(false);
    setSetupCopied(false);
    setManualCopied(false);
    setPulseTrigger(n => n + 1);
    click('mcp_client', 'client_tab', { mcp_client: nextId });
  }

  function handleSelectClaudeMode(nextId: 'claude' | 'desktop') {
    if (client.id === nextId) return;
    setClientId(nextId);
    setNextStepVisible(false);
    setSetupCopied(false);
    setManualCopied(false);
    setPulseTrigger(n => n + 1);
    click('mcp_client', 'client_tab', { mcp_client: nextId });
  }

  async function handlePrimaryInstall() {
    if (!supported) return;
    if (cursorDeeplink) {
      const link = document.createElement('a');
      link.href = cursorDeeplink;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      await copy(prompt, { kind: 'connection_instruction' });
      setSetupCopied(true);
      setNextStepMessage(t('Cursor install prompt triggered. If Cursor did not open, click Manual setup to copy the JSON.'));
      setNextStepVisible(true);
      return;
    }
    const ok = await copy(prompt, { kind: 'connection_instruction' });
    if (ok) {
      setSetupCopied(true);
      setNextStepMessage(t('Paste into {agent} to finish setup, then try the first showcase prompt below.', { agent: client.id === 'mcp' ? t('your Agent') : t(client.name) }));
      setNextStepVisible(true);
    }
  }

  function handleToggleManual() {
    const nextSetup = manualOpen ? 'agent' : 'manual';
    click('mcp_setup', 'setup_method', { setup_method: nextSetup });
    changeRoute({ setup: nextSetup });
  }

  const heroClientDisplay = isClaudeGroup
    ? 'Claude'
    : client.id === 'mcp'
      ? t('MCP client')
      : t(client.name);

  const primaryCtaLabel = client.id === 'mcp'
    ? t('Copy Agent setup instruction')
    : t('Install OpenDesign in {agent}', { agent: t(client.name) });

  const galleryClientLabel = (client.id === 'mcp' || t(client.name).length > 11) ? t('Agent') : t(client.name);
  const [heroLine1Before, heroLine1After = ''] = t('In {agent}', { agent: '__AGENT__' }).split('__AGENT__');
  const [heroLine2Before, heroLine2After = ''] = t('Create editable videos with {brand}', { brand: '__BRAND__' }).split('__BRAND__');
  const Container = inSettings ? 'section' : 'main';

  return (
    <Tabs
      value={activePrimaryTab}
      onValueChange={handleSelectPrimaryTab}
      render={
        <Container
          ref={page}
          className="om-mcp-page"
          data-in-settings={inSettings || undefined}
          aria-labelledby="mcp-title"
          onKeyDown={event => event.stopPropagation()}
        />
      }
    >
      {breadcrumb}

      {!inSettings && (
        <div className="om-mcp-entitlement-strip">
          <span className="om-mcp-entitlement-dot" aria-hidden="true" />
          <span>{t('Sign in with your OpenDesign account for built-in models, or bring your own BYOK provider keys.')}</span>
          <Button variant="plain" className="om-mcp-entitlement-cta" onClick={openProviders('mcp_resources')}>
            {t('Manage providers')}
            <RemixIcon name="arrow-right-line" size={14} />
          </Button>
        </div>
      )}

      {/* Full-bleed Hero Ambient Matrix Zone: 5-Tab Client Dock + Spacious H1 + Dual Equal-Height CTA */}
      <div className="om-mcp-ambient-wrap">
        <McpHeroAmbientCanvas pulseTrigger={pulseTrigger} />

        <div className="om-mcp-client-subbar">
          <HorizontalRail label="Agent client" viewportClassName="om-mcp-client-viewport" selection={activePrimaryTab} plainArrows>
            <TabsList className="om-mcp-client-dock" aria-label={t('Agent client')}>
              {PRIMARY_TABS.map(item => {
                const avatarClient = clients.find(entryClient => entryClient.id === item.clientId)!;
                return (
                  <Tab value={item.id} key={item.id} className="om-mcp-client-tab">
                    <span className="om-mcp-client-ico"><McpClientAvatar client={avatarClient} /></span>
                    <span>{t(item.labelKey)}</span>
                  </Tab>
                );
              })}
            </TabsList>
          </HorizontalRail>
        </div>

        <div className="om-mcp-content om-mcp-hero-inner">
          <section className="om-mcp-hero-top" data-claude-sub={isClaudeGroup || undefined} aria-label={t('Agent setup')}>
            <h1 id="mcp-title" ref={heading} tabIndex={-1} className="om-mcp-hero-h1">
              <span className="om-mcp-h1-line">
                {heroLine1Before.trim() ? <span>{heroLine1Before.trim()}</span> : null}
                <span className="om-mcp-h1-logo" aria-hidden="true"><McpClientAvatar client={client} /></span>
                <span className="om-mcp-h1-agent">{heroClientDisplay}</span>
                {heroLine1After.trim() ? <span>{heroLine1After.trim()}</span> : null}
              </span>
              <span className="om-mcp-h1-line">
                {heroLine2Before.trim() ? <span>{heroLine2Before.trim()}</span> : null}
                <span className="om-mcp-h1-logo om-mcp-h1-od" aria-hidden="true">
                  <img src={designSystemAsset(brand.loadingMark)} alt="" />
                </span>
                <span>OpenDesign</span>
                {heroLine2After.trim() ? <span>{heroLine2After.trim()}</span> : null}
              </span>
            </h1>

            {!supported ? (
              <div className="om-card om-mcp-unavailable om-mcp-unavailable-hero">
                <RemixIcon name="information-line" size={28} />
                <h2>{t('Remote connection unavailable')}</h2>
                <p>{t('ChatGPT cloud cannot connect to this local workspace. Choose a local Agent above.')}</p>
                <pre className="om-code-block">{manual}</pre>
                <Button
                  variant="ghost"
                  className="om-button h-auto"
                  onClick={() => {
                    click('mcp_setup', 'use_local_agent');
                    setClientId('codex');
                  }}
                >
                  {t('Use a local Agent')}
                </Button>
              </div>
            ) : (
              <>
                <div className="om-mcp-hero-cta-row">
                  <Button
                    variant="plain"
                    className="om-mcp-btn-primary"
                    aria-label={primaryCtaLabel}
                    data-copied={setupCopied || undefined}
                    onClick={() => void handlePrimaryInstall()}
                  >
                    <span>{setupCopied ? t('Copied to clipboard') : primaryCtaLabel}</span>
                    {!setupCopied && client.id !== 'mcp' && <RemixIcon name="arrow-right-up-line" size={16} />}
                  </Button>
                  <Button
                    variant="plain"
                    className="om-mcp-btn-secondary"
                    aria-expanded={manualOpen}
                    onClick={handleToggleManual}
                  >
                    {t('Manual setup')}
                  </Button>
                </div>

                {isClaudeGroup && (
                  <div className="om-mcp-claude-subbar" role="group" aria-label={t('Choose Claude client')}>
                    <Button
                      variant="plain"
                      className="om-mcp-claude-sub-btn"
                      data-active={client.id === 'claude' || undefined}
                      aria-pressed={client.id === 'claude'}
                      onClick={() => handleSelectClaudeMode('claude')}
                    >
                      {t('Claude Code (Recommended · Full)')}
                    </Button>
                    <Button
                      variant="plain"
                      className="om-mcp-claude-sub-btn"
                      data-active={client.id === 'desktop' || undefined}
                      aria-pressed={client.id === 'desktop'}
                      onClick={() => handleSelectClaudeMode('desktop')}
                    >
                      {t('Claude Desktop')}
                    </Button>
                  </div>
                )}

                {nextStepVisible && (
                  <div className="om-mcp-next-step">
                    <span>{nextStepMessage}</span>
                    <Button
                      variant="plain"
                      className="om-mcp-next-step-go"
                      onClick={() => scrollTo('band-ecom')}
                    >
                      {t('View example prompts ↓')}
                    </Button>
                  </div>
                )}

                {manualOpen && (
                  <div className="om-mcp-manual-pop">
                    {failed ? (
                      <SettingsError retry={retry} />
                    ) : !info ? (
                      <SettingsLoading />
                    ) : (
                      <>
                        <div className="om-mcp-manual-head">
                          <span className="om-mcp-manual-title">
                            {t(
                              client.host === 'mcp'
                                ? 'Merge this configuration into your client’s local MCP settings. Preserve your other servers, then reload the connection.'
                                : 'Run this command in a local terminal, then reload the Agent connection.',
                            )}
                          </span>
                          <Button
                            variant="plain"
                            className="om-mcp-manual-copy"
                            aria-label={t('Copy configuration')}
                            disabled={!manual}
                            onClick={() => void copy(manual, { kind: 'manual_config' }).then(ok => { if (ok) setManualCopied(true); })}
                          >
                            {t(manualCopied ? 'Copied' : 'Copy configuration')}
                          </Button>
                        </div>
                        <pre className="om-mcp-manual-code">{manual}</pre>
                        <div className="om-mcp-manual-footer-actions">
                          <a
                            className="om-mcp-manual-link"
                            href={`/connect/config?host=${client.host}`}
                            download
                            onClick={() => click('mcp_setup', 'download_config', { setup_method: 'manual' })}
                          >
                            {t('Download configuration')}
                          </a>
                          <a
                            className="om-mcp-manual-link"
                            href={setupGuideUrl(info)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => click('mcp_setup', 'connection_guide', { setup_method: 'manual' })}
                          >
                            <span>{t('Connection guide')}</span>
                            <RemixIcon name="arrow-right-up-line" size={14} />
                          </a>
                        </div>
                      </>
                    )}

                    {info?.httpTransport && (
                      <div className="om-mcp-manual-note">
                        <span>
                          <strong>{t('Remote MCP (Streamable HTTP)')}:</strong> <code>{info.httpTransport.url}</code>
                        </span>
                        <Button
                          variant="plain"
                          className="om-mcp-manual-copy"
                          onClick={() => {
                            void navigator.clipboard.writeText(info.httpTransport!.url)
                              .then(() => toast.showToast(t('Copied endpoint URL'), 'info', 'feedback'))
                              .catch(() => toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback'));
                          }}
                        >
                          {t('Copy endpoint URL')}
                        </Button>
                      </div>
                    )}

                    {client.host === 'deepseek' && (
                      <div className="om-mcp-manual-note">
                        <span>{t('Optional: embed the Studio editor right inside DeepSeek Harness with the standalone host plugin (remove the plain MCP entry above first).')}</span>
                        <a href={DSH_PLUGIN_URL} target="_blank" rel="noreferrer">
                          <span>{t('DSH workspace plugin')}</span>
                          <RemixIcon name="arrow-right-up-line" size={14} />
                        </a>
                      </div>
                    )}

                    {client.id === 'desktop' && (
                      <div className="om-mcp-manual-note">
                        <span>{t('Note: Claude Desktop has no local terminal access — keep your local OpenDesign service running before merging this JSON.')}</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {/* Main Content Container */}
      <div className="om-mcp-content">
        {/* Hero Lower: Left 4-Step Rail + Right Visual Stage + Full-Width Prompt Bar */}
        <McpHeroShowcaseStage
          enabled={previewsEnabled}
          onCopyPrompt={text => copy(text, { kind: 'starter', capability: 'hero-stage', includesSetup: false })}
        />

        {/* 3 Higgsfield-Style Centered Cinematic Feature Carousels */}
        <McpFeatureCarousels
          enabled={previewsEnabled}
          openLibrary={openLibrary('mcp_start')}
          onCopy={(slideId, text) => copy(text, { kind: 'capability_example', capability: slideId, includesSetup: false })}
        />

        {/* 12-Card Scenario Template Gallery */}
        <McpTemplateShowcase
          client={galleryClientLabel}
          enabled={previewsEnabled}
          canTry={supported}
          openLibrary={openLibrary('mcp_templates')}
          onCategory={value => click('mcp_templates', 'category_select', { option: value })}
          onPreview={id => click('mcp_templates', 'open_detail', { capability: id })}
          onCopy={async (id, examplePrompt, includeSetup) => {
            const instruction = includeSetup ? `${prompt}\n\n${examplePrompt}` : examplePrompt;
            if (!await copy(instruction, { kind: 'capability_example', capability: id, includesSetup: includeSetup })) return instruction;
          }}
        />

        {/* 3 Advantage Pillar Cards */}
        <section className="om-mcp-section" id="why" aria-labelledby="mcp-why-heading">
          <div className="om-mcp-sec-head">
            <h2 id="mcp-why-heading">{t('Why choose OpenDesign MCP')}</h2>
          </div>
          <div className="om-mcp-pillars">
            {mcpAdvantagePillars.map(pillar => (
              <article key={pillar.num} className="om-mcp-pillar">
                <div className="om-mcp-pillar-num">{pillar.num}</div>
                <h3>{t(pillar.titleKey)}</h3>
                <p>{t(pillar.bodyKey)}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Standalone 6-Item High-Frequency FAQ Accordion */}
        <section className="om-mcp-section" id="mcp-faq" aria-labelledby="mcp-faq-heading">
          <div className="om-mcp-faq-layout">
            <div className="om-mcp-faq-intro">
              <h2 id="mcp-faq-heading">{t('Frequently asked questions')}</h2>
              <p>{t('Quick answers on setup, billing boundaries, local privacy and editable multi-track projects.')}</p>
              <div className="om-mcp-contact">
                <a className="om-text-link" href={community.href} target="_blank" rel="noopener noreferrer" onClick={() => click('mcp_faq', 'community')}>
                  {community.label}
                  <RemixIcon name="arrow-right-line" size={15} />
                </a>
                <a className="om-text-link" href={`https://github.com/nexu-io/openmotion/issues/new/choose`} target="_blank" rel="noreferrer" onClick={() => click('mcp_faq', 'report_issue')}>
                  {t('Report an issue')}
                  <RemixIcon name="arrow-right-up-line" size={14} />
                </a>
              </div>
            </div>

            <div className="om-mcp-faq-acc-list">
              {mcpQuickFaq.map((item, idx) => (
                <details
                  key={item.id}
                  className="om-mcp-faq-acc"
                  onToggle={event => {
                    if (event.currentTarget.open) click('mcp_faq', 'faq_open', { faq_index: idx + 1 });
                  }}
                >
                  <summary>
                    <span>{t(item.questionKey)}</span>
                    <RemixIcon name="arrow-down-s-line" size={18} />
                  </summary>
                  <p className="om-mcp-faq-ans">{t(item.answerKey)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Collapsed Developer Technical Reference Drawer (zero info loss) */}
        <McpDeveloperDrawer
          info={info}
          failed={failed}
          retry={retry}
          supported={supported}
          deepLinkExample={example}
          manualScenario={manualScenario}
          onCopyCapability={copyCapability}
          onOpenProviders={openProviders('mcp_resources')}
          onDocLink={doc => docLink('mcp_resources', doc)()}
          onToggleTools={expanded => click('mcp_capabilities', 'tool_list_open', { expanded })}
          onFaqOpen={faqIndex => click('mcp_faq', 'faq_open', { faq_index: faqIndex })}
        />
      </div>

      {!inSettings && (
        <McpSiteFooter
          community={community}
          onScrollTo={scrollTo}
          onOpenLibrary={openLibrary('mcp_footer')}
          onOpenProviders={openProviders('mcp_footer')}
          onCommunityClick={() => click('mcp_footer', 'community')}
          onDocClick={doc => docLink('mcp_footer', doc)()}
          onReportIssue={() => click('mcp_footer', 'report_issue')}
        />
      )}

      <StudioToastViewport {...toast} />
    </Tabs>
  );
}
