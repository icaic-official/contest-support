# Cloudflare authentication reference

The Cloudflare application uses maintained Better Auth identity operations and guarded D1 account records.
This reference describes the authentication API and its access rules.

[Install on Cloudflare](../site/src/content/docs/operators/installation.mdx) gives the setup. The [identity choice](cloudflare-authentication-choice.md) explains Better Auth, its cryptographic components, its limits, and its measured costs. The [verification guide](verify-cloudflare-authentication.md) gives the test commands and fixture recovery steps.

## Adapter boundaries

| Component | Responsibility |
| --- | --- |
| `AuthenticationService` | The server interface, with `current`, `signIn`, `signOut`, and `changePassword`. It has no provider imports. |
| `createAuthenticationHandler()` | Validates `/api/auth/` requests and calls that interface. |
| `D1AuthenticationService` | Implements current access checks, sign-in limits, and the atomic password change. |
| `createBetterAuthIdentity()` | Uses Better Auth's server API for login, session verification, and logout. The raw Better Auth router is not exposed. |
| `D1ManageService.issueCredentials()` | Issues temporary passwords through `POST /api/credentials`. It is a management route, not part of this adapter. |
| `createCloudflareAuthentication()` | Implements the browser `Authentication` contract. `createCloudflareBackend()` wraps it. |

The backend entry point always creates the Cloudflare client. No provider fallback occurs.

## HTTP endpoints

All responses use `Cache-Control: no-store`.
Authenticated endpoints read the HttpOnly cookie. Request bodies cannot supply an authenticated account ID.

| Method and path | Request | Result |
| --- | --- | --- |
| `POST /api/auth/sign-in` | `event`, `handle`, `password` | Sets the session cookie. Returns an empty object. `event` is the event code, or `null` for a site sign-in. |
| `GET /api/auth/session` | Cookie | Returns `user`, `status`, and `csrf`. `status` holds `handle`, `must_change`, `session_valid`, and `can_change_handle`. An absent or invalid login returns 401. |
| `POST /api/auth/sign-out` | Empty object | Revokes the login, deletes its identity session, and clears the cookie. |
| `POST /api/auth/change-password` | `currentPassword`, `newPassword` | Changes the password and replaces the cookie. Revokes every earlier login. |

`POST /api/auth/sign-in` returns 503 while the database holds no account, so public traffic cannot create rate-limit rows that fail the trusted bootstrap check.

`POST /api/credentials` returns each temporary password once, in its authorized success response. No endpoint retrieves an earlier temporary password.
Passwords and password hashes do not appear in audit records, in responses for other actions, or in application logs.

Errors use fixed messages and these status codes:

| Status | Meaning |
| --- | --- |
| 400 | Invalid input or rejected current-password verification. |
| 401 | Invalid credentials, expired login, revoked login, or restricted pending credentials. |
| 403 | Mandatory password change, insufficient current permissions, archived event, or failed request protection. |
| 409 | A guarded change failed or its commit outcome is unknown. Check account status before retrying. |
| 429 | A failed-sign-in limit or the password-change limit was reached. Retry after the fixed window expires. |
| 503 | Identity or database service is unavailable. A write response can have an unknown outcome. |

## Credentials and permissions

Each account has two names:

- The **handle** is the username that a person types. It is unique inside one event, or among site accounts. The screens call it the username.
- The **login key** is the name that Better Auth knows, in `accounts.username` and `ba_user.username`. It is globally unique. Nobody types or sees it. A new account's login key is its ID without dashes.

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
An account of an event can change its own handle when it is not an entrant's sign-in and holds no team seat in any contest. A contestant account cannot, because venue staff read its handle from the credential sheet. A webmaster cannot, because a webmaster belongs to no event.
`status.can_change_handle` in `GET /api/auth/session` reports this rule, so the account page shows the form only when `set_handle` accepts the change.
After a handle change, staff in each contest that seats the account see the new handle at once. The account's other devices show it at their next account check, within about a minute.
The synthetic identity email, `<loginKey>@accounts.minsky.invalid`, is not a mailbox. SMTP and personal email are unnecessary.

New passwords contain 12 to 128 characters.
A password change requires the current password and a different password after Unicode NFKC normalization.
NFKC converts equivalent Unicode forms to the same password input.
Temporary passwords have 16 characters from a 56-character alphabet that omits 0, O, 1, l, I and o, which gives about 93 random bits. A person can read one from paper.
The credential dialog can print one sheet per person. The sheets exist only while the dialog is open.
The browser adapter saves no password in browser storage.

An account's application ID is also its Better Auth user ID.
Credential changes retain memberships, team assignments, roles, permissions, issue actors, and history.
Every protected operation checks current database state.
Signed cookies, browser identity, and cached UI roles cannot grant contest access.

Accounts come from management commands, and each new account has no password until an issue gives it one:

