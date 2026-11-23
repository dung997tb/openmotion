import { Button } from 'open-design-ui/button';
import { useEffect, useState } from 'react';
import { canvasPresets } from '../../../shared/composition-canvas';
import { platformExportTargets } from '../../../shared/platform-export';
import type { IntegrationInfo } from '../../../shared/integration';
import { PlatformIcon } from '../../../packages/design-system/react/PlatformIcon';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { GITHUB_REPOSITORY } from './githubRepository';
import { mcpCapabilities, mcpClientComparison, mcpFaq, mcpReviewGuide, mcpScenarios, mcpWorkflowComparison } from './mcpCapabilities';
import { SettingsError } from './settingsPrimitives';

type DevTab = 'tools' | 'compat' | 'privacy' | 'faq';

function ComparisonTable({
  label,
  columns,
  rows,
  featured = false,
}: {
  label: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  featured?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="om-mcp-table-wrap" tabIndex={0} role="region" aria-label={t(label)}>
      <table className="om-mcp-table" data-featured={featured}>
        <thead>
          <tr>{columns.map(column => <th key={column} scope="col">{t(column)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                i === 0
                  ? <th scope="row" key={i}>{t(cell)}</th>
                  : <td key={i}>{featured && i === 1 && <RemixIcon name="check-line" size={16} />}{t(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function McpDeveloperDrawer({
  info,
  failed,
  retry,
  supported,
  deepLinkExample,
  manualScenario,
  onCopyCapability,
  onOpenProviders,
  onDocLink,
  onToggleTools,
  onFaqOpen,
}: {
  info: IntegrationInfo | null;
  failed: boolean;
  retry: () => void;
  supported: boolean;
  deepLinkExample?: string | null;
  manualScenario: { id: string; text: string } | null;
  onCopyCapability: (item: (typeof mcpCapabilities)[number] | (typeof mcpScenarios)[number]) => Promise<void>;
  onOpenProviders: () => void;
  onDocLink: (doc: 'mcp_tools' | 'skills' | 'agent_adapters') => void;
  onToggleTools: (expanded: boolean) => void;
  onFaqOpen: (index: number) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(Boolean(deepLinkExample));
  const [tab, setTab] = useState<DevTab>('tools');

  useEffect(() => {
    if (!deepLinkExample) return;
    setOpen(true);
    setTab('tools');
  }, [deepLinkExample]);

  const docId = (path: string) => (
    path === 'docs/mcp-phase1-tools.md'
      ? 'mcp_tools' as const
      : path === 'docs/skills.md'
        ? 'skills' as const
        : 'agent_adapters' as const
  );

  return (
    <section className="om-mcp-dev-section" id="dev-ref" aria-label={t('Developer technical reference')}>
      <div className="om-mcp-dev-drawer" id="dev-drawer" data-open={open || undefined}>
        <Button
          variant="plain"
          className="om-mcp-dev-toggle"
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setOpen(next);
            onToggleTools(next);
          }}
        >
          <span className="om-mcp-dev-title">
            <span>{t('Developer technical reference')}</span>
            <span className="om-mcp-dev-sub">{t('MCP tool catalog · Client compatibility · Costs & local permissions')}</span>
          </span>
          <span className="om-mcp-dev-chev">
            <span>{t(open ? 'Collapse details' : 'Expand details')}</span>
            <span className="om-mcp-dev-chev-ico" aria-hidden="true">▾</span>
          </span>
        </Button>

        <div className="om-mcp-dev-body" data-open={open || undefined}>
          <div className="om-mcp-dev-tabs" role="tablist" aria-label={t('Developer technical reference')}>
            <Button variant="plain" role="tab" aria-selected={tab === 'tools'} className="om-mcp-dev-tab" data-active={tab === 'tools' || undefined} onClick={() => setTab('tools')}>
              {t('MCP tool catalog')}
            </Button>
            <Button variant="plain" role="tab" aria-selected={tab === 'compat'} className="om-mcp-dev-tab" data-active={tab === 'compat' || undefined} onClick={() => setTab('compat')}>
              {t('Client compatibility')}
            </Button>
            <Button variant="plain" role="tab" aria-selected={tab === 'privacy'} className="om-mcp-dev-tab" data-active={tab === 'privacy' || undefined} onClick={() => setTab('privacy')}>
              {t('Costs & local permissions')}
            </Button>
            <Button variant="plain" role="tab" aria-selected={tab === 'faq'} className="om-mcp-dev-tab" data-active={tab === 'faq' || undefined} onClick={() => setTab('faq')}>
              {t('More troubleshooting Q&A')}
            </Button>
          </div>

          <div className="om-mcp-dev-pane" data-active={tab === 'tools' || undefined} id="mcp-capabilities">
            {info?.tools.length ? (
              <div className="om-mcp-tool-grid">
                {info.tools.map(tool => (
                  <div className="om-mcp-tool-chip" key={tool.name}>
                    <code>{tool.name}</code>
                    <span>
                      {t(
                        tool.name === 'openmotion_assets'
                          ? 'Compatibility name for the original nine asset actions. Use openmotion_assets_use to read media content.'
                          : mcpCapabilities.find(item => (item.tools as readonly string[]).includes(tool.name))?.description || tool.description,
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="om-mcp-dev-subhead">
              <h3>{t('Your visual MCP guide')}</h3>
              <p className="om-muted">{t('Choose a task and copy its example into your connected Agent. Projects and assets stay in your workspace; media generation uses your configured providers.')}</p>
            </div>

            <div className="om-mcp-capability-grid">
              {[...mcpCapabilities, ...mcpScenarios].map(item => (
                <article className="om-mcp-feature" key={item.id} id={'mcp-example-' + item.id} tabIndex={-1} data-mcp-scenario={item.id}>
                  <RemixIcon name={item.icon} size={22} />
                  <h3>{t(item.title)}</h3>
                  {item.id === 'platform-export' && (
                    <div className="flex flex-wrap gap-1.5">
                      {platformExportTargets.map(platform => (
                        <span key={platform.id} title={t(platform.label)}><PlatformIcon platform={platform.id} /></span>
                      ))}
                    </div>
                  )}
                  <p>{t(item.description)}</p>
                  {item.id === 'canvas-captions' && (
                    <p className="om-muted">{t('Aspect ratio')}: {canvasPresets.map(preset => preset.ratio).join(' · ')}</p>
                  )}
                  {item.id === 'review-comments' && (
                    <details className="om-mcp-tool-details w-full" data-review-guide>
                      <summary>{t('Review data and Agent actions')}</summary>
                      <div className="flex flex-col gap-3 pb-4">
                        <div>
                          <h4>{t('Annotation tools')}</h4>
                          <p>{['Freehand pen', 'Rectangle', 'Ellipse', 'Arrow', 'Text label'].map(label => t(label)).join(' · ')}</p>
                        </div>
                        {mcpReviewGuide.map(([title, description]) => (
                          <div key={title}><h4>{t(title)}</h4><p>{t(description)}</p></div>
                        ))}
                      </div>
                    </details>
                  )}
                  {item.id === 'review-comments' && failed && <SettingsError retry={retry} />}
                  <Button
                    variant="plain"
                    className="om-text-link"
                    disabled={!supported || (item.id === 'review-comments' && !info)}
                    onClick={() => void onCopyCapability(item)}
                  >
                    {t('Copy an example')}
                    <RemixIcon name="file-copy-line" size={14} />
                  </Button>
                  {manualScenario?.id === item.id && (
                    <textarea
                      className="om-field w-full"
                      aria-label={t(
                        item.id === 'search-recovery'
                          ? 'Creation instruction'
                          : item.id === 'review-comments'
                            ? 'Review instruction'
                            : item.id === 'platform-export'
                              ? 'Platform export instruction'
                              : 'Complete workflow instruction',
                      )}
                      readOnly
                      rows={6}
                      value={manualScenario.text}
                      onFocus={event => event.currentTarget.select()}
                    />
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="om-mcp-dev-pane" data-active={tab === 'compat' || undefined} id="mcp-clients">
            <ComparisonTable
              label="Client compatibility"
              columns={['Capability', 'Codex / Claude Code / Cursor / DeepSeek', 'Desktop / other MCP clients', 'ChatGPT Cloud']}
              rows={mcpClientComparison}
            />
            <p className="om-mcp-footnote">{t('Support here describes this local installation. Your Agent must expose the tools and resources; media generation also needs an available provider.')}</p>
            <div className="om-mcp-dev-subhead" id="mcp-comparison">
              <h3>{t('Choose the workflow that fits your idea')}</h3>
            </div>
            <ComparisonTable
              label="Workflow comparison"
              columns={['Capability', 'OpenMotion + Agent', 'Direct model API', 'Studio by hand']}
              rows={mcpWorkflowComparison}
              featured
            />
          </div>

          <div className="om-mcp-dev-pane" data-active={tab === 'privacy' || undefined}>
            <div className="om-mcp-policy-grid">
              <div>
                <h3>{t('Costs & limits')}</h3>
                <ul>
                  {[
                    'Connecting does not run a model or start a render. Agent subscriptions and media-provider charges are separate.',
                    'Generation depends on provider access, model support and available quota. There is no universal free-generation allowance or fixed completion time.',
                    'Use the same generation or export job to check progress. Cancellation depends on the task and provider; it does not guarantee a refund.',
                  ].map(text => <li key={text}>{t(text)}</li>)}
                </ul>
                <Button variant="ghost" className="om-button h-auto" onClick={onOpenProviders}>
                  <RemixIcon name="sparkling-line" size={16} />
                  {t('Manage providers')}
                </Button>
              </div>
              <div>
                <h3>{t('Privacy & permissions')}</h3>
                <ul>
                  {[
                    'The local Agent receives access to workspace tools. Keep your existing MCP servers and connect the correct installation.',
                    'Provider credentials are stored outside projects and injected by the local service. Never paste API keys into a conversation.',
                    'Cloud generation sends the required prompt and reference material to the selected provider. Projects and local exports remain in your workspace.',
                  ].map(text => <li key={text}>{t(text)}</li>)}
                </ul>
              </div>
            </div>

            <div className="om-mcp-capability-grid om-mcp-dev-docs" id="mcp-connections">
              {([
                ['plug-line', 'MCP', 'MCP connects compatible Agents to your local workspace. Use the same tools to create and edit projects, discover templates and import assets.', 'docs/mcp-phase1-tools.md'],
                ['file-text-line', 'Production Skills', 'Give your Agent the creative workflow, reference guides and verification rules. Installed Skills and MCP resources share the maintained guidance.', 'docs/skills.md'],
                ['code-s-slash-line', 'Local API & CLI', 'For local development and automation. Use the documented application boundary and project safeguards; no hosted public API is provided here.', 'docs/agent-adapters.md'],
              ] as const).map(([icon, title, body, doc]) => (
                <article className="om-mcp-feature" key={title}>
                  <RemixIcon name={icon} size={22} />
                  <h3>{t(title)}</h3>
                  <p>{t(body)}</p>
                  <a
                    className="om-text-link"
                    href={`${GITHUB_REPOSITORY}/blob/main/${doc}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => onDocLink(docId(doc))}
                  >
                    {t('Documentation')}
                    <RemixIcon name="external-link-line" size={14} />
                  </a>
                </article>
              ))}
            </div>
          </div>

          <div className="om-mcp-dev-pane om-mcp-faq" data-active={tab === 'faq' || undefined}>
            <div className="om-mcp-dev-faq-list">
              {mcpFaq.map(([question, answer], index) => (
                <details
                  key={question}
                  className="om-mcp-faq-acc"
                  onToggle={event => {
                    if (event.currentTarget.open) onFaqOpen(index + 1);
                  }}
                >
                  <summary>
                    <span>{t(question)}</span>
                    <RemixIcon name="arrow-down-s-line" size={18} />
                  </summary>
                  <p className="om-mcp-faq-ans">{t(answer)}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
