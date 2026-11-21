import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import {
  findScenario,
  scenarioCategories,
  scenarioDefinitions,
  type ScenarioCategory,
  type ScenarioId,
} from '../../../shared/scenarios';
import type { ScenarioRunSummary } from '../../../shared/scenario-runs';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { PanelEmptyState } from '../components/ui/PanelEmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Tab, Tabs, TabsList } from '../components/ui/Tabs';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { BackToExploreButton } from '../motion/BackToExploreButton';
import { ScenarioCard } from './ScenarioCard';
import { scenarioClient } from './scenarioClient';
import { scenarioCover } from './scenarioCovers';
import { makeScenarioRequestId } from './useScenarioRun';
import './scenario.css';

export type ScenarioHubProps = {
  category: ScenarioCategory | null;
  active: boolean;
  onCategory(category: ScenarioCategory | null): void;
  onOpenScenario(id: ScenarioId, runId?: string): void;
  onExplore(): void;
};

function RunCoverThumb({ scenarioId }: { scenarioId: ScenarioId }) {
  const src = scenarioCover(scenarioId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span className="om-scenario-run-cover" aria-hidden="true">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <CoverPlaceholder fill />
      )}
    </span>
  );
}

export function ScenarioHub({
  category,
  active,
  onCategory,
  onOpenScenario,
  onExplore,
}: ScenarioHubProps) {
  const { t, formatDate } = useI18n();
  const toast = useToast();
  const [runs, setRuns] = useState<ScenarioRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const res = await scenarioClient.list({ limit: 12 });
      setRuns(res.runs ?? []);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : t('Could not load recent drafts'));
    } finally {
      setRunsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!active) return;
    void loadRuns();
  }, [active, loadRuns]);

  const filteredScenarios = useMemo(
    () => (category ? scenarioDefinitions.filter(item => item.category === category) : [...scenarioDefinitions]),
    [category],
  );

  const handleArchive = useCallback(
    async (run: ScenarioRunSummary) => {
      setArchivingId(run.id);
      try {
        await scenarioClient.updateRun({
          runId: run.id,
          expectedRevision: run.revision,
          requestId: makeScenarioRequestId('archive'),
          changes: { archived: true },
        });
        setRuns(prev => prev.filter(item => item.id !== run.id));
        toast.showToast(t('Draft archived'), 'info', 'feedback');
      } catch (err) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not archive draft'),
          'error',
          'feedback',
        );
      } finally {
        setArchivingId(null);
      }
    },
    [t, toast],
  );

  return (
    <section
      className="om-scenario-hub"
      data-scenario-hub=""
      data-category={category ?? 'all'}
      data-active={active ? 'true' : 'false'}
      aria-label={t('Workflows')}
    >
      <div className="om-scenario-hub-inner">
        <div className="om-scenario-hub-topbar">
          <BackToExploreButton onClick={onExplore} />
        </div>

        <header className="om-scenario-hub-hero">
          <div className="om-scenario-hub-hero-copy">
            <h1 className="om-title">{t('Workflows')}</h1>
            <p className="om-muted">
              {t('Pick a goal to go from an idea to visuals, pages, videos, social posts, and one download.')}
            </p>
          </div>

          <Tabs
            value={category ?? 'all'}
            onValueChange={value => onCategory(value === 'all' ? null : (value as ScenarioCategory))}
          >
            <TabsList aria-label={t('Workflow categories')} className="om-scenario-hub-tabs">
              <Tab value="all">
                <span>{t('All')}</span>
                <span className="om-scenario-tab-count">{scenarioDefinitions.length}</span>
              </Tab>
              {scenarioCategories.map(cat => {
                const count = scenarioDefinitions.filter(s => s.category === cat.id).length;
                return (
                  <Tab key={cat.id} value={cat.id}>
                    <RemixIcon name={cat.icon} size={14} />
                    <span>{t(cat.label)}</span>
                    <span className="om-scenario-tab-count">{count}</span>
                  </Tab>
                );
              })}
            </TabsList>
          </Tabs>
        </header>

        <div className="om-scenario-hub-grid">
          {filteredScenarios.map(scenario => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              variant="card"
              onStart={() => onOpenScenario(scenario.id)}
            />
          ))}
        </div>

        <section className="om-scenario-hub-runs" aria-labelledby="om-scenario-recent-runs-heading">
          <div className="om-scenario-hub-runs-header">
            <div>
              <h2 id="om-scenario-recent-runs-heading" className="om-subtitle">
                {t('Recent drafts')}
              </h2>
              <p className="om-muted">
                {t('Pick up right where you left off — your notes, versions, and shared assets are all saved.')}
              </p>
            </div>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t('Refresh recent drafts')}
              onClick={() => void loadRuns()}
              icon={<RemixIcon name="refresh-line" size={16} />}
            />
          </div>

          {runsLoading ? (
            <div className="om-scenario-runs-skeleton" role="status" aria-label={t('Loading recent drafts')}>
              <Skeleton className="om-scenario-run-skeleton-row" />
              <Skeleton className="om-scenario-run-skeleton-row" />
              <Skeleton className="om-scenario-run-skeleton-row" />
            </div>
          ) : runsError ? (
            <div className="om-scenario-runs-error" role="alert">
              <RemixIcon name="error-warning-line" size={20} />
              <span>{runsError}</span>
              <Button variant="secondary" size="sm" onClick={() => void loadRuns()}>
                {t('Retry')}
              </Button>
            </div>
          ) : runs.length === 0 ? (
            <div className="om-scenario-runs-empty">
              <PanelEmptyState
                icon="route-line"
                message={t('No drafts yet')}
                description={t('Start any workflow above to keep your ideas, visuals, and exports organized in one place.')}
              />
            </div>
          ) : (
            <ul className="om-scenario-runs-list">
              {runs.map(run => {
                const def = findScenario(run.scenarioId);
                const totalSteps = def?.steps.length ?? 0;
                return (
                  <li key={run.id} className="om-scenario-run-row" data-run-row={run.id}>
                    <RunCoverThumb scenarioId={run.scenarioId} />
                    <div className="om-scenario-run-row-main">
                      <div className="om-scenario-run-row-title-line">
                        <strong className="om-scenario-run-row-title">{run.title}</strong>
                        {def && <span className="om-badge">{t(def.title)}</span>}
                        {run.pendingJobs > 0 && (
                          <span className="om-badge" data-active="true">
                            <RemixIcon name="loader-4-line" size={12} className="om-scenario-spin" />
                            {t('{count} running', { count: run.pendingJobs })}
                          </span>
                        )}
                      </div>
                      <div className="om-scenario-run-row-meta">
                        <span>{t('{done}/{total} steps done', { done: run.doneSteps, total: totalSteps })}</span>
                        <span>·</span>
                        <span>{t('{count} assets', { count: run.poolCount })}</span>
                        <span>·</span>
                        <span>
                          {formatDate(run.updatedAt, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="om-scenario-run-row-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onOpenScenario(run.scenarioId, run.id)}
                      >
                        {t('Resume')}
                      </Button>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        disabled={archivingId === run.id}
                        aria-label={t('Archive draft')}
                        onClick={() => void handleArchive(run)}
                        icon={<RemixIcon name="delete-bin-line" size={15} />}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <StudioToastViewport {...toast} />
    </section>
  );
}
