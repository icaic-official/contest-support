---
title: Manage a contest
description: Reset passwords, change usernames, edit team locations and categories, control intake, and set image limits for one contest.
---

A contest admin manages one contest. Event admins and webmasters can do the same work.
On a phone, use the **Session** tab. In the console, use **Accounts**, **Team locations**, and **Session settings**. These screens use "session" to mean a contest.

A contest admin cannot create accounts, assign people, or change the schedule. An event admin does that in [the event console](/guides/event-admin/).

## Reset a password

1. Confirm who is asking.
2. Open the account. On a phone, use the **Session** tab. In the console, select **Manage** on **Accounts**.
3. Select **Reset password**, and confirm.
4. Give the new temporary password to the person privately.

The reset signs the account out everywhere. History stays, and the account keeps its username.
You cannot reset your own password here. Use **Change password** on your account page.

A contest admin can reset an account only when that account has no event or site authority and when you administer every contest that it sits in. An event admin can reset every other account of the event.

Minsky refuses a reset that would sign a contestant out of another open contest. Close that contest first, or wait until it ends.

## Change a username

1. Open the account. On a phone, use the **Session** tab. In the console, select **Manage** on **Accounts**.
2. Enter the new username under **Change username**, and select **Change username**.
3. Tell the person their new username.

The password stays, and open sessions stay signed in.
This control exists for staff accounts only. A team's username stays fixed, because venue staff read it from the team's sign-in sheet.

## Change a team's location

1. Open **Team locations**. On a phone, it is on the **Session** tab.
2. Change the text in the team's row.
3. Select **Save**.

A contest admin cannot add, rename, or remove a team. An event admin does that in [the event console](/guides/event-admin/#import-entrants).

## Edit categories

Contestants choose a category when they report an issue. A new contest has one category, **General**.
Edit the list in **Session settings** in the console, or under **Categories** on the **Session** tab.

1. Type a new category in **New category** and press Enter.
2. Use the arrow buttons to change the order. Contestants see the list in this order.
3. Select **Save categories**.

Minsky saves the whole list at once. Keep at least one category. A category has 1 to 200 characters, and two categories cannot have the same name.
A category that an issue uses stays in the list and keeps its name, because the issue keeps that name. You can rename or remove a category that no issue uses.

## Control intake

Intake opens at the contest's start and closes at its end plus the grace period. An event admin [sets the schedule](/guides/event-admin/#create-a-contest).
A contestant's own end time is the contest's end plus the minutes that staff confirmed as applied. That contestant can report until the personal end time plus the grace period.

The **Contestant intake** panel shows the state in **Session settings** in the console and on the **Session** tab of a phone. It has these controls:

- **Open now** holds intake open until you close it or return it to the schedule.
- **Close now** holds intake closed in the same way.
- **Return to schedule** ends the hold. It shows only while you hold intake by hand.

**Open now** cannot open a live contest that waits for its passwords. See [Issue live passwords](/guides/event-admin/#issue-live-passwords).

Closed intake stops new contestant reports. Staff can still report for a team, and existing issues can still be reopened.

## Set image limits

Set these limits under **Issue images** and select **Save image limits**.

| Limit | Range | Default |
| --- | --- | --- |
| **Largest image** | 1 to 50 MB | 10 MB |
| **Images per issue** | 1 to 24 | 12 |
| **Total per issue** | 1 to 120 MB | 120 MB |

The total must be at least the size of the largest image. Lower limits do not remove existing images.
Uploads cannot be switched off.

## Check recent activity

**Recent administration activity** lists the latest administration actions with the actor and the time. Open it on **Accounts** in the console, or on the **Session** tab of a phone.

## Related tasks

Contest admins also do this work:

- [Post announcements](/guides/announcements/).
- [Reply to teams and resolve issues](/guides/staff/). A contest admin with no other role can reply, write internal notes, add images, and resolve a claimed issue. Claiming, handing off, and reopening need the Volunteer or Specialist role. Accepting a handoff needs the Specialist role.

The jury [gives time to a whole contest](/guides/jury/#give-time-to-the-whole-contest).
