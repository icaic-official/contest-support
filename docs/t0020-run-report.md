# T0020 review fixes and cleanup, 2026-10-18

This record covers the PR #42 review follow-up on `feature/t0020-cloudflare-connector`.
The [earlier implementation report](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/t0020-run-report.md) preserves its full commands and results.
The [current-state record](current-state.md) preserves resource identities and dated hosted evidence.
Supabase remains active. The owner reviews and merges.

## 1. Summary of changes

Removed the historical D1 proof implementation and its test-only API.
Workflow tests now use the shared service and real authorized snapshots.
The current D1 command query no longer reads history or audience sequences that decisions do not use.
Combined the hosted D1 runners and removed their duplicate runtime configurations.
Kept target checks, fixed suite counts, private output, scoped journals, and parallel account groups.

Corrected image expiry recovery by creating deletion tasks from the persisted expired set.
Cleared inherited Wrangler environment selection before trusted CLI and API operations.
Included hosted UI recovery journals in protected CI artifacts.
Shared the bounded JSON reader and replaced custom configuration comparators with the Node.js implementation.

Published one complete [installation procedure](../site/src/content/docs/operators/installation.mdx).
Its shell setup now explicitly clears inherited Wrangler environment selection and disables debug log files. The fresh trial used the same settings.
Removed superseded proof and implementation walkthroughs, obsolete installer navigation, repeated status summaries, and old ticket instructions from agent guidance.
Historical records link to their frozen source revision.

Temporary breakage was limited to the ticket branch while retired commands, tests, and documentation changed together.
Full static and runtime verification passes on the executable source. The final documentation update requires ordinary PR checks before merge.
Existing quote styles remain in touched test files. Explicit `.ts` imports preserve Deno compatibility.
Framework entry points retain required default exports.

## 2. Files changed

- `.github/workflows/checks.yml`
- `.gitignore`
- `AGENTS.md`
- `PLAN.md`
- `README.md`
- `docs/backend-contracts.md`
- `docs/cloudflare-authentication.md`
- `docs/cloudflare-backend-design.md`
- `docs/cloudflare-implementation-plan.md` (deleted)
- `docs/current-state.md`
- `docs/d1-transaction-proof.md` (deleted)
- `docs/documentation-release-plan.md`
- `docs/install-cloudflare.md` (deleted)
- `docs/pr21-installation-disposition.md`
- `docs/product-direction.md`
- `docs/provider-test-contracts.md`
- `docs/run-provider-tests.md`
- `docs/server-workflow.md`
- `docs/t0020-run-report.md`
- `docs/tickets.md`
- `docs/verify-cloudflare-authentication.md`
- `docs/verify-server-workflow.md`
- `package.json`
- `scripts/d1-proof.mjs` (deleted)
- `site/astro.config.mjs`
- `site/src/content/docs/index.md`
- `site/src/content/docs/operators/backend.md` (deleted)
- `site/src/content/docs/operators/installation.mdx`
- `site/src/content/docs/reference/status.md`
- `site/tests/docs.spec.ts`
- `src/backend/contracts.ts`
- `src/server/adapters/cloudflare/application.test.ts`
- `src/server/adapters/cloudflare/application.ts`
- `src/server/adapters/cloudflare/authenticationCases.ts`
- `src/server/adapters/cloudflare/http.ts`
- `src/server/adapters/cloudflare/images.test.ts`
- `src/server/adapters/cloudflare/images.ts`
- `src/server/adapters/cloudflare/live.ts`
- `src/server/adapters/cloudflare/tooling/configuration.mjs`
- `src/server/adapters/cloudflare/tooling/operations.mjs`
- `src/server/adapters/cloudflare/tooling/operations.test.mjs`
- `src/server/adapters/cloudflare/tooling/safe-environment.mjs`
- `src/server/adapters/cloudflare/tooling/store-target.mjs`
- `src/server/adapters/cloudflare/tooling/test-accounts.mjs` (deleted)
- `src/server/adapters/cloudflare/tooling/test-accounts.test.mjs` (deleted)
- `src/server/adapters/cloudflare/tooling/test-workflow.mjs` (deleted)
- `src/server/adapters/cloudflare/tooling/test-workflow.test.mjs` (deleted)
- `src/server/adapters/d1/store.test.ts`
- `src/server/adapters/d1/store.ts`
- `src/server/adapters/d1/testFixture.ts`
- `src/server/adapters/d1/testMetrics.test.ts`
- `src/server/adapters/supabase/http.ts`
- `src/server/adapters/supabase/store.test.ts`
- `src/server/adapters/supabase/store.ts`
- `src/server/applicationStore.ts` (deleted)
- `src/server/authentication.ts`
- `src/server/authenticationHttp.ts`
- `src/server/workflow.ts`
- `wrangler.d1-proof.jsonc` (deleted)
- `src/server/adapters/cloudflare/tooling/test-store.mjs` (created)
- `src/server/adapters/cloudflare/tooling/test-store.test.mjs` (created)
- `src/server/http.ts` (created)

