// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepIteration } from '../../../../shared/scenario-runs';
import { BriefStep } from './BriefStep';
import { createStepProps, makeBaseRun, mountStep, setFieldValue } from './stepTestHelpers';

vi.mock('../../motion/useIntegrationInfo', () => ({
  useIntegrationInfo: () => ({ info: { previewUrl: 'http://127.0.0.1:4197', dataDirectory: '/fixture/workspace' }, failed: false, retry: vi.fn() }),
}));

const mockMediaCatalog = vi.fn(() => ({
  catalog: {
    status: { providers: [{ id: 'gemini', label: 'Gemini', available: false, enabled: false, configured: false, credentialSource: 'none', verification: 'unverified', reason: 'Not configured' }], agents: [], routes: {}, capabilities: [] },
    models: [],
  },
  failed: false,
  retry: vi.fn(),
}));

vi.mock('../../motion/useMediaCatalog', () => ({
  useMediaCatalog: (...args: unknown[]) => mockMediaCatalog(...args),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('BriefStep', () => {
  it('renders dynamic Black Friday fields, computes live discount badge, and debounces autosave', async () => {
    vi.useFakeTimers();
    const run = makeBaseRun('black-friday', {
      brief: {
        idea: 'Black Friday tote campaign',
        productName: 'Weekender Tote',
        originalPrice: '$100',
        salePrice: '$60',
        promoCode: 'BF40',
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'brief', { run });
    const mounted = await mountStep(<BriefStep {...props} />);

    try {
      expect(mounted.container.querySelector('[data-discount-badge]')?.textContent).toContain('40% OFF');
      expect(mounted.container.textContent).toContain('BF40');

      const productInput = mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-productName')!;
      expect(productInput.value).toBe('Weekender Tote');

      await act(async () => {
        setFieldValue(productInput, 'Leather Weekender Tote');
      });

      // Not sent before 800ms debounce
      expect(mocks.mutate).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(850);
      });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-autosave',
        'update_brief',
        expect.objectContaining({
          brief: expect.objectContaining({ productName: 'Leather Weekender Tote' }),
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('saves brief revisions, restores earlier revisions, and applies prompts only to unedited steps', async () => {
    const savedIter: StepIteration = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      number: 1,
      createdAt: 1700000000000,
      source: 'manual',
      inputs: [],
      outputs: [{ type: 'brief', values: { productName: 'Old Tote', idea: 'Original idea' } }],
    };
    const run = makeBaseRun('black-friday', {
      brief: { productName: 'New Tote', idea: 'Updated idea', salePrice: '$79', promoCode: 'BF40' },
      steps: {
        brief: { iterations: [savedIter], activeIterationId: savedIter.id },
        'product-images': { draft: { prompt: 'Custom user prompt', promptEdited: true } },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'brief', { run });
    const mounted = await mountStep(<BriefStep {...props} />);

    try {
      const saveBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Save revision'))!;
      await act(async () => { saveBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-revision',
        'add_iteration',
        expect.objectContaining({
          stepId: 'brief',
          iteration: expect.objectContaining({
            source: 'manual',
            outputs: [expect.objectContaining({ type: 'brief' })],
          }),
        }),
      );

      // Apply to all steps skips product-images (promptEdited: true) and updates sales-film
      const applyBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Apply to all steps'))!;
      await act(async () => { applyBtn.click(); });
      const seedCalls = mocks.mutate.mock.calls.filter(call => call[1] === 'update_step');
      expect(seedCalls.map(c => (c[2] as { stepId: string }).stepId)).toEqual(['sales-film']);

      // Restore from iteration history
      const restoreBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Restore')!;
      await act(async () => { restoreBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-restore',
        'update_brief',
        expect.objectContaining({
          brief: expect.objectContaining({ productName: 'Old Tote' }),
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('preserves active user input when remote brief updates arrive concurrently', async () => {
    const run1 = makeBaseRun('black-friday', {
      revision: 1,
      brief: { productName: 'Initial Tote', promoCode: 'OLD' },
    });
    const first = createStepProps('black-friday', 'brief', { run: run1 });
    const mounted = await mountStep(<BriefStep {...first.props} />);

    try {
      const productInput = mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-productName')!;
      await act(async () => {
        productInput.focus();
        setFieldValue(productInput, 'My Unsaved Draft');
      });

      const run2 = makeBaseRun('black-friday', {
        revision: 2,
        brief: { productName: 'Remote Overwrite', promoCode: 'BF50' },
      });
      const second = createStepProps('black-friday', 'brief', { run: run2 });
      await mounted.rerender(<BriefStep {...second.props} />);

      // Active dirty field is preserved while non-dirty remote field updates
      expect(mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-productName')?.value).toBe('My Unsaved Draft');
      expect(mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-promoCode')?.value).toBe('BF50');
    } finally {
      await mounted.unmount();
    }
  });

  it('supports AI influencer script outline generation and manual script saves', async () => {
    const run = makeBaseRun('ai-influencer', {
      brief: { personaName: 'Mina Park', topic: '3 automation habits', idea: 'Save 5 hours a week' },
    });
    const { props, mocks } = createStepProps('ai-influencer', 'brief', { run });
    const mounted = await mountStep(<BriefStep {...props} />);

    try {
      const genBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Generate script outline'))!;
      await act(async () => { genBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-script-outline',
        'add_iteration',
        expect.objectContaining({
          stepId: 'brief',
          iteration: expect.objectContaining({
            source: 'local',
            outputs: [expect.objectContaining({ type: 'script', text: expect.stringContaining('Mina Park') })],
          }),
        }),
      );

      const scriptArea = mounted.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Episode script"]')!;
      await act(async () => { setFieldValue(scriptArea, 'Edited spoken script'); });

      const saveScriptBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Save script version'))!;
      await act(async () => { saveScriptBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-script-save',
        'add_iteration',
        expect.objectContaining({
          stepId: 'brief',
          iteration: expect.objectContaining({
            source: 'manual',
            outputs: [{ type: 'script', text: 'Edited spoken script' }],
          }),
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('renders Gemini 4 Neon inspiration rail and availability card with provider CTA', async () => {
    const { props, mocks } = createStepProps('gemini-4-neon', 'brief');
    const mounted = await mountStep(<BriefStep {...props} />);

    try {
      const cards = mounted.container.querySelectorAll('.om-step-inspiration-card');
      expect(cards.length).toBe(8);
      await act(async () => { (cards[0] as HTMLButtonElement).click(); });
      expect(mocks.nav.openModelHub).toHaveBeenCalledWith('gemini-4');

      const connectBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Connect Gemini'))!;
      await act(async () => { connectBtn.click(); });
      expect(mocks.nav.openProviders).toHaveBeenCalledWith('gemini');
    } finally {
      await mounted.unmount();
    }
  });
});
