---
title: Verify and upgrade
description: Check the complete workflow on an installation and upgrade it safely.
---

## Check the complete journey

Use fictional accounts in separate browser profiles: contestant, volunteer, specialist, jury, and admin.
Delete only the data you create for the check. Never reset a shared database.

1. Sign in with a temporary password. Contest data stays hidden until the password changes.
2. Open intake. Submit an issue as the contestant. Refresh: the timer continues.
3. Claim it as the volunteer. Send a public reply and an internal note. The contestant sees only the reply.
4. Upload a team-visible and a staff-only image. The contestant sees only the first. Another team sees neither.
   Only the uploader can remove an image. Uploads over the file size, image count, or combined size limit fail.
5. Request a handoff. The volunteer stays the owner until the specialist accepts.
6. Resolve as the specialist. Record an award as jury. Confirm it as applied.
7. Reopen. The owner, resolution history, award, and earlier time remain.
8. Change the issue in one browser while another is offline. After reconnect, the other browser updates.
9. Remove a membership. That account loses reads, writes, image downloads, and live updates.
10. On Cloudflare, recover the owner. Old sessions fail and the new password must change.
11. Use an expired sign-in session. It can no longer read or write.
12. Give one person two staff roles. They have the capabilities of both roles.
13. Archive the event. Its members can still read it, but changes and uploads fail. Other accounts cannot read it.

Repeat key controls with the keyboard and at phone width.
The browser alone does not prove authorization. The repository's policy and provider suites test it.

## Upgrade

1. Read the changes and migrations for the new revision.
2. Verify that revision on development and isolated CI resources.
3. Back up the database and the image bucket together.
4. Apply migrations, then deploy:
   - **Cloudflare:** the complete Worker and assets with your generated configuration. Keep `AUTH_SECRET`, R2 objects, and the Durable Object migration history.
   - **Supabase:** the `admin`, `attachments`, and `announcement-images` functions, then the frontend.
5. Run the journey above.

Merging a pull request does not deploy an installation.
Do not reverse migrations to run an older frontend.
