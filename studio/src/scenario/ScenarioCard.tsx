import type { ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import type { ScenarioDefinition } from '../../../shared/scenarios';

export type ScenarioCardProps = {
  scenario: ScenarioDefinition;
  variant: 'tile' | 'card' | 'compact';
  onStart(): void;
  meta?: ReactNode;
};

export function ScenarioCard({ scenario, variant, onStart, meta }: ScenarioCardProps) {
  return (
    <div data-scenario-card={scenario.id} data-variant={variant}>
      <Button variant="plain" onClick={onStart}>
        <span>{scenario.title}</span>
      </Button>
      {meta}
    </div>
  );
}
