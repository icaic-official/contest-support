# Cloudflare authentication choice

This page explains why Minsky uses Better Auth, and what that design costs.
The [authentication reference](cloudflare-authentication.md) defines the behavior.

Better Auth is a free library under the [MIT licence](https://github.com/better-auth/better-auth/blob/main/LICENSE.md).
Minsky runs it inside its own Worker with D1, so it needs no Better Auth subscription or hosted account.
Cloudflare hosting has separate charges. Password hashing is the reason that Minsky needs Workers Paid, as the [resource evidence](#resource-evidence-and-deployment-cost) shows.

## Use Better Auth behind the identity adapter

Minsky needs organizer-issued usernames and passwords on Workers and D1, with no email.
Better Auth supplies username login, password verification, signed session cookies, database sessions, expiry, and logout. `package.json` pins its exact version.
[The username plugin](https://better-auth.com/docs/plugins/username) permits username login while its user schema keeps an email field. Minsky puts a synthetic address under `accounts.minsky.invalid` in that field, so personal email addresses and SMTP are not required.

Maintained password verification and session cookies reduce the authentication code that Minsky must own.
The main cost is coupling to Better Auth's database schema, which the next section describes.
This choice does not establish that Better Auth is the best option for every deployment.

The server adapter exposes three operations: `signIn()`, `session()`, and `signOut()`.
The Worker does not expose Better Auth's HTTP router. Minsky's own handlers enforce request origins, request-forgery protection, and account permissions.
Public registration, email recovery, external identity providers, and automatic account linking are disabled or unreachable.

Better Auth knows only the login key, which nobody types. A person types a handle, and Minsky resolves it to the login key. A handle change therefore never touches Better Auth, and open sessions continue.

## Keep account policy and credential writes in D1

Better Auth does not supply Minsky's rules for who may reset whom, or the mandatory password change.
Minsky checks current account status and seats before contest access and account administration.
The account ID is also the Better Auth user ID, so memberships and history keep that ID.

Better Auth [documents weaker reset behavior](https://better-auth.com/docs/authentication/email-password#revoking-sessions-on-password-reset) when database transactions are unavailable, and D1 has no interactive transactions.
Minsky therefore does not call that reset endpoint. It hashes the new password first, and then writes the credential, revokes the earlier sessions, and sets the mandatory-change gate in one guarded D1 batch.
An interrupted issue leaves the old password valid, because the batch either commits whole or changes nothing. A self-service password change works the same way, so a hashing failure leaves the current password and login available for another attempt.

This approach couples the adapter to Better Auth's stored schema. Migration `0004_identity.sql` owns the `ba_user`, `ba_account`, `ba_session`, and `ba_verification` tables, and Minsky writes to them directly.
Each Better Auth upgrade therefore needs a comparison of the schema and the credential format, and a new run of the [local and hosted authentication checks](verify-cloudflare-authentication.md).

Better Auth can check its expected tables against the database before each request, and the Worker turns that check off.
In a hosted load test on 2026-10-25, each Worker request ran about 40 D1 queries with the check on. A prototype with the check off ran about 4. The [scaling design](scaling-design.md#d1-ran-about-40-queries-for-each-request) holds the numbers.
The migrations own the schema instead. `identityStatements.test.ts` runs the real check against the migrated local D1 database. It fails when an upgrade expects a table or column that the migrations lack, and when an authenticated API request sends the check's queries again.

The Worker reuses one Better Auth instance for each D1 binding, origin, and secret. Building an instance took about 17 ms of CPU when measured on 2026-10-25.
The instance keeps no session state, so reuse is safe. A new secret builds a new instance, and cookies from the old secret stop working.

## Retain maintained cryptographic components

`password.ts` uses the exported `better-auth/crypto` password functions, so Better Auth login and Minsky credential writes share one format.
The locked `@better-auth/utils` version is `0.5.0`. Its `workerd` export selects native `node:crypto` scrypt, which [the maintained implementation](https://github.com/better-auth/utils/blob/main/src/password.node.ts) configures this way:

- `N=16384`, `r=16`, `p=1`, and a 64-byte derived key.
- A random 16-byte salt and Unicode NFKC normalization.
- A calculation limit of 64 MiB.

[Workers supports `node:crypto`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/), with specific exceptions that include Argon2.
Minsky keeps scrypt's maintained parameters and pays for the CPU time. A smaller password cost to fit a smaller CPU allowance would be the wrong trade for a system that holds real accounts.

Session secrets and temporary passwords use Web Crypto randomness.
The browser receives the session credential only through an HttpOnly cookie, and the server stores only the password hash.
Better Auth logging is disabled, because provider errors can contain bound values.

## Bound browser sessions explicitly

Minsky replaces Better Auth's default lifetime and cookie cache. A session lasts eight hours from login, with no automatic extension, and every check reads the D1 primary.
A person therefore signs in again during a long day, and each request pays for the reads. An authenticated request made 3 D1 calls before its handler in the [local measurement in the scaling design](scaling-design.md#d1-ran-about-40-queries-for-each-request). In return, a revocation takes effect on the next protected operation, with no cached session to outlive it.

The identity cookie proves the Better Auth session. Each protected operation also checks the current Minsky login, credential generation, account gate, and permissions.
Password changes and resets revoke previous sessions. An identity login that races a password reset cannot gain access through an older credential generation.
See [Better Auth security settings](https://better-auth.com/docs/reference/security).

## Resource evidence and deployment cost

Password hashing is the most expensive thing that the Worker does, and it decides the Cloudflare plan.
These measurements are from 2026-10-18. They are small samples. They establish a resource requirement, not capacity or a latency guarantee.

| Measurement | Result |
| --- | --- |
| Local Node.js, elapsed time | About 78 ms to hash and 68 ms to verify |
| Local `workerd`, five samples of each, elapsed time | 56 to 62 ms to hash and 52 to 61 ms to verify |
| Hosted Worker, one verification sample, CPU | 66.425 ms |
| Hosted Worker, one hash sample, CPU | 75.577 ms |
| Hosted Worker, separate hash run with two sampled requests, CPU | 96.311 ms median and 196.446 ms 99th percentile |
| Hosted password change on the Free plan, CPU | 252.901 ms, ended by Cloudflare with `exceededResources` |

The hosted samples used temporary Workers with no database binding, and adaptive analytics supplied the CPU values. Local elapsed time and hosted request timers do not measure hosted CPU.
The failed password change reported 16,724,317 bytes in adaptive memory metrics, which does not establish peak native memory use. [Cloudflare's resource status](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) can include CPU and other runtime limits.
One password change verifies the current password, hashes the new one, and verifies it again at the replacement login, so one request does three scrypt calculations (inferred from `changePassword()`).

On that date, the Workers Free plan permitted 10 ms of CPU per request and 128 MB of memory per isolate. The samples exceed that CPU limit, so a successful fixture request does not establish reliable Free-plan operation.

The application Worker configurations in `src/server/adapters/cloudflare/deploy/`, the configuration that `npm run cloudflare:install` generates, and `wrangler.auth-ci.jsonc` therefore request `limits.cpu_ms = 1000`. That setting needs a paid plan. On the Free plan, Cloudflare rejected the setting with error `100328`, and the prior Worker stayed active.
Workers Paid accepted the cap for the isolated authentication Worker on 2026-10-18. Its hosted HTTP suite then passed, including password change and organizer-assisted recovery, with the password parameters unchanged.

On 2026-10-18, Cloudflare listed these Standard plan prices. Check [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [pricing](https://developers.cloudflare.com/workers/platform/pricing/) for current values:

- At least US$5 per month, with ten million requests and thirty million CPU milliseconds included.
- US$0.30 per million additional requests.
- US$0.02 per million additional CPU milliseconds.

For example, 100,000 password checks at 100 ms each consume ten million CPU milliseconds before other application work.
The CPU cost also limits one request. `POST /api/credentials` takes at most eight accounts, because each password hash costs Worker CPU time.

[Measure password cost](verify-cloudflare-authentication.md#measure-password-cost) gives the commands that repeat these measurements.
