// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Model } from '../../../../shared/gateway';
import type { PoolItem, StepIteration } from '../../../../shared/scenario-runs';
import { MediaStep } from './MediaStep';
import { createStepProps, makeBaseRun, mountStep, setFieldValue } from './stepTestHelpers';

vi.mock('../../motion/useIntegrationInfo', () => ({
  useIntegrationInfo: () => ({ info: { previewUrl: 'http://127.0.0.1:4197', dataDirectory: '/fixture/workspace' }, failed: false, retry: vi.fn() }),
}));

vi.mock('../../motion/ExploreTemplates', () => ({
  useExploreTemplates: () => ({ pages: [], loading: false, error: false, hasMore: false, retry: vi.fn(), loadMore: vi.fn() }),
}));

const mockUseMediaCatalog = vi.fn();
vi.mock('../../motion/useMediaCatalog', () => ({
  useMediaCatalog: (...args: unknown[]) => mockUseMediaCatalog(...args),
}));

const mockUploadLibraryAsset = vi.fn();
vi.mock('../../motion/assetClient', () => ({
  uploadLibraryAsset: (...args: unknown[]) => mockUploadLibraryAsset(...args),
  assetRequest: vi.fn(),
}));

const imagePoolItem: PoolItem = {
  id: '33333333-3333-4333-8333-333333333331',
  kind: 'image',
  ref: { type: 'asset', assetId: '44444444-4444-4444-8444-444444444441', versionId: '55555555-5555-4555-8555-555555555551' },
  label: 'Tote Hero',
  source: 'generated',
  stepId: 'product-images',
  tags: [],
  pinned: false,
  addedAt: 1700000000000,
};

const imageModel: Model = {
  id: 'fal:flux',
  provider: 'fal',
  modelId: 'fal-ai/flux/schnell',
  label: 'Flux Schnell',
  modality: 'image',
  source: 'builtin',
  mode: 'text-to-image',
  supportsImageReference: true,
  maxInputImages: 4,
};

const videoModel: Model = {
  id: 'fal:wan',
  provider: 'fal',
  modelId: 'fal-ai/wan/v2.2-a14b/text-to-video',
  label: 'Wan Video',
  modality: 'video',
  source: 'builtin',
  mode: 'text-to-video',
  maxInputImages: 1,
};

