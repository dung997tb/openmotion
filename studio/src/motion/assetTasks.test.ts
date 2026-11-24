import { expect, it } from 'vitest';
import type { GenerationJob } from '../../../shared/gateway';
import { assetTasks, mergeAssetJobs } from './assetTasks';

const job = (id: string, updatedAt: number, overrides: Partial<GenerationJob> = {}): GenerationJob => ({
  id,
  state: 'completed',
  modality: 'image',
  prompt: id,
  model: { id: 'opendesign:image', provider: 'opendesign', modelId: 'image', label: 'OpenDesign Image', modality: 'image', source: 'live', mode: 'text-to-image' },
  parameters: {},
  requestHash: '',
  createdAt: updatedAt,
  updatedAt,
  assets: [],
  library: { assetId: id, createNew: true },
  ...overrides,
});

it('puts active generation work before newer finished tasks', () => {
  const tasks = assetTasks([
    job('finished', 100),
    job('queued', 50, { state: 'queued' }),
    job('running', 5, { state: 'running' }),
  ]);
  expect(tasks.map(task => task.key)).toEqual(['direct:queued', 'direct:running', 'direct:finished']);
});

it('retains newly submitted jobs and newer progress when a delayed poll arrives', () => {
  const submitted = job('new', 20, { state: 'queued' });
  const completed = job('old', 30);
  expect(mergeAssetJobs([submitted, completed], [job('old', 10, { state: 'running' })])).toEqual([completed, submitted]);
  expect(mergeAssetJobs([submitted], [job('new', 40)])).toEqual([job('new', 40)]);
});

it('includes recoverable project generation in workspace history while omitting non-library project jobs', () => {
  const task = job('project', 40, { library: undefined, projectId: 'project', saveToLibrary: true, savePending: true, state: 'failed' });
  expect(assetTasks([task, job('legacy', 30, { library: undefined })]).map(item => item.key)).toEqual(['direct:project']);
});
