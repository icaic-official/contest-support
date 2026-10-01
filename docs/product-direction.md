# Product direction beyond the demo

These requirements preserve the agreed direction from [PLAN.md](../PLAN.md). They are not implemented unless listed in [current-state.md](current-state.md). Subsequent scope is selected after demo feedback.

## Agreed direction

- Each event has one contest type: individual or group. Sessions have separate rosters, schedules, issues and awards.
- Organizers provision email/password accounts. Group contestants share a team account; staff have individual accounts.
- Configurable roles combine fixed capabilities. Issue categories are configurable.
- Contestants and staff can report issues; staff manually open and close contestant intake.
- Ownership persists through escalation until handoff acceptance. Timers run continuously. Recurrences become linked new reports; duplicates link to a canonical report.
- Public replies and private notes are separate. Photos, session announcements, in-app alerts and opt-in browser push are intended.
- Shared incidents use explicit affected rosters, selective closure of linked reports, and bulk awards with recipient exceptions.
- Awards use a separate ledger: one authorized decision followed by separate confirmation of external application. Contestants see the decision and application state.
- CSV roster imports and editing forms are intended. Reporting is dashboard-only. Archived events are read-only with no automatic purge.

## Provisional architecture and milestones

Cloudflare and Supabase are the intended production stack, subject to the outage decision. Begin with free-tier experiments before considering paid subscriptions. A free-tier pilot and production capacity validation are separate milestones.

Production targets are 800 simultaneous users, 95% of ordinary actions completing within two seconds, and live updates within three seconds on a healthy venue connection. Demo checks establish none of these targets. Actual authorization, synchronization, deployment, capacity and recovery behavior need their own scoped work and verification.

## Unresolved decisions

**Outage handling remains unresolved. Remind the user and revisit it before scoping a connected-backend ticket.** Manual fallback, offline capture and venue-local operation have not been selected. Revisit the architecture if venue-local operation is required.

After demo review, choose the next small improvement and confirm production role/category configuration and integration requirements when they become relevant. Do not turn this direction into a speculative implementation backlog.
