# Working on Minsky

## Read first

- Read [PLAN.md](PLAN.md) and [README.md](README.md) before starting work.
- Follow the user's latest explicit instructions. Where the existing README differs from PLAN.md, PLAN.md records the newer agreed scope.
- Inspect the working tree and existing implementation before making changes. Preserve unrelated user changes.
- Read the active ticket and relevant documents under `docs/` once they exist. Do not assume planned files or features have already been created.
- Treat historical run reports as records of that run, not as current repository state. Verify current state from the repository.

## Immediate scope: a local demo

The immediate objective is an interactive demo that helps the user decide where the application should go. Implement the agreed demo before production infrastructure. Keep subsequent tickets small and driven by the user's feedback.

- Use React, TypeScript, Vite, and npm with a committed lockfile.
- Use fictional seeded data, simulated personas, and versioned browser-local persistence. No cloud account or paid service is required for the demo.
- Implement the complete journey: contestant submission, volunteer claim, escalation, specialist acceptance and resolution, discretionary award, and confirmation of external application.
- Support team contestant, volunteer, specialist, and jury personas in one fictional group-contest session.
- Make the volunteer experience usable on phones, and the contestant and jury experiences usable on laptops/desktops. Support keyboard navigation and clearly labeled controls.
- Clearly identify the application as a demo. Persona switching and hidden UI controls are not authentication or authorization boundaries.
- Keep real authentication, uploads, push notifications, cloud synchronization, CSV imports, shared-incident actions, and administration interfaces outside the initial demo ticket.
- Preserve broader requirements in documentation; do not silently implement them as extra demo scope.

Use simple components and domain logic appropriate to the demo. Avoid speculative infrastructure or abstractions for features that have not been selected for implementation.

## TypeScript style

- Read and follow the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) when writing or changing TypeScript, including TSX.
- Agents may depart from individual rules when they have a good reason appropriate to this project, such as framework requirements, correctness, readability, or maintainability. Otherwise, follow the guide.
- Briefly explain deliberate exceptions in the PR description or run report; use a code comment when the reason helps future maintainers understand the code. Exceptions do not require separate user approval.
- Explicit user instructions and project requirements take precedence over the guide. Apply it to future work without unrelated style-only rewrites.

## Behavior to preserve

- Start the issue timer on submission and record first assignment separately. Calculate elapsed time from persisted timestamps so refreshes do not reset it.
- Retain the current owner during escalation until a specialist accepts the handoff.
- Stop the timer on resolution and retain a resolution summary.
- Separate contestant-visible replies from internal staff notes. Omit internal notes from contestant views.
- Record an award separately from confirmation that it was applied externally. The demo does not change an external contest clock.
- Keep a local activity history identifying the simulated actor, and prevent repeated actions from producing duplicate awards or invalid transitions.
- Provide a reset control that restores fictional data.

## Ticket and Git workflow

- Distinguish development tickets from contestant issues in code, documentation, and communication.
- The first implementation ticket is **T0001 — Local workflow demo and project guidance**, using `feature/t0001-local-demo`.
- Start each development ticket from updated `main`. Use `feature/tNNNN-description` for subsequent ticket branches.
- Work sequentially: implement the active ticket, verify it, update relevant documentation, and prepare a pull request for the user's review.
- The user reviews and merges. Do not merge or start the next ticket before the current ticket has merged unless the user explicitly changes this workflow.
- Testing and merging are workflow steps, not long-lived `test` or `merge` branches.
- Keep future work as a short candidate queue until feedback determines the next ticket. Do not create a large speculative backlog.
- Routine implementation and verification within the active ticket do not require repeated confirmation. Ask only for missing decisions that materially affect scope or behavior.

## Verification

- Inspect available scripts before invoking them. During T0001, provide npm scripts for development, production build, type checking, linting, and focused tests; document their exact names in the README.
- Test meaningful behavior: lifecycle transitions, ownership during handoff, timestamp calculations, persistence, and award/application state.
- Include one browser test covering the complete journey across personas.
- Manually check phone-width volunteer screens, keyboard navigation, refresh persistence, reset, and separation of public replies from internal notes.
- Build, lint, type checking, and required tests must pass before presenting an implementation PR as ready. If a check cannot run, report the reason and leave its result unverified.
- For documentation-only changes, check content, paths, and whitespace; do not add application tests merely to test prose.
- Never describe local demo testing as evidence of production security, offline operation, or capacity for 800 simultaneous users.

## Documentation upkeep

Create the remaining documentation during T0001, and keep it concise and consistent with implemented behavior:

| Document | Responsibility |
|---|---|
| `README.md` | Project introduction, exact setup/run/check commands, demo limitations, and documentation links. |
| `docs/demo-spec.md` | Demo screens, behaviors, boundaries, and acceptance criteria. |
| `docs/product-direction.md` | Agreed longer-term requirements, provisional architecture, and unresolved decisions. |
| `docs/tickets.md` | Active development ticket, status, acceptance criteria, and a small follow-up queue. |
| `docs/current-state.md` | Implemented and verified capabilities, limitations, and next work. |
| `docs/manual-verification.md` | Repeatable verification steps, expected outcomes, and required fictional personas/data. |

Update the relevant documents in the same change as behavior or workflow changes. Distinguish proposed, implemented, and verified capabilities. Use PLAN.md as the initial baseline; keep later decisions explicit in the appropriate document rather than leaving conflicting instructions.

## Deferred decisions and production direction

- **Outage handling is unresolved.** Remind the user and revisit it before scoping the connected-backend ticket. Do not assume manual fallback, offline capture, or venue-local operation has been selected.
- Cloudflare and Supabase are the intended production direction, subject to the outage decision. The user wants free-tier experiments before considering paid subscriptions.
- A free-tier pilot and production capacity validation are separate milestones. Future targets are 800 simultaneous users, 95% of ordinary actions within two seconds, and live updates within three seconds on a healthy venue connection.
- Consult the product direction in PLAN.md when recording future requirements, including configurable roles/categories, shared incidents, award ledgers, and browser push. These are not automatic additions to T0001.

## Required end-of-run report

At the end of every Codex run, report all eight fields below. Keep them concise, use **None**, **Not run**, or **Not applicable** when appropriate, and distinguish completed checks from suggested manual steps.

1. **Summary of changes** — What changed and why.
2. **Files changed** — Paths to created, modified, or deleted files.
3. **Commands run** — Commands actually executed, including relevant failures.
4. **Build/test results** — Observed outcomes and checks that could not run.
5. **Manual verification steps** — What was manually checked and what the user should still verify.
6. **Risks** — Known limitations, unresolved decisions, or regressions; do not invent risks.
7. **Follow-up tickets** — Existing ticket references or concise candidate work; do not imply that an uncreated ticket exists.
8. **Docs that need updating** — Outstanding documentation work, or None if the relevant docs are current.
