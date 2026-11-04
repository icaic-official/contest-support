-- Scheduled start and end, grace, automatic intake with a manual override, and
-- contest-wide time awards.
-- Previous Worker: it reads intake_open only. A contest that follows its schedule
-- acts as a manual contest with its last intake_open value (closed by default)
-- until roll-forward. Staff can still use the old switch there.

-- Instants use the format of every other timestamp. They are nullable, because
-- existing and fixture contests have no schedule. The Worker requires one on create.
ALTER TABLE sessions ADD COLUMN starts_at TEXT;
ALTER TABLE sessions ADD COLUMN ends_at TEXT;
ALTER TABLE sessions ADD COLUMN grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 240);
-- 1: intake follows the schedule. 0: intake_open is the state, which is today's
-- switch and also the manual override. Existing contests keep 0, so nothing changes.
ALTER TABLE sessions ADD COLUMN intake_follows_schedule INTEGER NOT NULL DEFAULT 0
  CHECK (intake_follows_schedule IN (0, 1));

CREATE TRIGGER session_schedule_inserted BEFORE INSERT ON sessions
WHEN NOT COALESCE((NEW.starts_at IS NULL AND NEW.ends_at IS NULL AND NEW.intake_follows_schedule = 0)
  OR (NEW.starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.starts_at)
    AND NEW.ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.ends_at) AND NEW.ends_at > NEW.starts_at), 0)
BEGIN
  SELECT RAISE(ABORT, 'A schedule needs a start before its end');
END;
CREATE TRIGGER session_schedule_changed BEFORE UPDATE OF starts_at, ends_at, intake_follows_schedule ON sessions
WHEN NOT COALESCE((NEW.starts_at IS NULL AND NEW.ends_at IS NULL AND NEW.intake_follows_schedule = 0)
  OR (NEW.starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.starts_at)
    AND NEW.ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.ends_at) AND NEW.ends_at > NEW.starts_at), 0)
BEGIN
  SELECT RAISE(ABORT, 'A schedule needs a start before its end');
END;
-- A comparison with NULL is NULL, and NOT NULL is NULL, so a trigger condition that
-- reads a missing or malformed instant would pass. COALESCE turns that into a refusal.
-- The calendar reads one event's contests in start order, or every contest that ends after a time.
CREATE INDEX sessions_event_schedule ON sessions(event_id, starts_at);
CREATE INDEX sessions_ends ON sessions(ends_at) WHERE ends_at IS NOT NULL;

-- A contest-wide time award. The decision and the confirmation of its external
-- application stay separate records with separate actors, like issue awards.
-- (actor, request_id) makes a repeated grant insert nothing. applied_request
-- makes a repeated confirmation succeed without a second write.
CREATE TABLE contest_awards (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
  explanation TEXT NOT NULL CHECK (length(trim(explanation)) BETWEEN 1 AND 2000),
  actor TEXT NOT NULL REFERENCES accounts(id),
  actor_name TEXT NOT NULL,
  at TEXT NOT NULL,
  applied_at TEXT,
  applied_by TEXT REFERENCES accounts(id),
  applied_name TEXT,
  applied_request TEXT,
  UNIQUE (actor, request_id),
  CHECK ((applied_at IS NULL AND applied_by IS NULL AND applied_name IS NULL AND applied_request IS NULL)
    OR (applied_at IS NOT NULL AND applied_by IS NOT NULL AND applied_name IS NOT NULL AND applied_request IS NOT NULL))
) STRICT;
CREATE INDEX contest_awards_session ON contest_awards(session_id, at);
CREATE TRIGGER contest_award_fixed BEFORE UPDATE ON contest_awards
WHEN OLD.applied_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id
  OR NEW.minutes IS NOT OLD.minutes OR NEW.explanation IS NOT OLD.explanation OR NEW.actor IS NOT OLD.actor
  OR NEW.actor_name IS NOT OLD.actor_name OR NEW.at IS NOT OLD.at OR NEW.request_id IS NOT OLD.request_id
BEGIN
  SELECT RAISE(ABORT, 'A contest award is final, and its confirmation is written once');
END;

DROP TRIGGER session_changes;
CREATE TRIGGER session_changes AFTER UPDATE OF intake_open, event_id, categories, contest_type,
  starts_at, ends_at, grace_minutes, intake_follows_schedule ON sessions
BEGIN
  UPDATE sessions SET version = version + 1 WHERE id = NEW.id;
END;
