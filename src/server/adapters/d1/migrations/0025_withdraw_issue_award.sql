-- Jury can withdraw an issue award that staff have not confirmed. The row stays, with who
-- withdrew it and when, so the history is complete. A withdrawn award gives no time,
-- because only a confirmed award does, and a withdrawn award is never confirmed.
-- `issue_id` and `resolution_id` stay UNIQUE. SQLite cannot drop a column constraint
-- without a table rebuild, and the migration guard refuses one. So an issue with a
-- withdrawn award cannot take a second award.
-- Previous Worker: it does not know the new columns. Until roll-forward its staff screens
-- show a withdrawn award as waiting for external application, and a confirmation there
-- fails on `award_withdrawn_fixed`. Its award command refuses the issue, because a row exists.

ALTER TABLE awards ADD COLUMN withdrawn_at TEXT;
ALTER TABLE awards ADD COLUMN withdrawn_by TEXT REFERENCES accounts(id);
ALTER TABLE awards ADD COLUMN withdrawn_name TEXT;

-- A delete of an account checks this foreign key through this index.
CREATE INDEX awards_withdrawn_by ON awards(withdrawn_by) WHERE withdrawn_by IS NOT NULL;

-- A withdrawn award never changes again.
CREATE TRIGGER award_withdrawn_fixed BEFORE UPDATE ON awards
WHEN OLD.withdrawn_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'A withdrawn award is final');
END;

-- A withdrawal has all its fields or none, and no award is both confirmed and withdrawn.
CREATE TRIGGER award_outcome_changed BEFORE UPDATE ON awards
WHEN (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_by IS NULL)
  OR (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_name IS NULL)
  OR (NEW.withdrawn_at IS NOT NULL AND NEW.applied_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'An award is confirmed or withdrawn, not both');
END;
CREATE TRIGGER award_outcome_inserted BEFORE INSERT ON awards
WHEN (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_by IS NULL)
  OR (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_name IS NULL)
  OR (NEW.withdrawn_at IS NOT NULL AND NEW.applied_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'An award is confirmed or withdrawn, not both');
END;
