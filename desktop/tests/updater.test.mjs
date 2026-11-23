import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_UPDATE_BASE_URL } from '../../shared/desktop-builtin-rules.ts';
import {
  compareSemver,
  DesktopUpdaterController,
  normalizeSemver,
  normalizeUpdateChannel,
  resolveElectronAutoUpdater,
  resolveUpdateFeedConfig,
} from '../src/updater.ts';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(testsDir, '..');
const repoRoot = path.resolve(desktopRoot, '..');

function createFakeAutoUpdater(overrides = {}) {
  const handlers = new Map();
  const feedCalls = [];
  let quitAndInstallArgs = null;

  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: null,
    setFeedURL(options) {
      feedCalls.push(options);
    },
    on(event, fn) {
      handlers.set(event, fn);
      return updater;
    },
    emit(event, ...args) {
      handlers.get(event)?.(...args);
    },
    async checkForUpdates() {},
    async downloadUpdate() {},
    quitAndInstall(isSilent, isForceRunAfter) {
      quitAndInstallArgs = { isSilent, isForceRunAfter };
    },
    ...overrides,
  };

  return {
    updater,
    handlers,
    feedCalls,
    getQuitAndInstallArgs: () => quitAndInstallArgs,
  };
}

test('resolveUpdateFeedConfig resolves generic object-storage feeds for stable and test channels', () => {
  assert.equal(normalizeUpdateChannel(undefined), 'stable');
  assert.equal(normalizeUpdateChannel('stable'), 'stable');
  assert.equal(normalizeUpdateChannel('test'), 'test');
  assert.equal(normalizeUpdateChannel('dev'), 'test');

  const stableFeed = resolveUpdateFeedConfig({ channel: 'stable' });
  assert.deepEqual(stableFeed, {
    provider: 'generic',
    url: `${DEFAULT_UPDATE_BASE_URL}/stable`,
    channel: 'stable',
  });

  const defaultFeed = resolveUpdateFeedConfig();
  assert.deepEqual(defaultFeed, stableFeed);

  const testFeed = resolveUpdateFeedConfig({ channel: 'test' });
  assert.deepEqual(testFeed, {
    provider: 'generic',
    url: `${DEFAULT_UPDATE_BASE_URL}/test`,
    channel: 'test',
  });

  // In-domain custom overrides are accepted and trailing slashes are normalized.
  const customStable = resolveUpdateFeedConfig({
    channel: 'stable',
    feedUrl: 'https://cdn.open-design.ai/open-motion/desktop/stable///',
  });
  assert.deepEqual(customStable, {
    provider: 'generic',
    url: 'https://cdn.open-design.ai/open-motion/desktop/stable',
    channel: 'stable',
  });

  const customTest = resolveUpdateFeedConfig({
    channel: 'test',
    feedUrl: 'https://openmotion.powerformer.net/releases/desktop/test/',
  });
  assert.deepEqual(customTest, {
    provider: 'generic',
    url: 'https://openmotion.powerformer.net/releases/desktop/test',
    channel: 'test',
  });
});

test('resolveUpdateFeedConfig and DesktopUpdaterController reject out-of-domain custom feed URLs', () => {
  const rejectedStableUrls = [
    'https://evil.example.com/open-motion/desktop/stable',
    'https://api.github.com/repos/nexu-io/openmotion/releases/latest',
    'https://openmotion.powerformer.net/releases/desktop/stable',
    'https://releases.open-design.ai.evil.com/open-motion/desktop/stable',
    'http://releases.open-design.ai/open-motion/desktop/stable',
    'https://user:pass@releases.open-design.ai/open-motion/desktop/stable',
    'file:///tmp/updates',
    'https://releases.open-design.ai/open-motion\n/injected',
  ];

  for (const badUrl of rejectedStableUrls) {
    assert.throws(
      () => resolveUpdateFeedConfig({ channel: 'stable', feedUrl: badUrl }),
      /outside allowed domain scope|control characters/i,
      `Expected stable feed rejection for ${badUrl}`,
    );
    assert.throws(
      () =>
        new DesktopUpdaterController({
          currentVersion: '0.2.1',
          isPackaged: true,
          channel: 'stable',
          feedUrl: badUrl,
        }),
      /outside allowed domain scope|control characters/i,
      `Expected controller constructor rejection for ${badUrl}`,
    );
  }

  // Test channel still rejects untrusted external domains and plain HTTP.
  for (const badTestUrl of [
    'https://evil.example.com/desktop/test',
    'https://github.com/nexu-io/openmotion/releases',
    'http://openmotion.powerformer.net/desktop/test',
  ]) {
    assert.throws(
      () => resolveUpdateFeedConfig({ channel: 'test', feedUrl: badTestUrl }),
      /outside allowed domain scope/i,
      `Expected test feed rejection for ${badTestUrl}`,
    );
  }
});

