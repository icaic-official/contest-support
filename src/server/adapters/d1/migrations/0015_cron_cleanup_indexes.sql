-- The minute cron expires image reservations and queues the images that must
-- lose their files. Without these indexes each tick scanned every image of
-- every session, so its cost grew with all images the installation had kept.
--
-- These indexes hold only the rows in the states that the cron reads. Most
-- images are ready, and the snapshots read ready images by state. A plain index
-- that led with state made the planner read all ready announcement images for
-- the announcement snapshot (measured). A partial index also adds no write for
-- an image that is ready and stays ready.
--
-- SQLite uses a partial index only when the query repeats its WHERE term
-- word for word. cronReads.test.ts fails if a cron statement stops matching.
-- The scoped cleanup of one session keeps using the session and state index.

-- The expiry step finds the reservations that ran out.
CREATE INDEX issue_images_pending_expiry ON issue_images(expires_at) WHERE state = 'pending';
-- The queue step lists the expired images.
CREATE INDEX issue_images_expired ON issue_images(state) WHERE state = 'expired';
-- The removal step lists every image with files left to remove or to check again.
CREATE INDEX issue_images_removal ON issue_images(state)
  WHERE state IN ('deleting', 'deleted', 'expired', 'abandoned');

CREATE INDEX announcement_images_pending_expiry ON announcement_images(expires_at) WHERE state = 'pending';
CREATE INDEX announcement_images_expired ON announcement_images(state) WHERE state = 'expired';
CREATE INDEX announcement_images_removal ON announcement_images(state)
  WHERE state IN ('deleting', 'deleted', 'expired', 'abandoned');

-- The cron deletes sign-ins that expired more than a day ago. Without these
-- indexes it scanned every sign-in and every identity session on each tick.
-- ba_session belongs to Better Auth. An extra index does not change its columns.
CREATE INDEX logins_expires ON logins(expires_at);
CREATE INDEX ba_session_expires ON ba_session(expiresAt);
