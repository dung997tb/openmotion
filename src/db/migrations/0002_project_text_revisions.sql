ALTER TABLE project_files DROP CONSTRAINT chk_project_files_blob_scope, ADD CONSTRAINT chk_project_files_blob_scope CHECK (blob_scope IN ('workspace','catalog') OR (blob_scope = 'patch' AND is_text));
--> statement-breakpoint
ALTER TABLE project_version_files DROP CONSTRAINT chk_project_version_files_blob_scope, ADD CONSTRAINT chk_project_version_files_blob_scope CHECK (blob_scope IN ('workspace','catalog','patch'));
--> statement-breakpoint
CREATE TABLE project_text_revisions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id char(64) NOT NULL,
  parent_scope varchar(16) NOT NULL CHECK (parent_scope IN ('workspace','catalog','patch')),
  parent_id char(64) NOT NULL,
  patch jsonb NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 16777216),
  mime_type varchar(128) NOT NULL DEFAULT 'application/octet-stream',
  depth integer NOT NULL CHECK (depth BETWEEN 1 AND 32),
  chain_patch_bytes integer NOT NULL CHECK (chain_patch_bytes BETWEEN 1 AND 262144),
  checkpoint_sha char(64),
  PRIMARY KEY (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX idx_text_revisions_origin ON project_text_revisions(project_id);
--> statement-breakpoint
CREATE INDEX idx_text_revisions_workspace_base ON project_text_revisions(workspace_id,parent_id) WHERE parent_scope = 'workspace';
--> statement-breakpoint
CREATE INDEX idx_text_revisions_checkpoint ON project_text_revisions(workspace_id,checkpoint_sha) WHERE checkpoint_sha IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_project_version_files_path_version ON project_version_files(project_id,path,sha256);
