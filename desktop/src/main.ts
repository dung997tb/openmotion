import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STUDIO_URLS,
  DESKTOP_APP_ID,
  DESKTOP_DATA_LAYOUT_VERSION,
  DESKTOP_PRODUCT_NAME,
  DESKTOP_PROTOCOL_SCHEME,
  isUrlInAllowedDomainScope,
} from '../../shared/desktop-builtin-rules.ts';
import {
  HOST_CAPABILITIES,
  HOST_CAPABILITY_VERSIONS,
  HOST_CONTRACT_VERSION,
  hostErr,
  hostOk,
  type HostConfirmationRequest,
  type HostPlatform,
  type HostReleaseChannel,
  type HostRuntimeInfo,
} from '../../shared/desktop-contract.ts';
import type {
  DesktopChromeInsets,
  DesktopDiagnosticExportResult,
  DesktopMenuAction,
} from '../../shared/platform-host.ts';
import { createLocalAtomsRuntime } from '../../packages/local-atoms/index.ts';
import { SignedConfigManager } from '../../packages/signed-config/index.ts';
import { DesktopAuthHandoffManager } from './auth-handoff.ts';
import {
  CapabilityRegistry,
  createAccountCapabilityModule,
  createDiagnosticsCapabilityModule,
  createUpdaterCapabilityModule,
  createWebContentsEventSink,
  createWindowCapabilityModule,
  type CapabilityModule,
} from './capability-registry.ts';
import { ensureDesktopDataLayout } from './data-layout.ts';
import {
  authorizePrivilegedIpcSender,
  authorizeSplashSender,
  HOST_IPC_CHANNELS,
  type PrivilegedIpcGuardOptions,
} from './ipc-guard.ts';
import { createDesktopDiagnosticZip, DesktopLogger } from './logger.ts';
import { buildDesktopMenuTemplate } from './menu.ts';
import {
  buildMainWindowOptions,
  getWindowsTitleBarOverlay,
  normalizeDesktopPlatform,
  resolveDesktopChrome,
} from './platform.ts';
import {
  DesktopProtocolRouter,
  extractDeepLinkFromArgv,
  registerDesktopProtocolClient,
} from './protocol.ts';
import { SplashController } from './splash.ts';
import { DesktopUpdaterController } from './updater.ts';
import {
  attachWindowNavigationPolicies,
  isAllowedExternalUrl,
  type PolicyWebContentsLike,
  type WindowPolicyConfig,
} from './window-policy.ts';

const __filename = fileURLToPath(import.meta.url);
const distDir = path.dirname(__filename);
const platform: HostPlatform = normalizeDesktopPlatform(process.platform);

app.setName(DESKTOP_PRODUCT_NAME);
if (!process.argv.some(arg => arg.startsWith('--user-data-dir'))) {
  try {
    app.setPath('userData', path.join(app.getPath('appData'), 'OpenMotion'));
  } catch {
    // Ignore custom userData override failure on restricted hosts.
  }
}

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  app.quit();
  process.exit(0);
}

function resolveReleaseChannel(): HostReleaseChannel {
  const envChannel = process.env.MOTION_DESKTOP_CHANNEL?.trim().toLowerCase();
  if (envChannel === 'stable' || envChannel === 'test' || envChannel === 'dev') {
    return envChannel;
  }
  if (!app.isPackaged) return 'dev';
  return app.getVersion().includes('-') ? 'test' : 'stable';
}

const releaseChannel = resolveReleaseChannel();
const allowLocalDevLoopback = releaseChannel === 'dev' && !app.isPackaged;
const userDataRoot = app.getPath('userData');
const dataLayout = ensureDesktopDataLayout(userDataRoot);
const logDir = dataLayout.paths.logsDir;
const dataDir = dataLayout.paths.rootDir;

