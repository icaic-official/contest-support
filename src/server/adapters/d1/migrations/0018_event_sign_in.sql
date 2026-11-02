-- Event codes, the event time zone, and handles that are unique inside their
-- event. A person signs in with an event code, or as a site account, and a handle.
-- accounts.username stays the login key that Better Auth knows. Its global
-- unique index stays, so the previous Worker's sign-in lookup
-- (SELECT * FROM accounts WHERE username = ?) still reads one row through it.
-- The previous Worker keeps working. Legacy accounts sign in to it as before,
-- because their handle equals their login key. Accounts that the new Worker
-- creates have a login key that nobody types, so they cannot sign in to it.

-- The code that an event sign-in names, for example 'xxxx-olympiad-2026'.
ALTER TABLE events ADD COLUMN code TEXT
  CHECK (code IS NULL OR (length(code) BETWEEN 3 AND 40
    AND code NOT GLOB '*[^a-z0-9-]*' AND substr(code, 1, 1) GLOB '[a-z0-9]'));
-- Random and opaque, 64 bits. Event IDs are not used, because fixture IDs need not fit the CHECK.
UPDATE events SET code = 'e' || lower(hex(randomblob(8))) WHERE code IS NULL;
CREATE UNIQUE INDEX events_code ON events(code);
-- The previous Worker's bootstrap and the test fixtures insert events without a code.
CREATE TRIGGER event_default_code AFTER INSERT ON events WHEN NEW.code IS NULL
BEGIN
  UPDATE events SET code = 'e' || lower(hex(randomblob(8))) WHERE id = NEW.id;
END;
-- An IANA zone name. The Worker validates it with Intl before it writes one.
ALTER TABLE events ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC'
  CHECK (length(time_zone) BETWEEN 1 AND 64);

-- The name that a person types. It has the shape of the login key.
ALTER TABLE accounts ADD COLUMN handle TEXT CHECK (handle IS NULL OR (length(handle) BETWEEN 3 AND 32
  AND handle NOT GLOB '*[^a-z0-9_-]*' AND substr(handle, 1, 1) GLOB '[a-z0-9]'));
-- A legacy account keeps its visible name, so its handle equals its login key.
-- An account with no event and no site grant gets no handle, so it holds no
-- name in the site namespace and cannot sign in.
UPDATE accounts SET handle = username
WHERE username IS NOT NULL
  AND (event_id IS NOT NULL OR EXISTS (SELECT 1 FROM grants g WHERE g.account_id = accounts.id AND g.scope = 'site'));
-- One namespace for each event and one for site accounts. Usernames were
-- globally unique, so neither index can fail on existing data.
CREATE UNIQUE INDEX accounts_event_handle ON accounts(event_id, handle) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX accounts_site_handle ON accounts(handle) WHERE event_id IS NULL AND handle IS NOT NULL;

-- The previous Worker's writes converge. It creates an account with a username
-- and no event, and a membership then places the account (0017
-- membership_adopts_event). Its set_username fills a NULL username. The handle
-- follows both. A username that is already a handle in the same namespace
-- fails the whole batch, and the previous Worker reports an error.
CREATE TRIGGER accounts_handle_default AFTER UPDATE OF event_id, username ON accounts
WHEN NEW.handle IS NULL AND NEW.username IS NOT NULL
  AND (NEW.event_id IS NOT NULL OR EXISTS (SELECT 1 FROM grants g WHERE g.account_id = NEW.id AND g.scope = 'site'))
BEGIN
  UPDATE accounts SET handle = NEW.username WHERE id = NEW.id;
END;
-- The previous Worker's add_webmaster and bootstrap insert an account with a
-- username, then its site grant, and no membership. The handle follows the grant.
CREATE TRIGGER site_handle_default AFTER INSERT ON grants WHEN NEW.scope = 'site'
BEGIN
  UPDATE accounts SET handle = username
  WHERE id = NEW.account_id AND handle IS NULL AND username IS NOT NULL AND event_id IS NULL;
END;

-- The code and the time zone take part in the event version that guards capture.
DROP TRIGGER event_changes;
CREATE TRIGGER event_changes AFTER UPDATE OF archived, code, time_zone ON events
BEGIN
  UPDATE events SET version = version + 1 WHERE id = NEW.id;
END;
