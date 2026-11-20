import { useEffect, useRef } from 'react';
import type { ScenarioDefinition } from '../../../shared/scenarios';
import type { ScenarioRun, ScenarioStepState } from '../../../shared/scenario-runs';
import { Tab, Tabs, TabsList } from '../components/ui/Tabs';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { HorizontalRail } from '../motion/HorizontalRail';
import { countStepPendingJobs } from './useScenarioRun';

export type ScenarioStepperProps = {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  activeStepId: string;
  onSelectStep(stepId: string): void;
};

function statusGlyph(status: ScenarioStepState['status']): { icon: string; label: string } {
  switch (status) {
    case 'done':
      return { icon: 'checkbox-circle-fill', label: 'Done' };
    case 'in-progress':
      return { icon: 'checkbox-blank-circle-fill', label: 'In progress' };
    case 'skipped':
      return { icon: 'subtract-line', label: 'Skipped' };
    default:
      return { icon: 'circle-line', label: 'To do' };
  }
}

export function ScenarioStepper({
  scenario,
  run,
  activeStepId,
  onSelectStep,
}: ScenarioStepperProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeTab = containerRef.current?.querySelector<HTMLElement>(
      `[data-tab-id="${activeStepId}"]`,
    );
    if (activeTab && typeof activeTab.scrollIntoView === 'function') {
      activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  }, [activeStepId]);

  return (
    <nav className="om-scenario-stepper" aria-label={t('Workflow steps')} ref={containerRef}>
      <HorizontalRail
        label="Workflow steps"
        className="om-scenario-stepper-rail"
        viewportClassName="om-scenario-stepper-viewport"
        selection={activeStepId}
      >
        <Tabs
          value={activeStepId}
          onValueChange={next => {
            if (typeof next === 'string' && next !== activeStepId) {
              onSelectStep(next);
            }
          }}
        >
          <TabsList aria-label={t('Workflow steps')} className="om-scenario-stepper-list">
            {scenario.steps.map((step, index) => {
              const stepState = run?.steps[step.id];
              const status: ScenarioStepState['status'] =
                stepState?.status ?? (step.type === 'brief' ? 'in-progress' : 'todo');
              const pending = countStepPendingJobs(stepState);
              const glyph = statusGlyph(status);

              return (
                <Tab
                  key={step.id}
                  value={step.id}
                  className="om-scenario-step-tab"
                  data-step-status={status}
                >
                  <span className="om-scenario-step-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <RemixIcon name={step.icon} size={14} />
                  <span className="om-scenario-step-tab-title">{t(step.title)}</span>
                  <span
                    className="om-scenario-step-status-glyph"
                    data-status={status}
                    title={t(glyph.label)}
                    aria-label={t(glyph.label)}
                  >
                    <RemixIcon name={glyph.icon} size={status === 'in-progress' ? 10 : 14} />
                  </span>
                  {pending > 0 && (
                    <span
                      className="om-scenario-step-pending-badge"
                      aria-label={t('{count} jobs running', { count: pending })}
                    >
                      <RemixIcon name="loader-4-line" size={12} className="om-scenario-spin" />
                      <span>{pending}</span>
                    </span>
                  )}
                </Tab>
              );
            })}
          </TabsList>
        </Tabs>
      </HorizontalRail>
    </nav>
  );
}
