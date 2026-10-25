-- The session snapshot joins history to issues by issue_id on every refresh.
-- Without this index SQLite scans the history of every session. The same index
-- serves the foreign-key cascade when an issue is deleted.
CREATE INDEX history_issue_at ON history(issue_id, at);
