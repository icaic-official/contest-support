---
title: Verify and upgrade
description: Check the complete workflow on an installation and upgrade it safely.
---

## Check the complete journey

Create a dedicated fictional event for this check, and name it clearly. Minsky has no control that deletes an event, so its records stay in the database. Never reset a shared database.
Use a separate browser profile for each account: contestant, volunteer, specialist, jury, and contest admin.

1. Sign in with a temporary password. Contest data stays hidden until the password changes.
2. As the contest admin, select **Open now**, or give the contest a schedule that runs now. Submit an issue as the contestant. Refresh, and check that the timer continues.
3. Claim the issue as the volunteer. Send a public reply and an internal note. The contestant sees only the reply.
4. Upload a team-visible image and a staff-only image. The contestant sees only the first. Another team sees neither. Only the uploader can remove an image. Uploads over the file size, image count, or combined size limit fail.
5. Select **Escalate to specialist** as the volunteer. The volunteer stays the owner until the specialist selects **Accept handoff**.
6. Resolve the issue as the specialist. Record an award as jury. Confirm it as applied.
7. Reopen the issue. The owner, resolution history, award, and earlier time remain.
8. Change the issue in one browser while another is offline. After reconnect, the other browser updates.
9. Remove a person from the contest on the **Assignments** tab. That account loses reads, writes, image downloads, and live updates in the contest.
10. Follow [Recover a webmaster password](/operators/installation/#recover-a-webmaster-password). Old sessions fail, and the new password must change.
11. Use an expired sign-in session. It can no longer read or write.
12. Give one person two staff roles. That person has the capabilities of both roles.
13. Create a live contest and assign an entrant. Reporting stays closed, and **Open now** cannot open it, until the entrant has a live password.

Repeat key controls with the keyboard and at phone width.
The browser alone does not prove authorization. The repository's policy and provider suites test it.

## Upgrade

1. Read the changes and migrations for the new revision.
2. Verify that revision on a separate test installation.
3. Back up the database and the image bucket together.
4. In the checkout of the new revision, repeat the shell setup in [Prepare](/operators/installation/#prepare).
5. Set `MINSKY_INSTALL_CONFIG` to a new path, and repeat `configure` from [step 2](/operators/installation/#2-plan-and-configure) with your existing `provider.json`. The generated file holds paths into the checkout that created it, so a file from an older checkout deploys the older code.
6. Repeat [step 4](/operators/installation/#4-migrate) and [step 5](/operators/installation/#5-build-and-deploy). The check for an existing Worker in step 5 does not apply, because an upgrade replaces your own Worker.
7. Run the journey above.

Do not run bootstrap or the secret step again. Keep `AUTH_SECRET`, the R2 objects, and the Durable Object migration history.
This upgrade procedure has not run on a hosted installation.

Merging a pull request does not deploy an installation.

## Roll back the Worker

Close live contests before a rollback. A Worker older than the live-password feature ignores that check, so a live contest would open without it.
Do not reverse migrations to run an older frontend.
