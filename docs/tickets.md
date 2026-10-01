# Development tickets

These tickets describe development work, not contestant issues.

## T0001 — Local workflow demo and project guidance

Branch: `feature/t0001-local-demo`

Status: implemented and verified in the earlier run. The user accepted the proof of concept on 2026-10-02 and authorized T0002 on this branch before merge. Merge remains the user's responsibility.

Scope: React, TypeScript, Vite, npm lockfile, fictional group session, simulated contestant/volunteer/specialist/jury personas, versioned local persistence, and supporting project guidance. No cloud or deferred production features.

The tooling update on this branch upgraded ESLint to version 10 and installed compatible plugins. It preserved the existing Hooks checks. It updated the lockfile and Node requirements. All required automated checks passed after the update.

Acceptance criteria:

- [x] Complete submission → claim → escalation → specialist acceptance → resolution → jury award → separate application confirmation.
- [x] Submission/assignment/resolution timestamps, ownership during handoff, public/internal visibility and actor history.
- [x] Resolved-issue jury view, positive whole-minute award, public explanation and duplicate transition prevention.
- [x] Seed scenario, reset, status filters, roster locations and local persistence.
- [x] Labeled keyboard controls and a phone-width volunteer layout.
- [x] README and all five supporting documents.
- [x] Build, lint, type checking, focused tests and browser journey verified on final implementation.
- [x] Manual verification recorded with remaining limitations.
- [x] PR prepared for user review during T0001. The subsequent T0002 branch exception is recorded below.

## T0002 — Multiple staff roles, triage and reopening

Branch: `feature/t0001-local-demo` (explicit user exception; continue on the T0001 branch).

