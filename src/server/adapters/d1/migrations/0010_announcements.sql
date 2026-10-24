-- Session announcements and their private images. Rows belong to one session and
-- are removed with it. Stored files use keys that start with the session ID.
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  details TEXT NOT NULL CHECK (length(trim(details)) BETWEEN 1 AND 10000),
  author TEXT NOT NULL REFERENCES accounts(id),
  author_name TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  edited_at TEXT,
  edited_by TEXT REFERENCES accounts(id),
  edited_name TEXT,
  removed_at TEXT,
  removed_by TEXT REFERENCES accounts(id),
  removed_name TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE (session_id, id),
  CHECK (expires_at IS NULL OR expires_at > published_at),
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CHECK ((edited_at IS NULL) = (edited_by IS NULL))
) STRICT;
CREATE INDEX announcements_by_session ON announcements(session_id, published_at DESC);

-- A request ID identifies one attempted announcement command and its retries.
CREATE TABLE announcement_receipts (
  actor TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  command TEXT NOT NULL CHECK (json_valid(command)),
  announcement_id TEXT NOT NULL,
  PRIMARY KEY (actor, request_id),
  FOREIGN KEY (session_id, announcement_id) REFERENCES announcements(session_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE announcement_images (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  announcement_id TEXT NOT NULL,
  uploader TEXT NOT NULL REFERENCES accounts(id),
  uploader_name TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_command TEXT NOT NULL CHECK (json_valid(request_command)),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  declared_bytes INTEGER NOT NULL CHECK (declared_bytes BETWEEN 1 AND 10485760),
  byte_size INTEGER CHECK (byte_size BETWEEN 1 AND 10485760),
  content_type TEXT CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  digest TEXT CHECK (digest IS NULL OR length(digest) = 64),
  object_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'ready', 'deleting', 'deleted', 'abandoned', 'expired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 900),
  uploaded_at TEXT,
  deleted_by TEXT REFERENCES accounts(id),
  deleted_at TEXT,
  files_removed_at TEXT,
  UNIQUE (uploader, request_id),
  FOREIGN KEY (session_id, announcement_id) REFERENCES announcements(session_id, id) ON DELETE CASCADE,
  CHECK (state <> 'ready' OR (uploaded_at IS NOT NULL AND byte_size IS NOT NULL
    AND content_type IS NOT NULL AND digest IS NOT NULL))
) STRICT;
CREATE INDEX announcement_images_by_parent ON announcement_images(announcement_id, state);
CREATE INDEX announcement_images_by_session ON announcement_images(session_id, state);
CREATE TABLE announcement_image_deletions (
  image_id TEXT PRIMARY KEY REFERENCES announcement_images(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
) STRICT;

-- The reservation fixes its identity and stored key. Files use conditional creation.
CREATE TRIGGER announcement_image_identity_immutable BEFORE UPDATE OF
  id, session_id, announcement_id, uploader, uploader_name, request_id, request_command,
  name, declared_bytes, object_key ON announcement_images
BEGIN
  SELECT RAISE(ABORT, 'Announcement image reservation identity is immutable');
END;
CREATE TRIGGER announcement_image_state_guard BEFORE UPDATE OF state ON announcement_images
WHEN NOT (OLD.state = NEW.state
  OR (OLD.state = 'pending' AND NEW.state IN ('ready', 'abandoned', 'expired'))
  OR (OLD.state = 'ready' AND NEW.state = 'deleting')
  OR (OLD.state = 'deleting' AND NEW.state = 'deleted'))
BEGIN
  SELECT RAISE(ABORT, 'Invalid announcement image transition');
END;
-- Publication attribution never changes, and removal is final.
CREATE TRIGGER announcement_identity_immutable BEFORE UPDATE OF
  id, session_id, author, author_name, published_at ON announcements
BEGIN
  SELECT RAISE(ABORT, 'Announcement publication is immutable');
END;
CREATE TRIGGER announcement_removed_final BEFORE UPDATE ON announcements
WHEN OLD.removed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A removed announcement is read-only');
END;
