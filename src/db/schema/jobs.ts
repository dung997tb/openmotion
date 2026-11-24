import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { JobKind, JobState } from '../../contracts/jobs.ts';
import { workspaces } from './auth.ts';
import { projects } from './projects.ts';

export type ReceiptState = 'pending' | 'completed' | 'failed';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    kind: varchar('kind', { length: 32 }).$type<JobKind>().notNull(),
    state: varchar('state', { length: 24 }).$type<JobState>().notNull().default('queued'),
    stage: varchar('stage', { length: 64 }),
    progress: doublePrecision('progress').notNull().default(0),
    versionId: uuid('version_id'),
    revision: char('revision', { length: 64 }),
    workId: uuid('work_id'),
    requestId: varchar('request_id', { length: 128 }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    requestHash: char('request_hash', { length: 64 }),
    inputPayload: jsonb('input_payload').$type<Record<string, unknown>>().notNull().default({}),
    resultJson: jsonb('result_json').$type<Record<string, unknown> | null>(),
    remoteId: varchar('remote_id', { length: 200 }),
    remoteTerminal: boolean('remote_terminal').notNull().default(false),
    savePending: boolean('save_pending').notNull().default(false),
    failureStage: varchar('failure_stage', { length: 64 }),
    errorCode: varchar('error_code', { length: 128 }),
    errorMessage: text('error_message'),
    workerId: varchar('worker_id', { length: 128 }),
    claimToken: uuid('claim_token'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // DB-enforced single active export per project (prevents cross-pod EXPORT_BUSY race).
    uniqueIndex('uq_jobs_active_export_per_project')
      .on(t.projectId)
      .where(
        sql`${t.kind} = 'export_render' AND ${t.projectId} IS NOT NULL AND ${t.state} IN ('queued', 'running', 'cancelling')`,
      ),
    uniqueIndex('uq_jobs_workspace_idempotency')
      .on(t.workspaceId, t.kind, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('idx_jobs_workspace_project_kind').on(t.workspaceId, t.projectId, t.kind, t.createdAt.desc()),
    index('idx_jobs_workspace_active')
      .on(t.workspaceId, t.kind, t.state)
      .where(sql`${t.state} IN ('queued', 'running', 'cancelling')`),
    check(
      'chk_jobs_kind',
      sql`${t.kind} IN ('export_render', 'media_generate', 'media_ingest', 'media_thumbnail', 'archive_export', 'archive_import')`,
    ),
    check(
      'chk_jobs_state',
      sql`${t.state} IN ('queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled')`,
    ),
    check('chk_jobs_progress_range', sql`${t.progress} >= 0 AND ${t.progress} <= 100`),
  ],
);

export const idempotencyReceipts = pgTable(
  'idempotency_receipts',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 64 }).notNull(),
    requestId: varchar('request_id', { length: 128 }).notNull(),
    inputHash: char('input_hash', { length: 64 }).notNull(),
    state: varchar('state', { length: 16 }).$type<ReceiptState>().notNull().default('pending'),
    resourceId: uuid('resource_id'),
    responsePayload: jsonb('response_payload').$type<Record<string, unknown> | null>(),
    errorPayload: jsonb('error_payload').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`(now() + interval '30 days')`),
  },
  (t) => [
    primaryKey({ name: 'pk_idempotency_receipts', columns: [t.workspaceId, t.scope, t.requestId] }),
    index('idx_idempotency_receipts_expires').on(t.expiresAt),
    check('chk_idempotency_receipts_state', sql`${t.state} IN ('pending', 'completed', 'failed')`),
  ],
);
