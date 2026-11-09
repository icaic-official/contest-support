# Contest announcements

An announcement is a short message for one contest.
Admins and jury publish it. Every current member of the contest reads it.
This page is the reference for the behavior. The database and the code call a contest a session.

## Reading and management

- Each announcement belongs to one contest.
- All current members of that contest read active announcements.
  Contestants, volunteers, and specialists have read access only.
- Contest admins, event admins, webmasters, and jury are managers. Managers publish, edit, and remove announcements and manage their images.
  Roles combine. A person with either capability can manage.
  While the site restricts webmaster reads, a webmaster manages only after an audited join of the contest.
- A title has 1 to 160 characters. Plain-text details have 1 to 10,000 characters. Both are trimmed.
- Publication is immediate. An optional future expiry and manual removal are supported.
- The titles appear above the issue workspace and the reporting form in every shell.
  A keyboard-operable disclosure shows the details and the images.
  Reporting stays available under the intake and archive rules.
  The strip uses at most 40% of the window height and scrolls inside that area. While a manager has the new or edit form open, it can use up to 80%, so the whole form fits on a laptop screen.
- The strip lists the two newest announcements. **Show N more** lists the rest. **Show fewer** returns to two.
  An announcement with an open edit or removal prompt stays listed, also when a new announcement pushes it down.
- Every member can hide the strip with **Hide**. A one-line bar with the heading, the announcement count, and **Show** replaces it.
  Hiding does not close an open announcement or discard a draft. **Show** restores them.
  A failed publish message stays visible while the strip is hidden, so Retry stays available.
- The browser stores the hidden choice with the IDs of the announcements that it covered.
  It keeps one choice for each person and contest in that browser.
  An announcement that was not listed when the member hid the strip shows it again.
  This includes an expired announcement that a manager activates again. A change to a listed announcement does not.
  If the browser cannot store the choice, the choice applies until the page reloads.
- Each announcement shows its publisher and the server publication time.
  After a change, it shows the latest editor and time.
- Editing keeps the original publisher and time.
- An expired announcement leaves the readers' list. Managers keep it with an **Active** or **Expired** label.
- Managers can edit an expired announcement. They activate it again by clearing or extending its expiry.
- **Remove** opens a prompt. The prompt says that the announcement leaves the strip for everyone, managers included, and that Minsky keeps the record for the contest log.
  **Remove announcement** removes it. **Keep announcement** closes the prompt.
  When the prompt opens, focus moves to **Keep announcement**. When the prompt closes, focus returns to **Remove**. After a removal, focus moves to **New announcement**.
- A removed announcement leaves the strip for every member, managers included. Nobody can open its images in the app.
  A contest admin can still download a ready image of a removed announcement through the image route, so that the contest archive can hold it. No other member can.
- Minsky keeps the record of a removed announcement: its text, attribution, images, stored files, and the removal actor and time.
  Nobody can edit it, add images to it, or remove its images.
  Minsky has no export of the contest log yet.
- An archived event stays readable and rejects every announcement and image write.
- Outside this feature: text history, read receipts, targeted audiences, scheduled publication, and push notifications.

### Competing edits

An edit starts from one revision of the announcement.
When another manager changes the announcement first, the editor shows the latest text and the draft.
The manager chooses **Keep my draft** or **Load latest text**.
Keeping the draft preserves its title, details, and expiry, and accepts the reviewed version as the base of the next save.
Loading the latest text replaces the draft only when the manager chooses it.
Another change before the save needs another review.
If another manager removes the announcement, the draft stays but cannot be saved.
Adding or removing an image also changes the revision.

## Images

- Managers add images to a published announcement and remove any of its images.
- The formats are JPEG, PNG, and WebP. An announcement has up to four images of up to 10 MB (10,485,760 bytes) each.
  The limits are fixed. They do not use the per-contest issue image limits.
- The file picker, progress, retry, inline view, and download work on phones and desktops.
  Below 1024 px wide, every button in the announcement strip is 44 px high. At 1024 px and wider, the buttons keep their compact desktop size.
  An upload failure leaves the published text available.
- Each image records its uploader and upload time. Readers see ready images of the announcements they can read.
- A reservation lasts 15 minutes. A new upload reclaims expired reservations of the same announcement.
- A failed or uncertain completion keeps its stored file.
  A retry or an overlapping request can publish it. Pending files stay unreadable.
  Cleanup of expired reservations removes unused files. No failed request deletes a file that another request can still publish.
- **Remove** on an image opens a prompt. The prompt names the file and says that Minsky deletes it and cannot restore it.
  **Remove image** deletes it. **Keep image** closes the prompt. Nothing is deleted until the manager confirms.
  When the prompt opens, focus moves to **Keep image**. When the prompt closes, focus returns to **Remove**.
- Removing an image deletes its stored file and keeps its metadata.
  Expiring an announcement keeps its images for managers. Removing an announcement keeps its images and files, but nobody can open them in the app.

## Backend and updates

Minsky keeps announcements and image metadata separate from issue history, ownership, timers, and awards.
The browser reads announcements through `Backend.announcements`, not through the issue snapshot.
See [backend contracts](backend-contracts.md#announcements).

Announcement reads run independently of issue reads and of submission.
A newer read cancels an older one. Changing contest, losing access, or changing between reader and manager drops the cached records.
A failed announcement read never disables reporting.
Expiry uses server time, and it sends no live hint. Readers see an expiry at their next read, which comes within 60 seconds on the snapshot timer, or after a refresh or reconnect.

Request IDs make repeated commands safe. A repeated ID with the same command returns the first result.
This holds also when the expiry of that command has passed by the time of the repeat.
Only a new command needs a future expiry.
The same ID with another command is rejected.

### Cloudflare

| Part | Implementation |
| --- | --- |
| Records | [Migration 0010](../src/server/adapters/d1/migrations/0010_announcements.sql) adds `announcements`, `announcement_receipts`, `announcement_images`, and `announcement_image_deletions`. Triggers fix publication attribution, make removal final, and guard image state changes. |
| Text commands | [D1AnnouncementService](../src/server/adapters/cloudflare/announcements.ts). One guarded D1 batch rechecks the login, manager role, and active event. It checks the revision, writes, records the receipt, and queues live hints. |
| Images | [R2AnnouncementImageService](../src/server/adapters/cloudflare/announcementImages.ts). It uses the private image bucket under keys `sessionId/announcements/announcementId/imageId`. Transfers need an exact length and an R2-verified SHA-256 digest. |
| Routes | `GET` and `POST /api/announcements`. `POST /api/announcement-images`. `GET` and `PUT /api/announcement-image/<key>`. All use the origin, cookie, and request-protection checks of the other application routes. |
| Live updates | Each write adds a change hint for the staff audience and every team audience of the contest. |
| Cleanup | The minutely maintenance run expires reservations and retries file deletions. |

The announcement text route accepts bodies up to 64 KiB, because text of 10,000 characters can use up to 40,000 bytes in UTF-8.

## Verification

| Layer | Command | Covers |
| --- | --- | --- |
| Unit | `npm test` | The D1 and R2 services with local bindings. The browser adapter. Draft and expiry rules. |
| Local browser | `npm run test:e2e` | Live titles, keyboard disclosure, a report draft during a live change, slow reads, removal with its prompt and focus, a draft during another manager's removal, competing edits, the two-announcement list, hiding the strip, and a 390 px layout. The Worker announcement service runs on local D1. Identity and the live socket are simulated. |

These checks do not cover hosted Cloudflare, other browsers, screen readers, or physical devices.
The shared provider suite does not cover announcements.
