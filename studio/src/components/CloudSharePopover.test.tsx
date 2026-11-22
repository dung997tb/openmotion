// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { CloudSharePopover } from './CloudSharePopover';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function flushUi(ticks = 6) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

it('signs in with OpenDesign in-place and automatically deploys and copies the live share link', async () => {
  let signedIn = false;
  let published = false;
  const shareUrl = 'https://open-design.app/artifact/om-game-g1/11111111-1111-4111-8111-111111111111';
  const fetchCalls: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    fetchCalls.push(`${method} ${url}`);
    if (url.endsWith('/motion-api/settings/account')) {
      return jsonResponse({
        state: signedIn ? 'signed-in' : 'signed-out',
        ...(signedIn ? { user: { id: 'u1', email: 'maker@example.com' } } : {}),
        consoleUrl: 'https://open-design.app',
      });
    }
    if (url.endsWith('/motion-api/settings/account/login') && method === 'POST') {
      signedIn = true;
      return jsonResponse({
        state: 'signed-in',
        user: { id: 'u1', email: 'maker@example.com' },
        consoleUrl: 'https://open-design.app',
      });
    }
    if (url.endsWith('/motion-api/cloud-share/game-project/g1') && method === 'GET') {
      return jsonResponse({
        kind: 'game-project',
        projectId: 'g1',
        title: 'Star Drift',
        accountState: signedIn ? 'signed-in' : 'signed-out',
        status: published ? 'active' : 'none',
        url: published ? shareUrl : null,
        freshness: published ? 'fresh' : 'unknown',
        fileCount: 3,
        totalBytes: 2048,
        bundledAssetCount: 1,
        entryPath: 'index.html',
      });
    }
    if (url.endsWith('/motion-api/cloud-share/game-project/g1/publish') && method === 'POST') {
      published = true;
      return jsonResponse({
        kind: 'game-project',
        projectId: 'g1',
        title: 'Star Drift',
        accountState: 'signed-in',
        accountEmail: 'maker@example.com',
        workspaceName: 'Maker Personal',
        status: 'active',
        url: shareUrl,
        slug: '11111111-1111-4111-8111-111111111111',
        version: 1,
        freshness: 'fresh',
        fileCount: 3,
        totalBytes: 2048,
        bundledAssetCount: 1,
        entryPath: 'index.html',
      });
    }
    if (url.includes('/motion-api/providers')) {
      return jsonResponse({ providers: [] });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });

  const notifications: string[] = [];
  await act(async () => {
    root!.render(
      <I18nProvider initialLocale="en">
        <CloudSharePopover
          kind="game-project"
          projectId="g1"
          onNotify={msg => notifications.push(msg)}
        />
      </I18nProvider>,
    );
  });
  await flushUi();

  const trigger = container!.querySelector('button.om-cloud-share-trigger') as HTMLButtonElement;
  expect(trigger).toBeTruthy();

  await act(async () => {
    trigger.click();
  });
  await flushUi();

  const popover = document.body.querySelector('.om-cloud-share-popover') as HTMLElement;
  expect(popover).toBeTruthy();
  expect(popover.textContent).toContain('Cloud deploy');
  const signInBtn = Array.from(popover.querySelectorAll('button')).find(b => b.textContent?.includes('Sign in with OpenDesign')) as HTMLButtonElement;
  expect(signInBtn).toBeTruthy();

  await act(async () => {
    signInBtn.click();
  });
  await flushUi();

  expect(fetchCalls).toContain('POST /motion-api/settings/account/login');
  expect(fetchCalls).toContain('POST /motion-api/cloud-share/game-project/g1/publish');
  expect(writeText).toHaveBeenCalledWith(shareUrl);
  expect(popover.textContent).toContain(shareUrl);
  expect(popover.textContent).toContain('Share link copied');
  expect(notifications).toContain('Deployed and copied share link');
});

