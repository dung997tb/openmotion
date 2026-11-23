import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  HOST_CAPABILITIES,
  hostErr,
  type HostCapabilityDescriptor,
  type HostInvokeResult,
  type HostKind,
  type HostRuntimeInfo,
  type UniversalHostBridge,
} from '../../../shared/desktop-contract';
import type {
  DesktopChromeInsets,
  DesktopDiagnosticExportResult,
  DesktopMenuAction,
  DesktopUpdateState,
} from '../../../shared/platform-host';
import {
  getLocalConnectBridge,
  getLocalConnectBridgeRevision,
  subscribeLocalConnectBridge,
} from './localConnectBridge';

declare global {
  interface Window {
    __OPENMOTION_HOST__?: UniversalHostBridge;
  }
}

export type HostAtomCapability =
  | typeof HOST_CAPABILITIES.ATOM_DETECT
  | typeof HOST_CAPABILITIES.ATOM_EXEC
  | typeof HOST_CAPABILITIES.ATOM_INSTALL_COMPONENT
  | typeof HOST_CAPABILITIES.ATOM_CREDENTIAL
  | typeof HOST_CAPABILITIES.ATOM_CONFIG;

export type HostCapabilitiesState = {
  bridge: UniversalHostBridge | null;
  hostKind: HostKind | null;
  info: HostRuntimeInfo | null;
  capabilities: HostCapabilityDescriptor[];
  loading: boolean;
  has: (name: string, minVersion?: string) => boolean;
  refresh: () => Promise<void>;
};

export type DesktopBrowserLoginOptions = {
  loginUrl?: string;
  returnTo?: string;
};

export type DesktopBrowserLoginResult = {
  ok: boolean;
  mode: 'desktop-account' | 'external-browser' | 'web-redirect';
  url?: string;
  error?: string;
};

export type BillingReturnHandle = {
  opened: boolean;
  cancel: () => void;
};

type SemverParts = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

function parseSemver(raw: string): SemverParts | null {
  const trimmed = raw.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(trimmed);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compare two semantic version strings. Returns negative if a < b, 0 if equal,
 * positive if a > b. Unparseable versions compare lower than valid semver strings.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease.localeCompare(pb.prerelease);
}

/**
 * Checks whether the active shell version satisfies a required minimum semver.
 * Returns `true` when `minVersion` is omitted/blank; fails closed (`false`)
 * when `minVersion` is set and either version is missing or unparseable.
 */
export function isShellVersionSupported(
  currentVersion: string | undefined,
  minVersion: string | undefined,
): boolean {
  if (!minVersion || !minVersion.trim()) return true;
  if (!currentVersion || !currentVersion.trim()) return false;
  if (!parseSemver(currentVersion) || !parseSemver(minVersion)) return false;
  return compareSemver(currentVersion, minVersion) >= 0;
}

function isUniversalHostBridge(value: unknown): value is UniversalHostBridge {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.info === 'function' &&
    typeof candidate.capabilities === 'function' &&
    typeof candidate.invoke === 'function' &&
    typeof candidate.subscribe === 'function'
  );
}

function isChromeInsets(value: unknown): value is DesktopChromeInsets {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.platform === 'darwin' || record.platform === 'win32' || record.platform === 'linux') &&
    typeof record.titleBarStyle === 'string' &&
    typeof record.insetLeft === 'number' &&
    typeof record.insetRight === 'number'
  );
}

function isUpdateState(value: unknown): value is DesktopUpdateState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.status === 'string' && typeof record.currentVersion === 'string';
}

export function getDesktopHostBridge(): UniversalHostBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = window.__OPENMOTION_HOST__;
  return isUniversalHostBridge(candidate) ? candidate : undefined;
}

/**
 * Returns the Electron desktop universal bridge when present, otherwise falls back
 * to an active in-memory Web Connect Script bridge when connected.
 */
export function getActiveHostBridge(): UniversalHostBridge | undefined {
  return getDesktopHostBridge() ?? getLocalConnectBridge();
}

export function isDesktopApp(): boolean {
  return Boolean(getDesktopHostBridge());
}

