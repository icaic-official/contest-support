-- The 2026-10-25 live password rule: a live contest's intake stays closed until every
-- contestant seat in it holds a completed password issued for it.
-- Previous Worker: its resets insert account_operations rows, which clear the scopes below,
-- so a live contest closes until the new Worker reissues. That is the safe direction.
-- Every existing contest is practice, so no statement closes one. If statements commit apart,
-- a seat that the previous Worker adds and then removes between the two counts can fail on the
-- count's CHECK. That command reports a conflict and can be retried. The last statement repairs
-- every count.

-- An organizer chooses the kind when creating a contest. It never changes. A live contest
-- always has a schedule, so "the live contests whose window overlaps" is always defined.
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'practice'
  CHECK (kind IN ('practice', 'live') AND (kind = 'practice' OR starts_at IS NOT NULL));
CREATE TRIGGER session_kind_fixed BEFORE UPDATE OF kind ON sessions WHEN NEW.kind IS NOT OLD.kind
BEGIN
  SELECT RAISE(ABORT, 'A contest kind is fixed at creation');
END;

-- The live contests that the account's current password was issued for. Written by the issuing
-- batch. A self change of password keeps it, because the password still follows that issue.
-- Nothing is backfilled: only a live contest reads a scope, and no live contest exists yet.
CREATE TABLE credential_scopes (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  -- The target contest's window at the issue. A later move compares with this fixed window, so
  -- small repeated shifts cannot walk a contest away from an old password.
  issued_from TEXT NOT NULL,
  issued_until TEXT NOT NULL,
  PRIMARY KEY (account_id, session_id)
) STRICT;
CREATE INDEX credential_scopes_session ON credential_scopes(session_id);

-- Contestant seats of the contest without a password issued for it. D1 keeps it exact, so the
-- intake check reads one column instead of counting up to 800 seats on every snapshot.
-- It is not in session_changes: the submit batch re-checks intake through the workflow
-- dependency value, so a credential issue does not fail in-flight staff commands.
ALTER TABLE sessions ADD COLUMN unready_seats INTEGER NOT NULL DEFAULT 0 CHECK (unready_seats >= 0);

-- First count: the decrementing triggers below must find a count that covers the existing seats.
UPDATE sessions SET unready_seats = (SELECT count(*) FROM memberships m
  WHERE m.session_id = sessions.id AND m.team_id IS NOT NULL);

-- An admin issue (create or reset, by either Worker or trusted recovery) ends every scope of
-- the old password. The issuing batch then inserts the new scopes after this row.
CREATE TRIGGER credential_issue_ends_scopes AFTER INSERT ON account_operations
WHEN NEW.action IN ('create_account', 'reset_password')
BEGIN
  DELETE FROM credential_scopes WHERE account_id = NEW.account_id;
END;
-- A move that still overlaps the issued window keeps the password. Any other move ends the scope,
-- and scope_uncounted recounts. Refreshing the window on each move would permit a walk.
CREATE TRIGGER contest_move_ends_scopes AFTER UPDATE OF starts_at, ends_at, grace_minutes ON sessions
WHEN NEW.kind = 'live'
BEGIN
  DELETE FROM credential_scopes WHERE session_id = NEW.id AND NOT (issued_from
    < strftime('%Y-%m-%dT%H:%M:%fZ', NEW.ends_at, '+' || NEW.grace_minutes || ' minutes') AND NEW.starts_at < issued_until);
END;
-- The triggers below key each count on the seat's account. No Worker reassigns a seat.
CREATE TRIGGER seat_account_fixed BEFORE UPDATE OF account_id ON memberships
WHEN NEW.account_id IS NOT OLD.account_id
BEGIN
  SELECT RAISE(ABORT, 'A seat stays with its account');
END;
-- Every change to a contestant seat or a scope passes here.
CREATE TRIGGER seat_counted AFTER INSERT ON memberships
WHEN NEW.team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM credential_scopes
  WHERE account_id = NEW.account_id AND session_id = NEW.session_id)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats + 1 WHERE id = NEW.session_id;
END;
CREATE TRIGGER seat_uncounted AFTER DELETE ON memberships
WHEN OLD.team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM credential_scopes
  WHERE account_id = OLD.account_id AND session_id = OLD.session_id)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats - 1 WHERE id = OLD.session_id;
END;
CREATE TRIGGER seat_recounted AFTER UPDATE OF team_id ON memberships
WHEN (OLD.team_id IS NULL) <> (NEW.team_id IS NULL) AND NOT EXISTS (SELECT 1 FROM credential_scopes
  WHERE account_id = NEW.account_id AND session_id = NEW.session_id)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats + CASE WHEN NEW.team_id IS NULL THEN -1 ELSE 1 END
  WHERE id = NEW.session_id;
END;
CREATE TRIGGER scope_counted AFTER INSERT ON credential_scopes
WHEN EXISTS (SELECT 1 FROM memberships WHERE session_id = NEW.session_id
  AND account_id = NEW.account_id AND team_id IS NOT NULL)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats - 1 WHERE id = NEW.session_id;
END;
CREATE TRIGGER scope_uncounted AFTER DELETE ON credential_scopes
WHEN EXISTS (SELECT 1 FROM memberships WHERE session_id = OLD.session_id
  AND account_id = OLD.account_id AND team_id IS NOT NULL)
BEGIN
  UPDATE sessions SET unready_seats = unready_seats + 1 WHERE id = OLD.session_id;
END;

-- Last count: a seat that the previous Worker wrote between the first count and its trigger
-- becomes exact here. This statement ends the file's only drift window.
UPDATE sessions SET unready_seats = (SELECT count(*) FROM memberships m
  WHERE m.session_id = sessions.id AND m.team_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM credential_scopes c WHERE c.account_id = m.account_id AND c.session_id = m.session_id));
