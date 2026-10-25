# Session announcements

Ticket status and verification evidence are in the [T0006 ticket](tickets.md#t0006--session-announcements).

An announcement is a short message for one contest session.
Admins and jury publish it. Every current member of the session reads it.
This page is the reference for the behavior and for both provider implementations.

## Reading and management

- Each announcement belongs to one session.
- All current members of that session read active announcements.
  Contestants, volunteers, and specialists have read access only.
- Session admins and jury publish, edit, and remove announcements and manage their images.
  Roles combine. A person with either capability can manage.
- A title has 1 to 160 characters. Plain-text details have 1 to 10,000 characters. Both are trimmed.
- Publication is immediate. An optional future expiry and manual removal are supported.
- The titles appear above the issue workspace and the reporting form in every shell.
  A keyboard-operable disclosure shows the details and the images.
  Reporting stays available under the existing intake and archive rules.
  The strip uses at most 40% of the window height and scrolls inside that area. While a manager has the new or edit form open, it can use up to 80%, so the whole form fits on a laptop screen.
- Each announcement shows its publisher and the server publication time.
  After a change, it shows the latest editor and time.
- Editing keeps the original publisher and time.
- A removed or expired announcement leaves the readers' list.
  Managers keep it with its text, attribution, the removal actor and time, and an **Active**, **Expired**, or **Removed** label.
- Managers can edit an expired announcement. They activate it again by clearing or extending its expiry.
  The text and attribution of a removed announcement are read-only. Managers can still remove its images.
- An archived event stays readable and rejects every announcement and image write.
- Outside this ticket: text history, read receipts, targeted audiences, scheduled publication, and push notifications.

### Competing edits

An edit starts from one revision of the announcement.
When another manager changes the announcement first, the editor shows the latest text and the draft.
The manager chooses **Keep my draft** or **Load latest text**.
Keeping the draft preserves its title, details, and expiry, and accepts the reviewed version as the base of the next save.
Loading the latest text replaces the draft only when the manager chooses it.
Another change before the save needs another review.
If the announcement was removed, the draft stays but cannot be saved.
Adding or removing an image also changes the revision.

## Images

- Managers add images to a published announcement and remove any of its images.
- The formats are JPEG, PNG, and WebP. An announcement has up to four images of up to 10 MB (10,485,760 bytes) each.
  The limits are fixed. They do not use the per-session issue image limits.
- The file picker, progress, retry, inline view, and download work on phones and desktops.
  An upload failure leaves the published text available.
- Each image records its uploader and upload time. Readers see ready images of the announcements they can read.
- A reservation lasts 15 minutes. A new upload reclaims expired reservations of the same announcement.
- A failed or uncertain completion keeps its stored file.
  A retry or an overlapping request can publish it. Pending files stay unreadable.
  Cleanup of expired reservations removes unused files. No failed request deletes a file that another request can still publish.
- Removing an image deletes its stored file and keeps its metadata.
  Removing or expiring an announcement keeps its images for managers.

## Backend and updates

Both providers keep announcements and image metadata separate from issue history, ownership, timers, and awards.
The browser reads announcements through `Backend.announcements`, not through the issue snapshot.
See [backend contracts](backend-contracts.md#announcements).

Announcement reads run independently of issue reads and of submission.
A newer read cancels an older one. Changing session, losing access, or changing between reader and manager drops the cached records.
A failed announcement read never disables reporting.
Expiry uses server time. Readers see an expiry within the 10-second poll, and after a refresh or reconnect.

Request IDs make repeated commands safe. A repeated ID with the same command returns the first result.
The same ID with another command is rejected.

### Cloudflare

| Part | Implementation |
| --- | --- |
| Records | [Migration 0010](../src/server/adapters/d1/migrations/0010_announcements.sql) adds `announcements`, `announcement_receipts`, `announcement_images`, and `announcement_image_deletions`. Triggers fix publication attribution, make removal final, and guard image state changes. |
| Text commands | [D1AnnouncementService](../src/server/adapters/cloudflare/announcements.ts). One guarded D1 batch rechecks the login, manager role, and active event. It checks the revision, writes, records the receipt, and queues live hints. |
| Images | [R2AnnouncementImageService](../src/server/adapters/cloudflare/announcementImages.ts). It uses the existing private bucket under keys `sessionId/announcements/announcementId/imageId`. No new bucket, binding, or secret is needed. Transfers need an exact length and an R2-verified SHA-256 digest. |
| Routes | `GET` and `POST /api/announcements`. `POST /api/announcement-images`. `GET` and `PUT /api/announcement-image/<key>`. All use the existing origin, cookie, and request-protection checks. |
| Live updates | Each write adds a change hint for the staff audience and every team audience of the session. |
| Cleanup | The minutely maintenance run expires reservations and retries file deletions. |

The announcement text route accepts bodies up to 64 KiB. Other JSON routes keep 16 KiB.
Text of 10,000 characters can use up to 40,000 bytes in UTF-8.

### Supabase

| Part | Implementation |
| --- | --- |
| Records | [Migration 202610240001](../supabase/migrations/202610240001_announcements.sql) adds `announcements` and `announcement_images`, row level security, and the private `announcement-images` bucket. Direct table writes are denied. |
| Commands | The `announcement_command`, `begin_announcement_image`, `complete_announcement_image`, and `remove_announcement_image` functions recheck membership, account readiness, role, and archive state in a transaction. A stale revision raises SQLSTATE `MN409`. |
| Images | The [announcement-images function](../supabase/functions/announcement-images/handler.ts) is the only writer of stored files. It checks the file signature and size. Postgres checks the stored object size and type when it completes an upload. |
| Live updates | Each write raises the session revision. Clients already listen for that change. |
| Cleanup | The next upload to the same announcement tries once to delete the files of its expired reservations. No scheduled run or retry exists, so an abandoned reservation can keep an unreadable file. |

## Verification

| Layer | Command | Covers |
| --- | --- | --- |
| Unit and embedded database | `npm test` | Both D1 and R2 services with local bindings. The Supabase migration and policies in embedded PostgreSQL. Both browser adapters. Draft and expiry rules. |
| Edge Function | `npm run test:functions` | Signature and size checks, retained files after failed or overlapping completion, and retryable removal. |
| Local browser | `npm run test:e2e` | Live titles, keyboard disclosure, a report draft during a live change, slow reads, removal, competing edits, and a 390 px layout. The Worker announcement service runs on local D1. Identity and the live socket are simulated. |

These checks do not cover hosted Supabase, hosted Cloudflare, image transfers in a browser, other browsers, screen readers, or physical devices.
The shared provider verification protocol does not cover announcements yet.
