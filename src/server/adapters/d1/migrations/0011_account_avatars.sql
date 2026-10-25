-- Profile pictures belong to accounts, not sessions. The stored file of each row
-- uses key accounts/<account_id>/avatars/<id> in the private image bucket.
-- The ready row is the account's current avatar. Retired and expired rows are
-- file deletion tasks. Account deletion fails while rows exist, so a cleanup
-- must delete the stored files before it can delete the account.
CREATE TABLE account_avatars (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  request_id TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 262144),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'retired', 'expired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 900),
  ready_at TEXT,
  retired_at TEXT,
  files_removed_at TEXT,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  UNIQUE (account_id, request_id),
  CHECK (state <> 'ready' OR ready_at IS NOT NULL),
  CHECK (state <> 'retired' OR retired_at IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX account_avatars_current ON account_avatars(account_id) WHERE state = 'ready';
CREATE INDEX account_avatars_cleanup ON account_avatars(state, cleanup_attempts);

-- The request fixes the owner and the verified bytes. A retry cannot change them.
CREATE TRIGGER account_avatar_identity_immutable BEFORE UPDATE OF
  id, account_id, request_id, byte_size, content_type, digest, created_at ON account_avatars
BEGIN
  SELECT RAISE(ABORT, 'Avatar identity is immutable');
END;
CREATE TRIGGER account_avatar_state_guard BEFORE UPDATE OF state ON account_avatars
WHEN NOT (OLD.state = NEW.state
  OR (OLD.state = 'pending' AND NEW.state IN ('ready', 'expired'))
  OR (OLD.state = 'ready' AND NEW.state = 'retired'))
BEGIN
  SELECT RAISE(ABORT, 'Invalid avatar transition');
END;
