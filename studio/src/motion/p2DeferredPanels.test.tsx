// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { DesignProjectList } from '../design/DesignProjectList';
import { BrandKitPage } from './BrandKitPage';
import { GameStudio } from './game/GameStudio';
import { ScenarioHub } from '../scenario/ScenarioHub';
import { useReviewComments } from './useReviewComments';
import { isDeferredP2Error, isDeferredP2Payload } from './p2Deferred';

vi.mock('./pageTracking', () => ({
  reportBrandKitPageView: vi.fn(),
  reportBrandDetailShown: vi.fn(),
  reportBrandCollectionTab: vi.fn(),
  reportBrandCardOpened: vi.fn(),
  reportBrandSurprise: vi.fn(),
  reportBrandDetailClick: vi.fn(),
  reportBrandCopyResult: vi.fn(),
  reportBrandDownloadResult: vi.fn(),
  reportBrandActionResult: vi.fn(),
  reportBrandKitCreateResult: vi.fn(),
  reportBrandKitImportResult: vi.fn(),
  reportNewBrandKitClicked: vi.fn(),
  newTrackingId: () => 'track-1',
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const deferredResponse = () =>
  Response.json({ code: 'FEATURE_DEFERRED_P2', error: 'Deferred to Phase 2' }, { status: 501 });

it('identifies 501 and FEATURE_DEFERRED_P2 payloads and errors', () => {
  expect(isDeferredP2Payload(501, {})).toBe(true);
  expect(isDeferredP2Payload(400, { code: 'FEATURE_DEFERRED_P2' })).toBe(true);
  expect(isDeferredP2Payload(200, { error: { code: 'DESIGN_STUDIO_CLOUD_P2' } })).toBe(true);
  expect(isDeferredP2Payload(500, { error: 'boom' })).toBe(false);
  expect(isDeferredP2Error(Object.assign(new Error('Deferred'), { status: 501 }))).toBe(true);
  expect(isDeferredP2Error(Object.assign(new Error('ASR_PROVIDER_UNCONFIGURED: missing'), {}))).toBe(true);
  expect(isDeferredP2Error(new Error('Network error'))).toBe(false);
});

it('renders a graceful Phase 2 notice in DesignProjectList on 501 FEATURE_DEFERRED_P2 without crashing', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => deferredResponse()));
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<I18nProvider initialLocale="en"><DesignProjectList onOpen={vi.fn()} /></I18nProvider>));
  expect(host.querySelector('[data-deferred-p2="true"]')?.textContent).toContain('Design Studio is coming in Phase 2');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('renders a graceful Phase 2 notice in BrandKitPage and stops background polling on 501 FEATURE_DEFERRED_P2', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => deferredResponse());
  vi.stubGlobal('fetch', fetcher);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<I18nProvider initialLocale="en"><BrandKitPage selectedId="mine" inWorkspace onSelect={vi.fn()} /></I18nProvider>));
  expect(host.querySelector('[data-deferred-p2="true"]')?.textContent).toContain('Brand Kit capture is coming in Phase 2');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  const callsAfterInitial = fetcher.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(fetcher.mock.calls.length).toBe(callsAfterInitial);
});

it('marks useReviewComments as deferred and stops polling on 501 FEATURE_DEFERRED_P2', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => deferredResponse());
  vi.stubGlobal('fetch', fetcher);
  let state!: ReturnType<typeof useReviewComments>;
  function Probe() {
    state = useReviewComments('proj-1', true);
    return <div data-deferred={String(state.deferred)}>{state.error}</div>;
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe />));
  expect(state.deferred).toBe(true);
  expect(state.error).toBe('');
  const callsAfterInitial = fetcher.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(fetcher.mock.calls.length).toBe(callsAfterInitial);
});

it('renders a graceful Phase 2 notice in GameStudio and stops polling on 501 FEATURE_DEFERRED_P2', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => deferredResponse());
  vi.stubGlobal('fetch', fetcher);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<I18nProvider initialLocale="en"><GameStudio onExplore={vi.fn()} onOpenMcp={vi.fn()} /></I18nProvider>));
  expect(host.querySelector('[data-deferred-p2="true"]')?.textContent).toContain('Game Studio is coming in Phase 2.');
  const callsAfterInitial = fetcher.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(fetcher.mock.calls.length).toBe(callsAfterInitial);
});

it('renders a graceful Phase 2 notice in ScenarioHub without an error alert on 501 FEATURE_DEFERRED_P2', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => deferredResponse()));
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <I18nProvider initialLocale="en">
      <ScenarioHub category={null} active onCategory={vi.fn()} onOpenScenario={vi.fn()} onExplore={vi.fn()} />
    </I18nProvider>,
  ));
  expect(host.querySelector('[data-deferred-p2="true"]')?.textContent).toContain('Workflows are coming in Phase 2.');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