- `create_people` creates staff accounts. `create_entrants` and `add_entrant_sign_in` create entrant sign-ins. Each needs an event admin of the event or a webmaster.
- `create_event` creates the first event admin of a new event, and `add_webmaster` creates a webmaster. Each needs a webmaster.
- Trusted bootstrap creates the first webmaster, with a temporary password, on an empty database.

An issue of a password and another account's handle change follow one rule:

- A webmaster manages every other account.
- An event admin manages every other account of the event.
- A contest admin manages an account that holds no grant, when the admin administers every contest that seats the account and the event is not archived.

An archived event blocks those actions.
Self-issues are rejected. An account holder uses `changePassword()` instead.
A webmaster who lost access recovers through the trusted terminal command `npm run cloudflare:recover-admin`, which [Install on Cloudflare](../site/src/content/docs/operators/installation.mdx) describes.

## Session authority and browser protection

Sessions last eight hours from login. Activity does not extend the lifetime.
Hosted cookies use `__Host-minsky-session`, `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`.
Cookies have no `Domain` attribute, so another hostname cannot receive the cookie.
Local tests with `secureCookies: false` use `minsky-session` without `Secure`, restricted to loopback hosts. The Worker always uses the hosted settings.

Better Auth reads the current D1 session without cookie caching or a secondary session store.
Minsky also checks the login, its expiry, its revocation, its credential generation, the disabled flag, and the pending credential state.
Contest access additionally requires `must_change = 0` and a current seat or grant.
The workflow, management, image, announcement, and avatar batches check the login again before they commit.

Every request must target the configured `AUTH_ORIGIN`.
If an `Origin` header exists, it must match that exact origin.
Every POST requires that origin header, `Content-Type: application/json`, and `X-Minsky-Request: 1`.
Authenticated POST requests also require `X-CSRF-Token` from the current session response.
The token prevents cross-site request forgery, where another site attempts an action with a person's cookie.
POST requests with cross-site fetch metadata are rejected. No CORS access or preflight permission is exposed.
A sign-in without a `CF-Connecting-IP` header is rejected.
Bodies on these routes are limited to 16 KiB. Redirected browser authentication requests fail.

The browser adapter keeps the token from the last session read and reuses it for later mutations.
The token belongs to one login. The adapter forgets it when a sign-in, sign-out or password change completes, and when a session read returns 401.
A 403 reply means the server stopped before it ran the request. The adapter then reads the session again, and sends the request one more time only when the token changed.
Subscriptions check session state every 60 seconds and on focus or page restoration.
Callbacks run synchronously. Subscription cleanup is idempotent and stops later callbacks.
Completed login, logout, and password-change requests invalidate earlier subscription reads, including reads started during the request.
Polling affects UI awareness only. Server revocation takes effect on the next protected operation.

The application Worker configurations in `src/server/adapters/cloudflare/deploy/`, and the configuration that `npm run cloudflare:install` generates, set `preview_urls: false`. A Cloudflare version preview URL therefore does not reach those Workers.
A preview with authentication needs its own origin, database, secret, and fictional accounts.

## Atomic credential changes and recovery

An issue hashes each new password first, and then runs one guarded batch.
The batch rechecks the caller's authority and each target's credential generation. It then revokes the earlier logins and identity sessions, writes the new credential, sets the mandatory-change gate, records the operation, and stores the receipt together.
A hash failure or a rolled-back batch changes nothing, and the old password stays valid.
A repeat with the same request ID returns the accounts with null passwords, because the server cannot retrieve a password. The organizer then issues again with a new request ID.
Organizers verify the account holder's identity before they issue a recovery password, and they hand it over through a private channel.

An account captured while credentials are pending cannot approve a login after the issue completes.
A sign-in that races an issue cannot gain access, because only the credential generation captured before verification can approve the new identity session.

Self password changes hash before their single guarded D1 batch.
The batch verifies the original login and credential generation, updates credentials, clears the gate, and revokes all earlier sessions together.
A hash failure or rejected batch retains the earlier account state and login, so a sole organizer can retry an interrupted temporary-password change.
A lost database response can leave the commit outcome unknown and earlier logins revoked.
A committed change with a lost response allows login with the new password. Try that password before requesting recovery.
The browser receives a fresh session only after the credential commit.
The final self-change guard retains both original session deadlines while the batch revokes and deletes the old sessions.
Login creation also rechecks the captured credential generation and both current session expiries before completion.

Scheduled maintenance removes password-attempt counters and expired login records after a one-day retention period.
The application Worker runs it every minute. The maintainer-only authentication CI Worker runs it daily.

## Sign-in limits

Sign-in limits count failed sign-ins only. A successful sign-in never counts toward any limit, because all people at a venue can share one public IP address.
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
The Worker stores a secret-salted IP digest rather than the address.
One person who sends many failures can still lock one handle of one event for the rest of its window.
A shared address is blocked only after 200 failures in 15 minutes.

Self password verification uses a separate ten-attempt account window. Every request counts, so this limit does not depend on the outcome.
The replacement login after an authenticated password change does not count toward any sign-in limit.
Password verification and credential-generation checks still apply to that replacement login.
