#!/usr/bin/env node
/**
 * OpenMotion Web Connect Script CLI Entrypoint (K9 Step 1).
 *
 * Usage:
 *   node --experimental-strip-types scripts/connect-local-agent.mjs --connect [codex|claude|all]
 *   node --experimental-strip-types scripts/connect-local-agent.mjs --serve [--port 43118]
 *
 * Wave 2 Integration Hook:
 *   Automatically loads `packages/local-atoms/index.ts` (and optional
 *   `packages/signed-config/index.ts`) when present in the workspace, and falls
 *   back cleanly to `createStubConnectBridge` when running standalone before
 *   Wave 2 wiring.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  createStubConnectBridge,
  runConnectCli,
} from '../packages/connect-script/index.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');

async function tryImportOptional(relativePath) {
  const fullUrl = pathToFileURL(resolve(REPO_ROOT, relativePath)).href;
  try {
    return await import(fullUrl);
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ENOENT')
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * Adapter hook resolving the concrete `UniversalHostBridge` for Wave 2.
 * Falls back cleanly to `createStubConnectBridge` when `packages/local-atoms`
 * has not yet been merged/wired.
 */
export async function resolveConnectBridge(options) {
  const localAtomsMod = await tryImportOptional('packages/local-atoms/index.ts');
  const signedConfigMod = await tryImportOptional('packages/signed-config/index.ts');

  if (localAtomsMod) {
    const factory =
      localAtomsMod.createConnectScriptBridge ??
      localAtomsMod.createLocalAtomsBridge ??
      localAtomsMod.createHostBridge;
    if (typeof factory === 'function') {
      const signedConfig =
        signedConfigMod && typeof signedConfigMod.loadSignedConfig === 'function'
          ? await signedConfigMod.loadSignedConfig({ channel: options.channel })
          : undefined;
      return await factory({
        hostKind: 'connect-script',
        channel: options.channel,
        allowLocalDevLoopback: options.allowLocalDevLoopback,
        confirm: options.confirm,
        signedConfig,
      });
    }
  }

  return createStubConnectBridge({
    channel: options.channel,
  });
}

async function main() {
  const exitCode = await runConnectCli(process.argv.slice(2), {
    createBridge: resolveConnectBridge,
  });
  process.exitCode = exitCode;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
