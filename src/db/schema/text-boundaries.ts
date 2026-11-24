import { sql } from 'drizzle-orm';
import { char, check, customType, integer, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { projects } from './projects.ts';
import { workspaces } from './auth.ts';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const textBoundaryBlocks = pgTable('project_text_boundary_blocks', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  snapshotSha: char('snapshot_sha', { length: 64 }).notNull(),
  blockIndex: integer('block_index').notNull(),
  continuations: bytea('continuations').notNull(),
}, table => [
  primaryKey({ columns: [table.projectId, table.snapshotSha, table.blockIndex] }),
  check('project_text_boundary_blocks_block_index_check', sql`${table.blockIndex} >= 0`),
  check('project_text_boundary_blocks_continuations_check', sql`octet_length(${table.continuations}) <= 8192`),
]);
