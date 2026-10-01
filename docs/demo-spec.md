# Local demo specification

Status: implemented. [current-state.md](current-state.md) records verification results. Development tickets (`T0001`, `T0002`) are separate from contestant issues (`ISS-001`).

This specification describes T0001 and [T0002](tickets.md#t0002--multiple-staff-roles-triage-and-reopening). T0002 adds multiple roles per person, initial claims by any support helper, reopening and v1 migration. UI redesign is outside T0002.

## Screens and seeded session

One fictional group-contest session contains Aurora (Hall A, Desk 12), Cedar (Hall A, Desk 18), and Orbit (Hall B, Desk 04). Reset creates an open Aurora display issue, a Cedar backend issue awaiting a specialist, and a resolved Orbit question about units. Seed timestamps are relative to reset time.

| Persona                            | View and actions                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team Aurora                        | Submit a category and description with roster-derived location. See only its own issues, public activity, summaries and award/application status. Send public replies on active issues. Reopen its resolved issues with a public reason         |
| Sam Chen, volunteer                | All-team queue, status filters, ownership, locations, elapsed time. Claim open issues. Escalate owned issues. Resolve owned issues. Send public replies and internal notes. Reopen resolved session issues. Confirm pending award application |
| Dr. Maya Rao, technical specialist | View the all-team queue. Claim open issues directly. Request or accept pending handoffs. Resolve owned issues. Send public replies and internal notes. Reopen resolved session issues. Confirm pending award application                                                            |
| Alex Morgan, jury                  | Resolved issues with stopped timers, assignment delay, resolution and activity. Record awards. Confirm pending award application                                                               |

Robin Ellis is the fifth persona, labeled **Volunteer + Technical specialist**. Both roles apply at once. A fixed role mapping combines capabilities; no active-role switch or role editor exists. People, rather than roles, own issues and appear in activity/award records. Support plus jury membership also retains the active queue and exposes award controls on resolved issues; a test fixture verifies this combination without adding another seeded persona. Jury-only membership cannot claim or reopen.

The layout stacks the queue and details on phone screens. Labeled native controls, a skip link, visible focus outlines and status/error messages support keyboard use. The interface shows the first matching issue if the selected issue is outside the current filter. Reopening under a Resolved filter switches to In progress and keeps that issue selected.

## Lifecycle and acceptance

- Submission creates an `ISS-` issue and starts the timer. Categories come from seed configuration. Descriptions, replies, summaries and explanations must contain 1–2,000 non-whitespace characters.
- Claim records the first assignment timestamp. The demo calculates unresolved time from persisted submission, resolution and reopening timestamps, excluding time spent resolved. First assignment always uses the original submission and assignment. The interface updates running timers every second.
- Escalation targets the technical specialist and retains the current support person as owner. A different specialist must accept; the owner cannot accept their own handoff through another role. Acceptance transfers ownership without changing first assignment. The retained owner can also resolve a pending handoff. Acceptance then becomes unavailable.
- Resolution requires the current owner and a public summary, stops the timer, and closes further conversation. Resolved issues appear in the jury view.
- Reopening requires a public reason of 1–2,000 trimmed characters. The team's contestant or any support helper may reopen a resolved issue. It returns to In progress with the same ID and previous owner; no old escalation is restored. All summaries, resolution/reopening actors and timestamps remain in structured records and public activity. Replies resume. Only the owner can resolve again, with a fresh summary. Multiple cycles are supported; blank, cross-team, jury-only, repeated and backwards-time actions fail without mutation.
- Existing pending/applied awards survive reopening and refer to their original resolution record. The UI explains that the award belongs to an earlier resolution. Staff can confirm pending application while an issue is active. A new award still requires a currently resolved issue with no prior award; adjustments remain deferred.
- Public replies and internal notes have explicit visibility. Contestant views omit internal entries entirely. All activity identifies its fictional actor. Users can modify this local history through browser storage. It is not a tamper-resistant audit log.
- A jury award references one resolved issue and records positive whole minutes plus a public explanation. It is discretionary and independent of measured elapsed time. The demo supports at most one award per issue. Users cannot edit or revoke awards in this demo.
- An award remains pending until staff explicitly check the simulation confirmation and record external application. This records a separate actor/timestamp and never changes an external clock. Contestants see both states.
- Domain rules reject repeated claims, escalation, acceptance, resolution, awards and application confirmations. Repeated award actions cannot create multiple ledger entries.
- Browser storage uses `minsky.demo.v2` and a v2 schema with workflow consistency checks. When v2 is absent, validated v1 data maps legacy personas to the same fictional people and resolved issues to initial resolution records. Migration preserves IDs, timestamps, handoffs, messages, awards/application status and the v1 source. Existing v2 takes priority, and invalid v2 never falls back to v1. Refresh preserves timestamps, notes and awards. The demo preserves corrupt or incompatible saved data until reset. The interface shows persistence failures.
- Reset, after a native confirmation dialog, writes a fresh v2 fictional seed scenario so v1 progress cannot return after refresh. It does not remove unrelated browser storage.

## Boundaries

The demo excludes authentication, authorization boundaries, uploads, push, a backend, synchronization, CSV import, shared incidents, administration, individual-contest workflows, and external clock integration. Developers can change categories in code. There is no configuration UI. The demo supports one tab, one device, and five seeded personas with fixed role memberships. Persistence is not an offline-operation design. Production and outage requirements remain in [product-direction.md](product-direction.md).

Verification combines focused domain/storage tests, a complete cross-persona browser journey, phone/keyboard checks, and the [manual guide](manual-verification.md).
