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

Published one complete [installation procedure](../site/src/content/docs/operators/installation.md).
Removed superseded proof and implementation walkthroughs, obsolete installer navigation, repeated status summaries, and old ticket instructions from agent guidance.
Historical records link to their frozen source revision.

Temporary breakage was limited to the ticket branch while retired commands, tests, and documentation changed together.
Full static and runtime verification is required before owner review.
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
- `docs/verify-server-workflow.md`
- `package.json`
- `scripts/d1-proof.mjs`
- `site/astro.config.mjs`
- `site/src/content/docs/index.md`
- `site/src/content/docs/operators/backend.md`
- `site/src/content/docs/operators/installation.md`
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
- `src/server/adapters/cloudflare/tooling/test-accounts.mjs`
- `src/server/adapters/cloudflare/tooling/test-accounts.test.mjs`
- `src/server/adapters/cloudflare/tooling/test-workflow.mjs`
- `src/server/adapters/cloudflare/tooling/test-workflow.test.mjs`
- `src/server/adapters/d1/store.test.ts`
- `src/server/adapters/d1/store.ts`
- `src/server/adapters/d1/testFixture.ts`
- `src/server/adapters/d1/testMetrics.test.ts`
- `src/server/adapters/supabase/http.ts`
- `src/server/adapters/supabase/store.test.ts`
- `src/server/adapters/supabase/store.ts`
- `src/server/applicationStore.ts`
- `src/server/authentication.ts`
- `src/server/authenticationHttp.ts`
- `src/server/workflow.ts`
- `wrangler.d1-proof.jsonc`
- `src/server/adapters/cloudflare/tooling/test-store.mjs`
- `src/server/adapters/cloudflare/tooling/test-store.test.mjs`
- `src/server/http.ts`

## 3. Commands run

Inspection used `git status`, `git diff`, `rg`, `cat`, `sed`, `nl`, and `wc`.
GitHub reads inspected PR #21 and PR #42.
The Google TypeScript guide was read before TypeScript edits.
Editing used `apply_patch` and `python3`. An initial `python` command was unavailable and changed no files.
Focused Vitest runs used temporary local D1 and R2 bindings with remote access disabled.
New image-expiry and inherited-environment regressions failed before their corrections.
Local emulator ports required sandbox escalation. The optional Gitleaks directory scan flagged an existing ignored public Supabase publishable key in `.env.local`. That file remained unchanged. Tracked-source and Git-history scans are recorded separately.

## 4. Build and test results

Local verification passes on the executable changes before publication:

- All 612 unit, database, and tooling cases pass across 40 files, with zero skips.
- Type checking, ESLint, the default frontend build, and all Deno function checks pass.
- All 12 function tests and 45 ordinary browser cases pass.
- All three secure-cookie and origin browser cases pass.
- The complete local HTTPS runtime and complete local React journey each pass.
- The documentation build checks 527 local links and assets across 13 pages. All three docs browser cases pass.
- Both locked dependency audits report zero vulnerabilities.
- Shared-provider discovery retains all eight required scenarios.

Focused checks also pass all 70 D1 workflow cases, two metrics cases, and 83 current account cases.
The two changed authentication cases separately pass on an isolated four-migration fixture.
This filtered compatibility check does not replace the complete current suites.
The original image-expiry regression and two environment-isolation assertions failed before their fixes.
A moved shared type initially exposed extensionless imports to Deno. Explicit `.ts` imports correct that failure.
A nested Vitest smoke test initially hit sandbox process restrictions. The approved rerun passes without reporter changes.

Hosted, protected, and fresh-installation verification is pending for the published executable revision.
Earlier passing hosted runs do not verify these changed files.

## 5. Manual verification steps

Traced every retired proof caller and preserved the current application and active Supabase paths.
Checked the new artifact paths against the hosted UI and D1 journal locations.
The local React journey verifies phone and keyboard behavior, current authorization, workflow, images, live updates, and exact fixture cleanup. Hosted and fresh-installation verification remains pending.

## 6. Risks

Live-contest capacity and real-data migration remain unverified.
No backend cutover is part of this change.

## 7. Follow-up tickets

T0020 remains the active ticket until owner review and merge.
Real-data migration, Docker packaging, AWS, and Terraform remain deferred.
The owner decides whether to close PR #21 as superseded.

## 8. Documentation that needs updating

Record the hosted, protected, and empty-installation results after verification.