test('GitHub Releases fallback is completely removed and missing/unreachable generic feed returns explicit error', async () => {
  const updaterSource = readFileSync(path.join(desktopRoot, 'src', 'updater.ts'), 'utf8');
  assert.equal(updaterSource.includes('GITHUB_LATEST_RELEASE_API'), false);
  assert.equal(updaterSource.includes('checkViaGitHubApi'), false);
  assert.equal(updaterSource.includes('usingGitHubFallback'), false);
  assert.equal(updaterSource.includes('api.github.com'), false);

  // Verify global fetch is never invoked when the generic feed returns 404 or is unreachable.
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('Unexpected fetch call');
  };

  try {
    const missingFeedMock = createFakeAutoUpdater({
      async checkForUpdates() {
        throw new Error('HttpError: 404 "Cannot find channel stable-mac.yml update info"');
      },
    });
    const controller404 = new DesktopUpdaterController({
      currentVersion: '0.2.1',
      isPackaged: true,
      channel: 'stable',
      loadAutoUpdater: async () => missingFeedMock.updater,
    });

    const missingState = await controller404.checkForUpdates();
    assert.equal(missingState.status, 'error');
    assert.match(missingState.message ?? '', /Update feed manifest not found/i);
    assert.match(missingState.message ?? '', /releases\.open-design\.ai\/open-motion\/desktop\/stable/);
    assert.equal(fetchCalled, false, 'Updater must never fall back to GitHub HTTP fetch');

    const unreachableMock = createFakeAutoUpdater({
      async checkForUpdates() {
        throw new Error('net::ERR_NAME_NOT_RESOLVED');
      },
    });
    const controllerNet = new DesktopUpdaterController({
      currentVersion: '0.2.1',
      isPackaged: true,
      channel: 'test',
      loadAutoUpdater: async () => unreachableMock.updater,
    });

    const netState = await controllerNet.checkForUpdates();
    assert.equal(netState.status, 'error');
    assert.match(netState.message ?? '', /Update feed unreachable/i);
    assert.match(netState.message ?? '', /releases\.open-design\.ai\/open-motion\/desktop\/test/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DesktopUpdaterController configures generic feed with silent background auto-download and installUpdateNow', async () => {
  const unpackaged = new DesktopUpdaterController({ currentVersion: '0.2.1', isPackaged: false });
  assert.equal(unpackaged.getState().status, 'unsupported');
  assert.equal((await unpackaged.checkForUpdates()).status, 'unsupported');
  assert.equal((await unpackaged.downloadUpdate()).status, 'unsupported');
  assert.equal((await unpackaged.installUpdateNow()).ok, false);

  let beforeQuitCalled = false;
  let downloadInvoked = 0;

  const mock = createFakeAutoUpdater({
    async checkForUpdates() {
      mock.updater.emit('checking-for-update');
      mock.updater.emit('update-available', {
        version: '0.3.0',
        releaseNotesUrl: 'https://releases.open-design.ai/open-motion/desktop/stable/notes-0.3.0.html',
      });
      // Simulate electron-updater automatic background download when autoDownload === true.
      if (mock.updater.autoDownload) {
        mock.updater.emit('download-progress', { percent: 42.6 });
        mock.updater.emit('update-downloaded', { version: '0.3.0' });
      }
    },
    async downloadUpdate() {
      downloadInvoked += 1;
    },
    quitAndInstall(isSilent, isForceRunAfter) {
      assert.equal(beforeQuitCalled, true, 'beforeQuit hook must complete before quitAndInstall');
      mock.updater.lastQuitCall = { isSilent, isForceRunAfter };
    },
  });

  const controller = new DesktopUpdaterController({
    currentVersion: '0.2.1',
    isPackaged: true,
    channel: 'stable',
    loadAutoUpdater: async () => mock.updater,
  });

  const observedStatuses = [];
  const unsubscribe = controller.subscribe(state => {
    observedStatuses.push({
      status: state.status,
      availableVersion: state.availableVersion,
      progress: state.progress,
    });
  });

  const finalState = await controller.checkForUpdates();
  unsubscribe();

  assert.equal(mock.updater.autoDownload, true);
  assert.equal(mock.updater.autoInstallOnAppQuit, true);
  assert.deepEqual(mock.feedCalls, [
    {
      provider: 'generic',
      url: 'https://releases.open-design.ai/open-motion/desktop/stable',
      channel: 'stable',
    },
  ]);

  assert.deepEqual(
    observedStatuses.map(entry => entry.status),
    ['checking', 'checking', 'available', 'downloading', 'downloaded'],
  );
  assert.equal(observedStatuses[3].progress, 43);
  assert.equal(finalState.status, 'downloaded');
  assert.equal(finalState.availableVersion, '0.3.0');
  assert.equal(finalState.progress, 100);
  assert.equal(
    finalState.releaseNotesUrl,
    'https://releases.open-design.ai/open-motion/desktop/stable/notes-0.3.0.html',
  );

  // Calling downloadUpdate() after background download already completed is idempotent.
  const redownload = await controller.downloadUpdate();
  assert.equal(redownload.status, 'downloaded');
  assert.equal(downloadInvoked, 0);

  const installResult = await controller.installUpdateNow(async () => {
    beforeQuitCalled = true;
  });
  assert.deepEqual(installResult, { ok: true });
  assert.deepEqual(mock.updater.lastQuitCall, { isSilent: false, isForceRunAfter: true });
});

test('DesktopUpdaterController supports manual downloadUpdate and CJS/ESM autoUpdater resolution', async () => {
  const mock = createFakeAutoUpdater({
    async checkForUpdates() {
      mock.updater.emit('checking-for-update');
      mock.updater.emit('update-available', {
        version: '0.3.1',
        // Untrusted releaseNotesUrl must be stripped.
        releaseNotesUrl: 'https://evil.example.com/notes',
      });
    },
    async downloadUpdate() {
      mock.updater.emit('download-progress', { percent: 80 });
      mock.updater.emit('update-downloaded', { version: '0.3.1' });
    },
  });

  assert.equal(resolveElectronAutoUpdater({ default: { autoUpdater: mock.updater } }), mock.updater);
  assert.equal(resolveElectronAutoUpdater({ autoUpdater: mock.updater }), mock.updater);
  assert.throws(() => resolveElectronAutoUpdater({ autoUpdater: { checkForUpdates() {} } }), /unavailable/i);

  assert.equal(normalizeSemver('v0.3.1'), '0.3.1');
  assert.ok(compareSemver('0.3.1', '0.3.0') > 0);
  assert.equal(compareSemver('v0.3.1', '0.3.1'), 0);

  const controller = new DesktopUpdaterController({
    currentVersion: '0.3.0',
    isPackaged: true,
    channel: 'test',
    autoDownload: false,
    loadAutoUpdater: async () => mock.updater,
  });

  const avail = await controller.checkForUpdates();
  assert.equal(avail.status, 'available');
  assert.equal(avail.availableVersion, '0.3.1');
  assert.equal(avail.releaseNotesUrl, undefined);

  const downloaded = await controller.downloadUpdate();
  assert.equal(downloaded.status, 'downloaded');
  assert.equal(downloaded.progress, 100);
});

test('desktop/electron-builder.yml defines thin-shell packaging, openmotion protocol, generic publish, and no Linux/app-server', () => {
  const builderYml = readFileSync(path.join(desktopRoot, 'electron-builder.yml'), 'utf8');

  assert.match(builderYml, /^appId:\s*io\.nexu\.openmotion\.desktop$/m);
  assert.match(builderYml, /^productName:\s*OpenDesign$/m);

  // Thin shell: no bundled app-server extraResources.
  assert.equal(builderYml.includes('extraResources'), false);
  assert.equal(builderYml.includes('app-server'), false);

  // Protocol registration for openmotion://.
  assert.match(builderYml, /^protocols:\s*$/m);
  assert.match(builderYml, /name:\s*OpenDesign/);
  assert.match(builderYml, /-\s*openmotion\b/);

  // macOS notarization and arm64 + x64 dmg/zip targets.
  assert.match(builderYml, /^mac:\s*$/m);
  assert.match(builderYml, /^\s+notarize:\s*true$/m);
  assert.match(builderYml, /target:\s*dmg/);
  assert.match(builderYml, /target:\s*zip/);
  assert.match(builderYml, /-\s*arm64/);
  assert.match(builderYml, /-\s*x64/);

  // Windows nsis + portable x64 targets only.
  assert.match(builderYml, /^win:\s*$/m);
  assert.match(builderYml, /target:\s*nsis/);
  assert.match(builderYml, /target:\s*portable/);
  const winBlockMatch = builderYml.match(/^win:\n([\s\S]*?)^\S/m);
  assert.ok(winBlockMatch, 'Expected win section in electron-builder.yml');
  assert.equal(winBlockMatch[1].includes('arm64'), false, 'Windows first package targets x64 only');

  // No Linux packaging target.
  assert.equal(/^linux:/m.test(builderYml), false);
  assert.equal(builderYml.includes('AppImage'), false);

  // Generic object-storage publish configuration (no GitHub provider).
  assert.match(builderYml, /^publish:\s*$/m);
  assert.match(builderYml, /provider:\s*generic/);
  assert.match(
    builderYml,
    /url:\s*https:\/\/releases\.open-design\.ai\/open-motion\/desktop\/stable/,
  );
  assert.equal(builderYml.includes('provider: github'), false);
});

test('desktop/package.json pins Electron 45.4.1 with per-arch thin-shell scripts and build.mjs copies retry.html', () => {
  const pkg = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));

  assert.equal(pkg.devDependencies.electron, '45.4.1');
  assert.equal(typeof pkg.scripts['pack:mac:arm64'], 'string');
  assert.equal(typeof pkg.scripts['pack:mac:x64'], 'string');
  assert.equal(typeof pkg.scripts['pack:win:x64'], 'string');
  assert.equal(typeof pkg.scripts['pack:dir'], 'string');
  assert.equal(typeof pkg.scripts['pack:mac:local'], 'string');
  assert.equal(pkg.scripts['pack:linux'], undefined);

  for (const key of ['pack:mac:arm64', 'pack:mac:x64', 'pack:win:x64', 'pack:dir', 'pack:mac:local']) {
    assert.equal(
      pkg.scripts[key].includes('stage'),
      false,
      `${key} must not run stage-app.mjs in thin-shell packaging`,
    );
  }

  const buildScript = readFileSync(path.join(desktopRoot, 'scripts', 'build.mjs'), 'utf8');
  assert.match(buildScript, /splash\.html/);
  assert.match(buildScript, /retry\.html/);
});

