import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { BlobGcState, BlobMetadata } from '../../contracts/storage.ts';
import { users, workspaces } from './auth.ts';
import { projects } from './projects.ts';

export type CatalogTemplateKind = 'builtin' | 'prism';
export type AssetModality = 'image' | 'video' | 'audio';
export type AssetVersionSource = 'upload' | 'generated';
export type UploadTicketPurpose = 'library_asset' | 'project_asset' | 'project_archive';
export type UploadTicketState = 'issued' | 'uploaded' | 'processing' | 'committed' | 'failed' | 'expired';

export const workspaceBlobs = pgTable(
  'workspace_blobs',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sha256: char('sha256', { length: 64 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    s3Key: text('s3_key').notNull(),
    metadata: jsonb('metadata').$type<BlobMetadata | null>(),
    refCount: integer('ref_count').notNull(),
    zeroRefSince: timestamp('zero_ref_since', { withTimezone: true }),
    gcState: varchar('gc_state', { length: 16 }).$type<BlobGcState>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_workspace_blobs', columns: [t.workspaceId, t.sha256] }),
    index('idx_workspace_blobs_gc')
      .on(t.zeroRefSince)
      .where(sql`${t.refCount} = 0 AND ${t.zeroRefSince} IS NOT NULL AND ${t.gcState} = 'active'`),
    check('chk_workspace_blobs_size_nonneg', sql`${t.sizeBytes} >= 0`),
    check('chk_workspace_blobs_refcount_nonneg', sql`${t.refCount} >= 0`),
    check('chk_workspace_blobs_gc_state', sql`${t.gcState} IN ('active', 'deleting')`),
  ],
);

export const catalogTemplates = pgTable(
  'catalog_templates',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    kind: varchar('kind', { length: 16 }).$type<CatalogTemplateKind>().notNull(),
    catalogVersion: varchar('catalog_version', { length: 128 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    featuredOrder: integer('featured_order'),
    hasHtmlProject: boolean('has_html_project').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
    instructionsMd: text('instructions_md'),
    motionMd: text('motion_md'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_catalog_templates_sort').on(t.kind, t.sortOrder.asc()),
    check('chk_catalog_templates_kind', sql`${t.kind} IN ('builtin', 'prism')`),
  ],
);

export const catalogTemplateFiles = pgTable(
  'catalog_template_files',
  {
    templateId: varchar('template_id', { length: 128 })
      .notNull()
      .references(() => catalogTemplates.id, { onDelete: 'cascade' }),
    path: varchar('path', { length: 240 }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    metadata: jsonb('metadata').$type<BlobMetadata | null>(),
    isProjectFile: boolean('is_project_file').notNull(),
    isAvailable: boolean('is_available').notNull().default(true),
  },
  (t) => [
    primaryKey({ name: 'pk_catalog_template_files', columns: [t.templateId, t.path] }),
    index('idx_catalog_template_files_sha').on(t.sha256),
    check('chk_catalog_template_files_size_nonneg', sql`${t.sizeBytes} >= 0`),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    modality: varchar('modality', { length: 16 }).$type<AssetModality>().notNull(),
    currentVersionId: uuid('current_version_id'),
    trashed: boolean('trashed').notNull().default(false),
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_assets_workspace_list').on(t.workspaceId, t.trashed, t.modality, t.updatedAt.desc()),
    check('chk_assets_modality', sql`${t.modality} IN ('image', 'video', 'audio')`),
    check(
      'chk_assets_trashed_consistency',
      sql`(${t.trashed} = false AND ${t.trashedAt} IS NULL) OR (${t.trashed} = true AND ${t.trashedAt} IS NOT NULL)`,
    ),
  ],
);

export const assetVersions = pgTable(
  'asset_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 16 }).$type<AssetVersionSource>().notNull(),
    filename: varchar('filename', { length: 256 }).notNull(),
    displayName: varchar('display_name', { length: 200 }),
    sha256: char('sha256', { length: 64 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationSec: doublePrecision('duration_sec'),
    prompt: text('prompt'),
    model: varchar('model', { length: 160 }),
    parameters: jsonb('parameters').$type<Record<string, unknown> | null>(),
    references: jsonb('references').$type<Array<{ assetId: string; versionId: string }>>().notNull().default([]),
    parentVersionId: uuid('parent_version_id').references((): AnyPgColumn => assetVersions.id, {
      onDelete: 'set null',
    }),
    jobId: uuid('job_id'),
    requestId: varchar('request_id', { length: 128 }),
    requestHash: char('request_hash', { length: 64 }),
    providerResult: jsonb('provider_result').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'fk_asset_versions_blob',
      columns: [t.workspaceId, t.sha256],
      foreignColumns: [workspaceBlobs.workspaceId, workspaceBlobs.sha256],
    }).onDelete('restrict'),
    uniqueIndex('uq_asset_versions_request')
      .on(t.workspaceId, t.assetId, t.requestId)
      .where(sql`${t.requestId} IS NOT NULL`),
    index('idx_asset_versions_asset').on(t.assetId, t.createdAt.desc()),
    check('chk_asset_versions_source', sql`${t.source} IN ('upload', 'generated')`),
    check('chk_asset_versions_size_pos', sql`${t.sizeBytes} > 0`),
  ],
);

export const uploadTickets = pgTable(
  'upload_tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    purpose: varchar('purpose', { length: 32 }).$type<UploadTicketPurpose>().notNull(),
    targetProjectId: uuid('target_project_id').references(() => projects.id, { onDelete: 'set null' }),
    targetAssetId: uuid('target_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    targetPath: varchar('target_path', { length: 240 }),
    filename: varchar('filename', { length: 256 }).notNull(),
    expectedMimeType: varchar('expected_mime_type', { length: 128 }),
    expectedModality: varchar('expected_modality', { length: 16 }).$type<AssetModality | null>(),
    expectedSha256: char('expected_sha256', { length: 64 }),
    maxBytes: bigint('max_bytes', { mode: 'number' }).notNull(),
    s3StagingKey: text('s3_staging_key').notNull(),
    licenseS3StagingKey: text('license_s3_staging_key'),
    licenseFilename: varchar('license_filename', { length: 256 }),
    licenseMaxBytes: bigint('license_max_bytes', { mode: 'number' }),
    state: varchar('state', { length: 24 }).$type<UploadTicketState>().notNull().default('issued'),
    requestId: varchar('request_id', { length: 128 }),
    resultPayload: jsonb('result_payload').$type<Record<string, unknown> | null>(),
    error: text('error'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_upload_tickets_expiry').on(t.state, t.expiresAt),
    index('idx_upload_tickets_workspace').on(t.workspaceId, t.createdAt.desc()),
    check('chk_upload_tickets_purpose', sql`${t.purpose} IN ('library_asset', 'project_asset', 'project_archive')`),
    check(
      'chk_upload_tickets_state',
      sql`${t.state} IN ('issued', 'uploaded', 'processing', 'committed', 'failed', 'expired')`,
    ),
    check('chk_upload_tickets_max_bytes', sql`${t.maxBytes} > 0`),
    check(
      'chk_upload_tickets_license_max_bytes',
      sql`${t.licenseMaxBytes} IS NULL OR ${t.licenseMaxBytes} > 0`,
    ),
  ],
);
