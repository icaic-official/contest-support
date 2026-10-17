---
title: Manage accounts and session controls
description: Create accounts, assign access, control contestant intake, and set image limits.
---

## Create an account

Select **Administration** as a session admin.
Create a username account for a roster team or an individual staff member.
Distribute the temporary password through your organization's approved private channel.
The user must change it before contest access.

Minsky app membership is separate from Cloudflare, GitHub, and Supabase access.
An organizer does not need to give provider credentials to contestants or support staff.

## Assign session access

Choose the team for a contestant account.
Assign the required roles to staff accounts.
A person can hold volunteer, specialist, and jury roles together.
Session-admin access controls account and session administration.

Review the selected session before changing membership.
Removing membership removes access to that session.
Historical ownership and activity still identify the same person.
Minsky prevents removal of the last administrator.

## Reset a password

1. Check the requester's identity through your organizer procedure.
2. Reset the account password in administration.
3. Give the replacement temporary password to the account holder privately.
4. Ask the user to sign in again and change it.

The reset invalidates prior access.
Account IDs and historical activity remain.
Existing passwords are never displayed.

Password resets and username changes affect the whole account.
You need admin access to every session assigned to that account.
An archived membership blocks these account-wide changes.
Ordinary session permission changes apply only to the selected session.

## Control contestant intake

Open intake when contestants may submit new reports.
Close intake when new contestant reports must stop.
Staff can still report on behalf of a team during an active event.
Existing issues can still be reopened.
Intake and event archival are different controls.

## Set image limits

Session admins set three limits.
One MB is 1,048,576 bytes.

| Limit | Allowed range | Default |
| --- | --- | --- |
| One image | 1–50 MB | 10 MB |
| Image count per issue | 1–24 | 12 |
| Combined image size per issue | 1–120 MB | 120 MB |

The combined limit must be at least the single-image limit.
Reducing a limit does not remove existing images.
The next upload must fit the current limits.
There is no switch that disables all staff uploads.

## Understand archival

Archived events remain readable by authorized members.
Issue changes, uploads, removal, and image-limit changes stop.
Minsky does not automatically delete archived records or files.
General event, roster, and category editors remain future work.
Use the [installation guide](/operators/installation/) for the current first-install preparation process.
