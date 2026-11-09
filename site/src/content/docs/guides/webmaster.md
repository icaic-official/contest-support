---
title: Run the site as a webmaster
description: Sign in as a webmaster, manage webmasters, create events, give an event its admins, and delete an event permanently.
---

A webmaster runs the whole Minsky site. A webmaster belongs to no event and can do everything that an event admin can do in every event.
This guide is for webmasters. To build the contests, people, and teams of one event, see [Run an event](/guides/event-admin/).

## Before you start

You need these items:

- The address of your Minsky site, for example `https://minsky.example/`.
- A webmaster username and a temporary password. The operator who installed Minsky creates the first webmaster. See [Create the first webmaster](/operators/installation/#6-create-the-first-webmaster). A webmaster creates the others.

## Sign in

1. Open the site address, and select **Sign in**.
2. On the sign-in form, select **Site sign-in**. This form asks for no event code.
3. Enter your username and password, and select **Sign in**.
4. If the password is temporary, set a new password.

Minsky opens one of these pages:

- If you cannot read any contest yet, Minsky opens the **Site** page (`/site`).
- Otherwise Minsky opens the issue queue (`/issues`). To go to the **Site** page, select **Site** in the console sidebar, or in the **Session** tab on a phone. You can also type `/site` after the site address.

The **Site** page shows a calendar of the contests of every event, the **Events** list, any **Deletions**, the **Webmasters** list, and the **Site setting**.
The header shows **Your time**, which is the clock and time zone of your own device. Each event uses its own time zone.

## Create an event

Each event has one event code. People type the code, or open a link that holds it, to sign in. Choose a short code that people can read aloud.

1. On the **Site** page, select **Create event**.
2. Fill in the form:
	- **Event name**. At most 200 characters.
	- **Event code**. 3 to 40 lowercase letters, digits, or hyphens. It starts with a letter or a digit. Minsky changes capital letters to lowercase. Two events cannot have the same code.
	- **Time zone**. The form suggests your own zone. Choose a zone from the list, for example `Asia/Singapore`. Contest times show in this zone.
	- **First event admin, name** and **First event admin, username**. The username is 3 to 32 letters, digits, hyphens, or underscores, and starts with a letter or a digit.
3. Select **Create event**.

Minsky creates the event and the event admin's account, and shows **First event admin of** the event name. The dialog shows the sign-in link, the username, and the temporary password once. Give them to the event admin in person.

If a line under the **Events** list says that the event exists but its first admin has no password yet, select **Open console**. On the **People** tab, select **Issue password** for that admin.

You cannot change the name, the code, or the time zone of an event after you create it.

## Give an event more event admins

An event admin is a staff account of the event that can change everything in that event.

1. On the **Site** page, select **Open console** on the event.
2. On the **People** tab, create the person if the person has no account. See [Add people](/guides/event-admin/#add-people).
3. Switch on **Event admin** for that person.

To take event admin authority away, switch **Event admin** off. Minsky does not stop you from removing the last event admin of an event. You can always give the authority again from the event console.

You can open any event console and do everything that an event admin can do there. For example, reset the password of an event admin who cannot sign in. See [Recover a password](/guides/event-admin/#recover-a-password).

## Manage webmasters

Use the **Webmasters** list on the **Site** page.

To add a webmaster:

1. Select **Add**.
2. Enter the **Name** and a **Username**. The username follows the same rule as other usernames. No other webmaster can have it.
3. Select **Add webmaster**.

The dialog **Webmaster password** shows the new temporary password once. Give it to the webmaster in person.
If the password was not issued, the row shows **Needs a password**. Select **Issue password** on that row. If the password was issued but the page did not receive it, a line asks you to reset it. Use the key button on that row.

To reset the password of another webmaster, select the key button on that row, then **Reset password**. The old password stops working, and every open session of that webmaster ends. You cannot reset your own password here.

To remove a webmaster, select the remove button on that row, then **Remove**. The person loses site authority, and every open session of that person ends. The account stays. If you remove yourself, you stay signed in, but you lose the **Site** page.

Minsky refuses these removals:

- The removal of the last webmaster. The message is "The last webmaster cannot be removed."
- Your own removal, when no other webmaster has a password. Issue a password to another webmaster first.

## Read contest data

The **Site setting** card has one switch, **Webmasters read contest data only after joining**.

- **Off.** You read the issues and notes of every contest at once.
- **On.** You must join a contest before you read its issues and notes. The card **Contests to join** lists them. Select **Join** on a contest. The admins of that contest see your join in their audit.

The setting covers contest data only. While it is on, you can still manage accounts and schedules in an event console without a join.

## Delete an event permanently

Delete an event only when nobody needs its records. You cannot undo the deletion.

The deletion removes these items:

- Every contest and every account of the event.
- Every issue, reply, note, award, image, and announcement of the event.

It also signs out everyone in the event at once and stops a running contest. Only the name and the code of the event stay, in the site record.

The deletion does not wait for an export. Once it starts, nobody can read the event. To keep the records, first [download the archive of each contest](/guides/administration/#download-the-contest-archive) from the event console. The dialog links to the console.

1. On the **Site** page, find the event in the **Events** list and select **Delete event**.
2. Read the dialog. It names the number of contests and accounts that go.
3. Type the event name exactly as it shows. For an event with no name, type its event code.
4. Select **Delete event**. The button stays unavailable until the text matches.

The event leaves the **Events** list. Its progress shows under **Deletions**:

| Label | Meaning |
| --- | --- |
| **Deleting contests and accounts** | Minsky removes the records. The detail counts what is left. |
| **Closing live updates** | Minsky closes the live connections of each contest. |
| **Waiting for the final file check** | The records are gone. An upload that was in progress can still finish, so Minsky waits about an hour before the last file check. |
| **Removing files** | Minsky removes the images of the event. |
| **Deleted** | The deletion is complete. The record stays with the event code, who asked, and when. |
| **Stopped** | An account of the event also has activity in another event. Minsky keeps that account and tries again every hour. |

If a deletion shows **Stopped**, read [the operator steps for a stopped deletion](/operators/installation/#repair-an-event-deletion). Do not delete records by hand.

## Recover webmaster access

If you forget your password, ask another webmaster to reset it on the **Site** page.
If no webmaster can sign in, an operator runs `npm run cloudflare:recover-admin`. See [Recover the webmaster](/operators/installation/#recover-a-webmaster-password).
