import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button } from 'open-design-ui/button';
import type { ScenarioBriefField, ScenarioDefinition, ScenarioStepDefinition } from '../../../shared/scenarios';
import type { PoolItem, PoolRef, ScenarioBundleReceipt, ScenarioRun, ScenarioStepState } from '../../../shared/scenario-runs';
import { FieldInput, FieldTextarea } from '../components/ui/FormField';
import type { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { uploadLibraryAsset } from '../motion/assetClient';
import type { PoolExportOptions } from './AssetPoolPanel';
import { PoolThumb } from './PoolItemPreview';
import { buildShowcaseSlides } from './ScenarioStage';
import { scenarioStudio, studioDeliverables } from './scenarioStudios';
import type { ScenarioRunApi } from './stepContract';
import { briefPresetsFor } from './steps/briefPresets';

const AUTOSAVE_DELAY_MS = 800;
/** After the kit is handed to the Agent, check for returned outputs this often, for at most this long. */
const HANDOFF_POLL_MS = 8000;
const HANDOFF_POLL_LIMIT_MS = 15 * 60 * 1000;

type DeliverableState = 'waiting' | 'making' | 'ready' | 'failed';

export type ScenarioStudioViewProps = {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  api: ScenarioRunApi;
  toast: Pick<ReturnType<typeof useToast>, 'showToast'>;
  poolItems: PoolItem[];
  onAddPoolItems(items: { ref: PoolRef; label?: string; stepId?: string | null; source: PoolItem['source'] }[]): Promise<string[]>;
  /** Resolves false when the brief could not be copied, so the hand-off note is not shown. */
  onCopyAgentPrompt(customPrompt?: string): Promise<boolean>;
  onExportBundle(options?: PoolExportOptions): Promise<ScenarioBundleReceipt | null>;
  exportingBundle: boolean;
  onOpenStep(stepId: string): void;
  onSwitchToManual(): void;
  onOpenMcp(example?: string): void;
};

function briefText(brief: Record<string, string | string[]> | undefined, id: string) {
  const value = brief?.[id];
  return typeof value === 'string' ? value : '';
}

/** The fields people must fill before the kit can be made: the idea plus any other required field. */
export function studioInputFields(scenario: ScenarioDefinition): ScenarioBriefField[] {
  return scenario.briefFields.filter(field => field.id !== 'idea' && field.required);
}

function latestIteration(state: ScenarioStepState | undefined) {
  if (!state?.iterations.length) return undefined;
  return state.iterations.find(iteration => iteration.id === state.activeIterationId) ?? state.iterations[state.iterations.length - 1];
}

export function deliverableState(state: ScenarioStepState | undefined): DeliverableState {
  const iteration = latestIteration(state);
  if (iteration?.job && (iteration.job.state === 'queued' || iteration.job.state === 'running')) return 'making';
  if (iteration?.job?.state === 'failed') return 'failed';
  if (state?.status === 'done' || (iteration && iteration.outputs.length > 0)) return 'ready';
  if (state?.status === 'in-progress') return 'making';
  return 'waiting';
}

const stateLabels: Record<DeliverableState, string> = { waiting: 'Not started', making: 'In the making', ready: 'Ready', failed: 'Needs a retry' };

function DeliverableCard({ step, state, run, poolById, example, onOpen }: {
  step: ScenarioStepDefinition;
  state: ScenarioStepState | undefined;
  run: ScenarioRun | null;
  poolById: Map<string, PoolItem>;
  example: string | undefined;
  onOpen(): void;
}) {
  const { t } = useI18n();
  const status = deliverableState(state);
  const iteration = latestIteration(state);
  const poolItem = iteration?.outputs
    .map(output => output.type === 'pool' ? poolById.get(output.poolItemId) : undefined)
    .find((item): item is PoolItem => Boolean(item))
    ?? run?.pool.find(item => item.stepId === step.id);
  const posts = iteration?.outputs.find(output => output.type === 'social');
  return (
    <Button variant="plain" className="om-studio-output" data-studio-output={step.id} data-output-state={status} onClick={onOpen}
      aria-label={`${t(step.title)} · ${t(stateLabels[status])}`}>
      <span className="om-studio-output-art" aria-hidden="true">
        {poolItem ? <PoolThumb item={poolItem} run={run} size="lg" />
          : posts && posts.type === 'social' ? <span className="om-studio-output-text">
            <RemixIcon name="chat-1-line" size={20} />
            <strong>{t('{count} posts', { count: posts.posts.length })}</strong>
          </span>
          : example ? <img src={example} alt="" loading="lazy" />
          : <RemixIcon name={step.icon} size={24} />}
        {!poolItem && !posts && example && <span className="om-studio-output-example">{t('Example output')}</span>}
      </span>
      <span className="om-studio-output-meta">
        <RemixIcon name={step.icon} size={14} aria-hidden="true" />
        <strong>{t(step.title)}</strong>
        <span className="om-studio-output-state" data-output-state={status}>{t(stateLabels[status])}</span>
      </span>
    </Button>
  );
}

export function ScenarioStudioView({
  scenario, run, api, toast, poolItems, onAddPoolItems, onCopyAgentPrompt, onExportBundle, exportingBundle, onOpenStep, onSwitchToManual, onOpenMcp,
}: ScenarioStudioViewProps) {
  const { t, locale } = useI18n();
  const studio = scenarioStudio(scenario.id);
  const inputFields = useMemo(() => studioInputFields(scenario), [scenario]);
  const deliverables = useMemo(() => studioDeliverables(scenario), [scenario]);
  const examples = useMemo(() => new Map(buildShowcaseSlides(scenario).map(slide => [slide.stepId, slide.poster])), [scenario]);
  const presets = useMemo(() => briefPresetsFor(scenario.id, locale), [scenario.id, locale]);
  const poolById = useMemo(() => new Map(poolItems.map(item => [item.id, item])), [poolItems]);
  const references = useMemo(() => poolItems.filter(item => item.stepId === null && (item.source === 'upload' || item.source === 'workspace')), [poolItems]);

  const fieldIds = useMemo(() => ['idea', ...inputFields.map(field => field.id)], [inputFields]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fieldIds.map(id => [id, briefText(run?.brief, id)])));
  const dirty = useRef(new Set<string>());
  const latest = useRef(values);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [making, setMaking] = useState(false);
  const [handedOffAt, setHandedOffAt] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Switching to another draft (or starting a new one) starts from that draft's brief.
  // The first save of a fresh page creates the run and keeps what was typed.
  const runIdRef = useRef(run?.id ?? null);
  useEffect(() => {
    const previous = runIdRef.current;
    runIdRef.current = run?.id ?? null;
    if (!previous || !run || previous === run.id) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    dirty.current.clear();
    const reset = Object.fromEntries(fieldIds.map(id => [id, briefText(run.brief, id)]));
    latest.current = reset;
    setValues(reset);
    setHandedOffAt(null);
  }, [fieldIds, run]);

  // Take remote brief values for fields the person is not editing.
  useEffect(() => {
    setValues(previous => {
      const next = { ...previous };
      for (const id of fieldIds) if (!dirty.current.has(id) && run?.brief?.[id] !== undefined) next[id] = briefText(run.brief, id);
      latest.current = next;
      return next;
    });
  }, [fieldIds, run?.brief]);

  /** Saves typed fields; resolves false when the brief could not be saved. */
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current.size) return true;
    const patch = Object.fromEntries([...dirty.current].map(id => [id, latest.current[id] ?? '']));
    try {
      await api.mutate('studio-brief', 'update_brief', { brief: patch });
      for (const id of Object.keys(patch)) if (latest.current[id] === patch[id]) dirty.current.delete(id);
      return true;
    } catch {
      // useScenarioRun reports conflicts; the typed values stay so nothing is lost.
      return false;
    }
  }, [api]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (dirty.current.size) void flushRef.current(); }, []);

  const update = (patch: Record<string, string>) => {
    for (const id of Object.keys(patch)) dirty.current.add(id);
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setValues(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  };

  // While the Agent is making the kit, pick up what it saves back without a manual Sync.
  useEffect(() => {
    if (handedOffAt === null) return;
    const id = setInterval(() => {
      if (Date.now() - handedOffAt > HANDOFF_POLL_LIMIT_MS) { clearInterval(id); return; }
      void api.refresh().catch(() => {});
    }, HANDOFF_POLL_MS);
    return () => clearInterval(id);
  }, [api, handedOffAt]);

  /** Leave the studio only after the typed brief is saved, so nothing typed is lost. */
  const leaveAfterSave = async (leave: () => void) => {
    if (await flush()) { leave(); return; }
    toast.showToast(t('Could not save brief revision.'), 'error', 'feedback');
  };

  const missing = [{ id: 'idea', label: 'Core idea' }, ...inputFields].filter(field => !(values[field.id] ?? '').trim());
  const readyCount = deliverables.filter(step => deliverableState(run?.steps[step.id]) === 'ready').length;

  const makeKit = async () => {
    if (making) return;
    if (missing.length) {
      toast.showToast(t('Fill in {field} first', { field: t(missing[0].label) }), 'error', 'feedback');
      return;
    }
    setMaking(true);
    try {
      // Only hand over a brief the run has saved, so the Agent never gets stale fields.
      if (!(await flush())) {
        toast.showToast(t('Could not save brief revision.'), 'error', 'feedback');
        return;
      }
      if (await onCopyAgentPrompt(latest.current.idea)) setHandedOffAt(Date.now());
    } finally {
      setMaking(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      await api.ensureRun();
      const items: { ref: PoolRef; label: string; stepId: null; source: 'upload' }[] = [];
      for (const file of files) {
        try {
          const asset = await uploadLibraryAsset(file);
          items.push({ ref: { type: 'asset', assetId: asset.id, versionId: asset.currentVersionId }, label: asset.name || file.name, stepId: null, source: 'upload' });
        } catch {
          toast.showToast(t('Could not upload {name}', { name: file.name }), 'error', 'feedback');
        }
      }
      if (items.length) await onAddPoolItems(items);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="om-studio-view" data-studio-view={scenario.id}>
      <section className="om-studio-input" aria-label={t('Your brief')}>
        <h1>{t(studio.title)}</h1>
        <p className="om-studio-input-hint">{t(studio.inputHint)}</p>
        <FieldTextarea
          className="om-studio-idea"
          rows={4}
          aria-label={t('Core idea')}
          value={values.idea ?? ''}
          maxLength={scenario.briefFields.find(field => field.id === 'idea')?.maxLength}
          placeholder={t(scenario.briefFields.find(field => field.id === 'idea')?.placeholder ?? 'Describe what you want to create and the outcome you want.')}
          onChange={event => update({ idea: event.target.value })}
        />
        {inputFields.length > 0 && <div className="om-studio-fields">
          {inputFields.map(field => (
            <FieldInput key={field.id} density="compact" aria-label={t(field.label)} value={values[field.id] ?? ''}
              placeholder={t(field.label)} maxLength={field.maxLength} onChange={event => update({ [field.id]: event.target.value })} />
          ))}
        </div>}
        <div className="om-studio-refs">
          {references.map(item => <PoolThumb key={item.id} item={item} run={run} size="sm" />)}
          <input ref={fileInput} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={event => void upload(event)} />
          <Button variant="secondary" size="sm" icon={<RemixIcon name="upload-2-line" size={14} />} disabled={uploading}
            onClick={() => fileInput.current?.click()}>
            {uploading ? t('Uploading…') : t('Add reference images')}
          </Button>
        </div>
        {presets.length > 0 && <div className="om-studio-presets">
          <span>{t('Try:')}</span>
          {presets.map(preset => (
            <Button key={preset.id} variant="plain" size="sm" className="om-studio-preset"
              onClick={() => update(Object.fromEntries(Object.entries(preset.values).filter((entry): entry is [string, string] => typeof entry[1] === 'string')))}>
              {preset.label}
            </Button>
          ))}
        </div>}
        <Button variant="primary" className="om-studio-make" icon={<RemixIcon name="sparkling-line" size={16} />} disabled={making} onClick={() => void makeKit()}>
          {t('Make the full kit')}
        </Button>
        {handedOffAt !== null && <div className="om-studio-handoff" role="status">
          <RemixIcon name="checkbox-circle-line" size={16} aria-hidden="true" />
          <span>{t('Copied. Paste it into your connected Agent and the kit fills in below as it is made.')}</span>
          <Button variant="plain" size="sm" onClick={() => onOpenMcp()}>{t('Connect an Agent')}</Button>
        </div>}
      </section>

      <section className="om-studio-outputs" aria-label={t('Your kit')}>
        <header>
          <h2>{t('Your kit')}</h2>
          <span className="om-studio-progress">{t('{ready} of {total} ready', { ready: readyCount, total: deliverables.length })}</span>
          <Button variant="secondary" size="sm" icon={<RemixIcon name="download-2-line" size={14} />} disabled={!run || readyCount === 0 || exportingBundle}
            onClick={() => void onExportBundle()}>
            {t('Download the kit')}
          </Button>
        </header>
        <div className="om-studio-output-grid">
          {deliverables.map(step => (
            <DeliverableCard key={step.id} step={step} state={run?.steps[step.id]} run={run} poolById={poolById}
              example={examples.get(step.id)} onOpen={() => void leaveAfterSave(() => onOpenStep(step.id))} />
          ))}
        </div>
        <Button variant="plain" size="sm" className="om-studio-workflow-link" icon={<RemixIcon name="route-line" size={14} />} onClick={() => void leaveAfterSave(onSwitchToManual)}>
          {t('Fine-tune each step')}
        </Button>
      </section>
    </div>
  );
}
