---
title: Manage a contest
description: Reset passwords, change usernames, edit team locations and categories, control intake, set image limits, and download the archive of one contest.
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

A contest admin can reset an account only when that account has no event or site authority, sits in at least one contest, and sits only in contests that you administer. An event admin can reset every other account of the event.

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

Intake opens at the contest's start and closes at its end plus the grace period. An event admin [sets the schedule](/guides/event-admin/#create-contests).
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

## Download the contest archive

The contest archive is one zip file that holds the support record of one contest and its images. Keep a copy outside Minsky before a webmaster deletes the event. After a deletion starts, nobody can read the event, so nobody can download its archives.

Contest admins, event admins, and webmasters can download the archive. Other staff cannot. If the site setting **Webmasters read contest data only after joining** is on, a webmaster must join the contest first. You can download the archive at any time, also while the contest runs. If staff work in the contest during the download, the archive can hold some rows from before a change and some from after it. Download it after the contest ends for a consistent record.

Use the desktop console. The phone app has no archive button.

1. Open the archive control:
	- As a contest admin, open **Session settings** in the console. The **Archive** panel is at the bottom.
	- As an event admin or a webmaster, open [the event console](/guides/event-admin/) and select the **Contests** tab. Each contest has its own button.
2. Select **Download archive**. The browser reads the record, then downloads the images, three at a time. The text under the button counts the images.
3. Keep the page open until the text says **Archive downloaded**. The browser then saves a file such as `minsky-xxxx-2026-final-round-20261108.zip`.

The browser builds the zip file on your device, so a contest with many images needs free space and memory on that device. A contest with more than 4 GB of images cannot go into one archive. A contest with more than 65,000 files cannot either. The button then shows an error before it downloads any image.
If an image cannot be downloaded, or its bytes do not match the stored checksum, the archive leaves that image out and still downloads. The text under the button says how many images are missing. `manifest.json` and `README.txt` name each one. Select **Download archive** again to try once more.

The archive has two folders. The folder names say who may read the content.

| Path | Content |
| --- | --- |
| `README.txt` | What each file holds, the export time, and the format version. |
| `manifest.json` | The format version, counts for each kind of record, every file with its size and SHA-256 checksum, and the images that are missing. |
| `staff-only/record.json` | The complete record in JSON: issues, replies, internal notes, resolutions, awards, contest-wide awards, announcements, image details, members, and the whole administration audit. Withdrawn awards, removed announcements, and removed images stay in it. |
| `staff-only/log.html` | The same record as one page that a browser opens. Internal notes carry the label **Staff note**. |
| `staff-only/issues.csv`, `staff-only/awards.csv` | One row for each issue, and one row for each award, for a spreadsheet. |
| `staff-only/images/` | The staff-only images, in one folder for each issue. |
| `staff-only/announcements/` | The images of removed announcements. |
| `contestant-visible/teams/<team folder>/log.html` | Only what that team could see: its public replies and public timeline, resolutions, and issue awards that were not withdrawn. The log also holds the confirmed contest-wide awards and the announcements that were not removed, because every team saw them. Each team has one folder, even a team with no issues. |
| `contestant-visible/teams/<team folder>/images/` | The team-visible images of that team's issues, in one folder for each issue. |
| `contestant-visible/announcements/` | The images of announcements that were not removed. Every team log links to them. |

The name of a team folder is a short form of the team name, a hyphen, and the first 8 characters of the team ID. `README.txt` lists each team folder with the team name and location.

The `staff-only` folder holds internal notes. Do not give it to contestants. To give a team its record, copy the `contestant-visible` folder. In the copy, delete the folders of the other teams from the `teams` folder. Keep the `announcements` folder, because the team log links to its images.

The archive names each member with a name and a username. It has no passwords and no profile pictures. A removed image appears only as a row with who removed it and when, because Minsky deleted its file.

## Check recent activity

**Recent administration activity** lists the latest administration actions with the actor and the time. Open it on **Accounts** in the console, or on the **Session** tab of a phone.

## Related tasks

Contest admins also do this work:

- [Post announcements](/guides/announcements/).
- [Reply to teams and resolve issues](/guides/staff/). A contest admin with no other role can reply, write internal notes, add images, and resolve a claimed issue. Claiming, handing off, and reopening need the Volunteer or Specialist role. Accepting a handoff needs the Specialist role.

The jury [gives time to a whole contest](/guides/jury/#give-time-to-the-whole-contest).
