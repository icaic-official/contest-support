# T0009 — Jury worklist

Status: merged in [PR #23](https://github.com/GiftedNovaHD/minsky/pull/23) at `c144a2a` on 2026-10-18.
Branch: `feature/t0009-jury-worklist`, originally from `main` at `1ed603a`.
The maintenance run used integration baseline `7d19b00`, including PR #41.
Its local checks, hosted jury acceptance, protected CI, and scoped cleanup passed on runtime source `f45d03f`.
The final follow-up changed documentation only.
Later combined application verification belongs to its recorded source and provider.
See [run log](run-log.md#t0009-parallel-maintenance-2026-10-18).

The owner authorized the 2026-10-18 maintenance in a separate worktree alongside T0020.
Supabase was active during that run. Its authorization excluded deployment, backend changes, and data migration.
The current worklist uses the shared provider contracts in the active Cloudflare application.

T0015 note (2026-10-18): the T0015 frontend redesign moved this worklist into the organiser screens.
The phone **Awards** tab and the desktop **Award review** page show To decide, To apply and Applied lists from `awardLists()`.
These lists use the eligibility and order rules below.
There is no separate **Jury worklist** sidebar entry and no **Back to jury worklist** button.
The award and confirmation forms stay on the desktop Award review cards.
The legacy `src/connected/JuryWorklist.tsx` was removed.
The sections below record the T0009 specification as accepted.
See [frontend architecture](../frontend-architecture.md#jury-award-lists).

## Outcome and scope

Give jury members a separate screen that identifies resolved issues needing an
award decision and recorded awards awaiting external application. Use existing
session data and issue actions. Keep award decisions discretionary and external
application a separate, explicit confirmation.

## Access and navigation

- Add **Jury worklist** to the sidebar for current session members with the jury
  role, including people who also have volunteer, specialist, or admin powers.
- Admin membership alone does not grant the jury role. Contestants and staff
  without that role retain their existing screens and permissions. Support staff
  can still confirm external application through the existing issue details.
- Keep the current initial screen and issue queue. Opening the worklist does not
  change the queue's team selection or status filter. Those filters do not limit
  the worklist or its counts.
- Scope every row, count, and selected issue to the current authorized session.
  Switching sessions clears the selected worklist issue. If the next session has
  no jury role, return to an available screen. Losing the jury role in the current
  session also removes the entry and clears its selection. Loss of membership or account
  readiness follows the existing access-denial flow and clears protected data.
- Archived events retain authorized reading. Award and confirmation controls
  remain unavailable under the existing archive rules.

## Worklists

Show two titled sections, each with its issue count and an explicit empty state.
Derive both lists from the authorized session snapshot, using issue and award IDs.
Each issue appears at most once across the two sections.

| Section | Eligibility | Default order |
| --- | --- | --- |
| **Needs decision** | The issue is currently resolved and has no award record. | Current resolution time, oldest first. |
| **Pending external application** | The issue has an award whose `applied_at` is null, regardless of current issue status or award minutes. | Award time, oldest first. |

Break equal timestamps by ascending issue number, then issue ID. Counts use the
same eligibility rules as the displayed rows. Loading or failed reads must not
appear as a successful empty list.

Show the issue reference, team name, location, category, current status, and total
unresolved time in both sections. Each row has a clearly named **View issue**
control. A summary preview may be shortened in the list; full text remains
available in issue details.

- **Needs decision** also shows the current resolution summary, resolver, and
  resolution time. Use the resolution that has not been reopened.
- **Pending external application** also shows the awarded minutes, public award
  explanation, decision-maker, and decision time. Its resolution summary and
  attribution refer to the award's `resolution_id`, even when a newer resolution
  exists. Distinguish that earlier resolution from the current issue status.
- Display **Reopened** when a pending award's issue is currently unresolved.
  Identify an award tied to a reopened resolution as an earlier decision, using
  the existing issue-detail warning. It remains pending until confirmed.

### Reopening and zero-minute decisions

Preserve the existing one-award-per-issue rule and every resolution record.

| Situation | Needs decision | Pending external application |
| --- | --- | --- |
| Resolved, no award | Yes | No |
| Reopened, no award | No | No |
| Resolved again, still no award | Yes, using the latest resolution | No |
| Award recorded, not applied | No | Yes, including zero-minute awards |
| Award recorded, issue subsequently reopened or resolved again | No | Yes, until the existing award is applied |
| Award applied, including after reopening or another resolution | No | No |

A zero-minute award is a completed decision, not a missing decision. Keep its
existing pending/application state; do not automatically confirm it. Reopening
does not erase an award, undo its application, or create another award decision.

## Timing and issue actions

- Calculate unresolved time with the existing shared helper and persisted
  timestamps, using the existing server-adjusted clock. Include unresolved
  periods across reopenings and exclude time spent resolved. Keep first-assignment
  delay separate. Do not infer an award amount from either duration.
- **View issue** opens the existing issue details and actions from the jury
  screen. Select from the worklist's authorized data, independently of the normal
  queue filter. This must also work for a reopened issue with a pending award
  when the member has only the jury role; the ordinary jury queue stays resolved-only.
- Provide **Back to jury worklist**. Return focus to the originating **View issue**
  control when it remains present, otherwise to its section heading. Keep the normal queue's
  existing return behavior when details were opened there.
- Reuse the current award form: explicit zero, preset, or custom non-negative
  whole minutes, with a required public explanation. Reuse the separate external
  application form and its required confirmation. Keep authenticated attribution,
  server timestamps, and history. Minsky records confirmation; it does not change
  an external contest clock.
- Add no award or confirmation form directly to a worklist row. Existing backend
  permissions remain authoritative. Do not grant jury-only members support
  ownership, resolution, or reopening powers.
- After a successful action and refreshed snapshot, update both sections and
  counts. An award moves an issue from **Needs decision** to **Pending external
  application**. Confirmation removes it from the pending list. Announce the
  result without automatically making the next decision or confirmation.
- If another client changes the selected issue, render its current state and
  permitted actions. When it leaves both lists, return to its originating section
  with a status message. This includes reopening without an award or confirmation
  recorded elsewhere. Handle stale revisions and retries through the existing
  workflow handler. Never carry an explanation draft to a different issue.

## Frontend and independence

- Implement the lists in a separate component and keep their eligibility and
  ordering logic independently testable. Limit shared changes to navigation,
  selection, and the existing details' return destination.
- Read the authorized `Snapshot` through `Backend.workflows.snapshot()`.
  Keep the UI independent of Supabase and Cloudflare SDKs.
  Reuse existing refresh, invalidations, reconnect handling, errors, and request retries.
  Add no subscription, polling loop, or persisted worklist.
- Use `Backend.workflows.execute()` for existing issue commands.
  Keep permission and transition decisions at the server.
  Preserve current database constraints, atomic commits, revision checks, request IDs, and duplicate-award protection.
  Add no schema, backend feature, provider implementation, or runtime dependency.
  The Supabase adapter retains its guarded SQL path. The Cloudflare adapter uses the shared service and atomic D1 commits.
- Merge current `main` into the existing PR branch without rewriting commits.
  Preserve current authentication, backend contracts, shared workflow integration, images, and refresh handling.
  Keep shared workspace, organiser award-list, and style changes focused on worklist integration.
- Follow the existing dark green theme. Use readable desktop lists and stacked
  phone rows, named controls, keyboard navigation, visible focus, and text labels
  for statuses. Check 320/390px widths and 200% zoom without horizontal overflow.
  Unrelated live refreshes must not steal focus or clear an open award explanation draft.

## Verification and release

Test eligibility, counts, stable ordering, multiple teams, equal timestamps,
zero-minute awards, every row in the reopening table, and selection independent
of ordinary queue filters. Verify that unresolved time agrees with issue details.

Browser checks must cover jury-only and combined-role access, the absence of the
entry for contestants/support-only/admin-only members, session changes, revoked
access, archived reads, keyboard return focus, and phone layouts. Include two
simultaneous authenticated contexts: an award or confirmation in one must update
the other's worklist. Check an open draft during unrelated live updates and the
existing stale-write, retry, and duplicate-decision protections.

Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:functions`,
`npm run test:functions`, `npm test`, and `npm run test:e2e`. Run the existing issue-workflow regression and
isolated Minsky CI cloud integration checks on the reviewed revision. Use only
UUID-scoped fixtures and remove only their records. Record local simulation,
embedded database, hosted cloud, protected CI, and manual results separately;
leave unavailable checks explicitly unverified.

Update README, tickets, current state, and manual verification with implemented
behavior and observed results. Update product direction and this specification
when implementation changes an agreed detail. Prepare the PR after fast checks;
the owner reviews and merges. Required checks must pass before owner review.
This maintenance does not authorize deployment. Existing automatic frontend deployment rules remain separate.

### Acceptance criteria

- [x] Jury and combined-role members can open the separate worklist without
  changing their existing issue queue; other roles gain no new permissions.
- [x] Both sections, counts, empty states, fields, and ordering follow this spec.
- [x] Reopening and zero-minute decisions follow the complete eligibility table.
- [x] A jury-only member can open an unresolved issue with a pending award and
  use the existing external-confirmation action.
- [x] Existing details, discretionary decisions, separate confirmations, timing,
  actor history, and one-award-per-issue protection are preserved.
- [x] Session changes, revoked access, archival, refresh, and simulated live
  changes pass locally, including two-client changes and an open explanation draft.
- [x] Desktop, 320/390px phone, keyboard, return-focus, and CSS zoom/reflow checks
  are recorded. Physical devices and native browser zoom remain unverified.
- [x] Required checks, current workflow regressions, and hosted jury acceptance pass.
  Fixture cleanup is verified. Evidence distinguishes simulations, hosted CLI, and protected GitHub runs.
- [x] Documentation and PR #23 describe current results.
  Required runtime verification passed. The owner merged PR #23.

## Exclusions

No bulk awards or confirmations, award adjustment or deletion, automatic
compensation, contest-system integration, completed-award archive screen, new
search or filters, notifications, shared incidents, roster import, issue images,
announcement work, general queue redesign, offline operation, or capacity claim.
Those features do not become prerequisites for this ticket.
