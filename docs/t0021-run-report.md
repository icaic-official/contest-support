# T0021 preparation and verification, 2026-10-18

This run prepares the fresh Cloudflare development installation in [PR #43](https://github.com/GiftedNovaHD/minsky/pull/43).
It includes merged PR #42 at `104d9d1`. The owner reviews and merges.
Supabase remains active and intact. No backend switch occurred.

## 1. Summary of changes

Added explicit deployment backend selection and complete Worker publication.
The static path checks live bindings and refuses to overwrite an activated Worker.
The complete path checks the exact account, D1 schema, private R2, origin, and secret metadata.
Build and publication records must agree on revision, backend, database, bucket, and origin.
Publication then checks the deployed bindings and anonymous API rejection.
Docs deploy independently. App previews skip until independent preview resources exist.

Committed the prepared public development settings and generated complete Worker configuration.
Neither file activates Cloudflare mode. Missing activation settings preserve Supabase.
Added a credential-free test of the actual configuration and both backend selections.
Documented provider interfaces, registration, transport reuse, migrations, bootstrap, cleanup, and shared verification requirements.
Kept one installation guide and one development activation procedure.

Provisioned separate development and installation-verification resources after PR #42 merged.
Both fresh installations pass bootstrap, the complete React journey, all eight shared scenarios, expiry, owner recovery, and scoped cleanup.
The [current-state record](current-state.md#t0021-fresh-development-installation-2026-10-18) owns exact resources, versions, timestamps, and evidence.
The [activation procedure](activate-cloudflare-development.md) owns the proposed switch, exact configuration, commands, and repair sequence.
Candidate traffic and scheduled work must stop before stable publication, because the Workers would otherwise compete for shared notifications.

Temporary disruption during activation is limited to the candidate URL while its routes and schedules stop.
The existing Supabase URL remains available until the approved full Worker publication.
Repair preserves the fresh database, images, administrator, and stable authentication secret.
No application workflow, database rule, migration, or Supabase resource changed.
No TypeScript or TSX production file changed, so this run introduces no new TypeScript style exception.

## 2. Files changed

- `.github/workflows/checks.yml`
- `AGENTS.md`
- `PLAN.md`
- `README.md`
- `docs/activate-cloudflare-development.md`
- `docs/add-provider.md`
- `docs/backend-contracts.md`
- `docs/cloudflare-backend-design.md`
- `docs/cloudflare-build-settings.md`
- `docs/cloudflare-builds.md`
- `docs/cloudflare-preview-behavior.md`
- `docs/current-state.md`
- `docs/product-direction.md`
- `docs/provider-test-contracts.md`
- `docs/run-provider-tests.md`
- `docs/t0021-run-report.md`
- `docs/tickets.md`
- `package.json`
- `scripts/deploy-workers.mjs`
- `scripts/deploy-workers.test.mjs`
- `site/src/content/docs/contributing/development.md`
- `site/src/content/docs/operators/installation.md`
- `src/server/adapters/cloudflare/deploy/development.settings.json`
- `src/server/adapters/cloudflare/deploy/development.wrangler.jsonc`

## 3. Commands run

Repository inspection used `git status`, `git log`, `git diff`, `rg`, `cat`, and `sed`.
Git commands created the separate worktree, saved preparation, fetched main, merged `origin/main`, checked trailers, and pushed the ticket branch.
The only merge was main into T0021. No pull request was merged.
GitHub reads checked PR #42, PR #43, Actions runs, variable and secret names, the deployment flag, and protected environment rules.
`gh pr create --draft` prepared PR #43.
The owner later approved one protected branch entry. `gh api --method POST` added only `feature/t0021-cloudflare-development-install` as entry `63467138`.
Read-only API checks confirm all six earlier entries and rule `69128862` remain unchanged.

Local checks included these commands:

```sh
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npx vitest run scripts/deploy-workers.test.mjs
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
npm audit --package-lock-only --audit-level=high
npm audit --prefix site --package-lock-only --audit-level=high
node --check scripts/deploy-workers.mjs
git diff --check
```

A clean local clone of `f6864f6` ran `npm ci` and `VITE_BACKEND=cloudflare npm run build`.
Python parsed the workflow YAML and checked publication prerequisites and the protected environment name.
The pinned Gitleaks binary scanned the complete Git history with redacted output.
The writing check and local Markdown path checks ran on the changed guides.

Provider commands used explicit configurations, account IDs, and database UUIDs.
Captured Wrangler commands included `whoami`, `auth token --json`, `d1 list`, `d1 create --location=apac --update-config=false`, `d1 info`, and read-only `d1 execute` queries.
R2 commands included bucket list/create, managed-domain status, and custom-domain list.
Deployment used `wrangler deploy --dry-run`, `wrangler deploy`, and deployment version metadata reads.
The provider-owned installer ran `plan`, `configure`, `migrate`, `bootstrap`, `secret`, and `recover`.
Repeated bootstrap and initial-secret commands intentionally failed. Read-only wrappers confirmed their exact refusal reasons.
No token, password, cookie, hash, or secret value appeared in command arguments or public output.

Fresh trials ran these private scripts for each pinned manifest:

```sh
node /tmp/minsky-t0021-operations/prepare.mjs
node /tmp/minsky-t0021-operations/install.mjs
node /tmp/minsky-t0021-verification/build-trial.mjs
node /tmp/minsky-t0021-verification/run-trial.mjs
node /tmp/minsky-t0021-verification/cleanup-proof.mjs
node /tmp/minsky-t0021-verification/final-evidence.mjs
```

Each command selected either `/tmp/minsky-t0021-development/manifest.json` or `/tmp/minsky-t0021-installation/manifest.json` through `MINSKY_INSTALL_TRIAL_MANIFEST`.
The wrappers pin the exact account, current configuration, source revision, Worker, database, bucket, and origin.
They import the current React journey and unchanged shared scenarios.
Private fixture copies retain their current code with an exact installation target guard. Committed CI target guards remain unchanged.
The phone walkthrough ran through another private Playwright wrapper with UUID-owned setup and cleanup.

Direct hosted checks ran the complete `test:connector:workflow:hosted` and `test:connector:accounts:hosted` commands against `connector-store-ci.wrangler.jsonc`, account `458ad6a930b0fb717796dfa19ca6a2b1`, database `341350ba-7c74-4c46-8b21-edfdcda475f5`.
Read-only deployment checks exercised the actual static guard, complete preflight, binding checks, private bucket checks, and anonymous denial against the candidate.
The Builds API read used exact Worker tags and returned `403` for both stable Workers.
The supplementary compound count audit could not confirm its query result. A scalar-count query then verifies zero rows across all 27 store CI tables.

Later private commands include `final-connector-ci.mjs`, `recover-final-store.mjs`, and `rerun-final-store.mjs` under `/tmp/minsky-t0021-operations/`.
They deploy only the pinned full CI target, recover only a journal-owned store fixture, and repeat the unchanged direct suites.
No raw failed child output was printed or saved. The narrow diagnostic reports only case positions and error categories.

Initial sandbox runs failed at Git metadata writes, network access, emulator sockets, browser startup, or esbuild's install check.
Approved reruns passed. A dependency symlink initially broke Astro compilation, so the worktree now has its own dependencies.
Before the pause, a concurrent local run passed 619 cases and timed out during one D1 startup. Post-merge runs with two workers pass all cases.
The owner-requested pause interrupted the earlier retry and browser run. Those results were not counted as passes.
An initial patch application failed validation and changed no files. The corrected patch passed.

## 4. Build and test results

Final local static verification passes:

- All 623 unit, embedded database, D1, and tooling cases pass across 40 files, with no skips.
- All 30 deployment cases pass, including the actual generated settings and disabled activation default.
- Type checking, ESLint, the default app build, Deno checks, and all 12 function tests pass.
- All 45 ordinary browser cases and three authentication browser cases pass after main integration.
- The complete local HTTPS runtime and complete local React journey pass with exact fixture cleanup.
- The documentation build checks 13 pages and 531 local links and assets. All three docs browser cases pass.
- Both locked dependency audits report zero vulnerabilities. The full Git-history secret scan passes.
- Shared scenario discovery retains all eight cases. Workflow YAML and whitespace checks pass.

Both fresh hosted installations pass the complete journey, eight shared scenarios, owner password gates, recovery, expiry, and cleanup.
Each retains its initialized administrator, event, session, roster, and audit history.
No trial workflow record, image, deletion task, pending notification, or fixture recovery journal remains.
The hosted D1-only suites pass all 70 workflow cases and 82 account cases, with zero failures or skips.

Ordinary push and PR CI pass on `f6864f6`.
The final public configuration, its test, and evidence also require ordinary CI. See [PR #43 checks](https://github.com/GiftedNovaHD/minsky/pull/43/checks) for that source's current result.
The owner approved the exact T0021 protected branch entry. It is installed; protected final verification remains to run.
Ordinary push and PR checks also pass on final executable/configuration source `33e76b2`.
That source passes all eight official hosted provider cases and the complete hosted UI case on CI Worker version `1e41f5ce-230e-4f4b-b270-659ecea85a73`.
The final direct workflow attempt passes 69 cases and fails one; its cause is unconfirmed because private output was not retained.
Atomic scoped recovery passes 17 ownership checks and 18 independent absence checks, then removes its journal.
A complete unchanged repeat passes all 70 workflow cases. The following account run passes 75 cases and fails seven, including network and cleanup errors, with three journals retained.
That account run is not a pass. Its recovery and further results are recorded in PR #43.
The later authorization/evidence commit changes documentation only.
Local hosted results do not replace that protected result.
Activation and subsequent automated stable deployment are not run. Both remain behind the explicit activation approval.

## 5. Manual verification steps

Reviewed current provider boundaries, workflow reuse, generated bindings, private credentials, CI conditions, and target checks.
Inspected actual hosted volunteer screenshots at 320 × 740 and 390 × 844.
Keyboard opening of an issue, refresh, and horizontal overflow checks pass in that walkthrough.
The complete journeys separately verify persisted timers, public/internal separation, images, roles, jury actions, and reconnects.
No separate human acceptance run occurred.

Before activation, confirm independent Cloudflare Git builds in the dashboard.
Have the owner approve the exact main revision and switch.
Stop candidate routes and cron before publication, then verify the stable URL.
Verify a subsequent automated stable deployment too. These are pending steps, not completed checks.

## 6. Risks

Protected final verification and activation remain incomplete.
Current access cannot read Workers Builds settings. The earlier owner confirmation remains historical evidence.
The first stable activation has no earlier complete stable Worker. Repair must use verified candidate code with the stable configuration and preserve the stable secret.
Two active Workers sharing these notifications could deliver hints to the wrong namespace. The activation procedure stops the candidate first.
Live-contest capacity and backup restoration remain unverified. This run makes no claim about either.

## 7. Follow-up tickets

Continue T0021 through the remaining protected check, owner review and merge, explicit activation approval, and subsequent-deployment verification.
No new ticket or speculative backlog is required.
AWS, GCP, Azure, Terraform, Docker packaging, and data migration tooling remain outside this ticket.

## 8. Documentation that needs updating

The PR checks and description record the final ordinary CI result and source.
Record protected results after the approved branch run completes.
The current PR description records later local fixture recovery, repeats, and exact protected run results separately.
After approval and activation, record the approved main revision, stable namespace/version, and subsequent automated deployment.
Current procedures state these pending gates explicitly.
