# Product direction beyond the demo

These requirements preserve the agreed direction from [PLAN.md](../PLAN.md). Only requirements listed in [current-state.md](current-state.md) describe implemented behavior. The user selects subsequent scope after demo feedback.

## Agreed direction

- Each event has one contest type: individual or group. Sessions have separate rosters, schedules, issues and awards.
- Organizers provision email/password accounts. Group contestants share a team account. Staff have individual accounts.
- Configurable roles combine fixed capabilities. Issue categories are configurable.
- A staff member can hold multiple roles and receives their combined capabilities. Any support staff member can begin issue triage, including a technical specialist or someone with both volunteer and specialist roles. Ownership and activity refer to the person. T0002 implements this in the local demo; role/permission administration remains deferred. The demo uses the default that volunteer and specialist confer support membership, while jury alone does not.
- Contestants and staff can report issues. Staff manually open and close contestant intake.
- Ownership persists through escalation until handoff acceptance. Timers run continuously while unresolved, excluding resolved intervals after reopening. Recurrences become linked new reports. Duplicates link to a canonical report.
- Contestants and helpers must be able to reopen resolved issues; T0002 implements this on the same issue with retained history. This adds reopening to the earlier recurrence direction: reopening continues an issue whose resolution needs revisiting, while a separate recurrence may still use a linked new report in future work. Linked-report controls remain outside T0002. The ticket records implemented demo ownership, timing and award behavior.
- The user confirmed that reopening resumes accumulated unresolved time and excludes time spent resolved. First-assignment delay remains separate. Awards remain discretionary.
- Public replies and private notes are separate. The agreed direction includes photos, session announcements, in-app alerts, and opt-in browser push.
- Shared incidents use explicit affected rosters, selective closure of linked reports, and bulk awards with recipient exceptions.
- Awards use a separate ledger: one authorized decision followed by separate confirmation of external application. Contestants see the decision and application state.
- The agreed direction includes CSV roster imports and editing forms. Reporting uses dashboards only. Archived events permit reading only. The application does not automatically purge archived events.

## Provisional architecture and milestones

Cloudflare and Supabase are the intended production stack, subject to the outage decision. Begin with free-tier experiments before considering paid subscriptions. A free-tier pilot and production capacity validation are separate milestones.

Production targets on a healthy venue connection are:

- 800 simultaneous users.
- 95% of ordinary actions complete within two seconds.
- Live updates arrive within three seconds.

Demo checks establish none of these targets. Actual authorization, synchronization, deployment, capacity and recovery behavior need their own scoped work and verification.

## Unresolved decisions

**Outage handling remains unresolved. Remind the user and revisit it before scoping a connected-backend ticket.** The user has not selected manual fallback, offline capture, or venue-local operation. Revisit the architecture if the user requires venue-local operation.

After accepting the proof of concept, the user selected T0002 for multiple staff roles, support triage and reopening on the existing T0001 branch. Visual redesign, potentially using Figma references, is deferred beyond T0002. Confirm production role/category configuration and integration requirements when they become relevant. Do not turn this direction into a speculative implementation backlog.
