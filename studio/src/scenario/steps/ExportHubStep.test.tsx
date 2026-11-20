// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolItem, ScenarioBundleReceipt } from '../../../../shared/scenario-runs';
import { bundleDownloadUrl, ScenarioApiError } from '../scenarioClient';
import { ExportHubStep } from './ExportHubStep';
import { createStepProps, makeBaseRun, mountStep } from './stepTestHelpers';

vi.mock('../../motion/useIntegrationInfo', () => ({
  useIntegrationInfo: () => ({ info: { previewUrl: 'http://127.0.0.1:4197', dataDirectory: '/fixture/workspace' }, failed: false, retry: vi.fn() }),
}));

const receipt: ScenarioBundleReceipt = {
  bundleId: '99999999-9999-4999-8999-999999999999',
  filename: 'black-friday-20261120.zip',
  bytes: 42_500,
  sha256: 'e'.repeat(64),
  archivePath: '/fixture/bundles/99999999.zip',
  downloadUrl: '/motion-api/scenarios/bundles/99999999-9999-4999-8999-999999999999/file',
  entries: 12,
};

const samplePool: PoolItem[] = [
  {
    id: '33333333-3333-4333-8333-333333333331',
    kind: 'image',
    ref: { type: 'asset', assetId: '44444444-4444-4444-8444-444444444441', versionId: '55555555-5555-4555-8555-555555555551' },
    label: 'Product Hero',
    source: 'upload',
    stepId: 'product-images',
    tags: [],
    pinned: true,
    addedAt: 1700000000000,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExportHubStep', () => {
  it('builds a ZIP package with chosen options, shows Download toast action, and renders Last package card', async () => {
    const run = makeBaseRun('black-friday', {
      pool: samplePool,
      steps: {
        brief: { status: 'done' },
        'detail-page': {
          status: 'in-progress',
          links: { designProjectId: '22222222-2222-4222-8222-222222222222' },
        },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'export', {
      run,
      mutateImpl: (async () => ({ bundle: receipt })) as never,
    });
    const mounted = await mountStep(<ExportHubStep {...props} />);

    try {
      // Readiness warning for detail page without embedded images
      expect(mounted.container.textContent).toContain('Detail page has no embedded images.');
      expect(mounted.container.textContent).toContain('1 pinned');

      // Human-readable localized status & pool kind labels (not raw enum values)
      const detailCard = mounted.container.querySelector('[data-overview-step="detail-page"]')!;
      expect(detailCard.querySelector('[data-status="in-progress"]')?.textContent).toBe('In progress');
      expect(mounted.container.textContent).toContain('Image');
      expect(mounted.container.textContent).not.toContain('in-progress');

      // Open step button navigates to that step
      const openBtn = Array.from(detailCard.querySelectorAll('button')).find(b => b.textContent?.includes('Open step'))!;
      await act(async () => { openBtn.click(); });
      expect(mocks.nav.selectStep).toHaveBeenCalledWith('detail-page');

      // Toggle "Include Motion project source" on
      const motionCheckbox = mounted.container.querySelector('[aria-label="Include Motion project source"]') as HTMLElement;
      expect(motionCheckbox).toBeTruthy();
      await act(async () => { motionCheckbox.click(); });

      // Click Build ZIP package (all steps selected => omits stepIds for full bundle)
      const buildBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Build ZIP package'))!;
      await act(async () => { buildBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'export-bundle',
        'export',
        {
          activeOnly: true,
          includeStandaloneHtml: true,
          includeMotionSource: true,
        },
      );

      // Deselect one step => passes filtered stepIds
      const socialChip = Array.from(mounted.container.querySelectorAll('[aria-label="Included steps"] button'))
        .find(b => b.textContent?.includes('Social posts')) as HTMLButtonElement;
      await act(async () => { socialChip.click(); });
      await act(async () => { buildBtn.click(); });
      expect(mocks.mutate).toHaveBeenLastCalledWith(
        'export-bundle',
        'export',
        {
          activeOnly: true,
          includeStandaloneHtml: true,
          includeMotionSource: true,
          stepIds: ['brief', 'product-images', 'detail-page', 'sales-film'],
        },
      );

      // Toast has Download action
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Package ready',
        'info',
        'feedback',
        expect.objectContaining({
          label: 'Download',
          key: `download-${receipt.bundleId}`,
        }),
      );

      // Persistent Last package card has direct download link
      const downloadLink = mounted.container.querySelector<HTMLAnchorElement>(`[data-last-package="${receipt.bundleId}"] a`);
      expect(downloadLink?.getAttribute('href')).toBe(bundleDownloadUrl(receipt.bundleId));
      expect(downloadLink?.getAttribute('download')).toBe(receipt.filename);
      expect(mounted.container.textContent).toContain('12 files');

      // Open MCP button
      const mcpBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Open MCP · Connect Agent'))!;
      await act(async () => { mcpBtn.click(); });
      expect(mocks.nav.openMcp).toHaveBeenCalledWith('scenario-black-friday');
    } finally {
      await mounted.unmount();
    }
  });

  it('does not emit a duplicate error toast when mutate rejects with SCENARIO_CONFLICT', async () => {
    const run = makeBaseRun('black-friday', { pool: samplePool });
    const { props, mocks } = createStepProps('black-friday', 'export', {
      run,
      mutateImpl: (async () => {
        throw new ScenarioApiError('SCENARIO_CONFLICT', 'SCENARIO_CONFLICT: revision 1 != 2', 409);
      }) as never,
    });
    const mounted = await mountStep(<ExportHubStep {...props} />);
    try {
      const buildBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Build ZIP package'))!;
      await act(async () => { buildBtn.click(); });
      expect(mocks.showToast).not.toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
  });
});