## 3. Commands run

Inspection used `git status`, `git diff`, `rg`, `cat`, `sed`, `nl`, and `wc`.
GitHub reads inspected PR #21 and PR #42.
The Google TypeScript guide was read before TypeScript edits.
Editing used `apply_patch` and `python3`. An initial `python` command was unavailable and changed no files.
The completed local commands include:

```sh
WRANGLER_WRITE_LOGS=false WRANGLER_SEND_METRICS=false npm test -- --maxWorkers=2
npm run typecheck
npm run lint
npm run build
npm run check:functions
npm run test:functions
npm run test:e2e -- --workers=2
npm run test:auth:browser
npm run test:connector:runtime
npm run test:connector:ui:local
npm run docs:build
npm run docs:test
npm run test:providers:list
MINSKY_TEST_PROJECT_REF=ghtztmovdkhuketcbjmq CI=true npm run test:cloud -- --grep 'real accounts share the journey|organizer creates username accounts'
MINSKY_TEST_PROJECT_REF=ghtztmovdkhuketcbjmq CI=true npm run test:cloud -- --config=.wrangler/pr42-supabase-diagnostics/config.ts
npm audit --package-lock-only --audit-level=high
npm --prefix site audit --package-lock-only --audit-level=high
git diff --check
```

Focused Vitest runs used temporary local D1 and R2 bindings with remote access disabled.
The pinned Gitleaks binary passes the staged-diff scan and the full 129-commit history scan.
Both ordinary GitHub runs also pass their secret and dependency jobs.

New image-expiry and inherited-environment regressions failed before their corrections.
Local emulator ports required sandbox escalation. The optional Gitleaks directory scan flagged an existing ignored public Supabase publishable key in `.env.local`. That file remained unchanged. Tracked-source and Git-history scans are recorded separately.

The fresh-installation trial used a separate clean clone at `2b6f6f0`, `npm ci`, and explicit Wrangler configuration paths.
Wrangler commands included `whoami`, `d1 list`, `d1 create --location=apac --update-config=false`, `d1 execute --remote`, `r2 bucket list`, `r2 bucket create --update-config=false`, `r2 bucket dev-url get`, `r2 bucket domain list`, `deploy --dry-run`, and `deploy`.
The provider-owned installer ran `plan`, `configure`, `migrate`, `bootstrap`, `secret`, and `recover` with explicit target arguments.
Repeated `bootstrap` and `secret` commands were intentionally rejected.
The Cloudflare build used `VITE_BACKEND=cloudflare npm run build`.
The trial ran `node node_modules/@playwright/test/cli.js test --config .wrangler/installation-tests/playwright.config.ts`, followed by the scoped cleanup and read-only evidence scripts.
Credential values stayed in private files or memory. They were absent from command arguments and public output.

Protected verification was dispatched with:

```sh
gh workflow run checks.yml --ref feature/t0020-cloudflare-connector -f cloudflare_connector=true
gh workflow run checks.yml --ref feature/t0020-cloudflare-connector -f existing_backend=true
gh run rerun 39114729684 --failed
```

## 4. Build and test results

Local verification passes on the executable changes before publication:

