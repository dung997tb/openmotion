// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { ContributionSubmitButton } from './ContributionGuideDialog';
import { contributionGuideUrls, type ContributionKind } from './templateContribution';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it.each<[ContributionKind, string, string]>([
  ['template', 'Submit template', 'video-to-template'],
  ['brand-kit', 'Submit Brand Kit', 'docs/brand-kits.md'],
  ['skill', 'Submit a skill', 'library/skills/<name>/SKILL.md'],
])('opens guided %s dialog, copies the Agent instruction, and links to its exact CONTRIBUTING section', async (kind, label, expectedPhrase) => {
  const onTrack = vi.fn();
  await act(async () => {
    root.render(
      <I18nProvider>
        <ContributionSubmitButton kind={kind} label={label} className="om-gallery-submit" onTrack={onTrack} />
      </I18nProvider>,
    );
  });

  const trigger = host.querySelector<HTMLButtonElement>(`button[data-contribution-trigger="${kind}"]`)!;
  expect(trigger.textContent).toBe(label);
  expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');

  await act(async () => trigger.click());
  expect(onTrack).toHaveBeenCalledTimes(1);

  const dialog = document.querySelector<HTMLElement>(`.om-contribution-guide[data-contribution-kind="${kind}"]`)!;
  expect(dialog).toBeTruthy();
  expect(dialog.querySelector('.om-contribution-prompt')?.textContent).toContain(expectedPhrase);

  const guideLink = dialog.querySelector<HTMLAnchorElement>('a[target="_blank"]')!;
  expect(guideLink.href).toBe(contributionGuideUrls[kind]);

  const copyButton = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes('Copy instruction'))!;
  await act(async () => copyButton.click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(expectedPhrase));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(contributionGuideUrls[kind]));
});
