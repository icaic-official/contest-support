# Cloudflare authentication reference

The Cloudflare application uses maintained Better Auth identity operations and guarded D1 account records.
Cloudflare serves the development application.
This reference describes the authentication API and its access rules.
Use the [installation guide](../site/src/content/docs/operators/installation.mdx) for setup and [run log](history/run-log.md) for dated verification evidence.

The [identity choice](cloudflare-authentication-choice.md) explains Better Auth, cryptographic components, limitations, and measured resource costs.
The [verification guide](verify-cloudflare-authentication.md) gives exact test commands and fixture recovery steps.

## Adapter boundaries

`AuthenticationService` defines the server interface without provider imports.
`createAuthenticationHandler()` validates HTTP requests and calls that interface.
`D1AuthenticationService` implements current access checks and atomic credential writes.
`createBetterAuthIdentity()` uses Better Auth's server API for login, session verification, and logout.
The raw Better Auth router is not exposed.

`createCloudflareAuthentication()` implements the existing browser `Authentication` contract.
Its additional `account()` method supports account administration. The application route `GET /api/sessions` is the only contest list.
The complete `createCloudflareBackend()` factory wraps this authentication adapter and supplies the remaining operation groups.
The backend entry point always creates the Cloudflare client. No provider fallback occurs.

## HTTP endpoints

All responses use `Cache-Control: no-store`.
Authenticated endpoints read the HttpOnly cookie. Request bodies cannot supply an authenticated account ID.

| Method and path | Request | Result |
| --- | --- | --- |
| `POST /api/auth/sign-in` | `event`, `handle`, `password` | Sets the session cookie. Returns an empty object. `event` is the event code, or `null` for a site sign-in. |
| `GET /api/auth/session` | Cookie | Returns `user`, `status`, and `csrf`. An absent or invalid login returns 401. |
| `POST /api/auth/sign-out` | Empty object | Revokes the login, deletes its identity session, and clears the cookie. |
| `POST /api/auth/change-password` | `currentPassword`, `newPassword` | Changes the password and replaces the cookie. Revokes every earlier login. |
| `POST /api/accounts` | `sessionId`, `command` | Performs `create_account` or `reset_password`. Uses the `AccountCommand` fields. |

The historical authentication Worker uses the session ID as its summary name.
The complete application Worker routes session reads through the named application schema.
Account creation and reset return `temporaryPassword` and `signIn` only in their authorized success response.
`signIn` names the event code, or the site, that the account signs in with.
A handle change is the `set_handle` command of `POST /api/manage`.
No endpoint retrieves an earlier temporary password.
Passwords and password hashes do not appear in audit records, responses for other actions, or application logs.

Errors use fixed messages and these status codes:

| Status | Meaning |
| --- | --- |
| 400 | Invalid input or rejected current-password verification. |
| 401 | Invalid credentials, expired login, revoked login, or restricted pending credentials. |
| 403 | Mandatory password change, insufficient current permissions, archived account, or failed request protection. |
| 409 | A guarded change failed or its commit outcome is unknown. Check account status before retrying. |
| 429 | A failed-sign-in limit or the password-change limit was reached. Retry after the fixed window expires. |
| 503 | Identity or database service is unavailable. A write response can have an unknown outcome. |

## Credentials and permissions

Each account has two names:

- The **handle** is the username that a person types. It is unique inside one event, or among site accounts. The screens call it the username.
- The **login key** is the name that Better Auth knows, in `accounts.username` and `ba_user.username`. It is globally unique. Nobody types or sees it. A new account's login key is its ID without dashes. An account from before event sign-in keeps its old username as login key, and its handle starts equal to it.

A sign-in names an event code and a handle. A webmaster belongs to no event, so a webmaster chooses **Site sign-in**, which names no event code.
The server reads the account through the unique index of that namespace, and passes only the login key to Better Auth.
A wrong event code, handle, or password gives the same 401 message.
Every refusal spends one password hash or check.
The server refuses an unknown code or handle, and a disabled or pending account, before Better Auth runs. That refusal hashes the typed password, as Better Auth does for a login key that it does not know.
An unknown code and an unknown handle take the same path, so the refusal time does not show which codes exist.
A wrong password for a real account still takes slightly longer, because Better Auth reads the account from D1 before its check.

Handles contain 3 to 32 lowercase letters, digits, underscores, or hyphens.
The first character must be a letter or digit. Sign-in trims spaces and normalizes letter case.
`set_handle` changes only the handle. The password, the login key, and open sessions stay.
An account of an event can change its own handle when it holds no team seat in any contest. A contestant account cannot, because venue staff read its handle from the credential sheet. A webmaster cannot, because a webmaster belongs to no event.
`status.can_change_handle` in `GET /api/auth/session` reports this rule, so the account page shows the form only when `set_handle` accepts the change.
After a handle change, the open screens of each contest that seats the account refresh for staff and for the account.
An account that the caller may manage can also get a new handle.
An account without a login key gets one with its first temporary password.
The synthetic identity email is not a mailbox. SMTP and personal email are unnecessary.

New passwords contain 12 to 128 characters.
A password change requires the current password and a different password after Unicode NFKC normalization.
NFKC converts equivalent Unicode forms to the same password input.
Temporary passwords use 256 random bits plus a fixed character suffix.
Passwords remain in request memory. Neither adapter saves plaintext credentials in browser storage.

An account's application ID is also its Better Auth user ID.
Credential changes retain memberships, team assignments, roles, permissions, issue actors, and history.
Every protected operation checks current database state.
Signed cookies, browser identity, and cached UI roles cannot grant contest access.

