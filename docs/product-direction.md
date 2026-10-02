# Product direction beyond the demo

These requirements preserve the agreed direction from [PLAN.md](../PLAN.md). Only requirements listed in [current-state.md](current-state.md) describe implemented behavior. The user selects subsequent scope after demo feedback.

## Agreed direction

- Each event has one contest type: individual or group. Sessions have separate rosters, schedules, issues and awards.
- Organizers provision username/password accounts and distribute temporary credentials securely. Users change temporary passwords before accessing contest data; organizers verify identity and reset lost passwords. No personal email or SMTP is required for this flow. Group contestants share a team account. Staff have individual accounts.
- Configurable roles combine fixed capabilities. Issue categories are configurable.
- A staff member can hold multiple roles and receives their combined capabilities. Any support staff member can begin issue triage, including a technical specialist or someone with both volunteer and specialist roles. Ownership and activity refer to the person. T0002 implements this in the local demo; role/permission administration remains deferred. The demo uses the default that volunteer and specialist confer support membership, while jury alone does not.
- Contestants and staff can report issues. Staff manually open and close contestant intake.
- Ownership persists through escalation until handoff acceptance. Timers run continuously while unresolved, excluding resolved intervals after reopening. Recurrences become linked new reports. Duplicates link to a canonical report.
- Contestants and helpers must be able to reopen resolved issues; T0002 implements this on the same issue with retained history. This adds reopening to the earlier recurrence direction: reopening continues an issue whose resolution needs revisiting, while a separate recurrence may still use a linked new report in future work. Linked-report controls remain outside T0002. The ticket records implemented demo ownership, timing and award behavior.
- The user confirmed that reopening resumes accumulated unresolved time and excludes time spent resolved. First-assignment delay remains separate. Awards remain discretionary.
- Public replies and private notes are separate. The agreed direction includes photos, session announcements, in-app alerts, and opt-in browser push.
- Helpers must be able to upload images linked to a contestant issue, with uploader and upload time recorded. Future administrator-controlled settings must enable or disable image submission for volunteers and other applicable roles. Whether attachments are contestant-visible or staff-only, whether the uploader chooses, and whether settings apply per event or session remain open decisions. Scope these before implementing uploads. Supabase Storage is the initial recommendation, not an implemented integration or a final provider commitment.
- Shared incidents use explicit affected rosters, selective closure of linked reports, and bulk awards with recipient exceptions.
- Awards use a separate ledger: one authorized decision followed by separate confirmation of external application. Contestants see the decision and application state. The demo permits explicit zero-minute decisions with a public explanation, alongside preset and custom award amounts.
- The agreed direction includes CSV roster imports and editing forms. Reporting uses dashboards only. Archived events permit reading only. The application does not automatically purge archived events.

## Provisional architecture and milestones

Cloudflare Workers and Supabase are the selected cloud direction. On 2026-10-02 the user prioritized working cloud features and deferred resilience. Assume connectivity during development; outage planning no longer blocks backend work. Start with free tiers, but necessary paid services are acceptable after identifying the cost and reason. A developer pilot and production capacity validation are separate milestones.

Architecture clarification (2026-10-02): Cloudflare serves the React frontend as static assets; all backend functionality lives in Supabase. Use managed Auth, Postgres, Realtime and future Storage, with database functions for transactional workflows and Edge Functions for privileged account administration. This replaces the earlier proposal for privileged Worker endpoints. Supabase manages the services, but Minsky's schema, authorization policies and business rules must still be implemented and tested in repository-owned migrations/functions.

[T0003](tickets.md#t0003--cloud-onboarding-and-authenticated-shared-product) is being implemented: guide account/service setup, replace simulated personas with Supabase authentication behind username/password login, move workflows into shared Postgres data, provide role dashboards and minimal account administration, and make local contribution reproducible. Broader organizer configuration and attachments are the recommended next candidate, not an active T0004. See the [cloud onboarding guide](cloud-onboarding.md) for setup stages and cost considerations.

Production targets on a healthy venue connection are:

- 800 simultaneous users.
- 95% of ordinary actions complete within two seconds.
- Live updates arrive within three seconds.

Demo checks establish none of these targets. Actual authorization, synchronization, deployment, capacity and recovery behavior need their own scoped work and verification.

## Unresolved decisions

Outage handling is explicitly deferred until after cloud feature development. Manual fallback, offline capture and venue-local operation remain unselected. Do not reopen this as a prerequisite for T0003. Attachment visibility and the scope/defaults of upload settings remain deferred decisions for the attachment ticket.

After accepting the proof of concept, the user selected T0002 for multiple staff roles, support triage and reopening on the existing T0001 branch. Visual redesign, potentially using Figma references, is deferred beyond T0002. Confirm production role/category configuration and integration requirements when they become relevant. Do not turn this direction into a speculative implementation backlog.

Contributor decision (2026-10-02): the user permits assuming full contributor access to cloud credentials. The primary setup uses hosted Supabase, with local frontend development and cloud-side function bundling. Docker is optional. Privileged credentials remain out of Git and frontend builds; cloud CI uses a protected isolated test project.

Authentication revision (2026-10-02): the user chose organizer-created usernames and temporary passwords in T0003. Supabase uses internal email-format identifiers, which are not mailboxes. Email invitations and email recovery are replaced by credential handoff and organizer-issued resets. Keep team accounts shared and staff identities individual; existing Auth UUIDs, history and permissions survive username assignment.
