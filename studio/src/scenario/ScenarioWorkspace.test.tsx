// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { ScenarioRun, ScenarioRunSummary, StepIteration } from '../../../shared/scenario-runs';
import { findScenario } from '../../../shared/scenarios';
import { I18nProvider } from '../i18n/I18n';
import { IterationHistory } from './IterationHistory';
import { ScenarioHub } from './ScenarioHub';
import { ScenarioWorkspace } from './ScenarioWorkspace';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ITER_1 = '22222222-2222-4222-8222-222222222222';
const ITER_2 = '33333333-3333-4333-8333-333333333333';
const ITER_3 = '44444444-4444-4444-8444-444444444444';

function makeRun(overrides: Partial<ScenarioRun> = {}): ScenarioRun {
  const scenario = findScenario('black-friday')!;
  const steps: ScenarioRun['steps'] = {};
  for (const step of scenario.steps) {
    steps[step.id] = {
      stepId: step.id,
      status: step.type === 'brief' ? 'in-progress' : 'todo',
      iterations: [],
      activeIterationId: null,
      bindings: {},
      draft: {},
      links: {},
    };
  }
  const now = Date.now();
  return {
    schemaVersion: 1,
    id: RUN_ID,
    scenarioId: 'black-friday',
    title: 'Holiday tote campaign',
    locale: 'en',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1,
    brief: { productName: 'Holiday Weekender Tote' },
    activeStepId: 'brief',
    steps,
    pool: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ScenarioWorkspace', () => {
  it('renders Black Friday steps in order, updates route on stepper click, exports bundle on Export all click, and renders toasts in feedback layer', async () => {
    const run = makeRun();
    const commands: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      commands.push(command);
      if (command === 'get') return jsonResponse({ run });
      if (command === 'list') return jsonResponse({ runs: [], nextOffset: null });
      if (command === 'export') {
        return jsonResponse({
          run,
          bundle: {
            bundleId: 'bundle-1',
            filename: 'holiday-tote.zip',
            bytes: 256,
            sha256: 'a'.repeat(64),
            archivePath: '/fixture/data/scenarios/bundles/bundle-1.zip',
            downloadUrl: '/motion-api/scenario/bundle/bundle-1',
            entries: 3,
          },
        });
      }
      return jsonResponse({ run });
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const onRoute = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            active
            onRoute={onRoute}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // All 5 Black Friday steps render in exact order as tabs.
    const tabs = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map(tab => tab.getAttribute('data-tab-id'))).toEqual([
      'brief',
      'product-images',
      'detail-page',
      'sales-film',
      'social',
    ]);

    // Clicking a stepper tab pushes the step patch into the route callback.
    const detailTab = tabs.find(tab => tab.getAttribute('data-tab-id') === 'detail-page')!;
    await act(async () => {
      detailTab.click();
    });
    expect(onRoute).toHaveBeenCalledWith({ run: RUN_ID, step: 'detail-page' }, false);

    // Clicking Export all triggers scenario export and displays Export ready toast.
    const exportCta = container.querySelector<HTMLButtonElement>('.om-scenario-export-cta')!;
    expect(exportCta).toBeTruthy();
    await act(async () => {
      exportCta.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(commands).toContain('export');
    expect(document.querySelector('.motion-feedback-layer [role="status"]')?.textContent).toContain('Export ready');

    // Copy for Agent copies the prompt and renders a floating toast in .motion-feedback-layer.
    const copyButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Copy for Agent'),
    )!;
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain(RUN_ID);
    const feedbackText = Array.from(document.querySelectorAll('.motion-feedback-layer [role="status"]'))
      .map(el => el.textContent)
      .join('\n');
    expect(feedbackText).toContain('Copied. Paste into your Agent.');
  });

  it('renders ScenarioHub category tabs and recent runs with resume and archive actions', async () => {
    const summary: ScenarioRunSummary = {
      id: RUN_ID,
      scenarioId: 'black-friday',
      title: 'Holiday tote campaign',
      createdAt: Date.now() - 5000,
      updatedAt: Date.now(),
      archivedAt: null,
      revision: 3,
      activeStepId: 'brief',
      poolCount: 4,
      doneSteps: 2,
      pendingJobs: 0,
    };

    const commands: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      commands.push(command);
      if (command === 'list') return jsonResponse({ runs: [summary], nextOffset: null });
      if (command === 'update_run') return jsonResponse({ run: makeRun({ archivedAt: Date.now() }) });
      return jsonResponse({ error: 'UNSUPPORTED' }, 400);
    });

    const onCategory = vi.fn();
    const onOpenScenario = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioHub
            category={null}
            active
            onCategory={onCategory}
            onOpenScenario={onOpenScenario}
            onExplore={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // All 5 scenarios render when category is null.
    expect(container.querySelectorAll('[data-scenario-card]')).toHaveLength(5);

    // Recent run renders and Resume opens it.
    const row = container.querySelector(`[data-run-row="${RUN_ID}"]`)!;
    expect(row.textContent).toContain('Holiday tote campaign');
    const resumeBtn = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Resume'),
    )!;
    act(() => {
      resumeBtn.click();
    });
    expect(onOpenScenario).toHaveBeenCalledWith('black-friday', RUN_ID);

    // Archive button archives the draft and removes it from the list.
    const archiveBtn = row.querySelector<HTMLButtonElement>('button[aria-label="Archive draft"]')!;
    await act(async () => {
      archiveBtn.click();
      await Promise.resolve();
    });
    expect(commands).toContain('update_run');
    expect(container.querySelector(`[data-run-row="${RUN_ID}"]`)).toBeNull();
  });

  it('supports newest-first rendering, side-by-side compare, promote, use settings, notes, and retry in IterationHistory', async () => {
    const scenario = findScenario('black-friday')!;
    const step = scenario.steps.find(s => s.id === 'product-images')!;
    const iterations: StepIteration[] = [
      {
        id: ITER_1,
        number: 1,
        createdAt: Date.now() - 60000,
        source: 'generated',
        prompt: 'First prompt',
        settings: { scene: 'text-to-image' },
        inputs: [],
        outputs: [],
      },
      {
        id: ITER_2,
        number: 2,
        createdAt: Date.now() - 30000,
        source: 'generated',
        prompt: 'Second prompt',
        settings: { scene: 'relight' },
        inputs: [],
        outputs: [],
      },
      {
        id: ITER_3,
        number: 3,
        createdAt: Date.now() - 10000,
        source: 'generated',
        prompt: 'Failed prompt',
        inputs: [],
        outputs: [],
        job: {
          jobId: 'job-failed',
          state: 'failed',
          modality: 'image',
          model: 'test-model',
          error: 'Provider timeout',
        },
      },
    ];

    const onPromote = vi.fn().mockResolvedValue(undefined);
    const onUseSettings = vi.fn().mockResolvedValue(undefined);
    const onSaveNote = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <IterationHistory
            step={step}
            state={{
              stepId: step.id,
              status: 'in-progress',
              iterations,
              activeIterationId: ITER_1,
              bindings: {},
              draft: {},
              links: {},
            }}
            renderOutput={iter => <span>Output #{iter.number}</span>}
            onPromote={onPromote}
            onUseSettings={onUseSettings}
            onSaveNote={onSaveNote}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        </I18nProvider>,
      );
    });

    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-iteration-id]'));
    expect(cards.map(card => card.getAttribute('data-iteration-id'))).toEqual([ITER_3, ITER_2, ITER_1]);

    // Retry failed job.
    const retryBtn = Array.from(cards[0].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Retry'),
    )!;
    await act(async () => {
      retryBtn.click();
    });
    expect(onRetry).toHaveBeenCalledWith(iterations[2]);

    // Promote v2.
    const promoteBtn = Array.from(cards[1].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Make active'),
    )!;
    await act(async () => {
      promoteBtn.click();
    });
    expect(onPromote).toHaveBeenCalledWith(ITER_2);

    // Use settings on v2.
    const useSettingsBtn = Array.from(cards[1].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Use settings'),
    )!;
    await act(async () => {
      useSettingsBtn.click();
    });
    expect(onUseSettings).toHaveBeenCalledWith(iterations[1]);

    // Compare two versions opens the side-by-side comparison panel.
    const compareBtn2 = Array.from(cards[1].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Compare'),
    )!;
    const compareBtn1 = Array.from(cards[2].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Compare'),
    )!;
    await act(async () => {
      compareBtn2.click();
    });
    await act(async () => {
      compareBtn1.click();
    });
    const comparePanel = container.querySelector('.om-scenario-compare-panel');
    expect(comparePanel?.textContent).toContain('Compare v2 and v1');
  });

  it('supports desktop shared assets separator keyboard & pointer resizing within 240..520, dblclick reset to 320, and localStorage persistence', async () => {
    const run = makeRun();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      if (command === 'get') return jsonResponse({ run });
      return jsonResponse({ run });
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            active
            onRoute={vi.fn()}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const workspace = container.querySelector<HTMLElement>('.om-scenario-workspace')!;
    const separator = container.querySelector<HTMLElement>('[role="separator"][aria-label="Resize shared assets panel"]')!;
    expect(separator).toBeTruthy();
    expect(separator.getAttribute('aria-valuenow')).toBe('320');
    expect(workspace.style.getPropertyValue('--om-scenario-pool-width')).toBe('320px');

    // ArrowLeft widens (+20 -> 340) and persists.
    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('340');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('340');

    // ArrowRight narrows (-20 -> 320), and Home/End clamp to 520 / 240.
    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('320');

    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('520');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('520');

    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('520');

    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('240');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('240');

    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('240');

    // Double-click resets to 320.
    await act(async () => {
      separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('320');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('320');

    // Pointer drag left widens by delta and persists on pointerup.
    await act(async () => {
      separator.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 600, pointerId: 1, bubbles: true }));
    });
    await act(async () => {
      separator.dispatchEvent(new PointerEvent('pointermove', { clientX: 520, pointerId: 1, bubbles: true }));
    });
    await act(async () => {
      separator.dispatchEvent(new PointerEvent('pointerup', { clientX: 520, pointerId: 1, bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('400');
    expect(workspace.style.getPropertyValue('--om-scenario-pool-width')).toBe('400px');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('400');
  });

  it('supports desktop collapse/reopen toggle persisted in localStorage and auto-expands on requestPick', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const run = makeRun({ activeStepId: 'detail-page' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      if (url.includes('/motion-api/design')) {
        return jsonResponse({ items: [], nextCursor: null, projects: [] });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      if (command === 'get') return jsonResponse({ run });
      return jsonResponse({ run });
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="detail-page"
            active
            onRoute={vi.fn()}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const bodyEl = container.querySelector<HTMLElement>('.om-scenario-body')!;
    const poolAside = container.querySelector<HTMLElement>('#om-scenario-pool')!;
    expect(bodyEl.getAttribute('data-pool-collapsed')).toBe('false');
    expect(poolAside.hidden).toBe(false);

    // Collapse via panel collapse button.
    const collapseBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Collapse shared assets"]')!;
    await act(async () => { collapseBtn.click(); });
    expect(bodyEl.getAttribute('data-pool-collapsed')).toBe('true');
    expect(poolAside.hidden).toBe(true);
    expect(localStorage.getItem('opendesign.scenario.poolCollapsed')).toBe('true');

    // Reopen via header toggle button.
    const showBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Show shared assets (0)"]')!;
    expect(showBtn).toBeTruthy();
    await act(async () => { showBtn.click(); });
    expect(bodyEl.getAttribute('data-pool-collapsed')).toBe('false');
    expect(poolAside.hidden).toBe(false);
    expect(localStorage.getItem('opendesign.scenario.poolCollapsed')).toBe('false');

    // Collapse again, then trigger requestPick via BindingSlot's Choose assets button -> auto-expands.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse shared assets"]')!.click();
    });
    expect(poolAside.hidden).toBe(true);

    const chooseAssetsBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.om-step-binding-slot button')).find(
      btn => btn.textContent?.includes('Choose assets'),
    )!;
    expect(chooseAssetsBtn).toBeTruthy();
    await act(async () => { chooseAssetsBtn.click(); });

    expect(bodyEl.getAttribute('data-pool-collapsed')).toBe('false');
    expect(poolAside.hidden).toBe(false);
    expect(localStorage.getItem('opendesign.scenario.poolCollapsed')).toBe('false');
    expect(poolAside.textContent).toContain('Select assets for embedImages');
  });
});
