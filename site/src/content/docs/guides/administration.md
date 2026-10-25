---
title: Manage a session
description: Create accounts, reset passwords, edit teams and categories, control intake, set image limits, and post announcements.
---

Use the **Session** tab (phone) or the **Accounts**, **Roster**, and **Session settings** pages (console).

## Create an account

1. Select **New account** (phone) or **Create account** (console).
2. Create a team account for contestants or a personal account for each staff member.
3. Copy the username and temporary password before you select **Done**. Minsky shows them once.
4. Send them through a private channel.

Choose the team for a contestant. Give staff any of **Volunteer**, **Specialist**, **Jury**, and **Admin**. Roles combine.
App access is separate from access to GitHub and to the hosting provider, such as Cloudflare.

## Reset a password

1. Confirm who is asking.
2. Reset from the account sheet (phone) or **Manage** (console).
3. Give the new temporary password privately.

The reset signs the account out everywhere. History stays.
Resets and username changes affect the whole account, so you need admin access to all its sessions.

## Remove access

Removing a membership removes access to that session. History still names the person.
Minsky keeps at least one admin.

## Teams

Only session admins edit teams. On the phone, open **Teams** in the **Session** tab. In the console, open **Roster**.

To add teams:

1. Select the **Add teams** box.
2. Type one team on each line. Write the name, then a comma or a tab, then the table or location. For example: `Aurora, Hall A desk 12`.
3. Press Ctrl+Enter (Cmd+Enter on a Mac), or select **Add teams**. The box clears and keeps focus, so you can type the next lines.

You can paste lines from a spreadsheet. One request adds up to 300 teams. Minsky checks the lines before it sends them. It names each line that has a problem. A name must be 1 to 200 characters. Two teams cannot have the same name. Minsky ignores differences in capital letters.

To change a team, select **Edit** in its row. Change the name or the location. Press Enter to save or Escape to cancel. A new name shows to the team's contestants and to staff at once.

To delete a team, select **Delete** and confirm. A team that has an issue or an account stays in the roster. Minsky shows why. To remove a team that has accounts, move or remove its accounts first. A team with an issue always stays, because the issue history names it.

## Categories

Contestants choose a category when they report an issue. Session admins edit the list in **Session settings** (console) or **Categories** in the **Session** tab (phone).

1. Type a new category in **New category** and press Enter.
2. Use the arrow buttons to change the order. Contestants see the list in this order.
3. Select **Save categories**.

Minsky saves the whole list at once. Keep at least one category. A category must be 1 to 200 characters, and two categories cannot have the same name. A category that an issue uses stays in the list and keeps its name, because the issue keeps that name. You can rename or remove a category that no issue uses.

## Intake

Open intake to let contestants submit reports. Close it to stop new reports.
Staff can still report for a team, and existing issues can still be reopened.

## Image limits

| Limit | Range | Default |
| --- | --- | --- |
| One image | 1–50 MB | 10 MB |
| Images per issue | 1–24 | 12 |
| Total per issue | 1–120 MB | 120 MB |

The total must be at least the single-image limit. Lower limits do not remove existing images.
Uploads cannot be switched off.

## Announcements

Session admins and jury members post announcements to the whole session. See [Post announcements](/guides/announcements/).

## Archived events

Archived events stay readable. Changes, uploads, limit changes, and team and category edits stop. Nothing is deleted.
An editor for events does not exist yet. The [installer](/operators/installation/#6-create-the-first-owner) creates the event and its session.
