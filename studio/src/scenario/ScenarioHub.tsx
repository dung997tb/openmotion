import type { ScenarioCategory, ScenarioId } from '../../../shared/scenarios';

export type ScenarioHubProps = {
  category: ScenarioCategory | null;
  active: boolean;
  onCategory(category: ScenarioCategory | null): void;
  onOpenScenario(id: ScenarioId, runId?: string): void;
  onExplore(): void;
};

export function ScenarioHub({ category, active }: ScenarioHubProps) {
  return <section data-scenario-hub data-category={category ?? 'all'} data-active={active ? 'true' : 'false'} />;
}
