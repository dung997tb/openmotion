import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PatScope, WorkspaceRole } from '../../contracts/auth.ts';

export type WorkspaceDefaultModels = {
  image?: string;
  video?: string;
  audio?: string;
};

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  oidcSub: text('oidc_sub').notNull().unique(),
  appUserId: text('app_user_id'),
  email: text('email'),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  planTier: text('plan_tier'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    externalWorkspaceId: varchar('external_workspace_id', { length: 128 }).unique(),
    name: varchar('name', { length: 120 }).notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    activeProjectId: uuid('active_project_id'),
    activeSessionId: uuid('active_session_id'),
    defaultModels: jsonb('default_models').$type<WorkspaceDefaultModels>().notNull().default({}),
    trackingEnabled: boolean('tracking_enabled').notNull().default(true),
    welcomeBootstrappedAt: timestamp('welcome_bootstrapped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_workspaces_owner').on(t.ownerUserId)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).$type<WorkspaceRole>().notNull().default('editor'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_workspace_members', columns: [t.workspaceId, t.userId] }),
    index('idx_workspace_members_user').on(t.userId),
    check('chk_workspace_members_role', sql`${t.role} IN ('owner', 'admin', 'editor', 'viewer')`),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    csrfTokenHash: char('csrf_token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_auth_sessions_user').on(t.userId),
    index('idx_auth_sessions_expires').on(t.expiresAt).where(sql`${t.revokedAt} IS NULL`),
  ],
);

export const personalAccessTokens = pgTable(
  'personal_access_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    tokenPrefix: varchar('token_prefix', { length: 20 }).notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    scopes: text('scopes')
      .array()
      .$type<PatScope[]>()
      .notNull()
      .default(
        sql`ARRAY['projects:read','projects:write','assets:read','assets:write','exports:write','media:generate','mcp:tools']::text[]`,
      ),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_pats_workspace_user').on(t.workspaceId, t.userId)],
);

export const oauthClients = pgTable(
  'oauth_clients',
  {
    clientId: varchar('client_id', { length: 128 }).primaryKey(),
    clientSecretHash: char('client_secret_hash', { length: 64 }),
    clientName: varchar('client_name', { length: 160 }).notNull(),
    redirectUris: text('redirect_uris').array().notNull(),
    grantTypes: text('grant_types')
      .array()
      .notNull()
      .default(sql`ARRAY['authorization_code','refresh_token']::text[]`),
    tokenEndpointAuthMethod: varchar('token_endpoint_auth_method', { length: 32 }).notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'chk_oauth_clients_auth_method',
      sql`${t.tokenEndpointAuthMethod} IN ('none', 'client_secret_post', 'client_secret_basic')`,
    ),
  ],
);

export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    codeHash: char('code_hash', { length: 64 }).primaryKey(),
    clientId: varchar('client_id', { length: 128 })
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    scope: text('scope').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: varchar('code_challenge_method', { length: 16 }).notNull().default('S256'),
    resource: text('resource'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_oauth_codes_expires').on(t.expiresAt),
    check('chk_oauth_codes_pkce_method', sql`${t.codeChallengeMethod} = 'S256'`),
  ],
);

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: varchar('client_id', { length: 128 })
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    accessTokenHash: char('access_token_hash', { length: 64 }).notNull().unique(),
    refreshTokenHash: char('refresh_token_hash', { length: 64 }).unique(),
    scope: text('scope').notNull(),
    resource: text('resource'),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_oauth_tokens_workspace_user').on(t.workspaceId, t.userId)],
);