function resolveIconPath(): string | undefined {
  for (const file of ['app-icon.png', 'apple-touch-icon.png']) {
    const candidate = path.join(distDir, 'brand', file);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const logger = new DesktopLogger({
  logDir,
  redactPaths: [distDir, dataDir, logDir, os.homedir()],
});

logger.markSessionStarted({
  version: app.getVersion(),
  platform,
  arch: process.arch,
});

const signedConfig = new SignedConfigManager({
  dataDir: dataLayout.paths.configDir,
  channel: releaseChannel,
  allowLocalDevLoopback,
});

function resolveStudioUrl(): string {
  const envOverride = process.env.MOTION_DESKTOP_STUDIO_URL?.trim();
  if (
    envOverride &&
    isUrlInAllowedDomainScope(envOverride, { channel: releaseChannel, allowLocalDevLoopback })
  ) {
    return envOverride;
  }
  const active = signedConfig.getActiveConfig();
  if (
    active.studioUrl &&
    isUrlInAllowedDomainScope(active.studioUrl, { channel: releaseChannel, allowLocalDevLoopback })
  ) {
    return active.studioUrl;
  }
  return DEFAULT_STUDIO_URLS[releaseChannel];
}

function resolveStudioOrigin(): string {
  return new URL(resolveStudioUrl()).origin;
}

const linuxCustomTitleBar = process.env.MOTION_LINUX_NATIVE_FRAME !== '1';
let mainWindow: BrowserWindow | null = null;
let splash: SplashController | null = null;
let domFullscreen = false;
let currentTheme: 'light' | 'dark' = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
let rendererReady = false;
let shuttingDown = false;
let quitPromptOpen = false;
let inWindowAuthFallbackActive = false;
let showingRetryPage = false;
let pendingMenuActions: DesktopMenuAction[] = [];
const MAX_PENDING_MENU_ACTIONS = 32;
let signedConfigRefreshTimer: ReturnType<typeof setInterval> | null = null;

const protocolRouter = new DesktopProtocolRouter({
  onActivateMainWindow: () => {
    focusOrRestoreMainWindow();
  },
});
protocolRouter.subscribe(link => {
  registry.emit(HOST_CAPABILITIES.WINDOW, 'deep-link', link);
});

const updater = new DesktopUpdaterController({
  currentVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  channel: releaseChannel === 'stable' ? 'stable' : 'test',
  feedUrl: process.env.MOTION_DESKTOP_UPDATE_URL?.trim() || undefined,
});

const authHandoff = new DesktopAuthHandoffManager({
  studioOrigin: resolveStudioOrigin(),
  openExternal: async url => {
    await shell.openExternal(url);
  },
  exchangeFetch: async (url, init) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (!win) {
      throw new Error('Main window is unavailable for session exchange');
    }
    return await win.webContents.session.fetch(url, init);
  },
  onFocusMainWindow: () => {
    inWindowAuthFallbackActive = false;
    focusOrRestoreMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(resolveStudioUrl());
    }
  },
});

function formatConfirmationDetail(request: HostConfirmationRequest): string {
  const lines = [
    `Feature: ${request.featureTitle} (v${request.featureVersion})`,
    '',
    'This action will perform the following operations on your computer:',
  ];
  for (const fact of request.facts) {
    lines.push(`• ${fact.label}: ${fact.value}`);
  }
  return lines.join('\n');
}

