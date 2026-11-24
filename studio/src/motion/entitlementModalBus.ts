export const ENTITLEMENT_HOOK_IDS = [
  'header_signin',
  'settings_signin',
  'template_use',
  'private_link_gate',
  'assets_empty',
  'studio_generate',
  'cloud_export',
  'session_expired_401',
  'header_pricing',
  'bf_banner',
  'settings_subscription',
  'studio_free_gate',
  'model_picker_upgrade',
  'studio_res_gate',
  'failure_card_topup',
  'mcp_oauth',
] as const;

export type EntitlementHookId = (typeof ENTITLEMENT_HOOK_IDS)[number];

export type EntitlementModalMode = 'guest' | 'upgrade';

export interface EntitlementModalRequest {
  mode: EntitlementModalMode;
  hookId: EntitlementHookId;
  triggerLabel?: string;
}

type ModalListener = (request: EntitlementModalRequest) => void;

const listeners = new Set<ModalListener>();
let pendingCheckout: { hookId?: EntitlementHookId; entryId?: string; at: number } | null = null;

const isTestEnvironment = typeof process !== 'undefined' && Boolean(process.env?.VITEST);

export function hasEntitlementModalListeners(): boolean {
  return listeners.size > 0;
}

/** True when running in the real Web Cloud browser (never affected by mount-order races; disabled in unit tests). */
export function isCloudWebMode(): boolean {
  return typeof window !== 'undefined' && !isTestEnvironment;
}

export function openEntitlementModal(request: EntitlementModalRequest): void {
  for (const listener of listeners) {
    listener(request);
  }
}

export function subscribeEntitlementModal(listener: ModalListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Mark that the user opened an external pricing/checkout flow (e.g. header Pricing,
 * Black Friday banner, or Upgrade modal) so returning to this window automatically
 * triggers a fresh billing & provider sync.
 */
export function markExternalCheckoutPending(hookId?: EntitlementHookId, entryId?: string): void {
  pendingCheckout = { hookId, entryId, at: Date.now() };
}

export function consumeExternalCheckoutPending(): { hookId?: EntitlementHookId; entryId?: string } | null {
  if (!pendingCheckout) return null;
  const current = pendingCheckout;
  pendingCheckout = null;
  return { hookId: current.hookId, entryId: current.entryId };
}
