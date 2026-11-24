// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({ state: 'signed-out' as string }));
vi.mock('./AccountSettings', () => ({ useAccountSummary: () => ({ account: { state: account.state } }) }));
vi.mock('./useMediaCatalog', () => ({ useMediaCatalog: () => ({ catalog: { models: [], status: { providers: [{ id: 'gemini', label: 'Gemini', available: false }] } }, failed: false, retry: () => {} }) }));
vi.mock('./tracking', () => ({ trackMotion: vi.fn(async () => 'queued') }));
import { ModelHub } from './ModelHub';
import { I18nProvider } from '../i18n/I18n';
import modelHubUi from '../i18n/model-hub-ui.json';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root | undefined;
afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = undefined;
  }
  container?.remove();
});
async function render() {
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  const onProvider = vi.fn();
  await act(async () => root!.render(<I18nProvider initialLocale="en"><ModelHub id="gemini-4" onExplore={() => {}} onProvider={onProvider} onModel={() => {}} onUse={() => {}} onSettings={() => {}} /></I18nProvider>));
  return { onProvider, hero: () => [...container.querySelectorAll<HTMLButtonElement>('.om-model-hub-hero-copy button')].map(button => button.textContent) };
}

it('offers to connect when nothing is connected and shows the connection once signed in', async () => {
  account.state = 'signed-out';
  let view = await render();
  expect(view.hero()).toContain('Sign in to use Gemini 4 Neon now');
  expect(view.hero()).toContain('Connect your own API key');
  act(() => root!.unmount());
  root = undefined;
  container.remove();
  account.state = 'signed-in';
  view = await render();
  expect(view.hero()).toContain('Connected to OpenDesign');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-model-hub-connected')!.click());
  expect(view.onProvider).toHaveBeenCalledWith('account');
});

it('renders curated Seedance 2.5 and GPT Image 2.6 showcase galleries with lightbox preview and remix handoff', async () => {
  for (const hubId of ['seedance-2-5', 'gpt-image-2-6'] as const) {
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
    const onScene = vi.fn();
    await act(async () => root!.render(
      <I18nProvider initialLocale="zh-CN">
        <ModelHub id={hubId} onExplore={() => {}} onProvider={() => {}} onModel={() => {}} onUse={() => {}} onScene={onScene} onSettings={() => {}} />
      </I18nProvider>,
    ));

    const cards = container.querySelectorAll<HTMLElement>('.om-hub-showcase-card');
    expect(cards.length).toBeGreaterThan(0);

    await act(async () => cards[0].click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const promptBox = dialog!.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(promptBox.value.length).toBeGreaterThan(0);

    const remixBtn = dialog!.querySelector<HTMLButtonElement>('.om-hub-lightbox-cta')!;
    expect(remixBtn.textContent).toContain('一键做同款');
    await act(async () => remixBtn.click());

    expect(onScene).toHaveBeenCalledOnce();
    const [destination, draft] = onScene.mock.calls[0];
    expect(destination.scene.modality).toBe(hubId === 'seedance-2-5' ? 'video' : 'image');
    expect(draft).toMatchObject({
      modality: hubId === 'seedance-2-5' ? 'video' : 'image',
      prompt: promptBox.value,
      references: [],
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    act(() => root!.unmount());
    root = undefined;
    container.remove();
  }
});

it('localizes Seedance 2.5 and GPT Image 2.6 hubs across all 10 non-English locales and adapts masonry columns to viewport widths', async () => {
  const originalWidth = window.innerWidth;
  try {
    for (const [width, expectedCols] of [[375, 1], [768, 2], [1024, 3], [1440, 4]] as const) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      container = document.createElement('div'); document.body.append(container);
      root = createRoot(container);
      await act(async () => root!.render(
        <I18nProvider initialLocale="en">
          <ModelHub id="seedance-2-5" onExplore={() => {}} onProvider={() => {}} onModel={() => {}} onUse={() => {}} onSettings={() => {}} />
        </I18nProvider>,
      ));
      expect(container.querySelectorAll('.om-hub-masonry-col').length, `width ${width}`).toBe(expectedCols);
      act(() => root!.unmount());
      root = undefined;
      container.remove();
    }

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    for (const locale of ['zh-CN', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt-BR', 'it', 'tr'] as const) {
      const messages = modelHubUi[locale] as Record<string, string>;
      container = document.createElement('div'); document.body.append(container);
      root = createRoot(container);
      await act(async () => root!.render(
        <I18nProvider key={locale} initialLocale={locale}>
          <ModelHub id="seedance-2-5" onExplore={() => {}} onProvider={() => {}} onModel={() => {}} onUse={() => {}} onSettings={() => {}} />
        </I18nProvider>,
      ));
      expect(container.textContent, locale).toContain(messages['Start Creating']);
      expect(container.textContent, locale).toContain(messages['Fashion & Visual']);
      expect(container.textContent, locale).toContain(messages['Pastel Horizon Walk']);
      await act(async () => container.querySelector<HTMLElement>('.om-hub-showcase-card')!.click());
      expect(container.querySelector('.om-hub-lightbox-cta')!.textContent, locale).toContain(messages['Remix this look']);
      act(() => root!.unmount());
      root = undefined;
      container.remove();
    }
  } finally {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  }
});
