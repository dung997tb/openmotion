import { Button } from 'open-design-ui/button';
import { useMemo, useState } from 'react';
import type { ScenarioBundleReceipt, ScenarioStepState } from '../../../../shared/scenario-runs';
import type { PoolKind, ScenarioStepDefinition } from '../../../../shared/scenarios';
import { Checkbox } from '../../components/ui/Checkbox';
import { FilterChip } from '../../components/ui/FilterChip';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { useIntegrationInfo } from '../../motion/useIntegrationInfo';
import { bundleDownloadUrl } from '../scenarioClient';
import type { StepProps } from '../stepContract';
import {
  buildStepAgentPrompt,
  copyText,
  extractErrorMessage,
  formatBytes,
  isScenarioConflictError,
  poolKindIcon,
  poolKindLabel,
  stepStatusLabel,
  triggerUrlDownload,
} from './stepUtils';

const POOL_KIND_ORDER: readonly PoolKind[] = ['image', 'video', 'audio', 'page', 'motion', 'text'];

function effectiveStepStatus(
  stepDef: ScenarioStepDefinition,
  stepState: ScenarioStepState | undefined,
): ScenarioStepState['status'] {
  return stepState?.status ?? (stepDef.type === 'brief' ? 'in-progress' : 'todo');
}