type BridgeCacheEntry = {
  capabilities?: HostCapabilityDescriptor[];
  capabilitiesPending?: Promise<HostCapabilityDescriptor[]>;
  info?: HostRuntimeInfo | null;
  infoPending?: Promise<HostRuntimeInfo | null>;
};

const bridgeCache = new WeakMap<UniversalHostBridge, BridgeCacheEntry>();

function getOrCreateCache(bridge: UniversalHostBridge): BridgeCacheEntry {
  let entry = bridgeCache.get(bridge);
  if (!entry) {
    entry = {};
    bridgeCache.set(bridge, entry);
  }
  return entry;
}

export function invalidateHostCapabilities(bridge?: UniversalHostBridge): void {
  const target = bridge ?? getActiveHostBridge();
  if (!target) return;
  bridgeCache.delete(target);
}

export async function loadHostCapabilities(
  bridge?: UniversalHostBridge,
  options?: { force?: boolean },
): Promise<HostCapabilityDescriptor[]> {
  const target = bridge ?? getActiveHostBridge();
  if (!target) return [];
  const entry = getOrCreateCache(target);
  if (!options?.force && entry.capabilities) {
    return entry.capabilities;
  }
  if (!options?.force && entry.capabilitiesPending) {
    return entry.capabilitiesPending;
  }
  const pending = Promise.resolve()
    .then(() => target.capabilities())
    .then(list => {
      const normalized = Array.isArray(list) ? list : [];
      entry.capabilities = normalized;
      return normalized;
    })
    .catch(() => [])
    .finally(() => {
      if (entry.capabilitiesPending === pending) {
        entry.capabilitiesPending = undefined;
      }
    });
  entry.capabilitiesPending = pending;
  return pending;
}

export async function loadHostRuntimeInfo(
  bridge?: UniversalHostBridge,
  options?: { force?: boolean },
): Promise<HostRuntimeInfo | null> {
  const target = bridge ?? getActiveHostBridge();
  if (!target) return null;
  const entry = getOrCreateCache(target);
  if (!options?.force && entry.info !== undefined) {
    return entry.info;
  }
  if (!options?.force && entry.infoPending) {
    return entry.infoPending;
  }
  const pending = Promise.resolve()
    .then(() => target.info())
    .then(info => {
      const normalized = info && typeof info === 'object' ? info : null;
      entry.info = normalized;
      return normalized;
    })
    .catch(() => null)
    .finally(() => {
      if (entry.infoPending === pending) {
        entry.infoPending = undefined;
      }
    });
  entry.infoPending = pending;
  return pending;
}

export function hasCapabilityInList(
  capabilities: readonly HostCapabilityDescriptor[],
  name: string,
  minVersion?: string,
): boolean {
  const descriptor = capabilities.find(item => item.name === name);
  if (!descriptor || descriptor.status === 'unavailable') {
    return false;
  }
  if (!minVersion) return true;
  return compareSemver(descriptor.version, minVersion) >= 0;
}

export function resolveCapabilityMethod(
  capabilities: readonly HostCapabilityDescriptor[],
  capabilityName: string,
  preferredMethods: readonly string[],
): string {
  const descriptor = capabilities.find(item => item.name === capabilityName);
  const advertised = descriptor?.methods;
  if (advertised && advertised.length > 0) {
    for (const candidate of preferredMethods) {
      if (advertised.includes(candidate)) return candidate;
    }
    return advertised[0];
  }
  return preferredMethods[0];
}

/**
 * Capability-based feature detection against the active host bridge (or an explicit bridge).
 * Never throws; returns false when no bridge is active, the capability is unavailable,
 * or its version is lower than `minVersion`.
 */
export async function hasHostCapability(
  name: string,
  minVersion?: string,
  bridge?: UniversalHostBridge,
): Promise<boolean> {
  const target = bridge ?? getActiveHostBridge();
  if (!target) return false;
  const capabilities = await loadHostCapabilities(target);
  return hasCapabilityInList(capabilities, name, minVersion);
}

/**
 * React hook exposing the active host bridge (desktop shell or Web Connect Script),
 * its runtime info, and reactive capability checks.
 */
