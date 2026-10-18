# T0020 implementation run, 2026-10-18

This record describes the complete connector implementation on `feature/t0020-cloudflare-connector`.
The branch starts at merged PR #41, `7d19b00`.
During verification, the owner merged PR #23 at `c144a2a`.
This branch includes that main revision and preserves its jury worklist.
The [current-state record](current-state.md#t0020-connector-implementation-2026-10-18) lists resource targets and observed evidence.
The complete hosted application and empty-installation checks pass.
The latest protected connector run has two shared-scenario failures. Correction and final PR checks remain in progress.

## 1. Summary of changes

Implemented all nine D1 commands through the shared service, the complete Cloudflare browser and server adapters, private images, and live delivery.
Added provider-owned installation, owner recovery, target checks, and isolated verification tooling.
Reviewed PR #21 before installation changes and recorded [component decisions](pr21-installation-disposition.md).
Supabase remains active.
Runtime imports retain extensions required by Deno and the provider tools.
Existing D1 tests retain their local quote style. These deliberate style exceptions avoid unrelated edits and preserve tool compatibility.

## 2. Files changed

The implementation changes these files:

- `.github/workflows/checks.yml`
- `AGENTS.md`
- `PLAN.md`
- `README.md`
- `deno.lock`
- `docs/backend-contracts.md`
- `docs/cloudflare-authentication-choice.md`
- `docs/cloudflare-authentication.md`
- `docs/cloudflare-backend-design.md`
- `docs/cloudflare-implementation-plan.md`
- `docs/current-state.md`
- `docs/d1-transaction-proof.md`
- `docs/documentation-release-plan.md`
- `docs/install-cloudflare.md`
- `docs/pr21-installation-disposition.md`
- `docs/product-direction.md`
- `docs/provider-test-contracts.md`
- `docs/run-provider-tests.md`
- `docs/server-workflow.md`
- `docs/t0020-run-report.md`
- `docs/tickets.md`
- `docs/verify-cloudflare-authentication.md`
- `package-lock.json`
- `package.json`
- `playwright.auth.config.ts`
- `playwright.cloud.config.ts`
- `playwright.config.ts`
- `playwright.connector-local.config.ts`
- `playwright.connector.config.ts`
- `playwright.providers.config.ts`
- `scripts/connector-local-ui-test.mjs`
- `scripts/connector-runtime-test.mjs`
- `scripts/provider-test-cloudflare.test.mjs`
- `scripts/provider-test-options.mjs`
- `scripts/provider-test.mjs`
- `site/src/content/docs/operators/backend.md`
- `site/src/content/docs/operators/installation.md`
- `site/src/content/docs/operators/verification.md`
- `site/src/content/docs/reference/status.md`
- `src/backend/cloudflare/authentication.test.ts`
- `src/backend/cloudflare/authentication.ts`
- `src/backend/cloudflare/backend.test.ts`
- `src/backend/cloudflare/backend.ts`
- `src/backend/index.ts`
- `src/server/adapters/cloudflare/application.test.ts`
- `src/server/adapters/cloudflare/application.ts`
- `src/server/adapters/cloudflare/applicationWorker.test.ts`
- `src/server/adapters/cloudflare/applicationWorker.ts`
- `src/server/adapters/cloudflare/authentication.test.ts`
- `src/server/adapters/cloudflare/authentication.ts`
- `src/server/adapters/cloudflare/authenticationCases.ts`
- `src/server/adapters/cloudflare/authenticationCompletion.test.ts`
- `src/server/adapters/cloudflare/authenticationInitiation.test.ts`
- `src/server/adapters/cloudflare/authenticationRecovery.test.ts`
- `src/server/adapters/cloudflare/deploy/connector-ci.settings.json`
- `src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc`
- `src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc`
- `src/server/adapters/cloudflare/hostedHttp.test.ts`
- `src/server/adapters/cloudflare/http.test.ts`
- `src/server/adapters/cloudflare/http.ts`
- `src/server/adapters/cloudflare/images.test.ts`
- `src/server/adapters/cloudflare/images.ts`
- `src/server/adapters/cloudflare/installation.test.ts`
- `src/server/adapters/cloudflare/installation.ts`
- `src/server/adapters/cloudflare/live.test.ts`
- `src/server/adapters/cloudflare/live.ts`
- `src/server/adapters/cloudflare/providerDiagnostics.test.ts`
- `src/server/adapters/cloudflare/runtime.d.ts`
- `src/server/adapters/cloudflare/tooling/competition.example.json`
- `src/server/adapters/cloudflare/tooling/configuration.mjs`
- `src/server/adapters/cloudflare/tooling/configuration.test.mjs`
- `src/server/adapters/cloudflare/tooling/hosted-progress-reporter.mjs`
- `src/server/adapters/cloudflare/tooling/hosted-progress.mjs`
- `src/server/adapters/cloudflare/tooling/hosted-progress.test.mjs`
- `src/server/adapters/cloudflare/tooling/install.mjs`
- `src/server/adapters/cloudflare/tooling/migrations.mjs`
- `src/server/adapters/cloudflare/tooling/operation-runner.mjs`
- `src/server/adapters/cloudflare/tooling/operations.mjs`
- `src/server/adapters/cloudflare/tooling/operations.test.mjs`
- `src/server/adapters/cloudflare/tooling/provider.example.json`
- `src/server/adapters/cloudflare/tooling/provision.example.jsonc`
- `src/server/adapters/cloudflare/tooling/safe-environment.mjs`
- `src/server/adapters/cloudflare/tooling/store-target.mjs`
- `src/server/adapters/cloudflare/tooling/store-target.test.mjs`
- `src/server/adapters/cloudflare/tooling/test-accounts.mjs`
- `src/server/adapters/cloudflare/tooling/test-accounts.test.mjs`
- `src/server/adapters/cloudflare/tooling/test-ui.mjs`
- `src/server/adapters/cloudflare/tooling/test-workflow.mjs`
- `src/server/adapters/cloudflare/tooling/test-workflow.test.mjs`
- `src/server/adapters/d1/migrations/0005_workflow.sql`
- `src/server/adapters/d1/migrations/0006_application.sql`
- `src/server/adapters/d1/migrations/0007_image_guards.sql`
- `src/server/adapters/d1/migrations/0008_installation.sql`
- `src/server/adapters/d1/migrations/0009_notifications.sql`
- `src/server/adapters/d1/store.test.ts`
- `src/server/adapters/d1/store.ts`
- `src/server/adapters/d1/testFixture.ts`
- `src/server/adapters/d1/testMetrics.test.ts`
- `src/server/adapters/d1/testMetrics.ts`
- `tests/connector/hosted-ui.spec.ts`
- `tests/connector/local-ui-fixture.ts`
- `tests/connector/local-ui.spec.ts`
- `tests/connector/runtime.test.ts`
- `tests/connector/ui-journey.ts`
- `tests/provider-bridge.spec.ts`
- `tests/providers/browser-backend.ts`
- `tests/providers/cloudflare/browser.ts`
- `tests/providers/cloudflare/diagnostics.ts`
- `tests/providers/cloudflare/fixture.ts`
- `tests/providers/cloudflare/target.d.mts`
- `tests/providers/cloudflare/target.mjs`
- `tests/providers/drivers.ts`
- `tests/providers/fixture.ts`
- `tsconfig.json`
- `vite.config.ts`
- `vitest.auth.config.ts`
- `vitest.connector-runtime.config.ts`

## 3. Commands run

Repository inspection used `git status`, `log`, `diff`, `fetch`, `switch`, `rg`, `cat`, and `sed`.
Git `add`, `commit`, and `push` published the implementation and verification changes with the required co-author trailer exactly once each.
`git merge --no-commit --no-ff origin/main` included the owner's jury worklist merge.
Four documentation conflicts required resolution. Both tickets' implementation and historical verification records remain intact.
GitHub commands created draft [PR #42](https://github.com/GiftedNovaHD/minsky/pull/42) and started protected verification against the existing Supabase CI backend.
Provider and review inspection used `gh api`, `gh pr view`, Wrangler `whoami`, D1 `list`, `info`, `create`, and `migrations apply`.
R2 `bucket list`, `create`, and `dev-url get` confirmed new private Standard buckets.
Worker `deployments list` confirmed name absence before initial deployment.
The isolated connector D1 database received only repository migrations and fictional fixture records.
The later D1-only `minsky-connector-store-ci` database received the same nine migrations through `store-target.mjs migrate`.
An exact name check preceded creation. Wrangler confirms that no store CI Worker exists.
The GitHub environment change added only this ticket branch.

Local verification used `npm test -- --maxWorkers=2`, focused Vitest runs, `typecheck`, `lint`, and both frontend builds.
It also used `check:functions`, `test:functions`, `test:e2e`, `test:auth:browser`, `test:connector:runtime`, `test:providers:list`, `docs:build`, and `docs:test`.
`node scripts/connector-local-ui-test.mjs` runs the complete actual React journey on temporary local bindings.
Both locked dependency audits ran with `--audit-level=high`.
The complete Worker passed `wrangler deploy --dry-run` and deployed only to the new isolated connector CI target.
Hosted CLI checks ran the full D1 workflow and account suites, and `test:providers -- --provider=supabase`.
`test:providers -- --provider=cloudflare` ran the unchanged eight scenarios through the deployed HTTP application.
`test:connector:ui` ran the full React journey through the deployed application.
The provider-owned `cloudflare:install -- migrate` command applied the schema after exact account and database checks.
The independent trial used a separate clean checkout, `npm ci`, and the documented configuration, provisioning, migration, build, deployment, bootstrap, and secret commands.
It also exercised trusted `recover` through the actual CLI and ran the complete React assertions.
Private temporary scripts checked preservation and deleted only the exact additional recovery-proof rows.
Markdown link checks, YAML parsing, and `git diff --check` also ran.
The checksum-pinned Gitleaks scanner checked staged changes and all fetched Git history with redacted output.

Early integrated tests exposed fixture audit relationships and notification-count assumptions. Corrections passed their focused and complete reruns.
An initial browser discovery error and the provider bridge's wrong asset origin were corrected. The 34-case browser rerun passed.
A later lint error in new request mocks was corrected; global lint passed.
The unsupported R2 `list --json` form was replaced with `r2 bucket list`.
The supported command initially failed with Cloudflare code `10042`. It passed after the owner activated R2.
The initial hosted shared Cloudflare run stopped before login because the bridge omitted Vite's runtime asset.
The narrow asset correction, its new ordinary browser regression, and the repeated hosted eight-case suite pass.
The earlier protected connector dispatch on `59121f7` was canceled before its cloud job. It supplies no passing hosted evidence.
Protected `1ee8cbf` and `c1530bb` verification each passed 69 workflow cases and failed one.
Their assertion details were withheld, and D1 cleanup completed without retained artifacts.
A controlled local reproduction established that scheduled delivery can mutate direct-test snapshots and create coordinator state outside direct-fixture cleanup.
Direct suites now use a separate D1-only CI database. Their complete workflow comparisons remain unchanged.
Independent hosted namespace audits observed no stored orphan state after either failed run.
Initial local socket and Git metadata operations needed sandbox escalation.
The account-duration investigation measured local fixture calls before and after batching, then ran the four-file hosted account suite.
The first read-only timing probe failed in Node evaluation mode. The supported CommonJS probe passed without changing data.
The first instrumented account run failed all 82 cases because the metrics wrapper hid native D1 capabilities.
It completed fixture cleanup. A forwarding proxy and real Better Auth regression correct that instrumentation fault.
The repeated hosted account run passes all 82 cases in 148 seconds, without skips, and verifies cleanup.
The original 35 account test definitions retain their complete bodies and parameter lists across four isolated files.
New progress checks verify numeric redaction, concurrent counters, intermediate output, timeout handling, and timer cleanup.
A temporary Chromium probe repeats the shared temporary-password and full lifecycle cases against the local Worker with maintenance before every HTTP request.
That probe passes. All 19 lifecycle snapshots and 20 authentication-session reads return 200. It does not reproduce the protected rejection.
Provider-owned browser diagnostics now record safe endpoint timings and fixture authentication flags before logout.
Their local tests verify redaction, ownership, and teardown ordering. The first browser mock used the wrong `page.evaluate` signature and was corrected.
No automatic approval review rejected an authorized action.

## 4. Build and test results

After current-main integration, the complete local suite passes 566 tests across 34 files.
Corrected ordinary CI passes 579 tests across 35 files on `9b0ef6b`.
The duration correction passes all 591 local tests across 40 files in 51.34 seconds.
Types, lint, and the default Supabase frontend build also pass after that correction.
The new hosted-runner and store-target checks pass all 28 focused cases locally.
The earlier `59121f7` run passes 554 tests, including the image cleanup-fairness regression.
The full local account suite also passes all 83 cases against the historical authentication schema.
The final local HTTPS connector journey, including actual D1, R2, and live bindings, passes.
The complete local React journey also passes with the same assertions as the hosted journey.
It checks all nine commands, images, live connections, administration, persisted state, and 320 px keyboard behavior.
All 59 image cases pass after the additional cleanup-fairness correction.
Both frontend builds, types, lint, Deno checks, and all 12 function tests pass.
After current-main integration, all 45 ordinary application browser cases pass.
Three authentication browser cases pass at the earlier recorded revision. All three documentation browser cases pass again after main integration.
The complete local React journey passes again with the merged jury worklist, including decision, external-confirmation, and focus checks.
The documentation build checks 14 pages and 562 local links and assets.
Both locked dependency audits report zero vulnerabilities.

Hosted D1 passes all 70 production workflow cases, with scoped cleanup.
Hosted D1 also passes all 82 account cases, with zero skips and scoped cleanup.
Hosted Supabase passes all eight unchanged shared provider scenarios, with scoped cleanup.
The final CLI reruns verify source `de1ecbd`.
A separate read-only D1 query confirms zero rows in all 27 application tables after the runs.
The first aggregate count command failed; its scalar-query retry passed. Neither command changed data.
These CLI runs are separate from protected GitHub Actions evidence.
Both staged and full-history secret scans pass. The latest local history scan checks 119 commits through `1ee8cbf`.
Hosted Cloudflare passes all eight unchanged shared scenarios on `1ee8cbf`.
The full hosted React journey passes on `59121f7`, with zero failures, skips, or flaky results.
Their cleanup verifies only UUID-owned D1 data, exact R2 keys, and empty fixture coordinator state before journal removal.
The [independent hosted installation](current-state.md#empty-hosted-installation) passes on a separate clean checkout of `59121f7`.
Its one complete browser trial has zero failures, skips, retries, or flaky results.
Bootstrap, mandatory password changes, closed intake, repeated-operation refusal, owner recovery, old-session rejection, and identity/history preservation pass.
After scoped cleanup, the trial retains only its initialized baseline, audits, and monotonic transport state.
Its bucket is empty, and no fixture recovery journal remains.
Ordinary push CI passes `checks`, `secrets`, and `dependencies` on `de1ecbd` in [run 39095244800](https://github.com/GiftedNovaHD/minsky/actions/runs/39095244800).
Ordinary PR CI and protected Supabase verification also pass on that revision in [run 39095267935](https://github.com/GiftedNovaHD/minsky/actions/runs/39095267935) and [run 39095319959](https://github.com/GiftedNovaHD/minsky/actions/runs/39095319959).
The protected Supabase run passes 14 cloud browser cases, eight shared provider scenarios, and five shared server workflow cases.
Both ordinary runs on `59121f7` pass in [run 39096348143](https://github.com/GiftedNovaHD/minsky/actions/runs/39096348143) and [run 39096350260](https://github.com/GiftedNovaHD/minsky/actions/runs/39096350260).
Protected connector [run 39098783172](https://github.com/GiftedNovaHD/minsky/actions/runs/39098783172) fails on `9b0ef6b` after passing all 70 workflow and 82 account cases.
Its account phase takes 20 minutes 6 seconds. Its shared browser phase passes six cases and fails two in 10 minutes 56 seconds.
The lifecycle case receives an unexpected authentication rejection. The image case times out during uploader removal.
The hosted React step is not reached. No cleanup marker or recovery artifact remains.
The [duration investigation](current-state.md#hosted-check-duration) records measured transport costs and the correction.
Ordinary push [run 39098769818](https://github.com/GiftedNovaHD/minsky/actions/runs/39098769818) passes on that revision.
The direct CLI workflow suite passes all 70 cases on the dedicated store database with verified scoped cleanup.
The direct account CLI suite also passes all 82 cases there on `9b0ef6b`, with zero skips and verified scoped cleanup.

## 5. Manual verification

Reviewed authorization boundaries, atomic batches, original login deadlines, retry outcomes, image visibility and cleanup, notification fairness, and fixture ownership.
Reviewed generated provider configuration, subscription requirements, bootstrap ordering, and PR #21 reuse.
Visually inspected the actual local volunteer queue, issue detail, and image controls at 320 × 740 pixels.
Text and controls fit the phone width. Keyboard focus remains visible, and the timer and owner fields remain readable.
The private screenshot run also passes the complete React journey and scoped cleanup.
Automated browser tests check keyboard behavior, persistence, and public/private separation.
The hosted application and independent installation checks use automated real-browser assertions.
The initialized fictional installation remains available for the owner's review.
Its current owner password is in `/tmp/minsky-empty-install-b4b578a2/private/owner-recovered-current.json`, with mode `0600`.
Open that file privately. Earlier generated temporary passwords are stale after the tested changes.
If the private file is lost, use the documented trusted owner recovery command.

## 6. Risks

The owner activated R2 in account `458ad6a930b0fb717796dfa19ca6a2b1`.
The private CI and installation buckets exist, and the corresponding hosted checks pass.
Protected connector evidence and the final PR checks remain pending. PR #42 remains a draft.
Contest capacity and real-data migration remain outside this evidence.

## 7. Follow-up tickets

Finish protected T0020 verification, then prepare owner review.
The PR #21 disposition remains for the owner to decide after the complete goal passes.
No new follow-up ticket was created.

## 8. Docs that need updating

Update this record, current state, ticket acceptance, and the PR after protected checks finish.