it('renders Link access switch, Update live link when outdated, and toggles stop/resume cleanly', async () => {
  const shareUrl = 'https://open-design.app/artifact/om-game-g2/22222222-2222-4222-8222-222222222222';
  let linkStatus: 'active' | 'stopped' = 'active';
  let freshness: 'fresh' | 'outdated' = 'outdated';

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/motion-api/settings/account')) {
      return jsonResponse({
        state: 'signed-in',
        user: { id: 'u2', email: 'pro@example.com' },
        consoleUrl: 'https://open-design.app',
      });
    }
    if (url.endsWith('/motion-api/cloud-share/game-project/g2') && method === 'GET') {
      return jsonResponse({
        kind: 'game-project',
        projectId: 'g2',
        title: 'Drift Two',
        accountState: 'signed-in',
        accountEmail: 'pro@example.com',
        workspaceName: 'Pro Space',
        status: linkStatus,
        url: shareUrl,
        freshness,
        fileCount: 4,
        totalBytes: 4096,
        bundledAssetCount: 0,
        entryPath: 'index.html',
      });
    }
    if (url.endsWith('/motion-api/cloud-share/game-project/g2/stop') && method === 'POST') {
      linkStatus = 'stopped';
      return jsonResponse({
        kind: 'game-project',
        projectId: 'g2',
        title: 'Drift Two',
        accountState: 'signed-in',
        accountEmail: 'pro@example.com',
        workspaceName: 'Pro Space',
        status: 'stopped',
        url: shareUrl,
        freshness,
        fileCount: 4,
        totalBytes: 4096,
        bundledAssetCount: 0,
        entryPath: 'index.html',
      });
    }
    if (url.endsWith('/motion-api/cloud-share/game-project/g2/resume') && method === 'POST') {
      linkStatus = 'active';
      return jsonResponse({
        kind: 'game-project',
        projectId: 'g2',
        title: 'Drift Two',
        accountState: 'signed-in',
        accountEmail: 'pro@example.com',
        workspaceName: 'Pro Space',
        status: 'active',
        url: shareUrl,
        freshness,
        fileCount: 4,
        totalBytes: 4096,
        bundledAssetCount: 0,
        entryPath: 'index.html',
      });
    }
    if (url.endsWith('/motion-api/cloud-share/game-project/g2/publish') && method === 'POST') {
      linkStatus = 'active';
      freshness = 'fresh';
      return jsonResponse({
        kind: 'game-project',
        projectId: 'g2',
        title: 'Drift Two',
        accountState: 'signed-in',
        accountEmail: 'pro@example.com',
        workspaceName: 'Pro Space',
        status: 'active',
        url: shareUrl,
        freshness: 'fresh',
        fileCount: 4,
        totalBytes: 4096,
        bundledAssetCount: 0,
        entryPath: 'index.html',
      });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  }));

  await act(async () => {
    root!.render(
      <I18nProvider initialLocale="en">
        <CloudSharePopover kind="game-project" projectId="g2" />
      </I18nProvider>,
    );
  });
  await flushUi();

  await act(async () => {
    (container!.querySelector('button.om-cloud-share-trigger') as HTMLButtonElement).click();
  });
  await flushUi();

  const popover = document.body.querySelector('.om-cloud-share-popover') as HTMLElement;
  expect(popover).toBeTruthy();
  const toggle = popover.querySelector('[role="switch"]') as HTMLButtonElement;
  expect(toggle).toBeTruthy();
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(popover.textContent).toContain(shareUrl);
  expect(popover.textContent).toContain('Update live link');

  // Turn Link access OFF -> stop share link.
  await act(async () => {
    toggle.click();
  });
  await flushUi();

  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(popover.textContent).toContain('The link is disabled');
  const reopenBtn = Array.from(popover.querySelectorAll('button')).find(b => b.textContent?.includes('Reopen share link')) as HTMLButtonElement;
  expect(reopenBtn).toBeTruthy();

  // Reopen share link -> resume share link.
  await act(async () => {
    reopenBtn.click();
  });
  await flushUi();

  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(popover.textContent).toContain('Copy share link');
  expect(popover.textContent).toContain('Update live link');
});
