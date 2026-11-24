import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskLedger } from '../tracking/task-ledger.ts';

test('task ledger persists accepted and terminal export state across instances', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-task-ledger-'));
  try {
    const taskId = crypto.randomUUID(), accepted = new Date().toISOString(), deadline = new Date(Date.now() + 1_000).toISOString();
    const first = new TaskLedger(directory);
    await first.accept({ task_id: taskId, task_type: 'export', project_id: 'project', accepted_at: accepted, deadline_at: deadline });
    await first.accept({ task_id: taskId, task_type: 'export', project_id: 'project', accepted_at: accepted, deadline_at: deadline });
    await assert.rejects(first.accept({ task_id: taskId, task_type: 'export', project_id: 'project', accepted_at: accepted, deadline_at: new Date(Date.now() + 2_000).toISOString() }), /TASK_LEDGER_CONFLICT/);
    await first.terminal(taskId, 'success', 'true');
    const second = new TaskLedger(directory), snapshot = await second.snapshot();
    assert.equal(snapshot[taskId].outcome, 'success');
    assert.equal(snapshot[taskId].applied, 'true');
    assert.ok(snapshot[taskId].terminal_at);
    const evidence = await readFile(path.join(directory, 'tracking', 'tasks.json'), 'utf8');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await first.terminal(taskId, 'success', 'true')).terminal_at, snapshot[taskId].terminal_at);
    assert.equal(await readFile(path.join(directory, 'tracking', 'tasks.json'), 'utf8'), evidence, 'a repeated identical terminal result keeps the recorded evidence');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('task ledger rejects malformed or conflicting terminal transitions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-task-ledger-'));
  try {
    const taskId = crypto.randomUUID(), ledger = new TaskLedger(directory), now = new Date().toISOString();
    await assert.rejects(ledger.accept({ task_id: 'bad', task_type: 'export', accepted_at: now, deadline_at: now }), /TASK_LEDGER_INVALID/);
    await ledger.accept({ task_id: taskId, task_type: 'export', accepted_at: now, deadline_at: now });
    await ledger.terminal(taskId, 'failure', 'unknown', 'EXPORT_FAILED');
    const terminal = await ledger.snapshot();
    await new Promise(resolve => setTimeout(resolve, 2));
    const repeated = await ledger.terminal(taskId, 'failure', 'unknown', 'EXPORT_FAILED');
    assert.equal(repeated.terminal_at, terminal[taskId].terminal_at);
    await assert.rejects(ledger.terminal(taskId, 'success', 'true'), /TASK_LEDGER_CONFLICT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupted task ledger JSON raises TASK_LEDGER_UNREADABLE cleanly on read', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-task-ledger-corrupt-'));
  try {
    await mkdir(path.join(directory, 'tracking'), { recursive: true });
    await writeFile(path.join(directory, 'tracking', 'tasks.json'), 'corrupted');
    const ledger = new TaskLedger(directory);
    await assert.rejects(ledger.snapshot(), /TASK_LEDGER_UNREADABLE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
