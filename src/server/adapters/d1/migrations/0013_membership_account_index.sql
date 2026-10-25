-- The primary key starts with session_id. Every lookup of the sessions an
-- account belongs to, and every trigger that notifies an account's sessions,
-- scanned all memberships. The same index serves the foreign-key cascade when an
-- account is deleted.
CREATE INDEX memberships_account_session ON memberships(account_id, session_id);

-- A contestant sees only the issues of one team. Without this index the
-- snapshot reads every issue of the session to find them.
CREATE INDEX issues_session_team ON issues(session_id, team_id);
