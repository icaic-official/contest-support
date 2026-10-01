# T0001 demo specification

Status: implemented; verification results are recorded in [current-state.md](current-state.md). Development tickets (`T0001`) are separate from contestant issues (`ISS-001`).

## Screens and seeded session

One fictional group-contest session contains Aurora (Hall A, Desk 12), Cedar (Hall A, Desk 18), and Orbit (Hall B, Desk 04). Reset creates an open Aurora display issue, a Cedar backend issue awaiting a specialist, and a resolved Orbit question about units. Seed timestamps are relative to reset time.

| Persona                            | View and actions                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team Aurora                        | Submit a category and description with roster-derived location; see only its own issues, public activity, summaries and award/application status; send public replies on active issues         |
| Sam Chen, volunteer                | All-team queue, status filters, ownership, locations, elapsed time; claim open issues; escalate and resolve owned issues; public replies and internal notes; confirm pending award application |
| Dr. Maya Rao, technical specialist | All-team queue; accept pending handoffs; resolve owned issues; public replies and internal notes; confirm pending award application                                                            |
| Alex Morgan, jury                  | Resolved issues with stopped timers, assignment delay, resolution and activity; record awards; confirm pending award application                                                               |

The layout stacks the queue and details on phone screens. Labeled native controls, a skip link, visible focus outlines and status/error messages support keyboard use. The first matching issue is shown if the selected issue is outside the current filter.

## Lifecycle and acceptance

- Submission creates an `ISS-` issue and starts the timer. Categories come from seed configuration. Descriptions, replies, summaries and explanations must contain 1–2,000 non-whitespace characters.
- Claim records the first assignment timestamp. Elapsed time is derived from persisted submission and resolution timestamps; running timers render every second.
- Escalation targets the technical specialist and retains the volunteer as owner. Acceptance transfers ownership without altering first assignment. The retained volunteer can also resolve a pending handoff; acceptance then becomes unavailable.
- Resolution requires the current owner and a public summary, stops the timer, and closes further conversation. Resolved issues appear in the jury view.
- Public replies and internal notes have explicit visibility. Contestant views omit internal entries entirely. All activity identifies its fictional actor; this is local history, not a tamper-resistant audit log.
- A jury award references one resolved issue and records positive whole minutes plus a public explanation. It is discretionary and independent of measured elapsed time. At most one award per issue is supported; awards cannot be edited or revoked in this demo.
- An award remains pending until staff explicitly check the simulation confirmation and record external application. This records a separate actor/timestamp and never changes an external clock. Contestants see both states.
- Domain rules reject repeated claims, escalation, acceptance, resolution, awards and application confirmations. Repeated award actions cannot create multiple ledger entries.
- Browser storage uses a versioned key and schema with workflow consistency checks. Refresh preserves timestamps, notes and awards. Corrupt or incompatible saved data is left untouched until reset; persistence failures are visible.
- Reset, after a native confirmation dialog, replaces demo progress with the fictional seed scenario. It does not remove unrelated browser storage.

## Boundaries

No authentication, authorization boundary, uploads, push, backend, synchronization, CSV import, shared incidents, administration, individual-contest workflow, or real external clock integration. Categories can be changed in code; there is no configuration UI. One tab, one device and one simulated staff member per role are supported. Persistence is not an offline-operation design. Production and outage requirements remain in [product-direction.md](product-direction.md).

Verification combines focused domain/storage tests, a complete cross-persona browser journey, phone/keyboard checks, and the [manual guide](manual-verification.md).
