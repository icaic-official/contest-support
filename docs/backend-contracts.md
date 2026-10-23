# Backend contracts

The browser uses `Backend` in [contracts.ts](../src/backend/contracts.ts) for accounts, workflows, administration, images, and live updates.
An adapter implements those operations for a provider.
Cloudflare is the active development implementation.
The Supabase adapter remains available for Supabase builds and isolated provider verification.
Both implementations use the same contract.
See [current state](current-state.md) for source-specific verification and deployment limits.

The contracts describe Minsky operations.
They do not expose database queries, access tokens, provider clients, or channel objects.
The server still checks permissions and applies each workflow command as a transaction.
A transaction commits all changes for a command together, or commits none.
For implementation and registration steps, use [Add a backend provider](add-provider.md).
The [frontend architecture](frontend-architecture.md) describes the application shell, feature modules, and browser routes that use these contracts.

## Shared server workflow

[WorkflowService](../src/server/workflow.ts) applies all nine existing issue commands.
The service validates input, applies the existing decisions, handles receipts, and bounds conflict retries.
`WorkflowPersistence` supplies authorized reads and guarded atomic commits.
Its operation-level methods expose no SQL or generic transaction callback.
The [workflow reference](server-workflow.md) records the compatibility baseline and each responsibility.

The opt-in [Supabase workflow function](../supabase/functions/workflow/index.ts) authenticates the bearer token through Auth `getUser()`.
It constructs `Caller` from the verified account and login, then executes the shared service.
Its [persistence adapter](../src/server/adapters/supabase/store.ts) calls service-only read and commit RPCs.
PostgreSQL rechecks current access and captured dependencies before committing state, receipt, history, and notification counters together.
Private versions detect concurrent changes without exposing private activity through public revisions.

[createServerWorkflowExecutor()](../src/backend/supabase/workflow.ts) preserves the `Backend.workflows.execute` signature for replacement verification.
The Supabase browser adapter calls the guarded `public.workflow` RPC.
Its administration, snapshots, images, and live updates retain their existing Supabase paths.
The active Cloudflare application executes workflow commands through the shared service and guarded D1 batches.
Issue decisions use one shared service. Other operations remain inside their provider implementations.
Use [the Supabase provider verification guide](verify-server-workflow.md) for that provider's isolated execution path and separate evidence categories.

## Complete Cloudflare implementation

[createCloudflareBackend()](../src/backend/cloudflare/backend.ts) implements the complete browser contract through same-origin HTTP and cookies.
[applicationWorker.ts](../src/server/adapters/cloudflare/applicationWorker.ts) serves the application and its API.
The Worker obtains `Caller` from the maintained identity service. Request bodies cannot supply that identity.
Mutation routes check the exact origin, current session, and request-protection token.
JSON bodies are limited to 16 KiB. Image transfers require an exact length and an R2-verified SHA-256 checksum.

The [D1 store](../src/server/adapters/d1/store.ts) persists all nine `WorkflowService` commands.
Its batches recheck credentials, generation, identity-session expiry, application-login expiry, current permissions, and captured state.
One database timestamp supplies each workflow commit's ledger and history records.
State, receipts, history, resolutions, awards, and audience notifications commit together.
The complete schema adds migrations `0005` through `0009` to the authentication foundation.

[D1ApplicationService](../src/server/adapters/cloudflare/application.ts) returns each authorized snapshot in one database statement.
Snapshots preserve names, timestamps, history, awards, image metadata, limits, and administrator records.
A valid login with removed membership receives an empty snapshot with null membership.
An invalid login cannot authorize that read.
Administration batches recheck current access and protect the last administrator.

[R2ImageService](../src/server/adapters/cloudflare/images.ts) owns immutable reservations, private transfers, completion, and deletion recovery.
Reservations count toward concurrent quotas. Completion rechecks current access and limits.
Downloads check access again after the storage read.
Deletion tasks retain exact object keys after successful cleanup, so recovery can remove a late interrupted transfer.

[SessionLiveCoordinator](../src/server/adapters/cloudflare/live.ts) delivers only `ready` and `change` hints.
It rechecks current permissions before each delivery and closes expired or revoked connections.
Persisted audience cursors suppress old duplicate delivery. A reconnect signals a fresh authorized snapshot.
The outbox remains pending until the coordinator accepts delivery. Minutely maintenance retries delivery and image cleanup.

Provider-owned [installation tooling](../src/server/adapters/cloudflare/tooling/install.mjs) checks exact targets and protects returned credentials.
See [installation](../site/src/content/docs/operators/installation.md), [provider verification](run-provider-tests.md), and [current evidence](current-state.md).

## Module boundaries

