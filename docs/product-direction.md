# Product direction

This document preserves the agreed direction from [PLAN.md](../PLAN.md).
Only requirements listed in [run log](history/run-log.md) describe implemented behavior.
The user selects later scope after feedback on the development installation.

Interface decision (2026-10-17): organisers and contestants get different UIs. This is not one layout with parts hidden.
Organisers mainly use phones, so they get a phone-first app. At 1024 px and wider, they get a separate desktop console.
Contestants use computers and get a desktop app. There is no contestant phone layout.
The membership selects the UI after sign-in. A membership with a team gets the contestant app.
All UIs share one design system, shadcn/ui with Tailwind CSS, and the same data hooks.
[T0015](history/tickets.md#t0015--organiser-and-contestant-frontend-redesign) implements this decision. It replaces the sidebar workspace from the 2026-10-02 decision below.
The T0015 jury award lists replace the separate T0009 worklist screen.
Mockup items that need new data stay out of scope: helper zones, quick replies, a floor map, configurable aging thresholds, and category icons.

Jury worklist status (2026-10-18): [T0009](history/t0009-jury-worklist.md) merged in PR #23 at `c144a2a`.
It uses authorized `Backend` snapshots and existing workflow actions for decisions and external confirmations.
Its maintenance ran in a separate worktree alongside T0020.
The active Cloudflare installation preserves the combined application. Verification applies only to its recorded source and provider.

Team-search status (2026-10-15): [T0008](history/tickets.md#t0008--fuzzy-team-search) merged into `main` in PR #22.
Staff search the current session's team names and locations from the issue queue.
Staff use the same search to choose a team before they report an issue.
The T0005 branch includes the accepted search through a merge from `main`.
Deployment waits for an explicit request after review.

Issue-image decision (2026-10-11): [T0005](history/tickets.md#t0005--issue-images) adds issue images.
Staff attach JPEG, PNG, and WebP images to an issue.
The uploader chooses team-visible or staff-only visibility at upload.
The default is staff-only, and the choice stays fixed.
Session admins set the file size, image count, and combined size.
Provider ownership records, GitHub merge enforcement, and remaining manual acceptance checks stay deferred.
They are not part of T0005.

Implemented interface decision (2026-10-02): provide a public login landing page and a sidebar for the authenticated workspace.
The user removed the old local demo, its commands, and tests that applied only to the demo.
At that stage, hosted accounts and shared data replaced the local demo.
The later backend decisions below select Cloudflare as the only backend.
Isolated fixtures remain for verification.
The broader organizer tools below remain incomplete.

## Agreed direction

- Each event has one contest type: individual or group. Sessions have separate rosters, schedules, issues, and awards.
- Organizers create username and password accounts. They distribute temporary credentials securely. Users change temporary passwords before they access contest data. Organizers verify identity and reset lost passwords. This flow does not require personal email or SMTP.

  Group contestants share a team account. Staff have individual accounts.
- Configurable roles combine fixed capabilities. Issue categories are configurable.
- A staff member can hold multiple roles and receives their combined capabilities. Any support staff member can start issue triage. This includes technical specialists and people with both volunteer and specialist roles. Ownership and activity identify the person.

  T0002 first implemented this behavior in the retired local demo. The connected product keeps it. Volunteer and specialist roles confer support membership. Jury alone does not. Role and permission administration remain deferred.

  On 2026-10-25 the owner decided that a session admin without other roles can reply to a team, write internal notes, and add images. That admin still cannot claim, hand off, accept, or reopen an issue. Those actions need the Volunteer or Specialist role.
- Contestants and staff can report issues. Staff manually open and close contestant intake.
- Volunteers, specialists, jury members, and session admins can search team names and locations in the current session. T0008 matches partial words, either word order, accents, small spelling mistakes, and whole table numbers. Suggestions show the unresolved-issue count. The queue filter combines with the status filter. Jury-only members still see resolved issues only. Every staff member can report an issue for a team: volunteers, specialists, jury members, and session admins. The reporter can add several teams. Minsky then creates one issue per team, each with its own timer, owner, and award. The choice uses each team's database id. Team codes, aliases, and institutions are not part of this search.
- The current owner retains ownership during escalation until a specialist accepts the handoff. Timers run continuously while an issue remains unresolved. After reopening, unresolved time excludes resolved intervals. Recurrences become linked new reports. Duplicates link to a canonical report.
- Contestants and helpers must be able to reopen resolved issues. T0002 implements reopening on the same issue and retains its history. Reopening continues an issue whose resolution needs review. A separate recurrence may still use a linked new report in future work. Linked-report controls remain outside T0002. The ticket records the implemented rules for ownership, timing, and awards.
- The user confirmed that reopening resumes accumulated unresolved time and excludes time spent resolved. First-assignment delay remains separate. Awards remain discretionary.
- Public replies and private notes are separate. The agreed direction includes photos, session announcements, in-app alerts, and browser push that users explicitly enable.
- Staff upload JPEG, PNG, or WebP images on an issue. Each image records its uploader and time. The uploader chooses team-visible or staff-only visibility, and the choice stays fixed. Every staff member can upload while the event is active. Only the uploader can remove an image during that time. Contestants can view team-visible images on their own team's issues. Session admins set the per-session size and count limits. Resolved issues keep their images. Archived events keep the files for preview and download. The Cloudflare implementation uses private R2. Contestant uploads remain out of scope.
- Session admins and jury publish announcements for a session. Every member reads the active ones above the issue workspace. Titles expand to plain-text details and up to four private images. Expiry hides an announcement from readers, and managers keep it. Removal hides it from everyone and keeps the record. A later export of the contest support log is future work. See [session announcements](session-announcements.md).
- Shared incidents use explicit affected rosters, selective closure of linked reports, and bulk awards with recipient exceptions.
- Awards use a separate ledger. One authorized decision precedes separate confirmation of external application. Contestants see the decision and application status. Minsky permits explicit zero-minute decisions with a public explanation. It also supports preset and custom award amounts.
- The agreed direction includes CSV roster imports and editing forms. Reporting uses dashboards only. Archived events permit reading only. The app does not automatically delete archived events.

## Platform and capacity targets

[ROADMAP.md](../ROADMAP.md) owns the current and target technology stack.
On 2026-10-23 the owner selected Cloudflare as the live backend. The development Worker is `minsky-dev` and its D1 database is `minsky-development`.
Cloudflare is the only backend. The provider contracts stay for a later provider.
[Cloudflare backend design](cloudflare-backend-design.md) explains the implemented boundaries. [Add a backend provider](add-provider.md) states what another provider must implement.
A backend switch needs separate owner approval. Follow the [activation procedure](activate-cloudflare-development.md).

On 2026-10-02, the user prioritized working cloud features and deferred resilience.
Assume connectivity during development. Outage planning does not block backend work.
Start with free tiers. Necessary paid services are acceptable after the need and cost are identified.
A developer pilot and production capacity validation are separate milestones.
Session admins edit teams and categories in the app. Event editors remain future work.

Production targets on a healthy venue connection are:

- 800 simultaneous users.
- 95% of ordinary actions complete within two seconds.
- Live updates arrive within three seconds.

No current check establishes these targets.
Actual authorization, synchronization, deployment, capacity, and recovery behavior require their own scope and verification.

## Unresolved decisions

T0018 selected maintained Better Auth for bounded Cloudflare authentication. T0020 retains it in the complete connector.
See [the identity choice](cloudflare-authentication-choice.md) and [API reference](cloudflare-authentication.md).
On 2026-10-18, the owner selected a fresh Cloudflare development installation in T0021.
Records from the earlier backend are disposable trial data, including the administrator.
Transfer no accounts, passwords, issues, history, images, or IDs.
Create a new administrator through the supported bootstrap process and require a temporary-password change.
This replaces the 2026-10-17 data-preservation decision. Preserve application behavior and database rules.
T0021 did not export data, reset accounts, or delete resources of the earlier backend.
T0021 requires fresh credential distribution, recovery, expiry, and revocation checks before activation.
The [verification record](history/run-log.md) distinguishes those checks from later deployment results.

Outage handling remains deferred until after cloud feature development.
Manual fallback, offline capture, and venue-local operation remain unselected.
Do not make these decisions a prerequisite for T0003.
T0005 records the attachment visibility and limit decisions.

After accepting the proof of concept, the user selected T0002 for multiple staff roles, support triage, and reopening.
The user authorized this work on the existing T0001 branch.
At that stage, visual redesign, possibly with Figma references, remained deferred beyond T0002.
Confirm production role and category configuration and integration requirements when they become relevant.
Do not turn this direction into a speculative implementation backlog.

Contributor decision (2026-10-02): the user permits full cloud credential access for contributors.
The setup at that time used a hosted backend and local frontend development.
Docker is optional.
Keep privileged credentials outside Git and frontend builds.
Cloud CI uses a protected, isolated test project.

Authentication revision (2026-10-02): the user chose organizer-created usernames and temporary passwords in T0003.
The identity provider uses internal identifiers with email format.
These identifiers are not mailboxes.
Credential distribution and organizer-issued resets replace email invitations and email recovery.
Keep team accounts shared and staff identities individual.
Preserve existing Auth UUIDs, history, and permissions when you assign a username.
