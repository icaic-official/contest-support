-- Only a deletion journal in step 'rows' lets a row of an event, a contest, or an event account
-- disappear. An ad hoc DELETE, from any Worker version, a test, or a console, is refused.
-- A site account (event_id NULL) is never deleted this way.
-- The journal moves forward one step at a time and keeps naming the same event
-- (event_deletion_step_order, event_deletion_fixed in 0023), so each guard opens once per event
-- and closes for good.
-- Previous Worker: never deletes events, contests, or accounts in production code. Its tests
-- (the previous release's npm run test:d1) clean up through the journal since 0023.

CREATE TRIGGER events_delete_guard BEFORE DELETE ON events
WHEN NOT EXISTS (SELECT 1 FROM event_deletions WHERE event_id = OLD.id AND step = 'rows')
BEGIN
  SELECT RAISE(ABORT, 'An event is deleted only through its deletion record');
END;
CREATE TRIGGER sessions_delete_guard BEFORE DELETE ON sessions
WHEN NOT EXISTS (SELECT 1 FROM event_deletions WHERE event_id = OLD.event_id AND step = 'rows')
BEGIN
  SELECT RAISE(ABORT, 'A contest is deleted only through the deletion of its event');
END;
CREATE TRIGGER accounts_delete_guard BEFORE DELETE ON accounts
WHEN OLD.event_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM event_deletions WHERE event_id = OLD.event_id AND step = 'rows')
BEGIN
  SELECT RAISE(ABORT, 'An account is deleted only through the deletion of its event');
END;
