import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'open-design-ui/button';
import {
  findScenarioStep,
  scenarioAgentPrompt,
  scenarioRunAgentPrompt,
  type PoolKind,
  type ScenarioStepDefinition,
} from '../../../shared/scenarios';
import type {
  PoolItem,
  PoolRef,
  ScenarioBundleReceipt,
  ScenarioRunSummary,
  ScenarioStepState,
  StepIteration,
} from '../../../shared/scenario-runs';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useIntegrationInfo } from '../motion/useIntegrationInfo';
import { AssetPoolPanel, type PoolPickRequest } from './AssetPoolPanel';
import { IterationHistory } from './IterationHistory';
import { bundleDownloadUrl, scenarioClient } from './scenarioClient';
import { ScenarioHeader } from './ScenarioHeader';
import { ScenarioStepper } from './ScenarioStepper';
import type { ScenarioWorkspaceProps, StepProps } from './stepContract';
import { resolveStepPrompt, StepExportMenu } from './StepExportMenu';
import { StepRouter } from './steps/StepRouter';
import { isScenarioConflictError } from './steps/stepUtils';
import { emptyStepState, useScenarioRun } from './useScenarioRun';
import './scenario.css';

export type { ScenarioWorkspaceProps };

const HIGHLIGHT_DURATION_MS = 1500;

function primarySlotForStep(step: ScenarioStepDefinition, kind: PoolKind): string {
  switch (step.type) {
    case 'image':
      return 'references';
    case 'web-page':
      return 'embedImages';
    case 'video':
      return kind === 'audio' ? 'soundtrack' : 'firstFrame';
    case 'audio':
      return 'script';
    case 'social-pack':
      return 'postMedia';
    default:
      return 'inputs';
  }
}

function StepExportMenuPortal({
  host,
  onMountChange,
  children,
}: {
  host: HTMLElement | null;
  onMountChange: (mounted: boolean) => void;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    onMountChange(true);
    return () => onMountChange(false);
  }, [onMountChange]);

  if (host) {
    return createPortal(children, host);
  }
  return <>{children}</>;
}

