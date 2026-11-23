// Regenerate the cloud directory from the same upstream release as the local Studio.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RegistryItem } from '@hyperframes/core/registry';
import { projectPath } from '../shared/project-validation.ts';

const checkout = process.argv[2];
assert(checkout, 'Pass the path of a HyperFrames release checkout');
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).dependencies.hyperframes;
const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
assert.equal(revision, git('rev-parse', `v${version}^{commit}`));
assert.equal(git('status', '--porcelain', '--', 'registry', 'LICENSE'), '');
const registry = path.join(checkout, 'registry');
const manifest = JSON.parse(await readFile(path.join(registry, 'registry.json'), 'utf8'));
const items = [];
for (const { name, type } of manifest.items) {
  if (type === 'hyperframes:example') continue;
  assert(type === 'hyperframes:block' || type === 'hyperframes:component');
  assert.match(name, /^[a-z0-9-]+$/);
  const directory = type === 'hyperframes:block' ? 'blocks' : 'components';
  const item: RegistryItem = JSON.parse(await readFile(path.join(registry, directory, name, 'registry-item.json'), 'utf8'));
  assert.equal(item.name, name);
  assert.equal(item.type, type);
  assert(!item.registryDependencies?.length, 'Install planning must support dependencies before importing this release');
  assert(item.files.some(file => file.target.endsWith('.html')));
  for (const file of item.files) {
    projectPath(file.path, true);
    projectPath(file.target, true);
    if (file.url) assert.equal(new URL(file.url).origin, 'https://static.heygen.ai');
  }
  items.push(item);
}
const destination = new URL('../library/components/registry/', import.meta.url);
await copyFile(path.join(checkout, 'LICENSE'), new URL('LICENSE', destination));
const rows = items.map(item => JSON.stringify(item)).join(',\n');
await writeFile(new URL('catalog.json', destination), `{"revision":"${revision}","items":[\n${rows}\n]}\n`);
