# Product direction beyond the demo

This document preserves the agreed direction from [PLAN.md](../PLAN.md).
Only requirements listed in [current-state.md](current-state.md) describe implemented behavior.
The user selects later scope after demo feedback.

Latest ticket decision (2026-10-03): implement [T0004](tickets.md#t0004--ui-makeover) from the user's dark green workspace and centered sign-in references.
The sign-in reference uses an amber button.
Use actual authenticated data.
Preserve workflow behavior and permissions.
Sample text and values are placeholders.

Previous T0004 scope notes move to [T0005](tickets.md#t0005--follow-up-scope-notes).
They include agreed operational work and candidate organizer tools and configurable issue attachments.
T0005 implementation remains pending.

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
- The current owner retains ownership during escalation until a specialist accepts the handoff. Timers run continuously while an issue remains unresolved. After reopening, unresolved time excludes resolved intervals. Recurrences become linked new reports. Duplicates link to a canonical report.
- Contestants and helpers must be able to reopen resolved issues. T0002 implements reopening on the same issue and retains its history. Reopening continues an issue whose resolution needs review. A separate recurrence may still use a linked new report in future work. Linked-report controls remain outside T0002. The ticket records the implemented demo rules for ownership, timing, and awards.
- The user confirmed that reopening resumes accumulated unresolved time and excludes time spent resolved. First-assignment delay remains separate. Awards remain discretionary.
- Public replies and private notes are separate. The agreed direction includes photos, session announcements, in-app alerts, and browser push that users explicitly enable.
- Helpers must be able to upload images linked to a contestant issue. Records must identify the uploader and upload time. Future settings controlled by administrators must enable or disable image submission for volunteers and other applicable roles. Attachment visibility remains undecided.

  The decision must cover access for contestants and staff, and any uploader choice. The scope of settings, per event or per session, also remains undecided. Define these rules before you implement uploads.

  Supabase Storage is the initial recommendation. It is not an implemented integration or a final provider commitment.
- Shared incidents use explicit affected rosters, selective closure of linked reports, and bulk awards with recipient exceptions.
- Awards use a separate ledger. One authorized decision precedes separate confirmation of external application. Contestants see the decision and application status. The demo permits explicit zero-minute decisions with a public explanation. It also supports preset and custom award amounts.
- The agreed direction includes CSV roster imports and editing forms. Reporting uses dashboards only. Archived events permit reading only. The app does not automatically delete archived events.

## Provisional architecture and milestones

Cloudflare Workers and Supabase are the selected cloud direction.
On 2026-10-02, the user prioritized working cloud features and deferred resilience.
Assume connectivity during development.
Outage planning no longer blocks backend work.
Start with free tiers.
Necessary paid services are acceptable after the need and cost are identified.

A developer pilot and production capacity validation are separate milestones.

Architecture clarification (2026-10-02): Cloudflare serves the React frontend as static assets.
All backend functionality resides in Supabase.
Use managed Auth, Postgres, Realtime, and future Storage.
Use database functions for transactional workflows.
Use Edge Functions for privileged account administration.
This replaces the earlier proposal for privileged Worker endpoints.

Supabase manages the services.
Minsky still requires repository-owned migrations and functions that implement its schema, authorization policies, and business rules.
Those rules require tests.

[T0003](tickets.md#t0003--cloud-onboarding-and-authenticated-shared-product) merged in PR #2.
It includes cloud onboarding, Supabase authentication behind username and password login, shared Postgres workflows, role dashboards, and minimal account administration.
It also includes reproducible local contribution.
Protected cloud CI setup remains unverified.

T0004 implements the selected UI makeover.
Broader organizer configuration and attachments remain candidate T0005 scope.
See [cloud onboarding](cloud-onboarding.md) for setup stages and costs.

Production targets on a healthy venue connection are:

- 800 simultaneous users.
- 95% of ordinary actions complete within two seconds.
- Live updates arrive within three seconds.

Demo checks establish none of these targets.
Actual authorization, synchronization, deployment, capacity, and recovery behavior require their own scope and verification.

## Unresolved decisions

Outage handling remains deferred until after cloud feature development.
Manual fallback, offline capture, and venue-local operation remain unselected.
Do not make these decisions a prerequisite for T0003.
Attachment visibility and the scope and defaults of upload settings remain decisions for the attachment ticket.

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
