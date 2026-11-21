import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { oauthClients, users, workspaces } from './auth.ts';

export type ProjectType = 'natural_language' | 'template' | 'reference_video' | 'legacy';
export type SessionMessageRole = 'user' | 'assistant';
export type WorkRoundMode = 'create' | 'modify';
export type WorkRoundState = 'authoring' | 'saved' | 'failed';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 100 }).notNull(),
    mode: varchar('mode', { length: 32 }).notNull().default('motion'),
    templateId: varchar('template_id', { length: 128 }),
    activeArtifactId: uuid('active_artifact_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sessions_workspace_opened').on(t.workspaceId, t.openedAt.desc()),
    check('chk_sessions_mode', sql`${t.mode} IN ('motion')`),
  ],
);

export const sessionMessages = pgTable(
  'session_messages',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).$type<SessionMessageRole>().notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_session_messages_session').on(t.workspaceId, t.sessionId, t.createdAt.asc()),
    check('chk_session_messages_role', sql`${t.role} IN ('user', 'assistant')`),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    artifactId: uuid('artifact_id').defaultRandom().notNull(),
    title: varchar('title', { length: 100 }).notNull(),
    titleKey: varchar('title_key', { length: 64 }),
    projectType: varchar('project_type', { length: 32 })
      .$type<ProjectType>()
      .notNull()
      .default('natural_language'),
    templateId: varchar('template_id', { length: 128 }),
    requirements: text('requirements'),
    namingLanguage: varchar('naming_language', { length: 16 }),
    sourceMeta: jsonb('source_meta').$type<Record<string, unknown> | null>(),
    assetNameAllocations: jsonb('asset_name_allocations').$type<Record<string, unknown>>().notNull().default({}),
    revision: char('revision', { length: 64 }).notNull(),
    currentVersionId: uuid('current_version_id'),
    currentVersionNumber: integer('current_version_number').notNull().default(0),
    currentHistorySeq: integer('current_history_seq').notNull().default(0),
    previewDisplay: jsonb('preview_display').$type<Record<string, unknown> | null>(),
    reviews: jsonb('reviews').$type<unknown[]>().notNull().default([]),
    trashed: boolean('trashed').notNull().default(false),
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_projects_workspace_artifact').on(t.workspaceId, t.artifactId),
    index('idx_projects_workspace_keyset').on(t.workspaceId, t.trashed, t.createdAt.desc(), t.id.desc()),
    index('idx_projects_workspace_session').on(t.workspaceId, t.sessionId),
    check(
      'chk_projects_type',
      sql`${t.projectType} IN ('natural_language', 'template', 'reference_video', 'legacy')`,
    ),
    check(
      'chk_projects_trashed_consistency',
      sql`(${t.trashed} = false AND ${t.trashedAt} IS NULL) OR (${t.trashed} = true AND ${t.trashedAt} IS NOT NULL)`,
    ),
    check('chk_projects_history_seq', sql`${t.currentHistorySeq} >= 0`),
  ],
);

export const workRounds = pgTable(
  'work_rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 100 }).notNull(),
    mode: varchar('mode', { length: 16 }).$type<WorkRoundMode>().notNull(),
    state: varchar('state', { length: 16 }).$type<WorkRoundState>().notNull(),
    versionId: uuid('version_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    revision: char('revision', { length: 64 }).notNull(),
    jobId: uuid('job_id'),
    previousJobId: uuid('previous_job_id'),
    generation: jsonb('generation').$type<Record<string, unknown> | null>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_work_rounds_project_created').on(t.workspaceId, t.projectId, t.createdAt.desc()),
    check('chk_work_rounds_mode', sql`${t.mode} IN ('create', 'modify')`),
    check('chk_work_rounds_state', sql`${t.state} IN ('authoring', 'saved', 'failed')`),
  ],
);

export const projectGrants = pgTable(
  'project_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: varchar('client_id', { length: 128 })
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    unique('uq_project_grants_project_user_client').on(t.projectId, t.userId, t.clientId),
    index('idx_project_grants_lookup').on(t.projectId, t.userId, t.clientId),
    index('idx_project_grants_workspace_client').on(t.workspaceId, t.clientId),
  ],
);
