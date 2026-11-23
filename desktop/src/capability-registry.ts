import {
  HOST_CAPABILITIES,
  HOST_CAPABILITY_VERSIONS,
  hostErr,
  hostOk,
  type HostCapabilityDescriptor,
  type HostCapabilityStatus,
  type HostInvokeResult,
  type HostRuntimeInfo,
} from '../../shared/desktop-contract.ts';
import type {
  DesktopAppInfo,
  DesktopChromeInsets,
  DesktopDiagnosticExportResult,
  DesktopUpdateState,
} from '../../shared/platform-host.ts';
import { HOST_IPC_CHANNELS } from './ipc-guard.ts';

export type CapabilityInvokeContext = {
  origin?: string;
  url?: string;
  webContentsId?: number;
};

export type CapabilityValidationResult<TParams = Record<string, unknown>> =
  | { ok: true; value: TParams }
  | { ok: false; message: string; details?: Record<string, unknown> };

export type CapabilityParamValidator<TParams = Record<string, unknown>> = (
  params: Record<string, unknown>,
) => CapabilityValidationResult<TParams>;

export type CapabilityMethodDefinition<
  TParams = Record<string, unknown>,
  TResult = unknown,
> = {
  validate?: CapabilityParamValidator<TParams>;
  handler: (
    params: TParams,
    ctx: CapabilityInvokeContext,
  ) => Promise<HostInvokeResult<TResult>> | HostInvokeResult<TResult>;
};

export type CapabilityModule = {
  name: string;
  version: string;
  status: HostCapabilityStatus;
  reason?: string;
  methods: Record<string, CapabilityMethodDefinition<any, any>>;
  events?: readonly string[];
};

export type CapabilityEventMessage = {
  capability: string;
  event: string;
  payload: unknown;
};

export type CapabilityEventSink = (message: CapabilityEventMessage) => void;

