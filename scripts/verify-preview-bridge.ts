import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PREVIEW_BRIDGE_ASSET, PREVIEW_BRIDGE_VERSION } from '../src/studio/engine/preview-bridge.ts';

// Run from the deployed revision against the public preview origin, through its CDN.
const origin = process.argv[2];
if (!origin) throw new Error('Usage: node scripts/verify-preview-bridge.ts <preview-origin>');
const url = new URL(PREVIEW_BRIDGE_ASSET, origin);
const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
assert.equal(response.status, 200, `Expected a bridge for this release at ${url.href}`);
assert.match(response.headers.get('content-type') ?? '', /javascript/);
const actual = createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex');
assert.equal(actual, PREVIEW_BRIDGE_VERSION, 'Public bridge bytes differ from the release');
console.log(`Verified ${url.href} (SHA-256 ${actual})`);