| Module | Responsibility |
| --- | --- |
| [contracts.ts](../src/backend/contracts.ts) | Defines `Backend` and each group of operations. |
| [errors.ts](../src/backend/errors.ts) | Defines workflow rejection and image retry errors. |
| [index.ts](../src/backend/index.ts) | Creates the selected implementation from public configuration. |
| [supabase/backend.ts](../src/backend/supabase/backend.ts) | Calls Supabase Auth, database functions, account administration, and Realtime. |
| [supabase/images.ts](../src/backend/supabase/images.ts) | Calls the attachment function and private Storage bucket. |
| [supabase/workflow.ts](../src/backend/supabase/workflow.ts) | Provides the opt-in Edge Function executor for shared workflow verification. |
| [cloudflare/backend.ts](../src/backend/cloudflare/backend.ts) | Calls the same-origin API and manages independent live connections. |
| [server/adapters/cloudflare/applicationWorker.ts](../src/server/adapters/cloudflare/applicationWorker.ts) | Constructs Cloudflare services and handles application and maintenance requests. |
| [server/adapters/cloudflare/application.ts](../src/server/adapters/cloudflare/application.ts) | Reads authorized snapshots and commits guarded administration changes. |
| [server/adapters/cloudflare/images.ts](../src/server/adapters/cloudflare/images.ts) | Manages private image reservations, transfers, publication, and cleanup. |
| [server/adapters/cloudflare/live.ts](../src/server/adapters/cloudflare/live.ts) | Delivers audience-specific invalidations and manages current connection access. |
| [server/workflow.ts](../src/server/workflow.ts) | Defines shared decisions, orchestration, and the operation-level persistence interface. |
| [server/adapters/supabase/store.ts](../src/server/adapters/supabase/store.ts) | Calls service-only guarded persistence RPCs from trusted server code. |
| [model.ts](../src/connected/model.ts) | Defines workflow commands and validates snapshots. It has no provider imports. |
| [imageFile.ts](../src/connected/imageFile.ts) | Defines file checks, attachment paths, and error classification shared with the attachment function. |

The UI imports the contracts and `requireBackend()`.
ESLint restricts provider SDKs, browser implementations, and server adapters in shared application code.
The UI can import the contracts, shared errors, and selected backend factory.
The same provider pattern protects shared server rules and test scenarios.
ESLint checks static imports, re-exports, and literal dynamic UI imports.
ESLint rejects computed dynamic UI paths because it cannot determine their provider.
Provider modules and the backend registration file retain access to their implementation dependencies.
Both complete browser adapters have provider-owned fixture drivers.

`Backend` defines behavior without requiring a distinct browser transport for every hosting provider.
The current Cloudflare browser transport uses HTTP, cookies, and WebSockets without Cloudflare SDKs.
A server with that same protocol can reuse it. Different protocols can implement `Backend` directly.
Deployment bindings and provider secrets remain outside the shared application contracts.
AWS, GCP, and Azure have no implementation or verified installation path.

