-- Event-owned entrants: teams and single contestants. A teams row becomes the
-- entry of one entrant in one contest. Each contest has a type.
-- The previous Worker keeps working. Its add_teams creates an entrant through
-- entry_default_entrant. Its update_team renames the entrant in every contest.
-- Its contestant membership links the account to the entrant. D1 refuses only
-- a staff seat for an entrant's sign-in, and a move of that sign-in to another team.

CREATE TABLE entrants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('team', 'single')),
  -- May be empty, because fixtures insert unnamed teams. The Worker refuses
  -- empty and duplicate names inside an event with a read and an in-batch guard.
  -- A unique index would make the backfill below fail on old data.
  name TEXT NOT NULL CHECK (length(name) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX entrants_event ON entrants(event_id, name);

-- The entry's entrant. Always set after this file (backfill plus entry_default_entrant).
-- Both entrant keys are deferred, like accounts.event_id in 0017. Test cleanups
-- delete an event, then its teams and accounts, in one batch.
ALTER TABLE teams ADD COLUMN entrant_id TEXT REFERENCES entrants(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX teams_by_entrant ON teams(entrant_id);
-- The entrant whose sign-in this account is. NULL for staff and webmasters.
-- The Worker creates exactly one account per entrant. Old data may hold several.
ALTER TABLE accounts ADD COLUMN entrant_id TEXT REFERENCES entrants(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX accounts_entrant ON accounts(entrant_id) WHERE entrant_id IS NOT NULL;

-- singles: only single contestants. teams: only teams. mixed: both. Existing contests are teams.
ALTER TABLE sessions ADD COLUMN contest_type TEXT NOT NULL DEFAULT 'teams'
  CHECK (contest_type IN ('singles', 'mixed', 'teams'));

-- Backfill. One entrant per event and normalized team name, so a team that
-- appears in two contests of one event becomes one entrant. A team keeps its
-- own entrant when its name is empty, or when an older team of the same
-- contest has the same name, so that one contest never holds an entrant twice.
-- The representative teams row lends its ID to the entrant.
INSERT INTO entrants (id, event_id, kind, name)
SELECT t.id, s.event_id, 'team', t.name FROM teams t JOIN sessions s ON s.id = t.session_id
WHERE trim(t.name) = ''
  OR EXISTS (SELECT 1 FROM teams t2 WHERE t2.session_id = t.session_id
    AND lower(trim(t2.name)) = lower(trim(t.name)) AND t2.rowid < t.rowid)
  OR NOT EXISTS (SELECT 1 FROM teams t2 JOIN sessions s2 ON s2.id = t2.session_id
    WHERE s2.event_id = s.event_id AND lower(trim(t2.name)) = lower(trim(t.name)) AND t2.rowid < t.rowid);
-- A team that is not a representative joins the oldest team of its event with
-- its name. That team is a representative in another contest.
UPDATE teams SET entrant_id = CASE WHEN EXISTS (SELECT 1 FROM entrants WHERE id = teams.id) THEN teams.id ELSE (
  SELECT t2.id FROM teams t2 JOIN sessions s2 ON s2.id = t2.session_id
  WHERE s2.event_id = (SELECT event_id FROM sessions WHERE id = teams.session_id)
    AND lower(trim(t2.name)) = lower(trim(teams.name))
  ORDER BY t2.rowid LIMIT 1) END;
UPDATE teams SET name = (SELECT name FROM entrants WHERE id = teams.entrant_id)
WHERE name IS NOT (SELECT name FROM entrants WHERE id = teams.entrant_id);
-- Each contestant account links to the entrant of its oldest team.
UPDATE accounts SET entrant_id = (
  SELECT t.entrant_id FROM memberships m JOIN teams t ON t.id = m.team_id
  WHERE m.account_id = accounts.id ORDER BY t.rowid LIMIT 1)
WHERE EXISTS (SELECT 1 FROM memberships WHERE account_id = accounts.id AND team_id IS NOT NULL);
CREATE UNIQUE INDEX teams_entrant ON teams(session_id, entrant_id);

-- Removing an entry deletes the seats of its entrant (0019 entry_seats_removed),
-- and the memberships foreign key (session_id, team_id) -> teams(session_id, id)
-- finds the child rows of a deleted team. The primary key starts with
-- (session_id, account_id), so each of the two reads scanned every member of
-- the contest: 2,443 rows for a contest of 1,200 members. This index starts at
-- the entry, so both read only its seats.
CREATE INDEX memberships_team ON memberships(session_id, team_id);


-- The invariants below are created after the backfill, so legacy anomalies are kept, not refused.

-- (1) An entry's entrant belongs to the contest's event and fits the contest type.
CREATE TRIGGER entry_fits_contest BEFORE INSERT ON teams
WHEN NEW.entrant_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM entrants e JOIN sessions s ON s.id = NEW.session_id
  WHERE e.id = NEW.entrant_id AND e.event_id = s.event_id
    AND (s.contest_type = 'mixed' OR (s.contest_type = 'teams') = (e.kind = 'team')))
BEGIN
  SELECT RAISE(ABORT, 'This entrant cannot enter this contest');
END;
CREATE TRIGGER entry_entrant_fixed BEFORE UPDATE OF entrant_id ON teams
WHEN OLD.entrant_id IS NOT NULL AND NEW.entrant_id IS NOT OLD.entrant_id
BEGIN
  SELECT RAISE(ABORT, 'An entry keeps its entrant');
END;
CREATE TRIGGER contest_type_fits_entries BEFORE UPDATE OF contest_type ON sessions
WHEN EXISTS (SELECT 1 FROM teams t JOIN entrants e ON e.id = t.entrant_id
  WHERE t.session_id = NEW.id AND NOT (NEW.contest_type = 'mixed' OR (NEW.contest_type = 'teams') = (e.kind = 'team')))
BEGIN
  SELECT RAISE(ABORT, 'Remove the entrants that this contest type excludes first');
END;

-- (2) Repair for the previous Worker's add_teams, which sets no entrant.
CREATE TRIGGER entry_default_entrant AFTER INSERT ON teams WHEN NEW.entrant_id IS NULL
BEGIN
  INSERT INTO entrants (id, event_id, kind, name)
    SELECT NEW.id, event_id, 'team', NEW.name FROM sessions WHERE id = NEW.session_id;
  UPDATE teams SET entrant_id = NEW.id WHERE id = NEW.id;
END;

-- (3) Seats are a projection of entries. An entrant's sign-in holds a
-- contestant membership in exactly the contests that hold its entry. The
-- Worker never writes contestant memberships.
CREATE TRIGGER entry_seats_added AFTER INSERT ON teams WHEN NEW.entrant_id IS NOT NULL
BEGIN
  INSERT INTO memberships (session_id, account_id, team_id)
    SELECT NEW.session_id, a.id, NEW.id FROM accounts a WHERE a.entrant_id = NEW.entrant_id
    ON CONFLICT (session_id, account_id) DO NOTHING;
END;
CREATE TRIGGER entry_seats_removed BEFORE DELETE ON teams
BEGIN
  DELETE FROM memberships WHERE session_id = OLD.session_id AND team_id = OLD.id;
END;
CREATE TRIGGER account_entrant_seats AFTER UPDATE OF entrant_id ON accounts
WHEN OLD.entrant_id IS NULL AND NEW.entrant_id IS NOT NULL
BEGIN
  INSERT INTO memberships (session_id, account_id, team_id)
    SELECT t.session_id, NEW.id, t.id FROM teams t WHERE t.entrant_id = NEW.entrant_id
    ON CONFLICT (session_id, account_id) DO NOTHING;
END;
CREATE TRIGGER account_entrant_fixed BEFORE UPDATE OF entrant_id ON accounts
WHEN (OLD.entrant_id IS NOT NULL AND NEW.entrant_id IS NOT OLD.entrant_id)
  OR (NEW.entrant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entrants e
    WHERE e.id = NEW.entrant_id AND e.event_id IS NEW.event_id))
BEGIN
  SELECT RAISE(ABORT, 'A sign-in belongs to one entrant of its own event');
END;
CREATE TRIGGER account_entrant_event BEFORE INSERT ON accounts
WHEN NEW.entrant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM entrants e
  WHERE e.id = NEW.entrant_id AND e.event_id IS NEW.event_id)
