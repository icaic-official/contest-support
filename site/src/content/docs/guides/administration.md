---
title: Manage a session
description: Create accounts, reset passwords, edit teams and categories, schedule contests, control intake, set image limits, and post announcements.
---

Use the **Session** tab (phone) or the **Accounts**, **Roster**, and **Session settings** pages (console).

## Create accounts and assign people

An event admin or a webmaster creates accounts and assigns people. A contest admin does not. Open the **event console** from the sidebar link **Event console**, or at `/event`.

- **People.** Paste lines of `name, username` and choose **Create people**. Switch **Event admin** on for a person who should run the event.
- **Entrants.** Choose **Team** or **Single contestant**, paste lines of `name, username`, and choose **Import entrants**. Each entrant has one sign-in.
- **Contests.** Create a contest with a type: teams, single contestants, or both.
- **Assignments.** Choose a contest. Select entrants, give them a location, and assign them. Give each person roles, or make them a contest admin, and choose **Assign**.

After each creation, a credential sheet shows each temporary password once, in batches of eight. If a password did not arrive, choose **Issue again**. **Print sheets** prints one card for each person.

## Issue live passwords

A live contest stays closed until every sign-in in it has a password issued for that contest. **Open now** cannot open it earlier.

1. Create the contest with the kind **Live**. The kind cannot change later.
2. Assign its entrants. **Contests** shows "Waiting for live passwords" with a count and the names.
3. Choose **Issue live passwords**. Minsky issues eight accounts at a time. The panel also names the overlapping live contests that these passwords open.
4. Print or share the sheet. When the count reaches zero, the panel disappears and the contest follows its schedule.

A person's own password change keeps the contest ready. A reset by staff closes the contest until that person has a new password. Assigning another entrant to a live contest also closes it until that entrant has a password.

## Reset a password

1. Confirm who is asking.
2. Reset from the account sheet (phone) or **Manage** (console).
3. Give the new temporary password privately.

Minsky refuses a reset that would sign a contestant out of an open contest that the reset does not name. A reset from the contest's own page or from **Entrants** names the open contest. If the contestant has a second open contest, close it first, or wait until it ends.

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

Intake follows the contest's schedule. An event admin sets the start, the end, and the grace period in the event's time zone, on the **Contests** tab of the event console. See [Schedule a contest](#schedule-a-contest).

Intake opens at the start and closes at the end plus the grace period. A contestant's own end time is the contest's end plus the minutes that staff confirmed as applied. That contestant can report until the personal end time plus the grace period.

The **Contestant intake** panel in **Session settings** (console) or the **Session** tab (phone) shows the state:

- **Following the schedule.** The panel says when intake opens and closes.
- **Open now** holds intake open until you close it or return it to the schedule.
- **Close now** holds intake closed in the same way.
- **Return to schedule** ends the hold. It shows only while you hold intake by hand and the contest has a schedule.

A contest that existed before schedules has none. Its intake stays a switch that staff set by hand until an event admin gives it a schedule and you select **Return to schedule**.

Closed intake stops new contestant reports. Staff can still report for a team, and existing issues can still be reopened.

## Schedule a contest

Event admins and webmasters set the schedule. A contest admin cannot.

1. Open the event console and select **Contests**.
2. Enter the start date and time, the end date and time, and the grace period in minutes. The form shows the event's time zone. Enter the time as it reads on a clock in the event's zone.
3. Select **Create contest**, or use the pencil on a contest to change its schedule.

A schedule change leaves the intake mode alone. A contest that you hold open by hand stays open until you select **Return to schedule**.

If a time does not exist in the event's zone, because clocks move forward, Minsky uses the first minute after the gap. If it occurs twice, Minsky uses the earlier one.

## Time awards for the whole contest

The jury can give minutes to every contestant of a contest, for example after a network outage. Open **Award review** (console) or **Awards** (phone), enter the minutes and the reason, and select **Record the decision**. Staff apply the minutes in the external contest system, then support or jury select **Confirm applied externally**. Only confirmed minutes extend contestants' end times. See [Jury](/guides/jury/).

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

## Changes that affect live passwords

A live contest stays closed until every contestant seat has a password issued for it. These changes affect that state:

- **Assign an entrant, or add a sign-in, while reporting is open.** Minsky asks first and names the number of teams. If you confirm, reporting closes for every team, and Minsky opens the password sheet. Reporting opens again when the last password is issued.
- **Move a contest.** If the new time no longer overlaps the time that the passwords were issued for, those passwords no longer count, and the contest waits for new ones. An end extension, or a shift that still overlaps, keeps them. If the move would stop a contest that should still be running, Minsky refuses it. Close reporting first.
- **Issue a password for a later contest.** If the person holds a password for a live contest that has not ended, the preview says "These passwords stop working for" and names the contest. Reissue for that contest later.
- **Two open contests block a reset.** Close one contest, then issue the password.
- **Roll back the Worker.** After a rollback, live contests open without this check. Close live contests before a rollback.
