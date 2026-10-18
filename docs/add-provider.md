# Add a backend provider

Use this guide to add a provider without changing Minsky's application behavior.
A provider supplies identity, persistence, private image storage, and live updates through the existing contracts.
Supabase and Cloudflare have implementations. AWS, GCP, and Azure remain future contributions.
There is no generic database adapter or infrastructure provisioning interface.

## Prepare an isolated implementation

1. Read [the backend contracts](backend-contracts.md) and [the shared server workflow](server-workflow.md).
2. Read [the provider test contracts](provider-test-contracts.md).
3. Inspect `package.json` for the current verification commands.
4. Create a ticket with the provider's scope, resource targets, costs, and verification requirements.
5. Keep development, CI, and installation-verification resources separate.

Ordinary code review and local checks require no access to the maintainers' provider accounts.
Provision hosted resources only with the resource owner's authorization.
Check the provider account and each exact target before migrations, deployment, bootstrap, recovery, or cleanup.

## Implement the existing boundaries

Use these interfaces and components:

| Boundary | Required implementation or reusable component |
| --- | --- |
| [`Backend`](../src/backend/contracts.ts) | Supply all five groups: `auth`, `workflows`, `admin`, `images`, and `updates`. Preserve their types and error meanings. |
| [`Command` and `snapshotSchema`](../src/connected/model.ts) | Reuse the existing commands, roles, and validated snapshot structure. The jury worklist consumes this same snapshot. |
| [`WorkflowPersistence`](../src/server/workflow.ts) | Implement `read()` and `commit()` for `WorkflowService`. Keep database queries and transaction controls inside the adapter. |
| [`Caller`](../src/server/authentication.ts) | Derive `accountId` and `loginId` from trusted authentication. Never accept a caller identity from a request body. |
| [`AuthenticationService`](../src/server/authentication.ts) | Implement this interface if you reuse `createAuthenticationHandler()`. It covers current login, sign-in, sign-out, password changes, account commands, and session listing. |
| [`createAuthenticationHandler()`](../src/server/authenticationHttp.ts) | Reuse the existing same-origin authentication routes when your protocol matches. It checks bounded JSON, origins, request protection, and typed errors. |
| [`imageFile.ts`](../src/connected/imageFile.ts) | Reuse file validation, object-key construction, and image error classification where applicable. |

Place provider clients, credentials, storage bindings, deployment settings, and maintenance code inside the provider implementation and its tooling.
Use `src/backend/<provider>/` for browser adapters and `src/server/adapters/<provider>/` for server adapters.
Keep shared UI code and workflow rules free of provider imports.
Extend the existing ESLint import restrictions when you add a provider module or SDK.

Use `WorkflowService` for issue decisions. Do not copy its rules into a new server.
An authorized read supplies the captured state and an adapter-owned `dependency` value.
The commit must recheck current access and that captured state atomically.
Commit issue state, timestamps, receipts, history, resolutions, awards, and notification records together, or commit none.
Use a trusted database timestamp for each commit.
Return `retry` for a detected state conflict and let the shared service bound retries.
Preserve the distinction between confirmed rejection and an unknown write outcome.

Application reads, administration, images, and live delivery currently remain provider implementations.
There is no shared persistence interface for every operation.
Add a shared interface only when current callers need one.

## Select and reuse browser transport

Register the provider in [`src/backend/index.ts`](../src/backend/index.ts).
Add its explicit public build configuration and setup error.
Reject an unsupported selection. Do not fall back silently to another provider.
Keep secret keys and privileged clients out of `VITE_*` values and frontend bundles.
Document whether each setting requires a frontend rebuild or server deployment.

The current cookie-based HTTP transport is [`createCloudflareBackend()`](../src/backend/cloudflare/backend.ts).
Its browser code calls same-origin HTTP routes and WebSockets. It does not import Workers, D1, R2, or Durable Objects.
Another server that implements the same protocol can reuse this transport despite its current directory name.
Reuse its authentication transport too when the authentication protocol matches.
Preserve cookies, request protection, response validation, error classification, and live connection behavior.

The current factory supports an origin and injectable fetch, WebSocket, and browser event functions.
It does not support arbitrary route mappings or a different authentication protocol.
When a second implementation needs this transport, move the shared code once and update its callers.
Do not create a provider-specific copy or a speculative transport framework.
No second HTTP provider currently exists, so this guide adds no transport abstraction.
The HTTP protocol is an internal application boundary, without a stable external API commitment.

## Own installation and recovery

Supply repository-owned migrations for the new persistence system.
Keep the migration source and commands inside the provider's implementation or deployment tooling.
Test empty installation and upgrades from supported schema versions.
Reject an unexpected schema or target before writes.
Retain already applied migrations. Add a new migration for a later change.