export function ExportHubStep({
  scenario,
  run,
  api,
  pool,
  toast,
  nav,
  renderExportMenu,
}: StepProps) {
  const { t, locale, formatDate } = useI18n();
  const { info: integration } = useIntegrationInfo();

  const contentSteps = useMemo(
    () => scenario.steps.filter(s => s.type !== 'export-hub'),
    [scenario.steps],
  );

  const [activeOnly, setActiveOnly] = useState(true);
  const [includeStandaloneHtml, setIncludeStandaloneHtml] = useState(true);
  const [includeMotionSource, setIncludeMotionSource] = useState(false);
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>(() => contentSteps.map(s => s.id));
  const [building, setBuilding] = useState(false);
  const [downloadingStepId, setDownloadingStepId] = useState<string | null>(null);
  const [lastPackage, setLastPackage] = useState<{ receipt: ScenarioBundleReceipt; builtAt: number } | null>(null);

  // Pool summary counts
  const poolStats = useMemo(() => {
    const byKind: Record<PoolKind, number> = {
      image: 0,
      video: 0,
      audio: 0,
      page: 0,
      motion: 0,
      text: 0,
    };
    let pinned = 0;
    for (const item of pool.items) {
      byKind[item.kind] += 1;
      if (item.pinned) pinned += 1;
    }
    return { byKind, pinned, total: pool.items.length };
  }, [pool.items]);

  // Actionable, non-alarming readiness hints (unstarted steps are already shown in Step overview)
  const readinessNotes = useMemo(() => {
    const list: { key: string; text: string; stepId?: string; actionLabel?: string }[] = [];
    if (pool.items.length === 0 && contentSteps.length > 0) {
      const firstStep = contentSteps[0];
      list.push({
        key: 'empty-pool',
        text: t('Add files, import workspace assets, or generate in any step. Everything you make lands here.'),
        stepId: firstStep.id,
        actionLabel: t('Go to {step}', { step: t(firstStep.title) }),
      });
    }
    for (const stepDef of contentSteps) {
      const stepState = run?.steps[stepDef.id];
      if (stepDef.type === 'web-page' && (stepDef.page?.mode === 'both' || stepDef.page?.mode === 'embed')) {
        const linkedId = stepState?.links.designProjectId
          ?? (stepDef.page.linkedStepId ? run?.steps[stepDef.page.linkedStepId]?.links.designProjectId : undefined);
        const hasEmbeddedImage = Boolean(
          stepState?.iterations.some(iter => iter.design && iter.inputs.length > 0),
        );
        if (linkedId && !hasEmbeddedImage) {
          list.push({
            key: `no-embed:${stepDef.id}`,
            text: t('{step} has no embedded images.', { step: t(stepDef.title) }),
            stepId: stepDef.id,
            actionLabel: t('Open step'),
          });
        }
      }
    }
    return list;
  }, [contentSteps, pool.items.length, run?.steps, t]);

  const toggleStepSelection = (id: string) => {
    setSelectedStepIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  };

  const handleBuildBundle = async () => {
    if (!selectedStepIds.length) {
      toast.showToast(t('Select at least one step to export.'), 'error', 'feedback');
      return;
    }
    setBuilding(true);
    const allStepsSelected = contentSteps.every(stepDef => selectedStepIds.includes(stepDef.id));
    try {
      const res = await api.mutate<{ bundle: ScenarioBundleReceipt }>(
        'export-bundle',
        'export',
        {
          activeOnly,
          includeStandaloneHtml,
          includeMotionSource,
          ...(allStepsSelected ? {} : { stepIds: selectedStepIds }),
        },
      );
      const url = bundleDownloadUrl(res.bundle.bundleId);
      setLastPackage({ receipt: res.bundle, builtAt: Date.now() });
      toast.showToast(
        t('Package ready'),
        'info',
        'feedback',
        {
          key: `download-${res.bundle.bundleId}`,
          label: t('Download'),
          onClick: () => triggerUrlDownload(url, res.bundle.filename),
        },
      );
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not build ZIP package.')), 'error', 'feedback');
      }
    } finally {
      setBuilding(false);
    }
  };

  const handleDownloadStepZip = async (targetStepId: string) => {
    setDownloadingStepId(targetStepId);
    try {
      const res = await api.mutate<{ bundle: ScenarioBundleReceipt }>(
        `export-step:${targetStepId}`,
        'export',
        {
          stepIds: [targetStepId],
          activeOnly: true,
          includeStandaloneHtml: true,
          includeMotionSource: false,
        },
      );
      const url = bundleDownloadUrl(res.bundle.bundleId);
      toast.showToast(
        t('Package ready'),
        'info',
        'feedback',
        {
          key: `download-step-${res.bundle.bundleId}`,
          label: t('Download'),
          onClick: () => triggerUrlDownload(url, res.bundle.filename),
        },
      );
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not export step package.')), 'error', 'feedback');
      }
    } finally {
      setDownloadingStepId(null);
    }
  };

  const handleCopyAgentHandoff = async () => {
    const prompt = buildStepAgentPrompt(scenario, run, { locale, integration });
    const ok = await copyText(prompt);
    toast.showToast(
      ok ? t('Copied. Paste into your Agent.') : t('Could not copy to clipboard.'),
      ok ? 'info' : 'error',
      'feedback',
    );
  };

  const handleCopyManifestJson = async () => {
    const manifest = {
      schema: 'openmotion.scenario-bundle/1',
      scenario: { id: scenario.id, title: scenario.title, category: scenario.category },
      run: run ? { id: run.id, title: run.title, revision: run.revision, locale: run.locale } : null,
      steps: contentSteps.map(stepDef => {
        const st = run?.steps[stepDef.id];
        return {
          id: stepDef.id,
          type: stepDef.type,
          status: effectiveStepStatus(stepDef, st),
          activeIterationId: st?.activeIterationId ?? null,
          iterationCount: st?.iterations.length ?? 0,
          links: st?.links ?? {},
        };
      }),
      pool: pool.items.map(item => ({
        id: item.id,
        kind: item.kind,
        label: item.label,
        source: item.source,
        stepId: item.stepId,
        pinned: item.pinned,
        ref: item.ref,
      })),
    };
    const ok = await copyText(JSON.stringify(manifest, null, 2));
    toast.showToast(
      ok ? t('Manifest JSON copied') : t('Could not copy to clipboard.'),
      ok ? 'info' : 'error',
      'feedback',
    );
  };

  return (
    <div className="om-step-body" data-step-body="export-hub">
      {renderExportMenu()}

      <section className="om-step-card" aria-label={t('Step overview')}>
        <div className="om-step-section-head">
          <div className="om-brief-composer-lead">
            <span className="om-brief-composer-icon" data-tone="brief" aria-hidden="true">
              <RemixIcon name="route-line" size={16} />
            </span>
            <h3 className="om-step-section-title">{t('Step overview')}</h3>
          </div>
          <span className="om-step-muted">
            {t('{total} pool assets · {pinned} pinned', { total: poolStats.total, pinned: poolStats.pinned })}
          </span>
        </div>
        <div className="om-step-overview-grid">
          {contentSteps.map(stepDef => {
            const st = run?.steps[stepDef.id];
            const status = effectiveStepStatus(stepDef, st);
            const activeIter = st?.iterations.find(iter => iter.id === st.activeIterationId) ?? st?.iterations.at(-1);
            const outputCount = activeIter?.outputs.length ?? 0;

            return (
              <div
                key={stepDef.id}
                className="om-step-overview-card"
                data-overview-step={stepDef.id}
                data-step-type={stepDef.type}
              >
                <div className="om-step-overview-head">
                  <span className="om-step-overview-title">
                    <span className="om-step-overview-icon" data-step-type={stepDef.type} aria-hidden="true">
                      <RemixIcon name={stepDef.icon} size={14} />
                    </span>
                    <strong>{t(stepDef.title)}</strong>
                  </span>
                  <span className="om-step-badge" data-status={status}>{t(stepStatusLabel(status))}</span>
                </div>
                <p className="om-step-muted">
                  {activeIter
                    ? t('v{number} · {count} outputs', { number: activeIter.number, count: outputCount })
                    : t('No outputs yet')}
                </p>
                <div className="om-step-overview-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RemixIcon name="arrow-right-up-line" size={14} />}
                    onClick={() => nav.selectStep(stepDef.id)}
                  >
                    {t('Open step')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RemixIcon name="download-2-line" size={14} />}
                    loading={downloadingStepId === stepDef.id}
                    onClick={() => void handleDownloadStepZip(stepDef.id)}
                  >
                    {t('ZIP')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="om-step-card" aria-label={t('Pool summary and readiness')}>
        <div className="om-step-section-head">
          <div className="om-brief-composer-lead">
            <span className="om-brief-composer-icon" data-tone="web-page" aria-hidden="true">
              <RemixIcon name="stack-line" size={16} />
            </span>
            <h3 className="om-step-section-title">{t('Pool summary')}</h3>
          </div>
          <span className="om-step-badge">{t('{count} pinned', { count: poolStats.pinned })}</span>
        </div>
        <div className="om-step-pool-stats">
          {POOL_KIND_ORDER.map(kind => (
            <div key={kind} className="om-step-pool-stat" data-pool-kind={kind}>
              <span className="om-step-pool-stat-icon" data-pool-kind={kind} aria-hidden="true">
                <RemixIcon name={poolKindIcon(kind)} size={13} />
              </span>
              <span>{t(poolKindLabel(kind))}</span>
              <strong>{poolStats.byKind[kind]}</strong>
            </div>
          ))}
        </div>
        {readinessNotes.length > 0 && (
          <div className="om-step-readiness-notes" role="region" aria-label={t('Pool summary and readiness')}>
            {readinessNotes.map(note => (
              <div key={note.key} className="om-step-readiness-row">
                <div className="om-step-readiness-copy">
                  <span className="om-step-readiness-icon" aria-hidden="true">
                    <RemixIcon name="information-line" size={15} />
                  </span>
                  <span>{note.text}</span>
                </div>
                {note.stepId && note.actionLabel && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RemixIcon name="arrow-right-line" size={13} />}
                    onClick={() => nav.selectStep(note.stepId!)}
                  >
                    {note.actionLabel}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="om-step-card" aria-label={t('Full ZIP package')}>
        <div className="om-step-section-head">
          <div className="om-brief-composer-lead">
            <span className="om-brief-composer-icon" data-tone="export-hub" aria-hidden="true">
              <RemixIcon name="download-2-line" size={16} />
            </span>
            <div>
              <h3 className="om-step-section-title">{t('Build full ZIP package')}</h3>
              <p className="om-step-muted">{t('Bundles manifest, brief, web pages with embedded assets, media and social posts.')}</p>
            </div>
          </div>
        </div>

        <div className="om-step-checklist">
          <div className="om-step-check-row">
            <Checkbox
              aria-label={t('Active outputs only')}
              checked={activeOnly}
              onCheckedChange={next => setActiveOnly(Boolean(next))}
            />
            <span className="om-step-check-label" onClick={() => setActiveOnly(prev => !prev)}>{t('Active outputs only')}</span>
          </div>
          <div className="om-step-check-row">
            <Checkbox
              aria-label={t('Standalone HTML')}
              checked={includeStandaloneHtml}
              onCheckedChange={next => setIncludeStandaloneHtml(Boolean(next))}
            />
            <span className="om-step-check-label" onClick={() => setIncludeStandaloneHtml(prev => !prev)}>{t('Standalone HTML')}</span>
          </div>
          <div className="om-step-check-row">
            <Checkbox
              aria-label={t('Include Motion project source')}
              checked={includeMotionSource}
              onCheckedChange={next => setIncludeMotionSource(Boolean(next))}
            />
            <span className="om-step-check-label" onClick={() => setIncludeMotionSource(prev => !prev)}>{t('Include Motion project source')}</span>
            <span className="om-step-muted">{t('Larger download')}</span>
          </div>
        </div>

        <div className="om-step-field">
          <span className="om-step-field-label">{t('Included steps')}</span>
          <div className="om-step-chip-list" role="group" aria-label={t('Included steps')}>
            {contentSteps.map(stepDef => (
              <FilterChip
                key={stepDef.id}
                active={selectedStepIds.includes(stepDef.id)}
                className="om-step-icon-chip"
                data-step-type={stepDef.type}
                onClick={() => toggleStepSelection(stepDef.id)}
              >
                <span className="om-step-chip-icon" data-step-type={stepDef.type} aria-hidden="true">
                  <RemixIcon name={stepDef.icon} size={13} />
                </span>
                <span>{t(stepDef.title)}</span>
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="om-step-actions-end">
          <Button
            variant="primary"
            icon={<RemixIcon name="download-2-line" size={14} />}
            loading={building}
            disabled={selectedStepIds.length === 0}
            onClick={() => void handleBuildBundle()}
          >
            {t('Build ZIP package')}
          </Button>
        </div>

        {lastPackage && (
          <div className="om-step-last-package" data-last-package={lastPackage.receipt.bundleId}>
            <div className="om-step-last-package-info">
              <strong>{lastPackage.receipt.filename}</strong>
              <span className="om-step-muted">
                {formatBytes(lastPackage.receipt.bytes)} · {t('{count} files', { count: lastPackage.receipt.entries })} · {formatDate(lastPackage.builtAt, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <a
              className="om-step-download-link"
              href={bundleDownloadUrl(lastPackage.receipt.bundleId)}
              download={lastPackage.receipt.filename}
            >
              <RemixIcon name="download-2-line" size={14} />
              <span>{t('Download ZIP')}</span>
            </a>
          </div>
        )}
      </section>

      <section className="om-step-card" aria-label={t('Agent handoff')}>
        <div className="om-step-section-head">
          <div className="om-brief-composer-lead">
            <span className="om-brief-composer-icon" data-tone="video" aria-hidden="true">
              <RemixIcon name="robot-line" size={16} />
            </span>
            <div>
              <h3 className="om-step-section-title">{t('Agent handoff')}</h3>
              <p className="om-step-muted">{t('Hand this run and all pinned asset references to an external Agent via MCP.')}</p>
            </div>
          </div>
        </div>
        <div className="om-step-toolbar-group">
          <Button
            variant="secondary"
            size="sm"
            icon={<RemixIcon name="robot-line" size={14} />}
            onClick={() => void handleCopyAgentHandoff()}
          >
            {t('Copy Agent handoff')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RemixIcon name="plug-line" size={14} />}
            onClick={() => nav.openMcp('scenario-black-friday')}
          >
            {t('Open MCP · Connect Agent')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RemixIcon name="braces-line" size={14} />}
            onClick={() => void handleCopyManifestJson()}
          >
            {t('Copy manifest JSON')}
          </Button>
        </div>
      </section>
    </div>
  );
}
