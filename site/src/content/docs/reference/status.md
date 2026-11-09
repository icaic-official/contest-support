---
title: Feature status
description: What works now, what is not built, and what is not verified.
---

Checked on **7 November 2026** against `main` at `7db8fff`. This page records a reading of the code on that date. It does not record a test run.

No production installation exists.

## What works now

These features are in `main`:

- **Site and events.** One installation hosts many events. Webmasters create events and manage webmasters. Each event has one time zone, its own accounts, and its own event code.
- **Event deletion.** A webmaster deletes a whole event permanently after a typed confirmation. This was added after the check above.
- **Event console.** Event admins create contests, people, and entrants. They assign entrants and staff to contests, and issue credentials on printable sheets.
- **Accounts.** Organizers create usernames and temporary passwords. Each person changes the temporary password at the first sign-in. Organizers reset lost passwords.
- **Contests.** Each contest has a type, a kind, and a schedule. Intake follows the schedule, with a grace period and a hand override.
- **Live contests.** A live contest stays closed until every sign-in has a password issued for that contest.
- **Issues.** The lifecycle has a timer, handoffs, resolutions, and reopening. Public replies and internal notes are separate.
- **Awards.** The jury records issue awards and contest-wide awards. Staff confirm each award separately after they apply it in the external contest system. Confirmed minutes extend a contestant's end time.
- **Images.** Staff upload images with a fixed visibility, within limits for each contest.
- **Announcements.** Contest admins and jury publish announcements with images.
- **Contest archive.** Admins download one zip file with a contest's record and images. This was added after the check above.
- **Other tools.** The app has team search, jury award lists, a calendar, and profile pictures.
- **Interfaces.** The app has a contestant app for phones and laptops, a staff phone app, and a staff console.
- **Backend.** Cloudflare is the only backend. It uses one Worker, D1, private R2, and a Durable Object.

## What is not built

These features do not exist:

- Deleting one contest, one person, or one entrant. A webmaster can delete only a whole event.
- A control that makes an event read-only. Only an event deletion sets the read-only state.
- A screen that changes an event's name, code, or time zone.
- Importing a roster from a file. The event console takes pasted lines.
- Configurable roles.
- Linked reports for recurrences and duplicates, affected-team rosters for shared incidents, and awards with recipient exceptions.
- Browser push notifications.
- Email. Minsky sends none.
- Image uploads by contestants.
- Offline capture and venue-local operation.
- Another hosting provider or a container package.

## What is not verified

These claims have no evidence yet:

- Live-contest use.
- Capacity for 800 simultaneous users, ordinary actions within two seconds for 95% of requests, and live updates within three seconds.
- The current installation procedure on a fresh hosted installation. See the [verification limit](/operators/installation/).
- Webmaster recovery and the upgrade procedure on a hosted installation.
- Announcements and their images on a hosted installation.
- The contest archive on a hosted installation, and for a contest with many images.
- Live updates in the [complete local run](/contributing/development/#run-the-complete-app-locally).

Minsky needs a network connection.

Before you rely on an installation, record its source revision and verification results.

## License

The code uses the Apache License 2.0. The documentation uses CC BY 4.0. See the repository README.
