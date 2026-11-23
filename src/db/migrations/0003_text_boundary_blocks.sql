CREATE TABLE project_text_boundary_blocks (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_sha char(64) NOT NULL,
  block_index integer NOT NULL CHECK (block_index >= 0),
  continuations bytea NOT NULL CHECK (octet_length(continuations) <= 8192),
  PRIMARY KEY (project_id, snapshot_sha, block_index)
);
