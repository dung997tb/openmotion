// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { PoolItem } from '../../../shared/scenario-runs';
import { findScenario } from '../../../shared/scenarios';
import { I18nProvider } from '../i18n/I18n';
import * as assetClient from '../motion/assetClient';
import { AssetPoolPanel, type AssetPoolPanelProps } from './AssetPoolPanel';

const IMG_ITEM_1: PoolItem = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'image',
  ref: {
    type: 'asset',
    assetId: '11111111-1111-4111-8111-111111111111',
    versionId: '22222222-2222-4222-8222-222222222222',
  },
  label: 'Hero Tote Shot',
  source: 'generated',
  stepId: 'product-images',
  tags: [],
  pinned: false,
  addedAt: 1700000001000,
};

const IMG_ITEM_2: PoolItem = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'image',
  ref: {
    type: 'asset',
    assetId: '33333333-3333-4333-8333-333333333333',
    versionId: '44444444-4444-4444-8444-444444444444',
  },
  label: 'Uploaded Flatlay',
  source: 'upload',
  stepId: null,
  tags: [],
  pinned: true,
  addedAt: 1700000000500,
};

const TEXT_ITEM: PoolItem = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  kind: 'text',
  ref: {
    type: 'text',
    stepId: 'social',
    iterationId: '55555555-5555-4555-8555-555555555555',
  },
  label: 'Black Friday Launch Posts',
  source: 'step-output',
  stepId: 'social',
  tags: [],
  pinned: false,
  addedAt: 1700000002000,
};

let container: HTMLDivElement;
let root: Root;

