---
title: Sign in
description: Get your account, change your temporary password, choose a contest, and set a profile picture.
---

## Sign in the first time

Your organizer gives you a sign-in link, a username, and a temporary password.
The link looks like `https://minsky.example/?event=xxxx-2026`. The part after `event=` is your event code.
There is no public registration.

1. Open the sign-in link. The form already shows your event code.
2. Enter your username and the temporary password, and select **Sign in**.
3. Enter the temporary password again, and choose a new password of 12 to 128 characters. You cannot see contest data until you do.

The device remembers the event code for the next sign-in. If the form shows no code, type the code from your sign-in details.
A wrong event code, username, or password gives the same message. Check all three with your organizer.

A team shares one account. A single contestant has their own account. Each staff member has a personal account, so the history shows who acted.

Webmasters run the whole site and belong to no event. A webmaster selects **Site sign-in** on the sign-in page, which asks for no event code. See [Run the site as a webmaster](/guides/webmaster/).

## Choose a contest

Each contest has its own teams, issues, and awards. Some screens call a contest a session, for example **Contest session** and **Session settings**.

If you can open more than one contest, select the contest in one of these places:

| You use | Control |
| --- | --- |
| The contestant app | The contest menu in the top bar |
| The staff console | The menu at the top of the sidebar |
| The staff phone app | **Contest session** on the **Me** tab |
| The account page in the console or the contestant app | **Switch** under **Sessions** |

The list shows the contests in the order of their start times. A contest with a schedule shows its start time in the event's time zone. The start time shows the year only when your contests start in different years.

Intake is the time when contestants can send new reports. A note under the name says what the contest does now: "Running now", "Intake open (grace period)", "Intake open (set by staff)", "Intake closed (set by staff)", "Waiting for live passwords", or "Ended". A contest that has not started has no note, because its start time says it. Two cases get a note anyway: staff hold its intake open or closed, or it waits for live passwords. The note of the contest that is running now is in heavier text. A contestant's note counts the extra minutes that staff confirmed for that contestant, so a contest can say "Running now" for you after its scheduled end.

Minsky opens the contest whose intake is open. If no intake is open, it opens the first contest that has not ended. If every contest has ended, it opens the one that ended last. The address of the browser tab keeps your choice, so a reload keeps it. In that tab, Minsky uses that choice only for your account. When another person signs in on the same browser tab, Minsky opens a contest for them by the rules above. This is also true after Back, after a reload, and after your contest ends. If nobody else signed in on that tab since, Minsky opens your choice when you sign in again. A link that names a contest opens that contest for the person who signs in, if that person belongs to it. A Minsky page that someone opens in a new tab or window counts as such a link.

An account with no contest sees **Session access** and no data. Ask your organizer to assign you, and then select **Refresh access**.

## Read the calendar

The calendar lists the scheduled contests of your event for seven days, grouped by day in the event's time zone. Staff on a phone find it on the **Me** tab. Everyone else finds it under **Sessions** on the account page.

- **Open** switches to a contest that you can open.
- "You have no seat here" marks a contest that you cannot open.
- **Today** returns to the current seven days.

Webmasters see every event on the **Site** page.

## Find your screens

| You are | Screen |
| --- | --- |
| Contestant, window under 1024 px | One screen at a time, with tabs at the bottom |
| Contestant, window 1024 px or wider | Your reports beside the open report |
| Staff, window under 1024 px | Phone app with tabs at the bottom |
| Staff, window 1024 px or wider | Console with a sidebar |

Your roles decide the tabs and pages. Several roles combine.

| Role | Phone tabs | Console pages |
| --- | --- | --- |
| Volunteer or specialist | **Queue**, **Mine**, **Find**, **Me** | **Queue**, **Assigned to me**, **Handoffs**, **Teams & tables** |
| Jury | **Awards**, **Find**, **Me** | **Award review**, **Teams & tables** |
| Contest admin | **Queue**, **Find**, **Session**, **Me** | **Queue**, **Teams & tables**, **Overview**, **Accounts**, **Team locations**, **Session settings** |

The account page shows a contest admin as **Session admin**.
An event admin or a webmaster works as a contest admin in a contest. These people also see **Event console**, and a webmaster also sees **Site**. See [Run an event](/guides/event-admin/) and [Run the site as a webmaster](/guides/webmaster/).

To reach your account settings, use one of these controls:

- In the console, select your name at the bottom of the sidebar.
- In the staff phone app, select **Me**.
- In the contestant app on a laptop, open the account menu at the top right and select **My account**.
- In the contestant app on a phone, select **Account**.

These addresses open a section directly, and you can bookmark them:

| Address | Section |
| --- | --- |
| `/issues` | The queue, or your reports as a contestant |
| `/jury` | Award review |
| `/administration` | Contest administration |
| `/account` | Account settings |
| `/event` | Event console |
| `/site` | Site page |

Opening a section asks you to sign in when needed and checks your permissions.

## Set a profile picture

Your picture shows next to your name, for example on the issues that you own.
Staff see the pictures of the other staff in the same contest. A team account sees only its own picture.

1. Open your account settings.
2. Select **Change picture**. On the account page you can also select your avatar at the top.
3. Choose a JPEG, PNG, or WebP image of up to 2 MB. On a phone you can take a photo. Minsky does not accept HEIC, so export an iPhone photo as a JPEG first.
4. Check the preview. Minsky uses the middle square of the image and shows it as a circle.
5. Select **Save picture**.

Minsky saves a smaller copy of the image. The copy has no location or camera data.
If the save fails and the button reads **Try again**, select it. Minsky does not save a second picture.

To remove your picture, select **Remove picture** and confirm. Your initials show instead.
The picture belongs to your account, so it is the same in every contest.

## Change your username

Staff can change their own username on the account page, in the **Username** field. Your password stays, and you stay signed in. Use the new username at your next sign-in.

A team account cannot change its username, because venue staff read it from the team's sign-in sheet.
An account on a team in any contest cannot change its username either. A webmaster has no control for this.

## Forgot your password

Ask your organizer. They check your identity and give you a new temporary password.
Minsky sends no email. Your history stays linked to your account.

If no webmaster can sign in, an operator follows [Recover a webmaster password](/operators/installation/#recover-a-webmaster-password).
