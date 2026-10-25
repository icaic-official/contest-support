---
title: Troubleshooting
description: Fix common sign-in, access, image, and docs problems.
---

## I cannot sign in

Check the address and username with your organizer. After a reset, use the new temporary password.
Recovery goes through the organizer; there is no email reset.

## I see no contest data

Ask an organizer to check your session membership, team, or roles.
Cloudflare access does not give app access.
If you have several sessions, [select the right one](/guides/getting-started/#choose-a-session).

## I cannot submit a report

Intake may be closed, or the event may be archived. Ask a session admin.
For a staff report, select the team from the suggestions.

## The app shows Reconnecting

Live updates paused. Check the network. The app shows **Live** again when it reconnects.
Before you repeat an action, check whether the issue already shows it. Offline capture does not exist.

## An image upload fails

Use JPEG, PNG, or WebP. HEIC, GIF, SVG, PDF, and video are not supported.
Check the [session limits](/guides/administration/#image-limits), that the event is active, and that you are still staff.
Select **Try the upload again**, or **Cancel upload** to change the file or audience.

## A removed image stays

As the uploader, select **Retry removal**. Minsky keeps the cleanup request until storage confirms it.
Never delete other objects or reset the bucket.

## A control is missing

Your role may not include it, or the installation runs an older revision.
Check [feature status](/reference/status/).

## Docs search is empty locally

The search index exists only in a production build. Run `npm run docs:build`, then `npm run docs:preview`.
