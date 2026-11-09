# Product direction

This reference states what Minsky does, what it deliberately does not do, and what is agreed but not built.
Minsky is a support desk for contests. Contestants report issues, and staff claim, hand off, and resolve them while a timer runs.
[Frontend architecture](frontend-architecture.md) and [Cloudflare backend design](cloudflare-backend-design.md) describe the implementation. [ROADMAP.md](../ROADMAP.md) owns the technology stack.

The product names are Webmaster, Event, and Contest. The database and some code and UI labels keep the word `session` for a contest.

No production installation exists. Live-contest use and the [capacity targets](#capacity-targets) are not verified.

## What Minsky does

### People and authority

- One shared installation hosts the events of many organizers. Self-hosters run the same code.
- A webmaster runs the whole site and belongs to no event. A webmaster creates events, names the first event admin, and adds or removes webmasters. The last webmaster cannot be removed.
- By default, webmasters read all contest data. A site setting makes a webmaster join a contest before reading it, and the join is audited. Webmasters do not appear in contest member lists.
- An event has one time zone, its own accounts, its own event admins, and one or more contests. A username is unique only inside its event.
- Event admins and webmasters create accounts and assign entrants and staff to contests.
- A contest admin manages one contest. An event can have no contest admins. A contest admin changes intake, image limits, categories, team locations, and announcements, and reissues passwords and changes usernames for accounts that the contest admin may manage.
- A staff member can hold several roles and receives the combined capabilities of all assigned roles. The roles are Volunteer, Specialist, and Jury. Contest admin is a separate flag.
- Volunteers and specialists are support staff. Jury alone does not confer support membership.
- Any support staff member can start issue triage. This includes specialists and people with both roles.
- A contest admin with no other role can reply to a team, write internal notes, add images, and resolve an assigned issue. That admin cannot claim, hand off, accept, or reopen an issue. Those actions need the Volunteer or Specialist role.
- Minsky identifies staff owners and activity actors by person.
- Issue categories are configurable for each contest.

### Accounts and sign-in

- Organizers create usernames and temporary passwords, and they distribute the credentials securely. There is no self sign-up.
- A person signs in with an event code and a username. A webmaster uses **Site sign-in**.
- A person must change a temporary password before reading contest data. The database boundary enforces this rule, so a refresh or a direct API call does not bypass it.
- Recovery is organizer-assisted. An organizer verifies the person's identity and issues a new temporary password. Personal email and SMTP are not prerequisites.
- A team shares one sign-in. A single contestant has a personal sign-in. A person who competes alone in one contest and in a team in another has two sign-ins. Staff have individual accounts.
- A username change keeps the account ID, the password, the history, and the permissions.

### Contests, schedules, and intake

- A contest has its own type: teams, single contestants, or both. It also has its own entries, schedule, issues, categories, announcements, image limits, and awards.
- A contest is either practice or live.
- Intake follows the schedule. It opens at the scheduled start and closes at the scheduled end plus a grace period. Staff can override it by hand and return it to the schedule. A contest with no schedule uses the manual switch.
- A contestant's personal end time is the scheduled end plus the minutes that staff confirmed as applied. That contestant can report until the personal end time plus the grace period.
- A live contest stays closed until every contestant sign-in has a fresh live password. The manual override cannot open it earlier.
- A calendar shows each member the contests of their own events. Webmasters see every event.
- A webmaster can delete an event permanently, after a typed confirmation of its name, or of its code when it has no name. The deletion removes the event's records, files, and live data, and it cannot reach another event.
- An archived event permits reading only. Archived events are never deleted automatically. No screen or command sets the archived state.

### Issue timers and ownership

- Contestants and every staff member can report an issue. Closing intake stops new contestant reports. Staff reports and reopening continue.
- Minsky starts the issue timer on submission.
- Minsky records the first assignment separately.
- Minsky calculates elapsed time from persisted timestamps, so a refresh does not reset the timer.
- The current owner retains ownership during escalation until a specialist accepts the handoff.
- Minsky stops the timer on resolution.
- Contestants and support staff can reopen a resolved issue on the same issue.
- On reopening, Minsky resumes accumulated unresolved time and excludes resolved intervals. First-assignment delay stays separate.
- On reopening, Minsky retains the prior owner and any existing award and external application status.
- Minsky retains every resolution summary, actor, and timestamp.
- Repeated actions do not create duplicate awards or invalid transitions.

### Replies, notes, and activity

- Contestant-visible replies and internal staff notes are separate.
- Contestant views omit internal notes. The server omits them, and the contestant app filters them a second time.
- Minsky keeps a shared activity history that identifies the authenticated actor.

### Awards

- An award is separate from the issue. One authorized decision comes first, and confirmation of its external application is a separate record.
- Minsky records that confirmation and does not change an external contest clock. Confirmed minutes change only the reporting window in Minsky.
- Contestants see the decision and the application status.
- Awards stay discretionary. Minsky permits an explicit zero-minute decision with a public explanation, and it supports preset and custom amounts.
- A contest-wide time award gives minutes to every contestant of one contest, with no exceptions. Jury can withdraw one until staff confirm it.
- Jury-only members see resolved issues in the queue, and they can open a reopened issue that has a pending award.

### Images

- Staff can attach JPEG, PNG, and WebP images to an issue while the event is active. Each image records its uploader and time.
- The uploader chooses team visibility or staff-only visibility at upload. The default is staff-only, and that choice stays fixed.
- Only the uploader can remove a ready image while the event is active.
- Contest admins set the file size, image count, and combined size limits. There is no upload-disable control.
- Contestants can view only team-visible images on their own team's issues.
- Resolved issues keep their images. Archived events keep the files for preview and download.
- Images are in a private R2 bucket.
- An account can have one profile picture. The server returns staff pictures to staff only.

### Contest archive

- Contest admins, event admins, and webmasters can download one zip file that holds the support record of one contest and its images. A webmaster under the read restriction must join the contest first.
- The archive keeps every record: issues, public replies, internal notes, history, resolutions, issue awards and contest-wide awards with withdrawn ones, announcements with removed ones, image details in every state, members, and the whole administration audit.
- The file layout separates staff-only content from content that contestants could see. Contestant-visible files hold no internal notes, staff-only images, audit, withdrawn awards, or removed announcements.
- The archive is available at any time, also after the event is archived. It is not available after a deletion starts. The deletion does not wait for it, and the delete dialog points to the event console to download it first.
- The browser builds the zip file. See [Contest archive](event-platform-design.md#contest-archive) for the reason.

### Announcements

Contest admins and jury publish announcements for a contest. Every member reads the active ones above the issue workspace. See [session announcements](session-announcements.md).

### Team search and reports for a team

- Staff search the team names and locations of the current contest. The search matches text inside words from the first letter, letters typed in order, either word order, accents, small spelling mistakes, and whole table numbers.
- An empty search box lists the teams by name when staff click it. Suggestions show the unresolved-issue count. The queue filter combines with the status filter.
- Every staff member can report an issue for a team. The reporter can add several teams. Minsky then creates one issue per team, each with its own timer, owner, and award. The choice uses each team's database ID.
- Team codes, aliases, and institutions are not part of this search. A contestant does not get team search.

### Interfaces

- Staff and contestants get different UIs. The membership selects the UI after sign-in. All UIs share one design system, shadcn/ui with Tailwind CSS, and the same data hooks.
- Staff mainly use phones, so they get a phone-first app. At 1024 px and wider, they get a separate desktop console.
- Contestants get one responsive app. At 1024 px and wider it shows the report list beside the report. Below 1024 px it shows one screen at a time.
- The contestant home shows the contest clock, its end time, and the **Report an issue** button first, without scrolling. It works at 390 px and 320 px with no sideways scroll and with 44 px touch targets.
- On a phone, a bottom tab bar with **Report**, **My reports**, and **Account** reaches reporting in one tap from any screen. The bar hides while a person types.
- The report form and the reply box keep their send buttons in view when the on-screen keyboard is open.
- Event admins use the event console. Webmasters use the site dashboard. The desktop **Overview** page is the only reporting dashboard for a contest.

### Platform and verification

- Cloudflare is the only provider implementation. The shared backend contracts stay in `src/backend/contracts.ts`, so that a later provider can implement them. See [Add a backend provider](add-provider.md).
- The tests check D1 rules and transactions with local D1 emulation.
- Docker is optional.
- Privileged credentials stay outside Git and frontend builds.
- Provider access does not grant application membership.
- Cloud CI uses isolated fictional fixtures. Verification uses isolated fixtures and deletes only records that belong to those fixtures.

## What Minsky deliberately does not do

- It has no problems, submissions, judging, or scoreboard.
- It has no payment, plans, or public listing of contests.
- It has no local demo runtime, no persona switching or impersonation control, and no shared-data reset control in the connected product.
- It does not change an external contest clock.
- It does not let contestants upload images.
- It has no read-only state for one contest. Only a whole event becomes read-only.
- It has no helper zones, quick replies, floor map, configurable aging thresholds, or per-category icons and descriptions. These items need data that the schema does not hold.

Minsky needs a network connection. Offline capture, venue-local resilience, and a manual fallback are deferred, and they do not block cloud features.

## Agreed but not built

- An editor for the name, code, and time zone of an event.
- Role and permission administration.
- Linked reports. A recurrence would become a linked new report, and a duplicate would link to a canonical report.
- Shared incidents, with explicit affected rosters, selective closure of linked reports, and bulk awards with recipient exceptions.
- In-app alerts, and browser push that users explicitly enable.
- CSV file import for rosters. The event console takes pasted lines of `name, username`.

## Capacity targets

These are future targets on a healthy venue connection. They are unverified:

- 800 simultaneous users.
- 95 percent of ordinary actions complete within two seconds.
- Live updates arrive within three seconds.

No current check establishes these targets. A free-tier pilot does not establish production capacity.