export function ScenarioWorkspace({
  scenarioId,
  runId,
  stepId,
  active,
  onRoute,
  onExplore,
  onOpenHub,
  breadcrumb,
  onOpenDesignProject,
  onOpenMotionProject,
  onOpenModelHub,
  onOpenBlackFriday,
  onOpenTemplateLibrary,
  onOpenStudioScene,
  onOpenProviders,
  onOpenMcp,
}: ScenarioWorkspaceProps) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { info: integration } = useIntegrationInfo();

  const [poolOpen, setPoolOpen] = useState(false);
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [pickState, setPickState] = useState<{
    request: PoolPickRequest;
    resolve: (ids: string[] | null) => void;
  } | null>(null);
  const [exportMenuHost, setExportMenuHost] = useState<HTMLDivElement | null>(null);
  const [stepOwnsExportMenu, setStepOwnsExportMenu] = useState(false);

  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pickResolveRef = useRef<((ids: string[] | null) => void) | null>(null);

  const highlight = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setHighlightedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    for (const id of ids) {
      const existing = highlightTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        highlightTimersRef.current.delete(id);
        setHighlightedIds(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, HIGHLIGHT_DURATION_MS);
      highlightTimersRef.current.set(id, timer);
    }
  }, []);

  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pickResolveRef.current?.(null);
      pickResolveRef.current = null;
    };
  }, []);

  const handleRunCreated = useCallback(
    (createdRunId: string, replace = true) => {
      onRoute({ run: createdRunId }, replace);
    },
    [onRoute],
  );

  const runState = useScenarioRun({
    scenarioId,
    runId,
    active,
    locale,
    t,
    onRunCreated: handleRunCreated,
    onToast: toast.showToast,
    onNewPoolItems: highlight,
  });

  const { scenario, run, loading, error, busy, ensureRun, mutate, refresh, startNewRun, reload } = runState;

  const activeStep = useMemo(
    () =>
      findScenarioStep(scenario, stepId) ??
      findScenarioStep(scenario, run?.activeStepId) ??
      scenario.steps[0],
    [run?.activeStepId, scenario, stepId],
  );

  const activeStepIndex = useMemo(
    () => Math.max(0, scenario.steps.findIndex(step => step.id === activeStep.id)),
    [activeStep.id, scenario.steps],
  );

  const activeStepState: ScenarioStepState = useMemo(
    () => run?.steps[activeStep.id] ?? emptyStepState(activeStep),
    [activeStep, run],
  );

  // Cancel any open pick request when switching steps.
  useEffect(() => {
    if (pickResolveRef.current) {
      pickResolveRef.current(null);
      pickResolveRef.current = null;
      setPickState(null);
    }
  }, [activeStep.id]);

  const poolItems = useMemo(() => run?.pool ?? [], [run?.pool]);
  const poolById = useMemo(
    () => new Map(poolItems.map(item => [item.id, item])),
    [poolItems],
  );

  const selectStep = useCallback(
    (nextStepId: string) => {
      onRoute({ run: run?.id ?? runId, step: nextStepId }, false);
    },
    [onRoute, run?.id, runId],
  );

  const loadScenarioRuns = useCallback(() => {
    setRunsLoading(true);
    void scenarioClient
      .list({ scenarioId, limit: 20 })
      .then(res => setScenarioRuns(res.runs ?? []))
      .catch(() => {})
      .finally(() => setRunsLoading(false));
  }, [scenarioId]);

  const handleSelectRun = useCallback(
    (selectedRunId: string) => {
      onRoute({ run: selectedRunId, step: null }, false);
    },
    [onRoute],
  );

  const handleNewRun = useCallback(async () => {
    try {
      await startNewRun();
      toast.showToast(t('Started a new run'), 'info', 'feedback');
    } catch (err) {
      toast.showToast(
        err instanceof Error ? err.message : t('Could not start a new run'),
        'error',
        'feedback',
      );
    }
  }, [startNewRun, t, toast]);

  const handleRenameRun = useCallback(
    async (title: string) => {
      try {
        await mutate('rename-run', 'update_run', { changes: { title } });
        toast.showToast(t('Run renamed'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not rename run'),
            'error',
            'feedback',
          );
        }
      }
    },
    [mutate, t, toast],
  );

  const handleArchiveRun = useCallback(async () => {
    try {
      await mutate('archive-run', 'update_run', { changes: { archived: true } });
      toast.showToast(t('Run archived'), 'info', 'feedback');
      onOpenHub();
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not archive run'),
          'error',
          'feedback',
        );
      }
    }
  }, [mutate, onOpenHub, t, toast]);

  const copyToClipboard = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.showToast(successMessage, 'info', 'feedback');
      } catch {
        toast.showToast(
          t('Could not copy. Select and copy the text manually.'),
          'error',
          'feedback',
        );
      }
    },
    [t, toast],
  );

  const handleCopyAgentHandoff = useCallback(() => {
    const prompt = run
      ? scenarioRunAgentPrompt(scenario, run, { locale, integration })
      : scenarioAgentPrompt(scenario, { locale, integration });
    void copyToClipboard(prompt, t('Copied. Paste into your Agent.'));
  }, [copyToClipboard, integration, locale, run, scenario, t]);

  const handleExportBundleJump = useCallback(() => {
    const exportStep = scenario.steps.find(step => step.type === 'export-hub');
    if (exportStep) {
      selectStep(exportStep.id);
    }
  }, [scenario.steps, selectStep]);

  const handleStatusChange = useCallback(
    async (status: string) => {
      try {
        await mutate(`status:${activeStep.id}`, 'update_step', {
          stepId: activeStep.id,
          status: status as ScenarioStepState['status'],
        });
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not update step status'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, mutate, t, toast],
  );

  const requestPick = useCallback(
    (opts: PoolPickRequest): Promise<string[] | null> => {
      if (pickResolveRef.current) {
        pickResolveRef.current(null);
      }
      setPoolOpen(true);
      return new Promise<string[] | null>(resolve => {
        pickResolveRef.current = resolve;
        setPickState({ request: opts, resolve });
      });
    },
    [],
  );

  const handleConfirmPick = useCallback((ids: string[]) => {
    const resolve = pickResolveRef.current;
    pickResolveRef.current = null;
    setPickState(null);
    resolve?.(ids);
  }, []);

  const handleCancelPick = useCallback(() => {
    const resolve = pickResolveRef.current;
    pickResolveRef.current = null;
    setPickState(null);
    resolve?.(null);
  }, []);

  const handleAddPoolItems = useCallback(
    async (
      items: {
        ref: PoolRef;
        label?: string;
        tags?: string[];
        stepId?: string | null;
        source: PoolItem['source'];
      }[],
    ): Promise<string[]> => {
      const res = await mutate<{ run: typeof run; poolItemIds: string[] }>(
        `add-pool:${Date.now()}`,
        'add_pool',
        { items },
      );
      if (res.poolItemIds?.length) {
        highlight(res.poolItemIds);
      }
      return res.poolItemIds ?? [];
    },
    [highlight, mutate],
  );

  const handleUpdatePoolItem = useCallback(
    async (
      poolItemId: string,
      changes: { label?: string; tags?: string[]; pinned?: boolean },
    ) => {
      await mutate(`update-pool:${poolItemId}`, 'update_pool', {
        poolItemId,
        changes,
      });
    },
    [mutate],
  );

  const handleRemovePoolItem = useCallback(
    async (poolItemId: string) => {
      await mutate(`remove-pool:${poolItemId}`, 'remove_pool', { poolItemId });
    },
    [mutate],
  );

  const handleUseInCurrentStep = useCallback(
    async (item: PoolItem) => {
      const slot = primarySlotForStep(activeStep, item.kind);
      const existing = activeStepState.bindings[slot] ?? [];
      const nextIds =
        slot === 'firstFrame' || slot === 'script'
          ? [item.id]
          : existing.includes(item.id)
            ? existing
            : [...existing, item.id];

      try {
        await mutate(`bind:${activeStep.id}:${slot}`, 'update_step', {
          stepId: activeStep.id,
          bindings: { [slot]: nextIds },
        });
        toast.showToast(
          t('Added to {step}', { step: t(activeStep.title) }),
          'info',
          'feedback',
        );
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not bind asset to step'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep, activeStepState.bindings, mutate, t, toast],
  );

  const handleExportStepPackage = useCallback(async () => {
    try {
      const res = await mutate<{ bundle: ScenarioBundleReceipt }>(
        `export-step:${activeStep.id}`,
        'export',
        { stepIds: [activeStep.id], activeOnly: true },
      );
      const downloadUrl = bundleDownloadUrl(res.bundle.bundleId);
      toast.showToast(
        t('Step package ready'),
        'info',
        'feedback',
        {
          key: `step-bundle-${res.bundle.bundleId}`,
          label: t('Download'),
          onClick: () => {
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = res.bundle.filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
          },
        },
      );
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not build step package'),
          'error',
          'feedback',
        );
      }
    }
  }, [activeStep.id, mutate, t, toast]);

  const handleCopyStepPrompt = useCallback(async () => {
    const prompt = resolveStepPrompt(activeStepState);
    if (!prompt) return;
    await copyToClipboard(prompt, t('Copied prompt'));
  }, [activeStepState, copyToClipboard, t]);

  const handleCopyStepAgentHandoff = useCallback(async () => {
    const prompt = run
      ? scenarioRunAgentPrompt(scenario, run, { stepId: activeStep.id, locale, integration })
      : scenarioAgentPrompt(scenario, { locale, integration });
    await copyToClipboard(prompt, t('Copied. Paste into your Agent.'));
  }, [activeStep.id, copyToClipboard, integration, locale, run, scenario, t]);

  const handlePromoteIteration = useCallback(
    async (iterationId: string) => {
      try {
        await mutate(`promote:${activeStep.id}:${iterationId}`, 'promote', {
          stepId: activeStep.id,
          iterationId,
        });
        toast.showToast(t('Active version updated'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not update active version'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, mutate, t, toast],
  );

  const handleUseIterationSettings = useCallback(
    async (iteration: StepIteration) => {
      try {
        const nextDraft: Record<string, unknown> = {
          ...(iteration.settings ?? {}),
          ...(iteration.prompt !== undefined ? { prompt: iteration.prompt, promptEdited: true } : {}),
        };
        await mutate(`use-settings:${activeStep.id}:${iteration.id}`, 'update_step', {
          stepId: activeStep.id,
          draft: nextDraft,
        });
        toast.showToast(t('Loaded version settings into form'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not apply version settings'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, mutate, t, toast],
  );

  const handleSaveIterationNote = useCallback(
    async (iterationId: string, note: string) => {
      try {
        await mutate(`note:${activeStep.id}:${iterationId}`, 'update_step', {
          stepId: activeStep.id,
          iterationNote: { iterationId, note },
        });
        toast.showToast(t('Note saved'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not save note'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, mutate, t, toast],
  );

  const handleRetryIteration = useCallback(
    async (iteration: StepIteration) => {
      if (!iteration.job) return;
      const settings = iteration.settings ?? {};
      const prompt = iteration.prompt ?? resolveStepPrompt(activeStepState);
      try {
        await mutate(`retry:${activeStep.id}:${iteration.id}:${Date.now()}`, 'generate', {
          stepId: activeStep.id,
          modality: iteration.job.modality,
          model: iteration.job.model,
          prompt,
          ...(typeof settings.mode === 'string' ? { mode: settings.mode } : {}),
          ...(settings.parameters && typeof settings.parameters === 'object'
            ? { parameters: settings.parameters }
            : {}),
          ...(typeof settings.scene === 'string' ? { scene: settings.scene } : {}),
          ...(iteration.inputs.length > 0 ? { referencePoolItemIds: iteration.inputs } : {}),
        });
        toast.showToast(t('Generation started'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not retry generation'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, activeStepState, mutate, t, toast],
  );

  const handleCancelIteration = useCallback(
    async (iterationId: string) => {
      try {
        await mutate(`cancel:${activeStep.id}:${iterationId}`, 'cancel', {
          stepId: activeStep.id,
          iterationId,
        });
        toast.showToast(t('Generation cancelled'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not cancel generation'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, mutate, t, toast],
  );

  const renderExportMenu = useCallback(
    (extraItems?: ReactNode) => (
      <StepExportMenuPortal host={exportMenuHost} onMountChange={setStepOwnsExportMenu}>
        <StepExportMenu
          scenario={scenario}
          step={activeStep}
          state={activeStepState}
          run={run}
          extraItems={extraItems}
          busy={busy.has(`export-step:${activeStep.id}`)}
          onExportStepPackage={handleExportStepPackage}
          onCopyPrompt={handleCopyStepPrompt}
          onCopyStepAgentHandoff={handleCopyStepAgentHandoff}
        />
      </StepExportMenuPortal>
    ),
    [
      activeStep,
      activeStepState,
      busy,
      exportMenuHost,
      handleCopyStepAgentHandoff,
      handleCopyStepPrompt,
      handleExportStepPackage,
      run,
      scenario,
    ],
  );

  const renderIterations = useCallback(
    ({ renderOutput }: { renderOutput(iteration: StepIteration): ReactNode }) => (
      <IterationHistory
        step={activeStep}
        state={activeStepState}
        renderOutput={renderOutput}
        onPromote={handlePromoteIteration}
        onUseSettings={handleUseIterationSettings}
        onSaveNote={handleSaveIterationNote}
        onRetry={handleRetryIteration}
        onCancel={handleCancelIteration}
        busy={busy}
      />
    ),
    [
      activeStep,
      activeStepState,
      busy,
      handleCancelIteration,
      handlePromoteIteration,
      handleRetryIteration,
      handleSaveIterationNote,
      handleUseIterationSettings,
    ],
  );

  const stepApi = useMemo(
    () => ({ ensureRun, mutate, refresh, busy }),
    [busy, ensureRun, mutate, refresh],
  );

  const stepPool = useMemo(
    () => ({ items: poolItems, byId: poolById, requestPick, highlight }),
    [highlight, poolById, poolItems, requestPick],
  );

  const stepToast = useMemo(
    () => ({ showToast: toast.showToast }),
    [toast.showToast],
  );

  const stepNav = useMemo(
    () => ({
      openDesignProject: onOpenDesignProject,
      openMotionProject: onOpenMotionProject,
      openModelHub: onOpenModelHub,
      openBlackFriday: onOpenBlackFriday,
      openTemplateLibrary: onOpenTemplateLibrary,
      openStudioScene: onOpenStudioScene,
      openProviders: onOpenProviders,
      selectStep,
      openMcp: onOpenMcp,
    }),
    [
      onOpenBlackFriday,
      onOpenDesignProject,
      onOpenMcp,
      onOpenModelHub,
      onOpenMotionProject,
      onOpenProviders,
      onOpenStudioScene,
      onOpenTemplateLibrary,
      selectStep,
    ],
  );

  const stepProps: StepProps = {
    scenario,
    step: activeStep,
    state: activeStepState,
    run,
    active,
    api: stepApi,
    pool: stepPool,
    toast: stepToast,
    nav: stepNav,
    renderExportMenu,
    renderIterations,
  };

  const prevStep = activeStepIndex > 0 ? scenario.steps[activeStepIndex - 1] : null;
  const nextStep =
    activeStepIndex < scenario.steps.length - 1 ? scenario.steps[activeStepIndex + 1] : null;

  const statusOptions = useMemo(
    () => [
      { value: 'todo', label: t('To do') },
      { value: 'in-progress', label: t('In progress') },
      { value: 'done', label: t('Done') },
      { value: 'skipped', label: t('Skipped') },
    ],
    [t],
  );

  return (
    <section
      className="om-scenario-workspace"
      data-scenario-workspace={scenario.id}
      data-run-id={run?.id ?? runId ?? ''}
      data-step-id={activeStep.id}
      data-active={active ? 'true' : 'false'}
      aria-label={t(scenario.title)}
    >
      <ScenarioHeader
        scenario={scenario}
        run={run}
        runs={scenarioRuns}
        runsLoading={runsLoading}
        onLoadRuns={loadScenarioRuns}
        onSelectRun={handleSelectRun}
        onNewRun={() => void handleNewRun()}
        onRenameRun={handleRenameRun}
        onArchiveRun={handleArchiveRun}
        onExplore={onExplore}
        onOpenHub={onOpenHub}
        breadcrumb={breadcrumb}
        poolOpen={poolOpen}
        poolCount={poolItems.length}
        onTogglePool={() => setPoolOpen(prev => !prev)}
        onCopyAgentHandoff={handleCopyAgentHandoff}
        onExportBundle={handleExportBundleJump}
        busy={busy}
      />

      <ScenarioStepper
        scenario={scenario}
        run={run}
        activeStepId={activeStep.id}
        onSelectStep={selectStep}
      />

      <div className="om-scenario-body">
        <main className="om-scenario-workbench">
          {loading ? (
            <div className="om-scenario-loading" role="status" aria-label={t('Loading workflow…')}>
              <Skeleton className="om-scenario-skeleton-title" />
              <Skeleton className="om-scenario-skeleton-card" />
              <Skeleton className="om-scenario-skeleton-card" />
            </div>
          ) : error ? (
            <div className="om-scenario-error-panel" role="alert">
              <RemixIcon name="error-warning-line" size={28} />
              <h2 className="om-subtitle">{t('Could not load workflow run')}</h2>
              <p className="om-muted">{error}</p>
              <div className="om-scenario-error-actions">
                <Button variant="primary" size="sm" onClick={reload}>
                  {t('Retry')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void handleNewRun()}>
                  {t('New run')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="om-scenario-step-frame" data-step-frame={activeStep.id}>
              <header className="om-scenario-step-header">
                <div className="om-scenario-step-heading">
                  <div className="om-scenario-step-title-line">
                    <span className="om-scenario-step-badge-icon" aria-hidden="true">
                      <RemixIcon name={activeStep.icon} size={18} />
                    </span>
                    <h2 className="om-scenario-step-title">{t(activeStep.title)}</h2>
                    {activeStep.optional && (
                      <span className="om-badge">{t('Optional')}</span>
                    )}
                  </div>
                  <p className="om-scenario-step-hint">{t(activeStep.hint)}</p>
                </div>

                <div className="om-scenario-step-controls">
                  <div className="om-scenario-status-select">
                    <Select
                      label={t('Step status')}
                      value={activeStepState.status}
                      options={statusOptions}
                      disabled={busy.has(`status:${activeStep.id}`)}
                      onCommit={value => void handleStatusChange(value)}
                    />
                  </div>
                  <div
                    ref={setExportMenuHost}
                    className="om-scenario-step-export-slot"
                  >
                    {!stepOwnsExportMenu && (
                      <StepExportMenu
                        scenario={scenario}
                        step={activeStep}
                        state={activeStepState}
                        run={run}
                        busy={busy.has(`export-step:${activeStep.id}`)}
                        onExportStepPackage={handleExportStepPackage}
                        onCopyPrompt={handleCopyStepPrompt}
                        onCopyStepAgentHandoff={handleCopyStepAgentHandoff}
                      />
                    )}
                  </div>
                </div>
              </header>

              <div className="om-scenario-step-content">
                <StepRouter {...stepProps} />
              </div>

              <footer className="om-scenario-step-footer">
                <div>
                  {prevStep && (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      icon={<RemixIcon name="arrow-left-line" size={14} />}
                      onClick={() => selectStep(prevStep.id)}
                    >
                      {t('Previous: {step}', { step: t(prevStep.title) })}
                    </Button>
                  )}
                </div>
                <div>
                  {nextStep && (
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      onClick={() => selectStep(nextStep.id)}
                    >
                      <span>{t('Next: {step}', { step: t(nextStep.title) })}</span>
                      <RemixIcon name="arrow-right-line" size={14} />
                    </Button>
                  )}
                </div>
              </footer>
            </div>
          )}
        </main>

        <AssetPoolPanel
          scenario={scenario}
          run={run}
          currentStep={activeStep}
          items={poolItems}
          highlightedIds={highlightedIds}
          open={poolOpen}
          onOpenChange={setPoolOpen}
          pickRequest={pickState?.request ?? null}
          onConfirmPick={handleConfirmPick}
          onCancelPick={handleCancelPick}
          onAddItems={handleAddPoolItems}
          onUpdateItem={handleUpdatePoolItem}
          onRemoveItem={handleRemovePoolItem}
          onUseInCurrentStep={handleUseInCurrentStep}
          onOpenDesignProject={onOpenDesignProject}
          onOpenMotionProject={onOpenMotionProject}
          toast={stepToast}
        />
      </div>

      <StudioToastViewport {...toast} />
    </section>
  );
}
