-- Retry bookkeeping contains no application or credential data.
ALTER TABLE notifications ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0);
ALTER TABLE notifications ADD COLUMN last_attempt_at INTEGER;
CREATE INDEX notifications_pending ON notifications(delivered, session_id, audience, sequence);

-- Full-connector installations add these hooks without changing the isolated
-- authentication service or requiring its historical database to add this schema.
CREATE TRIGGER account_operation_audit AFTER INSERT ON account_operations
WHEN NEW.session_id IS NOT NULL
BEGIN
  INSERT INTO admin_audit (id, session_id, actor, action, target, detail)
    VALUES (NEW.id, NEW.session_id, NEW.actor, NEW.action, NEW.account_id, json_object('state', NEW.state));
  INSERT INTO audience_sequences (session_id, audience, sequence)
    VALUES (NEW.session_id, 'staff', 1), (NEW.session_id, 'account:' || NEW.account_id, 1)
    ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1;
  INSERT INTO notifications (id, session_id, audience, sequence)
    SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), session_id, audience, sequence FROM audience_sequences
    WHERE session_id = NEW.session_id AND audience IN ('staff', 'account:' || NEW.account_id);
END;
CREATE TRIGGER account_operation_audit_state AFTER UPDATE OF state ON account_operations
WHEN NEW.session_id IS NOT NULL AND NEW.state <> OLD.state
BEGIN
  UPDATE admin_audit SET detail = json_object('state', NEW.state) WHERE id = NEW.id;
END;

CREATE TRIGGER account_access_notifications
AFTER UPDATE OF disabled, must_change, credential_generation, credential_state ON accounts
WHEN NEW.disabled <> OLD.disabled OR NEW.must_change <> OLD.must_change
  OR NEW.credential_generation <> OLD.credential_generation OR NEW.credential_state <> OLD.credential_state
BEGIN
  INSERT INTO audience_sequences (session_id, audience, sequence)
    SELECT session_id, 'account:' || NEW.id, 1 FROM memberships WHERE account_id = NEW.id
    ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1;
  INSERT INTO notifications (id, session_id, audience, sequence)
    SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), q.session_id, q.audience, q.sequence FROM audience_sequences q
    JOIN memberships m ON m.session_id = q.session_id AND m.account_id = NEW.id
    WHERE q.audience = 'account:' || NEW.id;
END;

CREATE TRIGGER login_access_notifications
AFTER UPDATE OF revoked, expires_at, credential_generation, identity_session_id ON logins
WHEN NEW.revoked <> OLD.revoked OR NEW.expires_at <> OLD.expires_at
  OR NEW.credential_generation <> OLD.credential_generation
  OR (OLD.identity_session_id IS NOT NULL AND NEW.identity_session_id IS NOT OLD.identity_session_id)
BEGIN
  INSERT INTO audience_sequences (session_id, audience, sequence)
    SELECT session_id, 'account:' || NEW.account_id, 1 FROM memberships WHERE account_id = NEW.account_id
    ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1;
  INSERT INTO notifications (id, session_id, audience, sequence)
    SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), q.session_id, q.audience, q.sequence FROM audience_sequences q
    JOIN memberships m ON m.session_id = q.session_id AND m.account_id = NEW.account_id
    WHERE q.audience = 'account:' || NEW.account_id;
END;

CREATE TRIGGER identity_removed_notifications AFTER DELETE ON ba_session
BEGIN
  INSERT INTO audience_sequences (session_id, audience, sequence)
    SELECT session_id, 'account:' || OLD.userId, 1 FROM memberships WHERE account_id = OLD.userId
    ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1;
  INSERT INTO notifications (id, session_id, audience, sequence)
    SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), q.session_id, q.audience, q.sequence FROM audience_sequences q
    JOIN memberships m ON m.session_id = q.session_id AND m.account_id = OLD.userId
    WHERE q.audience = 'account:' || OLD.userId;
END;

CREATE TRIGGER identity_changed_notifications AFTER UPDATE OF expiresAt, userId ON ba_session
WHEN NEW.expiresAt <> OLD.expiresAt OR NEW.userId <> OLD.userId
BEGIN
  INSERT INTO audience_sequences (session_id, audience, sequence)
    SELECT session_id, 'account:' || OLD.userId, 1 FROM memberships WHERE account_id = OLD.userId
    ON CONFLICT (session_id, audience) DO UPDATE SET sequence = sequence + 1;
  INSERT INTO notifications (id, session_id, audience, sequence)
    SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), q.session_id, q.audience, q.sequence FROM audience_sequences q
    JOIN memberships m ON m.session_id = q.session_id AND m.account_id = OLD.userId
    WHERE q.audience = 'account:' || OLD.userId;
END;
