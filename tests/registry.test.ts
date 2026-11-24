import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repairGeneratedRegistry } from '../hyperframes.ts';

test('new projects use the native catalog default; the old generated URL migrates without changing project settings', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'openmotion-registry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'hyperframes.json');
  const config = { format: 'mp4', fps: 30 };
  const legacy = { ...config, registry: 'https://hyperframes.heygen.com/registry', custom: { name: 'keep this' } };
  await writeFile(filename, JSON.stringify(legacy));
  assert.equal(await repairGeneratedRegistry(dir), true);
  const migrated = JSON.parse(await readFile(filename, 'utf8'));
  assert.deepEqual(migrated, { ...config, custom: legacy.custom });
  assert.equal(await repairGeneratedRegistry(dir), false);
});

test('registry migration preserves custom registry URLs and invalid configs for native diagnostics', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'openmotion-registry-custom-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'hyperframes.json');
  for (const original of ['{ "registry": "https://registry.example.com/team", "name": "keep" }\n', '{ invalid json']) {
    await writeFile(filename, original);
    assert.equal(await repairGeneratedRegistry(dir), false);
    assert.equal(await readFile(filename, 'utf8'), original);
  }
});
