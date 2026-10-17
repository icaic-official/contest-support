# Backend contracts

The browser uses `Backend` in [contracts.ts](../src/backend/contracts.ts) for accounts, workflows, administration, images, and live updates.
An adapter implements those operations for a provider.
The Supabase adapter is the only complete implementation.
T0018 adds an experimental Cloudflare authentication adapter without changing the active backend.

The contracts describe Minsky operations.
They do not expose database queries, access tokens, provider clients, or channel objects.
The server still checks permissions and applies each workflow command as a transaction.
A transaction commits all changes for a command together, or commits none.

## Experimental application store

T0017 adds a separate server interface in [applicationStore.ts](../src/server/applicationStore.ts).
It defines `execute()` for `claim` and `message`, plus a limited `issue()` view.
This interface does not replace the full browser `Backend` or select a different active provider.
The [proof guide](d1-transaction-proof.md) describes local and hosted checks.

`Caller` contains an account ID and login ID from a trusted identity adapter.
These values must never come directly from an HTTP request body.
T0018 supplies trusted callers through the [Cloudflare authentication service](cloudflare-authentication.md).
The D1 adapter checks the login, expiry, account restrictions, membership, team, roles, and event inside the database.
The issue view uses one primary query for its permission check, permitted history, and audience sequence.
An archived event permits reads but prevents command commits and receipt replay.

`execute()` returns a committed issue ID, a confirmed rejection, or an unknown outcome.
An unknown outcome retains the original request ID and command for retry.
Only a known assertion rollback or duplicate receipt permits internal reevaluation, with at most three attempts.
Exhausted attempts return `unknown`. They expose no private conflict or internal version.
Unexpected database errors and transport failures also preserve an unknown outcome.

The [D1 adapter](../src/server/adapters/d1/store.ts) commits these records in one `batch()`:

1. Reserve the unique actor and request ID with the canonical command and result ID.
2. Assert current access and captured account, login, membership, session, event, and issue versions.
3. Update the issue and assert that exactly one row changed.
4. Insert authenticated history and advance the permitted audience sequences.
5. Insert notification records and remove the assertion rows.

Assertion rows use `NOT NULL` and `CHECK (valid = 1)` so false or missing conditions raise an error.
A failed assertion rolls back the receipt and every later write.
D1 documents atomic [batch rollback](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
The adapter uses ordinary primary bindings. It does not use read replicas or the Sessions API.

The receipt compares the session ID and parsed command content with fixed object key order.
It preserves original text, including whitespace, for comparison.
The adapter trims message text before writing history and limits the trimmed value to 2,000 characters.
Current access checks precede receipt replay.
A private message changes the internal issue version and staff sequence only.
Contestant views omit internal history and versions. Team sequence values change only for public activity.
Notification rows contain audience and sequence values, without issue text.
Notification delivery remains later work.

The experimental [schema](../src/server/adapters/d1/migrations/0001_transaction_proof.sql) retains UUID identifiers and combined role records.
Triggers advance access and membership versions when permissions change.
The [version guard](../src/server/adapters/d1/migrations/0002_version_guards.sql) requires every issue writer to advance its internal version.
T0018 extends this schema for bounded authentication. Remaining operations, timestamp migration encoding, and the complete connector schema require later work.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| [contracts.ts](../src/backend/contracts.ts) | Defines `Backend` and each group of operations. |
| [errors.ts](../src/backend/errors.ts) | Defines workflow rejection and image retry errors. |
| [index.ts](../src/backend/index.ts) | Creates the selected implementation from public configuration. |
| [supabase/backend.ts](../src/backend/supabase/backend.ts) | Calls Supabase Auth, database functions, account administration, and Realtime. |
| [supabase/images.ts](../src/backend/supabase/images.ts) | Calls the attachment function and private Storage bucket. |
| [model.ts](../src/connected/model.ts) | Defines workflow commands and validates snapshots. It has no provider imports. |
| [imageFile.ts](../src/connected/imageFile.ts) | Defines file checks, attachment paths, and error classification shared with the attachment function. |

The UI imports the contracts and `requireBackend()`.
`npm run lint` rejects provider imports outside the Supabase implementation and the backend entry point.
The active application server functions and browser fixture driver remain specific to Supabase.
The separate D1 proof has its own server adapter and isolated fixtures.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` remain the browser configuration.
`backend` is `undefined` when either value is missing.
`requireBackend()` then throws the setup message shown on the login page.
There is no provider selector or automatic fallback.

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

The experimental Cloudflare adapter implements this same authentication contract through same-origin HTTP and HttpOnly cookies.
Password changes return a fresh session after the atomic credential commit. All earlier sessions are revoked.
Its extra `account()` and `sessions()` methods cover this bounded ticket. Other `Backend` groups remain incomplete.
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

These checks do not verify a hosted provider or a second complete browser adapter.
`npm test` also includes the local D1 application-store proof described above.
Hosted checks use isolated accounts and records through [protected cloud CI](cloud-onboarding.md#verification-and-protected-cloud-ci).
The [shared provider suite](provider-test-contracts.md) checks these contracts through real browser adapters.
Supabase supplies the first fixture implementation. Other providers remain unimplemented.
[Run the shared checks](run-provider-tests.md) separately from the provider-specific hosted UI suite.
The latest observed results are in [current state](current-state.md).