Status: implemented on 2026-10-02. All required checks passed; [PR #1](https://github.com/notbowen/minsky/pull/1) includes T0001 and T0002 for user review. Merge remains the user’s responsibility.

### Outcome and scope

A support staff member can claim an open contestant issue and begin triage, including a technical specialist or a person with both volunteer and technical specialist roles. The same person keeps one identity, ownership and activity history across their roles. Contestants and helpers can also reopen resolved issues. The user accepted the local proof of concept; visual redesign and Figma work are deferred.

Keep this ticket within the fictional, browser-local demo. Use a small fixed role-to-capability mapping and seeded people. Real accounts, role editors, configurable permissions, connected services and production authorization remain outside this ticket.

### Behavior

In this demo, “begin triage” means the existing **Claim issue** action: assign the person, move an open issue to In progress, and record first assignment. It does not add a new lifecycle status.

Implemented default: volunteer and technical specialist roles confer support membership. Jury alone does not confer support membership. A staff member receives the combined capabilities of all their roles; roles have no precedence over one another. Contestant accounts remain separate from staff accounts in this demo.

| Role membership | Claim open issues | Accept specialist handoff | Record awards |
| --- | --- | --- | --- |
| Contestant | No | No | No |
| Volunteer | Yes | No | No |
| Technical specialist | Yes | Yes, from another owner | No |
| Volunteer + technical specialist | Yes | Yes, from another owner | No |
| Jury only | No | No | Yes, for resolved issues |
| Support role + jury | Yes | Only if also a technical specialist | Yes, for resolved issues |

- Preserve the existing four personas and add a fictional volunteer + technical specialist persona. Show every assigned role in its label. Selecting a person activates all their capabilities without a separate active-role switch.
- Identify owners, history actors, award decision makers and application confirmers by person ID. Role names describe capabilities, not ownership. Existing fictional people retain their names and historical attribution.
- Every support owner can resolve or request a specialist handoff. A specialist who claimed directly can resolve without a handoff. A specialist requesting help retains ownership until a different specialist accepts. The current owner cannot accept their own handoff by using another role.
- Escalation targets the technical specialist role. Acceptance requires that role and transfers ownership to the accepting person. First assignment stays unchanged; the submission timer continues. The retained owner can still resolve while awaiting acceptance.
- Support staff see active issues and status filters. Adding jury membership must not force that person into the resolved-only queue. Jury-only users retain their resolved-issue view. Jury members see award controls on resolved issues.
- Keep staff notes private from contestants, owner-only resolution, jury-only award decisions, and staff confirmation of external application. Multiple roles must not duplicate actions, history entries or awards.
- Upgrade saved state to version 2 with validated migration of version 1 data. Map the old persona identifiers to the same fictional people. Preserve issue IDs, timestamps, ownership, pending handoffs, messages, awards and application status. Prefer existing v2 data; migrate v1 only when v2 is absent. Preserve the v1 source. Invalid or unsupported data must keep the existing visible error and explicit-reset recovery, without silently overwriting it. Reset writes a fresh v2 scenario so old v1 progress cannot reappear on refresh.

### Reopening resolved issues

Requested for T0002 on 2026-10-02. “Helper” means any staff member with a support role, including volunteers, technical specialists and people with combined roles. The following ownership, reason and award rules are the implemented ticket defaults.

- A contestant can reopen a resolved issue belonging to their own team. Any support staff member can reopen a resolved issue in the session, including one they do not own. Jury-only membership does not permit reopening.
- Provide **Reopen issue** in the contestant and support views, with a required public reason of 1–2,000 non-whitespace characters. Record the reason, actor and timestamp in the public activity history. Internal notes remain private.
- Reopen the same issue ID, return it to In progress (`claimed`), and retain its previous support owner. Reopening does not assign the contestant or the helper who clicked the control. Keep the original submission and first-assignment timestamps. Do not restore an old pending escalation.
- Retain every previous resolution summary, resolution actor and timestamp in structured lifecycle records and public history. Clear only the current resolution marker. Public replies and staff notes become available again; the owner can resolve again or request a new handoff. A later resolution requires a new summary.
- User-confirmed timer rule: resume accumulated unresolved time from the reopening timestamp, excluding time spent resolved. Persist the timestamps for every resolution/reopen cycle and calculate elapsed time from those records. For example, submission at 10:00, resolution at 10:05, reopening at 10:08 and another resolution at 10:10 gives seven minutes of unresolved time. First-assignment delay still uses the original submission and assignment. Label the timer clearly as unresolved time; awards remain discretionary.
- Permit multiple resolve/reopen cycles. Reject reopening an already active issue, cross-team contestant actions, blank reasons and backwards timestamps without changing state or adding duplicate history.
- Preserve any existing award and its pending/applied state. Explain that the award relates to an earlier resolution. Reopening neither revokes nor duplicates that award, and it never reverses external application. Staff can still confirm an existing pending award. A new award requires a currently resolved issue with no award; T0002 retains one award per issue, with award adjustments deferred.
- Update saved-state validation so an awarded issue can be active after reopening. Validate the award against its earlier resolution record, rather than requiring the issue to remain resolved or comparing it with a later resolution. Migrate v1 resolved issues into a first resolution record so they can be reopened without losing history.
- Reopened issues reappear in active support queues and remain visible to their own contestant team. If a Resolved filter would hide the reopened issue, switch to In progress and keep that issue selected. Jury-only views remain resolved-only; an issue returns there after its next resolution.

### Implementation completed

1. In `src/domain.ts`, separate person identity from role membership, add the combined-role seed persona, and define small shared capability/action predicates. Add reopening and structured resolution/reopen records. Update transitions, timer calculations, schemas and attribution together. Enforce person ownership and role capabilities in domain rules as well as controls.
2. In `src/storage.ts`, add the v2 schema/storage path and validate v1 migration. Test legacy pending handoffs, resolution records, reopened issues and award/application records, plus failure and reset behavior.
3. In `src/App.tsx`, use the shared predicates for claim, escalation, acceptance, reopening and award controls. Add the public reopening reason, previous-resolution display and filter behavior. Update persona labels, queues and activity attribution. Limit UI changes to those required for the behavior.
4. Extend domain/storage tests and the browser suite. Retain the original complete journey and add direct specialist triage and combined-role triage/handoff coverage. Add contestant reopening → owner resolves again → helper reopening → refresh → resolution, including an existing award. Exercise a support + jury fixture to catch role precedence bugs without adding a role editor.
5. Run the checks below, perform the manual walkthrough, update implementation/verification documentation, and prepare the shared branch PR for user review with both tickets distinguished. The user merges.

### Acceptance and verification

- [x] Volunteer-only, specialist-only and volunteer + specialist people can each claim an open issue. Contestants and jury-only people cannot. Repeated claims fail without changing state.
- [x] A combined-role person can claim and resolve directly, and can accept another person's escalation. Their own escalation requires another specialist to accept; role switching cannot transfer ownership to themselves.
- [x] Ownership, attribution and first-assignment timestamps refer to the correct person and survive refresh. Escalation keeps its owner until acceptance; resolution stops accumulated unresolved time.
- [x] Combined roles expose the union of capabilities. Support + jury can see active issues and award resolved issues; support membership alone cannot award time. UI controls and domain rejections agree.
- [x] Public/internal visibility, the original complete journey, single awards and separate external application continue to work.
- [x] Contestants can reopen only their own team's resolved issues. Volunteer-only, specialist-only and combined-role helpers can reopen session issues, including another helper's issue. Jury-only, cross-team, repeated, blank-reason and backwards-time attempts fail without mutation.
- [x] Reopening retains issue ID, previous owner, submission/first-assignment timestamps and all previous summaries. A public reason, actor and timestamp are recorded once. Replies resume, active queues show the issue, and only its owner can resolve it again.
- [x] Multiple resolve/reopen cycles survive refresh. Existing pending and applied awards survive reopening and later resolution; no second award is created. Pending application can still be confirmed. v1 awarded issues can migrate, reopen and reload without validation failure.
- [x] Timer tests cover multiple cycles and refresh, preserve first-assignment delay and exclude resolved intervals. The 10:00 → 10:05 → 10:08 → 10:10 example yields seven minutes. Each resolution stops the timer; reopening resumes it without resetting accumulated time.
- [x] Valid v1 progress migrates without loss; v2 reload and reset work. Invalid data, unsupported versions and failed writes are reported and covered by focused tests.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`, `git diff --check` and documentation link checks pass. Any blocked check remains explicitly unverified.
- [x] Manually check combined-role labels/actions at 390 × 844 and 320 × 740, keyboard claiming/handoff/reopening, contestant and helper reopening forms, desktop jury controls, refresh, reset and contestant omission of internal notes.
- [x] README, demo specification, current state and manual guide describe the implemented behavior and observed checks. Record any deliberate Google TypeScript Style Guide exceptions. Shared branch PR is ready for user review.

## Candidate queue (not yet development tickets)

1. Refine visual design after the user supplies or selects design references; outside T0002.
2. Decide outage behavior, then consider a small Cloudflare/Supabase free-tier integration experiment.

T0002 continues on the T0001 branch without a merge prerequisite. After the user merges the shared branch, start later selected tickets from updated `main` unless the user changes the workflow again.
