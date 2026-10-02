# Current state

T0001/T0002 merged in PR #1. T0003 provides cloud foundations and a connected issue workflow on `feature/t0003-cloud-product` and deployed as a development app; [PR #2](https://github.com/notbowen/minsky/pull/2) remains a draft while protected cloud CI setup and its first run are pending. The user deferred provider ownership/billing records, GitHub merge enforcement/vulnerability alerts and remaining user/manual acceptance checks to T0004 on 2026-10-02. The user replaced email onboarding with organizer-managed usernames/passwords; the revision below supersedes the original email requirements. The user reviews and merges. The initial PLAN.md run report and the demo results below are historical.

## Login landing page, sidebar and demo retirement (2026-10-02)

The user requested a main login landing page and side navigation, then explicitly requested removing the old local demo, unnecessary old tests and residue, and pushing the changes. This extends the current T0003 branch. The app has one runtime: real Supabase accounts/shared data. The original development event/roster remains configured data, not a persona simulation. Broader organizer editors and assignment tools are still missing; deployment completion does not imply a complete contest-management product.

Implemented:

- Public login landing page with **How it works**/**Sign in** navigation and role/workflow guidance. Existing username/password login and organizer-assisted recovery remain.
- Desktop sidebar separates issues, **Administration** and **My account**. Administration appears only for a current admin membership. Team and jury issue labels reflect their existing permissions. Account details show the signed-in username, session and permissions with access to password change.
- On phones, **Menu** expands/collapses navigation. Selecting a section closes it and focuses its heading. Queue/selection/filter state remains in the current dashboard while switching sections; reload returns to issues. Current membership is still refetched and all backend permission checks remain.
- Removed the local demo entry point, personas/reset, seed/domain code, browser-local issue storage and v1 migration, demo-only unit/browser tests, v1 fixture, demo command, specification and obsolete manual walkthrough. Isolated cloud verification fixtures remain and clean only their own records. Supabase's ordinary Auth session persistence remains; it is not local issue storage.
- Credential-free PR browser checks now exercise the connected public landing/login page with placeholder public connection settings. Full authenticated behavior remains covered by embedded database tests and isolated cloud tests. No runtime dependency, schema or account-function change was needed.

Verification so far: type checking, ESLint, Deno account-function checking and production build passed. All 22 focused/database tests passed; all two public landing/login browser cases passed (2.8 seconds); all ten local-frontend/real-cloud cases passed (53.2 seconds), with fixture cleanup. The cloud cases include the new sidebar role/desktop/mobile/keyboard checks plus the shared journey, privacy, races, revocation, archives, temporary credentials/reset, identity preservation and trusted admin recovery. The initial sandboxed browser run could not start its web server; the approved rerun passed. Documentation paths and whitespace passed.

Agent screenshot review checked desktop login, account/sidebar and administration plus support at 320px. Real-device, screen-reader, other-engine and 200% zoom checks remain manual. The build retains the existing two Zod annotation warnings and about 572 kB main JavaScript (163 kB gzip); no capacity certification is implied.

Cloudflare deployment succeeded with `npm run deploy`: Worker version `740199b0-1e8c-4e89-9d3b-4b4a9d8b8b99`, JavaScript `index-DlDOlXFP.js`, CSS `index-CaL9-49B.css`, at https://minsky-dev.icaic-minsky.workers.dev. All ten hosted cases passed (54.2 seconds), including sidebar navigation and the full real-account journey; cloud fixture cleanup completed. Hosted administration screenshots were also reviewed. Removed generated `dist/`, `test-results/`, TypeScript build info, Vite caches and the empty legacy fixture directory after verification. No cloud test temporary paths remained. Push/remote checks are recorded in the PR; the user reviews and merges. The older local-demo reports below describe prior commits; removed files/commands must not be treated as current setup. Existing double quotes, React component capitalization and inferred component returns remain deliberate Google TypeScript style exceptions. Unchanged issue-detail and account-administration logic was retained after formatting.

Files changed: `src/connected/ConnectedApp.tsx`, `src/connected/model.ts`, `src/connected/model.test.ts`, `src/main.tsx`, `src/styles.css`, `tests/cloud/journey.spec.ts`, `tests/landing.spec.ts`, `playwright.config.ts`, `package.json`, `README.md`, `AGENTS.md`, `PLAN.md`, `docs/cloud-onboarding.md`, `docs/code-quality.md`, `docs/manual-verification.md`, `docs/product-direction.md`, `docs/tickets.md`, and this document. Deleted: `src/App.tsx`, `src/domain.ts`, `src/domain.test.ts`, `src/storage.ts`, `src/storage.test.ts`, `src/legacy-state.ts`, `tests/journey.spec.ts`, `tests/fixtures/v1.json`, `docs/demo-spec.md`.

## Interface refinement (2026-10-02)

The user requested installing Anthropic's `frontend-design` skill temporarily, applying it to the existing application, pushing the changes and deploying to Cloudflare, then deleting the skill. This is a refinement of the active T0003 branch.

Implemented:

- Indigo/teal visual system, locally served variable Public Sans with its SIL Open Font License, and a handoff illustration on desktop sign-in. Phone sign-in keeps the introduction compact so credentials remain easy to reach. No external font request or new npm dependency is required.
- Responsive account controls, reporting forms and administration sections. The connected queue now sits beside the selected issue on desktop and stacks on phones; its previous `columns` class had no corresponding style. Submission markup now matches the intended form layout. Status names, ownership, timing, privacy and award/application semantics are preserved.
- Keyboard-visible focus, 44px minimum form/control heights, and recovery help with expanded/collapsed state. Empty queues explain where reports will appear or suggest changing the filter. The historical demo shares the visual styles and retains its local controls.
- Browser coverage for sign-in at 800/390/320px, keyboard recovery help, and desktop queue/detail placement. Existing real-account journey checks still cover phone widths, refresh, private notes, handoffs, repeated resolutions, awards and organizer account operations.

Verification before deployment: `npm run typecheck`, `npm run lint`, `npm run build` and `npm run check:functions` passed; `npm test` passed all 72 focused tests. All 21 demo browser tests passed on the final sequential run (9.0 seconds). All nine local-frontend/real-cloud cases passed (52.4 seconds), with fixture cleanup completed. `git diff --check` and local documentation-path checks passed.

The initial restricted-network skill command was interrupted and the approved download succeeded using `npx --yes skills add https://github.com/anthropics/skills --skill frontend-design --agent codex --yes`. One verification attempt ran demo and cloud browser suites together; both use `test-results`, so cloud startup removed demo trace artifacts and eight demo cases failed during artifact cleanup. Running the final suites sequentially resolved that tool-level conflict. No failed run is counted as a passing check.

Agent screenshot review checked desktop sign-in/contestant/admin views, support views at 390px/320px and hosted admin at 390px. It led to a more compact phone introduction and a corrected word break. Real-device, screen-reader, other-engine and 200% zoom checks remain manual steps in the guide. This work is not capacity or production-security certification.

Cloudflare deployment succeeded with `npm run deploy`: Worker version `b0874359-0138-410e-b113-8e51061bb29e`, JavaScript `index-JCwcwqsc.js`, CSS `index-CzChhVyC.css`, at https://minsky-dev.icaic-minsky.workers.dev. All nine hosted cases passed (47.2 seconds), including the full workflow and new interface checks; test fixtures were cleaned up. HTTP checks confirmed the deployed JavaScript, CSS, font and license match the local build byte for byte. The temporary skill was removed with `npx --yes skills remove frontend-design --agent codex --yes`; its remaining downloaded source, lockfile and empty installation directories were deleted explicitly. The installation artifacts are absent from the final repository change.

The build retains the existing two Zod annotation warnings and a 572 kB main-bundle warning (about 163 kB gzip). Style preserves repository double quotes, React component capitalization and inferred component returns; unchanged domain/administration logic was retained after formatting. These are the existing deliberate Google TypeScript Style Guide exceptions.

Files changed: `src/connected/ConnectedApp.tsx`, `src/styles.css`, `tests/cloud/journey.spec.ts`, `public/fonts/public-sans-variable.woff2`, `public/fonts/OFL-Public-Sans.txt`, `README.md`, `docs/tickets.md`, `docs/manual-verification.md`, and this document. No schema or account-function change was needed. Candidate T0004 and pending provider/protected-CI acceptance items remain unchanged.

## Username/password revision (2026-10-02)

The user selected organizer-created usernames/passwords and organizer-assisted recovery. SMTP and personal email addresses are no longer T0003 prerequisites. The user also confirmed signing into the original hosted admin account.

Implemented:

- Username login backed by Supabase internal email-format identities. Existing email logins work until username assignment; assigning a username keeps the existing Auth UUID, password, memberships and history.
- Admin account creation with server-generated temporary passwords, shown for that create/reset action only. Existing passwords cannot be retrieved. Forgot-password guidance sends users to organizers rather than email recovery.
- Required first-login/reset password changes enforced by database policies and the workflow RPC, not only UI. Completion checks the actual Auth password hash; client metadata cannot bypass it.
- Resets invalidate prior Auth sessions and refresh tokens. Database session cutoffs continue denying old JWTs even after the replacement password changes. Current password is requested for ordinary and required password changes.
- Account-wide resets/username assignment require admin access to every affected session and reject archived memberships. Ordinary roles/intake remain session scoped. Own password changes use the signed-in flow; trusted provider recovery covers a lost sole-admin password.
- Redesigned administration with padding, four status cards, a separate intake control, account creation/management columns, readable expandable rows, conditional staff permissions and collapsed advanced/audit sections. It stacks on phones; sign-in/password forms also have proper spacing.
- Migrations `202610020004_usernames.sql` and `202610020005_admin_recovery.sql`; `cloud:recover-admin` is a private maintainer command. Service-only provisioning/recovery functions are unavailable to ordinary app accounts.

Final verification:

| Check | Observed result |
| --- | --- |
| Type checking, ESLint, Deno function check, production build | Passed; lint has no warnings |
| `npm test` | 72 tests passed, including temporary-password RLS/RPC gates, stale-session denial, cross-session account administration and service-only admin recovery |
| `npm run test:e2e` | All 21 historical demo browser tests passed |
| `npm run test:cloud` | Seven final local-frontend/real-cloud cases passed (46.6 seconds), including the redesigned account controls and private maintainer recovery command |
| `npm run test:hosted` | All eight hosted cases passed (49.0 seconds), additionally verifying existing-email account conversion without changing UUID/password/membership |
| Migrations/function/deployment | Both new migrations applied without seeds; account function deployed with cloud bundling; frontend deployed successfully |
| Documentation links and `git diff --check` | Passed |

Current verified Worker version: `d0a04423-74fd-4a29-997e-f74c5b22f7db`; assets `index-BL2ghMjy.js` and `index-wMQJQd8C.css`. The build retains the two Zod annotation warnings and a 569 kB main-bundle warning (about 163 kB gzip).

Hosted tests exercised organizer creation, case-insensitive username login, forced password change after refresh, denied pre-change reads/completion, reset/session/refresh-token invalidation, denied old-token Auth updates, replacement-password change, existing-account conversion, trusted provider recovery and the original complete shared journey/privacy/races/revocation/archive cases. Disposable fixtures were cleaned up. No real admin password was requested, inspected, changed or reset.

Screenshot inspection checked the redesigned desktop admin workspace and phone layout. Browser layout checks passed at 390px and 320px; prior keyboard skip/form/refresh coverage remains. Real-device, assistive-technology and other-browser checks remain manual. The user should refresh the hosted app, optionally assign their own username, then create a development team/staff account and securely distribute its temporary credentials.

Initial verification issues were resolved: ESLint’s account-effect dependency warning, an explicit Node console import for the maintainer script, and a documentation-edit script’s formatting anchor. The Supabase CLI initially failed because the sandbox prevented telemetry writes; approved execution applied the migrations. No checks are counted as passing from those failed attempts. The first PR secret scan flagged the public development-user UUID in newly compact onboarding wording. The wording was clarified, and `.gitleaksignore` records only that exact historical fingerprint; no broad UUID, path or rule exclusion was added. Full history scanning remains enabled, now with verbose redacted diagnostics. Provider plan/ownership and the protected separate cloud CI environment remain pending; no paid service was enabled.

Style keeps repository double quotes, React component capitalization, concise JSX callbacks and inferred component/Zod types. Shared logic uses named exports. Unchanged workflow code and historical tests were restored after formatting to avoid unrelated rewrites.

Files changed in this revision:

- Application: `src/connected/ConnectedApp.tsx`, `src/connected/client.ts`, `src/connected/model.ts`, `src/styles.css`.
- Backend/recovery: `supabase/functions/admin/index.ts`, `supabase/functions/.env.example`, `supabase/migrations/202610020004_usernames.sql`, `supabase/migrations/202610020005_admin_recovery.sql`, `scripts/recover-admin.mjs`, `package.json`.
- Tests/CI: `.gitleaksignore`, `.github/workflows/security.yml`, `src/connected/client.test.ts`, `src/connected/database.test.ts`, `tests/cloud/fixture.ts`, `tests/cloud/setup.ts`, `tests/cloud/journey.spec.ts`, `.github/workflows/checks.yml`.
- Guidance: `AGENTS.md`, `PLAN.md`, `README.md`, `docs/cloud-onboarding.md`, `docs/current-state.md`, `docs/manual-verification.md`, `docs/product-direction.md`, `docs/tickets.md`.

Original email-flow results below are historical; they do not describe current onboarding requirements.

## Original connected implementation (historical T0003 baseline, 2026-10-02)

- Cloudflare Workers Static Assets at https://minsky-dev.icaic-minsky.workers.dev; all backend operations use Supabase project `ovymmobupzowotvrywek`, region `ap-southeast-1`, PostgreSQL 17. Final deployed Worker version: `dcbba8b9-39af-4528-8fda-70ce61534ddf` (after private signals and archived-read refinement).
- Supabase email/password sign-in, logout, session restoration and password change. Invitation/password-setup and recovery UI/function paths are implemented; hosted delivery remains unverified without custom SMTP. Public signup/anonymous access settings are user-reported disabled. The user confirmed the deployed Site URL and exact local/deployed redirects.
- Three repository-owned migrations for group events/sessions, teams, people/memberships, issues, resolutions/reopening, separate history/awards, admin audit, request receipts and private/public live signals. All were applied without seeds. Server timestamps, issue locks/revisions and one-award constraints preserve the existing semantics. Persisted request IDs make retries safe, including submission/message retries.
- Contestant own-team dashboard, support triage/handoff/reopening, jury awards and combined-role capabilities. Support reports retain the actual reporter and affected roster team. Admin is separate from support/jury.
- Current-membership RLS protects direct reads, history, counts and snapshots. Internal notes use staff-only signals and do not increment public issue/team counters. Realtime refetches authorized snapshots, with serialized reads to prevent old responses restoring a stale revision. Current membership is also checked on focus/reconnect and every ten seconds. Database access is denied immediately after revocation, even for existing login sessions.
- Admin UI for invitations, existing-account assignments, fixed role unions, revocation, resend/recovery and intake. Transactional administration prevents removing the last admin and records actor/time. Privileged account operations use a caller-verified Edge Function and check current admin membership before using service credentials.
- Explicit trusted bootstrap created the initial development group event/session, three roster teams, and admin membership for the existing user-selected Auth account. Its password was not requested or changed. Intake starts closed. No first-login auto-promotion, hosted reset, persona impersonation or demo-data import exists.
- Archived records permit queue navigation/read access while disabling writes. The server also rejects archived writes.
- Cloud contributor setup assumes full authorized cloud access per the user's latest instruction. Docker is optional. Functions deploy with `--use-api`; embedded PostgreSQL checks run without cloud credentials or Docker. Cloud tests provision isolated temporary accounts/sessions and clean up their own rows. The historical local demo stays available through `dev:demo` and is excluded from production assets.
- PR CI is implemented for secret-free checks. Protected, manually dispatched cloud integration CI requires a separate test project and owner-configured environment secrets; it has not run yet. No preview/deployment automation writes to the shared project.

## Original T0003 verification (historical baseline)

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings on final implementation |
| `npm run check:functions` | Deno check passed |
| `npm test` | 66 focused tests passed, including actual migrations/RLS on embedded PostgreSQL with an Auth-context stub |
| `npm run test:e2e` | All 21 historical demo Chromium tests passed |
| `npm run test:cloud` | Five real-cloud cases passed with staff-only signals and unchanged public counters; the final hosted suite also exercises repeated cycles |
| `npm run test:hosted` | All five final cases passed on Worker version `dcbba8b9-39af-4528-8fda-70ce61534ddf`, including repeated reopening and private counters |
| `npm run cloud:plan`, `cloud:migrate`, `cloud:bootstrap` | Dry run, all migrations and explicit first-admin bootstrap succeeded |
| `npm run cloud:functions` | Final formatted source redeployed successfully with server-side bundling |
| `npm run deploy` | Workers Static Assets deployment succeeded |
| `git diff --check`, local documentation path scan | Passed |

The hosted browser suite covers multiple real Auth accounts, live updates, private replies, retained handoffs, zero award/external confirmation, reopening, refresh persistence, concurrent claims/awards, cross-team/session/anonymous denials, current revocation, last-admin guard, admin UI role assignment, password change/logout and phone/keyboard checks. The added archive case checks that read navigation remains enabled while writes are disabled. The final privacy case additionally checks staff-only live signals and unchanged contestant-visible counters.

Screenshot inspection checked the connected support screen at 320px and the desktop admin membership form. Browser actions exercised support at 390px, layout/no-overflow at 320px, keyboard skip navigation and refresh. These are agent-driven Chromium checks, not real-device, screen-reader, other-engine or 200% zoom verification. Those remain manual steps in the guide.

Initial failures were resolved: two embedded test-fixture assertions, a demo keyboard wait after dynamic module loading, an award-dropdown locator that included option text, an older Realtime snapshot restoring a stale revision, and a duplicate test sign-in after adding a second live staff observer. Action errors now remain visible across background refreshes. The initial CLI function deployment tried local container bundling and was interrupted; the committed command uses server-side bundling. A formatter invocation inside the sandbox stalled and was interrupted; approved cache/network access completed it. No database/test Docker stack was started.

The build passes with two existing Zod annotation warnings and a 563 kB main-bundle warning (about 161 kB gzip). This is not capacity/performance certification. New npm installs reported zero audit vulnerabilities at installation time.

Style: preserve repository double quotes, React component capitalization, concise JSX callbacks, inferred component returns and Zod-inferred data types for framework readability and repository consistency. New shared logic uses named exports. These are deliberate exceptions to individual Google TypeScript style rules; no unrelated style rewrites were made.


Final hosted result: `npm run test:hosted` passed all five cases (30.2 seconds), including three resolutions/two reopenings across real clients, preserved external application, staff-only note signals, unchanged public revisions, direct private-note exclusion, concurrent claim/award winners, admin role assignment, password changes/logout, current revocation and archived navigation. Test fixture cleanup completed successfully. The user confirmed saving Site URL and exact redirect URLs; real mail delivery is still not verified.

Clean-checkout verification: `/tmp/minsky-t0003-clean` at `bfe94e1` used a fresh `node_modules` install and only public Supabase frontend settings. `npm ci`, type checking, lint, all 66 focused tests, Deno checking and the production build passed, producing the same `index-BwjV5kgP.js` asset as the deployed build. The install reported zero audit vulnerabilities. After installation, `cloud:link` succeeded and `cloud:plan` reported the remote database up to date with no pending migrations or seeds. An initial premature link attempt failed with `supabase: not found`; the sequential rerun passed.

## Pending acceptance and known limits

- Email invitations/recovery and SMTP were removed from T0003 by explicit user decision. Organizer credential delivery and identity checks before recovery are operational responsibilities.
- Protected cloud CI remains incomplete in T0003. Initial inspection on 2026-10-02 found no GitHub environments and only the shared development Supabase project; the separate CI project has since been prepared as recorded below. The available GitHub account has write access without admin access; the user confirmed they are a contributor and the owner is unavailable. The `Checks` workflow file is absent from `main`, so manual dispatch also requires it to reach the default branch through review and merge. Neither environment protection nor a privileged CI pass is claimed.
- Selected billing plans, ownership/billing contact/receipt records, GitHub merge enforcement/vulnerability alerts and remaining user/manual acceptance checks are deferred to T0004. No paid upgrade was selected or payment information handled by the agent.
- Membership revocation preserves historical ownership. If an active owner loses support membership, restore it to continue owner-only work or have another specialist accept an already pending handoff. General reassignment tools are not in T0003.
- Group contests and one award per issue only. Uploads, broader organizer editors, shared incidents, imports, alerts/push, offline/resilience and 800-user capacity testing remain deferred. Candidate T0004 is not started.

## Separate CI project and development workflow (2026-10-02)

The user created `Minsky CI` (`ghtztmovdkhuketcbjmq`). Supabase CLI verified it is active and healthy in Tokyo (`ap-northeast-1`), in organization `gayymsuhfqsboksikzwx`, with PostgreSQL 17. A separate temporary checkout was linked to this target; the main checkout retained its development link. All five migrations were applied without seeds, the admin function was deployed with `--use-api`, and the test origin was configured. No shared development accounts or data were copied or changed.

The first cloud setup failed because the repository's previous `auth.email.enable_signup = false` setting disabled hosted email/password login when pushed. The configuration now enables that provider while retaining the global public-signup block and explicitly disabling anonymous sign-in. A new real Auth check verifies public signup is denied and organizer-created accounts can log in. The cloud job now applies repository-owned configuration before migrations. A failed fixture setup also exposed a second teardown attempt against already deleted accounts; successful setup-failure cleanup now clears its fixture file before rethrowing the original error. Repeating the initial failure verified the secondary cleanup error was removed.

The isolated CI project's full local cloud suite passed all 11 cases, including managed Auth, workflow, permissions, competing claims/awards, password reset, sole-admin recovery, phone/keyboard/refresh and archival behavior. The final signup check was rerun and passed after its lint correction. Fixture teardown completed; a separate provider check found zero events, sessions, teams, people, issues, audit rows and Auth users in the CI project. Configuration comparison found no pending declared changes. Type checking, lint, the production build, Deno function checking, all 22 focused/database tests and both public landing/login browser tests passed. Workflow YAML validation and documentation links/whitespace passed; actionlint was unavailable on PATH and its invocation could not run. The temporary CI checkout and generated local build/test artifacts were removed afterward. These local results are not a protected GitHub Actions run.

The development → isolated CI → future production process is now explicit in AGENTS.md, README.md and cloud-onboarding.md. Production has not been provisioned; the current hosted app remains development. The user reviews and merges; deployment is an explicit subsequent action. Owner-controlled GitHub environment setup and default-branch workflow availability remain pending in T0003. Provider records, remote merge enforcement/vulnerability alerts and remaining user/manual acceptance checks remain deferred to T0004.

## Selected code-quality controls (2026-10-02)

T0003 now includes the user-selected CI/review/security improvements:

- Existing quality CI uses pinned action commits, credential-free checkout and job timeouts. New pushes cancel obsolete ordinary checks; manual cloud runs are kept separate so automatic cancellation does not interrupt fixture cleanup.
- A short PR template covers scope/readability, authorization/privacy, workflow invariants, compatible migrations, verification and documentation.
- Secret-free security CI runs redacted Gitleaks history scanning and a lockfile audit that fails on high/critical runtime or development advisories. Both run on PRs, `main`, manual dispatch and a weekly default-branch schedule.
- Weekly Dependabot npm/action update PRs are configured. Update scheduling begins after this configuration reaches `main`.
- The prepared branch-protection payload requires up-to-date `checks`, `secrets` and `dependencies` from GitHub Actions, one independent approval, resolved threads and no administrator bypass, force pushes or branch deletion. **Remote merge protection and vulnerability alerts still require owner setup**: the available account has write permission, not administration access. Private-repository plan availability has not been verified. See [code-quality.md](code-quality.md).

Local verification for this change: actionlint and YAML/JSON validation passed;
documentation paths and whitespace passed; type checking, ESLint, Deno checking,
all 66 focused tests, build and all 21 historical demo browser tests passed.
The dependency audit found zero vulnerabilities. Gitleaks found no leaks in all
16 existing commits or tracked/pending non-ignored files. A temporary synthetic
token fixture was detected even after removal in a later commit, and output
redaction was verified. No scanner exceptions were needed. PR #2 records remote
CI results for the quality-control changes.

Initial restricted GitHub/npm access and browser-server startup failed; approved
network/browser execution succeeded. Existing Zod annotation and bundle-size
warnings remain. No application behavior, cloud data or deployment changed;
hosted tests were not repeated for these workflow/documentation changes.

## Historical local-demo implementation and verification

## Implemented

- React/TypeScript/Vite app with a clearly labeled simulation and five seeded personas, including Robin Ellis with volunteer + technical specialist roles.
- Three seeded teams/issues in one fictional group-contest session. Contestant submissions use Aurora's roster location and seed-configured categories.
- Staff status queues and ownership handoff. Public replies, staff-only notes, resolution summaries, accumulated unresolved-time timers and original first-assignment delay.
- One discretionary award per issue, recorded while resolved in a separate ledger, with separate external-application confirmation and actor/timestamps.
- Person-based ownership and capability unions. Any support helper can claim; another specialist must accept a handoff. Jury membership does not suppress support capabilities.
- Contestant/helper reopening with a public reason, retained owner, structured resolution/reopening history and unchanged awards/application. Resolved intervals do not count toward unresolved time.
- Validated v1-to-v2 browser-local migration, preserved v1 source, v2 precedence, explicit error recovery and confirmed v2 reset.
- Responsive layouts, native labeled controls, keyboard focus styles and a skip link.
- Domain/storage tests and a browser journey plus phone/keyboard and recovery cases.

## Review refinements — 2026-10-02

Implemented zero-minute award decisions and award choices of 0, 5, 10, 15, 30, 60 and Custom. The required public explanation, one-award rule and separate application confirmation also apply to zero. The v2 schema now accepts non-negative whole minutes without changing the stored representation; existing v2 data remains compatible and the v1 migration validator stays frozen.

Resolution now offers Resolved without comment, Service restored, Device issue resolved, Problem statement clarified and Custom. Custom preserves free-text validation. The no-comment choice stores its explicit text. Reopening requires a fresh resolution choice.

After these refinements, type checking, lint, all **51 focused tests**, the production build, all **21 Chromium browser tests**, whitespace checks and local documentation links passed. The existing two Zod annotation warnings remain non-blocking. The first browser run used an exact label-text locator that included the dropdown options; switching that test locator to the accessible combobox name fixed the failure. All final browser cases passed, including every preset, custom zero/non-preset values, invalid custom values, preset/custom switching, fresh choices after reopening and refresh persistence.

An agent-driven walkthrough and screenshot review checked custom resolution fields at 390 × 844 and 320 × 740, the desktop award controls, keyboard resolution submission, and persistence of both a zero-minute award and the no-comment resolution. No horizontal overflow or browser page errors occurred. Temporary scripts, screenshots and generated build/test artifacts were removed; maintained regression tests remain. The earlier style exceptions and unverified real-device/accessibility checks below still apply.

## Initial T0002 verification — 2026-10-02

Observed on Node.js 22.22.1, npm 11.12.0 and Playwright Chromium:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 49 focused tests passed, including role unions, direct triage, self-handoff rejection, reopening cycles/timing, awards and validated v1/v2 persistence |
| `npm run build` | Passed; the same two non-blocking Zod dependency annotation warnings remain |
| `npm run test:e2e` | 10 tests passed: original journey/recovery, direct specialist and combined-role claims, keyboard handoffs/reopening at both phone widths, repeated reopening with awards/privacy/refresh, support + jury fixture, and legacy migration/reset |
| `git diff --check` and documentation link checks | Passed |

An additional agent-driven Chromium walkthrough and screenshot review checked desktop contestant/jury views, combined-role labels and reopening forms at 390 × 844 and 320 × 740, keyboard skip/claim/handoff/reopen actions, public/internal separation, reopening after refresh, pending award application while reopened, and both reset cancellation and acceptance. Neither phone width overflowed. No page errors occurred. Native select text truncates at narrow widths; the full person name and both roles wrap in the page heading.

Initial browser tests and server startup failed under sandbox restrictions; approved execution passed. The first unrestricted browser run exposed a missing JSON import attribute in the new fixture import. After correction all 10 tests passed. The separate walkthrough also required approved execution because the sandbox blocked Chromium. The initial GitHub PR lookup hit restricted networking; the approved lookup succeeded.

Style choices: keep existing double-quoted formatting, React component capitalization/default App export, concise JSX handlers and inferred Zod schema types for repository consistency and framework readability. New shared functions use named exports. These are deliberate exceptions to the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), without unrelated style rewrites.

Real-device touch, screen readers, other browser engines and 200% browser zoom remain unverified. Follow the [manual guide](manual-verification.md) for those checks. Local testing provides no evidence of production authorization, offline operation or 800-user capacity.

## Historical T0001 verification

The earlier T0001 implementation and ESLint 10 tooling update passed type checking, lint, 20 focused tests, the build and 3 browser tests. Its browser walkthrough covered desktop contestant/jury views, volunteer screens at both phone widths, keyboard entry points, refresh, privacy and reset. That run also reported zero dependency audit vulnerabilities. These are historical observations; the T0002 results above describe this run. No dependency changes or new dependency audit were performed for T0002.

## Limitations and next work

The demo uses one tab and one local dataset. It does not synchronize concurrent tabs and devices. Browser storage may be cleared or unavailable. Device-clock changes affect running timers. The demo rejects backwards action timestamps. Simulated roles are not authorization, and local history is editable browser data.

Persona/filter selections reset on refresh. These checks establish no production security, offline operation, or 800-user capacity.

T0002 retains one award per issue, even after reopening; award adjustments and role editors remain deferred. [T0003](tickets.md#t0003--cloud-onboarding-and-authenticated-shared-product) now scopes cloud onboarding, authenticated shared workflows, role dashboards, minimal admin controls and contributor setup. Its planning changes were prepared on updated `main`; no application code or provider resources were changed. The [onboarding guide](cloud-onboarding.md) distinguishes setup tasks from completed work.

The user explicitly chose cloud features first and deferred outage/resilience work. Free tiers are preferred; necessary paid services are acceptable after identifying the cost and reason. Helpers' issue-linked images and configurable volunteer upload permissions are recorded for the next candidate alongside broader admin tools. Attachment visibility and setting scope/defaults remain undecided. No T0004 is created. UI redesign, notifications, CSV imports and shared incidents remain deferred.
