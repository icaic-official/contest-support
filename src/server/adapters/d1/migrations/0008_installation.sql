-- Trusted first installation only. No HTTP endpoint can grant this authority.
CREATE TABLE installation (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  id TEXT NOT NULL UNIQUE,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
