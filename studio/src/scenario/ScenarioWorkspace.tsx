import type { ScenarioWorkspaceProps } from './stepContract';

export type { ScenarioWorkspaceProps };

export function ScenarioWorkspace({ scenarioId, runId, stepId, active }: ScenarioWorkspaceProps) {
  return (
    <section
      data-scenario-workspace={scenarioId}
      data-run-id={runId ?? ''}
      data-step-id={stepId ?? ''}
      data-active={active ? 'true' : 'false'}
    />
  );
}