const speechModel: Model = {
  id: 'fal:kokoro',
  provider: 'fal',
  modelId: 'fal-ai/kokoro/american-english',
  label: 'Kokoro TTS',
  modality: 'audio',
  source: 'builtin',
  mode: 'text-to-speech',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('MediaStep', () => {
  it('shows provider-setup panel and hides Generate button when no compatible models are available', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: { status: { providers: [], agents: [], routes: {}, capabilities: [] }, models: [] },
      failed: false,
      retry: vi.fn(),
    });

    const { props, mocks } = createStepProps('black-friday', 'product-images');
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      expect(mounted.container.querySelector('[data-provider-setup="true"]')).toBeTruthy();
      expect(mounted.container.textContent).toContain('No image model is configured.');
      const generateBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate');
      expect(generateBtn).toBeUndefined();

      const setupBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Set up a provider'))!;
      await act(async () => { setupBtn.click(); });
      expect(mocks.nav.openProviders).toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
  });

  it('generates video with firstFrame referencePoolItemIds and switches to Motion project panel', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'fal', label: 'fal', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' }],
          agents: [],
          routes: { video: videoModel.id },
          capabilities: [{ modality: 'video', available: true, modelIds: [videoModel.id], selectedModelId: videoModel.id }],
        },
        models: [videoModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const run = makeBaseRun('black-friday', {
      pool: [imagePoolItem],
      steps: {
        'sales-film': {
          bindings: { firstFrame: [imagePoolItem.id] },
          draft: { prompt: '30s Black Friday tote showcase' },
        },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'sales-film', { run });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const generateBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate')!;
      expect(generateBtn.disabled).toBe(false);
      await act(async () => { generateBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'generate:sales-film',
        'generate',
        expect.objectContaining({
          stepId: 'sales-film',
          modality: 'video',
          model: videoModel.id,
          prompt: '30s Black Friday tote showcase',
          referencePoolItemIds: [imagePoolItem.id],
        }),
      );
      expect(mocks.showToast).toHaveBeenCalledWith('Generation started', 'info', 'feedback');

      // Switch to Motion project tab
      const motionTab = Array.from(mounted.container.querySelectorAll('[role="tab"]')).find(t => t.textContent?.includes('Motion project')) as HTMLElement;
      expect(motionTab).toBeTruthy();
      await act(async () => { motionTab.click(); });

      const createMotionBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Create Motion project'))!;
      await act(async () => { createMotionBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'create-motion:sales-film',
        'create_motion',
        expect.objectContaining({
          stepId: 'sales-film',
          projectType: 'natural_language',
          poolItemIds: [imagePoolItem.id],
        }),
      );

      // Browse full collection calls nav.openBlackFriday
      const browseBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Browse full collection'))!;
      await act(async () => { browseBtn.click(); });
      expect(mocks.nav.openBlackFriday).toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
  });

  it('uploads offline files via uploadLibraryAsset -> add_pool -> add_iteration', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: { status: { providers: [], agents: [], routes: {}, capabilities: [] }, models: [] },
      failed: false,
      retry: vi.fn(),
    });
    mockUploadLibraryAsset.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444449',
      name: 'product.png',
      modality: 'image',
      currentVersionId: '55555555-5555-4555-8555-555555555559',
      versions: [{ id: '55555555-5555-4555-8555-555555555559' }],
    });

    const run = makeBaseRun('black-friday');
    const { props, mocks } = createStepProps('black-friday', 'product-images', {
      run,
      mutateImpl: (async (_intent, command) => {
        if (command === 'add_pool') return { run, poolItemIds: ['33333333-3333-4333-8333-333333333339'] };
        return { run };
      }) as never,
    });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const fileInput = mounted.container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const file = new File(['png-bytes'], 'product.png', { type: 'image/png' });
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      expect(mockUploadLibraryAsset).toHaveBeenCalledWith(file, {});
      expect(mocks.mutate).toHaveBeenCalledWith(
        'upload-pool:product-images',
        'add_pool',
        expect.objectContaining({
          items: [expect.objectContaining({ stepId: 'product-images', source: 'upload', label: 'product.png' })],
        }),
      );
      expect(mocks.mutate).toHaveBeenCalledWith(
        'upload-iter:product-images',
        'add_iteration',
        expect.objectContaining({
          stepId: 'product-images',
          iteration: expect.objectContaining({
            source: 'upload',
            outputs: [{ type: 'pool', poolItemId: '33333333-3333-4333-8333-333333333339' }],
          }),
        }),
      );
      expect(mocks.highlight).toHaveBeenCalledWith(['33333333-3333-4333-8333-333333333339']);
    } finally {
      await mounted.unmount();
    }
  });

  it('seeds speech audio prompt from active script iteration and submits text-to-speech mode', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'fal', label: 'fal', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' }],
          agents: [],
          routes: { audio: speechModel.id },
          capabilities: [{ modality: 'audio', available: true, modelIds: [speechModel.id], selectedModelId: speechModel.id }],
        },
        models: [speechModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const scriptIter: StepIteration = {
      id: '66666666-6666-4666-8666-666666666666',
      number: 1,
      createdAt: 1700000000000,
      source: 'local',
      inputs: [],
      outputs: [{ type: 'script', text: 'Hey everyone, here are 3 workflow tips.' }],
    };
    const run = makeBaseRun('ai-influencer', {
      steps: {
        brief: { iterations: [scriptIter], activeIterationId: scriptIter.id },
      },
    });

    const { props, mocks } = createStepProps('ai-influencer', 'voice', { run });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const textarea = mounted.container.querySelector<HTMLTextAreaElement>('#media-prompt-voice')!;
      expect(textarea.value).toBe('Hey everyone, here are 3 workflow tips.');

      const generateBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate')!;
      await act(async () => { generateBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'generate:voice',
        'generate',
        expect.objectContaining({
          stepId: 'voice',
          modality: 'audio',
          mode: 'text-to-speech',
          model: speechModel.id,
          prompt: 'Hey everyone, here are 3 workflow tips.',
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('renders completed image outputs and allows cancelling a pending job', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'fal', label: 'fal', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' }],
          agents: [],
          routes: { image: imageModel.id },
          capabilities: [{ modality: 'image', available: true, modelIds: [imageModel.id], selectedModelId: imageModel.id }],
        },
        models: [imageModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const completedIter: StepIteration = {
      id: '77777777-7777-4777-8777-777777777771',
      number: 1,
      createdAt: 1700000000000,
      source: 'generated',
      inputs: [],
      outputs: [{ type: 'pool', poolItemId: imagePoolItem.id }],
      job: { jobId: 'job-1', state: 'completed', modality: 'image', model: imageModel.id },
    };
    const runCompleted = makeBaseRun('black-friday', {
      pool: [imagePoolItem],
      steps: {
        'product-images': {
          iterations: [completedIter],
          activeIterationId: completedIter.id,
          draft: { prompt: 'Studio tote photo' },
        },
      },
    });
    const completed = createStepProps('black-friday', 'product-images', { run: runCompleted });
    const mounted = await mountStep(<MediaStep {...completed.props} />);

    try {
      const img = mounted.container.querySelector<HTMLImageElement>('.om-step-media-grid img');
      expect(img?.getAttribute('alt')).toBe('Tote Hero');

      // Re-render with a running job to verify cancel button
      const runningIter: StepIteration = {
        id: '77777777-7777-4777-8777-777777777772',
        number: 2,
        createdAt: 1700000001000,
        source: 'generated',
        inputs: [],
        outputs: [],
        job: { jobId: 'job-2', state: 'running', modality: 'image', model: imageModel.id },
      };
      const runPending = makeBaseRun('black-friday', {
        pool: [imagePoolItem],
        steps: {
          'product-images': {
            iterations: [completedIter, runningIter],
            activeIterationId: runningIter.id,
          },
        },
      });
      const pending = createStepProps('black-friday', 'product-images', { run: runPending });
      await mounted.rerender(<MediaStep {...pending.props} />);

      const cancelBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Cancel'))!;
      await act(async () => { cancelBtn.click(); });
      expect(pending.mocks.mutate).toHaveBeenCalledWith(
        `cancel:product-images:${runningIter.id}`,
        'cancel',
        { stepId: 'product-images', iterationId: runningIter.id },
      );

      // Verify prompt edit updates cleanly
      const promptEl = mounted.container.querySelector<HTMLTextAreaElement>('#media-prompt-product-images')!;
      await act(async () => { setFieldValue(promptEl, 'New prompt text'); });
      expect(promptEl.value).toBe('New prompt text');
    } finally {
      await mounted.unmount();
    }
  });
});
