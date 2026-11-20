import { Button } from 'open-design-ui/button';
import { scenarioDefinitions, type ScenarioId } from '../../../shared/scenarios';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { ScenarioCard } from '../scenario/ScenarioCard';
import { HorizontalRail } from './HorizontalRail';
import { reportCreativeClick } from './exploreTracking';
import './scenarioNavigation.css';

export function ScenarioHighlights({
  onStartScenario,
  onOpenHub,
}: {
  onStartScenario: (id: ScenarioId) => void;
  onOpenHub: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="om-scenario-highlights" aria-labelledby="explore-workflows">
      <header className="om-discovery-heading">
        <div>
          <h2 id="explore-workflows">{t('End-to-end workflows')}</h2>
          <p className="om-muted">
            {t('Topics, campaigns and roles that carry every asset from idea to export.')}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="om-button h-auto"
          onClick={() => {
            reportCreativeClick('explore', 'explore_featured', 'open_studio', { navTarget: 'workflows' });
            onOpenHub();
          }}
        >
          {t('All workflows')}
          <RemixIcon name="arrow-right-line" size={16} />
        </Button>
      </header>
      <HorizontalRail
        label="End-to-end workflows"
        className="om-scenario-highlights-rail"
        viewportClassName="om-scenario-highlights-viewport"
      >
        {scenarioDefinitions.map(scenario => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            variant="card"
            onStart={() => {
              reportCreativeClick('explore', 'explore_featured', 'select_scene', {
                navTarget: 'workflows',
                studio: scenario.id,
              });
              onStartScenario(scenario.id);
            }}
          />
        ))}
      </HorizontalRail>
    </section>
  );
}
