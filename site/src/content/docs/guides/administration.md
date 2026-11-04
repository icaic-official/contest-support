---
title: Manage a session
description: Create accounts, reset passwords, edit teams and categories, control intake, set image limits, and post announcements.
---

Use the **Session** tab (phone) or the **Accounts**, **Roster**, and **Session settings** pages (console).

## Create accounts and assign people

An event admin or a webmaster creates accounts and assigns people. A contest admin does not. Open the **event console** from the sidebar link **Event console**, or at `/event`.

- **People.** Paste lines of `name, username` and choose **Create people**. Switch **Event admin** on for a person who should run the event.
- **Entrants.** Choose **Team** or **Single contestant**, paste lines of `name, username`, and choose **Import entrants**. Each entrant has one sign-in.
- **Contests.** Create a contest with a type: teams, single contestants, or both.
- **Assignments.** Choose a contest. Select entrants, give them a location, and assign them. Give each person roles, or make them a contest admin, and choose **Assign**.

After each creation, a credential sheet shows each temporary password once, in batches of eight. If a password did not arrive, choose **Issue again**.

## Reset a password

1. Confirm who is asking.
2. Reset from the account sheet (phone) or **Manage** (console).
3. Give the new temporary password privately.

The reset signs the account out everywhere. History stays. The account keeps its username.
Resets and username changes affect the whole account. A contest admin can use them only for an account that sits in no other contest. An event admin can use them for every account of the event.

## Change a username

1. Open the account sheet (phone) or **Manage** (console).
2. Enter the new username in **Change username**, and select **Change username**.
3. Tell the person their new username. Print a new sheet for a team.

The password stays, and open sessions stay signed in. An older account without a username gets one here. Then reset its password, so that it can sign in.

## Remove access

An event admin removes a person from a contest in the event console, on the **Assignments** tab. History still names the person. An entrant leaves a contest the same way, unless it has an issue there.

## Team locations

A contest admin changes where a team sits. On the phone, open **Team locations** in the **Session** tab. In the console, open **Team locations**. Change the text in a team's row and select **Save**.
A contest admin does not add, rename, or delete teams. An event admin does that in the event console, on the **Entrants** tab, and assigns them on the **Assignments** tab.

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
A webmaster creates events on the **Site** page. The [installer](/operators/installation/#6-create-the-first-webmaster) creates only the first webmaster. An event admin then creates contests in the event console.
