import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDesktopSentryReporter,
  parseSentryEnvelopeEndpoints,
} from '../src/sentry.ts';

const TEST_DSN = 'https://publickey123@sentry.open-design.ai/42';

test('parseSentryEnvelopeEndpoints derives envelope and minidump URLs and rejects invalid DSNs', () => {
  const parsed = parseSentryEnvelopeEndpoints(TEST_DSN);
  assert.ok(parsed);
  assert.equal(parsed.envelopeUrl, 'https://sentry.open-design.ai/api/42/envelope/');
  assert.equal(
    parsed.minidumpUrl,
    'https://sentry.open-design.ai/api/42/minidump/?sentry_key=publickey123',
  );
  assert.equal(parsed.publicKey, 'publickey123');
  assert.equal(parsed.projectId, '42');

  const prefixed = parseSentryEnvelopeEndpoints('https://key9@example.com/sub/99');
  assert.equal(prefixed?.envelopeUrl, 'https://example.com/sub/api/99/envelope/');
  assert.equal(
    prefixed?.minidumpUrl,
    'https://example.com/sub/api/99/minidump/?sentry_key=key9',
  );

  assert.equal(parseSentryEnvelopeEndpoints(''), null);
  assert.equal(parseSentryEnvelopeEndpoints('http://public@evil.example.com/42'), null);
  assert.equal(parseSentryEnvelopeEndpoints('https://public@example.com/not-a-number'), null);
});

test('createDesktopSentryReporter is default-off without DSN or under DO_NOT_TRACK', async () => {
  let fetchCalls = 0;
  let crashStarts = 0;
  const fakeCrashReporter = {
    start() {
      crashStarts += 1;
    },
  };

  const noDsn = createDesktopSentryReporter({
    dsn: undefined,
    release: 'openmotion-desktop@0.2.1',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    shellVersion: '0.2.1',
    env: {},
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(noDsn.isEnabled(), false);
  assert.equal(noDsn.startCrashReporter(fakeCrashReporter), false);
  assert.equal(await noDsn.captureException(new Error('boom')), false);
  assert.equal(fetchCalls, 0);
  assert.equal(crashStarts, 0);

  const optedOut = createDesktopSentryReporter({
    dsn: TEST_DSN,
    release: 'openmotion-desktop@0.2.1',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    shellVersion: '0.2.1',
    env: { DO_NOT_TRACK: '1' },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(optedOut.isEnabled(), false);
  assert.equal(optedOut.startCrashReporter(fakeCrashReporter), false);
  assert.equal(await optedOut.captureMessage('test'), false);
  assert.equal(fetchCalls, 0);
  assert.equal(crashStarts, 0);
});

test('createDesktopSentryReporter sends scrubbed Sentry Envelopes, wires crashReporter, and enforces rate limit', async () => {
  const sentRequests = [];
  let crashConfig = null;
  let nowMs = 1_700_000_000_000;

  const reporter = createDesktopSentryReporter({
    dsn: TEST_DSN,
    release: 'openmotion-desktop@0.2.1',
    channel: 'stable',
    platform: 'darwin',
    arch: 'arm64',
    shellVersion: '0.2.1',
    redactPaths: ['/Users/ada/Library/Application Support/OpenDesign', '/Users/ada'],
    env: {},
    maxEventsPerMinute: 2,
    now: () => nowMs,
    fetchImpl: async (url, init) => {
      sentRequests.push({ url: String(url), headers: init?.headers, body: String(init?.body ?? '') });
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(reporter.isEnabled(), true);
  const started = reporter.startCrashReporter({
    start(opts) {
      crashConfig = opts;
    },
  });
  assert.equal(started, true);
  assert.equal(
    crashConfig.submitURL,
    'https://sentry.open-design.ai/api/42/minidump/?sentry_key=publickey123',
  );
  assert.equal(crashConfig.extra.shell_version, '0.2.1');
  assert.equal(crashConfig.extra.host_kind, 'desktop');

  const leakyError = new Error(
    'Failed loading /Users/ada/Library/Application Support/OpenDesign/secrets.json with Bearer sk_live_secret_999',
  );
  const ok1 = await reporter.captureException(leakyError, {
    area: 'updater',
    extra: {
      accessToken: 'super_secret_token',
      note: 'path=/Users/ada/private.txt',
    },
  });
  assert.equal(ok1, true);
  assert.equal(sentRequests.length, 1);
  assert.equal(sentRequests[0].url, 'https://sentry.open-design.ai/api/42/envelope/');

  const lines = sentRequests[0].body.trim().split('\n');
  assert.equal(lines.length, 3);
  const envHeader = JSON.parse(lines[0]);
  const itemHeader = JSON.parse(lines[1]);
  const payload = JSON.parse(lines[2]);

  assert.equal(envHeader.dsn, TEST_DSN);
  assert.equal(itemHeader.type, 'event');
  assert.equal(payload.release, 'openmotion-desktop@0.2.1');
  assert.equal(payload.environment, 'production');
  assert.equal(payload.tags.host_kind, 'desktop');
  assert.equal(payload.tags.area, 'updater');
  assert.equal(sentRequests[0].body.includes('sk_live_secret_999'), false);
  assert.equal(sentRequests[0].body.includes('super_secret_token'), false);
  assert.equal(sentRequests[0].body.includes('/Users/ada'), false);

  // Second event within 1 minute succeeds; third is rate-limited
  assert.equal(await reporter.captureMessage('Renderer gone', 'fatal'), true);
  assert.equal(await reporter.captureMessage('Flood event', 'error'), false);
  assert.equal(sentRequests.length, 2);

  // After 61 seconds window resets; runtime opt-out stops sending
  nowMs += 61_000;
  reporter.setEnabled(false);
  assert.equal(await reporter.captureMessage('After opt-out', 'error'), false);
  assert.equal(sentRequests.length, 2);
});
