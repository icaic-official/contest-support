ALTER TABLE issue_images ADD COLUMN request_command TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(request_command));
ALTER TABLE issue_images ADD COLUMN thumbnail_content_type TEXT;

-- Logical paths and visibility cannot change after reservation. R2 objects use
-- conditional creation, so validated bytes cannot be replaced by another retry.
CREATE TRIGGER image_identity_immutable BEFORE UPDATE OF
  id, session_id, issue_id, uploader, request_id, visibility, declared_bytes,
  original_path, thumbnail_path, request_command, original_name, uploader_name ON issue_images
BEGIN
  SELECT RAISE(ABORT, 'Image reservation identity is immutable');
END;
CREATE TRIGGER image_state_guard BEFORE UPDATE OF state ON issue_images
WHEN NOT (OLD.state = NEW.state
  OR (OLD.state = 'pending' AND NEW.state IN ('ready', 'abandoned', 'expired'))
  OR (OLD.state = 'ready' AND NEW.state = 'deleting')
  OR (OLD.state = 'deleting' AND NEW.state = 'deleted'))
BEGIN
  SELECT RAISE(ABORT, 'Invalid image transition');
END;