BEGIN
  SELECT RAISE(ABORT, 'A sign-in belongs to one entrant of its own event');
END;
CREATE TRIGGER account_entrant_inserted AFTER INSERT ON accounts WHEN NEW.entrant_id IS NOT NULL
BEGIN
  INSERT INTO memberships (session_id, account_id, team_id)
    SELECT t.session_id, NEW.id, t.id FROM teams t WHERE t.entrant_id = NEW.entrant_id
    ON CONFLICT (session_id, account_id) DO NOTHING;
END;

-- (4) Repair for the previous Worker's contestant membership. It links the
-- account to the entry's entrant. Then account_entrant_seats seats it in the
-- entrant's other entries too. It also places the account, because SQLite
-- does not promise the order in which this trigger and membership_adopts_event
-- run, and account_entrant_fixed compares the two events.
CREATE TRIGGER contestant_seat_links_entrant AFTER INSERT ON memberships WHEN NEW.team_id IS NOT NULL
BEGIN
  UPDATE accounts SET
    event_id = COALESCE(event_id, (SELECT event_id FROM sessions WHERE id = NEW.session_id)),
    entrant_id = (SELECT entrant_id FROM teams WHERE id = NEW.team_id)
  WHERE id = NEW.account_id AND entrant_id IS NULL;
