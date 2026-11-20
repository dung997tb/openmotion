import type { ReactNode } from 'react';
import type {
  PoolItem,
  ScenarioCommand,
  ScenarioRun,
  ScenarioStepState,
  StepIteration,
} from '../../../shared/scenario-runs';
import type {
  PoolKind,
  ScenarioDefinition,
  ScenarioId,
  ScenarioStepDefinition,
} from '../../../shared/scenarios';
import type { useToast } from '../hooks/useToast';
import type { StudioDestination } from '../motion/creativeStudios';

export type ScenarioRunApi = {
  ensureRun(): Promise<ScenarioRun>;
  mutate<T = { run: ScenarioRun }>(intent: string, command: ScenarioCommand, args: Record<string, unknown>): Promise<T>;
  refresh(): Promise<void>;
  busy: ReadonlySet<string>;
};

export type StepProps = {
  scenario: ScenarioDefinition;
  step: ScenarioStepDefinition;
  state: ScenarioStepState;
  run: ScenarioRun | null;
  active: boolean;
  api: ScenarioRunApi;
  pool: {
    items: PoolItem[];
    byId: Map<string, PoolItem>;
    requestPick(opts: { slot: string; kinds: PoolKind[]; max?: number; selected: string[] }): Promise<string[] | null>;
    highlight(ids: string[]): void;
  };
  toast: Pick<ReturnType<typeof useToast>, 'showToast'>;
  nav: {
    openDesignProject(id: string): void;
    openMotionProject(id: string): Promise<boolean>;
    openModelHub(id: string): void;
    openBlackFriday(trigger: HTMLElement): void;
    openTemplateLibrary(trigger: HTMLElement): void;
    openStudioScene(target: StudioDestination, prompt: string): void;
    openProviders(provider?: string): void;
    selectStep(stepId: string): void;
    openMcp(example?: string): void;
  };
  renderExportMenu(extraItems?: ReactNode): ReactNode;
  renderIterations(opts: { renderOutput(iteration: StepIteration): ReactNode }): ReactNode;
};

export type ScenarioWorkspaceProps = {
  scenarioId: ScenarioId;
  runId: string | null;
  stepId: string | null;
  active: boolean;
  onRoute(patch: { run?: string | null; step?: string | null }, replace?: boolean): void;
  onExplore(): void;
  onOpenHub(): void;
  breadcrumb?: ReactNode;
  onOpenDesignProject(id: string): void;
  onOpenMotionProject(id: string): Promise<boolean>;
  onOpenModelHub(id: string): void;
  onOpenBlackFriday(trigger: HTMLElement): void;
  onOpenTemplateLibrary(trigger: HTMLElement): void;
  onOpenStudioScene(target: StudioDestination, prompt: string): void;
  onOpenProviders(provider?: string): void;
  onOpenMcp(example?: string): void;
};
