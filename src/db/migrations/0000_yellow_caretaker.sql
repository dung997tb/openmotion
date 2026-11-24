CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"csrf_token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"code_hash" char(64) PRIMARY KEY NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" varchar(16) DEFAULT 'S256' NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_oauth_codes_pkce_method" CHECK ("oauth_authorization_codes"."code_challenge_method" = 'S256')
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"client_id" varchar(128) PRIMARY KEY NOT NULL,
	"client_secret_hash" char(64),
	"client_name" varchar(160) NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"grant_types" text[] DEFAULT ARRAY['authorization_code','refresh_token']::text[] NOT NULL,
	"token_endpoint_auth_method" varchar(32) DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_oauth_clients_auth_method" CHECK ("oauth_clients"."token_endpoint_auth_method" IN ('none', 'client_secret_post', 'client_secret_basic'))
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"access_token_hash" char(64) NOT NULL,
	"refresh_token_hash" char(64),
	"scope" text NOT NULL,
	"resource" text,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "oauth_tokens_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "personal_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"token_prefix" varchar(20) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"scopes" text[] DEFAULT ARRAY['projects:read','projects:write','assets:read','assets:write','exports:write','media:generate','mcp:tools']::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_sub" text NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"plan_tier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_oidc_sub_unique" UNIQUE("oidc_sub")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(16) DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_workspace_members" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "chk_workspace_members_role" CHECK ("workspace_members"."role" IN ('owner', 'admin', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"external_workspace_id" varchar(128),
	"name" varchar(120) NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"active_project_id" uuid,
	"active_session_id" uuid,
	"default_models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tracking_enabled" boolean DEFAULT true NOT NULL,
	"welcome_bootstrapped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspaces_external_workspace_id_unique" UNIQUE("external_workspace_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"artifact_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(100) NOT NULL,
	"title_key" varchar(64),
	"project_type" varchar(32) DEFAULT 'natural_language' NOT NULL,
	"template_id" varchar(128),
	"requirements" text,
	"naming_language" varchar(16),
	"source_meta" jsonb,
	"asset_name_allocations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" char(64) NOT NULL,
	"current_version_id" uuid,
	"current_version_number" integer DEFAULT 0 NOT NULL,
	"current_history_seq" integer DEFAULT 0 NOT NULL,
	"preview_display" jsonb,
	"reviews" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trashed" boolean DEFAULT false NOT NULL,
	"trashed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_projects_workspace_artifact" UNIQUE("workspace_id","artifact_id"),
	CONSTRAINT "chk_projects_type" CHECK ("projects"."project_type" IN ('natural_language', 'template', 'reference_video', 'legacy')),
	CONSTRAINT "chk_projects_trashed_consistency" CHECK (("projects"."trashed" = false AND "projects"."trashed_at" IS NULL) OR ("projects"."trashed" = true AND "projects"."trashed_at" IS NOT NULL)),
	CONSTRAINT "chk_projects_history_seq" CHECK ("projects"."current_history_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_session_messages_role" CHECK ("session_messages"."role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" varchar(100) NOT NULL,
	"mode" varchar(32) DEFAULT 'motion' NOT NULL,
	"template_id" varchar(128),
	"active_artifact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sessions_mode" CHECK ("sessions"."mode" IN ('motion'))
);
--> statement-breakpoint
CREATE TABLE "work_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(100) NOT NULL,
	"mode" varchar(16) NOT NULL,
	"state" varchar(16) NOT NULL,
	"version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"revision" char(64) NOT NULL,
	"job_id" uuid,
	"previous_job_id" uuid,
	"generation" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_work_rounds_mode" CHECK ("work_rounds"."mode" IN ('create', 'modify')),
	CONSTRAINT "chk_work_rounds_state" CHECK ("work_rounds"."state" IN ('authoring', 'saved', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"path" varchar(240) NOT NULL,
	"blob_scope" varchar(16) NOT NULL,
	"sha256" char(64) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"is_text" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_files" PRIMARY KEY("project_id","path"),
	CONSTRAINT "chk_project_files_blob_scope" CHECK ("project_files"."blob_scope" IN ('workspace', 'catalog')),
	CONSTRAINT "chk_project_files_size_nonneg" CHECK ("project_files"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_history_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"version_id" uuid NOT NULL,
	"parent_entry_id" uuid,
	"actor_kind" varchar(16) NOT NULL,
	"actor_name" varchar(128) NOT NULL,
	"label" varchar(256) NOT NULL,
	"window_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"undone" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_project_history_seq" UNIQUE("project_id","seq"),
	CONSTRAINT "chk_project_history_seq" CHECK ("project_history_entries"."seq" >= 1),
	CONSTRAINT "chk_project_history_actor" CHECK ("project_history_entries"."actor_kind" IN ('user', 'agent', 'system'))
);
--> statement-breakpoint
CREATE TABLE "project_version_files" (
	"version_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"path" varchar(240) NOT NULL,
	"blob_scope" varchar(16) NOT NULL,
	"sha256" char(64) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	CONSTRAINT "pk_project_version_files" PRIMARY KEY("version_id","path"),
	CONSTRAINT "chk_project_version_files_blob_scope" CHECK ("project_version_files"."blob_scope" IN ('workspace', 'catalog')),
	CONSTRAINT "chk_project_version_files_size_nonneg" CHECK ("project_version_files"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"revision" char(64) NOT NULL,
	"source" varchar(32) NOT NULL,
	"summary" varchar(256) NOT NULL,
	"request_id" varchar(128),
	"restored_from_version_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_project_versions_number" UNIQUE("project_id","version_number"),
	CONSTRAINT "chk_project_versions_number" CHECK ("project_versions"."version_number" >= 1),
	CONSTRAINT "chk_project_versions_source" CHECK ("project_versions"."source" IN ('baseline', 'agent', 'studio', 'restore'))
);
--> statement-breakpoint
CREATE TABLE "asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"source" varchar(16) NOT NULL,
	"filename" varchar(256) NOT NULL,
	"display_name" varchar(200),
	"sha256" char(64) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"width" integer,
	"height" integer,
	"duration_sec" double precision,
	"prompt" text,
	"model" varchar(160),
	"parameters" jsonb,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_version_id" uuid,
	"job_id" uuid,
	"request_id" varchar(128),
	"request_hash" char(64),
	"provider_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_asset_versions_source" CHECK ("asset_versions"."source" IN ('upload', 'generated')),
	CONSTRAINT "chk_asset_versions_size_pos" CHECK ("asset_versions"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"modality" varchar(16) NOT NULL,
	"current_version_id" uuid,
	"trashed" boolean DEFAULT false NOT NULL,
	"trashed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_assets_modality" CHECK ("assets"."modality" IN ('image', 'video', 'audio')),
	CONSTRAINT "chk_assets_trashed_consistency" CHECK (("assets"."trashed" = false AND "assets"."trashed_at" IS NULL) OR ("assets"."trashed" = true AND "assets"."trashed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "catalog_template_files" (
	"template_id" varchar(128) NOT NULL,
	"path" varchar(240) NOT NULL,
	"sha256" char(64) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"metadata" jsonb,
	"is_project_file" boolean NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	CONSTRAINT "pk_catalog_template_files" PRIMARY KEY("template_id","path"),
	CONSTRAINT "chk_catalog_template_files_size_nonneg" CHECK ("catalog_template_files"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_templates" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"kind" varchar(16) NOT NULL,
	"catalog_version" varchar(128) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"featured_order" integer,
	"has_html_project" boolean DEFAULT false NOT NULL,
	"metadata" jsonb NOT NULL,
	"instructions_md" text,
	"motion_md" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_catalog_templates_kind" CHECK ("catalog_templates"."kind" IN ('builtin', 'prism'))
);
--> statement-breakpoint
CREATE TABLE "upload_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"purpose" varchar(32) NOT NULL,
	"target_project_id" uuid,
	"target_asset_id" uuid,
	"target_path" varchar(240),
	"filename" varchar(256) NOT NULL,
	"expected_mime_type" varchar(128),
	"expected_modality" varchar(16),
	"expected_sha256" char(64),
	"max_bytes" bigint NOT NULL,
	"s3_staging_key" text NOT NULL,
	"license_s3_staging_key" text,
	"license_filename" varchar(256),
	"license_max_bytes" bigint,
	"state" varchar(24) DEFAULT 'issued' NOT NULL,
	"request_id" varchar(128),
	"result_payload" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_upload_tickets_purpose" CHECK ("upload_tickets"."purpose" IN ('library_asset', 'project_asset', 'project_archive')),
	CONSTRAINT "chk_upload_tickets_state" CHECK ("upload_tickets"."state" IN ('issued', 'uploaded', 'processing', 'committed', 'failed', 'expired')),
	CONSTRAINT "chk_upload_tickets_max_bytes" CHECK ("upload_tickets"."max_bytes" > 0),
	CONSTRAINT "chk_upload_tickets_license_max_bytes" CHECK ("upload_tickets"."license_max_bytes" IS NULL OR "upload_tickets"."license_max_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_blobs" (
	"workspace_id" uuid NOT NULL,
	"sha256" char(64) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"s3_key" text NOT NULL,
	"metadata" jsonb,
	"ref_count" integer NOT NULL,
	"zero_ref_since" timestamp with time zone,
	"gc_state" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_workspace_blobs" PRIMARY KEY("workspace_id","sha256"),
	CONSTRAINT "chk_workspace_blobs_size_nonneg" CHECK ("workspace_blobs"."size_bytes" >= 0),
	CONSTRAINT "chk_workspace_blobs_refcount_nonneg" CHECK ("workspace_blobs"."ref_count" >= 0),
	CONSTRAINT "chk_workspace_blobs_gc_state" CHECK ("workspace_blobs"."gc_state" IN ('active', 'deleting'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_receipts" (
	"workspace_id" uuid NOT NULL,
	"scope" varchar(64) NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"input_hash" char(64) NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"resource_id" uuid,
	"response_payload" jsonb,
	"error_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + interval '30 days') NOT NULL,
	CONSTRAINT "pk_idempotency_receipts" PRIMARY KEY("workspace_id","scope","request_id"),
	CONSTRAINT "chk_idempotency_receipts_state" CHECK ("idempotency_receipts"."state" IN ('pending', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" varchar(32) NOT NULL,
	"state" varchar(24) DEFAULT 'queued' NOT NULL,
	"stage" varchar(64),
	"progress" double precision DEFAULT 0 NOT NULL,
	"version_id" uuid,
	"revision" char(64),
	"work_id" uuid,
	"request_id" varchar(128),
	"idempotency_key" varchar(128),
	"request_hash" char(64),
	"input_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_json" jsonb,
	"remote_id" varchar(200),
	"remote_terminal" boolean DEFAULT false NOT NULL,
	"save_pending" boolean DEFAULT false NOT NULL,
	"failure_stage" varchar(64),
	"error_code" varchar(128),
	"error_message" text,
	"worker_id" varchar(128),
	"claim_token" uuid,
	"deadline_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_jobs_kind" CHECK ("jobs"."kind" IN ('export_render', 'media_generate', 'media_ingest', 'media_thumbnail', 'archive_export', 'archive_import')),
	CONSTRAINT "chk_jobs_state" CHECK ("jobs"."state" IN ('queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "chk_jobs_progress_range" CHECK ("jobs"."progress" >= 0 AND "jobs"."progress" <= 100)
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_rounds" ADD CONSTRAINT "work_rounds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_rounds" ADD CONSTRAINT "work_rounds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_history_entries" ADD CONSTRAINT "project_history_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_history_entries" ADD CONSTRAINT "project_history_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_history_entries" ADD CONSTRAINT "project_history_entries_version_id_project_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."project_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_history_entries" ADD CONSTRAINT "project_history_entries_parent_entry_id_project_history_entries_id_fk" FOREIGN KEY ("parent_entry_id") REFERENCES "public"."project_history_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_version_files" ADD CONSTRAINT "project_version_files_version_id_project_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."project_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_restored_from_version_id_project_versions_id_fk" FOREIGN KEY ("restored_from_version_id") REFERENCES "public"."project_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_parent_version_id_asset_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "fk_asset_versions_blob" FOREIGN KEY ("workspace_id","sha256") REFERENCES "public"."workspace_blobs"("workspace_id","sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_template_files" ADD CONSTRAINT "catalog_template_files_template_id_catalog_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."catalog_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_tickets" ADD CONSTRAINT "upload_tickets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_tickets" ADD CONSTRAINT "upload_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_tickets" ADD CONSTRAINT "upload_tickets_target_project_id_projects_id_fk" FOREIGN KEY ("target_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_tickets" ADD CONSTRAINT "upload_tickets_target_asset_id_assets_id_fk" FOREIGN KEY ("target_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_blobs" ADD CONSTRAINT "workspace_blobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_receipts" ADD CONSTRAINT "idempotency_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_user" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_expires" ON "auth_sessions" USING btree ("expires_at") WHERE "auth_sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_oauth_codes_expires" ON "oauth_authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_oauth_tokens_workspace_user" ON "oauth_tokens" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_pats_workspace_user" ON "personal_access_tokens" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_members_user" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_workspaces_owner" ON "workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_projects_workspace_keyset" ON "projects" USING btree ("workspace_id","trashed","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_projects_workspace_session" ON "projects" USING btree ("workspace_id","session_id");--> statement-breakpoint
CREATE INDEX "idx_session_messages_session" ON "session_messages" USING btree ("workspace_id","session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_workspace_opened" ON "sessions" USING btree ("workspace_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_work_rounds_project_created" ON "work_rounds" USING btree ("workspace_id","project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_project_files_workspace_project" ON "project_files" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "idx_project_files_workspace_sha" ON "project_files" USING btree ("workspace_id","sha256") WHERE "project_files"."blob_scope" = 'workspace';--> statement-breakpoint
CREATE INDEX "idx_project_history_active" ON "project_history_entries" USING btree ("project_id","undone","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_project_history_window" ON "project_history_entries" USING btree ("project_id","window_id") WHERE "project_history_entries"."window_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_project_version_files_workspace_sha" ON "project_version_files" USING btree ("workspace_id","sha256") WHERE "project_version_files"."blob_scope" = 'workspace';--> statement-breakpoint
CREATE INDEX "idx_project_version_files_project" ON "project_version_files" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_versions_request" ON "project_versions" USING btree ("workspace_id","project_id","request_id") WHERE "project_versions"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_project_versions_list" ON "project_versions" USING btree ("project_id","version_number" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_asset_versions_request" ON "asset_versions" USING btree ("workspace_id","asset_id","request_id") WHERE "asset_versions"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_asset_versions_asset" ON "asset_versions" USING btree ("asset_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_assets_workspace_list" ON "assets" USING btree ("workspace_id","trashed","modality","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_catalog_template_files_sha" ON "catalog_template_files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "idx_catalog_templates_sort" ON "catalog_templates" USING btree ("kind","sort_order");--> statement-breakpoint
CREATE INDEX "idx_upload_tickets_expiry" ON "upload_tickets" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "idx_upload_tickets_workspace" ON "upload_tickets" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_workspace_blobs_gc" ON "workspace_blobs" USING btree ("zero_ref_since") WHERE "workspace_blobs"."ref_count" = 0 AND "workspace_blobs"."zero_ref_since" IS NOT NULL AND "workspace_blobs"."gc_state" = 'active';--> statement-breakpoint
CREATE INDEX "idx_idempotency_receipts_expires" ON "idempotency_receipts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_jobs_active_export_per_project" ON "jobs" USING btree ("project_id") WHERE "jobs"."kind" = 'export_render' AND "jobs"."project_id" IS NOT NULL AND "jobs"."state" IN ('queued', 'running', 'cancelling');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_jobs_workspace_idempotency" ON "jobs" USING btree ("workspace_id","kind","idempotency_key") WHERE "jobs"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_jobs_workspace_project_kind" ON "jobs" USING btree ("workspace_id","project_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_jobs_workspace_active" ON "jobs" USING btree ("workspace_id","kind","state") WHERE "jobs"."state" IN ('queued', 'running', 'cancelling');