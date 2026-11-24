import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_UPDATE_BASE_URL } from '../../shared/desktop-builtin-rules.ts';
import { resolveDesktopReleaseVersion } from '../scripts/resolve-release-version.mjs';
import {
  compareSemver,
  DesktopUpdaterController,
  normalizeSemver,
  normalizeUpdateChannel,
  resolveElectronAutoUpdater,
  resolvePackagedReleaseChannel,
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

  // macOS notarization and dmg/zip targets (arch selected per CLI job: --arm64 or --x64).
  assert.match(builderYml, /^mac:\s*$/m);
  assert.match(builderYml, /^\s+notarize:\s*true$/m);
  assert.match(builderYml, /target:\s*dmg/);
  assert.match(builderYml, /target:\s*zip/);
  const macBlockMatch = builderYml.match(/^mac:\n([\s\S]*?)^\S/m);
  assert.ok(macBlockMatch, 'Expected mac section in electron-builder.yml');
  assert.equal(
    macBlockMatch[1].includes('arch:'),
    false,
    'mac target must inherit single --arm64 / --x64 CLI arch flag instead of forcing multi-arch on one runner',
  );

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

  // Manual workflow_dispatch plus automatic push trigger on desktop-test branch for desktop & coupled shared paths.
  assert.match(workflowYml, /push:\s*\n\s+branches:\s*\n\s+-\s*desktop-test\b/);
  assert.match(workflowYml, /'desktop\/\*\*'/);
  assert.match(workflowYml, /'shared\/desktop-\*\.ts'/);
  assert.match(workflowYml, /'shared\/platform-host\.ts'/);
  assert.match(workflowYml, /'shared\/signed-config\.ts'/);
  assert.match(workflowYml, /'packages\/design-system\/brand\/\*\*'/);
  assert.match(workflowYml, /'\.github\/workflows\/desktop-release\.yml'/);
  assert.match(workflowYml, /workflow_dispatch:/);
  assert.match(workflowYml, /default:\s*test/);
  assert.match(workflowYml, /-\s*test\b/);
  assert.match(workflowYml, /-\s*stable\b/);
  assert.match(workflowYml, /default:\s*false/);

  // Branch & channel release guards + Scheme A release version resolution.
  assert.match(workflowYml, /refs\/heads\/main/);
  assert.match(workflowYml, /refs\/heads\/desktop-test/);
  assert.match(workflowYml, /resolve-release-version\.mjs/);
  assert.match(workflowYml, /-c\.extraMetadata\.version=/);
  assert.match(workflowYml, /-c\.buildNumber=/);
  assert.match(workflowYml, /-c\.buildVersion=/);

  // Per-architecture matrix definitions: macOS arm64, optional macOS x64, Windows x64.
  assert.match(workflowYml, /label:\s*"?macOS arm64"?/);
  assert.match(workflowYml, /label:\s*"?macOS x64"?/);
  assert.match(workflowYml, /label:\s*"?Windows x64"?/);
  assert.match(workflowYml, /os:\s*"?macos-15"?/);
  assert.match(workflowYml, /os:\s*"?windows-latest"?/);
  assert.match(workflowYml, /pack_script:\s*"?pack:mac:arm64"?/);
  assert.match(workflowYml, /pack_script:\s*"?pack:mac:x64"?/);
  assert.match(workflowYml, /pack_script:\s*"?pack:win:x64"?/);

  // Apple Developer ID signing & fast notarization hook wiring (org-level secrets with fallback).
  assert.match(workflowYml, /CSC_LINK:.*APPLE_SIGNING_CERTIFICATE_BASE64/);
  assert.match(workflowYml, /CSC_KEY_PASSWORD:.*APPLE_SIGNING_CERTIFICATE_PASSWORD/);
  assert.match(workflowYml, /APPLE_ID:/);
  assert.match(workflowYml, /APPLE_APP_SPECIFIC_PASSWORD:/);
  assert.match(workflowYml, /APPLE_TEAM_ID:/);
  assert.match(workflowYml, /APPLE_API_KEY:/);
  assert.match(workflowYml, /-c\.afterSign=scripts\/notarize\.cjs/);

  // Parallel DAG (prepare -> verify-desktop || build-desktop -> publish-manifests), sparse checkout, and binary caching.
  assert.match(workflowYml, /^  prepare:/m);
  assert.match(workflowYml, /^  verify-desktop:/m);
  assert.match(workflowYml, /^  publish-manifests:/m);
  assert.match(workflowYml, /needs:\s*\[prepare,\s*verify-desktop,\s*build-desktop\]/);
  assert.match(workflowYml, /sparse-checkout:/);
  assert.match(workflowYml, /ELECTRON_SKIP_BINARY_DOWNLOAD:\s*'1'/);
  assert.match(workflowYml, /uses:\s*actions\/cache@v4/);
  assert.match(workflowYml, /desktop\/package-lock\.json/);
  assert.match(workflowYml, /-c\.win\.target=nsis/);
  assert.match(workflowYml, /\$\{EXTRA_BUILDER_ARGS\[@\]\+"\$\{EXTRA_BUILDER_ARGS\[@\]\}"\}/);
  assert.match(workflowYml, /max_concurrent_requests/);

  // No GitHub Actions artifact upload or GitHub Release binary upload.
  assert.equal(workflowYml.includes('upload-artifact'), false);
  assert.equal(workflowYml.includes('gh release upload'), false);

  // Direct Cloudflare R2 / S3 upload targeting releases.open-design.ai / open-motion/desktop/<channel>/.
  assert.match(workflowYml, /CLOUDFLARE_R2_RELEASES_BUCKET/);
  assert.match(workflowYml, /CLOUDFLARE_R2_RELEASES_URL/);
  assert.match(workflowYml, /CLOUDFLARE_R2_RELEASES_AK/);
  assert.match(workflowYml, /CLOUDFLARE_R2_RELEASES_SK/);
  assert.match(workflowYml, /AWS_DEFAULT_REGION:\s*auto/);
  assert.match(workflowYml, /AWS_REQUEST_CHECKSUM_CALCULATION:\s*when_required/);
  assert.match(workflowYml, /releases\.open-design\.ai/);
  assert.match(workflowYml, /open-motion\/desktop\//);
  assert.match(workflowYml, /aws\s+.*s3 cp/);
  assert.match(workflowYml, /extraMetadata\.openmotionChannel=/);
  assert.match(workflowYml, /npm --prefix desktop ci/);
  assert.match(workflowYml, /npm --prefix desktop test/);
});

