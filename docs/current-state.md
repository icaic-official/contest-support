# Current state

T0001/T0002 merged in PR #1. T0003 is implemented on `feature/t0003-cloud-product` and deployed as a development app; [PR #2](https://github.com/notbowen/minsky/pull/2) remains a draft while hosted email delivery and provider/CI setup acceptance items are pending. The user reviews and merges. The initial PLAN.md run report and the demo results below are historical.

## Connected implementation (T0003, 2026-10-02)

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

## Observed T0003 verification

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

- Custom SMTP/sender access and hosted invitation, password setup, resend and recovery delivery to a non-provider-team recipient are incomplete. No local mail capture was run or counted as hosted proof.
- Selected billing plans, billing contact/receipt record and protected cloud CI environment setup remain owner tasks. No paid upgrade was selected or payment information handled by the agent.
- Membership revocation preserves historical ownership. If an active owner loses support membership, restore it to continue owner-only work or have another specialist accept an already pending handoff. General reassignment tools are not in T0003.
- Group contests and one award per issue only. Uploads, broader organizer editors, shared incidents, imports, alerts/push, offline/resilience and 800-user capacity testing remain deferred. Candidate T0004 is not started.

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