- All 612 unit, database, and tooling cases pass across 40 files, with zero skips.
- Type checking, ESLint, the default frontend build, and all Deno function checks pass.
- All 12 function tests and 45 ordinary browser cases pass.
- All three secure-cookie and origin browser cases pass.
- The complete local HTTPS runtime and complete local React journey each pass.
- The documentation build checks 528 local links and assets across 13 pages. All three docs browser cases pass.
- A repository Markdown audit checks 322 relative paths and heading links with no missing targets.
- Both locked dependency audits report zero vulnerabilities.
- Shared-provider discovery retains all eight required scenarios.

Focused checks also pass all 70 D1 workflow cases, two metrics cases, and 83 current account cases.
The two changed authentication cases separately pass on an isolated four-migration fixture.
This filtered compatibility check does not replace the complete current suites.
The original image-expiry regression and two environment-isolation assertions failed before their fixes.
A moved shared type initially exposed extensionless imports to Deno. Explicit `.ts` imports correct that failure.
A nested Vitest smoke test initially hit sandbox process restrictions. The approved rerun passes without reporter changes.

Ordinary [push CI](https://github.com/GiftedNovaHD/minsky/actions/runs/39114654044) and [PR CI](https://github.com/GiftedNovaHD/minsky/actions/runs/39114656733) pass on executable source `2b6f6f093eabec159857863c295ab21fd04bae83`.
A clean checkout of that source passes the complete empty-installation procedure and browser trial.
The browser case passes in 248.574 seconds with no failures, skips, flaky results, infrastructure errors, or retries.
All nine migrations, both owner password gates, repeated-initialization safeguards, trusted recovery, and exact fixture cleanup pass.
The final read-only audit passes at 09:24:06.795 UTC. A further refusal proof passes at 09:24:53.362 UTC.
The [current-state record](current-state.md#fresh-installation-after-review-fixes) identifies the resources and retained installation baseline.
Protected [Cloudflare run 39114678438](https://github.com/GiftedNovaHD/minsky/actions/runs/39114678438) passes on `2b6f6f0`.
It passes all 70 hosted workflow cases, 82 account cases, eight shared scenarios, and the complete hosted React journey.
The workflow and account suites have zero skips. The React result has zero failures, skips, or flaky cases.
Scoped cleanup passes, with no retained recovery journal or artifact.
Protected Supabase attempt 1 passes its prerequisites but fails two of 16 browser cases at five-second UI assertions.
The queue appears in immediate post-failure diagnostics. The reset failure lacks sufficient evidence to identify its cause.
The two cases pass unchanged locally in 1.1 minutes. The complete ordered suite then passes all 16 cases in 2.5 minutes with scoped cleanup.
Temporary credential-free diagnostics do not reproduce either failure. No deadline or retry setting changes.
Protected [attempt 2](https://github.com/GiftedNovaHD/minsky/actions/runs/39114729684/attempts/2) passes on the same source: all 16 browser cases, eight shared scenarios, and five trusted workflow cases.
It uses the existing Minsky CI backend without configuration changes, migrations, function deployments, or secret updates.
Scoped cleanup passes with no retained fixture journal or artifact.
The final evidence update changes documentation only; its ordinary PR checks verify that final head.

## 5. Manual verification steps

Traced every retired proof caller and preserved the current application and active Supabase paths.
Checked the new artifact paths against the hosted UI and D1 journal locations.
The local and fresh-installation React journeys verify phone and keyboard behavior, current authorization, workflow, images, live updates, and exact fixture cleanup.
The fresh installation also verifies owner recovery and preservation of every installation, membership, role, issue, and history column.
The protected hosted React journey passes the same behavioral and cleanup boundaries.
No separate human acceptance run occurred.

## 6. Risks

The first protected Supabase attempt has two unreproduced UI failures. The reset failure has no confirmed cause. Later unchanged local and protected suites pass.
Live-contest capacity and real-data migration remain unverified.
No backend cutover is part of this change.

## 7. Follow-up tickets

T0020 remains the active ticket until owner review and merge.
Real-data migration, Docker packaging, AWS, and Terraform remain deferred.
The owner decides whether to close PR #21 as superseded.

## 8. Documentation that needs updating

None. The PR description links the final required checks after publication.