function baseProps(overrides: Partial<AssetPoolPanelProps> = {}): AssetPoolPanelProps {
  const scenario = findScenario('black-friday')!;
  return {
    scenario,
    run: null,
    currentStep: scenario.steps.find(s => s.id === 'detail-page')!,
    items: [IMG_ITEM_1, IMG_ITEM_2, TEXT_ITEM],
    highlightedIds: new Set(),
    open: true,
    onOpenChange: vi.fn(),
    pickRequest: null,
    onConfirmPick: vi.fn(),
    onCancelPick: vi.fn(),
    onAddItems: vi.fn().mockResolvedValue(['new-id']),
    onUpdateItem: vi.fn().mockResolvedValue(undefined),
    onRemoveItem: vi.fn().mockResolvedValue(undefined),
    onUseInCurrentStep: vi.fn().mockResolvedValue(undefined),
    onOpenDesignProject: vi.fn(),
    onOpenMotionProject: vi.fn().mockResolvedValue(true),
    toast: { showToast: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('AssetPoolPanel', () => {
  it('sorts pinned items first, applies immediate kind filters with live counts, and uses only ODUI buttons', async () => {
    const props = baseProps();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    // Every rendered <button> must carry data-odui-component (no raw native buttons).
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.hasAttribute('data-odui-component')).toBe(true);
    }

    // Pinned item sorts first ahead of newer unpinned items.
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-pool-item]'));
    expect(cards.map(c => c.getAttribute('data-pool-item'))).toEqual([
      IMG_ITEM_2.id,
      TEXT_ITEM.id,
      IMG_ITEM_1.id,
    ]);

    // Kind chip counts reflect the pool.
    const imagesChip = Array.from(container.querySelectorAll<HTMLButtonElement>('.om-scenario-kind-chips button')).find(
      btn => btn.textContent?.includes('Images'),
    )!;
    expect(imagesChip.textContent).toContain('2');

    // Clicking Images filters immediately to the 2 images.
    await act(async () => {
      imagesChip.click();
    });
    const filteredCards = Array.from(container.querySelectorAll<HTMLElement>('[data-pool-item]'));
    expect(filteredCards).toHaveLength(2);
    expect(filteredCards.every(card => card.getAttribute('data-kind') === 'image')).toBe(true);

    // Active filter chip appears and clicking Clear all resets filters.
    const clearAllBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.om-scenario-active-filters button'),
    ).find(btn => btn.textContent?.includes('Clear all'))!;
    await act(async () => {
      clearAllBtn.click();
    });
    expect(container.querySelectorAll('[data-pool-item]')).toHaveLength(3);
  });

  it('uploads files via uploadLibraryAsset and calls onAddItems with source=upload', async () => {
    const uploadSpy = vi.spyOn(assetClient, 'uploadLibraryAsset').mockResolvedValue({
      id: '99999999-9999-4999-8999-999999999999',
      name: 'product.png',
      modality: 'image',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentVersionId: '88888888-8888-4888-8888-888888888888',
      versions: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          createdAt: Date.now(),
          source: 'upload',
          filename: 'product.png',
          mimeType: 'image/png',
          bytes: 128,
          sha256: 'a'.repeat(64),
          references: [],
        },
      ],
    });

    const props = baseProps({ items: [] });
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['png-bytes'], 'product.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(uploadSpy).toHaveBeenCalledWith(file);
    expect(props.onAddItems).toHaveBeenCalledWith([
      {
        ref: {
          type: 'asset',
          assetId: '99999999-9999-4999-8999-999999999999',
          versionId: '88888888-8888-4888-8888-888888888888',
        },
        label: 'product.png',
        stepId: null,
        source: 'upload',
      },
    ]);
    expect(props.toast.showToast).toHaveBeenCalledWith(
      'Added 1 file(s) to workflow pool',
      'info',
      'feedback',
    );
  });

  it('filters by accepted kinds in pick mode and returns selected ids on confirm', async () => {
    const onConfirmPick = vi.fn();
    const onCancelPick = vi.fn();
    const props = baseProps({
      pickRequest: {
        slot: 'embedImages',
        kinds: ['image'],
        max: 2,
        selected: [IMG_ITEM_1.id],
      },
      onConfirmPick,
      onCancelPick,
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    // Only the 2 image items are shown; text item is hidden in image pick mode.
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-pool-item]'));
    expect(cards).toHaveLength(2);

    // Select the second image as well.
    const checkbox2 = container.querySelector<HTMLElement>(
      `[aria-label="Select ${IMG_ITEM_2.label}"]`,
    )!;
    await act(async () => {
      checkbox2.click();
    });

    // Click "Use 2 selected".
    const useBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.om-scenario-pick-actions button'),
    ).find(btn => btn.textContent?.includes('Use 2 selected'))!;
    expect(useBtn).toBeTruthy();
    await act(async () => {
      useBtn.click();
    });

    expect(onConfirmPick).toHaveBeenCalledWith([IMG_ITEM_1.id, IMG_ITEM_2.id]);
  });

  it('filters by source step in the anchored step-filter popover and supports clear-all', async () => {
    const props = baseProps();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    const stepFilterBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      btn => btn.textContent?.includes('Step filter'),
    )!;
    await act(async () => {
      stepFilterBtn.click();
      await Promise.resolve();
    });

    // Check "Added manually" inside the popover portal.
    const manualCheckbox = document.querySelector<HTMLElement>('[aria-label="Added manually"]')!;
    expect(manualCheckbox).toBeTruthy();
    await act(async () => {
      manualCheckbox.click();
    });

    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-pool-item]'));
    expect(cards.map(c => c.getAttribute('data-pool-item'))).toEqual([IMG_ITEM_2.id]);

    // Clear all inside popover restores all 3 items.
    const clearAll = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.om-scenario-popover-footer button'),
    ).find(btn => btn.textContent?.includes('Clear all'))!;
    await act(async () => {
      clearAll.click();
    });
    expect(container.querySelectorAll('[data-pool-item]')).toHaveLength(3);
  });

  it('removes only the workflow binding via card menu and notifies user the original workspace asset was kept', async () => {
    const props = baseProps();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    const card = container.querySelector<HTMLElement>(`[data-pool-item="${IMG_ITEM_1.id}"]`)!;
    const menuTrigger = card.querySelector<HTMLButtonElement>('button[aria-label="Asset actions"]')!;
    await act(async () => {
      menuTrigger.click();
      await Promise.resolve();
    });

    const removeItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      item => item.textContent?.includes('Remove from workflow'),
    )!;
    expect(removeItem).toBeTruthy();
    await act(async () => {
      removeItem.click();
      await Promise.resolve();
    });

    expect(props.onRemoveItem).toHaveBeenCalledWith(IMG_ITEM_1.id);
    expect(props.toast.showToast).toHaveBeenCalledWith(
      'Removed from workflow. Original workspace asset was kept.',
      'info',
      'feedback',
    );
  });

  it('opens the workspace AssetPicker from the empty state Pick from workspace button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ assets: [], total: 0, nextOffset: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const props = baseProps({ items: [] });
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AssetPoolPanel {...props} />
        </I18nProvider>,
      );
    });

    const pickBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Pick from workspace'),
    )!;
    await act(async () => {
      pickBtn.click();
      await Promise.resolve();
    });

    expect(document.querySelector('.om-asset-picker')).toBeTruthy();
  });
});
