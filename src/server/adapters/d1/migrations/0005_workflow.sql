-- Complete workflow persistence. The original proof records remain valid.
ALTER TABLE sessions ADD COLUMN categories TEXT NOT NULL DEFAULT '["Problem statement","Devices","Backend","Other"]'
  CHECK (json_valid(categories) AND json_type(categories) = 'array');
ALTER TABLE issues ADD COLUMN number INTEGER CHECK (number IS NULL OR number > 0);
CREATE UNIQUE INDEX issues_number ON issues(session_id, number);
ALTER TABLE issues ADD COLUMN reporter TEXT REFERENCES accounts(id);
ALTER TABLE issues ADD COLUMN reporter_name TEXT NOT NULL DEFAULT '';
ALTER TABLE issues ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE issues ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE issues ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE issues ADD COLUMN owner_name TEXT;
ALTER TABLE issues ADD COLUMN resolved_at TEXT;
ALTER TABLE history ADD COLUMN actor_name TEXT NOT NULL DEFAULT '';

CREATE TABLE session_issue_sequences (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0)
) STRICT;
CREATE TABLE resolutions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL,
  actor TEXT NOT NULL REFERENCES accounts(id),
  actor_name TEXT NOT NULL,
  at TEXT NOT NULL,
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 2000),
  reopened_at TEXT,
  reopened_by TEXT REFERENCES accounts(id),
  reopened_name TEXT,
  reason TEXT,
  UNIQUE (issue_id, id),
  FOREIGN KEY (session_id, issue_id) REFERENCES issues(session_id, id) ON DELETE CASCADE,
  CHECK ((reopened_at IS NULL AND reopened_by IS NULL AND reopened_name IS NULL AND reason IS NULL)
    OR (reopened_at IS NOT NULL AND reopened_by IS NOT NULL AND reopened_name IS NOT NULL
      AND reason IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 2000))
) STRICT;
CREATE UNIQUE INDEX resolutions_current ON resolutions(issue_id) WHERE reopened_at IS NULL;
CREATE TABLE awards (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL UNIQUE,
  resolution_id TEXT NOT NULL UNIQUE,
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 2147483647),
  explanation TEXT NOT NULL CHECK (length(trim(explanation)) BETWEEN 1 AND 2000),
  actor TEXT NOT NULL REFERENCES accounts(id),
  actor_name TEXT NOT NULL,
  at TEXT NOT NULL,
  applied_at TEXT,
  applied_by TEXT REFERENCES accounts(id),
  applied_name TEXT,
  FOREIGN KEY (session_id, issue_id) REFERENCES issues(session_id, id) ON DELETE CASCADE,
  FOREIGN KEY (issue_id, resolution_id) REFERENCES resolutions(issue_id, id) ON DELETE CASCADE,
  CHECK ((applied_at IS NULL AND applied_by IS NULL AND applied_name IS NULL)
    OR (applied_at IS NOT NULL AND applied_by IS NOT NULL AND applied_name IS NOT NULL))
) STRICT;

-- One database timestamp supplies all records from one atomic batch. The batch
-- deletes this row before committing. Failed batches roll it back with all effects.
CREATE TABLE workflow_commit_times (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
DROP TRIGGER session_changes;
CREATE TRIGGER session_changes AFTER UPDATE OF intake_open, event_id, categories ON sessions
BEGIN
  UPDATE sessions SET version = version + 1 WHERE id = NEW.id;
END;