test('desktop/scripts/notarize.cjs skips non-darwin or OM_SKIP_NOTARIZE and resolves Apple credentials', async () => {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const notarizeHook = req(path.join(desktopRoot, 'scripts', 'notarize.cjs'));

  const nonDarwin = await notarizeHook({ electronPlatformName: 'win32' });
  assert.deepEqual(nonDarwin, { skipped: true, reason: 'non-darwin' });

  const prevSkip = process.env.OM_SKIP_NOTARIZE;
  process.env.OM_SKIP_NOTARIZE = '1';
  try {
    const skipped = await notarizeHook({ electronPlatformName: 'darwin' });
    assert.deepEqual(skipped, { skipped: true, reason: 'skip-env' });
  } finally {
    if (prevSkip === undefined) {
      delete process.env.OM_SKIP_NOTARIZE;
    } else {
      process.env.OM_SKIP_NOTARIZE = prevSkip;
    }
  }

  assert.equal(
    notarizeHook.resolveNotaryCredentials({
      APPLE_ID: 'dev@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'secret',
      APPLE_TEAM_ID: 'TEAM123',
    })?.mode,
    'apple-id',
  );
  assert.equal(
    notarizeHook.resolveNotaryCredentials({
      APPLE_API_KEY: '/tmp/key.p8',
      APPLE_API_KEY_ID: 'KEY123',
      APPLE_API_ISSUER: 'ISSUER123',
    })?.mode,
    'api-key',
  );
  assert.equal(notarizeHook.resolveNotaryCredentials({}), null);
});

test('desktop/scripts/sign-mac.cjs detects Mach-O binaries, layers bottom-up, and caps concurrency at 6', async () => {
  const { createRequire } = await import('node:module');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const os = await import('node:os');
  const req = createRequire(import.meta.url);
  const signMac = req(path.join(desktopRoot, 'scripts', 'sign-mac.cjs'));

  const builderYml = readFileSync(path.join(desktopRoot, 'electron-builder.yml'), 'utf8');
  assert.match(builderYml, /^\s+sign:\s*scripts\/sign-mac\.cjs$/m);
  assert.equal(signMac.resolveConcurrency({}), 6);
  assert.equal(signMac.resolveConcurrency({ OM_CODESIGN_CONCURRENCY: '4' }), 4);

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'om-sign-mac-test-'));
  try {
    const macho64 = path.join(tmpDir, 'bin64');
    writeFileSync(macho64, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]));
    const fatMacho = path.join(tmpDir, 'fat');
    writeFileSync(fatMacho, Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x02]));
    const javaClass = path.join(tmpDir, 'Fake.class');
    writeFileSync(javaClass, Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x37]));
    const pakFile = path.join(tmpDir, 'locale.pak');
    writeFileSync(pakFile, Buffer.from([0x05, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04]));

    assert.equal(signMac.isMachOFile(macho64), true);
    assert.equal(signMac.isMachOFile(fatMacho), true);
    assert.equal(signMac.isMachOFile(javaClass), false);
    assert.equal(signMac.isMachOFile(pakFile), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const waves = signMac.groupSigningLayers([
    '/App.app/Contents/Frameworks/Electron Framework.framework',
    '/App.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib',
    '/App.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler',
    '/App.app/Contents/Frameworks/Squirrel.framework',
    '/App.app/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt',
    '/App.app/Contents/Frameworks/Helper.app',
  ]);
  assert.equal(waves.length, 2);
  assert.deepEqual(waves[0], [
    '/App.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler',
    '/App.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib',
    '/App.app/Contents/Frameworks/Helper.app',
    '/App.app/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt',
  ]);
  assert.deepEqual(waves[1], [
    '/App.app/Contents/Frameworks/Electron Framework.framework',
    '/App.app/Contents/Frameworks/Squirrel.framework',
  ]);

  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 18 }, (_, i) => i);
  const out = await signMac.runWithConcurrency(items, 6, async (item) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return item * 2;
  });
  assert.equal(peak <= 6 && peak >= 2, true, `expected bounded concurrency <=6, got peak=${peak}`);
  assert.deepEqual(out, items.map((i) => i * 2));

  const args = signMac.buildCodesignArgs(
    '/App.app',
    { identity: 'ABC123', keychain: '/tmp/build.keychain' },
    { hardenedRuntime: true, entitlements: '/tmp/entitlements.mac.plist' },
  );
  assert.deepEqual(args, [
    '--sign',
    'ABC123',
    '--force',
    '--keychain',
    '/tmp/build.keychain',
    '--timestamp',
    '--options',
    'runtime',
    '--entitlements',
    '/tmp/entitlements.mac.plist',
    '/App.app',
  ]);
});

