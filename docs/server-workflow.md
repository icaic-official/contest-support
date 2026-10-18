# Server workflow reference

T0019 extracts the existing issue decisions into [workflow.ts](../src/server/workflow.ts).
`WorkflowService` accepts all nine existing `Command` variants.
Its rules contain no provider SDK, SQL, environment configuration, or provider selection.
The [verification guide](verify-server-workflow.md) describes the checks.
[Current state](current-state.md) records observed results.

Supabase remains the active backend.
The active browser adapter still calls the legacy `public.workflow` RPC.
The separate `workflow` Edge Function runs the shared service against Supabase for replacement verification.
An opt-in [browser executor](../src/backend/supabase/workflow.ts) calls that function with the existing `Backend.workflows.execute` signature.
This ticket does not activate that executor in the application or deploy to the development backend.

## Existing compatibility baseline

The browser [Command type](../src/connected/model.ts) defines the action names and fields.
The effective PostgreSQL implementation comes from these migrations, in order:

| Migration | Effective responsibility |
| --- | --- |
| `202610020001_cloud.sql` | Creates workflow tables, constraints, policies, and the original workflow. |
| `202610020002_indexes.sql` | Adds indexes and the receipt actor relationship. |
| `202610020003_private_signals.sql` | Replaces the workflow and separates internal activity from public revisions and notifications. |
| `202610020004_usernames.sql` | Moves that implementation to `app_private.workflow_before_usernames`. Wraps it with the mandatory-password and login gate. |
| `202610020005_admin_recovery.sql` | Adds restricted administrator recovery. Does not replace workflow. |
| `202610110001_attachments.sql` | Adds image operations and snapshot fields. Does not replace workflow. |
| `202610140001_attachment_fixes.sql` | Strengthens image and credential guards and replaces the snapshot. Does not replace workflow. |

The shared rules retain these decisions:

| Command | Access and transition | Recorded result |
| --- | --- | --- |
| `submit` | Contestants submit for their membership team while intake is open. Volunteers and specialists can submit for a roster team with closed intake. | Open issue, submission time, reporter, category, description, and public history. |
| `claim` | A volunteer or specialist claims an open issue. | Owner, claimed status, and first assignment time. |
| `escalate` | The current support owner escalates a claimed issue. | Escalated status. The owner remains assigned. |
| `accept` | Another specialist accepts an escalated issue. | New owner and claimed status. The first assignment time remains unchanged. |
| `message` | The affected team, support, or jury replies to an unresolved issue. Internal notes additionally require staff access. | Public reply or internal note with the authenticated actor. |
| `resolve` | Only the current support owner resolves a claimed or escalated issue. | A new resolution summary, actor, and time. The timer stops. |
| `reopen` | The affected team or support reopens a resolved issue. Intake state does not restrict reopening. | Reopening reason, actor, and time. Claimed status resumes with the prior owner. |
| `award` | Jury awards nonnegative whole minutes to a resolved issue. Only one award can exist per issue. | Award linked to the current resolution, with an explanation and actor. Zero minutes is valid. |
| `apply` | Support or jury confirms a pending award, including after reopening. | Separate application time and actor. Minsky changes no external clock. |

Support means volunteer or specialist.
Assigned roles combine capabilities.
An administrator flag alone grants no support, jury, or conversation capability.
Contestant membership and staff membership are mutually exclusive in the database.
Staff can read every team in their session.
Contestants can read only their own team.

Text fields retain PostgreSQL `btrim(text)` behavior, which removes surrounding spaces.
The 2,000-character limit counts Unicode code points.
Every non-submit command supplies the expected public issue revision.
Persisted resolution intervals determine unresolved time.
Reopening preserves every resolution, the original submission and first assignment times, and the award and application records.

## Shared service and persistence boundary

