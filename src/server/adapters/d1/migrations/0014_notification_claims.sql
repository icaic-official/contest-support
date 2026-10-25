-- A dispatcher claims outbox rows until this Unix time. An expired claim is
-- retryable, so a crashed or cancelled dispatcher never loses a row.
ALTER TABLE notifications ADD COLUMN claimed_until INTEGER;
-- Serves the claim order without a sort. It leads with delivered, so the claim
-- reads only pending rows.
CREATE INDEX notifications_claim_order
  ON notifications(delivered, COALESCE(last_attempt_at, 0), session_id, audience, sequence);
-- Serves the login check in the account notification triggers below.
CREATE INDEX logins_account ON logins(account_id);

-- An account without a login has no live connection, and its first connection
-- starts with a full refresh. Account setup therefore writes only the staff
-- notification. These triggers otherwise match 0009_notifications.sql.
DROP TRIGGER account_operation_audit;
CREATE TRIGGER account_operation_audit AFTER INSERT ON account_operations
WHEN NEW.session_id IS NOT NULL
BEGIN
  INSERT INTO admin_audit (id, session_id, actor, action, target, detail)
    VALUES (NEW.id, NEW.session_id, NEW.actor, NEW.action, NEW.account_id, json_object('state', NEW.state));
  INSERT INTO audience_sequences (session_id, audience, sequence)
    SELECT NEW.session_id, audience, 1 FROM (SELECT 'staff' AS audience UNION ALL SELECT 'account:' || NEW.account_id
      WHERE EXISTS (SELECT 1 FROM logins WHERE account_id = NEW.account_id))
    WHERE true
    ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1;
  INSERT INTO notifications (id, session_id, audience, sequence)
    SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), session_id, audience, sequence FROM audience_sequences
    WHERE session_id = NEW.session_id AND (audience = 'staff' OR audience = 'account:' || NEW.account_id
      AND EXISTS (SELECT 1 FROM logins WHERE account_id = NEW.account_id));
END;

DROP TRIGGER account_access_notifications;
CREATE TRIGGER account_access_notifications
AFTER UPDATE OF disabled, must_change, credential_generation, credential_state ON accounts
WHEN (NEW.disabled <> OLD.disabled OR NEW.must_change <> OLD.must_change
  OR NEW.credential_generation <> OLD.credential_generation OR NEW.credential_state <> OLD.credential_state)
  AND EXISTS (SELECT 1 FROM logins WHERE account_id = NEW.id)
BEGIN
  INSERT INTO audience_sequences (session_id, audience, sequence)
    SELECT session_id, 'account:' || NEW.id, 1 FROM memberships WHERE account_id = NEW.id
    ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1;
  INSERT INTO notifications (id, session_id, audience, sequence)
    SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), q.session_id, q.audience, q.sequence FROM audience_sequences q
    JOIN memberships m ON m.session_id = q.session_id AND m.account_id = NEW.id
    WHERE q.audience = 'account:' || NEW.id;
END;
