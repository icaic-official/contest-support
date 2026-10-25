-- The avatar list of a staff member reads the staff memberships of one session.
-- The primary key starts with session_id, so SQLite read every member of the
-- session and tested team_id on each row. This index holds only the rows with
-- no team, which are the staff and the plain members, so the read starts from
-- them. It serves no other statement today. A contestant never reads it.
CREATE INDEX memberships_staff ON memberships(session_id, account_id) WHERE team_id IS NULL;