export type CapabilityRegistryOptions = {
  sinks?: readonly CapabilityEventSink[];
  onInternalError?: (info: { capability: string; method: string; error: unknown }) => void;
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isHostInvokeResult(value: unknown): value is HostInvokeResult {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    return false;
  }
  if (value.ok === true) {
    return 'data' in value;
  }
  return (
    isPlainObject(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  );
}

/**
 * Main-process Capability Registry backing the universal 4-method bridge.
 *
 * Enforces:
 * - Unknown capabilities and methods return `UNSUPPORTED` (never throw).
 * - Unavailable capabilities return `UNSUPPORTED` with their declared reason.
 * - Non-object or schema-invalid parameters return `INVALID_PARAMS`.
 * - Unexpected handler throws are converted to sanitized `INTERNAL_ERROR`.
 */
export class CapabilityRegistry {
  private readonly modules = new Map<string, CapabilityModule>();
  private readonly sinks = new Set<CapabilityEventSink>();
  private readonly onInternalError?: (info: {
    capability: string;
    method: string;
    error: unknown;
  }) => void;

  constructor(options: CapabilityRegistryOptions = {}) {
    this.onInternalError = options.onInternalError;
    for (const sink of options.sinks ?? []) {
      this.sinks.add(sink);
    }
  }

  register(module: CapabilityModule): this {
    if (typeof module.name !== 'string' || !module.name.trim()) {
      throw new Error('Capability module name must be a non-empty string');
    }
    if (typeof module.version !== 'string' || !module.version.trim()) {
      throw new Error(`Capability module "${module.name}" version must be a non-empty string`);
    }
    this.modules.set(module.name, module);
    return this;
  }

  unregister(name: string): boolean {
    return this.modules.delete(name);
  }

  get(name: string): CapabilityModule | undefined {
    return this.modules.get(name);
  }

  has(name: string): boolean {
    return this.modules.has(name);
  }

  setStatus(name: string, status: HostCapabilityStatus, reason?: string): boolean {
    const existing = this.modules.get(name);
    if (!existing) return false;
    const { reason: _previousReason, ...rest } = existing;
    this.modules.set(name, {
      ...rest,
      status,
      ...(reason !== undefined ? { reason } : {}),
    });
    return true;
  }

  listCapabilities(): HostCapabilityDescriptor[] {
    const list: HostCapabilityDescriptor[] = [];
    for (const mod of this.modules.values()) {
      list.push({
        name: mod.name,
        version: mod.version,
        status: mod.status,
        ...(mod.reason !== undefined ? { reason: mod.reason } : {}),
        methods: Object.keys(mod.methods),
      });
    }
    return list;
  }

  addEventSink(sink: CapabilityEventSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  emit(capability: string, event: string, payload: unknown): void {
    if (!capability || !event) return;
    const message: CapabilityEventMessage = { capability, event, payload };
    for (const sink of this.sinks) {
      try {
        sink(message);
      } catch {
        // Ignore failing/destroyed event sinks so remaining subscribers still receive events.
      }
    }
  }

  async invoke<T = unknown>(
    capability: unknown,
    method: unknown,
    params?: unknown,
    ctx: CapabilityInvokeContext = {},
  ): Promise<HostInvokeResult<T>> {
    try {
      if (typeof capability !== 'string' || !capability.trim()) {
        return hostErr('INVALID_PARAMS', 'Capability name must be a non-empty string');
      }
      if (typeof method !== 'string' || !method.trim()) {
        return hostErr('INVALID_PARAMS', 'Method name must be a non-empty string');
      }

      let normalizedParams: Record<string, unknown>;
      if (params === undefined) {
        normalizedParams = {};
      } else if (isPlainObject(params)) {
        normalizedParams = params;
      } else {
        return hostErr('INVALID_PARAMS', 'Invoke params must be a plain object');
      }

      const mod = this.modules.get(capability);
      if (!mod) {
        return hostErr('UNSUPPORTED', `Unsupported capability: ${capability}`);
      }

      if (mod.status === 'unavailable') {
        return hostErr(
          'UNSUPPORTED',
          mod.reason || `Capability "${capability}" is currently unavailable`,
        );
      }

      if (!Object.prototype.hasOwnProperty.call(mod.methods, method)) {
        return hostErr('UNSUPPORTED', `Unsupported method "${method}" on capability "${capability}"`);
      }

      const methodDef = mod.methods[method];
      let validatedParams: unknown = normalizedParams;
      if (methodDef.validate) {
        const validation = methodDef.validate(normalizedParams);
        if (!validation.ok) {
          return hostErr('INVALID_PARAMS', validation.message, validation.details);
        }
        validatedParams = validation.value;
      }

      const result = await methodDef.handler(validatedParams, ctx);
      if (!isHostInvokeResult(result)) {
        return hostErr('INTERNAL_ERROR', `Invalid response from capability "${capability}.${method}"`);
      }
      return result as HostInvokeResult<T>;
    } catch (error) {
      const capLabel = typeof capability === 'string' ? capability : '<invalid>';
      const methodLabel = typeof method === 'string' ? method : '<invalid>';
      try {
        this.onInternalError?.({ capability: capLabel, method: methodLabel, error });
      } catch {
        // Never allow logger errors to escape invoke().
      }
      return hostErr(
        'INTERNAL_ERROR',
        `Capability "${capLabel}.${methodLabel}" encountered an internal error`,
      );
    }
  }
}

export type EventSenderWebContentsLike = {
  isDestroyed?: () => boolean;
  send: (channel: string, payload: unknown) => void;
};

/**
 * Creates a safe event sink forwarding capability events to a BrowserWindow's
 * webContents over the frozen `openmotion:host:event` channel.
 */
export function createWebContentsEventSink(
  getWebContents: () => EventSenderWebContentsLike | null | undefined,
): CapabilityEventSink {
  return message => {
    const wc = getWebContents();
    if (!wc || wc.isDestroyed?.()) return;
    wc.send(HOST_IPC_CHANNELS.EVENT, message);
  };
}

// ---------------------------------------------------------------------------
// Shell Capability Module Builders (Window, Updater, Diagnostics, Account)
// ---------------------------------------------------------------------------

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function validateThemeParams(
  params: Record<string, unknown>,
): CapabilityValidationResult<{ theme: 'light' | 'dark' }> {
  const theme = params.theme;
  if (theme !== 'light' && theme !== 'dark') {
    return { ok: false, message: 'Parameter "theme" must be "light" or "dark"' };
  }
  return { ok: true, value: { theme } };
}

function validateExternalUrlParams(
  params: Record<string, unknown>,
): CapabilityValidationResult<{ url: string }> {
  const raw = params.url;
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Parameter "url" must be a non-empty string' };
  }
  const trimmed = raw.trim();
  if (!trimmed || /[\r\n\0]/.test(trimmed)) {
    return { ok: false, message: 'Parameter "url" must be non-empty single-line text' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: 'Parameter "url" must be a valid URL' };
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      message: `Unsupported external URL protocol: "${parsed.protocol}"`,
    };
  }
  return { ok: true, value: { url: trimmed } };
}

