import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useMemo, useState } from 'react';
import { assetMediaUrl } from '../../../../shared/asset-library';
import type { PoolItem, ScenarioRun, ScenarioStepState } from '../../../../shared/scenario-runs';
import type { ScenarioDefinition, ScenarioStepDefinition } from '../../../../shared/scenarios';
import { Select } from '../../components/ui';
import { FilterChip } from '../../components/ui/FilterChip';
import { FieldTextarea } from '../../components/ui/FormField';
import { Skeleton } from '../../components/ui/Skeleton';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { useIntegrationInfo } from '../../motion/useIntegrationInfo';
import { useMediaCatalog } from '../../motion/useMediaCatalog';
import { ScenarioApiError } from '../scenarioClient';
import type { StepProps } from '../stepContract';
import { countStepPendingJobs } from '../useScenarioRun';
import {
  briefStringValue,
  buildStepAgentPrompt,
  copyText,
  extractErrorMessage,
  isScenarioConflictError,
} from './stepUtils';

export type StepCapabilityBarProps = {
  scenario: ScenarioDefinition;
  step: ScenarioStepDefinition;
  state: ScenarioStepState;
  run: ScenarioRun | null;
  active: boolean;
  api: StepProps['api'];
  pool: StepProps['pool'];
  toast: StepProps['toast'];
  nav: StepProps['nav'];
  stepPrompt?: string;
  allowQuickMedia?: boolean;
  defaultModality?: 'image' | 'video';
  onAfterSync?: () => Promise<void> | void;
};

