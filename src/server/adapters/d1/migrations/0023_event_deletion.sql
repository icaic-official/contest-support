-- The journal of one event's permanent deletion, and the indexes that keep the
-- cascade and the account deletes from reading other events' rows.
-- The guards that make the journal the only way to delete come in 0024, one
-- release later, so that the previous release's test cleanup still passes
-- scripts/rollback-check.mjs here.
-- Previous Worker: archived = 1 makes it refuse every write. It does not read the journal.

-- No foreign key to events or accounts: the row is the permanent site record of the deletion.
-- Steps: rows (contests, then accounts, then the event row), live (Durable Object erase),
-- files (R2 prefixes), done. `blocked` holds the ID of the account that stops the rows step.
CREATE TABLE event_deletions (
  event_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_code TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  step TEXT NOT NULL DEFAULT 'rows' CHECK (step IN ('rows', 'live', 'files', 'done')),
  rows_done_at TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  blocked TEXT,
  finished_at TEXT,
  CHECK ((step = 'rows') = (rows_done_at IS NULL)),
  CHECK ((step = 'done') = (finished_at IS NOT NULL))
) STRICT;
CREATE INDEX event_deletions_open ON event_deletions(lease_until) WHERE finished_at IS NULL;
CREATE INDEX event_deletions_finished ON event_deletions(finished_at) WHERE finished_at IS NOT NULL;
-- The journal only moves forward, and it keeps naming the same event. So the step 'rows', which
-- the 0024 guards read, opens once per event and closes for good.
CREATE TRIGGER event_deletion_step_order BEFORE UPDATE OF step ON event_deletions
WHEN NEW.step IS NOT OLD.step AND NOT ((OLD.step = 'rows' AND NEW.step = 'live')
  OR (OLD.step = 'live' AND NEW.step = 'files') OR (OLD.step = 'files' AND NEW.step = 'done'))
BEGIN
  SELECT RAISE(ABORT, 'A deletion moves forward one step at a time');
END;
CREATE TRIGGER event_deletion_fixed BEFORE UPDATE OF event_id, event_name, event_code, requested_by ON event_deletions
BEGIN
  SELECT RAISE(ABORT, 'A deletion record names its event for good');
END;

-- Exactly what the deletion may touch, by ID. Every later step deletes by these IDs or by R2
-- prefixes derived from them, never by a wider predicate. `done` means done in the current step:
-- the batch that moves to the next step clears it for the contests, which that step visits again.
CREATE TABLE event_deletion_targets (
  event_id TEXT NOT NULL REFERENCES event_deletions(event_id),
  kind TEXT NOT NULL CHECK (kind IN ('contest', 'account', 'avatar_owner')),
  id TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  PRIMARY KEY (event_id, kind, id)
) STRICT;
CREATE INDEX event_deletion_targets_pending ON event_deletion_targets(event_id, kind, id) WHERE done = 0;

-- Foreign-key children without an index make each parent delete read the child table across every
-- event, or the whole session under a key's first column. foreignKeyIndexes.test.ts derives this
-- list from the schema. A partial index on a mostly NULL column costs nothing for rows that leave
-- it NULL. The added writes on hot paths: one entry per history row, issue, resolution, award,
-- image, and workflow receipt.
CREATE INDEX account_operations_account ON account_operations(account_id);
CREATE INDEX account_operations_actor ON account_operations(actor);
CREATE INDEX account_operations_session ON account_operations(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX admin_audit_actor ON admin_audit(actor);
CREATE INDEX admin_audit_target ON admin_audit(target) WHERE target IS NOT NULL;
CREATE INDEX announcement_images_parent ON announcement_images(session_id, announcement_id);
CREATE INDEX announcement_images_deleted_by ON announcement_images(deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX announcement_receipts_parent ON announcement_receipts(session_id, announcement_id);
CREATE INDEX announcements_author ON announcements(author);
CREATE INDEX announcements_edited_by ON announcements(edited_by) WHERE edited_by IS NOT NULL;
CREATE INDEX announcements_removed_by ON announcements(removed_by) WHERE removed_by IS NOT NULL;
CREATE INDEX awards_actor ON awards(actor);
CREATE INDEX awards_applied_by ON awards(applied_by) WHERE applied_by IS NOT NULL;
CREATE INDEX awards_issue ON awards(session_id, issue_id);
CREATE INDEX command_receipts_issue ON command_receipts(session_id, issue_id);
CREATE INDEX contest_awards_applied_by ON contest_awards(applied_by) WHERE applied_by IS NOT NULL;
CREATE INDEX contest_awards_withdrawn_by ON contest_awards(withdrawn_by) WHERE withdrawn_by IS NOT NULL;
CREATE INDEX grants_event_key ON grants(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX grants_session_key ON grants(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX history_actor ON history(actor);
CREATE INDEX issue_images_deleted_by ON issue_images(deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX issue_images_issue ON issue_images(session_id, issue_id);
CREATE INDEX issues_owner ON issues(owner) WHERE owner IS NOT NULL;
CREATE INDEX issues_reporter ON issues(reporter);
CREATE INDEX resolutions_actor ON resolutions(actor);
CREATE INDEX resolutions_issue ON resolutions(session_id, issue_id);
CREATE INDEX resolutions_reopened_by ON resolutions(reopened_by) WHERE reopened_by IS NOT NULL;