test('.github/workflows/desktop-release.yml enforces main-only per-arch builds with direct release-bucket upload', () => {
  const workflowYml = readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'desktop-release.yml'),
    'utf8',
  );

  // Manual workflow_dispatch only with channel (test | stable, default test) and publish (default false).
  assert.match(workflowYml, /workflow_dispatch:/);
  assert.match(workflowYml, /default:\s*test/);
  assert.match(workflowYml, /-\s*test\b/);
  assert.match(workflowYml, /-\s*stable\b/);
  assert.match(workflowYml, /default:\s*false/);

  // Main-only guard.
  assert.match(workflowYml, /refs\/heads\/main/);

  // Per-architecture matrix jobs: macOS arm64, macOS x64, Windows x64.
  assert.match(workflowYml, /label:\s*macOS arm64/);
  assert.match(workflowYml, /label:\s*macOS x64/);
  assert.match(workflowYml, /label:\s*Windows x64/);
  assert.match(workflowYml, /os:\s*macos-15/);
  assert.match(workflowYml, /os:\s*windows-latest/);
  assert.match(workflowYml, /pack_script:\s*pack:mac:arm64/);
  assert.match(workflowYml, /pack_script:\s*pack:mac:x64/);
  assert.match(workflowYml, /pack_script:\s*pack:win:x64/);

  // Apple Developer ID signing & notarization env wiring.
  assert.match(workflowYml, /CSC_LINK:/);
  assert.match(workflowYml, /CSC_KEY_PASSWORD:/);
  assert.match(workflowYml, /APPLE_ID:/);
  assert.match(workflowYml, /APPLE_APP_SPECIFIC_PASSWORD:/);
  assert.match(workflowYml, /APPLE_TEAM_ID:/);
  assert.match(workflowYml, /APPLE_API_KEY:/);

  // No GitHub Actions artifact upload or GitHub Release binary upload.
  assert.equal(workflowYml.includes('upload-artifact'), false);
  assert.equal(workflowYml.includes('gh release upload'), false);

  // Direct object-storage upload targeting releases.open-design.ai / open-motion/desktop/<channel>/.
  assert.match(workflowYml, /releases\.open-design\.ai/);
  assert.match(workflowYml, /open-motion\/desktop\//);
  assert.match(workflowYml, /aws\s+.*s3 cp/);
});
