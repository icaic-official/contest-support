# Development tickets

These tickets describe development work, not contestant issues.

## T0001 — Local workflow demo and project guidance

Branch: `feature/t0001-local-demo`

Status: implemented and verified; prepared for PR review. User review and merge remain required.

Scope: React, TypeScript, Vite, npm lockfile, fictional group session, simulated contestant/volunteer/specialist/jury personas, versioned local persistence, and supporting project guidance. No cloud or deferred production features.

Tooling follow-up within this branch: upgraded to ESLint 10 and compatible plugins, preserved the existing Hooks checks, refreshed the lockfile and Node requirements, and reran all required automated checks successfully.

Acceptance criteria:

- [x] Complete submission → claim → escalation → specialist acceptance → resolution → jury award → separate application confirmation.
- [x] Submission/assignment/resolution timestamps, ownership during handoff, public/internal visibility and actor history.
- [x] Resolved-issue jury view, positive whole-minute award, public explanation and duplicate transition prevention.
- [x] Seed scenario, reset, status filters, roster locations and local persistence.
- [x] Labeled keyboard controls and a phone-width volunteer layout.
- [x] README and all five supporting documents.
- [x] Build, lint, type checking, focused tests and browser journey verified on final implementation.
- [x] Manual verification recorded with remaining limitations.
- [x] PR prepared for user review; no merge or next ticket started.

## Candidate queue (not yet development tickets)

1. Refine the local workflow based on demo feedback.
2. Decide outage behavior, then consider a small Cloudflare/Supabase free-tier integration experiment.

Start the next selected ticket from updated `main` only after T0001 merges, unless the user explicitly changes the workflow.
