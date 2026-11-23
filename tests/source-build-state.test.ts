import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceBuildCurrent, recordSourceBuild, dependenciesCurrent, recordDependencies } from '../scripts/source-build-state.mjs';

async function fixture(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'om-source-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['studio/build', 'studio/src', 'node_modules']) await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, 'studio/build/index.html'), 'original editor');
  await writeFile(path.join(root, 'studio/src/app.ts'), 'original source');
  await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}');
  await writeFile(path.join(root, 'node_modules/.package-lock.json'), '{}');
  return root;
}

test('an existing index alone is not proof of a current source build', async t => {
  const root = await fixture(t);
  assert.equal(await sourceBuildCurrent(root), false);
  await recordSourceBuild(root);
  assert.equal(await sourceBuildCurrent(root), true);
  await writeFile(path.join(root, 'studio/src/app.ts'), 'updated source');
  assert.equal(await sourceBuildCurrent(root), false);
  await recordSourceBuild(root);
  assert.equal(await sourceBuildCurrent(root), true);
  await writeFile(path.join(root, 'studio/build/index.html'), 'altered editor');
  assert.equal(await sourceBuildCurrent(root), false);
});

test('changing only shared clip editing invalidates the Studio build', async t => {
  const root = await fixture(t);
  const core = path.join(root, 'packages/edit-core');
  await mkdir(core, { recursive: true });
  await writeFile(path.join(core, 'index.ts'), 'original rule');
  await recordSourceBuild(root);
  assert.equal(await sourceBuildCurrent(root), true);
  await writeFile(path.join(core, 'index.ts'), 'updated rule');
  assert.equal(await sourceBuildCurrent(root), false);
});

test('Studio rebuilds for component library source edits and reuses the build after packing the library', async t => {
  const root = await fixture(t);
  const library = path.join(root, 'packages/open-design-ui');
  const button = path.join(library, 'button.tsx');
  await mkdir(library, { recursive: true });
  await writeFile(button, 'original button');
  await recordSourceBuild(root);
  assert.equal(await sourceBuildCurrent(root), true);

  await writeFile(button, 'updated button');
  assert.equal(await sourceBuildCurrent(root), false);
  await recordSourceBuild(root);
  await mkdir(path.join(library, 'dist'));
  await writeFile(path.join(library, 'dist/button.js'), 'packed button');
  assert.equal(await sourceBuildCurrent(root), true);
});

test('source-only rebuilds reuse dependencies; changed locks or missing installs do not', async t => {
  const root = await fixture(t);
  assert.equal(await dependenciesCurrent(root), false);
  await recordDependencies(root);
  assert.equal(await dependenciesCurrent(root), true);
  await writeFile(path.join(root, 'studio/src/app.ts'), 'changed source');
  assert.equal(await dependenciesCurrent(root), true);
  await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  assert.equal(await dependenciesCurrent(root), false);
  await recordDependencies(root);
  assert.equal(await dependenciesCurrent(root), true);
  await rm(path.join(root, 'node_modules'), { recursive: true });
  assert.equal(await dependenciesCurrent(root), false);
});

test('DSH can reuse an existing npm tree only when required locked identities and directories match', async t => {
  const root = await fixture(t);
  const entry = { version: '1.0.0', integrity: 'sha512-fixture' };
  await mkdir(path.join(root, 'node_modules/fixture'), { recursive: true });
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { '': {}, 'node_modules/fixture': entry, 'node_modules/platform-only': { ...entry, optional: true } } }));
  await writeFile(path.join(root, 'node_modules/.package-lock.json'), JSON.stringify({ packages: { 'node_modules/fixture': entry } }));
  assert.equal(await dependenciesCurrent(root), false);
  assert.equal(await dependenciesCurrent(root, { inspectInstalledLock: true }), true);
  await writeFile(path.join(root, 'node_modules/.package-lock.json'), JSON.stringify({ packages: { 'node_modules/fixture': { ...entry, version: '0.9.0' } } }));
  assert.equal(await dependenciesCurrent(root, { inspectInstalledLock: true }), false);
  await writeFile(path.join(root, 'node_modules/.package-lock.json'), JSON.stringify({ packages: { 'node_modules/fixture': entry } }));
  await rm(path.join(root, 'node_modules/fixture'), { recursive: true });
  assert.equal(await dependenciesCurrent(root, { inspectInstalledLock: true }), false);
});