test('resolvePackagedReleaseChannel preserves test channel from bundle metadata even for clean semver versions', () => {
  assert.equal(
    resolvePackagedReleaseChannel({
      isPackaged: true,
      version: '0.2.1',
      packageChannel: 'test',
    }),
    'test',
  );
  assert.equal(
    resolvePackagedReleaseChannel({
      isPackaged: true,
      version: '0.2.1',
      appUpdateYmlContent: 'provider: generic\nurl: https://releases.open-design.ai/open-motion/desktop/test\nchannel: test\n',
    }),
    'test',
  );
  assert.equal(
    resolvePackagedReleaseChannel({
      isPackaged: true,
      version: '0.2.1',
      envChannel: 'dev',
      packageChannel: 'stable',
    }),
    'stable',
    'packaged builds must not allow MOTION_DESKTOP_CHANNEL=dev override',
  );
  assert.equal(
    resolvePackagedReleaseChannel({
      isPackaged: false,
      version: '0.2.1',
    }),
    'dev',
  );
});

test('resolveDesktopReleaseVersion implements Scheme A monotonic SemVer and Windows PE buildVersion', () => {
  const test1 = resolveDesktopReleaseVersion({ baseVersion: '0.2.1', channel: 'test', runNumber: 1 });
  const test1Retry = resolveDesktopReleaseVersion({ baseVersion: '0.2.1', channel: 'test', runNumber: 1, runAttempt: 2 });
  const test2 = resolveDesktopReleaseVersion({ baseVersion: '0.2.1', channel: 'test', runNumber: 2 });
  const test10 = resolveDesktopReleaseVersion({ baseVersion: '0.2.1', channel: 'test', runNumber: 10 });
  const stableNext = resolveDesktopReleaseVersion({ baseVersion: '0.2.2', channel: 'stable', runNumber: 11 });

  assert.equal(test1.version, '0.2.2-test.1');
  assert.equal(test1.buildNumber, '1');
  assert.equal(test1.buildVersion, '0.2.2.1');
  assert.equal(test1Retry.version, '0.2.2-test.1.2');
  assert.equal(test1Retry.buildVersion, '0.2.2.1');
  assert.equal(test10.version, '0.2.2-test.10');
  assert.equal(stableNext.version, '0.2.2');
  assert.equal(stableNext.buildVersion, '0.2.2.11');

  assert.ok(compareSemver('0.2.1', test1.version) < 0);
  assert.ok(compareSemver(test1.version, test1Retry.version) < 0);
  assert.ok(compareSemver(test1Retry.version, test2.version) < 0);
  assert.ok(compareSemver(test2.version, test10.version) < 0);
  assert.ok(compareSemver(test10.version, stableNext.version) < 0);

  assert.throws(() => resolveDesktopReleaseVersion({ baseVersion: '0.2.1-test.1', channel: 'test', runNumber: 1 }));
  assert.throws(() => resolveDesktopReleaseVersion({ baseVersion: '0.2.1', channel: 'beta', runNumber: 1 }));
  assert.throws(() => resolveDesktopReleaseVersion({ baseVersion: '0.2.1', channel: 'test', runNumber: 70000 }));
});

test('DesktopUpdaterController enables allowPrerelease on test channel and disables it on stable', async () => {
  const testFake = createFakeAutoUpdater();
  const testController = new DesktopUpdaterController({
    currentVersion: '0.2.1',
    isPackaged: true,
    channel: 'test',
    loadAutoUpdater: async () => testFake.updater,
  });
  await testController.checkForUpdates();
  assert.equal(testFake.updater.allowPrerelease, true);
  assert.equal(testFake.updater.channel, 'test');

  const stableFake = createFakeAutoUpdater();
  const stableController = new DesktopUpdaterController({
    currentVersion: '0.2.1',
    isPackaged: true,
    channel: 'stable',
    loadAutoUpdater: async () => stableFake.updater,
  });
  await stableController.checkForUpdates();
  assert.equal(stableFake.updater.allowPrerelease, false);
  assert.equal(stableFake.updater.channel, 'stable');
});