Account creation requires current admin membership in the selected active contest session.
A contestant account receives a team. A staff account receives roles, admin membership, or both.
The team must belong to that session.
Account-wide handle changes and resets by a contest admin require admin access to every contest session assigned to the target account. An event admin manages every other account of the event. A webmaster manages every other account.
Any archived assigned event blocks those actions.
Self-resets are rejected. An account holder uses `changePassword()` instead.
Organizers verify the account holder's identity before issuing a recovery reset.
They distribute the returned temporary password through an approved private channel.
If that response is lost, another authorized reset replaces the unavailable credentials.

## Session authority and browser protection

Sessions last eight hours from login. Activity does not extend the lifetime.
Hosted cookies use `__Host-minsky-session`, `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`.
Cookies have no `Domain` attribute, so another hostname cannot receive the cookie.
Local HTTP development uses `minsky-session` without `Secure`, restricted to loopback hosts.
HTTPS browser tests use the hosted cookie settings.

Better Auth reads the current D1 session without cookie caching or a secondary session store.
Minsky also checks the approved login, expiry, revocation, credential generation, disabled flag, and pending credential state.
Contest access additionally requires `must_change = 0` and current membership and permissions.
The existing application store checks its approved login inside each guarded command batch.

Every request must target an explicitly configured origin.
If an `Origin` header exists, it must match that exact origin.
Every POST requires that origin header, `Content-Type: application/json`, and `X-Minsky-Request: 1`.
Authenticated POST requests also require `X-CSRF-Token` from the current session response.
The token prevents cross-site request forgery, where another site attempts an action with the user's cookie.
POST requests with cross-site fetch metadata are rejected. No CORS access or preflight permission is exposed.
Bodies are limited to 16 KiB. Redirected browser authentication requests fail.

The browser adapter keeps the token from the last session read and reuses it for later mutations.
The token belongs to one login. The adapter forgets it when a sign-in, sign-out or password change completes, and when a session read returns 401.
A 403 reply means the server stopped before it ran the request. The adapter then reads the session again, and sends the request one more time only when the token changed.
Subscriptions check session state every 60 seconds and on focus or page restoration.
Callbacks run synchronously. Subscription cleanup is idempotent and stops later callbacks.
Completed login, logout, and password-change requests invalidate earlier subscription reads, including reads started during the request.
Polling affects UI awareness only. Server revocation takes effect on the next protected operation.

Untrusted previews have no shared authentication binding or secret.
The isolated authentication Worker disables preview URLs.
Any later preview authentication needs its own origin, database, credentials, and fictional accounts.

## Atomic credential changes and recovery

Organizer resets first commit the mandatory-change gate, a new credential generation, revocations, and a pending audit operation together.
The adapter then hashes the new password outside the database batch.
Its final batch rechecks current organizer permissions and the pending operation ID.
That batch writes the identity credential and completion record together. The temporary-password gate remains set.
A superseded operation cannot replace a newer password.
An account captured while credentials are pending cannot approve a login after the reset completes.

An interrupted create or reset leaves the account restricted.
An authorized organizer can issue another reset. The new operation supersedes the earlier operation.
A lost success response requires another reset because the server cannot retrieve the temporary password.
An account whose initial identity creation failed retains its ID and membership during recovery.

Self password changes hash before their single guarded D1 batch.
The batch verifies the original login and credential generation, updates credentials, clears the gate, and revokes all earlier sessions together.
A hash failure or rejected atomic batch retains the earlier account state and login.
A lost database response can leave the commit outcome unknown and earlier logins revoked.
This lets a sole organizer retry an interrupted temporary-password change.
A committed change with a lost response allows login with the new password. Try that password before requesting recovery.
The browser receives a fresh session only after the credential commit.
The final self-change guard retains both original session deadlines while the batch deliberately revokes and deletes the old sessions.
Login creation also rechecks the captured credential generation and both current session expiries before completion.

Scheduled maintenance removes password-attempt counters and expired login records after a one-day retention period.
The application Worker runs it every minute. The isolated authentication CI Worker runs it daily.
Sign-in limits count failed sign-ins only. A successful sign-in never counts toward any limit.
The owner chose this policy on 2026-10-25, because all users at a venue can share one public IP address.
Each limit uses a fixed 15-minute window that starts at its first failure:

| Limit | Maximum failures | Effect at the maximum |
| --- | --- | --- |
| Handle in one event, or among site accounts | 10 | The Worker refuses that handle in that event with status 429. Other handles, and the same handle in another event, are not affected. A wrong event code counts against the typed code, so the limit does not show which codes exist. |
| Source IP | 200 | The Worker refuses every sign-in from that IP with status 429, even with a correct password. |

The Worker checks both counters before it verifies a password. It adds to them only after a rejected credential.
A refused attempt does not add to a counter and does not extend the window.
Requests that pass the check at the same time can all fail, so a count can pass its maximum.
The excess is at most the number of requests in flight when the count reaches the maximum.
The constants are in `signInFailureLimits` in `src/server/adapters/cloudflare/authentication.ts`.
The hosted Worker stores a secret-salted IP digest rather than the address.
One person who sends many failures can still lock one handle of one event for the rest of its window.
A person at a shared address needs more than 200 failures in 15 minutes to block that address.

Self password verification uses a separate ten-attempt account window. Every request counts, so this limit does not depend on the outcome.
The replacement login after an authenticated password change does not count toward any sign-in limit.
Password verification and credential-generation checks still apply to that replacement login.