export function useHostCapabilities(): HostCapabilitiesState {
  const connectRevision = useSyncExternalStore(
    subscribeLocalConnectBridge,
    getLocalConnectBridgeRevision,
    getLocalConnectBridgeRevision,
  );
  const desktopBridge = getDesktopHostBridge();
  const activeBridge = desktopBridge ?? getLocalConnectBridge() ?? null;

  const [info, setInfo] = useState<HostRuntimeInfo | null>(null);
  const [capabilities, setCapabilities] = useState<HostCapabilityDescriptor[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(activeBridge));
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!activeBridge) {
      setInfo(null);
      setCapabilities([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const force = refreshTick > 0;
    void Promise.all([
      loadHostRuntimeInfo(activeBridge, { force }),
      loadHostCapabilities(activeBridge, { force }),
    ])
      .then(([nextInfo, nextCapabilities]) => {
        if (!active) return;
        setInfo(nextInfo);
        setCapabilities(nextCapabilities);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeBridge, connectRevision, refreshTick]);

  const has = useCallback(
    (name: string, minVersion?: string) => hasCapabilityInList(capabilities, name, minVersion),
    [capabilities],
  );

  const refresh = useCallback(async () => {
    if (activeBridge) {
      invalidateHostCapabilities(activeBridge);
    }
    setRefreshTick(value => value + 1);
  }, [activeBridge]);

  const hostKind: HostKind | null =
    info?.hostKind ??
    (activeBridge ? (activeBridge === desktopBridge ? 'desktop' : 'connect-script') : null);

  return {
    bridge: activeBridge,
    hostKind,
    info,
    capabilities,
    loading,
    has,
    refresh,
  };
}

export function applyDesktopDocumentAttributes(chrome: DesktopChromeInsets | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!chrome) {
    delete root.dataset.desktop;
    delete root.dataset.desktopPlatform;
    delete root.dataset.desktopTitlebar;
    delete root.dataset.desktopFullscreen;
    root.style.removeProperty('--om-desktop-inset-left');
    root.style.removeProperty('--om-desktop-inset-right');
    return;
  }
  root.dataset.desktop = 'true';
  root.dataset.desktopPlatform = chrome.platform;
  root.dataset.desktopTitlebar = chrome.titleBarStyle;
  root.dataset.desktopFullscreen = chrome.fullscreen ? 'true' : 'false';
  root.style.setProperty('--om-desktop-inset-left', `${chrome.insetLeft}px`);
  root.style.setProperty('--om-desktop-inset-right', `${chrome.insetRight}px`);
}

export function syncDesktopTheme(theme: 'light' | 'dark'): void {
  const bridge = getDesktopHostBridge();
  if (!bridge) return;
  void hasHostCapability(HOST_CAPABILITIES.WINDOW, '1.0.0', bridge)
    .then(supported => {
      if (!supported) return;
      return bridge.invoke(HOST_CAPABILITIES.WINDOW, 'setTheme', { theme });
    })
    .catch(() => {});
}

let desktopReadyGeneration = 0;
let notifiedReadyGeneration = 0;
let notifiedReadyBridge: UniversalHostBridge | null = null;

/**
 * Signal once per desktop host binding that the initial React tree has painted.
 * Safe to invoke from both animation-frame and timeout fallback callbacks.
 */
export function notifyDesktopRendererReady(): void {
  const bridge = getDesktopHostBridge();
  if (!bridge) return;
  if (desktopReadyGeneration === 0) desktopReadyGeneration = 1;
  if (notifiedReadyGeneration === desktopReadyGeneration && notifiedReadyBridge === bridge) return;
  notifiedReadyGeneration = desktopReadyGeneration;
  notifiedReadyBridge = bridge;
  void hasHostCapability(HOST_CAPABILITIES.WINDOW, '1.0.0', bridge)
    .then(supported => {
      if (!supported) return;
      return bridge.invoke(HOST_CAPABILITIES.WINDOW, 'rendererReady');
    })
    .catch(() => {});
}

export function bindDesktopHost(options?: { deferReady?: boolean }): () => void {
  const bridge = getDesktopHostBridge();
  if (!bridge) {
    return () => {};
  }
  let active = true;
  let unsubscribe = () => {};
  desktopReadyGeneration += 1;
  const generation = desktopReadyGeneration;

  void hasHostCapability(HOST_CAPABILITIES.WINDOW, '1.0.0', bridge)
    .then(supported => {
      if (!active || !supported) return;

      void bridge
        .invoke<DesktopChromeInsets>(HOST_CAPABILITIES.WINDOW, 'getChromeState')
        .then(result => {
          if (active && result.ok && isChromeInsets(result.data)) {
            applyDesktopDocumentAttributes(result.data);
          }
        })
        .catch(() => {});

      unsubscribe = bridge.subscribe(HOST_CAPABILITIES.WINDOW, 'chromeState', payload => {
        if (active && isChromeInsets(payload)) {
          applyDesktopDocumentAttributes(payload);
        }
      });

      if (!options?.deferReady && generation === desktopReadyGeneration) {
        notifyDesktopRendererReady();
      }
    })
    .catch(() => {});

  return () => {
    active = false;
    unsubscribe();
  };
}

export function subscribeDesktopMenuActions(
  callback: (action: DesktopMenuAction) => void,
): () => void {
  const bridge = getDesktopHostBridge();
  if (!bridge) return () => {};
  let active = true;
  let unsubscribe = () => {};

  void hasHostCapability(HOST_CAPABILITIES.WINDOW, '1.0.0', bridge)
    .then(supported => {
      if (!active || !supported) return;
      unsubscribe = bridge.subscribe(HOST_CAPABILITIES.WINDOW, 'menuAction', payload => {
        if (active && typeof payload === 'string') {
          callback(payload as DesktopMenuAction);
        }
      });
    })
    .catch(() => {});

  return () => {
    active = false;
    unsubscribe();
  };
}

export function useDesktopChrome(): DesktopChromeInsets | null {
  const [chrome, setChrome] = useState<DesktopChromeInsets | null>(null);

  useEffect(() => {
    const bridge = getDesktopHostBridge();
    if (!bridge) return;
    let active = true;
    let unsubscribe = () => {};

    void hasHostCapability(HOST_CAPABILITIES.WINDOW, '1.0.0', bridge)
      .then(supported => {
        if (!active || !supported) return;
        void bridge
          .invoke<DesktopChromeInsets>(HOST_CAPABILITIES.WINDOW, 'getChromeState')
          .then(result => {
            if (active && result.ok && isChromeInsets(result.data)) {
              setChrome(result.data);
              applyDesktopDocumentAttributes(result.data);
            }
          })
          .catch(() => {});

        unsubscribe = bridge.subscribe(HOST_CAPABILITIES.WINDOW, 'chromeState', payload => {
          if (active && isChromeInsets(payload)) {
            setChrome(payload);
            applyDesktopDocumentAttributes(payload);
          }
        });
      })
      .catch(() => {});

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return chrome;
}

export function useDesktopUpdateState() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bridge = getDesktopHostBridge();
    if (!bridge) return;
    let active = true;
    let unsubscribe = () => {};

    void hasHostCapability(HOST_CAPABILITIES.UPDATER, '1.0.0', bridge)
      .then(supported => {
        if (!active || !supported) return;
        void bridge
          .invoke<DesktopUpdateState>(HOST_CAPABILITIES.UPDATER, 'getState')
          .then(result => {
            if (active && result.ok && isUpdateState(result.data)) {
              setState(result.data);
            }
          })
          .catch(() => {});

        unsubscribe = bridge.subscribe(HOST_CAPABILITIES.UPDATER, 'state', payload => {
          if (active && isUpdateState(payload)) {
            setState(payload);
          }
        });
      })
      .catch(() => {});

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const checkForUpdates = useCallback(async (): Promise<DesktopUpdateState | null> => {
    const bridge = getDesktopHostBridge();
    if (!bridge || !(await hasHostCapability(HOST_CAPABILITIES.UPDATER, '1.0.0', bridge))) {
      return null;
    }
    setBusy(true);
    try {
      const result = await bridge.invoke<DesktopUpdateState>(
        HOST_CAPABILITIES.UPDATER,
        'checkForUpdates',
      );
      if (result.ok && isUpdateState(result.data)) {
        setState(result.data);
        return result.data;
      }
      return null;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const downloadUpdate = useCallback(async (): Promise<DesktopUpdateState | null> => {
    const bridge = getDesktopHostBridge();
    if (!bridge || !(await hasHostCapability(HOST_CAPABILITIES.UPDATER, '1.0.0', bridge))) {
      return null;
    }
    setBusy(true);
    try {
      const result = await bridge.invoke<DesktopUpdateState>(
        HOST_CAPABILITIES.UPDATER,
        'downloadUpdate',
      );
      if (result.ok && isUpdateState(result.data)) {
        setState(result.data);
        return result.data;
      }
      return null;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const installUpdateNow = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    const bridge = getDesktopHostBridge();
    if (!bridge || !(await hasHostCapability(HOST_CAPABILITIES.UPDATER, '1.0.0', bridge))) {
      return { ok: false, error: 'Desktop updater unavailable' };
    }
    setBusy(true);
    try {
      const result = await bridge.invoke<{ ok?: boolean; error?: string }>(
        HOST_CAPABILITIES.UPDATER,
        'installNow',
      );
      if (result.ok) {
        return { ok: result.data?.ok ?? true, error: result.data?.error };
      }
      return { ok: false, error: result.error.message };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Install update failed' };
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    state,
    busy,
    checkForUpdates,
    downloadUpdate,
    installUpdateNow,
  };
}

export async function openExternalUrl(url: string): Promise<void> {
  const bridge = getDesktopHostBridge();
  if (bridge && (await hasHostCapability(HOST_CAPABILITIES.WINDOW, '1.0.0', bridge))) {
    try {
      const result = await bridge.invoke(HOST_CAPABILITIES.WINDOW, 'openExternal', { url });
      if (result.ok) return;
    } catch {
      // Fall through to standard browser open behavior.
    }
  }
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function exportDesktopDiagnosticBundle(): Promise<DesktopDiagnosticExportResult> {
  const bridge = getDesktopHostBridge();
  if (!bridge || !(await hasHostCapability(HOST_CAPABILITIES.DIAGNOSTICS, '1.0.0', bridge))) {
    return { ok: false, error: 'Desktop diagnostics unavailable' };
  }
  try {
    const result = await bridge.invoke<DesktopDiagnosticExportResult>(
      HOST_CAPABILITIES.DIAGNOSTICS,
      'exportBundle',
    );
    if (result.ok) {
      return result.data;
    }
    return { ok: false, error: result.error.message };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not export desktop diagnostics',
    };
  }
}

function resolveAbsoluteUrl(rawUrl: string): string {
  if (typeof window === 'undefined') return rawUrl;
  try {
    return new URL(rawUrl, window.location.origin).href;
  } catch {
    return rawUrl;
  }
}

/**
 * Start desktop system-browser login via the `account` capability when running inside
 * the Electron thin shell, falling back gracefully to external browser open or standard
 * web navigation when unavailable.
 */
export async function startDesktopBrowserLogin(
  options?: DesktopBrowserLoginOptions,
): Promise<DesktopBrowserLoginResult> {
  const fallbackReturnTo =
    options?.returnTo ??
    (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}${window.location.hash}` || '/'
      : '/');
  const targetUrl =
    options?.loginUrl ?? `/auth/login?returnTo=${encodeURIComponent(fallbackReturnTo)}`;

  const bridge = getDesktopHostBridge();
  if (bridge && (await hasHostCapability(HOST_CAPABILITIES.ACCOUNT, '1.0.0', bridge))) {
    try {
      const result = await bridge.invoke<{ url?: string }>(
        HOST_CAPABILITIES.ACCOUNT,
        'startBrowserLogin',
        {
          ...(options?.loginUrl ? { loginUrl: options.loginUrl } : {}),
          returnTo: fallbackReturnTo,
        },
      );
      if (result.ok) {
        return {
          ok: true,
          mode: 'desktop-account',
          url: result.data?.url ?? targetUrl,
        };
      }
      if (result.error.code !== 'UNSUPPORTED') {
        return {
          ok: false,
          mode: 'desktop-account',
          error: result.error.message,
        };
      }
    } catch {
      // Fall through to browser fallback.
    }
  }

  if (bridge && (await hasHostCapability(HOST_CAPABILITIES.WINDOW, '1.0.0', bridge))) {
    const absoluteUrl = resolveAbsoluteUrl(targetUrl);
    try {
      const opened = await bridge.invoke(HOST_CAPABILITIES.WINDOW, 'openExternal', {
        url: absoluteUrl,
      });
      if (opened.ok) {
        return { ok: true, mode: 'external-browser', url: absoluteUrl };
      }
    } catch {
      // Fall through to web redirect.
    }
  }

  if (typeof window !== 'undefined' && typeof window.location?.assign === 'function') {
    try {
      window.location.assign(targetUrl);
      return { ok: true, mode: 'web-redirect', url: targetUrl };
    } catch (error) {
      return {
        ok: false,
        mode: 'web-redirect',
        error: error instanceof Error ? error.message : 'Could not start sign-in',
      };
    }
  }

  return { ok: false, mode: 'web-redirect', error: 'Browser navigation unavailable' };
}

/**
 * Open a billing / subscription management URL in the system browser (or a new web tab)
 * and trigger a one-shot entitlement refresh when the user returns focus to Studio.
 */
export async function openBillingAndRefreshOnFocus(
  url: string,
  onRefresh?: () => void | Promise<void>,
  options?: {
    ttlMs?: number;
    dispatchAccountChanged?: boolean;
  },
): Promise<BillingReturnHandle> {
  await openExternalUrl(url);

  if (typeof window === 'undefined') {
    return { opened: true, cancel: () => {} };
  }

  let finished = false;
  let unsubHostFocus = () => {};
  const ttlMs = options?.ttlMs ?? 15 * 60 * 1000;

  const cancel = () => {
    if (finished) return;
    finished = true;
    clearTimeout(ttlTimer);
    window.removeEventListener('focus', trigger);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    unsubHostFocus();
  };

  const trigger = () => {
    if (finished) return;
    cancel();
    if (options?.dispatchAccountChanged !== false) {
      try {
        window.dispatchEvent(new Event('motion:account-changed'));
      } catch {
        // Ignore synthetic event dispatch errors in restricted environments.
      }
    }
    if (onRefresh) {
      void Promise.resolve()
        .then(() => onRefresh())
        .catch(() => {});
    }
  };

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      trigger();
    }
  };

  const ttlTimer = setTimeout(cancel, ttlMs);
  window.addEventListener('focus', trigger);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  const desktopBridge = getDesktopHostBridge();
  if (desktopBridge && (await hasHostCapability(HOST_CAPABILITIES.WINDOW, '1.0.0', desktopBridge))) {
    if (!finished) {
      try {
        unsubHostFocus = desktopBridge.subscribe(HOST_CAPABILITIES.WINDOW, 'focus', () => {
          trigger();
        });
      } catch {
        // Browser focus / visibility listeners still remain active.
      }
    }
  }

  return { opened: true, cancel };
}

/**
 * Invoke one of the 5 frozen K7 atomic local capabilities (`atom.*`) through whichever
 * host bridge is currently active (Electron desktop shell or Web Connect Script).
 * Never throws; returns a typed `HostInvokeResult`.
 */
export async function invokeHostAtom<T = unknown>(
  capability: HostAtomCapability,
  method: string,
  params?: Record<string, unknown>,
  options?: {
    minVersion?: string;
    bridge?: UniversalHostBridge;
  },
): Promise<HostInvokeResult<T>> {
  const bridge = options?.bridge ?? getActiveHostBridge();
  if (!bridge) {
    return hostErr('UNSUPPORTED', 'No local host bridge is connected.');
  }
  const minVersion = options?.minVersion ?? '1.0.0';
  const supported = await hasHostCapability(capability, minVersion, bridge);
  if (!supported) {
    return hostErr(
      'UNSUPPORTED',
      `Host capability "${capability}" (>= ${minVersion}) is unavailable.`,
    );
  }
  try {
    return await bridge.invoke<T>(capability, method, params);
  } catch (error) {
    return hostErr(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Local host invocation failed.',
    );
  }
}
