# Working on Minsky

## Read first

- Read [PLAN.md](PLAN.md) and [README.md](README.md) before starting work.
- Follow the user's latest explicit instructions. Where the existing README differs from PLAN.md, PLAN.md records the newer agreed scope.
- Inspect the working tree and existing implementation before making changes. Preserve unrelated user changes.
- Read the active ticket and relevant documents under `docs/` once they exist. Do not assume planned files or features already exist.
- Treat historical run reports as records of that run, not as current repository state. Verify current state from the repository.

## Current scope and completed demo baseline

T0001 and T0002 were merged in PR #1 on 2026-10-02. T0003 is scoped in `docs/tickets.md` for cloud onboarding and an authenticated shared product. Its implementation must start from updated `main` on `feature/t0003-cloud-product`. The demo requirements below describe the completed baseline; they do not exclude the connected features explicitly selected for T0003. Keep planning separate from implemented capabilities.

The initial objective was an interactive demo that helped the user decide where the application should go. T0001 and T0002 completed that baseline. Keep subsequent tickets small and driven by the user's feedback.

- Use React, TypeScript, Vite, and npm with a committed lockfile.
- Use fictional seeded data, simulated personas, and versioned browser-local persistence. The demo requires no cloud account or paid service.
- Implement the complete journey: contestant submission, volunteer claim, escalation, specialist acceptance and resolution, discretionary award, and confirmation of external application.
- Support team contestant, volunteer, specialist, and jury personas in one fictional group-contest session.
- Make the volunteer experience usable on phones. Make the contestant and jury experiences usable on laptops/desktops. Support keyboard navigation. Label controls clearly.
- Clearly identify the application as a demo. Persona switching and hidden UI controls are not authentication or authorization boundaries.
- Keep real authentication, uploads, push notifications, cloud synchronization, CSV imports, shared-incident actions, and administration interfaces outside the initial demo ticket.
- Preserve broader requirements in documentation. Do not silently implement them as extra demo scope.

Use simple components and domain logic appropriate to the demo. Avoid speculative infrastructure or abstractions for features outside the selected scope.

## TypeScript style

- Read the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) before you write or change TypeScript, including TSX. Follow the guide.
- Agents may depart from individual rules for reasons appropriate to this project. Examples include framework requirements, correctness, readability, or maintainability. Otherwise, follow the guide.
- Briefly explain deliberate exceptions in the PR description or run report. Use a code comment when the reason helps future maintainers understand the code. Exceptions do not require separate user approval.
- Explicit user instructions and project requirements take precedence over the guide. Apply it to future work without unrelated style-only rewrites.

## Behavior to preserve

- Start the issue timer on submission. Record first assignment separately. Calculate elapsed time from persisted timestamps so refreshes do not reset it.
- Retain the current owner during escalation until a specialist accepts the handoff.
- Stop the timer on resolution. Reopening resumes accumulated unresolved time, excluding resolved intervals. Retain every resolution summary, actor and timestamp.
- Identify staff owners and activity actors by person, combining all assigned role capabilities. Reopening retains the prior owner and any existing award/application status.
- Separate contestant-visible replies from internal staff notes. Omit internal notes from contestant views.
- Record an award separately from confirmation that it was applied externally. The demo does not change an external contest clock.
- Keep a local activity history that identifies the simulated actor. Prevent repeated actions from producing duplicate awards or invalid transitions.
- Preserve the fictional reset in local demo/test tooling. Do not expose a shared-data reset or persona impersonation control in the connected product.

## Ticket and Git workflow

- Distinguish development tickets from contestant issues in code, documentation, and communication.
- The first implementation ticket is **T0001 — Local workflow demo and project guidance**, using `feature/t0001-local-demo`.
- Start each development ticket from updated `main`. Use `feature/tNNNN-description` for subsequent ticket branches.
- User-approved exception for T0002: plan and implement it on `feature/t0001-local-demo`, continuing from T0001 without waiting for its merge. The user still reviews and merges. Resume the normal branch workflow for later tickets unless instructed otherwise.
- Work sequentially:
  1. Implement the active ticket.
  2. Verify the implementation.
  3. Update relevant documentation.
  4. Prepare a pull request for the user's review.
- The user reviews and merges. Do not merge the current ticket unless the user explicitly changes this workflow. Do not start the next ticket before the user merges the current ticket, unless the user explicitly changes this workflow.
- Testing and merging are workflow steps, not long-lived `test` or `merge` branches.
- Keep future work as a short candidate queue until feedback determines the next ticket. Do not create a large speculative backlog.
- Routine implementation and verification within the active ticket do not require repeated confirmation. Ask only for missing decisions that materially affect scope or behavior.

## Verification

- Inspect available scripts before invoking them. During T0001, provide npm scripts for development, production build, type checking, linting, and focused tests. Document their exact names in the README.
- Test meaningful behavior: lifecycle transitions, ownership during handoff, timestamp calculations, persistence, and award/application state.
- Include one browser test covering the complete journey across personas.
- Manually check phone-width volunteer screens, keyboard navigation, refresh persistence, reset, and separation of public replies from internal notes.
- Build, lint, type checking, and required tests must pass before presenting an implementation PR as ready. If a check cannot run, report the reason. Leave its result unverified.
- For documentation-only changes, check content, paths, and whitespace. Do not add application tests merely to test prose.
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
| `docs/cloud-onboarding.md` | Provider setup, costs and contributor onboarding for T0003; distinguish planned steps from verified outcomes. |

Update the relevant documents in the same change as behavior or workflow changes. Distinguish proposed, implemented, and verified capabilities. Use PLAN.md as the initial baseline. Keep later decisions explicit in the appropriate document rather than leaving conflicting instructions.

## Deferred decisions and production direction

- **Cloud first, features first (2026-10-02).** The user explicitly deferred outage handling and resilience until after the cloud features. Assume connectivity for the developer phase; do not block backend work on manual fallback, offline capture or venue-local operation. Ordinary error reporting and shared-data correctness still belong in the product.
- Use Cloudflare Workers and Supabase, preferring free tiers. The user is willing to pay when necessary; document the concrete need and cost before a paid upgrade. Do not treat free tier as a hard constraint or enable speculative paid services.
- Future attachments must link helpers' images to issues. Record configurable upload permissions, including enabling/disabling volunteer image submission, as future work. Contestant-visible versus staff-only attachments and the configuration scope remain undecided; do not silently choose a policy.
- A free-tier pilot and production capacity validation are separate milestones. Future targets on a healthy venue connection are:
  - 800 simultaneous users.
  - 95% of ordinary actions within two seconds.
  - Live updates within three seconds.
- Consult the product direction in PLAN.md when recording future requirements, including configurable roles/categories, shared incidents, award ledgers, and browser push. These are not automatic additions to T0001.

## Required end-of-run report

At the end of every Codex run, report all eight fields below. Keep them concise, use **None**, **Not run**, or **Not applicable** when appropriate, and distinguish completed checks from suggested manual steps.

1. **Summary of changes** — What changed and why.
2. **Files changed** — Paths to created, modified, or deleted files.
3. **Commands run** — Commands actually executed, including relevant failures.
4. **Build/test results** — Observed outcomes and checks that could not run.
5. **Manual verification steps** — What was manually checked and what the user should still verify.
6. **Risks** — Known limitations, unresolved decisions, or regressions. Do not invent risks.
7. **Follow-up tickets** — Existing ticket references or concise candidate work. Do not imply that an uncreated ticket exists.
8. **Docs that need updating** — Outstanding documentation work, or None if the relevant docs are current.
