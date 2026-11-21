import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { briefMarkdown, scriptOutline } from '../../../../shared/scenario-content';
import type { StepIteration } from '../../../../shared/scenario-runs';
import { fillScenarioTemplate, type ScenarioBriefField } from '../../../../shared/scenarios';
import { MenuItem, Select } from '../../components/ui';
import { CoverPlaceholder } from '../../components/ui/CoverPlaceholder';
import { FilterChip } from '../../components/ui/FilterChip';
import { FieldInput, FieldTextarea } from '../../components/ui/FormField';
import { Skeleton } from '../../components/ui/Skeleton';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { gemini4Videos } from '../../motion/gemini4Videos';
import { findModelHub } from '../../motion/modelHubs';
import { useIntegrationInfo } from '../../motion/useIntegrationInfo';
import { useMediaCatalog } from '../../motion/useMediaCatalog';
import { downloadText } from '../scenarioClient';
import type { StepProps } from '../stepContract';
import type { BriefPreset } from './briefPresets';
import { BriefPromptComposer } from './BriefPromptComposer';
import { StepCapabilityBar } from './StepCapabilityBar';
import {
  buildStepAgentPrompt,
  computeDiscountSummary,
  copyText,
  extractErrorMessage,
  isScenarioConflictError,
} from './stepUtils';

const AUTOSAVE_DELAY_MS = 800;

function initialBriefValues(
  fields: readonly ScenarioBriefField[],
  brief: Record<string, string | string[]> | undefined,
  locale: string,
): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {};
  for (const field of fields) {
    const existing = brief?.[field.id];
    if (field.kind === 'list' || field.kind === 'multi') {
      next[field.id] = Array.isArray(existing) ? [...existing] : [];
    } else if (typeof existing === 'string') {
      next[field.id] = existing;
    } else if (field.id === 'language') {
      next[field.id] = locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
    } else {
      next[field.id] = '';
    }
  }
  return next;
}

function cleanBriefForSave(
  fields: readonly ScenarioBriefField[],
  values: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const field of fields) {
    const val = values[field.id];
    if (field.kind === 'list' || field.kind === 'multi') {
      out[field.id] = Array.isArray(val) ? val.map(v => v.trim()).filter(Boolean) : [];
    } else {
      out[field.id] = typeof val === 'string' ? val : '';
    }
  }
  return out;
}

function findActiveScript(iterations: readonly StepIteration[], activeIterationId: string | null): string {
  const active = iterations.find(iter => iter.id === activeIterationId);
  const activeOut = active?.outputs.find((out): out is { type: 'script'; text: string } => out.type === 'script');
  if (activeOut) return activeOut.text;
  for (let i = iterations.length - 1; i >= 0; i -= 1) {
    const out = iterations[i].outputs.find((item): item is { type: 'script'; text: string } => item.type === 'script');
    if (out) return out.text;
  }
  return '';
}

