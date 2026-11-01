-- Site, event, and contest grants, and the event that owns each account.
-- These D1 rules hold for every Worker version: isolation between events, the
-- last webmaster, takeover protection, and the audited join.
-- The previous Worker keeps working. It cannot add a membership that crosses
-- events, and it cannot reset or rename a webmaster. Its new accounts take the
-- event of their first membership (membership_adopts_event).

-- Contest staff stay in memberships and membership_roles, because the previous
-- Worker reads them. authority.ts merges both tables into one answer.
-- scope = 'site'    : the holder is a webmaster. Both targets are NULL.
-- scope = 'event'   : the holder is an event admin of event_id.
-- scope = 'contest' : a webmaster's audited join of session_id. It counts only
--                     while the site restricts webmaster reads.
CREATE TABLE grants (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('site', 'event', 'contest')),
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  -- An account ID or 'migration:0017'. No foreign key, because a grant outlives its granter.
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((scope = 'site' AND event_id IS NULL AND session_id IS NULL)
    OR (scope = 'event' AND event_id IS NOT NULL AND session_id IS NULL)
    OR (scope = 'contest' AND event_id IS NULL AND session_id IS NOT NULL))
) STRICT;
-- authority.ts repeats each WHERE term word for word, so SQLite uses these partial indexes.
CREATE UNIQUE INDEX grants_site ON grants(account_id) WHERE scope = 'site';
CREATE UNIQUE INDEX grants_event ON grants(event_id, account_id) WHERE scope = 'event';
CREATE UNIQUE INDEX grants_contest ON grants(session_id, account_id) WHERE scope = 'contest';
CREATE INDEX grants_by_account ON grants(account_id, scope);

-- An absent row means the default: webmasters read every contest. No row is
-- seeded, because a seeded row would fail the emptiness check of bootstrap.
CREATE TABLE site_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  restrict_webmaster_reads INTEGER NOT NULL CHECK (restrict_webmaster_reads IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
-- The resolver stamps COALESCE(version, 0). The first insert moves 0 to 1 and
-- each change moves it again, so every guard captured before a change fails.
CREATE TRIGGER site_settings_changes AFTER UPDATE OF restrict_webmaster_reads ON site_settings
BEGIN
  UPDATE site_settings SET version = version + 1 WHERE singleton = 1;
END;

-- Site and event audit. Contest actions stay in admin_audit. A row with no
-- event is a site record, which survives the deletion of an event. Actor and
-- target have no foreign key, because a site record outlives its accounts.
CREATE TABLE authority_audit (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail))
) STRICT;
CREATE INDEX authority_audit_scope_at ON authority_audit(event_id, at DESC);

-- Receipts for management commands, keyed like command_receipts. A result never holds a password.
CREATE TABLE manage_receipts (
  actor TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK (json_valid(command)),
  result TEXT NOT NULL CHECK (json_valid(result)),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (actor, request_id)
) STRICT;

-- The event that owns the account. NULL means a site account (a webmaster), or
-- an account that no membership placed yet. SQLite requires a NULL default for
-- a REFERENCES column added by ALTER TABLE.
-- The key is checked at commit. Test cleanups delete an event and then its
-- accounts in one batch, and an immediate key would refuse that order.
ALTER TABLE accounts ADD COLUMN event_id TEXT REFERENCES events(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX accounts_event ON accounts(event_id);
CREATE INDEX sessions_event ON sessions(event_id);

-- Every grant change moves the holder's access_version, as membership_added does.
CREATE TRIGGER grant_added AFTER INSERT ON grants
BEGIN
  UPDATE accounts SET access_version = access_version + 1 WHERE id = NEW.account_id;
END;
CREATE TRIGGER grant_removed AFTER DELETE ON grants
BEGIN
  UPDATE accounts SET access_version = access_version + 1 WHERE id = OLD.account_id;
END;
CREATE TRIGGER grant_immutable BEFORE UPDATE ON grants
BEGIN
  SELECT RAISE(ABORT, 'Grants are added or removed, not edited');
END;

-- Shape rules that a CHECK cannot express.
CREATE TRIGGER grant_holder_scope BEFORE INSERT ON grants
WHEN (NEW.scope = 'site' AND EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND event_id IS NOT NULL))
  OR (NEW.scope = 'event' AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND event_id = NEW.event_id))
  OR (NEW.scope = 'contest' AND NOT EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.account_id AND scope = 'site'))
BEGIN
  SELECT RAISE(ABORT, 'A webmaster holds no event, an event admin belongs to the event, and only webmasters join');
END;

-- A join exists only while the site restricts webmaster reads. A join in open
-- mode would grant nothing and record nothing useful.
CREATE TRIGGER grant_join_needs_restriction BEFORE INSERT ON grants
WHEN NEW.scope = 'contest'
  AND NOT EXISTS (SELECT 1 FROM site_settings WHERE singleton = 1 AND restrict_webmaster_reads = 1)
BEGIN
  SELECT RAISE(ABORT, 'Webmasters join a contest only while the site restricts their reads');
END;