async function confirmFeatureWithDialog(request: HostConfirmationRequest): Promise<boolean> {
  const parent =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getFocusedWindow() ?? undefined;
  const options = {
    type: 'question' as const,
    title: 'Confirm Local Action',
    message: `Allow ${request.featureTitle}?`,
    detail: formatConfirmationDetail(request),
    buttons: ['Cancel', 'Allow'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return response === 1;
}

const atomsRuntime = createLocalAtomsRuntime({
  dataDir,
  platform,
  arch: process.arch,
  channel: releaseChannel,
  allowLocalDevLoopback,
  appBundlePath: app.isPackaged ? process.resourcesPath : undefined,
  expectedMcpUrl: `${resolveStudioOrigin()}/mcp`,
  getSignedConfig: () => signedConfig.getActiveConfig(),
  confirmCallback: confirmFeatureWithDialog,
});

const registry = new CapabilityRegistry({
  sinks: [createWebContentsEventSink(() => mainWindow?.webContents)],
  onInternalError: ({ capability, method, error }) => {
    logger.error('main', `Capability error in ${capability}.${method}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  },
});

function currentChromeState(): DesktopChromeInsets {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const fullscreen = Boolean(win?.isFullScreen() || domFullscreen);
  const maximized = Boolean(win?.isMaximized());
  return resolveDesktopChrome({
    platform,
    fullscreen,
    maximized,
    linuxCustomTitleBar,
  });
}

function broadcastChromeState(): void {
  const state = currentChromeState();
  registry.emit(HOST_CAPABILITIES.WINDOW, 'chromeState', state);
  registry.emit(HOST_CAPABILITIES.WINDOW, 'chrome-state', state);
}

function focusOrRestoreMainWindow(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function buildRuntimeInfo(): HostRuntimeInfo {
  return {
    hostKind: 'desktop',
    shellVersion: app.getVersion(),
    contractVersion: HOST_CONTRACT_VERSION,
    platform,
    arch: process.arch,
    releaseChannel,
    isPackaged: app.isPackaged,
    appId: DESKTOP_APP_ID,
    productName: DESKTOP_PRODUCT_NAME,
    protocolScheme: DESKTOP_PROTOCOL_SCHEME,
    electronVersion: process.versions.electron ?? '',
    chromeVersion: process.versions.chrome ?? '',
    nodeVersion: process.versions.node ?? '',
    dataDir,
    logDir,
    dataLayoutVersion: DESKTOP_DATA_LAYOUT_VERSION,
  };
}

function getPrivilegedGuardOptions(): PrivilegedIpcGuardOptions {
  const active = signedConfig.getActiveConfig();
  return {
    mainWindow,
    channel: releaseChannel,
    studioUrl: resolveStudioUrl(),
    allowedOrigins: active.allowedOrigins,
    allowLocalDevLoopback,
  };
}

function getWindowPolicyConfig(): WindowPolicyConfig {
  const active = signedConfig.getActiveConfig();
  return {
    studioOrigin: resolveStudioOrigin(),
    channel: releaseChannel,
    allowedOrigins: active.allowedOrigins,
    windowPolicy: active.windowPolicy,
    inWindowAuthFallbackActive,
    allowLocalDevLoopback,
  };
}

function queuePendingMenuAction(action: DesktopMenuAction): void {
  if (pendingMenuActions.length >= MAX_PENDING_MENU_ACTIONS) {
    pendingMenuActions.shift();
  }
  pendingMenuActions.push(action);
}

function dispatchMenuAction(action: DesktopMenuAction): void {
  if (action === 'export-logs') {
    void exportLogsWithDialog();
    return;
  }
  if (action === 'reload-app' && mainWindow && !mainWindow.isDestroyed()) {
    void loadStudioIntoMainWindow();
    return;
  }
  if (action === 'check-updates') {
    void updater.checkForUpdates();
  }
  focusOrRestoreMainWindow();
  if (rendererReady) {
    registry.emit(HOST_CAPABILITIES.WINDOW, 'menuAction', action);
    registry.emit(HOST_CAPABILITIES.WINDOW, 'menu-action', action);
  } else {
    queuePendingMenuAction(action);
  }
}

async function openExternalSafe(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!isAllowedExternalUrl(url)) {
    return { ok: false, error: 'Unsupported external URL protocol' };
  }
  await shell.openExternal(url);
  return { ok: true };
}

async function exportLogsWithDialog(): Promise<DesktopDiagnosticExportResult> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `openmotion-diagnostics-${stamp}.zip`;
    const parent =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : splash?.window && !splash.window.isDestroyed()
          ? splash.window
          : undefined;
    const saveOptions = {
      title: 'Export OpenDesign Diagnostic Logs',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    };
    const picked = parent
      ? await dialog.showSaveDialog(parent, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (picked.canceled || !picked.filePath) {
      return { ok: false, canceled: true };
    }
    const result = await createDesktopDiagnosticZip({
      appRoot: distDir,
      dataDir,
      logDir,
      outPath: picked.filePath,
    });
    logger.info('main', 'Exported diagnostic bundle', { entryCount: result.entryCount });
    return { ok: true, path: result.path, entryCount: result.entryCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('main', 'Failed to export diagnostics', { error: message });
    return { ok: false, error: message };
  }
}

async function openLogsFolder(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const err = await shell.openPath(logDir);
  if (err) {
    return { ok: false, error: err };
  }
  return { ok: true, path: logDir };
}

function revealMainWindow(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) {
    win.show();
  }
  void splash?.playExitAndClose().catch(() => splash?.close());
  broadcastChromeState();
}

async function showRetryPage(info: { code?: string; message?: string; detail?: string }): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed() || showingRetryPage) return;
  showingRetryPage = true;
  rendererReady = false;
  const query: Record<string, string> = { theme: currentTheme };
  if (info.code) query.code = info.code;
  if (info.message) query.message = info.message;
  if (info.detail) query.detail = info.detail;
  await win.loadFile(path.join(distDir, 'retry.html'), { query });
  revealMainWindow();
}

async function loadStudioIntoMainWindow(): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  showingRetryPage = false;
  rendererReady = false;
  const targetUrl = resolveStudioUrl();
  logger.info('main', 'Loading cloud Studio URL', { url: targetUrl });
  try {
    await win.loadURL(targetUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('main', 'Failed to load cloud Studio URL', { error: message });
    await showRetryPage({
      code: 'LOAD_FAILED',
      message: 'Could not reach OpenDesign Cloud. Check your network connection and try again.',
      detail: message,
    });
  }
}

function registerCapabilities(): void {
  registry.register(
    createWindowCapabilityModule({
      getChromeState: () => currentChromeState(),
      setTheme: theme => {
        currentTheme = theme;
        nativeTheme.themeSource = currentTheme;
        if (platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.setTitleBarOverlay(getWindowsTitleBarOverlay(currentTheme));
          } catch {
            // Ignore overlay update failures on unsupported Electron modes.
          }
        }
      },
      minimize: () => {
        mainWindow?.minimize();
      },
      toggleMaximize: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
      },
      close: () => {
        mainWindow?.close();
      },
      openExternal: url => openExternalSafe(url),
      notifyRendererReady: () => {
        rendererReady = true;
        revealMainWindow();
        const queued = pendingMenuActions;
        pendingMenuActions = [];
        for (const action of queued) {
          registry.emit(HOST_CAPABILITIES.WINDOW, 'menuAction', action);
          registry.emit(HOST_CAPABILITIES.WINDOW, 'menu-action', action);
        }
      },
      retryStartup: async () => {
        await loadStudioIntoMainWindow();
      },
    }),
  );

  registry.register(
    createUpdaterCapabilityModule({
      getUpdateState: () => updater.getState(),
      checkForUpdates: () => updater.checkForUpdates(),
      downloadUpdate: () => updater.downloadUpdate(),
      installUpdateNow: () =>
        updater.installUpdateNow(async () => {
          shuttingDown = true;
          authHandoff.cancelLogin();
          logger.markSessionEnded('install-update');
        }),
    }),
  );

  registry.register(
    createDiagnosticsCapabilityModule({
      getAppInfo: () => buildRuntimeInfo(),
      exportLogs: () => exportLogsWithDialog(),
      openLogsFolder: () => openLogsFolder(),
    }),
  );

  registry.register(
    createAccountCapabilityModule({
      startSignIn: async params => {
        const result = await authHandoff.startLogin({
          switchAccount: params?.switchAccount,
        });
        return result as unknown as Record<string, unknown>;
      },
      cancelSignIn: () => authHandoff.cancelLogin() as unknown as Record<string, unknown>,
      refreshAccount: () => authHandoff.getState() as unknown as Record<string, unknown>,
      getLoginState: () => authHandoff.getState() as unknown as Record<string, unknown>,
      openBillingPortal: async ({ url }) => openExternalSafe(url),
      openInWindowLogin: async () => {
        inWindowAuthFallbackActive = true;
        const loginUrl = authHandoff.openInWindowFallback();
        if (mainWindow && !mainWindow.isDestroyed()) {
          await mainWindow.loadURL(loginUrl);
        }
        return { state: 'in-window', url: loginUrl };
      },
    }),
  );

  const signedConfigModule: CapabilityModule = {
    name: HOST_CAPABILITIES.SIGNED_CONFIG,
    version: HOST_CAPABILITY_VERSIONS[HOST_CAPABILITIES.SIGNED_CONFIG],
    status: 'available',
    events: ['updated'],
    methods: {
      getStatus: {
        handler: async () => hostOk(signedConfig.getStatus()),
      },
      refresh: {
        handler: async () => {
          const result = await signedConfig.fetchAndApply();
          if (result.applied && !result.unchanged) {
            registry.emit(HOST_CAPABILITIES.SIGNED_CONFIG, 'updated', signedConfig.getStatus());
          }
          return hostOk(result);
        },
      },
    },
  };
  registry.register(signedConfigModule);

  for (const [capName, atomHandler] of Object.entries(atomsRuntime.capabilities)) {
    const methods: CapabilityModule['methods'] = {};
    for (const methodName of atomHandler.descriptor.methods ?? []) {
      methods[methodName] = {
        handler: async params => atomHandler.invoke(methodName, params),
      };
    }
    if (capName === HOST_CAPABILITIES.ATOM_DETECT) {
      methods.detect = { handler: async params => atomHandler.invoke('scan', params) };
      methods.detectAll = { handler: async params => atomHandler.invoke('scan', params) };
    }
    if (capName === HOST_CAPABILITIES.ATOM_CREDENTIAL) {
      methods.startDeviceAuth = { handler: async params => atomHandler.invoke('start', params) };
      methods.pollDeviceAuth = { handler: async params => atomHandler.invoke('poll', params) };
    }
    registry.register({
      name: atomHandler.descriptor.name,
      version: atomHandler.descriptor.version,
      status: atomHandler.descriptor.status,
      ...(atomHandler.descriptor.reason ? { reason: atomHandler.descriptor.reason } : {}),
      methods,
    });
  }
}

function registerIpc(): void {
  ipcMain.handle(HOST_IPC_CHANNELS.INFO, event => {
    const auth = authorizePrivilegedIpcSender(event, getPrivilegedGuardOptions());
    if (!auth.ok) {
      throw new Error(auth.error.message);
    }
    return buildRuntimeInfo();
  });

  ipcMain.handle(HOST_IPC_CHANNELS.CAPABILITIES, event => {
    const auth = authorizePrivilegedIpcSender(event, getPrivilegedGuardOptions());
    if (!auth.ok) {
      throw new Error(auth.error.message);
    }
    return registry.listCapabilities();
  });

  ipcMain.handle(HOST_IPC_CHANNELS.INVOKE, async (event, payload: unknown) => {
    const auth = authorizePrivilegedIpcSender(event, getPrivilegedGuardOptions());
    if (!auth.ok) {
      return auth;
    }
    if (!payload || typeof payload !== 'object') {
      return hostErr('INVALID_PARAMS', 'IPC invoke payload must be an object');
    }
    const { capability, method, params } = payload as {
      capability?: unknown;
      method?: unknown;
      params?: unknown;
    };
    return await registry.invoke(capability, method, params, {
      origin: auth.origin,
      url: auth.url,
      webContentsId: auth.webContentsId,
    });
  });

  ipcMain.handle(HOST_IPC_CHANNELS.SPLASH_RETRY, async event => {
    const allowedFiles = [path.join(distDir, 'splash.html'), path.join(distDir, 'retry.html')];
    const auth =
      authorizeSplashSender(event, 'retryStartup', {
        splashWindow: splash?.window,
        allowedFilePaths: allowedFiles,
      }).ok
        ? { ok: true as const }
        : authorizeSplashSender(event, 'retryStartup', {
            splashWindow: mainWindow,
            allowedFilePaths: allowedFiles,
          });
    if (!auth.ok) {
      return auth;
    }
    await loadStudioIntoMainWindow();
    return hostOk({ ok: true });
  });

  ipcMain.on(HOST_IPC_CHANNELS.DOM_FULLSCREEN, (event, active: boolean) => {
    const auth = authorizePrivilegedIpcSender(event, getPrivilegedGuardOptions());
    if (!auth.ok) return;
    domFullscreen = Boolean(active);
    broadcastChromeState();
  });

  updater.subscribe(state => {
    registry.emit(HOST_CAPABILITIES.UPDATER, 'state', state);
  });

  authHandoff.subscribe(state => {
    registry.emit(HOST_CAPABILITIES.ACCOUNT, 'state', state);
    registry.emit(HOST_CAPABILITIES.ACCOUNT, 'login-state', state);
  });
}

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(distDir, 'preload.cjs');
  const win = new BrowserWindow(
    buildMainWindowOptions({
      platform,
      theme: currentTheme,
      linuxCustomTitleBar,
      preloadPath,
      iconPath: resolveIconPath(),
    }),
  );
  mainWindow = win;

  const policyWebContents: PolicyWebContentsLike = {
    on: (event, listener) => {
      win.webContents.on(event as 'will-navigate', listener as (event: Electron.Event, url: string) => void);
    },
    setWindowOpenHandler: handler => {
      win.webContents.setWindowOpenHandler(handler);
    },
  };

  attachWindowNavigationPolicies(policyWebContents, {
    getConfig: getWindowPolicyConfig,
    openExternal: async url => {
      await openExternalSafe(url);
    },
    onDecision: (kind, url, decision) => {
      if (decision.action === 'deny' && !decision.openExternal) {
        logger.warn('main', `Blocked ${kind}`, { url, reason: decision.reason });
      }
    },
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // Ignore subframe failures and ERR_ABORTED
    if (validatedURL.startsWith('file://')) return;
    logger.error('main', 'Cloud Studio load failed', { errorCode, errorDescription, validatedURL });
    void showRetryPage({
      code: `NET_${errorCode}`,
      message: 'OpenDesign Cloud could not be reached. Check your connection and try again.',
      detail: `${errorDescription} (${validatedURL})`,
    });
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (showingRetryPage && url.startsWith('file://') && url.includes('retry.html')) {
      event.preventDefault();
      void loadStudioIntoMainWindow();
    }
  });

  win.once('ready-to-show', () => {
    revealMainWindow();
  });

  win.on('close', event => {
    if (platform === 'darwin' && !shuttingDown) {
      event.preventDefault();
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => {
          if (!win.isDestroyed() && !shuttingDown) win.hide();
        });
        win.setFullScreen(false);
      } else {
        win.hide();
      }
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on('enter-full-screen', broadcastChromeState);
  win.on('leave-full-screen', broadcastChromeState);
  win.on('maximize', broadcastChromeState);
  win.on('unmaximize', broadcastChromeState);
  win.on('focus', () => {
    registry.emit(HOST_CAPABILITIES.WINDOW, 'focus', { focused: true });
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || input.shift) return;
    const primaryMod =
      platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
    if (!primaryMod) return;
    const key = input.key.toLowerCase();
    if (key === 'w') {
      event.preventDefault();
      minimizeFocusedWindow();
    } else if (key === 'm') {
      event.preventDefault();
      hideDesktopApp();
    } else if (key === 'q') {
      event.preventDefault();
      void requestQuitWithConfirmation();
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('renderer', 'Renderer process gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    logger.writeCrashMarker('renderer-gone', details);
  });

  return win;
}

async function bootDesktop(): Promise<void> {
  const preloadPath = path.join(distDir, 'preload.cjs');
  splash ??= new SplashController({
    onRetry: () => {
      void loadStudioIntoMainWindow();
    },
  });
  splash.open(distDir, preloadPath, currentTheme);
  splash.setProgress({
    step: 'ready',
    mode: 'booting',
    status: 'Connecting to OpenDesign Cloud',
  });

  // Best-effort signed config refresh before loading cloud Studio;
  // failures fall back cleanly to last-known-good or bundled defaults.
  await signedConfig.fetchAndApply().catch(() => {});

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  await loadStudioIntoMainWindow();

  if (app.isPackaged) {
    void updater.checkForUpdates().catch(() => {});
  }

  if (!signedConfigRefreshTimer) {
    signedConfigRefreshTimer = setInterval(() => {
      void signedConfig
        .fetchAndApply()
        .then(result => {
          if (result.applied && !result.unchanged) {
            registry.emit(HOST_CAPABILITIES.SIGNED_CONFIG, 'updated', signedConfig.getStatus());
          }
        })
        .catch(() => {});
    }, 30 * 60 * 1000);
  }
}

function minimizeFocusedWindow(): void {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (target && !target.isDestroyed()) {
    target.minimize();
  }
}

function hideDesktopApp(): void {
  if (platform === 'darwin') {
    app.hide();
    return;
  }
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (target && !target.isDestroyed()) {
    target.minimize();
  }
}

async function requestQuitWithConfirmation(): Promise<void> {
  if (shuttingDown || quitPromptOpen) return;
  quitPromptOpen = true;
  try {
    const isZh = app.getLocale().toLowerCase().startsWith('zh');
    const parent =
      BrowserWindow.getFocusedWindow() ??
      (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined);
    const options = {
      type: 'question' as const,
      title: isZh ? '退出 OpenDesign' : 'Quit OpenDesign',
      message: isZh ? '确认退出 OpenDesign 吗？' : 'Are you sure you want to quit OpenDesign?',
      buttons: isZh ? ['取消', '退出'] : ['Cancel', 'Quit'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    };
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (response === 1) {
      app.quit();
    }
  } finally {
    quitPromptOpen = false;
  }
}

process.on('uncaughtException', error => {
  logger.error('main', 'Uncaught exception', { message: error.message, stack: error.stack });
  logger.writeCrashMarker('uncaught-exception', error);
});

process.on('unhandledRejection', reason => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logger.error('main', 'Unhandled rejection', { message });
  logger.writeCrashMarker('unhandled-rejection', reason);
});

app.on('open-url', (event, rawUrl) => {
  event.preventDefault();
  protocolRouter.handleUrl(rawUrl);
});

app.on('second-instance', (_event, argv) => {
  const deepLink = extractDeepLinkFromArgv(argv);
  if (deepLink) {
    protocolRouter.handleUrl(deepLink);
  } else {
    focusOrRestoreMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow && app.isReady()) {
    void bootDesktop();
  } else {
    focusOrRestoreMainWindow();
  }
});

app.on('before-quit', () => {
  shuttingDown = true;
  authHandoff.cancelLogin();
  if (signedConfigRefreshTimer) {
    clearInterval(signedConfigRefreshTimer);
    signedConfigRefreshTimer = null;
  }
  logger.markSessionEnded('quit');
});

void app.whenReady().then(async () => {
  registerDesktopProtocolClient(app);
  registerCapabilities();
  registerIpc();

  const template = buildDesktopMenuTemplate({
    platform,
    appVersion: app.getVersion(),
    onAction: dispatchMenuAction,
    onOpenUrl: url => {
      void openExternalSafe(url);
    },
    onOpenLogsFolder: () => {
      void openLogsFolder();
    },
    onMinimizeWindow: minimizeFocusedWindow,
    onHideApp: hideDesktopApp,
    onRequestQuit: () => {
      void requestQuitWithConfirmation();
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  const initialDeepLink = extractDeepLinkFromArgv(process.argv);
  await bootDesktop();
  if (initialDeepLink) {
    protocolRouter.handleUrl(initialDeepLink);
  }
});