function validateStartSignInParams(
  params: Record<string, unknown>,
): CapabilityValidationResult<{ returnPath?: string }> {
  const returnPath = params.returnPath;
  if (returnPath === undefined) {
    return { ok: true, value: {} };
  }
  if (typeof returnPath !== 'string') {
    return { ok: false, message: 'Parameter "returnPath" must be a string' };
  }
  if (/[\r\n\0]/.test(returnPath) || !returnPath.startsWith('/') || returnPath.startsWith('//')) {
    return {
      ok: false,
      message: 'Parameter "returnPath" must be a safe root-relative path',
    };
  }
  return { ok: true, value: { returnPath } };
}

export type WindowCapabilityDeps = {
  getChromeState: () => DesktopChromeInsets | Promise<DesktopChromeInsets>;
  setTheme: (theme: 'light' | 'dark') => void | Promise<void>;
  minimize: () => void | Promise<void>;
  toggleMaximize: () => void | Promise<void>;
  close: () => void | Promise<void>;
  openExternal: (url: string) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>;
  notifyRendererReady: () => void | Promise<void>;
  retryStartup?: () => void | Promise<void>;
  continueToStudio?: () => void | Promise<void>;
  status?: HostCapabilityStatus;
  reason?: string;
};

export function createWindowCapabilityModule(deps: WindowCapabilityDeps): CapabilityModule {
  return {
    name: HOST_CAPABILITIES.WINDOW,
    version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.WINDOW],
    status: deps.status ?? 'available',
    ...(deps.reason !== undefined ? { reason: deps.reason } : {}),
    events: ['chromeState', 'menuAction'],
    methods: {
      getChromeState: {
        handler: async () => hostOk(await deps.getChromeState()),
      },
      setTheme: {
        validate: validateThemeParams,
        handler: async ({ theme }: { theme: 'light' | 'dark' }) => {
          await deps.setTheme(theme);
          return hostOk({ theme });
        },
      },
      minimize: {
        handler: async () => {
          await deps.minimize();
          return hostOk({ ok: true });
        },
      },
      toggleMaximize: {
        handler: async () => {
          await deps.toggleMaximize();
          return hostOk({ ok: true });
        },
      },
      close: {
        handler: async () => {
          await deps.close();
          return hostOk({ ok: true });
        },
      },
      openExternal: {
        validate: validateExternalUrlParams,
        handler: async ({ url }: { url: string }) => hostOk(await deps.openExternal(url)),
      },
      notifyRendererReady: {
        handler: async () => {
          await deps.notifyRendererReady();
          return hostOk({ ok: true });
        },
      },
      retryStartup: {
        handler: async () => {
          if (!deps.retryStartup) {
            return hostErr('UNSUPPORTED', 'Startup retry is not supported in this host');
          }
          await deps.retryStartup();
          return hostOk({ ok: true });
        },
      },
      continueToStudio: {
        handler: async () => {
          if (!deps.continueToStudio) {
            return hostErr('UNSUPPORTED', 'Splash transition is not supported in this host');
          }
          await deps.continueToStudio();
          return hostOk({ ok: true });
        },
      },
    },
  };
}