-- D1 writes the join audit, so no writer of a join can skip it. The contest's
-- admins read the admin_audit row in their snapshot. The site row has no event,
-- so it survives the deletion of the event.
CREATE TRIGGER grant_join_audited AFTER INSERT ON grants WHEN NEW.scope = 'contest'
BEGIN
  INSERT INTO admin_audit (id, session_id, actor, action, target)
    VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a'
      || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
      NEW.session_id, NEW.account_id, 'webmaster_join', NEW.account_id);
  INSERT INTO authority_audit (id, event_id, actor, actor_name, action, target, detail)
    SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a'
      || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
      NULL, a.id, a.name, 'webmaster_join', NEW.session_id,
      json_object('event_id', (SELECT event_id FROM sessions WHERE id = NEW.session_id))
    FROM accounts a WHERE a.id = NEW.account_id;
END;

-- The last enabled webmaster cannot lose the grant or the account.
CREATE TRIGGER grant_last_webmaster BEFORE DELETE ON grants
WHEN OLD.scope = 'site' AND NOT EXISTS (SELECT 1 FROM grants g JOIN accounts a ON a.id = g.account_id
  WHERE g.scope = 'site' AND g.account_id <> OLD.account_id AND a.disabled = 0)
BEGIN
  SELECT RAISE(ABORT, 'The last webmaster cannot be removed');
END;
CREATE TRIGGER account_last_webmaster BEFORE UPDATE OF disabled ON accounts
WHEN NEW.disabled = 1 AND OLD.disabled = 0
  AND EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.id AND scope = 'site')
  AND NOT EXISTS (SELECT 1 FROM grants g JOIN accounts a ON a.id = g.account_id
    WHERE g.scope = 'site' AND g.account_id <> NEW.id AND a.disabled = 0)
BEGIN
  SELECT RAISE(ABORT, 'The last webmaster cannot be disabled');
END;
-- Removing a webmaster ends the joins that only a webmaster may hold.
CREATE TRIGGER grant_site_removed AFTER DELETE ON grants WHEN OLD.scope = 'site'
BEGIN
  DELETE FROM grants WHERE account_id = OLD.account_id AND scope = 'contest';
END;

-- A membership never crosses events. Accounts with no event pass here:
-- webmasters, and accounts of the previous Worker, which the next trigger places.
CREATE TRIGGER membership_event_scope BEFORE INSERT ON memberships
WHEN NOT EXISTS (SELECT 1 FROM accounts a JOIN sessions s ON s.id = NEW.session_id
  WHERE a.id = NEW.account_id AND (a.event_id = s.event_id OR a.event_id IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'An account joins only contests of its own event');
END;
-- The previous Worker inserts an account before its first membership. The
-- account takes the event of that first contest.
CREATE TRIGGER membership_adopts_event AFTER INSERT ON memberships
WHEN EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND event_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.account_id AND scope = 'site')
BEGIN
  UPDATE accounts SET event_id = (SELECT event_id FROM sessions WHERE id = NEW.session_id)
  WHERE id = NEW.account_id;
END;
-- An account never moves between events. A first placement from NULL is allowed.
CREATE TRIGGER account_event_fixed BEFORE UPDATE OF event_id ON accounts
WHEN OLD.event_id IS NOT NULL AND NEW.event_id IS NOT OLD.event_id
BEGIN
  SELECT RAISE(ABORT, 'An account belongs to one event');
END;

-- A lower authority cannot reset or rename a higher one, even under a
-- previous Worker whose rule lets a contest admin reset a webmaster on a
-- one-contest site. Every admin issue and rename inserts this row in the same
-- batch as its writes, so a refusal rolls the whole batch back. An actor may
-- act on the own account, which keeps password changes and trusted recovery working.
CREATE TRIGGER account_operation_takeover BEFORE INSERT ON account_operations
WHEN NEW.action IN ('create_account', 'reset_password', 'set_username') AND NEW.actor <> NEW.account_id
  AND NOT EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.actor AND scope = 'site')
  AND (EXISTS (SELECT 1 FROM grants WHERE account_id = NEW.account_id AND scope = 'site')
    OR EXISTS (SELECT 1 FROM grants t WHERE t.account_id = NEW.account_id AND t.scope = 'event'
      AND NOT EXISTS (SELECT 1 FROM grants a WHERE a.account_id = NEW.actor AND a.scope = 'event'
        AND a.event_id = t.event_id)))
BEGIN
  SELECT RAISE(ABORT, 'Only a webmaster, or an event admin of the same event, may change this account');
END;

-- Place every account that is not a webmaster in the event of most of its
-- memberships. A tie goes to the oldest contest.
UPDATE accounts SET event_id = (
  SELECT s.event_id FROM memberships m JOIN sessions s ON s.id = m.session_id
  WHERE m.account_id = accounts.id GROUP BY s.event_id ORDER BY count(*) DESC, min(s.rowid) LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM grants g WHERE g.account_id = accounts.id AND g.scope = 'site');
-- An account with no membership joins the bootstrap event, when there is one.
UPDATE accounts SET event_id = (SELECT event_id FROM installation WHERE singleton = 1)
WHERE event_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.account_id = accounts.id AND g.scope = 'site');
