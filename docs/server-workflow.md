# Server workflow reference

[workflow.ts](../src/server/workflow.ts) holds the issue decisions.
`WorkflowService` accepts all nine `Command` variants. Its rules contain no provider SDK, SQL, environment configuration, or provider selection.
Cloudflare is the only backend. Its application Worker runs the service through guarded D1 batches.

Contest-wide time awards, management commands, images, and announcements do not use this service. [Backend contracts](backend-contracts.md) lists them.

## Commands

The browser [Command type](../src/connected/model.ts) defines the action names and fields.
These rules apply while the event is not archived. An archived event rejects every command.

| Command | Access and transition | Recorded result |
| --- | --- | --- |
| `submit` | Contestants submit for their own team while intake is open. Any staff member can submit for a team of the contest, also when intake is closed. Staff means an admin or a person with a volunteer, specialist, or jury role. | Open issue, submission time, reporter, category, description, and public history. |
| `claim` | A volunteer or specialist claims an open issue. | Owner, claimed status, and first assignment time. |
| `escalate` | The current support owner escalates a claimed issue. | Escalated status. The owner remains assigned. |
| `accept` | Another specialist accepts an escalated issue. | New owner and claimed status. The first assignment time remains unchanged. |
| `message` | The affected team or any staff member replies to an unresolved issue. This includes an admin without other roles. Internal notes additionally require staff access. | Public reply or internal note with the authenticated actor. |
| `resolve` | The current support owner or an admin resolves a claimed or escalated issue. The owner stays assigned when an admin resolves. Minsky has no reassign action, so an admin must resolve a claimed issue whose owner lost their seat, unless that seat is restored. | A new resolution summary, actor, and time. The timer stops. |
| `reopen` | The affected team or support reopens a resolved issue. Intake state does not restrict reopening. | Reopening reason, actor, and time. Claimed status resumes with the prior owner. |
| `award` | Jury awards nonnegative whole minutes to a resolved issue. Only one award can exist per issue. | Award linked to the current resolution, with an explanation and actor. Zero minutes is valid. |
| `apply` | Support or jury confirms a pending award, including after reopening. | Separate application time and actor. Minsky changes no external clock. |
| `withdraw_award` | Jury withdraws a pending award that nobody confirmed, including after reopening. | Withdrawal time and actor on the same award row. The award gives no time, and the issue cannot take another award. The team does not read the award, but reads the public history entry. |

Support means volunteer or specialist.
Assigned roles combine capabilities.
Event admins and webmasters act as admins in every contest that they reach, with the roles of any membership that they also hold.
[capabilities.ts](../src/connected/capabilities.ts) holds these rules as one table.
An admin flag alone grants no support or jury capability. It grants replies, internal notes, image uploads, and the resolution of a claimed or escalated issue.
Contestant membership and staff membership are mutually exclusive. A membership with a team is a contestant seat.
Staff can read every team in their contest.
Contestants can read only their own team.

Text fields remove surrounding spaces.
Each text field holds 1 to 2,000 Unicode code points and no null character.
Every command except `submit` supplies the expected public issue revision.
Persisted resolution intervals determine unresolved time.
Reopening preserves every resolution, the original submission and first assignment times, and the award and application records.

## Shared service and persistence boundary

| Component | Responsibility |
| --- | --- |
| `WorkflowService` | Validates input, compares original commands for receipt replay, decides an operation, and bounds internal retries. |
| `decideWorkflow()` | Applies the access and lifecycle decisions to explicit state. Returns required effects or a typed rejection. |
| `WorkflowDecision` | Describes issue changes, resolution or award effects, and history visibility. Does not contain database instructions. |
| `WorkflowPersistence.read()` | Reads current authorized state, a receipt, and adapter-owned commit dependencies. |
| `WorkflowPersistence.commit()` | Rechecks current access and dependencies. Commits the decision, receipt, history, and notifications together. |
| [http.ts](../src/server/adapters/cloudflare/http.ts) | Verifies the caller before it constructs `Caller`. Maps typed results to responses. |

The persistence interface exposes two operation-level methods.
It exposes no arbitrary query API, generic table operations, or transaction callback.
The adapter owns authoritative commit timestamps and generated record identifiers.
The dependency value remains inside trusted server code.
The browser cannot submit a decision or an account identity as proof of access.

## Requests, conflicts, and visibility

Receipts retain the authenticated actor, request ID, contest, original command, and result issue ID.
JSON object key order does not change command equality.
Original text, including surrounding spaces, remains part of receipt equality.
Changed content under the same request ID produces a confirmed rejection.
Current access checks precede receipt replay.

The service distinguishes committed, rejected, and unknown results. A rejection has the reason `access`, `state`, `request_id`, or `input`.
Only a known rolled-back conflict permits internal reevaluation, with at most three attempts.
Unexpected database errors, transport loss, and unreadable success responses preserve an unknown outcome.
The browser retains the original request ID and command for a retry.
The service does not tell the browser where a command failed. A failed read wrote nothing in that attempt, but the service cannot tell a first send from a retry of an earlier send whose response was lost. So every failure keeps the unknown outcome.
`execute()` takes an optional last argument. The service passes it the phase and the error of each unknown result. The phase is `read`, `commit`, or `retries`.
The HTTP handler logs them as `workflow.failed`. The service never logs.

Public activity advances the issue revision and the affected team's notification counter.
Internal notes advance only the private version and the staff notification counter.
Contestant snapshots omit internal history and private versions.
Private conflicts cannot reveal the private version or advance contestant-visible counters.

## D1 workflow persistence

The [D1 adapter](../src/server/adapters/d1/store.ts) persists all nine decisions from `WorkflowService`.
The [application Worker](../src/server/adapters/cloudflare/applicationWorker.ts) constructs this adapter for authenticated HTTP commands.

Each new command uses one guarded D1 batch:

1. Check current access and the dependencies captured by the authorized read.
2. Obtain one database timestamp and apply the issue, resolution, or award effects.
3. Record authenticated history, the request receipt, audience sequences, and pending notifications.
4. Check current access again, then remove temporary assertion and timestamp rows.

Submission allocates an issue number inside that batch.
Resolution, reopening, awards, and external application retain their separate records and timestamps.
Internal notes change the private issue version and staff sequence without changing the public revision.
Foreign keys, unique constraints, and assertions prevent partial or stale effects from committing.
A false assertion fails the batch and rolls back its writes.

The read and the access checks embed the contest resolver in [authority.ts](../src/server/adapters/cloudflare/authority.ts). The resolver checks the account, the credential generation, the login, and the identity session. Its stamp covers every version that access depends on.
The dependency value holds that stamp, the identity session's expiry, the intake state, the issue's write version, its resolutions, and its award. It also holds the membership team and the team that a submit names.
A submit that crosses the close of intake therefore fails its batch, and the service reevaluates it.
Receipt replay crosses an atomic access check too. A previously successful request cannot authorize replay after access expires or is revoked.

The maintainer-only commands `npm run test:connector:workflow:hosted` and `npm run test:connector:accounts:hosted` run these checks against a D1-only CI target, with no application Worker or background delivery.
[Run the provider tests](run-provider-tests.md) gives the commands, target checks, and fixture recovery.
