# Cloudflare authentication choice

This page explains the identity choice for T0018.
Supabase remains the active application backend.
Cloudflare authentication uses fictional fixtures until the connector and migration pass their later checks.

Better Auth is a free library under the [MIT licence](https://github.com/better-auth/better-auth/blob/main/LICENSE.md).
Minsky runs it inside its own Worker with D1. This implementation requires no Better Auth subscription or hosted account.
Cloudflare hosting has separate charges. The [resource and cost evidence](#resource-evidence-and-deployment-cost) explains the Workers Paid requirement.

## Use Better Auth behind the identity adapter

T0018 selects Better Auth `1.7.10`, pinned in `package.json` and `package-lock.json`.
The package supplies username login, password verification, signed session cookies, database sessions, expiry, and logout.
Its username plugin permits username login while its user schema retains an email field.
Minsky uses a synthetic address under `accounts.minsky.invalid` for that required field.
Personal email addresses and SMTP are not required.
See [the username plugin](https://better-auth.com/docs/plugins/username).

This fits the required organizer-issued usernames and passwords on Workers and D1.
Maintained password verification and session cookies reduce the authentication code Minsky must own.
The main tradeoff is database-schema coupling for Minsky's guarded credential operations, described below.
This choice does not establish that Better Auth is the best option for every deployment.

The server adapter exposes three operations: `signIn()`, `session()`, and `signOut()`.
The Worker does not expose Better Auth's HTTP router.
The Minsky HTTP handlers enforce request origins, request-forgery protection, and account permissions.
Public registration, email recovery, external identity providers, and automatic account linking are disabled or unreachable.

## Keep account policy and credential writes in D1

Better Auth does not supply Minsky's cross-session reset rules or mandatory password-change gate.
Minsky checks current account status and memberships before contest access and account administration.
The account ID remains the Better Auth user ID.
Memberships and history retain that ID.

Better Auth documents weaker reset behavior when database transactions are unavailable.
D1 has no interactive transaction support for its default reset path.
Therefore, Minsky does not call that reset endpoint.
See [Better Auth password resets](https://better-auth.com/docs/authentication/email-password#revoking-sessions-on-password-reset).

Minsky first restricts the account and revokes its existing sessions in a guarded D1 batch.
Password hashing occurs outside the batch.
A second guarded batch writes the new credential and completes the reset operation together.
The operation identifier prevents an older interrupted operation from replacing a newer password.
An interrupted update leaves the account restricted for organizer-assisted recovery.
For a self-service password change, hashing occurs before one guarded commit.
That commit changes the password and revokes earlier sessions together.
A hashing failure therefore leaves the current password and login available for another attempt.

This approach couples the adapter to Better Auth's stored schema.
Migration `0004_identity.sql` owns the `ba_user`, `ba_account`, `ba_session`, and `ba_verification` tables.
Better Auth's SQLite adapter stores dates as ISO 8601 text.
Before upgrading Better Auth, compare its schema and credential format, then rerun local and hosted authentication checks.

## Retain maintained cryptographic components

`password.ts` uses the exported `better-auth/crypto` password functions.
Both Better Auth login and Minsky credential writes use those functions.
The locked `@better-auth/utils` version is `0.5.0`.
Its `workerd` export selects native `node:crypto` scrypt.
The parameters are `N=16384`, `r=16`, `p=1`, and a 64-byte derived key.
The implementation uses a random 16-byte salt and Unicode NFKC normalization.
It sets a 64 MiB calculation limit.
See [the maintained implementation](https://github.com/better-auth/utils/blob/main/src/password.node.ts).

Session secrets and temporary passwords use Web Crypto randomness.
The browser receives the session credential only through an HttpOnly cookie.
The server stores the credential hash rather than the plaintext password.
Better Auth logging is disabled because provider errors can contain bound values.

Workers supports `node:crypto`, with specific exceptions that include Argon2.
Minsky keeps scrypt's maintained parameters rather than reducing password cost to fit a smaller CPU allowance.
See [Workers crypto support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).

## Bound browser sessions explicitly

Minsky uses these settings instead of Better Auth's default lifetime and cookie cache:

| Setting | Value |
| --- | --- |
| Lifetime | Eight hours from login, without automatic extension. |
| Session authority | D1 primary reads. No cookie cache or secondary session store. |
| Hosted cookie | `__Host-minsky-session`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, without `Domain`. |
| Local HTTP cookie | `minsky-session`, `HttpOnly`, `SameSite=Strict`, `Path=/`, restricted to loopback. |
| Permitted origin | One configured exact origin. No wildcard preview origins. |
| Browser password storage | Passwords stay in request memory. No local storage or bearer token export. |

The identity cookie proves the Better Auth session.
Each protected operation also checks the current Minsky login, credential generation, account gate, and permissions.
Password changes and resets revoke previous sessions.
An identity login that races a password reset cannot gain access through an older credential generation.
See [Better Auth security settings](https://better-auth.com/docs/reference/security).

Untrusted previews must use isolated fictional data and a separate authentication deployment.
The active Supabase frontend does not receive this identity adapter or its credentials.

## Resource evidence and deployment cost

A local Node.js sample measured about 78 ms for hashing and 68 ms for verification.
These measurements are elapsed time on one development machine.
They do not measure hosted Worker CPU use or concurrency capacity.

On 2026-10-18 SGT, five local workerd samples measured 56 to 62 ms for hashing and 52 to 61 ms for verification.
All ten requests succeeded.
Hosted verification succeeded in five requests.
An adaptive analytics sample recorded 66.425 ms of CPU for verification.
An initial hosted hash sample recorded 75.577 ms of CPU.
A separate hash run recorded a median of 96.311 ms and a 99th percentile of 196.446 ms across two sampled requests.
That run completed four hash requests and observed one transient deployment-propagation 404.
These small samples establish a resource requirement. They do not establish capacity or a latency guarantee.
The temporary benchmark Workers had no database binding and were deleted after measurement.
No paid upgrade occurred.

The runner is `node scripts/auth-hash-benchmark.mjs` for local workerd.
Hosted runs require `--hosted`, `--operation=hash` or `--operation=verify`, and the explicit authorized `--account` value.
The runner checks existing Wrangler access, creates one temporary Worker, and deletes that Worker afterward.
It keeps fictional credentials in memory and suppresses provider output.
It reads existing OAuth credentials only to request CPU analytics.
No account, password hash, or session token is written to its output.
Hosted CPU comes from [the GraphQL analytics API](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/).
Hosted request timers cannot reliably measure CPU execution.

The Workers Free plan permits 10 ms of CPU per request and 128 MB of memory per isolate.
The observed CPU samples exceed the Free plan's 10 ms limit.
Successful fixture requests do not establish reliable Free-plan operation.
The documented Standard plan costs at least US$5 per month.
It includes ten million requests and thirty million CPU milliseconds per month.
Additional usage costs US$0.30 per million requests and US$0.02 per million CPU milliseconds.
For example, 100,000 password checks at 100 ms each consume ten million CPU milliseconds before other application work.
These figures explain the concrete need and cost before a possible upgrade.
No upgrade is part of the benchmark runner.
See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [pricing](https://developers.cloudflare.com/workers/platform/pricing/).


### Protected HTTP resource rejection

Protected run `39049037968` passed all 28 hosted D1 account cases on `8cfd7a5`.
Cloudflare then terminated one password-change invocation with `exceededResources` at 252.901 ms CPU.
The invocation reported 16,724,317 bytes in adaptive memory metrics. This does not establish peak native memory use.
Cloudflare's resource status can include CPU and other runtime limits.
See [the invocation status reference](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).

A subsequent deployment requested `limits.cpu_ms = 1000` for the isolated authentication Worker.
Cloudflare rejected that setting with error `100328`: CPU settings require a paid plan, and this account uses Free.
The rejected deployment left the prior Worker active.
The owner selected subscription activation later. No paid upgrade occurred.
The committed configuration retains the bounded CPU setting for verification after activation.
The earlier successful HTTP runs do not establish dependable operation on Free.

### Paid verification after PR #41 review

During PR #41 review, the owner activated Workers Paid and requested completion of hosted verification.
The isolated `minsky-auth-ci` Worker then accepted the 1,000 ms cap.
The maintained password parameters remain unchanged.
The local hosted HTTP suite passes on implementation `7abaf2e`, including password change and organizer-assisted recovery.
Protected [run 39089988536](https://github.com/GiftedNovaHD/minsky/actions/runs/39089988536) also passes all 30 account cases and the complete HTTP case on merged `main`.
See [current state](current-state.md) for exact deployment versions and separate protected GitHub evidence.
