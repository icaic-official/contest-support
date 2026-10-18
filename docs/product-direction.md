# Product direction beyond the demo

This document preserves the agreed direction from [PLAN.md](../PLAN.md).
Only requirements listed in [current-state.md](current-state.md) describe implemented behavior.
The user selects later scope after demo feedback.

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
Supabase accounts and shared data are the only application mode.
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
- Staff upload JPEG, PNG, or WebP images on an issue. Each image records its uploader and time. The uploader chooses team-visible or staff-only visibility, and the choice stays fixed. Every staff member can upload while the event is active. Only the uploader can remove an image during that time. Contestants can view team-visible images on their own team's issues. Session admins set the per-session size and count limits. Resolved issues keep their images. Archived events keep the files for preview and download. T0005 stores the files in a private Supabase Storage bucket. Contestant uploads remain out of scope.
- Shared incidents use explicit affected rosters, selective closure of linked reports, and bulk awards with recipient exceptions.
- Awards use a separate ledger. One authorized decision precedes separate confirmation of external application. Contestants see the decision and application status. The demo permits explicit zero-minute decisions with a public explanation. It also supports preset and custom award amounts.
- The agreed direction includes CSV roster imports and editing forms. Reporting uses dashboards only. Archived events permit reading only. The app does not automatically delete archived events.

## Provisional architecture and milestones

Cloudflare Workers hosts the frontend, and Supabase runs the current backend.
The selected future backend is described in [backend migration direction](#backend-migration-direction).
On 2026-10-02, the user prioritized working cloud features and deferred resilience.
Assume connectivity during development.
Outage planning no longer blocks backend work.
Start with free tiers.
Necessary paid services are acceptable after the need and cost are identified.

A developer pilot and production capacity validation are separate milestones.

The implemented architecture uses Supabase Auth, Postgres, Realtime, and private Storage.
Database functions enforce workflow transactions and permissions.
Edge Functions handle privileged account administration and image operations.
T0014 places the browser integration behind [backend contracts](backend-contracts.md).
T0019 extracts the existing issue decisions into a [shared server service](server-workflow.md).
An opt-in Supabase function executes that service for replacement verification.
The active application retains the legacy PostgreSQL workflow during this transition.

Supabase manages the services.
Minsky still requires repository-owned migrations and functions that implement its schema, authorization policies, and business rules.
Those rules require tests.

[T0003](tickets.md#t0003--cloud-onboarding-and-authenticated-shared-product) merged in PR #2.
It includes cloud onboarding, Supabase authentication behind username and password login, shared Postgres workflows, role dashboards, and minimal account administration.
It also includes reproducible local contribution.
Protected cloud CI setup remains unverified.

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

T0018 selects maintained Better Auth for experimental Cloudflare authentication.
See [the identity choice](cloudflare-authentication-choice.md) and [API reference](cloudflare-authentication.md).
The owner selected organizer-issued replacement temporary passwords for migration on 2026-10-17.
Users must change these passwords before contest access.
Existing passwords do not need to survive. Password-hash import is not required.
Preserve account IDs, memberships, permissions, and history.
Credential distribution, recovery, and login revocation need verification before account cutover.
The final transfer also needs a reconciliation check and a tested rollback procedure.

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
The primary setup uses hosted Supabase, local frontend development, and cloud-side function bundling.
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

On 2026-10-17, the user selected Cloudflare D1 with a SQLite rewrite.
The user also required preservation of existing data and requested Durable Objects for live updates.
This decision replaces Supabase as the long-term backend target.
Supabase remains active during Cloudflare implementation and verification.

The selected target has these responsibilities.

| Component | Planned responsibility |
| --- | --- |
| Workers | Serve the frontend and authenticated backend operations. Check current access before reads and commands. |
| D1 | Store accounts' application records, memberships, issues, activity, resolutions, awards, and image metadata. |
| R2 | Store original images and thumbnails privately. Backend operations check access before file reads and writes. |
| Durable Objects | Manage live connections and notify authorized clients of changes. Clients refetch their permitted snapshots. |

D1 remains the source of saved workflow state.
Live messages do not grant access and do not carry private issue data.
A later implementation must define how committed changes reach subscribers and how clients recover missed notifications.
The SQLite adapter must preserve the existing decisions through the same shared service and guarded commits.

The shared Minsky interfaces, Supabase adapter, provider tests, and Cloudflare design merged before T0017.
Hosted Supabase contract checks provide the comparison point for the replacement backend.
T0017's bounded D1 transaction proof merged in PR #39 at `0c797ad`.
T0018 authentication merged in PR #40 at `68e8642` on 2026-10-17 at 17:16:41 UTC.
Its initial hosted HTTP verification reached a Workers Free resource limit.
The owner activated Workers Paid during PR #41 review. The hosted HTTP suite now passes.
See [current state](current-state.md) for separate local hosted and protected GitHub results.
T0019 verifies the extracted server workflow through Supabase before further D1 workflow persistence.
Its branch started independently at `0c797ad` and preserves the merged authentication behavior.
The remaining connector operations follow that shared-rule verification.
Full migration tooling follows connector verification. Real-data exports and the backend switch remain later phases.
See [the proof guide](d1-transaction-proof.md) and [implementation plan](cloudflare-implementation-plan.md).

The migration preserves account IDs, relationships, historical actors, timestamps, resolution cycles, awards, external application status, image visibility, and file contents.
T0014 implemented only the interfaces and Supabase extraction.
The owner now authorizes isolated Cloudflare development and CI resources in the existing account for connector work.
Keep those resources separate and verify the account before provisioning.
Check existing Wrangler access before requesting credentials. Keep tokens out of chat and logs.

Document the concrete need and cost before any paid upgrade.
Subagents may perform independent, bounded tasks.
AWS implementations and Terraform remain deferred until a concrete deployment needs them.

On 2026-10-17, the user authorized shared provider tests and Cloudflare design in parallel with PR #32 review.
T0015 contains the test work on its own branch.
T0016 records the [proposed architecture](cloudflare-backend-design.md) and [implementation plan](cloudflare-implementation-plan.md).
Neither design work nor provider tests migrate existing data.
Possible AWS testing motivates separate domain rules, transactional persistence, identity, image storage, and live-delivery interfaces.
Cloudflare implementation still requires a verified D1 transaction pattern and a selected identity implementation.
The owner selected replacement temporary passwords rather than password-hash import for the later migration.
