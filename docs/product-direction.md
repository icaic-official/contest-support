# Product direction beyond the demo

This document preserves the agreed direction from [PLAN.md](../PLAN.md).
Only requirements listed in [current-state.md](current-state.md) describe implemented behavior.
The user selects later scope after demo feedback.

Interface decision (2026-10-17): organisers and contestants get different UIs. This is not one layout with parts hidden.
Organisers mainly use phones, so they get a phone-first app. At 1024 px and wider, they get a separate desktop console.
Contestants use computers and get a desktop app. There is no contestant phone layout.
The membership selects the UI after sign-in. A membership with a team gets the contestant app.
All UIs share one design system, shadcn/ui with Tailwind CSS, and the same data hooks.
[T0015](tickets.md#t0015--organiser-and-contestant-frontend-redesign) implements this decision. It replaces the sidebar workspace from the 2026-10-02 decision below.
The T0015 jury award lists replace the separate T0009 worklist screen.
Mockup items that need new data stay out of scope: helper zones, quick replies, a floor map, configurable aging thresholds, and category icons.

Jury worklist status (2026-10-18): [T0009](jury-worklist.md) merged in PR #23 at `c144a2a`.
It uses authorized `Backend` snapshots and existing workflow actions for decisions and external confirmations.
Its maintenance ran in a separate worktree alongside T0020.
The active Cloudflare installation preserves the combined application. Verification applies only to its recorded source and provider.

Team-search status (2026-10-15): [T0008](tickets.md#t0008--fuzzy-team-search) merged into `main` in PR #22.
Staff search the current session's team names and locations from the issue queue.
Volunteers and specialists use the same search to choose a team before they report an issue.
The T0005 branch includes the accepted search through a merge from `main`.
Deployment waits for an explicit request after review.

Issue-image decision (2026-10-11): [T0005](tickets.md#t0005--issue-images) adds issue images.
Staff attach JPEG, PNG, and WebP images to an issue.
The uploader chooses team-visible or staff-only visibility at upload.
The default is staff-only, and the choice stays fixed.
Session admins set the file size, image count, and combined size.
Provider ownership records, GitHub merge enforcement, and remaining manual acceptance checks stay deferred.
They are not part of T0005.

Implemented interface decision (2026-10-02): provide a public login landing page and a sidebar for the authenticated workspace.
The user removed the old local demo, its commands, and tests that applied only to the demo.
At that stage, Supabase accounts and shared data replaced the local demo.
The later backend decision below retains Supabase as a provider option and selects Cloudflare for development.
Isolated fixtures remain for verification.
The broader organizer tools below remain incomplete.

## Agreed direction

- Each event has one contest type: individual or group. Sessions have separate rosters, schedules, issues, and awards.
- Organizers create username and password accounts. They distribute temporary credentials securely. Users change temporary passwords before they access contest data. Organizers verify identity and reset lost passwords. This flow does not require personal email or SMTP.

  Group contestants share a team account. Staff have individual accounts.
- Configurable roles combine fixed capabilities. Issue categories are configurable.
- A staff member can hold multiple roles and receives their combined capabilities. Any support staff member can start issue triage. This includes technical specialists and people with both volunteer and specialist roles. Ownership and activity identify the person.

  T0002 implements this behavior in the local demo. Role and permission administration remain deferred in that scope. In the demo, volunteer and specialist roles confer support membership. Jury alone does not.
- Contestants and staff can report issues. Staff manually open and close contestant intake.
- Volunteers, specialists, jury members, and session admins can search team names and locations in the current session. T0008 matches partial words, either word order, accents, small spelling mistakes, and whole table numbers. Suggestions show the unresolved-issue count. The queue filter combines with the status filter. Jury-only members still see resolved issues only. Only volunteers and specialists select the affected team for a new report, and that choice uses the team's database id. Team codes, aliases, and institutions are not part of this search.
- The current owner retains ownership during escalation until a specialist accepts the handoff. Timers run continuously while an issue remains unresolved. After reopening, unresolved time excludes resolved intervals. Recurrences become linked new reports. Duplicates link to a canonical report.
- Contestants and helpers must be able to reopen resolved issues. T0002 implements reopening on the same issue and retains its history. Reopening continues an issue whose resolution needs review. A separate recurrence may still use a linked new report in future work. Linked-report controls remain outside T0002. The ticket records the implemented demo rules for ownership, timing, and awards.
- The user confirmed that reopening resumes accumulated unresolved time and excludes time spent resolved. First-assignment delay remains separate. Awards remain discretionary.
- Public replies and private notes are separate. The agreed direction includes photos, session announcements, in-app alerts, and browser push that users explicitly enable.
- Staff upload JPEG, PNG, or WebP images on an issue. Each image records its uploader and time. The uploader chooses team-visible or staff-only visibility, and the choice stays fixed. Every staff member can upload while the event is active. Only the uploader can remove an image during that time. Contestants can view team-visible images on their own team's issues. Session admins set the per-session size and count limits. Resolved issues keep their images. Archived events keep the files for preview and download. The Supabase implementation uses a private Storage bucket. The active Cloudflare implementation uses private R2. Contestant uploads remain out of scope.
- Shared incidents use explicit affected rosters, selective closure of linked reports, and bulk awards with recipient exceptions.
- Awards use a separate ledger. One authorized decision precedes separate confirmation of external application. Contestants see the decision and application status. The demo permits explicit zero-minute decisions with a public explanation. It also supports preset and custom award amounts.
- The agreed direction includes CSV roster imports and editing forms. Reporting uses dashboards only. Archived events permit reading only. The app does not automatically delete archived events.

## Provisional architecture and milestones

Cloudflare Workers serves the frontend and backend at the stable development URL.
D1 stores application records, private R2 stores images, and Durable Objects deliver live updates.
Supabase remains a working provider implementation with its existing projects intact.
The [backend direction](#backend-migration-direction) records the choice and approval gates.
On 2026-10-02, the user prioritized working cloud features and deferred resilience.
Assume connectivity during development.
Outage planning no longer blocks backend work.
Start with free tiers.
Necessary paid services are acceptable after the need and cost are identified.

A developer pilot and production capacity validation are separate milestones.

The Supabase implementation uses Auth, Postgres, Realtime, and private Storage.
Its database functions enforce workflow transactions and permissions.
Its Edge Functions handle privileged account administration and image operations.
T0014 places the browser integration behind [backend contracts](backend-contracts.md).
T0019 extracts the existing issue decisions into a [shared server service](server-workflow.md).
An opt-in Supabase function executes that service for replacement verification.
The Supabase browser adapter retains its guarded PostgreSQL workflow. The active Cloudflare adapter uses the shared service through atomic D1 commits.
T0020 implements the complete Cloudflare connector and provider-owned installation tooling.
Its original local checks, hosted D1 tests, and eight shared scenarios passed at their recorded revisions.
T0021 expands the shared registry to 11 scenarios and verifies the fresh development installation.
The complete hosted React journey and a separate documented empty-installation journey also pass.
Scoped fixture cleanup and protected Cloudflare connector CI pass.

Each provider manages its own services.
Minsky still requires repository-owned migrations and functions that implement its schema, authorization policies, and business rules.
Those rules require tests.

[T0003](tickets.md#t0003--cloud-onboarding-and-authenticated-shared-product) merged in PR #2.
It includes cloud onboarding, Supabase authentication behind username and password login, shared Postgres workflows, role dashboards, and minimal account administration.
It also includes reproducible local contribution.
Protected Supabase CI passes at its recorded revision.
The complete protected Cloudflare connector job passes on `25b2033`.

T0004 implements the selected UI makeover.
T0005 implements issue images.
Event, roster, and category editors remain future work.
See [cloud onboarding](cloud-onboarding.md) for setup stages and costs.

Production targets on a healthy venue connection are:

- 800 simultaneous users.
- 95% of ordinary actions complete within two seconds.
- Live updates arrive within three seconds.

Demo checks establish none of these targets.
Actual authorization, synchronization, deployment, capacity, and recovery behavior require their own scope and verification.

## Unresolved decisions

T0018 selected maintained Better Auth for bounded Cloudflare authentication. T0020 retains it in the complete connector.
See [the identity choice](cloudflare-authentication-choice.md) and [API reference](cloudflare-authentication.md).
On 2026-10-18, the owner selected a fresh Cloudflare development installation in T0021.
Existing Supabase records are disposable trial data, including the administrator.
Transfer no accounts, passwords, issues, history, images, or IDs.
Create a new administrator through the supported bootstrap process and require a temporary-password change.
This replaces the 2026-10-17 data-preservation decision. Preserve application behavior and database rules.
Leave Supabase intact. Do not export data, reset its accounts, or delete its resources.
T0021 requires fresh credential distribution, recovery, expiry, and revocation checks before activation.
The [verification record](current-state.md) distinguishes those checks from later deployment results.

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
The setup at that time used hosted Supabase, local frontend development, and cloud-side function bundling.
Docker is optional.
Keep privileged credentials outside Git and frontend builds.
Cloud CI uses a protected, isolated test project.

Authentication revision (2026-10-02): the user chose organizer-created usernames and temporary passwords in T0003.
Supabase uses internal identifiers with email format.
These identifiers are not mailboxes.
Credential distribution and organizer-issued resets replace email invitations and email recovery.
Keep team accounts shared and staff identities individual.
Preserve existing Auth UUIDs, history, and permissions when you assign a username.

## Backend migration direction

On 2026-10-17, the user selected Cloudflare D1 with a SQLite rewrite and Durable Objects for live updates.
Cloudflare is the live development backend after the separately approved T0021 switch.
The Worker is `minsky-dev` and the D1 database is `minsky-development`.
Supabase is a supported second provider. Its resources and accounts remain intact. No existing data or identifiers transferred.
The [backend design](cloudflare-backend-design.md) explains the current connector boundaries.
The [dated verification record](current-state.md#t0020-connector-implementation-2026-10-18) records implementation evidence.

The selected target has these responsibilities.

| Component | Selected responsibility |
| --- | --- |
| Workers | Serve the frontend and authenticated backend operations. Check current access before reads and commands. |
| D1 | Store accounts, memberships, issues, activity, resolutions, awards, image metadata, and notification records. |
| R2 | Store original images and thumbnails privately. Backend operations check access before file reads and writes. |
| Durable Objects | Manage live connections and notify authorized clients of changes. Clients refetch permitted snapshots. |

D1 remains the source of saved workflow state.
Live messages carry no private issue data and grant no access.
The SQLite adapter applies the same `WorkflowService` decisions through guarded commits.
Future providers must preserve the `Backend` contract and the shared workflow rules.
AWS, GCP, Azure, and Terraform implementations remain future contributions.
See [Add a backend provider](add-provider.md) for contributor requirements.

### Migration and cutover gates

T0021 installed a fresh development application without transferring existing records.
The owner merged PR #43 at `4e43739`, then separately approved activation and repeat-deployment verification.
Connector verification and a preparation PR merge alone do not authorize a backend switch.
The [activation procedure](activate-cloudflare-development.md) defines the separate owner approval gate.
The completed implementation phases remain in the [historical plan](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/cloudflare-implementation-plan.md).

For a future backend switch, complete these gates:

1. Have the owner review and merge the preparation revision. Update from main and reconcile review changes.
2. Install the reviewed revision into dedicated development resources through the authoritative installation guide.
3. Verify shared behavior with fictional accounts, private images, live updates, password changes, and owner recovery.
4. Run required local and hosted checks. Record local hosted and protected GitHub Actions results separately.
5. Present exact targets, approved revision, settings, commands, verification criteria, and recovery to the owner.
6. Obtain approval, switch the development URL, and verify another automated deployment retains Cloudflare mode and its bindings.

Supabase stays intact throughout this process. Earlier records do not appear in the fresh installation.
Recovery must retain new Cloudflare records. Do not imply that switching back to Supabase transfers those records.
Use a known compatible full Worker revision for application recovery after new writes begin.
