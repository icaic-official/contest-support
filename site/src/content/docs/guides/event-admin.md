---
title: Set up an event
description: Create contests and schedules, create accounts, assign people, issue credentials and sheets, and open each contest.
---

An event admin runs one event. A webmaster can do the same work in every event.
A contest admin cannot create accounts, assign people, or change a schedule.

## Open the event console

If your event has no contest yet, Minsky opens the console after you sign in. It starts on **Contests**.
Otherwise, select **Event console** in the console sidebar or on the **Session** tab of a phone, or go to `/event`.

The console has four tabs: **People**, **Entrants**, **Contests**, and **Assignments**.
Work through the sections below in this order.

## Create a contest

1. Select **Contests**.
2. Enter the **Contest name**.
3. Choose the **Contest type**: **Teams**, **Single contestants**, or **Teams and single contestants**.
4. Choose the **Contest kind**. A **Practice** contest follows its schedule. A **Live** contest stays closed until every sign-in has a live password. You cannot change the kind later.
5. Enter the **Start date**, **Start time**, **End date**, and **End time**. Enter each time as it reads on a clock in the event's zone. The form names the zone.
6. Enter **Grace after the end (minutes)**, a whole number from 0 to 240.
7. Select **Create contest**.

If a time does not exist in the event's zone because clocks move forward, Minsky uses the first minute after the gap. If a time occurs twice, Minsky uses the earlier one.

A new contest has one category, **General**, and the default image limits. A contest admin [changes them](/guides/administration/).

## Change a contest

1. Select the pencil button on the contest.
2. Change the **Name**, the **Type**, or the schedule.
3. Select **Save contest**.

Minsky refuses a type that excludes an entrant already in the contest. Remove that entrant first.
A schedule change leaves the intake mode alone. A contest that a contest admin holds open by hand stays open until that admin selects **Return to schedule**.

## Import entrants

An entrant is a team or a single contestant. A team shares one sign-in. A single contestant has their own.

1. Select **Entrants**.
2. Under **Kind**, choose **Team** or **Single contestant**.
3. Paste one line for each entrant, in the form `name, username`, for example `Team Aurora, team-aurora`. Minsky reads the text after the last comma or tab as the username, so a name can hold commas.
4. Fix each line that Minsky marks as a problem.
5. Select **Import entrants**. One import takes up to 300 lines.
6. [Share the credentials](#share-credentials).

A username has 3 to 32 lowercase letters, digits, hyphens, or underscores, and starts with a letter or digit. It is unique in the event.
An entrant's name is also unique in the event. To change it, select the pencil button. The new name shows in every contest of that entrant.
No screen changes an entrant's username.

## Add people

Staff and volunteers each have a personal account.

1. Select **People**.
2. Paste one line for each person, in the form `name, username`, for example `Sam Lee, sam-lee`.
3. Select **Create people**.
4. [Share the credentials](#share-credentials).

To make a person an event admin, switch on **Event admin** beside the person.
To change a person's username, select the pencil button. The password and open sessions stay.

## Assign entrants to a contest

1. Select **Assignments**, and choose the **Contest**.
2. Under **Not yet in this contest**, select the entrants. The list shows only the entrants that fit the contest type. **Select all** picks the first 300.
3. Enter the **Location for the selected entrants**, for example a hall or a table.
4. Select **Assign selected entrants**.

One assignment takes up to 300 entrants. An entrant can enter several contests.

To take an entrant out of a contest, select **Remove** beside the entrant. Minsky refuses while the entrant has an issue in that contest.

## Assign staff to a contest

1. Select **Assignments**, and choose the **Contest**.
2. In the staff panel, pick roles for a person: **Volunteer**, **Specialist**, **Jury**, **Contest admin**, or several of these. The person receives the capabilities of each role.
3. Select **Assign**. The button names the roles that you picked.

To change a person's roles, pick again and select **Update**. To take a person out of the contest, select **Remove**. History still names the person.
Minsky does not reassign the issues that the person owns, and no one else can claim them. For each claimed issue, assign the seat again, or ask a contest admin to resolve the issue.
An event admin reaches every contest of the event without a seat.

## Share credentials

After you import entrants or create people, Minsky opens **Share these credentials securely**. It shows the sign-in link, each username, and each temporary password. Minsky issues eight accounts at a time and shows the progress.

Each password shows once. People change it at their first sign-in.

- **Copy all** copies the link and every row.
- **Print sheets** prints one card for each person. A card holds the sign-in link, the event code, the username, and the password.
- **Issue again** shows when a row reads "The password did not arrive." or "Not issued." Select it to issue those rows again.
- **Done** closes the sheet, and the passwords are then gone.

To issue a password after you close the sheet, use one of these controls:

- On **People**, select **Reset password**, or **Issue password** for a person who shows **Needs a password**.
- On **Entrants**, select **Password** beside the entrant.

A reset stops the current password for everyone who shares it and ends every open session of that account.

## Issue live passwords

A live contest stays closed until every sign-in in it has a password issued for that contest. **Open now** cannot open it earlier.

1. Create the contest with the kind **Live**.
2. Assign its entrants. The contest on the **Contests** tab shows "Waiting for live passwords" with a count and the names.
3. Select **Issue live passwords for**, followed by the contest's name. The panel names any overlapping live contests that these passwords also open.
4. Print or share the sheet. When the count reaches zero, the panel disappears and the contest follows its schedule.

A person's own password change keeps the contest ready. A reset by staff closes the contest until that person has a new password.

### Changes that affect live passwords

These changes affect a live contest:

- **Assign an entrant, or add a sign-in, while reporting is open.** Minsky asks first and names the number of teams. If you confirm, reporting closes for every team, and Minsky opens the password sheet. Reporting opens again when the last password is issued.
- **Move a contest.** If the new time no longer overlaps the time that the passwords were issued for, those passwords no longer count, and the contest waits for new ones. An end extension, or a shift that still overlaps, keeps them. If the move would stop a contest that should still be running, Minsky refuses it. Close reporting first.
- **Issue a password for a later contest.** If the person holds a password for a live contest that has not ended, the preview says "These passwords stop working for" and names the contest. Reissue for that contest later.
- **Reset while two contests are open.** Minsky refuses a reset that would sign a contestant out of an open contest that the reset does not name. Close one contest, then issue the password.

## Open a contest

The console manages the whole event. The **Contest** field on **Assignments** chooses only the contest that the tab edits.

To work inside a contest, select **Open contests** at the top of the console. To change the contest after that, follow [Choose a contest](/guides/getting-started/#choose-a-contest).
In a contest, you work as a contest admin. See [Manage a contest](/guides/administration/).

## What the console does not do

These actions have no control in Minsky:

- Delete an event, a contest, a person, or an entrant.
- Archive an event.
- Change the event's name, code, or time zone.
- Import a file. The console takes pasted lines only.

See [feature status](/reference/status/) for other limits.
