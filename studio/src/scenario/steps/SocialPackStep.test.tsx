// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepIteration } from '../../../../shared/scenario-runs';
import { SocialPackStep } from './SocialPackStep';
import { createStepProps, makeBaseRun, mountStep, setFieldValue } from './stepTestHelpers';

vi.mock('../../motion/useIntegrationInfo', () => ({
  useIntegrationInfo: () => ({ info: { previewUrl: 'http://127.0.0.1:4197', dataDirectory: '/fixture/workspace' }, failed: false, retry: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SocialPackStep', () => {
  it('drafts per platform, warns above character limit, regenerates new variants, and copies Markdown with Toast', async () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardSpy },
    });

    const run = makeBaseRun('black-friday', {
      brief: {
        productName: 'Holiday Tote',
        salePrice: '$79',
        originalPrice: '$129',
        promoCode: 'BF40',
        saleWindow: 'Nov 27 – Dec 1',
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'social', { run });
    const mounted = await mountStep(<SocialPackStep {...props} />);

    try {
      const draftBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Draft posts (offline)'))!;
      await act(async () => { draftBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'social-draft:social:v0',
        'add_iteration',
        expect.objectContaining({
          stepId: 'social',
          iteration: expect.objectContaining({
            source: 'local',
            settings: expect.objectContaining({ variant: 0 }),
          }),
        }),
      );

      // Verify platform cards rendered (black-friday has 5 platforms: x, instagram, tiktok, douyin, xiaohongshu)
      expect(mounted.container.querySelectorAll('[data-social-platform]').length).toBe(5);

      // Push X body text past 280 chars and assert warning state
      const xCard = mounted.container.querySelector('[data-social-platform="x"]')!;
      const xBody = xCard.querySelector('textarea')!;
      await act(async () => { setFieldValue(xBody, 'a'.repeat(295)); });

      const counter = xCard.querySelector('[data-char-counter="x"]')!;
      expect(counter.getAttribute('data-over-limit')).toBe('true');
      expect(counter.textContent).toContain('295 / 280');

      // Add a custom hashtag on X card
      const tagInput = xCard.querySelector<HTMLInputElement>('input[aria-label="Add hashtag for X"]')!;
      await act(async () => { setFieldValue(tagInput, '#FlashSale'); });
      const addTagBtn = Array.from(xCard.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Add')!;
      await act(async () => { addTagBtn.click(); });
      expect(xCard.textContent).toContain('#FlashSale');

      // Save edits creates a manual iteration
      const saveBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Save edits'))!;
      expect(saveBtn.disabled).toBe(false);
      await act(async () => { saveBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'social-save:social',
        'add_iteration',
        expect.objectContaining({
          stepId: 'social',
          iteration: expect.objectContaining({ source: 'manual' }),
        }),
      );

      // Copy all posts (Markdown) from export menu shows Toast
      const copyMdBtn = Array.from(mounted.container.querySelectorAll('[data-test-export-menu] *')).find(el => el.textContent?.trim() === 'Copy all posts (Markdown)') as HTMLElement;
      expect(copyMdBtn).toBeTruthy();
      await act(async () => { copyMdBtn.click(); });
      expect(clipboardSpy).toHaveBeenCalledWith(expect.stringContaining('# Social posts'));
      expect(mocks.showToast).toHaveBeenCalledWith('Copied all posts as Markdown', 'info', 'feedback');
    } finally {
      await mounted.unmount();
    }
  });

  it('increments variant on Regenerate when an iteration already exists', async () => {
    const existingIter: StepIteration = {
      id: '88888888-8888-4888-8888-888888888888',
      number: 1,
      createdAt: 1700000000000,
      source: 'local',
      settings: { variant: 0, tone: 'bold', platforms: ['x'] },
      inputs: [],
      outputs: [{
        type: 'social',
        posts: [{ id: 'x-v1', platform: 'x', text: 'First draft', hashtags: ['BlackFriday'], mediaPoolItemIds: [], aspect: '16:9' }],
      }],
    };
    const run = makeBaseRun('black-friday', {
      steps: {
        social: { iterations: [existingIter], activeIterationId: existingIter.id },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'social', { run });
    const mounted = await mountStep(<SocialPackStep {...props} />);

    try {
      const regenBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Regenerate'))!;
      await act(async () => { regenBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'social-draft:social:v1',
        'add_iteration',
        expect.objectContaining({
          stepId: 'social',
          iteration: expect.objectContaining({
            source: 'local',
            settings: expect.objectContaining({ variant: 1 }),
          }),
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });
});
