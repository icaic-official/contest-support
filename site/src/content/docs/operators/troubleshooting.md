---
title: Troubleshooting
description: Fix common sign-in, access, report, and image problems.
---

## I cannot sign in

Open the sign-in link from your sign-in details, so that the event code is correct. Then check the username with your organizer. A wrong event code, username, or password gives the same message.
After a reset, use the new temporary password. A webmaster selects **Site sign-in**, which asks for no event code.
Your organizer resets a lost password. Minsky has no email reset.

## No webmaster can sign in

An operator follows [Recover a webmaster password](/operators/installation/#recover-a-webmaster-password).

## I see no contest data

Your screen shows **Session access**. Ask an organizer to assign you to a contest, and then select **Refresh access**.
Cloudflare access does not give app access.
If you can open several contests, [select the right one](/guides/getting-started/#choose-a-contest).

## I cannot send a report

Intake may be closed. The clock above the button says why. Ask a contest admin.
For a staff report, select the team from the suggestions.

## The app shows Reconnecting

Live updates paused. Check the network. The app shows **Live** again when it reconnects.
Before you repeat an action, check whether the issue already shows it. Minsky has no offline capture.

## An image upload fails

Use JPEG, PNG, or WebP. Minsky does not support HEIC, GIF, SVG, PDF, or video.
Check the [image limits](/guides/administration/#set-image-limits), and check that you are still staff in the contest.
Select **Try the upload again**, or **Cancel upload** to change the file or audience.

## A removed image stays

As the uploader, select **Retry removal**. Minsky keeps the cleanup request until storage confirms it.
Never delete other objects or reset the bucket.

## A control is missing

Your role may not include it, or the installation may run an older revision.
Check [feature status](/reference/status/).
