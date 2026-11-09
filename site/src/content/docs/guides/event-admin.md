---
title: Run an event
description: Use the event console to create contests and schedules, add staff and entrants, assign them, issue passwords, print sheets, and recover passwords.
---

An event admin builds and runs one event in the **event console**. A webmaster can do the same in every event.
This guide follows the order in which you build an event. For the day-to-day settings of one contest, such as intake, categories, image limits, and team locations, see [Manage a contest](/guides/administration/).

## Before you start

You need these items:

- The sign-in link of your event, for example `https://minsky.example/?event=xxxx-2026`, your username, and your temporary password. A webmaster gives them to you when the webmaster creates the event. See [Create an event](/guides/webmaster/#create-an-event).
- The list of your contests, with their start times, end times, and grace periods.
- The names of your staff, teams, and single contestants, and a username for each.

## Open the event console

1. Open the sign-in link, and sign in. See [Sign in](/guides/getting-started/).
2. If the password is temporary, set a new password.

If the event has no contest yet, Minsky opens the event console (`/event`).
Otherwise Minsky opens the issue queue. Select **Event console** in the console sidebar, or in the **Session** tab on a phone. You can also type `/event` after the site address.

The console has four tabs: **People**, **Entrants**, **Contests**, and **Assignments**. An event with no contest opens on **Contests**.
Contest times show in the time zone of the event. If your device uses another zone, the console also shows the time on your device.

## Usernames

Every account signs in with a username. The sign-in form labels it **Username**.

- A username has 3 to 32 letters, digits, hyphens, or underscores. It starts with a letter or a digit.
- Minsky stores usernames in lowercase.
- Two accounts of the same event cannot have the same username. This includes staff and entrants.
- An account of another event can use the same username, because each event has its own event code.

## Create contests

1. Select the **Contests** tab.
2. Under **Create a contest**, fill in the form:
	- **Contest name**. At most 200 characters.
	- **Contest type**. **Teams**, **Single contestants**, or **Teams and single contestants**. Only entrants of a fitting kind can join the contest.
	- **Contest kind**. **Practice**, or **Live: closed until every sign-in has a live password**. See [Issue live passwords](#issue-live-passwords). You cannot change the kind later.
	- **Schedule**. The **Start date**, **Start time**, **End date**, **End time**, and **Grace after the end (minutes)**. Enter the times as a clock in the event's time zone shows them. The grace is a whole number from 0 to 240.
3. Select **Create contest**.

The contest shows in the **Contests** list with its kind, type, schedule, and intake state, for example **Intake opens later**.
A new contest has one category, **General**. A contest admin changes the categories and limits later. See [Manage a contest](/guides/administration/).

Intake opens at the start. It closes at the end plus the grace period. A contestant's own end time also includes the extra minutes that staff confirmed as applied.

If a time does not exist in the event's zone, because clocks move forward, Minsky moves the time forward by the length of the gap. For example, 02:30 in a gap from 02:00 to 03:00 becomes 03:30. If a time occurs twice, Minsky uses the earlier one.

### Change a contest

1. Select the pencil button on the contest.
2. Change the **Name**, the **Type**, or the schedule. A contest without a schedule shows **Add a schedule**.
3. Select **Save contest**.

A contest keeps its entrants when its name changes. To change the type to one that excludes some entrants, remove those entrants first.
A schedule change does not change an intake that a contest admin holds open or closed by hand.

## Add people

People are staff accounts: volunteers, specialists, jury, contest admins, and event admins.

1. Select the **People** tab.
2. In **People, one per line: name, username**, type or paste one line for each person, for example `Sam Lee, sam-lee`. The username follows the last comma or tab, so a name can contain commas.
3. Fix each line that the form marks. The button stays unavailable until every line is correct.
4. Select **Create people**.

Minsky creates the accounts and opens the credential sheet. See [Share passwords and print sheets](#share-passwords-and-print-sheets).
If the request fails, the text stays in the box, so you can try again.

To make a person an event admin, switch on **Event admin** on that person's row. Switch it off to take the authority away.
An entrant sign-in cannot be an event admin.

To change a staff username, select the pencil button on the row, enter the new username in **Change username**, and select **Change username**. The password stays, and open sessions stay signed in. Tell the person the new username.

## Import entrants

An entrant is a team or a single contestant. Each entrant has one sign-in. A team shares that sign-in.

1. Select the **Entrants** tab.
2. Under **Kind**, select **Team** or **Single contestant**. One import uses one kind.
3. In **Entrants, one per line: name, username**, type or paste one line for each entrant, for example `Team Aurora, team-aurora`.
4. Select **Import entrants**.

Minsky creates the entrants and their sign-ins, and opens the credential sheet. Two entrants of the event cannot have the same name.

To rename an entrant, select the pencil button, enter the name, and select **Save name**. The new name shows in every contest of the entrant.
An entrant without a sign-in shows **Add sign-in**. Select it, enter a username, and select **Set username**. Minsky then issues the password.

You cannot change the username of an entrant sign-in in the interface. A team cannot change it either. If a sign-in sheet is lost, reset the password instead. See [Recover a password](#recover-a-password).

## Assign entrants and staff

1. Select the **Assignments** tab.
2. Select the contest in **Contest**.

### Assign entrants

1. Under **Not yet in this contest**, select the entrants. **Select all** selects up to 300 entrants.
2. In **Location for the selected entrants**, enter where they sit, for example a room and table. All the selected entrants get the same location. A contest admin can change it later.
3. Select **Assign selected entrants**.

One assignment takes at most 300 entrants. Assign them, then select the next group.
To take an entrant out of a contest, select **Remove** on its row. Minsky refuses this when the entrant has an issue in that contest. History keeps the issue.

If you assign entrants to a live contest while reporting is open, Minsky asks first. Select **Assign and close reporting** to continue. Reporting closes for every team until the new sign-ins have passwords. Minsky opens the credential sheet next.

### Assign staff

Every person of the event shows under **Staff in** the contest name.

1. On a person's row, select one or more roles: **Volunteer**, **Specialist**, **Jury**, and **Contest admin**.
2. Select **Assign**. For a person who is already in the contest, select **Update**.

To take a person out of the contest, select **Remove**. History still names the person.
Event admins reach every contest without an assignment. Without a role, an event admin can resolve issues, post announcements, and change contest settings. To claim, hand off, or reopen issues, or to record awards, an event admin also needs a role. See [Time awards and extra time](#time-awards-and-extra-time).

## Share passwords and print sheets

A new account has no password. Minsky issues passwords after you create people or entrants, and when you select **Issue password**, **Reset password**, or **Password**.
Minsky issues eight accounts at a time. A progress bar shows the count while it works.

The sheet **Share these credentials securely** shows the sign-in link and each person's name, username, and temporary password. Each password shows only once.

1. Wait until Minsky finishes. You cannot close the sheet while it works.
2. Share the passwords in one of these ways:
	- Select **Print sheets**. Minsky prints one card for each person. A card shows the sign-in link, the event code, the username, the password, and "Change this password when you first sign in."
	- Select **Copy all** to copy the link and every row as text.
	- Select the copy button on one row.
3. Select **Done**.

If a row says "The password did not arrive." or "Not issued.", select **Issue again**. Minsky issues new passwords for those rows only.
If you close the sheet before you share a password, issue a new one. A person who shows **Needs a password** on the **People** tab has none yet.

Each person changes the temporary password at the first sign-in.

## Issue live passwords

A live contest stays closed until every sign-in in it has a password issued for that contest. **Open now** cannot open it earlier.

1. Create the contest with the kind **Live**.
2. Assign its entrants. The contest row shows **Waiting for live passwords** with a count and the names.
3. Read the row. **These passwords also open** names other live contests of the same entrants whose times overlap. **These passwords stop working for** names a live contest whose current passwords stop working.
4. Select **Issue live passwords for** the contest name.
5. Print or share the sheet.

When the count reaches zero, the row disappears, and the contest follows its schedule.

These changes affect a live contest:

- **A password change by the person.** The contest stays ready.
- **A reset by staff.** The reset names one contest, and the new password counts for it. Other live contests of that sign-in that have not ended close until you issue a password for them again. The dialog names them under **These passwords stop working for**.
- **A new entrant or a new sign-in while reporting is open.** Minsky asks first and names the number of teams. If you confirm, reporting closes for every team, and Minsky opens the credential sheet. Reporting opens again when the last password is issued.
- **A moved contest.** If the new times no longer overlap the times that the passwords were issued for, the passwords no longer count, and the contest waits for new ones. An end extension, or a move that still overlaps, keeps them. If the move would stop a contest that should still be running, Minsky refuses it. Close reporting first.
- **A password for a later contest.** If the person holds a password for a live contest that has not ended, Minsky names it under **These passwords stop working for**. Issue for that contest again later.
- **A Worker rollback.** After an operator rolls back the Worker, live contests open without this check. Close live contests before a rollback.

## Time awards and extra time

Minsky records awards and confirmations. It does not change the clock of the external contest system.

- Only staff with the **Jury** role record an award, for an issue or for the whole contest. An event admin without that role cannot.
- Staff with the **Volunteer**, **Specialist**, or **Jury** role select **Confirm applied externally** after they apply the minutes in the external contest system.
- Staff with the **Jury** role can withdraw an award that nobody has confirmed. A withdrawn award adds no minutes, and its issue cannot take another award. For the steps, see [Withdraw a wrong issue award](/guides/jury/#withdraw-a-wrong-issue-award).
- A contestant's end time grows only by confirmed minutes. The contestant can report until that end time plus the grace period.

To record or confirm awards yourself, assign yourself the role on the **Assignments** tab. A webmaster belongs to no event, so a webmaster cannot take a role this way. For the steps, see [Record time awards](/guides/jury/).

## See the calendar

The calendar lists the scheduled contests of your event for seven days. It groups them by day in the event's time zone, and shows each contest's intake state.

- In the console, open your account settings and look under **Sessions**.
- On a phone, open the **Me** tab.

Select **Previous week**, **Next week**, or **Today** to move. Select **Open** to switch to a contest. A contest without a schedule does not show.
Webmasters see the contests of every event on the **Site** page.

## Download contest archives

On the **Contests** tab, each contest has a **Download archive** button. It saves one zip file with the contest's issues, replies, internal notes, awards, announcements, and images. The button works also after the event is archived. See [Download the contest archive](/guides/administration/#download-the-contest-archive) for the contents and the limits.

## Recover a password

Minsky sends no email. A person who forgets a password asks an organizer.

1. Confirm who is asking. For a team, check the team at its location.
2. In the event console, reset the password:
	- For staff, select **Reset password** on the **People** tab.
	- For an entrant, select **Password** on the **Entrants** tab.
3. Read the dialog, and select **Reset password**.
4. Give the new temporary password privately, or print the sheet.

The old password stops working at once, for everyone who shares it. Every open session of the account ends. The account keeps its username and history.

Minsky refuses a reset that would sign a contestant out of an open contest that the reset does not name. A reset from the **Entrants** tab names one contest of the entrant: an open live contest first, then the next live contest, then any other open contest. If the contestant is in a second open contest, close it first, or wait until it ends.

An event admin can reset every account of the event, also the other event admins. Only a webmaster can reset a webmaster.
A contest admin can also reset some accounts from the contest console. See [Reset a password](/guides/administration/#reset-a-password).

## What you cannot change here

The event console has no control for these changes:

- The name, the code, or the time zone of the event.
- The kind of a contest.
- Any change while the event is being deleted. Every control is then unavailable.
- The deletion of a contest, a person, or an entrant. A webmaster can delete the whole event. See [Delete an event permanently](/guides/webmaster/#delete-an-event-permanently).
