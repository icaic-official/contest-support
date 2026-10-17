# Cloudflare authentication reference

T0018 implements experimental authentication and account sessions for Workers and D1.
Supabase remains the active application backend.
The Cloudflare workflow connector, migration, images, and live delivery remain incomplete.
This reference describes the implemented API. It does not describe a supported independent installation.

The [identity choice](cloudflare-authentication-choice.md) explains Better Auth, cryptographic components, limitations, and measured resource costs.
The [verification guide](verify-cloudflare-authentication.md) gives exact test commands and fixture recovery steps.

## Adapter boundaries

`AuthenticationService` defines the server interface without provider imports.
`createAuthenticationHandler()` validates HTTP requests and calls that interface.
`D1AuthenticationService` implements current access checks and atomic credential writes.
`createBetterAuthIdentity()` uses Better Auth's server API for login, session verification, and logout.
The raw Better Auth router is not exposed.

`createCloudflareAuthentication()` implements the existing browser `Authentication` contract.
Its additional `account()` and `sessions()` methods support this bounded API.
It does not implement or select a complete `Backend`.
The application's backend entry point still creates the Supabase adapter.

## HTTP endpoints

All responses use `Cache-Control: no-store`.
Authenticated endpoints read the HttpOnly cookie. Request bodies cannot supply an authenticated account ID.

| Method and path | Request | Result |
| --- | --- | --- |
| `POST /api/auth/sign-in` | `username`, `password` | Sets the session cookie. Returns an empty object. |
| `GET /api/auth/session` | Cookie | Returns `user`, `status`, and `csrf`. An absent or invalid login returns 401. |
| `POST /api/auth/sign-out` | Empty object | Revokes the login, deletes its identity session, and clears the cookie. |
| `POST /api/auth/change-password` | `currentPassword`, `newPassword` | Changes the password and replaces the cookie. Revokes every earlier login. |
| `GET /api/auth/sessions` | Cookie | Returns the account's current contest-session memberships. Requires a completed password change. |
| `POST /api/accounts` | `sessionId`, `command` | Performs `create_account`, `set_username`, or `reset_password`. Uses existing `AccountCommand` fields. |

The experimental D1 session table has no display name. Session summaries currently use the session ID as the name.
The complete connector must supply contest-session names.
Account creation and reset return `temporaryPassword` only in their authorized success response.
No endpoint retrieves an earlier temporary password.
Passwords and password hashes do not appear in audit records, responses for other actions, or application logs.

Errors use fixed messages and these status codes:

| Status | Meaning |
| --- | --- |
| 400 | Invalid input or rejected current-password verification. |
| 401 | Invalid credentials, expired login, revoked login, or restricted pending credentials. |
| 403 | Mandatory password change, insufficient current permissions, archived account, or failed request protection. |
| 409 | A guarded change failed or its commit outcome is unknown. Check account status before retrying. |
| 429 | The password-attempt limit was reached. Retry after the fixed window expires. |
| 503 | Identity or database service is unavailable. A write response can have an unknown outcome. |

## Credentials and permissions

Usernames contain 3 to 32 lowercase letters, digits, underscores, or hyphens.
The first character must be a letter or digit. Login trims spaces and normalizes letter case.
An assigned username cannot be replaced. An administrator can assign a missing username.
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
Account-wide username assignment and resets require admin access to every contest session assigned to the target account.
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

The browser adapter fetches a fresh CSRF token before each authenticated mutation.
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

Daily maintenance removes password-attempt counters and expired login records after a one-day retention period.
Login attempts allow ten attempts per normalized username per 15-minute window.
Self password verification uses a separate ten-attempt account window.
The replacement login after an authenticated password change does not consume a public username attempt.
Password verification and credential-generation checks still apply to that replacement login.
The hosted Worker also allows fifty login attempts per source IP per 15-minute window.
It stores a secret-salted IP digest rather than the address.
These pilot limits need later capacity review for venue networks that share an address.
