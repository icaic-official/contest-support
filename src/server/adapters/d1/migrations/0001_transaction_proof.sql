-- Experimental command foundation. This is not the complete connector schema.
PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  must_change INTEGER NOT NULL DEFAULT 1 CHECK (must_change IN (0, 1)),
  access_version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE logins (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  expires_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  intake_open INTEGER NOT NULL DEFAULT 0 CHECK (intake_open IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, id)
) STRICT;
CREATE TABLE memberships (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  team_id TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, account_id),
  FOREIGN KEY (session_id, team_id) REFERENCES teams(session_id, id)
) STRICT;
CREATE TABLE membership_roles (
  session_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('volunteer', 'specialist', 'jury')),
  PRIMARY KEY (session_id, account_id, role),
  FOREIGN KEY (session_id, account_id) REFERENCES memberships(session_id, account_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'escalated', 'resolved')),
  owner TEXT REFERENCES accounts(id),
  first_assigned_at TEXT,
  public_revision INTEGER NOT NULL DEFAULT 1,
  write_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (session_id, id),
  FOREIGN KEY (session_id, team_id) REFERENCES teams(session_id, id),
  CHECK ((status = 'open' AND owner IS NULL) OR (status <> 'open' AND owner IS NOT NULL))
) STRICT;
CREATE TABLE command_receipts (
  actor TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  command TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  PRIMARY KEY (actor, request_id),
  FOREIGN KEY (session_id, issue_id) REFERENCES issues(session_id, id) ON DELETE CASCADE
) STRICT;
CREATE TABLE history (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  actor TEXT NOT NULL REFERENCES accounts(id),
  at TEXT NOT NULL,
  text TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'internal'))
) STRICT;
CREATE TABLE audience_sequences (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  audience TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  PRIMARY KEY (session_id, audience)
) STRICT;
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  audience TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0 CHECK (delivered IN (0, 1)),
  UNIQUE (session_id, audience, sequence),
  FOREIGN KEY (session_id, audience) REFERENCES audience_sequences(session_id, audience)
) STRICT;
-- NOT NULL matters: SQLite CHECK alone accepts NULL.
CREATE TABLE command_assertions (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

CREATE TRIGGER account_restrictions AFTER UPDATE OF disabled, must_change ON accounts
BEGIN
  UPDATE accounts SET access_version = access_version + 1 WHERE id = NEW.id;
END;
CREATE TRIGGER login_changes AFTER UPDATE OF revoked, expires_at ON logins
BEGIN
  UPDATE logins SET version = version + 1 WHERE id = NEW.id;
END;
CREATE TRIGGER event_changes AFTER UPDATE OF archived ON events
BEGIN
  UPDATE events SET version = version + 1 WHERE id = NEW.id;
END;
CREATE TRIGGER session_changes AFTER UPDATE OF intake_open ON sessions
BEGIN
  UPDATE sessions SET version = version + 1 WHERE id = NEW.id;
END;
CREATE TRIGGER membership_added AFTER INSERT ON memberships
BEGIN
  UPDATE accounts SET access_version = access_version + 1 WHERE id = NEW.account_id;
END;
CREATE TRIGGER membership_removed AFTER DELETE ON memberships
BEGIN
  UPDATE accounts SET access_version = access_version + 1 WHERE id = OLD.account_id;
END;
CREATE TRIGGER membership_changed AFTER UPDATE OF team_id, is_admin ON memberships
BEGIN
  UPDATE memberships SET version = version + 1 WHERE session_id = NEW.session_id AND account_id = NEW.account_id;
  UPDATE accounts SET access_version = access_version + 1 WHERE id = NEW.account_id;
END;
CREATE TRIGGER role_added AFTER INSERT ON membership_roles
BEGIN
  UPDATE memberships SET version = version + 1 WHERE session_id = NEW.session_id AND account_id = NEW.account_id;
  UPDATE accounts SET access_version = access_version + 1 WHERE id = NEW.account_id;
END;
CREATE TRIGGER role_removed AFTER DELETE ON membership_roles
BEGIN
  UPDATE memberships SET version = version + 1 WHERE session_id = OLD.session_id AND account_id = OLD.account_id;
  UPDATE accounts SET access_version = access_version + 1 WHERE id = OLD.account_id;
END;
CREATE TRIGGER role_changed AFTER UPDATE ON membership_roles
BEGIN
  UPDATE memberships SET version = version + 1 WHERE (session_id = OLD.session_id AND account_id = OLD.account_id) OR (session_id = NEW.session_id AND account_id = NEW.account_id);
  UPDATE accounts SET access_version = access_version + 1 WHERE id IN (OLD.account_id, NEW.account_id);
END;
