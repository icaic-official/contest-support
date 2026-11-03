-- Removing an entry deletes the seats of its entrant (0019 entry_seats_removed),
-- and the memberships foreign key (session_id, team_id) -> teams(session_id, id)
-- finds the child rows of a deleted team. The primary key starts with
-- (session_id, account_id), so each of the two reads scanned every member of
-- the contest: 2,443 rows for a contest of 1,200 members. This index starts at
-- the entry, so both read only its seats.
CREATE INDEX memberships_team ON memberships(session_id, team_id);
