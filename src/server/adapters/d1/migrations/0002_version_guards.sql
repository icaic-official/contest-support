-- Session moves also change an authorization dependency.
DROP TRIGGER session_changes;
CREATE TRIGGER session_changes AFTER UPDATE OF intake_open, event_id ON sessions
BEGIN
  UPDATE sessions SET version = version + 1 WHERE id = NEW.id;
END;

-- Every future issue writer must participate in optimistic concurrency.
CREATE TRIGGER issue_version_guard BEFORE UPDATE ON issues
WHEN NEW.write_version <> OLD.write_version + 1
  OR NEW.public_revision < OLD.public_revision
  OR NEW.public_revision > OLD.public_revision + 1
BEGIN
  SELECT RAISE(ABORT, 'Issue versions must advance with each write');
END;
