export const AUTH_PENDING_DRAFT_KEY = 'openmotion.auth.pending-draft.v1';
export const HOME_DRAFT_STORAGE_KEY = 'motion.home.draft.v1';
export const AUTH_RECOVERY_EVENT = 'motion:auth-recovery';
const PENDING_DRAFT_TTL_MS = 30 * 60_000;

export type AuthRecoveryKind = 'auth_required' | 'auth_unavailable';

export interface AuthPendingDraft {
  readonly returnTo: string;
  readonly action: 'create_project' | 'start_session' | 'use_template' | 'save_edit' | 'generic';
  readonly idempotencyKey: string;
  readonly templateId?: string;
  readonly instruction?: string;
  readonly projectId?: string;
  readonly homeDraftSnapshot?: string | null;
  readonly savedAt: number;
}

export interface AuthRecoveryDetail {
  readonly kind: AuthRecoveryKind;
  readonly status: number;
  readonly message: string;
  readonly returnTo?: string;
  readonly draft?: AuthPendingDraft | null;
}

export function currentReturnToPath(): string {
  if (typeof window === 'undefined') return '/';
  const target = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return target.startsWith('/') ? target : '/';
}

export function saveAuthPendingDraft(
  input: Omit<AuthPendingDraft, 'returnTo' | 'idempotencyKey' | 'savedAt' | 'homeDraftSnapshot'> & {
    returnTo?: string;
    idempotencyKey?: string;
    homeDraftSnapshot?: string | null;
  },
): AuthPendingDraft {
  let homeDraftSnapshot = input.homeDraftSnapshot;
  if (homeDraftSnapshot === undefined && typeof window !== 'undefined') {
    try {
      homeDraftSnapshot = window.localStorage.getItem(HOME_DRAFT_STORAGE_KEY);
    } catch {
      homeDraftSnapshot = null;
    }
  }
  const existing = readAuthPendingDraft();
  const sameIntent =
    existing &&
    existing.action === input.action &&
    existing.templateId === input.templateId &&
    existing.instruction === input.instruction &&
    existing.projectId === input.projectId;

  const draft: AuthPendingDraft = {
    returnTo: input.returnTo ?? currentReturnToPath(),
    action: input.action,
    idempotencyKey: input.idempotencyKey ?? (sameIntent ? existing.idempotencyKey : crypto.randomUUID()),
    ...(input.templateId ? { templateId: input.templateId } : {}),
    ...(input.instruction ? { instruction: input.instruction } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(homeDraftSnapshot !== undefined ? { homeDraftSnapshot } : {}),
    savedAt: Date.now(),
  };
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(AUTH_PENDING_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Ignore storage quota / private mode failures.
    }
  }
  return draft;
}

export function readAuthPendingDraft(nowMs = Date.now()): AuthPendingDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(AUTH_PENDING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthPendingDraft>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.idempotencyKey !== 'string') return null;
    if (typeof parsed.savedAt !== 'number' || nowMs - parsed.savedAt > PENDING_DRAFT_TTL_MS) {
      window.sessionStorage.removeItem(AUTH_PENDING_DRAFT_KEY);
      return null;
    }
    return {
      returnTo: typeof parsed.returnTo === 'string' && parsed.returnTo.startsWith('/') ? parsed.returnTo : '/',
      action: parsed.action ?? 'generic',
      idempotencyKey: parsed.idempotencyKey,
      ...(typeof parsed.templateId === 'string' ? { templateId: parsed.templateId } : {}),
      ...(typeof parsed.instruction === 'string' ? { instruction: parsed.instruction } : {}),
      ...(typeof parsed.projectId === 'string' ? { projectId: parsed.projectId } : {}),
      ...(parsed.homeDraftSnapshot !== undefined ? { homeDraftSnapshot: parsed.homeDraftSnapshot } : {}),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function restoreHomeDraftIfMissing(draft: AuthPendingDraft | null): void {
  if (!draft?.homeDraftSnapshot || typeof window === 'undefined') return;
  try {
    if (!window.localStorage.getItem(HOME_DRAFT_STORAGE_KEY)) {
      window.localStorage.setItem(HOME_DRAFT_STORAGE_KEY, draft.homeDraftSnapshot);
    }
  } catch {
    // Ignore storage failures.
  }
}

export function clearAuthPendingDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(AUTH_PENDING_DRAFT_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function classifyAuthHttpError(
  status: number,
  payload: Record<string, unknown>,
  fallbackMessage?: string,
): AuthRecoveryDetail | null {
  const errorCode = typeof payload.errorCode === 'string' ? payload.errorCode : undefined;
  const code = typeof payload.code === 'string' ? payload.code : undefined;
  const message =
    typeof payload.error === 'string'
      ? payload.error
      : fallbackMessage || (status === 503 ? 'Temporarily unable to verify login status.' : 'Sign in required.');

  if (status === 503 && (errorCode === 'auth_unavailable' || code === 'AUTH_UNAVAILABLE')) {
    return { kind: 'auth_unavailable', status: 503, message };
  }
  if (status === 401 && (errorCode === 'auth_required' || code === 'UNAUTHORIZED')) {
    return { kind: 'auth_required', status: 401, message };
  }
  return null;
}

export function notifyAuthRecovery(detail: AuthRecoveryDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AuthRecoveryDetail>(AUTH_RECOVERY_EVENT, { detail }));
}