Supply one authoritative installation procedure with these parts:

- Prerequisites, provider permissions, resource names, and costs.
- Public configuration and private secret names, with exact commands and expected results.
- Resource creation, migration order, application deployment, and isolated previews.
- Bootstrap of a new organizer-created administrator with a temporary password.
- The mandatory password change before application access.
- Owner recovery through trusted provider access, with prior-session revocation and another mandatory password change.
- Recovery after partial failure, without repeating first-install initialization or resetting shared resources.
- Exact cleanup commands for disposable installation resources and UUID-owned test fixtures.

Bootstrap is provider-owned. There is no common bootstrap interface.
The existing Supabase `cloud:bootstrap` command requires an existing Supabase Auth UUID.
The Cloudflare `cloudflare:install` command creates its installation and administrator through its own guarded tooling.
Neither command is a universal installer.
Use the [Cloudflare installation procedure](../site/src/content/docs/operators/installation.md) as an implemented example.
Keep passwords and privileged credentials in private files or memory.
Exclude them from chat, logs, Git, browser storage, and ordinary CI artifacts.
Session cookies remain inside the authentication transport.

Fresh installation creates new identities and records. It does not transfer another provider's data.
Provider conformance does not establish data migration, backup restoration, or production capacity.

## Register the shared verification driver

Supply the same fictional roles and relationships described by [`ScenarioData`](../tests/providers/contracts.ts).
Save a credentials-free recovery journal before the first fixture write.
Record enough exact ownership information to recover after a lost setup response.

Update these registration points:

| File | Required change |
| --- | --- |
| [`tests/providers/<provider>/fixture.ts`](../tests/providers/) | Implement isolated fixture creation and cleanup. Verify ownership before deletion and verify cleanup afterward. |
| [`tests/providers/<provider>/browser.ts`](../tests/providers/) | Export `createBrowserProvider(configuration)` returning the real `Backend`, committed-response fault control, and `close()`. |
| [`tests/providers/drivers.ts`](../tests/providers/drivers.ts) | Register fixture creation, cleanup, browser module, public browser configuration, and any required browser origin. |
| [`scripts/provider-test-options.mjs`](../scripts/provider-test-options.mjs) | Accept the explicit provider and target. Reject development targets and runner overrides that weaken isolation or expose credentials. |
| [`scripts/provider-test.mjs`](../scripts/provider-test.mjs) | Add provider prerequisite checks and private environment forwarding. Preserve journal retention and nonzero cleanup failure status. |
| [`playwright.providers.config.ts`](../playwright.providers.config.ts) | Configure the required browser origin if needed. Retain one worker, zero retries, and disabled credential-bearing captures. |
| [`eslint.config.js`](../eslint.config.js) | Extend provider import restrictions for shared scenarios, contracts, browser bridge, and server rules. |
| [`.github/workflows/checks.yml`](../.github/workflows/checks.yml) | Add authorized hosted verification with isolated credentials. Keep ordinary PR checks credential-free. |

The browser bridge already supports cookies, separate contexts, image bytes, typed errors, and subscription callbacks.
Reuse that bridge and the unchanged [`scenarios` registry](../tests/providers/scenarios/index.ts).
Implement response loss after the real server commits. Do not simulate a write or skip an assertion.
Make cleanup reject another target or any relationship outside the fixture's ownership.
Include identity records, database rows, exact storage keys, and durable live-delivery state in cleanup.
Retain the recovery journal if cleanup fails.

Do not edit protected environment rules or branch allowlists as an incidental registration step.
Obtain the authorization required by the repository's current workflow.

## Verify and report limits

Run the ordinary local checks from the repository root:

```sh
npm run typecheck
npm run lint
npm run check:functions
npm run test:functions
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:providers:list
```

Expected results are successful exits and the unchanged shared scenario names.
Run the provider's local persistence, authentication, storage, and runtime checks too.
Use [Run the shared provider tests](run-provider-tests.md) for current hosted commands and recovery.
The current runner accepts only `supabase` and `cloudflare`.
A new provider needs the registration changes above before it can use that runner.
Document its exact target, environment variables, verification command, and recovery command in that guide.

Every provider must pass the same shared behavior scenarios.
Additional provider-specific checks must cover authorization, atomic commits, concurrent changes, identity expiry, revocation, and partial failures.
Use the [additional check requirements](provider-test-contracts.md#requirements-for-another-provider) as the acceptance checklist.
Verify a fresh installation, owner recovery, and the authenticated UI journey independently of fixture setup.

Record the tested revision, exact target, result, and scoped cleanup outcome.
Separate local emulation, CLI runs against hosted resources, and protected GitHub Actions results.
State any unverified behavior. Passing one provider's scenarios does not verify another implementation.
