// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import {
  AUTH_PENDING_DRAFT_KEY,
  AuthRecoveryNotice,
  HOME_DRAFT_STORAGE_KEY,
  classifyAuthHttpError,
  clearAuthPendingDraft,
  notifyAuthRecovery,
  readAuthPendingDraft,
  saveAuthPendingDraft,
} from './authRecovery';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('authRecovery (A01 / A03)', () => {
  it('classifies 401 auth_required and 503 auth_unavailable distinctly', () => {
    expect(classifyAuthHttpError(401, { code: 'UNAUTHORIZED', errorCode: 'auth_required' })?.kind).toBe('auth_required');
    expect(classifyAuthHttpError(503, { code: 'AUTH_UNAVAILABLE', errorCode: 'auth_unavailable' })?.kind).toBe('auth_unavailable');
    expect(classifyAuthHttpError(500, { code: 'INTERNAL_ERROR' })).toBeNull();
  });

  it('preserves draft & idempotency key on 401 auth_required, keeps draft on cancel, and navigates to /auth/login on sign in', async () => {
    window.localStorage.setItem(HOME_DRAFT_STORAGE_KEY, 'My unsaved prompt');
    const onLoginNavigate = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AuthRecoveryNotice onLoginNavigate={onLoginNavigate} />
        </I18nProvider>,
      );
    });

    const savedDraft = saveAuthPendingDraft({
      action: 'use_template',
      templateId: 'tpl-hero',
      instruction: 'Launch trailer',
      returnTo: '/?templates=1&template=tpl-hero',
    });

    await act(async () => {
      notifyAuthRecovery({
        kind: 'auth_required',
        status: 401,
        message: 'Session expired',
        returnTo: savedDraft.returnTo,
        draft: savedDraft,
      });
    });

    const banner = host.querySelector('[data-kind="auth_required"]');
    expect(banner?.textContent).toContain('Your session has expired');

    // Clicking Sign in again navigates to /auth/login?returnTo=... while keeping draft preserved.
    const signInBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Sign in again'))!;
    await act(async () => signInBtn.click());
    expect(onLoginNavigate).toHaveBeenCalledWith(
      `/auth/login?returnTo=${encodeURIComponent('/?templates=1&template=tpl-hero')}`,
    );
    expect(window.localStorage.getItem(HOME_DRAFT_STORAGE_KEY)).toBe('My unsaved prompt');
    expect(readAuthPendingDraft()?.idempotencyKey).toBe(savedDraft.idempotencyKey);

    // Clicking Cancel dismisses the prompt without deleting drafts.
    const cancelBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    await act(async () => cancelBtn.click());
    expect(host.querySelector('[data-kind="auth_required"]')).toBeNull();
    expect(window.localStorage.getItem(HOME_DRAFT_STORAGE_KEY)).toBe('My unsaved prompt');
    expect(readAuthPendingDraft()?.templateId).toBe('tpl-hero');
  });

  it('shows non-destructive retry banner on 503 auth_unavailable without prompting re-login', async () => {
    const onRetry = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AuthRecoveryNotice onRetry={onRetry} />
        </I18nProvider>,
      );
    });

    await act(async () => {
      notifyAuthRecovery({
        kind: 'auth_unavailable',
        status: 503,
        message: 'AMR unreachable',
      });
    });

    const banner = host.querySelector('[data-kind="auth_unavailable"]');
    expect(banner?.textContent).toContain('Temporarily unable to verify your login status');
    expect(banner?.textContent).not.toContain('Sign in again');

    const retryBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    await act(async () => retryBtn.click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-kind="auth_unavailable"]')).toBeNull();
  });

  it('restores saved draft after login and resumes once with the exact preserved idempotencyKey', async () => {
    const draft = saveAuthPendingDraft({
      action: 'use_template',
      templateId: 'tpl-123',
      instruction: 'Promo video',
      homeDraftSnapshot: 'Promo video',
    });
    // Simulate localStorage cleared during redirect — restoreHomeDraftIfMissing must recover it.
    window.localStorage.removeItem(HOME_DRAFT_STORAGE_KEY);

    const onResume = vi.fn(async () => true);
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AuthRecoveryNotice onResumePendingDraft={onResume} />
        </I18nProvider>,
      );
    });

    expect(window.localStorage.getItem(HOME_DRAFT_STORAGE_KEY)).toBe('Promo video');
    const continueBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!;
    await act(async () => continueBtn.click());

    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: draft.idempotencyKey,
      templateId: 'tpl-123',
      instruction: 'Promo video',
    }));
    expect(window.sessionStorage.getItem(AUTH_PENDING_DRAFT_KEY)).toBeNull();
    clearAuthPendingDraft();
  });
});
