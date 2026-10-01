# Current state

T0001 contains the demo implemented and verified in the earlier run on `feature/t0001-local-demo`. On 2026-10-02, the user accepted the proof of concept and requested T0002 on this same branch before merge. T0002 is implemented and verified; the shared [PR #1](https://github.com/notbowen/minsky/pull/1) covers both tickets. The user still merges. No production backend exists. The historical run report in PLAN.md is not a statement of current repository contents.

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

## T0002 verification — 2026-10-02

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

T0002 retains one award per issue, even after reopening; award adjustments and role editors remain deferred. The next candidates are visual refinement and an outage decision before a free-tier backend experiment. No later ticket has been started. UI redesign is deferred.

The demo defers real accounts, uploads, notifications, connected services, CSV import, shared incidents, and administration. Outage behavior remains unresolved. Revisit this decision before you scope a backend ticket.