Supabase builds use `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
For a Supabase build, `backend` is `undefined` when either value is missing.
`requireBackend()` then throws the setup message shown on the login page.
`VITE_BACKEND` defaults to `cloudflare`. Set `supabase` to select the Supabase provider.
The Cloudflare adapter calls the same origin.
Other values fail configuration. There is no automatic fallback between providers.

## Authentication

`Backend.auth` exposes these operations.

| Operation | Result |
| --- | --- |
| `currentUser()` | Returns `AccountIdentity` or `undefined`. The identity contains `id`, optional `email`, and optional `name`. |
| `subscribe(onChange)` | Reports the current account when authentication changes. Reports `undefined` after sign-out. Returns a cleanup function. |
| `signIn(username, password)` | Signs in with organizer credentials. The Supabase implementation normalizes usernames and retains existing email login. |
| `signOut()` | Ends the login through the provider. |
| `accountStatus()` | Returns `username`, `must_change`, and `session_valid`. |
| `changePassword(currentPassword, newPassword)` | Updates the password, then completes the mandatory-password check. Resolves only when both operations succeed. |

`currentUser()` restores the browser's login state.
Its result does not grant access to contest data.
Server checks enforce password changes, revoked logins, session membership, and roles.

Authentication subscriptions invoke callbacks synchronously.
Their cleanup function can run more than once.
No callback runs after cleanup returns.

The Cloudflare adapter implements this same authentication contract through same-origin HTTP and HttpOnly cookies.
Password changes return a fresh session after the atomic credential commit. All earlier sessions are revoked.
The complete browser factory supplies the other `Backend` groups.
After a reset removes an identity session, `accountStatus()` returns a restricted status with no account identity.
See the [authentication reference](cloudflare-authentication.md) for current checks, endpoints, expiry, and request protection.

## Session reads and workflow commands

`Backend.workflows.sessions(userId)` returns the account's accessible session IDs and names.
The authenticated caller determines access at the server.
The supplied `userId` does not confer access to another account.

`snapshot(sessionId)` returns a validated `Snapshot`.
The snapshot includes permitted issues, history, resolutions, awards, image records, members, limits, and server time.
The server excludes private data that the caller cannot access.

`execute(sessionId, requestId, command)` returns the affected issue ID.
`Command` retains the existing action names, expected issue revision, and action fields in `model.ts`.
The request ID identifies one attempted action, including its retries.
The adapter sends the ID and command unchanged.
The server prevents a repeated request from creating another action.

`WorkflowRejectedError` means that the server rejected the command.
The UI can clear the pending request and accept a new command.
Other failures leave the write outcome unknown.
The UI retains the request ID and command for **Retry last request**.
An invalid success response also leaves the outcome unknown because the write may have committed.

The Supabase adapter maps a nonempty database error code to `WorkflowRejectedError`.
It does not treat a transport error as a confirmed rejection.
The opt-in Edge executor maps only a validated typed rejection to `WorkflowRejectedError`.
Unexpected HTTP responses and malformed bodies retain an unknown outcome.

## Administration

`Backend.admin.account(sessionId, command)` accepts `create_account`, `set_username`, or `reset_password`.
`AccountCommand` specifies each action's required fields.
The result contains `temporaryPassword` when the action creates replacement credentials.

`saveMember()` assigns the team, roles, and admin flag.
`removeMember()` revokes membership in one session.
`setIntake()` changes contestant intake.
`setImageLimits()` sets the file size, image count, and combined size.
The size inputs use the existing UI convention of 1,048,576 bytes per MB.

Supabase database functions and the account function retain their current authorization rules.
Account resets and username changes require admin access to every affected session.
The browser adapter does not implement those checks.

## Images

`Backend.images` implements `ImageTransport`.

| Operation | Result |
| --- | --- |
| `begin(input)` | Reserves an image using the request ID, issue, visibility, name, and size. Returns the image ID and original and thumbnail paths. |
| `upload(path, body, contentType, onProgress)` | Uploads one object and reports the bytes sent. |
| `finish(sessionId, attachmentId)` | Validates and publishes the reserved image. A repeat after a lost success response does not publish another image. |
| `remove(sessionId, attachmentId)` | Removes the image through the authorized server operation. A failed file deletion remains retryable. |
| `abandon(sessionId, attachmentId)` | Cleans up an unfinished upload. |
| `download(path)` | Returns a `Blob` after the storage service checks access. |

Each download checks current access instead of reusing an earlier authorized response.
The Supabase adapter uses a fresh `cacheNonce` and `cache: 'no-store'` for private image reads.
The nonce bypasses the provider cache, as described in [Supabase's cache guidance](https://supabase.com/docs/guides/storage/cdn/smart-cdn#bypassing-cache).
These checks cannot retract bytes that a user already received.

`attachmentPath()` defines the common object key as `sessionId/issueId/attachmentId/original` or `sessionId/issueId/attachmentId/thumbnail`.
An implementation can translate these keys to its storage system.
An object key is not a public URL or an access credential.

`ImageRequestError.validation` marks a rejected upload.
`restart` carries the existing retry classification.
`incomplete` means that `finish()` requires the original or thumbnail upload to complete first.
The UI uses `incomplete` to resume upload after a retry check.
It does not inspect a provider's error text for that decision.

## Live updates

`Backend.updates.subscribe()` accepts the session ID, user ID, `onChange`, and `onConnection`.
`onChange()` signals that the current snapshot may be stale.
It does not deliver issue bodies, staff notes, or membership records.
`onConnection(true)` reports that the database subscription is ready to receive changes.
The Supabase adapter sets `postgres_changes_options.wait` to `true` before it reports that state.
The UI fetches a new authorized snapshot when that connection opens or reconnects.

The cleanup function can run more than once and stops subsequent callbacks.
Subscriptions on the same `Backend` are independent, including when an earlier subscription is still closing.
The Supabase adapter assigns each subscription a unique channel topic to prevent SDK channel reuse.
The UI also refreshes every ten seconds and on focus or network restoration.
Those reads detect revoked access even when the subscriber receives no more events.
Live notifications do not authorize reads or writes.

## Verification coverage

`npm test` includes Supabase adapter tests with controlled HTTP responses and subscription callbacks.
Those tests cover request translation, response validation, write outcomes, password completion, image errors, and subscription cleanup.
The existing embedded PostgreSQL tests continue to check database rules.

`npm run test:e2e` uses the application with mocked provider responses.
It covers request-ID reuse after an uncertain write and a new request after a definitive rejection.
The suite also covers the existing account, team-search, image, and refresh behavior.

Those mocked checks establish request and UI behavior. Hosted provider checks run separately.
`npm test` also checks complete D1 persistence through `WorkflowPersistence`.
It includes shared-service rules and Supabase persistence tests with embedded PostgreSQL.
`npm run test:workflow:hosted` exercises the deployed opt-in Supabase function with the shared workflow scenarios and additional boundary checks.
That runner permits only the approved Minsky CI project. It does not activate the replacement in development.
Hosted checks use isolated accounts and records through [protected cloud CI](cloud-onboarding.md#verification-and-protected-cloud-ci).
The [shared provider suite](provider-test-contracts.md) checks these contracts through real browser adapters.
Supabase and Cloudflare have separate fixture implementations with the same scenario assertions.
[Run the shared checks](run-provider-tests.md) separately from the provider-specific hosted UI suite.
The latest observed results are in [current state](current-state.md).
