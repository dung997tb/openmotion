// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { scenarioDefinitions, type ScenarioId } from '../../../shared/scenarios';
import { I18nProvider } from '../i18n/I18n';
import { CreativeNavigation, type CreativeNavigationProps } from './CreativeNavigation';
import { selectMegaMenuRecentRuns } from './ScenarioMegaMenu';

vi.mock('./tracking', () => ({ trackMotion: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/motion-api/phase1/call') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body?.arguments?.action === 'scenario' && body?.arguments?.scenario?.command === 'list') {
          return Response.json({
            runs: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                scenarioId: 'black-friday',
                title: 'Holiday Tote Campaign',
                createdAt: 1000,
                updatedAt: 2000,
                archivedAt: null,
                revision: 2,
                activeStepId: 'product-images',
                poolCount: 3,
                doneSteps: 1,
                pendingJobs: 0,
              },
            ],
            nextOffset: null,
          });
        }
      }
      return Response.json({ models: [], status: { providers: [] } });
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function baseProps(overrides: Partial<CreativeNavigationProps> = {}): CreativeNavigationProps {
  return {
    onChooseStudio: vi.fn(),
    specialty: null,
    destination: null,
    motionActive: false,
    onNavigate: vi.fn(),
    currentPage: 'explore',
    onOpenPage: vi.fn(),
    trackingPage: 'explore',
    scenarioActive: null,
    onOpenScenario: vi.fn(),
    onOpenScenarioHub: vi.fn(),
    ...overrides,
  };
}

async function renderNav(overrides: Partial<CreativeNavigationProps> = {}) {
  const props = baseProps(overrides);
  await act(async () => {
    root!.render(
      <I18nProvider initialLocale="en">
        <div data-motion-studio="">
          <CreativeNavigation {...props} />
        </div>
      </I18nProvider>,
    );
  });
  return props;
}

const allStudiosButton = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(btn => btn.textContent?.trim() === 'All studios')!;

async function openAllStudios() {
  await act(async () => {
    allStudiosButton().click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return document.querySelector<HTMLElement>('.om-nav-all-studios')!;
}

it('keeps the media menus first, Motion, Design and Game right after the divider, and All studios last with every studio', async () => {
  const props = await renderNav();
  const slots = [...container.querySelectorAll<HTMLElement>('.om-creative-strip > [data-nav-slot]')];
  const labels = slots.map(slot => {
    const btn = slot.querySelector<HTMLButtonElement>('button:not([aria-expanded])');
    return btn?.getAttribute('aria-label') ?? btn?.textContent?.trim();
  });
  expect(labels.slice(0, 8)).toEqual(['Explore', 'Image', 'Video', 'Audio', 'MCP', 'Motion Studio', 'Design Studio', 'Game Studio']);
  expect(slots[5].hasAttribute('data-studio-start')).toBe(true);
  expect(allStudiosButton()).toBeDefined();

  let panel = await openAllStudios();
  expect(panel).not.toBeNull();
  const sceneTabs = [...panel.querySelectorAll<HTMLButtonElement>('[data-studio-scene-tab]')];
  expect(sceneTabs.map(tab => tab.textContent)).toEqual(['All scenes', 'E-commerce', 'Marketing', 'Social', 'Film']);
  const creative = () => [...panel.querySelectorAll<HTMLElement>('[data-creative-studio]')].map(tile => tile.dataset.creativeStudio);
  const workflows = () => [...panel.querySelectorAll<HTMLElement>('[data-scenario-tile]')].map(tile => tile.dataset.scenarioTile);
  expect(creative().slice(0, 3)).toEqual(['motion', 'design', 'game']);
  expect(creative()).toHaveLength(9);
  expect(workflows()).toEqual(scenarioDefinitions.map(scenario => scenario.id));

  // The E-commerce scene keeps the studios made for selling products.
  await act(async () => sceneTabs[1].click());
  expect(creative()).toEqual(['design', 'marketing']);
  expect(workflows()).toEqual(['design-full-chain', 'black-friday']);
  await act(async () => sceneTabs[0].click());

  // A creative studio opens that studio.
  await act(async () => panel.querySelector<HTMLButtonElement>('[data-creative-studio="game"]')!.click());
  expect(props.onChooseStudio).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'game' }));

  // A recent run reopens its draft.
  panel = await openAllStudios();
  const runBtn = panel.querySelector<HTMLButtonElement>('.om-scenario-mega-run')!;
  expect(runBtn.textContent).toContain('Holiday Tote Campaign');
  await act(async () => runBtn.click());
  expect(props.onOpenScenario).toHaveBeenCalledWith('black-friday', '11111111-1111-1111-1111-111111111111');

  // A scene studio opens the studio; All workflows opens the hub.
  panel = await openAllStudios();
  await act(async () => panel.querySelector<HTMLButtonElement>('[data-scenario-tile="design-full-chain"]')!.click());
  expect(props.onOpenScenario).toHaveBeenLastCalledWith('design-full-chain', undefined);
  panel = await openAllStudios();
  const allBtn = panel.querySelector<HTMLButtonElement>('.om-scenario-mega-all')!;
  expect(allBtn.textContent).toContain('All workflows');
  await act(async () => allBtn.click());
  expect(props.onOpenScenarioHub).toHaveBeenCalledOnce();
});

