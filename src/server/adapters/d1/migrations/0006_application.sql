-- Complete Cloudflare application reads, administration, and private image metadata.
ALTER TABLE events ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN max_image_bytes INTEGER NOT NULL DEFAULT 10485760
  CHECK (max_image_bytes BETWEEN 1048576 AND 52428800);
ALTER TABLE sessions ADD COLUMN max_images_per_issue INTEGER NOT NULL DEFAULT 12
  CHECK (max_images_per_issue BETWEEN 1 AND 24);
ALTER TABLE sessions ADD COLUMN max_image_bytes_per_issue INTEGER NOT NULL DEFAULT 125829120
  CHECK (max_image_bytes_per_issue BETWEEN 1048576 AND 125829120
    AND max_image_bytes_per_issue >= max_image_bytes);
ALTER TABLE teams ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE teams ADD COLUMN location TEXT NOT NULL DEFAULT '';

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  actor TEXT NOT NULL REFERENCES accounts(id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action TEXT NOT NULL,
  target TEXT REFERENCES accounts(id),
  detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail))
) STRICT;
CREATE INDEX admin_audit_session_at ON admin_audit(session_id, at DESC);

CREATE TABLE issue_images (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  uploader TEXT NOT NULL REFERENCES accounts(id),
  request_id TEXT NOT NULL,
  uploader_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  uploaded_at TEXT,
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 3600),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'internal')),
  declared_bytes INTEGER NOT NULL CHECK (declared_bytes > 0),
  byte_size INTEGER CHECK (byte_size > 0),
  content_type TEXT,
  original_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'ready', 'deleting', 'deleted', 'abandoned', 'expired')),
  original_path TEXT NOT NULL UNIQUE,
  thumbnail_path TEXT NOT NULL UNIQUE,
  original_digest TEXT,
  thumbnail_digest TEXT,
  deleted_by TEXT REFERENCES accounts(id),
  deleted_at TEXT,
  files_removed_at TEXT,
  UNIQUE (uploader, request_id),
  FOREIGN KEY (session_id, issue_id) REFERENCES issues(session_id, id) ON DELETE CASCADE,
  CHECK (state <> 'ready' OR (uploaded_at IS NOT NULL AND byte_size IS NOT NULL
    AND content_type IS NOT NULL))
) STRICT;
CREATE INDEX issue_images_issue_state ON issue_images(issue_id, state);
CREATE INDEX issue_images_session_state ON issue_images(session_id, state);
CREATE TABLE image_deletions (
  attachment_id TEXT PRIMARY KEY REFERENCES issue_images(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
) STRICT;

-- Limits and display configuration participate in optimistic access guards.
CREATE TRIGGER session_configuration_changes
AFTER UPDATE OF name, max_image_bytes, max_images_per_issue, max_image_bytes_per_issue ON sessions
BEGIN
  UPDATE sessions SET version = version + 1 WHERE id = NEW.id;
END;
CREATE TRIGGER event_name_changes AFTER UPDATE OF name ON events
BEGIN
  UPDATE events SET version = version + 1 WHERE id = NEW.id;
END;