END;

-- (5) A seat matches its account's entrant, and an entrant's sign-in never holds staff authority.
CREATE TRIGGER seat_matches_entrant BEFORE INSERT ON memberships
WHEN EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.entrant_id IS NOT NULL
  AND (NEW.team_id IS NULL OR a.entrant_id IS NOT (SELECT entrant_id FROM teams WHERE id = NEW.team_id)))
BEGIN
  SELECT RAISE(ABORT, 'An entrant sign-in holds only its own entries');
END;
CREATE TRIGGER seat_team_fixed BEFORE UPDATE OF team_id ON memberships
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND entrant_id IS NOT NULL)
  AND NEW.team_id IS NOT OLD.team_id
BEGIN
  SELECT RAISE(ABORT, 'An entrant sign-in holds only its own entries');
END;
CREATE TRIGGER contestant_has_no_role BEFORE INSERT ON membership_roles
WHEN EXISTS (SELECT 1 FROM memberships WHERE session_id = NEW.session_id
  AND account_id = NEW.account_id AND team_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'A contestant holds no staff role');
END;

-- (6) An entrant's sign-in never holds an event grant. A site grant already
-- needs an account without an event, and an entrant's sign-in always has one.
CREATE TRIGGER grant_holder_not_entrant BEFORE INSERT ON grants
WHEN NEW.scope = 'event' AND EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND entrant_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'An entrant sign-in holds no grant');
END;

-- (7) One name per entrant. An entry shows its entrant's name. Either side
-- may be renamed, because the previous Worker renames through teams. The WHEN
-- terms stop the echo.
CREATE TRIGGER entrant_renamed AFTER UPDATE OF name ON entrants WHEN NEW.name IS NOT OLD.name
BEGIN
  UPDATE teams SET name = NEW.name WHERE entrant_id = NEW.id AND name IS NOT NEW.name;
END;
CREATE TRIGGER entry_renamed AFTER UPDATE OF name ON teams
WHEN NEW.name IS NOT OLD.name AND NEW.entrant_id IS NOT NULL
BEGIN
  UPDATE entrants SET name = NEW.name WHERE id = NEW.entrant_id AND name IS NOT NEW.name;
END;

-- Contest type changes what an entry may hold, so it joins the contest version.
DROP TRIGGER session_changes;
CREATE TRIGGER session_changes AFTER UPDATE OF intake_open, event_id, categories, contest_type ON sessions
BEGIN
  UPDATE sessions SET version = version + 1 WHERE id = NEW.id;
END;