it('marks All studios as current on a scene studio and highlights that studio', async () => {
  await renderNav({ currentPage: null, scenarioActive: 'ai-influencer' as ScenarioId });
  expect(allStudiosButton().getAttribute('aria-current')).toBe('page');
  await openAllStudios();
  expect(document.querySelector('[data-scenario-tile="ai-influencer"]')?.getAttribute('aria-current')).toBe('page');
  expect(document.querySelector('[data-scenario-tile="black-friday"]')?.getAttribute('aria-current')).toBeNull();
});

it('keeps All studios visible on narrow widths and moves the tabs that do not fit into it', async () => {
  const resizeCallbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        resizeCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-nav-slot') || this.querySelector?.('button')?.textContent === 'All studios') {
      return { width: 120, height: 32, top: 0, left: 0, right: 120, bottom: 32, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return originalRect.call(this);
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      if (this.classList?.contains('om-creative-navigation')) return 245;
      return 0;
    },
  });

  const props = await renderNav();
  const slots = [...container.querySelectorAll<HTMLElement>('.om-creative-strip > [data-nav-slot]')];
  // 245px fits Explore plus the All studios trigger; everything else moves into All studios.
  expect(slots[0].hasAttribute('data-stowed')).toBe(false);
  expect(slots[1].hasAttribute('data-stowed')).toBe(true);
  expect(allStudiosButton().closest('[data-stowed]')).toBeNull();

  const panel = await openAllStudios();
  const overflowTools = panel.querySelector<HTMLElement>('.om-nav-more-tools')!;
  expect(overflowTools.textContent).toContain('MCP');
  expect(panel.querySelector('[data-creative-studio="motion"]')).not.toBeNull();
  await act(async () => panel.querySelector<HTMLButtonElement>('.om-scenario-mega-all')!.click());
  expect(props.onOpenScenarioHub).toHaveBeenCalledOnce();
});

it('deduplicates recent runs per sub-workflow and caps the mega-menu recent strip to 3 items with overflow count', () => {
  const mk = (id: string, scenarioId: ScenarioId, title: string, updatedAt: number, archivedAt: number | null = null) => ({
    id,
    scenarioId,
    title,
    createdAt: updatedAt - 1000,
    updatedAt,
    archivedAt,
    revision: 1,
    activeStepId: 'brief',
    poolCount: 0,
    doneSteps: 0,
    pendingJobs: 0,
  });

  const { visible, hiddenCount } = selectMegaMenuRecentRuns([
    mk('r1', 'black-friday', 'Black Friday Latest', 5000),
    mk('r2', 'black-friday', 'Black Friday Older Duplicate', 4500),
    mk('r3', 'motion-full-chain', 'Motion Film Draft', 4000),
    mk('r4', 'design-full-chain', 'Landing Page Draft', 3500),
    mk('r5', 'ai-influencer', 'Creator Episode', 3000),
    mk('r6', 'gemini-4-neon', 'Archived Neon', 2500, 2600),
  ]);

  expect(visible.map(r => r.id)).toEqual(['r1', 'r3', 'r4']);
  expect(hiddenCount).toBe(2);
});
