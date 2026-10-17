-- Experimental authentication. Supabase remains the active application backend.
ALTER TABLE accounts ADD COLUMN username TEXT
  CHECK (username IS NULL OR (length(username) BETWEEN 3 AND 32
    AND username NOT GLOB '*[^a-z0-9_-]*' AND substr(username, 1, 1) GLOB '[a-z0-9]'));
CREATE UNIQUE INDEX accounts_username ON accounts(username);
ALTER TABLE accounts ADD COLUMN credential_generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE accounts ADD COLUMN credential_state TEXT NOT NULL DEFAULT 'ready'
  CHECK (credential_state IN ('ready', 'pending'));
ALTER TABLE accounts ADD COLUMN credential_operation TEXT;
ALTER TABLE logins ADD COLUMN identity_session_id TEXT;
ALTER TABLE logins ADD COLUMN credential_generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE logins ADD COLUMN csrf TEXT;
CREATE UNIQUE INDEX logins_identity_session ON logins(identity_session_id);
CREATE TABLE account_operations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor TEXT NOT NULL REFERENCES accounts(id),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create_account', 'reset_password', 'change_password', 'set_username')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'superseded')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
) STRICT;
CREATE TABLE authentication_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
) STRICT;
-- Existing application-store checks use logins and must_change. A pending
-- credential operation must remain restricted even after a mistaken gate write.
CREATE TRIGGER account_pending_guard BEFORE UPDATE OF must_change ON accounts
WHEN NEW.credential_state = 'pending' AND NEW.must_change = 0
BEGIN
  SELECT RAISE(ABORT, 'Pending credentials require a password change');
END;
CREATE TRIGGER account_credential_version AFTER UPDATE OF credential_generation, credential_state ON accounts
BEGIN
  UPDATE accounts SET access_version = access_version + 1 WHERE id = NEW.id;
END;
