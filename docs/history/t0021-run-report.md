# T0021 preparation and verification, 2026-10-18

This page keeps dated run records. See [the activation report](#owner-merge-and-approved-activation-2026-10-19) for the stable switch and repeat deployment.
See [the frontend follow-up](#frontend-organization-and-routing-2026-10-20) for the owner's later addition to PR #45.

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
The [run log](run-log.md#t0021-fresh-development-installation-2026-10-18) owns exact resources, versions, timestamps, and evidence.
The [activation procedure](../activate-cloudflare-development.md) owns the proposed switch, exact configuration, commands, and repair sequence.
Candidate traffic and scheduled work must stop before stable publication, because the Workers would otherwise compete for shared notifications.

Temporary disruption during activation is limited to the candidate URL while its routes and schedules stop.
The existing Supabase URL remains available until the approved full Worker publication.
Repair preserves the fresh database, images, administrator, and stable authentication secret.
No application workflow, database rule, migration, or Supabase resource changed.
No TypeScript or TSX production file changed, so this run introduces no new TypeScript style exception.

After the owner requested connection diagnosis, added an explicit D1 API transport for the two isolated hosted store suites.
The original native binding transport remains the default and the protected GitHub path.
Both transports retain all cases, assertions, timeouts, and fixture ownership checks.
The API path keeps batches atomic, preserves values and metadata, spaces request starts, and never retries requests.
Only the two TypeScript test integration files change. No production rule, workflow, schema, or frontend behavior changes.

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
- `src/server/adapters/cloudflare/authenticationCases.ts`
- `src/server/adapters/cloudflare/tooling/store-database.mjs`
- `src/server/adapters/cloudflare/tooling/store-database.d.mts`
- `src/server/adapters/cloudflare/tooling/store-database.test.mjs`
- `src/server/adapters/cloudflare/tooling/test-store.mjs`
- `src/server/adapters/cloudflare/tooling/test-store.test.mjs`
- `src/server/adapters/d1/store.test.ts`

## 3. Commands run

Repository inspection used `git status`, `git log`, `git diff`, `rg`, `cat`, and `sed`.
Git commands created the separate worktree, saved preparation, fetched main, merged `origin/main`, checked trailers, and pushed the ticket branch.
The only merge was main into T0021. No pull request was merged.
GitHub reads checked PR #42, PR #43, Actions runs, variable and secret names, the deployment flag, and protected environment rules.
`gh pr create --draft` prepared PR #43.
The owner later approved one protected branch entry. `gh api --method POST` added only `feature/t0021-cloudflare-development-install` as entry `63467138`.
Read-only API checks confirm all six earlier entries and rule `69128862` remain unchanged.
The first protected dispatch was canceled during ordinary prerequisites to save the recovered-fixture evidence before final verification.
It performed no hosted test or provider change. A new dispatch uses the final evidence revision.

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

Connection diagnosis later ran private `connection-probe.mjs`, `proxy-hop-probe.mjs`, and `d1-api-semantics.mjs` wrappers.
The first two issue only `SELECT 1` queries against the confirmed store CI target.
The semantic probe writes only its UUID-owned authentication-limit record, verifies rollback and metadata, then verifies its removal.
Diagnostic setup errors and an incorrect response-shape assumption were corrected in those private probes.
They did not change application assertions or fixture data.
The provider output stayed in memory. Public evidence contains fixed categories, counts, and source locations only.
The implementation checks include 17 focused API-transport tests and 19 runner tests.
The first full local suite could not open loopback ports inside the sandbox and reports `listen EPERM`.
Its host-context repeat passes all 645 cases. No assertion or timeout changed for that repeat.
Concurrent ordinary and authentication browser runs share Playwright's output directory.
The ordinary run passes 44 assertions, then fails one artifact teardown with `ENOENT`.
The separate complete repeat passes all 45 cases. The authentication browser suite passes all three cases.
Later browser commands run in sequence.

Direct hosted checks ran the complete `test:connector:workflow:hosted` and `test:connector:accounts:hosted` commands against `connector-store-ci.wrangler.jsonc`, account `458ad6a930b0fb717796dfa19ca6a2b1`, database `341350ba-7c74-4c46-8b21-edfdcda475f5`.
Read-only deployment checks exercised the actual static guard, complete preflight, binding checks, private bucket checks, and anonymous denial against the candidate.
The Builds API read used exact Worker tags and returned `403` for both stable Workers.
The supplementary compound count audit could not confirm its query result. A scalar-count query then verifies zero rows across all 27 store CI tables.

Later private commands include `final-connector-ci.mjs`, `recover-final-store.mjs`, `rerun-final-store.mjs`, and `recover-final-accounts.mjs --apply` under `/tmp/minsky-t0021-operations/`.
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
The owner approved the exact T0021 protected branch entry. It is installed. The final protected result is recorded in PR #43.
Ordinary push and PR checks also pass on final executable/configuration source `33e76b2`.
That source passes all eight official hosted provider cases and the complete hosted UI case on CI Worker version `1e41f5ce-230e-4f4b-b270-659ecea85a73`.
The final direct workflow attempt passes 69 cases and fails one; its cause is unconfirmed because private output was not retained.
Atomic scoped recovery passes 17 ownership checks and 18 independent absence checks, then removes its journal.
A complete unchanged repeat passes all 70 workflow cases. The following account run passes 75 cases and fails seven, including network and cleanup errors, with three journals retained.
That account run is not a pass.
Account recovery passes at 12:49:00 UTC. Two journals are already empty; the third retains only its marked records.
Each recovery passes 30 atomic ownership guards and 23 final atomic and independent absence checks before journal removal.
All 27 application tables are empty, foreign-key violations are zero, and shared IP counters are unchanged.
This recovery does not diagnose the seven failures. Further repeats and the final protected result are recorded in PR #43.
The authorization/evidence commits change documentation only.
The latest protected result is linked from PR #43. Local hosted results do not replace it.
Activation and subsequent automated stable deployment are not run. Both remain behind the explicit activation approval.

The later [connection diagnosis](run-log.md#local-verification-connection-diagnosis) identifies Wrangler's outgoing preview-proxy hop.
Five read-only remote calls fail while all 4,000 local D1 and local HTTP calls pass.
A later unchanged 6,000-call remote comparison passes, so this remains an intermittent fault.
The separate API semantic proof passes value binding, ordering, atomic rollback, metadata, and scoped cleanup.
The API transport is a verification workaround. It does not establish the underlying network cause or repair the preview proxy.
The first full API workflow run on `6e20cc1` passes 36 cases and fails 34 assertions. Fixture cleanup completes.
Its safe error mapping removes two fixed rollback identifiers that the workflow needs to distinguish retryable rollbacks from unknown outcomes.
The mapping now retains those exact identifiers. A focused test exercises the existing persistence commit with known and unknown failures.
No original workflow assertion or application rule changes.
The next API workflow run passes all 70 cases. The API account run on `ecad8b1` passes 81 cases and times out one.
It reports no network or API error. The read-only cleanup audit confirms all 27 application tables are empty.
The four-worker API runner gave each file a 1,200-millisecond request interval to share the API allowance.
API files now run in sequence at 300 milliseconds per request. Native checks retain four workers.
This change removes that per-file pacing penalty. It preserves all cases, assertions, within-case concurrency, and the original timeouts.
Fresh complete API-suite results and protected native-binding results on the final source are recorded separately in PR #43.

## 5. Manual verification steps

Reviewed current provider boundaries, workflow reuse, generated bindings, private credentials, CI conditions, and target checks.
Inspected actual hosted volunteer screenshots at 320 × 740 and 390 × 844.
Keyboard opening of an issue, refresh, and horizontal overflow checks pass in that walkthrough.
The complete journeys separately verify persisted timers, public/internal separation, images, roles, jury actions, and reconnects.
No separate human acceptance run occurred.
Reviewed the direct API endpoint, exact target guards, batch boundaries, request pacing, credential handling, and no-retry behavior.

Before activation, confirm independent Cloudflare Git builds in the dashboard.
Have the owner approve the exact main revision and switch.
Stop candidate routes and cron before publication, then verify the stable URL.
Verify a subsequent automated stable deployment too. These are pending steps, not completed checks.

## 6. Risks

Activation remains incomplete. Read the final protected result in PR #43; do not infer it from earlier local passes.
Current access cannot read Workers Builds settings. The earlier owner confirmation remains historical evidence.
The first stable activation has no earlier complete stable Worker. Repair must use verified candidate code with the stable configuration and preserve the stable secret.
Two active Workers sharing these notifications could deliver hints to the wrong namespace. The activation procedure stops the candidate first.
Live-contest capacity and backup restoration remain unverified. This run makes no claim about either.
The Wrangler preview connection fault remains unresolved. The API option avoids that hop only for isolated store verification.
API checks share the provider's rate allowance. Run them sequentially and retain journals after any failed or interrupted write.

## 7. Follow-up tickets

Continue T0021 through the remaining protected check, owner review and merge, explicit activation approval, and subsequent-deployment verification.
No new ticket or speculative backlog is required.
AWS, GCP, Azure, Terraform, Docker packaging, and data migration tooling remain outside this ticket.

## 8. Documentation that needs updating

The PR checks and description record the final ordinary CI result and source.
The current PR description owns the final protected run link and result, separately from local hosted runs.
This report records the completed local recovery and its limits.
After approval and activation, record the approved main revision, stable namespace/version, and subsequent automated deployment.
Current procedures state these pending gates explicitly.

## Maintainability review follow-up, 2026-10-19

This section records the later review follow-up. Earlier results above retain their original revisions.
PR #43 returned to draft for this work. The stable development URL still uses Supabase.

1. **Summary of changes** — Expanded workflow authorization conditions and D1 commit stages. Preserved SQL text, statement order, assertions, and atomic execution. Extended UI provider import checks. Added shared account-creation, image-limit, and reconnect scenarios. Reused one response-loss helper across both providers and removed duplicate reporter timestamp state. Corrected current instructions while retaining historical evidence.
2. **Files changed** — `AGENTS.md`, `PLAN.md`, `eslint.config.js`, `scripts/provider-boundaries.test.mjs`, both provider fixture test files, `src/server/workflow.ts`, `src/server/adapters/d1/store.ts`, the hosted progress reporter, provider browser/fixture/contracts/scenario files, the browser bridge regression, and the focused workflow/UI fixture types. Updated the existing provider, onboarding, authentication, current-state, ticket, and run-report pages. The commit diff owns the exact path list.
3. **Commands run** — `npm run typecheck`, `npm run lint`, `npm run build`, `npm test -- --maxWorkers=1`, focused workflow and provider tests, `npx vitest run --config vitest.d1.config.ts`, `npm run check:functions`, `npm run test:functions`, `npm run test:e2e`, `npm run test:auth:browser`, `npm run test:connector:runtime`, `npm run test:connector:ui:local`, `npm run docs:build`, `npm run docs:test`, `npm run test:providers:list`, and `git diff --check`. A TypeScript AST comparison checks all D1 SQL/string parts against the previous source.
4. **Build/test results** — Types, lint, app build, docs build, and function checks pass. Function tests pass 12/12. Focused workflow tests pass 5/5 and local D1 tests pass 70/70. Authentication browser tests pass 3/3. The complete local runtime and React journey each pass, including cleanup. Discovery lists 11 shared scenarios. The first full unit run passes 654/656: one existing local clock case exceeds its 5-second limit; one new cleanup test intercepts a prerequisite request by mistake. The unchanged authentication file then passes 23/23. The cleanup interception is corrected. The first ordinary browser run passes 44/45: the new socket interception overrides an earlier fixture route. The route order is corrected. The corrected focused runs pass 8/8 bridge cases, 17/17 Cloudflare fixture/transport cases, and 11/11 Supabase fixture cases. The real socket regression also requires the server connection to close. The complete browser repeat passes 46/46 with no retries. The final complete unit repeat passes 656/656 across 42 files. No test timeout, retry, or assertion was weakened. Docs browser tests pass 3/3 and all 219 changed-document local paths exist. Fresh hosted checks are not yet available at this commit snapshot. PR #43 owns the final source revision, hosted run links, and results; earlier passes do not verify this revision.
5. **Manual verification steps** — Reviewed the changed guards against their earlier Boolean conditions. Confirmed exact equality and source order for all 82 D1 string/template parts. Reviewed lost-create ownership discovery, pre-write account markers, private journals, scoped cleanup, real socket interruption, and the two current callers of the response-loss helper. No new human UI acceptance run occurred.
6. **Risks** — Fresh hosted verification of the expanded registry remains pending. The earlier protected pass on `0254f60` does not verify this change. Billing API reads return `403`; the owner reports no extra charges so far. Use only bounded required checks within the existing $5 plan. No optional stress test, resource creation, or upgrade is part of this follow-up. The underlying Wrangler preview-proxy fault remains unresolved; the existing API verification option remains a workaround.
7. **Follow-up tickets** — Continue T0021 through review, owner merge, explicit activation approval, and subsequent-deployment verification. No new ticket is created. Future provider implementations remain contributor work.
8. **Docs that need updating** — Local results are recorded above. PR #43 owns the post-commit protected results and exact tested revision. After approved activation, record the stable revision and subsequent automated deployment. Current procedures keep those gates explicit.

### Cleanup ownership correction

A later review finds that a planned created-account username is not proof that the account exists.
A foreign account with that username and a different full name is correctly excluded from account discovery.
The new cleanup code nevertheless included its username authentication-counter key.
An in-memory SQLite probe confirms zero discovered accounts, a preserved foreign account, and one incorrectly deleted foreign counter.
Cleanup now includes a planned username key only after its account ID is proved and retained.
A real local D1 regression preserves the foreign account and every field of its counter.
The existing lost-create-response test still proves cleanup of a discovered account.
Focused fixture checks pass 18/18. The complete local suite then passes 657/657 across 42 files. Type checking, full lint, app build, and whitespace checks pass.
This correction changes verification cleanup only. Application code, shared scenarios, database rules, and deployment settings remain unchanged from `da75d72`.

Protected [Cloudflare run 39147864416](https://github.com/GiftedNovaHD/minsky/actions/runs/39147864416) on `da75d72` passes 70 workflow, 82 account, 11 shared, and one UI case.
It has zero failures, skips, flaky results, or recovery artifacts. Its CI Worker version is `cacf2b33-25ad-4877-8141-f91618a18ebd`.
Those results precede this fixture correction. PR #43 records fresh final-revision checks separately.

## Owner merge and approved activation, 2026-10-19

This section records the later operational run. Earlier sections retain their recorded revisions, failures, and authorization limits.
The [activation record in the run log](run-log.md#t0021-approved-activation-2026-10-19) owns exact resources, versions, times, and separate verification results.

1. **Summary of changes** — The owner merges PR #43 at `4e43739` and separately approves activation and repeat deployment. The existing fresh installation now serves the stable URL through Cloudflare. Both automated deployments pass their application checks. The candidate remains stopped. Supabase resources and accounts remain intact. No Supabase accounts, passwords, records, images, or IDs transfer.
2. **Files changed** — `README.md`, `AGENTS.md`, `PLAN.md`, `docs/tickets.md`, `docs/current-state.md`, `docs/t0021-run-report.md`, `docs/activate-cloudflare-development.md`, `docs/backend-contracts.md`, `docs/cloud-onboarding.md`, `docs/cloudflare-authentication.md`, `docs/cloudflare-authentication-choice.md`, `docs/cloudflare-backend-design.md`, `docs/cloudflare-builds.md`, `docs/cloudflare-build-settings.md`, `docs/jury-worklist.md`, `docs/product-direction.md`, `docs/server-workflow.md`, `docs/verify-cloudflare-authentication.md`, `site/src/content/docs/operators/installation.md`, and `site/src/content/docs/reference/status.md`, `scripts/deploy-workers.mjs`, and `scripts/deploy-workers.test.mjs`. The publisher parser and one regression case change. Application runtime, generated config, workflows, and protected fixtures remain unchanged. Private operation scripts and recovery journals remain outside Git.
3. **Commands run** — Git fetch, fast-forward update, tree comparison, and GitHub PR/check reads; six `gh variable set` commands; `gh run rerun 39252514749` for attempts 2, 3, and 4. The supported `npm run cloudflare:install -- plan` and `npm run cloudflare:install -- secret` use the exact approved arguments in the activation guide. `VITE_BACKEND=cloudflare npm run build` and the complete Worker dry run pass. Private commands under `/tmp/minsky-t0021-operations` run candidate shutdown, prepublication guards, workflow evidence collection, two stable verification runs, first and repeat audits, and the phone walkthrough. Documentation checks use `npm run docs:build`, `npm run docs:test`, the focused keyboard-search test, `python3 /tmp/minsky-t0021-operations/check-documentation-links.py --checkout`, and `git diff --check`. The docs-preview follow-up also runs `npm test -- scripts/deploy-workers.test.mjs` and lint. No repair or bootstrap command runs.
4. **Build/test results** — Final protected checks pass at `2125875`; its tree matches merged source `4e43739`. Main attempt 1 passes ordinary CI before activation. Publication attempts 3 and 4 pass every ordinary and publication job. Each stable CLI run passes 14/14 with zero failures, skips, flaky results, infrastructure errors, or retained fixture journals. The phone walkthrough passes 1/1 with cleanup. Documentation build, three browser cases, 310 relative links and fragments, and whitespace checks pass. The build checks 13 HTML pages and 531 local links and assets. Failed Supabase waits, publication attempt 2, candidate immediate-check failure, and the stopped post-walkthrough read audit remain recorded in current state. No assertion, timeout, target guard, or environment protection changes. Records source `6cfe1d2` passes ordinary PR CI and all three ordinary push jobs. The push then fails docs-preview parsing after a successful upload. A bounded follow-up passes all 31 deployment cases and lint locally. Its fresh CI and actual preview verification belong in PR #45. Local hosted results remain separate from protected Actions results.
5. **Manual verification steps** — The owner confirms both independent Git builds are disconnected. The operator checks exact account, resources, bindings, secret name, origin, cron, CPU cap, namespace retention, and final counts. Codex inspects fictional volunteer screenshots at 320 × 740 and 390 × 844. Text and controls remain within both widths. Keyboard navigation and refresh persistence pass. Physical devices and native browser zoom are not run.
6. **Risks** — Billing reads return `403`; the owner limits work to the existing $5 plan. The Wrangler preview-proxy fault remains unresolved. Live-contest capacity and backup restoration remain unverified. The first docs wait and stopped final read audit have unconfirmed causes. The later docs-preview parser failure has a confirmed cause and a correction in PR #45. Their unchanged repeats pass. No stable application failure requires repair.
7. **Follow-up tickets** — T0021 is complete. The owner decides whether to close superseded PR #21. Capacity, restoration, and documentation-release work retain their separate scope. No new development ticket is created.
8. **Docs that need updating** — Owner review and merge of the operational records and docs-preview parser correction in PR #45 remain pending. Relevant guides and records are updated in this change. The broader documentation release plan remains separate.


## Frontend organization and routing, 2026-10-20

The owner requests this change in existing PR #45. It extends the operational follow-up after the approved Cloudflare activation.
Earlier protected and stable results retain their original source revisions. They do not verify this frontend change.
The final commit and fresh ordinary and protected run links belong in PR #45, without a later evidence-only commit.

1. **Summary of changes** — Split the former 2,101-line connected application into a shared account gate and workspace under `src/app/`, with separate feature folders. Add `/issues`, `/administration`, `/account`, and `/jury` through React Router. Preserve current account and membership gates, shared session data, live updates, issue selection, filters, and uncertain command retries. Direct links retain their section through sign-in and reload. Navigation supports browser history and phone keyboard focus. The temporary local Worker now uses the same page fallback as existing deployment configurations. Server decisions, provider implementations, resources, configuration, and scoped cleanup remain unchanged.
2. **Files changed** — `src/main.tsx`; new `src/app/App.tsx` and `Workspace.tsx`; new `src/features/account/`, `administration/`, `authentication/`, `issues/`, and `jury/`; removed `src/connected/ConnectedApp.tsx`; moved the issue image UI, team search, jury components, and their focused helpers/tests into those feature folders. Shared form readers move to `src/connected/forms.ts`. Update `src/connected/ui.tsx`, `imagePreview.tsx`, and `src/styles.css`. Add `react-router` 7.18.4 to `package.json`, `package-lock.json`, and Deno's workspace lock inventory. Update six browser-test files, `AGENTS.md`, `PLAN.md`, `README.md`, this report, `docs/current-state.md`, `docs/tickets.md`, `docs/backend-contracts.md`, `docs/jury-worklist.md`, and the public contributor, sign-in, and status guides. Add `docs/frontend-structure.md`.
3. **Commands run** — Git and worktree inspection, GitHub PR/main/review reads, and `gh pr ready 45 --undo`. Read the Google TypeScript guide and official router documentation. Run `npm view react-router`, `npm install --save-exact react-router@7.18.4 --no-fund`, pinned Prettier, `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, and `npm test -- --maxWorkers=2`. Run `npm run check:functions`, `npm run test:functions`, `npm run test:providers:list`, focused Playwright cases, `npm run test:e2e -- --workers=2`, and its unchanged repeat with `--output=/tmp/minsky-t0021-frontend-e2e`. After adding optional-password route coverage, run the complete suite with `--output=/tmp/minsky-t0021-frontend-final-e2e`. Stop superseded protected runs with `gh run cancel` before hosted fixtures start. Run `npm run test:auth:browser`, `npm run test:connector:runtime`, and `npm run test:connector:ui:local`. Run `npm run docs:build`, `npm run docs:test`, local Markdown link checks, and `git diff --check`. Initial GitHub/formatter calls without network permission fail; permitted calls pass. The first draft command uses an unsupported flag, then the supported command succeeds.
4. **Build/test results** — Types, lint, application build, docs build, shared scenario discovery, 658 unit/database/tooling cases, 57 ordinary browser cases, 12 function cases, three authentication browser cases, three docs browser cases, and both complete local runtime journeys pass. Docs build checks 13 HTML pages and 534 local links/assets. The first unit run passes 656/658 and times out in two existing five-second checks. The complete two-worker run passes unchanged. The first full ordinary browser run passes 54/56 and loses two artifact closures because concurrent commands share their output root. The unchanged repeat uses a separate directory and passes 56/56. The first local UI journey fails on a deep-path reload because its asset setup omits the existing deployment fallback. Matching that fallback and adding HTTP 200/path assertions produces a complete passing run with scoped cleanup. Preliminary new-test locator errors are corrected. The later hosted-test review updates one old optional-password expectation to require `/account` across change and reload, followed by the existing Issues, sign-out, and sign-in checks. A new browser case verifies cancellation, completion, and reload on the same path. The final suite passes 57/57. Superseded protected runs stop before any hosted fixture job starts; fresh final-revision GitHub results remain separate and are recorded on the PR.
5. **Manual verification steps** — Source review checks access gates, provider boundaries, shared request IDs, atomic commands, and existing asset deployment behavior. Codex inspects fictional jury screens at 320px and 390px. Text and controls fit both widths. Browser checks exercise keyboard focus, the current phone link, browser history, refresh, revoked access, private-note separation, timers, ownership, jury decisions, images, and live updates. Physical devices and native browser zoom are not run. The owner reviews and merges; no stable publication occurs from this feature branch.
6. **Risks** — This change is pending owner merge and normal main publication. Saved section addresses require a hosting configuration with the documented page fallback; both existing deployment configurations already have it. Issue selection and filters survive section navigation but do not persist across a full reload. Existing double quotes and React component names remain deliberate style exceptions during extraction. React Router 7.18.4 preserves the current Node requirement; the current major release requires a newer minimum Node version. No provider secret, data transfer, migration, or new paid service is introduced.
7. **Follow-up tickets** — None created. This is the owner's requested addition to T0021 in PR #45. PR #21 disposition, capacity, restoration, and the broader documentation release retain their existing scope.
8. **Docs that need updating** — Relevant architecture, user, contributor, and ticket records are updated. The PR description owns final pushed revisions and fresh GitHub run links. Owner review and merge remain pending.

## Owner-requested manual frontend publication, 2026-10-20

This record preserves the deployment evidence previously held only in PR #45's description.
It is historical evidence for `adff06c`, before the later retry fixes.

1. **Summary of changes** — The owner explicitly requests manual publication before merge: "No go and manually deploy it to Cloudflare i need to see the change." At 2026-10-19 21:45:18 UTC, the full `minsky-dev` Worker publishes source `adff06cf59298ce94f8830c21de63044e336f0b9`. Version `71719a97-aa65-4b19-bcc7-3f6071288a04` replaces compatible version `9f3686bd-ffa8-46bf-977f-2d9554235d41`. The account, database, bucket, live namespace, six bindings, authentication secret, origin, cron, CPU cap, and asset fallback match the [approved installation](run-log.md#activation-sequence-and-exact-installation). No resource creation, migration, account reset, or Supabase mutation runs.
2. **Files changed** — None solely to record publication or restart completed checks. The deployment uses `src/server/adapters/cloudflare/deploy/development.wrangler.jsonc`.
3. **Commands run** — Pause publication with `CLOUDFLARE_DEPLOY_ENABLED=false`, confirm no active main publication job, check the exact account/database/migration names, run `VITE_BACKEND=cloudflare npm run build`, write the source/backend/resource marker, then run the complete Worker dry run and deployment. Restore publication to `true` after verification. No event, branch, deployment guard, or environment protection is fabricated or relaxed. Candidate routes, previews, and schedules remain disabled. R2 public access remains disabled.
4. **Build/test results** — Public checks pass for the exact revision marker and HTTP 200 at `/issues`, `/administration`, `/account`, and `/jury`. Anonymous protected API calls return 401. `/.env` returns 404. The independent stable docs site remains available. Earlier [push CI](https://github.com/GiftedNovaHD/minsky/actions/runs/39325970878), [PR CI](https://github.com/GiftedNovaHD/minsky/actions/runs/39325978404), and [protected Cloudflare](https://github.com/GiftedNovaHD/minsky/actions/runs/39326006900) pass on `adff06c`. [Protected Supabase](https://github.com/GiftedNovaHD/minsky/actions/runs/39326130328) is pending at publication and later fails two hosted cases. The later retry record explains that result. Superseded `5ca804f` runs `39324869658`, `39324875562`, `39324916481`, and `39324966455` are canceled. No hosted fixture or provider step starts in the canceled protected runs.
5. **Manual verification steps** — Bounded authenticated checks pass at 2026-10-19 21:46:36 UTC: existing-owner sign-in through `/administration`; account/issues navigation and authenticated reload; Back/Forward; live connection; 390px phone navigation and heading focus; and signout session revocation. No fictional records or objects are created. Credentials and cookies remain in memory. No trace or screenshot is saved. One script first times out while attempting signout with the phone menu closed. Opening the menu corrects that script. No product assertion changes. The docs preview marker identifies `adff06c` at 21:25:52 UTC; stable docs remain on `4e43739`.
6. **Risks** — Manual application source is ahead of main until owner merge. Publishing older main can replace it. Recovery uses the compatible full Worker procedure in `docs/activate-cloudflare-development.md` and preserves development data and secrets. This publication does not verify later source changes.
7. **Follow-up tickets** — None created. The owner reviews and merges PR #45.
8. **Docs that need updating** — None for this historical record. Later retry verification remains separate below.

## Retry review fixes, 2026-10-20

1. **Summary of changes** — Two subagents fix the backend and frontend retry findings in PR #45. Pending metadata records the original actor, session, request ID, and command above the transient account-check gate. Failed checks still hide protected content. Recovery permits an explicit retry without another submission. Identity changes clear the metadata. Late responses cannot clear a newer request or run callbacks from a removed workspace. The two failed hosted assertions now wait for route focus and jury rows. Server rules, provider contracts, deployment configuration, and stable application resources remain unchanged.
2. **Files changed** — `src/app/App.tsx`, `src/app/Workspace.tsx`, new `src/app/workflowRequest.ts`, `tests/workspace-refresh.spec.ts`, new `tests/workflow-session-retry.spec.ts`, `tests/cloud/journey.spec.ts`, `tests/cloud/jury.spec.ts`, `PLAN.md`, `README.md`, `docs/frontend-structure.md`, `docs/manual-verification.md`, `docs/current-state.md`, `docs/tickets.md`, and this report. Unique manual-publication evidence moves from the PR description into the historical record above.
3. **Commands run** — Git status, diff, and source comparisons. Read the Google TypeScript guide. Run focused ESLint and browser checks, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:functions`, `npm run test:functions`, `npm test -- --maxWorkers=2`, `npm run test:e2e -- --workers=2 --output=/tmp/minsky-pr45-retry-e2e`, `npm run test:auth:browser -- --output=/tmp/minsky-pr45-retry-auth`, `npm run test:connector:runtime`, `npm run test:connector:ui:local`, `npm run test:providers:list`, `npm run docs:build`, and `npm run docs:test -- --output=/tmp/minsky-pr45-retry-docs`. A private local browser script checks fictional volunteer accounts. GitHub reads identify the earlier hosted failures and confirm the unchanged protected branch entry and isolated Supabase CI target. `gh pr ready 45 --undo` returns the PR to draft. Initial network and focused browser-server attempts fail inside the sandbox. Approved runs pass. One temporary typecheck precedes the peer's required Workspace prop edit and fails. The final check passes.
4. **Build/test results** — Types, lint, app/docs builds, all 658 unit/database/tooling cases, 63 ordinary browser cases, 12 function cases, three authentication browser cases, and three docs browser cases pass. Both complete local Cloudflare journeys pass with fixture cleanup. The 11 shared provider scenarios remain discoverable. Six new browser cases cover uncommitted and committed submissions after session access removal, lost responses through account-check failure, delayed responses after remount, and signout before the same or another actor returns. Both session cases reproduce the wrong session on the original code and pass after the fix. The two changed hosted assertions require fresh protected verification. Earlier Supabase run `39326130328` remains failed evidence. Local results do not replace hosted results. The PR records fresh GitHub results for the pushed source.
5. **Manual verification steps** — Source review checks request ownership, original-session replay, hidden protected content, callback cleanup, and server rejection after revoked access. A fictional volunteer walkthrough checks keyboard navigation and authenticated account reload. Visual inspection checks volunteer screens at 320px and 390px and the jury screen at 320px. Controls fit those widths. Automated cases retain public/internal separation, persistence, ownership, timers, awards, private images, and live updates. Physical devices and native browser zoom are not checked.
6. **Risks** — Retry metadata remains in memory and does not survive a full page reload. The cached staff-image preview concern remains outside this requested backend/frontend fix. The PR stays draft until fresh verification completes. This run does not publish the stable application. Existing double-quoted application imports, React component names, and inferred component return types remain deliberate style exceptions for consistency with surrounding code.
7. **Follow-up tickets** — None created. Candidate: close downloaded staff-only previews when current access no longer permits the image. Existing PR #21 disposition, capacity, restoration, and documentation-release work retain their agreed scope.
8. **Docs that need updating** — Relevant guides and records are current. The PR description owns the pushed revision and fresh protected results. The owner reviews and merges.