export type UpdaterCapabilityDeps = {
  getUpdateState: () => DesktopUpdateState | Promise<DesktopUpdateState>;
  checkForUpdates: () => DesktopUpdateState | Promise<DesktopUpdateState>;
  downloadUpdate: () => DesktopUpdateState | Promise<DesktopUpdateState>;
  installUpdateNow: () => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>;
  status?: HostCapabilityStatus;
  reason?: string;
};

export function createUpdaterCapabilityModule(deps: UpdaterCapabilityDeps): CapabilityModule {
  return {
    name: HOST_CAPABILITIES.UPDATER,
    version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.UPDATER],
    status: deps.status ?? 'available',
    ...(deps.reason !== undefined ? { reason: deps.reason } : {}),
    events: ['state'],
    methods: {
      getState: {
        handler: async () => hostOk(await deps.getUpdateState()),
      },
      check: {
        handler: async () => hostOk(await deps.checkForUpdates()),
      },
      download: {
        handler: async () => hostOk(await deps.downloadUpdate()),
      },
      installNow: {
        handler: async () => hostOk(await deps.installUpdateNow()),
      },
    },
  };
}

export type DiagnosticsCapabilityDeps = {
  getAppInfo: () => HostRuntimeInfo | DesktopAppInfo | Promise<HostRuntimeInfo | DesktopAppInfo>;
  exportLogs: () => DesktopDiagnosticExportResult | Promise<DesktopDiagnosticExportResult>;
  openLogsFolder: () =>
    | { ok: boolean; path?: string; error?: string }
    | Promise<{ ok: boolean; path?: string; error?: string }>;
  status?: HostCapabilityStatus;
  reason?: string;
};

export function createDiagnosticsCapabilityModule(
  deps: DiagnosticsCapabilityDeps,
): CapabilityModule {
  return {
    name: HOST_CAPABILITIES.DIAGNOSTICS,
    version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.DIAGNOSTICS],
    status: deps.status ?? 'available',
    ...(deps.reason !== undefined ? { reason: deps.reason } : {}),
    events: [],
    methods: {
      getAppInfo: {
        handler: async () => hostOk(await deps.getAppInfo()),
      },
      exportLogs: {
        handler: async () => hostOk(await deps.exportLogs()),
      },
      openLogsFolder: {
        handler: async () => hostOk(await deps.openLogsFolder()),
      },
    },
  };
}

export type AccountCapabilityDeps = {
  startSignIn: (params?: { returnPath?: string }) => Record<string, unknown> | Promise<Record<string, unknown>>;
  cancelSignIn: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  refreshAccount: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  signOut?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  status?: HostCapabilityStatus;
  reason?: string;
};

export function createAccountCapabilityModule(deps: AccountCapabilityDeps): CapabilityModule {
  return {
    name: HOST_CAPABILITIES.ACCOUNT,
    version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.ACCOUNT],
    status: deps.status ?? 'available',
    ...(deps.reason !== undefined ? { reason: deps.reason } : {}),
    events: ['state'],
    methods: {
      startSignIn: {
        validate: validateStartSignInParams,
        handler: async (params: { returnPath?: string }) => hostOk(await deps.startSignIn(params)),
      },
      cancelSignIn: {
        handler: async () => hostOk(await deps.cancelSignIn()),
      },
      refresh: {
        handler: async () => hostOk(await deps.refreshAccount()),
      },
      signOut: {
        handler: async () => {
          if (!deps.signOut) {
            return hostErr('UNSUPPORTED', 'Sign-out is not supported in this host');
          }
          return hostOk(await deps.signOut());
        },
      },
    },
  };
}
