-- A jury member can withdraw a contest-wide award that staff have not confirmed.
-- The row stays, with who withdrew it and when, so the history is complete. A
-- withdrawn award gives no time, because only a confirmed award does, and a
-- withdrawn award is never confirmed. A withdrawn award frees its size.
-- Previous Worker: it does not know the new columns. Until roll-forward its jury
-- screen lists a withdrawn award as waiting for confirmation, and a confirmation
-- there fails (`contest_award_fixed`). Its grant of a size that a withdrawal freed works.

ALTER TABLE contest_awards ADD COLUMN withdrawn_at TEXT;
ALTER TABLE contest_awards ADD COLUMN withdrawn_by TEXT REFERENCES accounts(id);
ALTER TABLE contest_awards ADD COLUMN withdrawn_name TEXT;
ALTER TABLE contest_awards ADD COLUMN withdrawn_request TEXT;

-- The guard in migrations.mjs accepts a dropped index only when the same file creates
-- the index again under the same name. So the name stays, and the predicate gains the
-- withdrawal. The previous Worker reads no index name: it matches the message of the
-- violated columns, which stay the same.
DROP INDEX contest_awards_unconfirmed;
CREATE UNIQUE INDEX contest_awards_unconfirmed ON contest_awards(session_id, minutes)
  WHERE applied_at IS NULL AND withdrawn_at IS NULL;

-- Once confirmed or withdrawn, an award never changes. So a confirmed award cannot be
-- withdrawn, and a withdrawn award cannot be confirmed. The withdrawal is written once.
DROP TRIGGER contest_award_fixed;
CREATE TRIGGER contest_award_fixed BEFORE UPDATE ON contest_awards
WHEN OLD.applied_at IS NOT NULL OR OLD.withdrawn_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id
  OR NEW.minutes IS NOT OLD.minutes OR NEW.explanation IS NOT OLD.explanation OR NEW.actor IS NOT OLD.actor
  OR NEW.actor_name IS NOT OLD.actor_name OR NEW.at IS NOT OLD.at OR NEW.request_id IS NOT OLD.request_id
BEGIN
  SELECT RAISE(ABORT, 'A contest award is final, and its confirmation or withdrawal is written once');
END;

-- A withdrawal has all its fields or none, and no award is both confirmed and withdrawn.
CREATE TRIGGER contest_award_outcome_changed BEFORE UPDATE ON contest_awards
WHEN (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_by IS NULL)
  OR (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_name IS NULL)
  OR (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_request IS NULL)
  OR (NEW.withdrawn_at IS NOT NULL AND NEW.applied_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'An award is confirmed or withdrawn, not both');
END;
CREATE TRIGGER contest_award_outcome_inserted BEFORE INSERT ON contest_awards
WHEN (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_by IS NULL)
  OR (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_name IS NULL)
  OR (NEW.withdrawn_at IS NULL) IS NOT (NEW.withdrawn_request IS NULL)
  OR (NEW.withdrawn_at IS NOT NULL AND NEW.applied_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'An award is confirmed or withdrawn, not both');
END;
