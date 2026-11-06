---
title: Run the site
description: Sign in as a webmaster, create events, manage webmasters, and control webmaster access to contest data.
---

A webmaster runs the whole site and belongs to no event.
A webmaster can also do everything that an event admin and a contest admin can do.

## Open the Site page

1. On the sign-in page, select **Site sign-in**. This form asks for no event code.
2. Enter your username and password, and select **Sign in**.

If you can open no contest, Minsky opens the **Site** page for you.
Otherwise, select **Site** in the console sidebar or on the **Session** tab of a phone, or go to `/site`.

The page lists the events, the webmasters, and the site setting. A calendar shows the contests of every event.

## Create an event

Choose the event's name, code, and time zone with care. No screen can change them after you create the event.

1. Select **Create event**.
2. Enter the **Event name**.
3. Enter the **Event code**. It has 3 to 40 lowercase letters, digits, or hyphens, and starts with a letter or digit. People type it when they open the plain sign-in page, so choose a code that is short and that people can read aloud.
4. Enter the **Time zone**, for example `Asia/Singapore`. The field starts with your device's zone. Every contest of the event uses this zone.
5. Enter **First event admin, name** and **First event admin, username**.
6. Select **Create event**.
7. Give the sign-in link, the username, and the temporary password to the event admin in person. Minsky shows the password once.

If the password does not arrive, the page says so. Select **Open console**, then select **Issue password** beside that person.

The event admin then [sets up the event](/guides/event-admin/).
To do that work yourself, select **Open console** on the event.

## Add a webmaster

1. Under **Webmasters**, select **Add**.
2. Enter the **Name** and the **Username**.
3. Select **Add webmaster**.
4. Give the sign-in page, the username, and the temporary password to the new webmaster in person. The new webmaster selects **Site sign-in** on that page.

A webmaster who shows **Needs a password** has no password yet. Select **Issue password** beside that webmaster.

## Reset a webmaster password

1. Select the key button beside the webmaster.
2. Select **Reset password** in the dialog. The current password stops working, and every open session of that webmaster ends.
3. Give the new temporary password to the webmaster in person.

You cannot reset your own password here. Use **Change password** on your account page.
If no webmaster can sign in, an operator follows [Recover a webmaster password](/operators/installation/#recover-a-webmaster-password).

## Remove a webmaster

1. Select the remove button beside the webmaster.
2. Select **Remove** in the dialog.

The person loses site authority, and every open session of that person ends. If you remove yourself, you lose site authority and stay signed in.
Minsky refuses to remove the last webmaster.

## Control webmaster access to contest data

By default, a webmaster can read every contest at once.
To change this, switch on **Webmasters read contest data only after joining**.

While the setting is on, a webmaster joins a contest before reading its issues and notes:

1. Under **Contests to join**, select **Join** beside the contest.
2. Minsky opens the contest.

The contest's admins see the join in **Recent administration activity**. The entry reads "Joined to read this contest" and names "A webmaster" when that webmaster holds no seat in the contest.

## What the site does not do

These actions have no control in Minsky:

- Delete an event.
- Archive an event.
- Change an event's name, code, or time zone.

See [feature status](/reference/status/) for other limits.