| Component | Responsibility |
| --- | --- |
| `WorkflowService` | Validates input, compares original commands for receipt replay, decides an operation, and bounds internal retries. |
| `decideWorkflow()` | Applies the existing access and lifecycle decisions to explicit state. Returns required effects or a typed rejection. |
| `WorkflowDecision` | Describes issue changes, resolution or award effects, and history visibility. Does not contain database instructions. |
| `WorkflowPersistence.read()` | Reads current authorized state, a receipt, and adapter-owned commit dependencies. |
| `WorkflowPersistence.commit()` | Rechecks current access and dependencies. Commits the decision, receipt, history, and notifications together. |
| Trusted HTTP entry point | Verifies the caller before constructing `Caller`. Maps typed results to responses. |

The persistence interface exposes two operation-level methods.
It exposes no arbitrary query API, generic table operations, or transaction callback.
The adapter owns authoritative commit timestamps and generated record identifiers.
The dependency value remains inside trusted server code.
The browser cannot submit a decision or an account identity as proof of access.

## Supabase execution path

The opt-in execution path contains these components:

1. [workflow/index.ts](../supabase/functions/workflow/index.ts) verifies the bearer token through Supabase Auth `getUser()`.
2. [http.ts](../src/server/adapters/supabase/http.ts) accepts the command envelope and passes the verified account and login to the service.
3. `WorkflowService` reads through [the Supabase adapter](../src/server/adapters/supabase/store.ts) and computes a decision.
4. `shared_workflow_commit` checks current access and captured dependencies before writing the decision atomically.

The function uses an explicit origin allowlist and does not cache responses.
Its service key stays in the server environment.
The browser receives no privileged database credential.

The [T0019 migration](../supabase/migrations/202610180001_shared_workflow.sql) grants the read and commit RPCs only to `service_role`.
It revokes PUBLIC, anonymous, and authenticated execution.
Direct browser writes remain forbidden by the existing grants and policies.
The RPCs accept trusted server decisions. They are not browser mutation APIs.

PostgreSQL retains atomic writes, foreign keys, uniqueness, timestamp constraints, and current-access checks.
The commit locks current dependencies and rejects a changed decision state.
The [expiry correction](../supabase/migrations/202610180002_shared_workflow_expiry.sql) checks the current wall clock after lock waits.
A login that expires during a wait cannot authorize a write or receipt replay.
Captured dependencies include the session, event, membership, person, account, credentials, login, teams, issue, current resolution, and award.
A private issue version also detects changes to history, resolutions, and awards.
Triggers maintain that version for legacy writers while both paths exist.

The legacy `public.workflow` and `app_private.workflow_before_usernames` remain during replacement verification.
Their protective SQL checks remain intact.
Administration, images, snapshots, and Realtime still use their existing Supabase implementations.
The complete application server is therefore not provider-independent.

## Requests, conflicts, and visibility

Receipts retain the authenticated actor, request ID, session, original command, and result issue ID.
JSON object key order does not change command equality.
Original text, including surrounding spaces, remains part of receipt equality.
Changed content under the same request ID produces a confirmed rejection.
Current access checks precede receipt replay.

The service distinguishes committed, rejected, and unknown results.
Only a known rolled-back conflict permits internal reevaluation, with at most three attempts.
Unexpected database errors, transport loss, and unreadable success responses preserve an unknown outcome.
The browser retains the original request ID and command for a retry.

Public activity advances the issue revision and affected-team notification counter.
Internal notes advance only the private version and staff notification counter.
Contestant snapshots omit internal history and private versions.
Private conflicts cannot reveal the private version or advance contestant-visible counters.

## Bounded D1 support

The [D1 adapter](../src/server/adapters/d1/store.ts) invokes the same service and decision rules for `claim` and `message`.
It retains its database access checks, captured versions, atomic batch, and notification records.
SQLite statements apply the shared decision and enforce commit conditions.
The adapter does not implement the other seven commands.

The [D1 proof](d1-transaction-proof.md) remains separate from hosted Supabase and protected GitHub Actions results.
Full D1 workflow persistence, a complete Cloudflare connector, R2, notification delivery, migration tooling, and AWS remain later work.