export function StepCapabilityBar({
  scenario,
  step,
  state,
  run,
  active,
  api,
  pool,
  toast,
  nav,
  stepPrompt,
  allowQuickMedia = false,
  defaultModality = 'image',
  onAfterSync,
}: StepCapabilityBarProps) {
  const { t, locale } = useI18n();
  const { info: integration } = useIntegrationInfo();

  const [quickOpen, setQuickOpen] = useState(false);
  const [modality, setModality] = useState<'image' | 'video'>(defaultModality);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [promptTouched, setPromptTouched] = useState(false);
  const [providerUnavailable, setProviderUnavailable] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copyingMcp, setCopyingMcp] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fallbackPrompt = useMemo(() => {
    const explicit = stepPrompt?.trim();
    if (explicit) return explicit;
    if (!run?.brief) return '';
    return [
      briefStringValue(run.brief, 'productName'),
      briefStringValue(run.brief, 'personaName'),
      briefStringValue(run.brief, 'concept'),
      briefStringValue(run.brief, 'idea'),
      briefStringValue(run.brief, 'visualStyle'),
    ]
      .filter(Boolean)
      .join(' — ');
  }, [run?.brief, stepPrompt]);

  const [quickPrompt, setQuickPrompt] = useState(fallbackPrompt);

  useEffect(() => {
    setQuickOpen(false);
    setModality(defaultModality);
    setRefIds([]);
    setPromptTouched(false);
    setProviderUnavailable(false);
  }, [step.id, defaultModality]);

  useEffect(() => {
    if (!promptTouched) {
      setQuickPrompt(fallbackPrompt);
    }
  }, [fallbackPrompt, promptTouched]);

  const { catalog, failed: catalogFailed, retry: retryCatalog } = useMediaCatalog(
    allowQuickMedia && active && quickOpen,
  );

  const availableModels = useMemo(() => {
    if (!catalog) return [];
    const availableProviders = new Set(
      catalog.status.providers.filter(p => p.available).map(p => p.id),
    );
    return catalog.models.filter(
      model => model.modality === modality && availableProviders.has(model.provider),
    );
  }, [catalog, modality]);

  const defaultModelId = useMemo(() => {
    if (!availableModels.length) return '';
    const routeModel = catalog?.status.routes[modality];
    if (routeModel && availableModels.some(m => m.id === routeModel)) return routeModel;
    const capModel = catalog?.status.capabilities.find(c => c.modality === modality)?.selectedModelId;
    if (capModel && availableModels.some(m => m.id === capModel)) return capModel;
    return availableModels[0].id;
  }, [availableModels, catalog?.status, modality]);

  const [selectedModelId, setSelectedModelId] = useState(defaultModelId);
  useEffect(() => {
    if (!availableModels.some(m => m.id === selectedModelId)) {
      setSelectedModelId(defaultModelId);
    }
  }, [availableModels, selectedModelId, defaultModelId]);

  useEffect(() => {
    if (availableModels.length > 0) {
      setProviderUnavailable(false);
    }
  }, [availableModels.length]);

  const selectedModel = useMemo(
    () => availableModels.find(m => m.id === selectedModelId) ?? availableModels[0],
    [availableModels, selectedModelId],
  );

  const refItems = useMemo(
    () =>
      refIds
        .map(id => pool.byId.get(id))
        .filter((item): item is PoolItem => Boolean(item)),
    [pool.byId, refIds],
  );
  const activeRefIds = useMemo(() => refItems.map(item => item.id), [refItems]);

  const pendingJobs = countStepPendingJobs(state);
  const noProvider = (catalog !== undefined && availableModels.length === 0) || providerUnavailable;

  const resolvedStepPrompt = (promptTouched ? quickPrompt.trim() : '') || fallbackPrompt;

  const handleToggleQuick = () => {
    setQuickOpen(prev => {
      const next = !prev;
      if (next && !promptTouched) {
        setQuickPrompt(fallbackPrompt);
      }
      return next;
    });
  };

  const handleCopyMcp = async () => {
    setCopyingMcp(true);
    try {
      let ensuredRun = run;
      if (!ensuredRun) {
        try {
          ensuredRun = await api.ensureRun();
        } catch {
          ensuredRun = null;
        }
      }
      const promptText = buildStepAgentPrompt(scenario, ensuredRun, {
        stepId: step.id,
        stepPrompt: resolvedStepPrompt || undefined,
        locale,
        integration,
      });
      const ok = await copyText(promptText);
      toast.showToast(
        ok
          ? t('Copied MCP prompt. Paste into your Agent to write assets back into this step.')
          : t('Could not copy to clipboard.'),
        ok ? 'info' : 'error',
        'feedback',
      );
    } finally {
      setCopyingMcp(false);
    }
  };

  const handleSync = async () => {
    if (!run) return;
    setSyncing(true);
    try {
      await api.refresh();
      await onAfterSync?.();
      toast.showToast(t('Synced latest assets'), 'info', 'feedback');
    } finally {
      setSyncing(false);
    }
  };

  const handlePickReference = async () => {
    const picked = await pool.requestPick({
      slot: 'quickReference',
      kinds: ['image'],
      max: 1,
      selected: activeRefIds,
    });
    if (picked) {
      setRefIds(picked.slice(0, 1));
    }
  };

  const handleQuickGenerate = async () => {
    const trimmed = quickPrompt.trim();
    if (!selectedModel || !trimmed) return;
    setGenerating(true);
    try {
      await api.mutate(`quick-gen:${step.id}:${modality}`, 'generate', {
        stepId: step.id,
        modality,
        model: selectedModel.id,
        prompt: trimmed,
        ...(activeRefIds.length ? { referencePoolItemIds: activeRefIds } : {}),
      });
      toast.showToast(
        t('Generation started. New assets will appear in Shared assets.'),
        'info',
        'feedback',
      );
    } catch (error) {
      if (error instanceof ScenarioApiError && error.code === 'PROVIDER_UNAVAILABLE') {
        setProviderUnavailable(true);
        toast.showToast(t('No configured model provider is available for this step.'), 'error', 'feedback');
      } else if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Generation failed to start.')), 'error', 'feedback');
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section
      className="om-step-assist-bar"
      data-step-assist={step.id}
      aria-label={allowQuickMedia ? t('Models and Agent tools') : t('Agent tools')}
    >
      <div className="om-step-assist-row">
        <div className="om-step-assist-lead">
          <span className="om-brief-composer-icon" data-tone={step.type} aria-hidden="true">
            <RemixIcon name={allowQuickMedia ? 'sparkling-line' : 'robot-line'} size={15} />
          </span>
          <div>
            <h3 className="om-step-section-title">
              {allowQuickMedia ? t('Create with models or an Agent') : t('Work with your Agent via MCP')}
            </h3>
            <p className="om-step-muted">
              {allowQuickMedia
                ? t('Generate images or video right here, or copy an MCP prompt so your Agent writes assets back into this step.')
                : t('Copy a step-scoped MCP prompt so your Agent writes assets back into this step and Shared assets.')}
            </p>
          </div>
          {pendingJobs > 0 && (
            <span className="om-step-badge om-step-badge--accent">
              <RemixIcon name="loader-4-line" size={12} className="om-scenario-spin" />
              <span>{t('{count} generating', { count: pendingJobs })}</span>
            </span>
          )}
        </div>

        <div className="om-step-assist-actions">
          {allowQuickMedia && (
            <Button
              variant={quickOpen ? 'secondary' : 'ghost'}
              size="sm"
              type="button"
              aria-expanded={quickOpen}
              icon={<RemixIcon name="sparkling-line" size={14} />}
              onClick={handleToggleQuick}
            >
              {t('Generate image / video')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            loading={copyingMcp}
            icon={<RemixIcon name="robot-line" size={14} />}
            onClick={() => void handleCopyMcp()}
          >
            {t('Copy MCP prompt')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            loading={syncing}
            disabled={!run}
            icon={<RemixIcon name="refresh-line" size={14} />}
            onClick={() => void handleSync()}
          >
            {t('Sync')}
          </Button>
        </div>
      </div>

      {allowQuickMedia && quickOpen && (
        <div className="om-step-quick-gen" data-quick-gen={step.id}>
          <div className="om-step-chip-list" role="group" aria-label={t('Media type')}>
            <FilterChip
              active={modality === 'image'}
              className="om-step-icon-chip"
              data-tone="image"
              onClick={() => setModality('image')}
            >
              <span className="om-step-chip-icon" data-tone="image" aria-hidden="true">
                <RemixIcon name="image-line" size={13} />
              </span>
              <span>{t('Image')}</span>
            </FilterChip>
            <FilterChip
              active={modality === 'video'}
              className="om-step-icon-chip"
              data-tone="video"
              onClick={() => setModality('video')}
            >
              <span className="om-step-chip-icon" data-tone="video" aria-hidden="true">
                <RemixIcon name="movie-line" size={13} />
              </span>
              <span>{t('Video')}</span>
            </FilterChip>
          </div>

          <div className="om-step-field">
            <label className="om-step-field-label" htmlFor={`quick-gen-prompt-${step.id}`}>
              {t('Prompt')}
            </label>
            <FieldTextarea
              id={`quick-gen-prompt-${step.id}`}
              className="om-step-textarea"
              rows={2}
              value={quickPrompt}
              placeholder={
                modality === 'image'
                  ? t('Describe the image to generate')
                  : t('Describe the video clip to generate')
              }
              onChange={e => {
                setPromptTouched(true);
                setQuickPrompt(e.target.value);
              }}
            />
          </div>

          <div className="om-step-chip-list">
            {refItems.map(item => (
              <span key={item.id} className="om-step-bound-chip">
                {item.ref.type === 'asset' ? (
                  <img
                    className="om-step-slot-thumb"
                    src={assetMediaUrl(item.ref.assetId, item.ref.versionId)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="om-step-slot-icon" data-pool-kind={item.kind} aria-hidden="true">
                    <RemixIcon name="image-line" size={14} />
                  </span>
                )}
                <span className="om-step-bound-chip-label">{item.label}</span>
                <IconButton
                  size="sm"
                  variant="ghost"
                  type="button"
                  aria-label={t('Remove {label}', { label: item.label })}
                  icon={<RemixIcon name="close-line" size={12} />}
                  onClick={() => setRefIds(prev => prev.filter(id => id !== item.id))}
                />
              </span>
            ))}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              icon={<RemixIcon name="image-line" size={14} />}
              onClick={() => void handlePickReference()}
            >
              {refItems.length > 0 ? t('Change reference image') : t('Attach reference image')}
            </Button>
          </div>

          {catalogFailed ? (
            <div className="om-step-inline-error">
              <span>{t('Could not load available models.')}</span>
              <Button variant="ghost" size="sm" type="button" onClick={retryCatalog}>
                {t('Retry')}
              </Button>
            </div>
          ) : !catalog && !providerUnavailable ? (
            <Skeleton className="om-step-controls-skeleton" />
          ) : noProvider ? (
            <div className="om-step-provider-card" data-provider-setup="true" data-tone={modality}>
              <div className="om-step-provider-head">
                <span className="om-brief-composer-icon" data-tone={modality} aria-hidden="true">
                  <RemixIcon name="plug-line" size={16} />
                </span>
                <div>
                  <strong>
                    {modality === 'image' ? t('No image model is configured.') : t('No video model is configured.')}
                  </strong>
                  <p className="om-step-muted">
                    {t('Connect a model provider to generate directly, or copy the MCP prompt so your Agent writes assets back here.')}
                  </p>
                </div>
              </div>
              <div className="om-step-provider-actions">
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  icon={<RemixIcon name="plug-line" size={14} />}
                  onClick={() => nav.openProviders()}
                >
                  {t('Set up a provider')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  icon={<RemixIcon name="robot-line" size={14} />}
                  onClick={() => void handleCopyMcp()}
                >
                  {t('Copy MCP prompt')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="om-step-quick-gen-controls">
              <div className="om-step-quick-gen-select">
                <Select
                  label={t('Model')}
                  value={selectedModel?.id ?? ''}
                  options={availableModels.map(m => ({
                    value: m.id,
                    label: m.label,
                    description: m.provider,
                  }))}
                  onCommit={setSelectedModelId}
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                type="button"
                icon={<RemixIcon name="sparkling-line" size={14} />}
                loading={generating}
                disabled={!selectedModel || !quickPrompt.trim()}
                onClick={() => void handleQuickGenerate()}
              >
                {t('Generate')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