function InspirationPoster({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <CoverPlaceholder fill />;
  return <img src={src} alt={title} loading="lazy" onError={() => setFailed(true)} />;
}

export function BriefStep({
  scenario,
  step,
  state,
  run,
  active,
  api,
  pool,
  toast,
  nav,
  renderExportMenu,
  renderIterations,
}: StepProps) {
  const { t, locale } = useI18n();
  const { info: integration } = useIntegrationInfo();
  const isGemini = scenario.id === 'gemini-4-neon';
  const isBlackFriday = scenario.id === 'black-friday';
  const isAiInfluencer = scenario.id === 'ai-influencer';

  const geminiHub = useMemo(() => (isGemini ? findModelHub('gemini-4') : null), [isGemini]);
  const { catalog: geminiCatalog, failed: geminiCatalogFailed, retry: retryGeminiCatalog } = useMediaCatalog(active && isGemini);

  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    initialBriefValues(scenario.briefFields, run?.brief, locale),
  );
  const [editorMode, setEditorMode] = useState<'guided' | 'form'>('guided');
  const [promptsExpanded, setPromptsExpanded] = useState(false);
  const dirtyFieldsRef = useRef<Set<string>>(new Set());
  const activeFieldRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValuesRef = useRef(values);
  latestValuesRef.current = values;

  // Script state for AI Influencer
  const activeScriptFromRun = useMemo(
    () => (isAiInfluencer ? findActiveScript(state.iterations, state.activeIterationId) : ''),
    [isAiInfluencer, state.iterations, state.activeIterationId],
  );
  const [scriptText, setScriptText] = useState(activeScriptFromRun);
  const scriptDirtyRef = useRef(false);

  useEffect(() => {
    if (!scriptDirtyRef.current) {
      setScriptText(activeScriptFromRun);
    }
  }, [activeScriptFromRun]);

  // Reset form when scenario or run id changes
  const runId = run?.id ?? null;
  useEffect(() => {
    dirtyFieldsRef.current.clear();
    setValues(initialBriefValues(scenario.briefFields, run?.brief, locale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, runId]);

  // Merge remote brief updates without clobbering active or dirty user inputs
  useEffect(() => {
    if (!run?.brief) return;
    setValues(prev => {
      const next = { ...prev };
      let changed = false;
      for (const field of scenario.briefFields) {
        if (dirtyFieldsRef.current.has(field.id) || activeFieldRef.current === field.id) continue;
        const remote = run.brief[field.id];
        if (remote === undefined) continue;
        const prevSerialized = JSON.stringify(prev[field.id] ?? '');
        const nextSerialized = JSON.stringify(remote);
        if (prevSerialized !== nextSerialized) {
          next[field.id] = Array.isArray(remote) ? [...remote] : remote;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [run?.brief, run?.revision, scenario.briefFields]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const flushBriefSave = useCallback(async (patchOverride?: Record<string, string | string[]>) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const keysToSend = patchOverride
      ? Object.keys(patchOverride)
      : Array.from(dirtyFieldsRef.current);
    if (!keysToSend.length) return;

    const snapshot = patchOverride ?? latestValuesRef.current;
    const fieldsById = new Map(scenario.briefFields.map(field => [field.id, field]));
    const patch: Record<string, string | string[]> = {};
    for (const key of keysToSend) {
      const field = fieldsById.get(key);
      if (!field) continue;
      const raw = snapshot[key];
      if (field.kind === 'list' || field.kind === 'multi') {
        patch[key] = Array.isArray(raw) ? raw.map(v => v.trim()).filter(Boolean) : [];
      } else {
        patch[key] = typeof raw === 'string' ? raw : '';
      }
    }
    if (!Object.keys(patch).length) return;

    try {
      await api.mutate('brief-autosave', 'update_brief', { brief: patch });
      for (const key of Object.keys(patch)) {
        const current = latestValuesRef.current[key];
        const sent = patch[key];
        const currentClean = Array.isArray(current) ? current.map(v => v.trim()).filter(Boolean) : current;
        if (JSON.stringify(currentClean) === JSON.stringify(sent)) {
          dirtyFieldsRef.current.delete(key);
        }
      }
    } catch {
      // Conflicts are reported by useScenarioRun; keep dirty fields intact so edits are preserved.
    }
  }, [api, scenario.briefFields]);

  const scheduleAutosave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flushBriefSave();
    }, AUTOSAVE_DELAY_MS);
  }, [flushBriefSave]);

  const updateField = (fieldId: string, value: string | string[]) => {
    dirtyFieldsRef.current.add(fieldId);
    setValues(prev => ({ ...prev, [fieldId]: value }));
    scheduleAutosave();
  };

  const handleApplyPreset = (preset: BriefPreset) => {
    const merged = initialBriefValues(scenario.briefFields, preset.values, locale);
    for (const field of scenario.briefFields) {
      dirtyFieldsRef.current.add(field.id);
    }
    setValues(merged);
    scheduleAutosave();
    toast.showToast(t('Example applied'), 'info', 'feedback');
  };

  const handleClearAll = () => {
    const cleared = initialBriefValues(scenario.briefFields, {}, locale);
    for (const field of scenario.briefFields) {
      dirtyFieldsRef.current.add(field.id);
    }
    setValues(cleared);
    scheduleAutosave();
  };

  const [savingRevision, setSavingRevision] = useState(false);
  const handleSaveRevision = async () => {
    setSavingRevision(true);
    try {
      await flushBriefSave();
      const cleaned = cleanBriefForSave(scenario.briefFields, latestValuesRef.current);
      await api.mutate('brief-revision', 'add_iteration', {
        stepId: step.id,
        iteration: {
          source: 'manual',
          outputs: [{ type: 'brief', values: cleaned }],
        },
      });
      toast.showToast(t('Version saved'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not save brief version.')), 'error', 'feedback');
      }
    } finally {
      setSavingRevision(false);
    }
  };

  const handleRestoreBrief = async (savedValues: Record<string, string | string[]>) => {
    const merged = initialBriefValues(scenario.briefFields, savedValues, locale);
    dirtyFieldsRef.current.clear();
    setValues(merged);
    try {
      await api.mutate('brief-restore', 'update_brief', {
        brief: cleanBriefForSave(scenario.briefFields, merged),
      });
      toast.showToast(t('Brief restored'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not restore brief.')), 'error', 'feedback');
      }
    }
  };

  // Downstream prompts
  const downstreamSteps = useMemo(
    () => scenario.steps
      .filter((s): s is typeof s & { promptTemplate: string } => Boolean(s.promptTemplate))
      .map(s => ({
        step: s,
        filled: fillScenarioTemplate(s.promptTemplate, values),
        userEdited: Boolean(run?.steps[s.id]?.draft?.promptEdited),
      })),
    [scenario.steps, values, run?.steps],
  );

  const [applyingPrompts, setApplyingPrompts] = useState(false);
  const handleApplyAllPrompts = async () => {
    setApplyingPrompts(true);
    let updatedCount = 0;
    try {
      for (const entry of downstreamSteps) {
        if (entry.userEdited || !entry.filled) continue;
        await api.mutate(`seed-prompt:${entry.step.id}`, 'update_step', {
          stepId: entry.step.id,
          draft: { prompt: entry.filled },
        });
        updatedCount += 1;
      }
      if (updatedCount > 0) {
        toast.showToast(t('Updated prompts for {count} steps', { count: updatedCount }), 'info', 'feedback');
      } else {
        toast.showToast(t('All downstream steps already have custom prompts.'), 'info', 'feedback');
      }
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not apply prompts.')), 'error', 'feedback');
      }
    } finally {
      setApplyingPrompts(false);
    }
  };

  // AI influencer script actions
  const [generatingScript, setGeneratingScript] = useState(false);
  const handleGenerateScriptOutline = async () => {
    setGeneratingScript(true);
    try {
      const lang = typeof values.language === 'string' && values.language ? values.language : locale;
      const generated = scriptOutline(values, lang);
      setScriptText(generated);
      scriptDirtyRef.current = false;
      await api.mutate('brief-script-outline', 'add_iteration', {
        stepId: step.id,
        iteration: {
          source: 'local',
          outputs: [{ type: 'script', text: generated }],
        },
      });
      toast.showToast(t('Script outline generated'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not generate script outline.')), 'error', 'feedback');
      }
    } finally {
      setGeneratingScript(false);
    }
  };

  const [savingScript, setSavingScript] = useState(false);
  const handleSaveScript = async () => {
    const trimmed = scriptText.trim();
    if (!trimmed) return;
    setSavingScript(true);
    try {
      await api.mutate('brief-script-save', 'add_iteration', {
        stepId: step.id,
        iteration: {
          source: 'manual',
          outputs: [{ type: 'script', text: trimmed }],
        },
      });
      scriptDirtyRef.current = false;
      toast.showToast(t('Script saved'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not save script.')), 'error', 'feedback');
      }
    } finally {
      setSavingScript(false);
    }
  };

  const briefStepPrompt = useMemo(() => {
    const parts = [
      typeof values.productName === 'string' ? values.productName.trim() : '',
      typeof values.personaName === 'string' ? values.personaName.trim() : '',
      typeof values.concept === 'string' ? values.concept.trim() : '',
      typeof values.idea === 'string' ? values.idea.trim() : '',
      typeof values.visualStyle === 'string' ? values.visualStyle.trim() : '',
    ].filter(Boolean);
    return parts.join(' — ');
  }, [values]);

  const handleCopyScriptHandoff = async () => {
    let ensuredRun = run;
    if (!ensuredRun) {
      try {
        ensuredRun = await api.ensureRun();
      } catch {
        ensuredRun = null;
      }
    }
    const base = buildStepAgentPrompt(scenario, ensuredRun, {
      stepId: step.id,
      stepPrompt: briefStepPrompt || undefined,
      locale,
      integration,
    });
    const prompt = `${base}\n\nFocus on writing a tight, natural spoken episode script and save it via openmotion_assets_use action=scenario command=add_iteration (stepId=${step.id}, outputs=[{ type: "script", text }]).`;
    const ok = await copyText(prompt);
    toast.showToast(
      ok ? t('Copied. Paste into your Agent.') : t('Could not copy to clipboard.'),
      ok ? 'info' : 'error',
      'feedback',
    );
  };

  // Black Friday live discount badge
  const discountSummary = useMemo(
    () => (isBlackFriday ? computeDiscountSummary(values.originalPrice, values.salePrice, values.discountPercent) : null),
    [isBlackFriday, values.originalPrice, values.salePrice, values.discountPercent],
  );

  // Gemini 4 Neon availability & inspiration
  const geminiInspiration = useMemo(
    () => (geminiHub?.videos ?? gemini4Videos).slice(0, 8),
    [geminiHub],
  );
  const geminiServedModels = useMemo(() => {
    if (!geminiHub || !geminiCatalog) return [];
    return geminiCatalog.models.filter(
      model => geminiHub.modelPattern.test(model.id) || geminiHub.modelPattern.test(model.modelId),
    );
  }, [geminiHub, geminiCatalog]);
  const geminiProvider = useMemo(
    () => (geminiHub ? geminiCatalog?.status.providers.find(p => p.id === geminiHub.provider) : undefined),
    [geminiHub, geminiCatalog],
  );

  // Step export actions
  const handleCopyBrief = async () => {
    const md = briefMarkdown(scenario, values);
    const ok = await copyText(md);
    toast.showToast(ok ? t('Brief copied') : t('Could not copy to clipboard.'), ok ? 'info' : 'error', 'feedback');
  };

  const handleDownloadBrief = () => {
    downloadText('brief.md', briefMarkdown(scenario, values), 'text/markdown;charset=utf-8');
    toast.showToast(t('Downloaded brief.md'), 'info', 'feedback');
  };

  const exportMenuExtras = (
    <>
      <MenuItem icon={<RemixIcon name="file-copy-line" size={14} />} onClick={() => void handleCopyBrief()}>
        {t('Copy brief')}
      </MenuItem>
      <MenuItem icon={<RemixIcon name="download-2-line" size={14} />} onClick={handleDownloadBrief}>
        {t('Download brief.md')}
      </MenuItem>
    </>
  );

  const renderField = (field: ScenarioBriefField) => {
    const raw = values[field.id];
    const stringVal = typeof raw === 'string' ? raw : '';
    const arrayVal = Array.isArray(raw) ? raw : [];
    const missingRequired = Boolean(field.required && (field.kind === 'list' || field.kind === 'multi' ? arrayVal.length === 0 : !stringVal.trim()));

    return (
      <div key={field.id} className="om-step-field" data-brief-field={field.id}>
        <div className="om-step-field-label-row">
          <label className="om-step-field-label" htmlFor={`brief-${scenario.id}-${field.id}`}>
            {t(field.label)}
            {field.required && <span className="om-step-required" aria-hidden="true">*</span>}
          </label>
          {missingRequired && <span className="om-step-field-hint">{t('Required')}</span>}
        </div>

        {field.kind === 'textarea' && (
          <FieldTextarea
            id={`brief-${scenario.id}-${field.id}`}
            className="om-step-textarea"
            rows={3}
            value={stringVal}
            maxLength={field.maxLength}
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            required={field.required}
            onFocus={() => { activeFieldRef.current = field.id; }}
            onBlur={() => { activeFieldRef.current = null; }}
            onChange={e => updateField(field.id, e.target.value)}
          />
        )}

        {(field.kind === 'text' || field.kind === 'url' || field.kind === 'price') && (
          <FieldInput
            id={`brief-${scenario.id}-${field.id}`}
            className="om-step-input"
            type={field.kind === 'url' ? 'url' : 'text'}
            value={stringVal}
            maxLength={field.maxLength}
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            required={field.required}
            onFocus={() => { activeFieldRef.current = field.id; }}
            onBlur={() => { activeFieldRef.current = null; }}
            onChange={e => updateField(field.id, e.target.value)}
          />
        )}

        {field.kind === 'select' && field.options && (
          <Select
            label={t(field.label)}
            value={stringVal || field.options[0]?.id || ''}
            options={field.options.map(opt => ({ value: opt.id, label: t(opt.label) }))}
            onCommit={next => updateField(field.id, next)}
          />
        )}

        {field.kind === 'multi' && field.options && (
          <div className="om-step-chip-list" role="group" aria-label={t(field.label)}>
            {field.options.map(opt => {
              const selected = arrayVal.includes(opt.id);
              return (
                <FilterChip
                  key={opt.id}
                  active={selected}
                  onClick={() => {
                    const next = selected
                      ? arrayVal.filter(id => id !== opt.id)
                      : [...arrayVal, opt.id];
                    updateField(field.id, next);
                  }}
                >
                  {t(opt.label)}
                </FilterChip>
              );
            })}
          </div>
        )}

        {field.kind === 'list' && (
          <div className="om-step-list-field">
            {(arrayVal.length ? arrayVal : ['']).map((entry, idx) => (
              <div key={idx} className="om-step-list-row">
                <FieldInput
                  className="om-step-input"
                  value={entry}
                  maxLength={field.maxLength}
                  placeholder={field.placeholder ? t(field.placeholder) : undefined}
                  aria-label={`${t(field.label)} ${idx + 1}`}
                  onFocus={() => { activeFieldRef.current = field.id; }}
                  onBlur={() => { activeFieldRef.current = null; }}
                  onChange={e => {
                    const next = arrayVal.length ? [...arrayVal] : [''];
                    next[idx] = e.target.value;
                    updateField(field.id, next);
                  }}
                />
                {arrayVal.length > 1 && (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t('Remove item')}
                    icon={<RemixIcon name="close-line" size={14} />}
                    onClick={() => {
                      const next = arrayVal.filter((_, i) => i !== idx);
                      updateField(field.id, next);
                    }}
                  />
                )}
              </div>
            ))}
            {arrayVal.length < 5 && (
              <Button
                variant="ghost"
                size="sm"
                icon={<RemixIcon name="add-line" size={14} />}
                onClick={() => updateField(field.id, [...(arrayVal.length ? arrayVal : ['']), ''])}
              >
                {t('Add item')}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="om-step-body" data-step-body="brief">
      {renderExportMenu(exportMenuExtras)}

      {editorMode === 'guided' ? (
        <BriefPromptComposer
          scenario={scenario}
          values={values}
          discountBadge={isBlackFriday ? discountSummary?.label : undefined}
          savingRevision={savingRevision}
          autosaving={api.busy.has('brief-autosave')}
          onUpdateField={updateField}
          onFocusField={fieldId => { activeFieldRef.current = fieldId; }}
          onApplyPreset={handleApplyPreset}
          onClearAll={handleClearAll}
          onSaveRevision={() => void handleSaveRevision()}
          onSwitchToForm={() => setEditorMode('form')}
        />
      ) : (
        <section className="om-step-card om-brief-form-card" data-brief-composer="form" aria-label={t('Brief details')}>
          <div className="om-brief-composer-head">
            <div className="om-step-toolbar-group">
              <Button
                variant="ghost"
                size="sm"
                icon={<RemixIcon name="save-line" size={14} />}
                loading={savingRevision}
                onClick={() => void handleSaveRevision()}
              >
                {t('Save version')}
              </Button>
              {api.busy.has('brief-autosave') && (
                <span className="om-step-muted">{t('Saving…')}</span>
              )}
            </div>
            <div className="om-brief-composer-head-actions">
              {isBlackFriday && discountSummary && (
                <span className="om-step-badge om-step-badge--accent" data-discount-badge="true">
                  {discountSummary.label}
                </span>
              )}
              <div className="om-step-segmented" role="group" aria-label={t('Brief editor mode')}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={false}
                  icon={<RemixIcon name="sparkling-line" size={13} />}
                  onClick={() => setEditorMode('guided')}
                >
                  {t('Fill in the blanks')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-pressed={true}
                  icon={<RemixIcon name="equalizer-line" size={13} />}
                  onClick={() => {}}
                >
                  {t('All fields')}
                </Button>
              </div>
            </div>
          </div>
          <div className="om-step-form-grid">
            {scenario.briefFields.map(renderField)}
          </div>
        </section>
      )}

      {isAiInfluencer && (
        <section className="om-step-card" aria-label={t('Episode script')}>
          <div className="om-step-section-head">
            <div className="om-brief-composer-lead">
              <span className="om-brief-composer-icon" data-tone="audio" aria-hidden="true">
                <RemixIcon name="voiceprint-line" size={16} />
              </span>
              <div>
                <h3 className="om-step-section-title">{t('Episode script')}</h3>
                <p className="om-step-muted">{t('Used automatically as the speech prompt in the voiceover step.')}</p>
              </div>
            </div>
            <div className="om-step-toolbar-group">
              <Button
                variant="secondary"
                size="sm"
                icon={<RemixIcon name="sparkling-line" size={14} />}
                loading={generatingScript}
                onClick={() => void handleGenerateScriptOutline()}
              >
                {t('Generate script outline')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<RemixIcon name="clipboard-line" size={14} />}
                onClick={() => void handleCopyScriptHandoff()}
              >
                {t('Ask Agent to write script')}
              </Button>
            </div>
          </div>
          <FieldTextarea
            className="om-step-textarea"
            rows={6}
            aria-label={t('Episode script')}
            placeholder={t('Generate an outline or write your spoken script here.')}
            value={scriptText}
            onChange={e => {
              scriptDirtyRef.current = true;
              setScriptText(e.target.value);
            }}
          />
          <div className="om-step-actions-end">
            <Button
              variant="primary"
              size="sm"
              icon={<RemixIcon name="save-line" size={14} />}
              loading={savingScript}
              disabled={!scriptText.trim()}
              onClick={() => void handleSaveScript()}
            >
              {t('Save script version')}
            </Button>
          </div>
        </section>
      )}

      <StepCapabilityBar
        scenario={scenario}
        step={step}
        state={state}
        run={run}
        active={active}
        api={api}
        pool={pool}
        toast={toast}
        nav={nav}
        stepPrompt={briefStepPrompt}
        allowQuickMedia
      />

      {isGemini && geminiHub && (
        <>
          <section className="om-step-card" aria-label={t('Gemini 4 availability')}>
            <div className="om-step-section-head">
              <div className="om-brief-composer-lead">
                <span className="om-brief-composer-icon" data-tone="video" aria-hidden="true">
                  <RemixIcon name="sparkling-line" size={16} />
                </span>
                <div>
                  <h3 className="om-step-section-title">{t('Gemini 4 availability')}</h3>
                  <p className="om-step-muted">{t(geminiHub.summary)}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<RemixIcon name="plug-line" size={14} />}
                onClick={() => nav.openProviders('gemini')}
              >
                {t('Connect Gemini')}
              </Button>
            </div>
            {geminiCatalogFailed ? (
              <div className="om-step-inline-error">
                <span>{t('Could not check model availability.')}</span>
                <Button variant="ghost" size="sm" onClick={retryGeminiCatalog}>{t('Retry')}</Button>
              </div>
            ) : !geminiCatalog ? (
              <Skeleton className="om-step-availability-skeleton" />
            ) : geminiServedModels.length > 0 ? (
              <div className="om-step-status-row">
                <RemixIcon name="checkbox-circle-fill" size={16} />
                <span>{t('{count} Gemini 4 models ready', { count: geminiServedModels.length })}</span>
              </div>
            ) : (
              <p className="om-step-muted">
                {geminiProvider?.available
                  ? t('Gemini provider is connected. {model} appears here once your key has access.', { model: geminiHub.modelName })
                  : t('{model} is not configured yet. Connect Gemini or hand off the brief to your Agent.', { model: geminiHub.modelName })}
              </p>
            )}
          </section>

          <section className="om-step-section" aria-label={t('Gemini 4 Neon inspiration')}>
            <div className="om-step-section-head">
              <div className="om-brief-composer-lead">
                <span className="om-brief-composer-icon" data-tone="video" aria-hidden="true">
                  <RemixIcon name="movie-line" size={16} />
                </span>
                <div>
                  <h3 className="om-step-section-title">{t('Gemini 4 Neon inspiration')}</h3>
                  <p className="om-step-muted">{t('Explore community code animations in the Gemini 4 hub.')}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<RemixIcon name="external-link-line" size={14} />}
                onClick={() => nav.openModelHub('gemini-4')}
              >
                {t('Open Gemini 4 hub')}
              </Button>
            </div>
            <div className="om-step-inspiration-rail">
              {geminiInspiration.map(video => (
                <Button
                  key={video.id}
                  variant="plain"
                  type="button"
                  className="om-step-inspiration-card"
                  onClick={() => nav.openModelHub('gemini-4')}
                >
                  <span className="om-step-inspiration-thumb">
                    <InspirationPoster src={video.poster} title={video.title} />
                  </span>
                  <span className="om-step-inspiration-copy">
                    <strong>{video.title}</strong>
                    <small>{video.authorName} · {video.variant}</small>
                  </span>
                </Button>
              ))}
            </div>
          </section>
        </>
      )}

      {downstreamSteps.length > 0 && (
        <section className="om-step-disclosure" aria-label={t('Step prompts')}>
          <Button
            variant="ghost"
            size="sm"
            className="om-step-disclosure-trigger"
            aria-expanded={promptsExpanded}
            icon={<RemixIcon name={promptsExpanded ? 'arrow-down-s-line' : 'arrow-right-s-line'} size={14} />}
            onClick={() => setPromptsExpanded(prev => !prev)}
          >
            <span>
              {t('Later steps use this brief automatically')} · {promptsExpanded ? t('Hide prompts') : t('View prompts')}
            </span>
          </Button>
          {promptsExpanded && (
            <div className="om-step-disclosure-body">
              <div className="om-step-prompt-list">
                {downstreamSteps.map(({ step: target, filled, userEdited }) => (
                  <div key={target.id} className="om-step-prompt-row">
                    <div className="om-step-prompt-meta">
                      <span className="om-step-inline-icon" data-step-type={target.type} aria-hidden="true">
                        <RemixIcon name={target.icon} size={14} />
                      </span>
                      <strong>{t(target.title)}</strong>
                      {userEdited && <span className="om-step-badge">{t('Edited')}</span>}
                    </div>
                    <p className="om-step-prompt-preview">{filled || t('Fill brief fields to seed this prompt.')}</p>
                  </div>
                ))}
              </div>
              <div className="om-step-disclosure-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RemixIcon name="check-line" size={14} />}
                  loading={applyingPrompts}
                  onClick={() => void handleApplyAllPrompts()}
                >
                  {t('Apply to all steps')}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {state.iterations.length > 0 && renderIterations({
        renderOutput: (iteration: StepIteration) => {
          const briefOut = iteration.outputs.find(
            (out): out is { type: 'brief'; values: Record<string, string | string[]> } => out.type === 'brief',
          );
          const scriptOut = iteration.outputs.find(
            (out): out is { type: 'script'; text: string } => out.type === 'script',
          );
          if (briefOut) {
            const entries = Object.entries(briefOut.values)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
              .filter(line => !line.endsWith(': '))
              .slice(0, 3);
            return (
              <div className="om-step-iter-text">
                <p>{entries.join(' · ') || t('Empty brief snapshot')}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRestoreBrief(briefOut.values)}
                >
                  {t('Restore')}
                </Button>
              </div>
            );
          }
          if (scriptOut) {
            return (
              <div className="om-step-iter-text">
                <p>{scriptOut.text.slice(0, 180)}{scriptOut.text.length > 180 ? '…' : ''}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setScriptText(scriptOut.text);
                    scriptDirtyRef.current = false;
                  }}
                >
                  {t('Load script')}
                </Button>
              </div>
            );
          }
          return <span className="om-step-muted">{t('Version')}</span>;
        },
      })}
    </div>
  );
}
