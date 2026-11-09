# Webmaster, event, and contest platform

**Status.** Implemented. All eight phases are merged on `main`. Phase 1 implements the contest resolver and migration `0017`. Phase 2 implements webmaster management with no migration. Phase 3 implements migration `0018`, sign-in by event code or site and handle, and `set_handle`. Phase 4 implements migration `0019`, the event console, and the one-webmaster bootstrap. Phase 5 implements migration `0020`, contest schedules, derived intake, personal end times, contest-wide awards, and the calendar. Migration `0021` adds withdrawal of an unconfirmed contest-wide award. Phase 6 implements migration `0022`, practice and live contests, the live password gate, and batched live credentials. Phase 7 implements migration `0023` and the permanent deletion of an event. Phase 8 implements migration `0024`, the three delete guards. Migration `0025` adds withdrawal of an unconfirmed issue award. The hosted runs of the Phase 1 gate were inconclusive against the 10 percent p95 rule, because `main` itself varied between runs. After a compile-time fix, the branch read faster than `main` at the median, and the maintainers accepted the gate on 2026-11-02. The [gate record](measurements/scoped-authority-gate.md) holds the measurements and the decision.

Phase 1 differs from this page and the sketches in these points:

- The foreign key on `accounts.event_id` is `DEFERRABLE INITIALLY DEFERRED`. Test cleanups delete an event and then its accounts in one batch, and an immediate key refuses that order.
- The resolver starts from the contest and its event, then joins the login tables, so the live form reads them once. Only a webmaster's stamp reads `site_settings`.
- `/api/sessions` (deleted in Phase 4, replaced by `/api/contests`) listed every contest that the caller can read. For a webmaster, that is every contest of the site.
- `authorityCopies.test.ts` also refuses `FROM grants`. It exempts the two trusted terminal commands, `installation.ts` and `adminRecovery.ts`, which check an admin membership without a login.

Phase 6 differs from this page and the sketches in these points:

- `0022` backfills no scopes. The sketch reads `account_operations.session_id`, and no current code writes that column. Every existing contest is practice, and only a live contest reads a scope.
- `0022` counts `unready_seats` twice, once before its triggers and once after them. The sketch counts once before them, so a seat written between that count and its trigger could later fail `CHECK (unready_seats >= 0)`. The second count makes the result exact after statement-by-statement application.
- The sketch refuses an issue when any open contest lies outside `forContests`. `forContests` is empty for a practice target, so that text would also refuse every lost-password reset during an open practice contest. The target contest is therefore exempt from the refusal. Scopes stay live-only. A request with no target still gets the refusal, and the console names the entrant's open contest when it resets one password.
- An account with no password yet is exempt from that refusal, because it has no sign-in to lose. This keeps the first issue after an assignment working.
- A request that names a contest in which the account has no seat gets 409. This is the closed choice for a case that the design does not state.
- The event console shows the count as "Waiting for live passwords: 3" and lists sign-ins, because one entrant can hold several sign-ins. The preview of other contests applies the window rule to contests that share an entrant. `forContestsSql` still decides per account on the server.
- Assigning an entrant with a sign-in to a ready, open live contest closes it for every team until that seat is issued, so the command needs `closeReporting: true` and the console asks first. `0022` also records each scope's issued window, and a move off that window ends the scope. A disabled seat keeps its contest closed until an organizer removes the seat. Both are the closed behavior.
- `forContestsSql` and the seat reads live in `authority.ts`, because `authorityCopies.test.ts` keeps every membership join there.

Phase 2 differs from this page and the sketches in these points:

- `PersonInput` has a `username`, not a `handle`, because handles arrive in Phase 3. `add_webmaster` stores the typed name as the username, and `0018` then copies it to the handle.
- `issueCredentials` takes only the IDs of up to eight other webmasters. It has no `eventId` and no `contestId`, because no event console calls it yet. A retry of a committed request returns each account with `temporaryPassword: null`.
- `Management.site()` returns only the webmasters, the read restriction, and the contests that the caller has not joined. For an account that is not a webmaster, it returns `null`, not 403. The browser then asks without logging an error.
- In Phase 1, `/api/sessions` (now `/api/contests`) and `snapshotSql` stayed unchanged, so the Phase 1 gate measures the same readers. A webmaster who must join a contest finds it on the **Site** page and on the no-access screen. The site read feeds both.
- A webmaster can remove themselves while another enabled webmaster who holds a password remains. They keep their own login, because the batch checks the caller's login after its writes. A webmaster removed by another loses every open session.
- A contest's activity shows a join as "Joined to read this contest" by "A webmaster" when the webmaster holds no membership there. `admin_audit` stores no actor name, and decision 12 keeps webmasters out of the member list. Showing the name needs a change to `snapshotSql`, which waits for the hosted rerun of the Phase 1 gate.
- `recoverWebmaster` finds a webmaster by username, and `npm run cloudflare:recover-admin` calls it. `adminRecovery.ts` is deleted, so the command no longer recovers a contest admin who is not a webmaster. `recoverInstallationOwner` was deleted in Phase 4.
- `credentialReset.ts` is now `credentials.ts`. Its `replaceCredentialStatements` puts the existing begin and complete statements into one batch.
- `authorityCopies.test.ts` does not count `DELETE FROM grants` as a copy of the access check, because a delete reads nothing. Every read of `grants` stays in `authority.ts`.

Phase 3 differs from this page and the sketches in these points:

- `0018` adds a second convergence trigger, `site_handle_default`. The previous Worker's `add_webmaster` and bootstrap give a site account a username and a site grant, but no membership. `accounts_handle_default` alone would leave that account without a handle.
- The HTTP route parses the event code and the handle with `parseEventCode` and `parseHandle`, so `AuthenticationService.signIn` takes a `Handle`. Text that cannot be a code or a handle gets the refusal of a wrong one, and the IP limit counts it.
- A wrong event code counts against the key `handle:code:<typed code>:<handle>`. This page gave it no key. Then only a code that exists reached 429 after ten failures, so the limit showed which codes exist.
- The sign-in page shows the server's refusal. Before Phase 3, every refused sign-in showed "Sign in to continue."
- `set_handle` resolves authority through an event resolver, `eventAuthoritySql`, which Phase 1 did not build. `manageHandleSql` holds decision 14. It is `manageAccountSql`, plus the caller's own account under `ownHandleSql`. That condition requires an account of an event with no contestant seat. The account status reads `ownHandleSql` too, as `can_change_handle`, and the account page shows its form only when that is true.
- An unknown event code or handle is refused before Better Auth runs, because a legacy login key in another event can equal the typed handle. That refusal, and the refusal of a disabled or pending account, hashes the typed password first. Without the hash, the median refusal took 32 to 45 ms in local D1, and a wrong password took 132 ms. So the time showed which codes and handles exist. With the hash, the median refusal took 93 to 95 ms, and a wrong password took 120 ms. The remaining gap matches the two D1 reads that Better Auth makes for a known login key.
- A webmaster cannot change its own handle, because `set_handle` names an event and a webmaster has none.
- The account operation of `set_handle` names no contest. So a contest's activity no longer lists a username change. `authority_audit` records it with the event, the old handle, and the new handle. The command notifies staff and the account in each contest that seats the account, because the `0014` trigger notifies only for an operation that names a contest.
- An account from before usernames has no login key. Its first temporary password gives it `loginKeyFor(id)`. A reset of an account without a handle is refused before it begins, so the old password stays valid.
- The credential sheet shows the link `<origin>/?event=<code>` for an event account. For a site account, it shows the sign-in page and says to choose **Site sign-in**.
- The sign-in form remembers the last event code in the browser's `localStorage`, under `minsky-event-code`. It does not remember **Site sign-in**.
- Two checks need hosted Cloudflare resources and did not run: the sign-in burst at the 200-user step on `minsky-preview` (see "Risks"), and the rehearsal of `0018` on an empty D1 database and on a `minsky-preview` copy.

Phase 4 differs from this page and the sketches in these points:

- Entrant foreign keys are deferred (`teams.entrant_id`, `accounts.entrant_id`), like `accounts.event_id`, because test cleanups delete an event and then its teams and accounts in one batch.
- The backfill puts same-named teams of an event in one entrant when a chain of shared contestant accounts connects them, so three teams A, B, C where A shares an account with B and B with C all merge. The oldest team of the chain lends its ID and its spelling. Same-named teams with no chain keep their own entrants, because they are different groups. A team also keeps its own entrant when its name is empty, or when an older team of its contest has the same name.
- An account with any staff authority (a staff seat, a contest admin flag, a role, or a grant) stays staff and is not linked to an entrant, even when it also holds a team seat. Its seats stay. The entrant then shows "No sign-in", and **Add sign-in** (`add_entrant_sign_in`) gives it a new account. So an entrant's password never issues a login that holds staff authority. The rule holds in the backfill, in `contestant_seat_links_entrant`, and in `account_entrant_fixed`. The previous design linked such an account and hid it from staff.
- `0019` is safe statement by statement. Entrants exist before any key names them, so no statement needs the deferred key at commit. A retry after a partial apply stops at `CREATE TABLE entrants` with "already exists" and changes nothing. Recover with the restore point that `scripts/deploy-workers.mjs` prints before it migrates. Do not rerun the file by hand. `eventRosterMigration.test.ts` applies the file one statement at a time, because the `test:d1` fixture applies it in one batch.
- After `0019` applies, run `SELECT count(*) FROM teams WHERE entrant_id IS NULL`. The result must be `0`, because every team has an entrant. A higher count means the backfill did not finish, so stop and restore from the restore point.
- `contestant_is_not_admin` refuses `UPDATE memberships SET is_admin = 1` on a contestant seat. The previous Worker never does this, because its member validation forbids an admin flag with a team seat. `scripts/rollback-check.mjs` still reports only the one documented failure below.
- A password reset writes one `reset_password` row in `admin_audit` for each contest that seats the account, so contest activity still shows it. Activity names an actor outside the contest "An organizer", and never shows an account ID.
- A rename of an entrant also renames its sign-in when the sign-in carries the old name, and refreshes each contest of the entrant.
- `ContestSummary` also holds `eventName`. The picker adds the event name only when two listed contests have the same name.
- The console and the Site page keep the last overview when a read fails, and show the error with **Retry**. Both read again when the window regains focus. A success ends every earlier request ID, so a toggle retried after a lost answer applies.
- After a revert, the previous Worker has these limits. A team seat cannot make an account with staff authority into an entrant's sign-in, and it cannot place a webmaster in an event. `add_teams` in a `singles` contest fails (`entry_default_fits`). A linked account whose seat was removed can return only to a team of the same entrant. A seat on another team or a staff seat fails closed (`seat_matches_entrant`). After `delete_team` and a new `add_teams`, the new team has a new entrant, so the old seat cannot return. A trigger cannot lift this, because the current Worker's unassign also removes seats and the sign-in must keep its entrant.
- `session_changes` keeps `categories`. A contest keeps its category list in `sessions.categories`.
- The `memberships_team` index is part of `0019`. Unassigning an entrant scanned 2,443 rows of a contest of 1,200 members without it.
- `set_intake`, `set_image_limits`, and `update_contest` read 74 to 156 rows, above the 60-row command target, because they notify every team of the contest.
- `issueCredentials` takes `{ eventId | null, accountIds }` and replaces `reset_password`. A contest admin reissues through it for accounts that `manageAccountSql` allows. The contest panel's reveal omits the sign-in link, because the snapshot does not carry the event code.
- `ContestSummary` is `{ id, name, eventId, manage }`. `Management.event(eventId?)` reads the caller's own event when it has no ID, so an event admin whose event has no contest yet still finds the console. The snapshot's teams carry `entrant_id`, because `set_location` names the entrant, not the entry.
- `bootstrapSite` takes a site file `{ webmasterHandle, webmasterName }` (`--site`) and creates one webmaster, its site grant, and one `authority_audit` row. It writes no `installation` row. The `recover` install command is gone. `npm run cloudflare:recover-admin` recovers a webmaster.
- `rollback-check.mjs` reports one failure from the previous release's own tests, in `store.test.ts`, which moves a contestant seat to another team. The triggers `seat_team_fixed` (a move of the seat) and `seat_matches_entrant` (a seat in a team of another entrant) refuse that move. So after a revert, the previous Worker's `save_member` cannot move an entrant's contestant to another team, and the command fails closed. The failure stays until the owner decides whether to accept this limit. The check script has no exception for it. The sketch's header did not name this refusal. Earlier, two more failures in `authority.test.ts` came from the name-only merge of same-named teams. The merge by shared account removed them.
- `set_event_admin` may remove the last event admin of an event. A webmaster can then name another. The owner accepted this on 2026-11-05.
- The contest panels keep intake, image limits, categories, team locations, username change, and password reissue. The nav item and the page are named **Team locations**. Contest admins no longer create accounts, edit teams, or assign people.
- The module map lists three files under `src/event/`. Phase 4 also adds `PeopleTabs.tsx`, `ContestTabs.tsx`, `forms.tsx`, `eventModel.ts`, `EventLink.tsx`, and `useOwnEvent.ts`.
- `ContestPicker` replaces the pickers of the contestant top bar, the console sidebar, the phone Session tab, and the no-access screen. The Sessions section of the account page keeps its own list, because it shows a Switch button per row.

Phase 5 differs from this page and the sketches in these points:

- `ContestSummary` keeps its Phase 4 flat shape and gains `eventName`, `timeZone`, `contestType`, `schedule`, `intake`, and `canOpen`. `canOpen` replaces the sketch's `seat`, because a calendar row needs only whether the caller can open the contest. Phase 6 adds `kind`.
- `/api/contests` with no query gives each contest the caller's own intake, so a contestant with confirmed extra time sees `running` or `grace` after the scheduled end, as the snapshot's clock says. It uses `viewerExtraSql`, the helper that the snapshot uses, and reads the minutes once for each contest in a materialized `viewer` row. Measured on the schedule fixture, a contestant's read went from 12 rows to 14 without a schedule, 16 with one and 17 with one confirmed award. Staff went from 24 rows to 28. `{eventId}` and `{window}` give the intake of the contest alone. `/api/contests` with `{eventId}` still lists only the contests that the caller can open. `{window}` lists the scheduled contests of the caller's own event that overlap the window, with `canOpen` false for a contest without a seat. A webmaster gets every event. A window is at most 92 days and returns at most 500 contests. A member's read uses `sessions_event_schedule` and a webmaster's uses `sessions_ends`, in two statements. A contest with no schedule is listed only by `{eventId}`.
- The snapshot's `clock` uses snake_case like the rest of the snapshot, and adds `follows_schedule`. `session.intake_open` now holds the derived value for the viewer, which is the personal value for a contestant. A contestant reads only the contest-wide awards that staff confirmed, and staff read all of them.
- The SQL fragments take the extra minutes as an expression, `intakeOpenSql(s, extra)`, `intakeStateSql(s, extra)`, and `personalEndSql(s, extra)`, and not an entry. A reader computes the minutes once with `extraMinutesSql(s, entry)` and passes the value. `clockSql` is new. The snapshot reads the minutes in one materialized row, which it joins once. A scheduled contestant snapshot read 126 rows, against 112 without a schedule and the ceiling of 130. Before the join, the same snapshot read 132.
- `intakeOpenSql` answers while the scheduled end lies ahead without reading any award, so a workflow command during a contest reads nothing extra. After the end it reads the contestant's issues and their awards. A contestant submit measured a flat 47 rows during a contest. After the scheduled end it grows by about 2 rows for each confirmed contest-wide award and by about 2 rows for each issue of the contestant: 129 rows at 31 awards and 171 at 50. Realistic counts of 1 to 3 awards stay near the ceiling of 60. The cost is paid only after the scheduled end, while the extra time keeps the contestant open. Each confirmed contest-wide award also adds about 3 rows to the contestant snapshot, so the 130-row ceiling test fixture needs a higher ceiling once about 2 awards are seeded.
- The workflow `dependency` carries the intake value for every command, and the read takes `intake_open` from it, so each evaluation computes it once. A command that crosses a time boundary between its read and its batch retries once.
- Extra minutes are capped at 525,600 for one entry, which keeps the date arithmetic in range. A contest-wide award is 1 to 1,440 minutes.
- The schedule triggers test their condition inside `COALESCE(..., 0)`. The sketch's condition accepted a start without an end and a malformed instant, because a comparison with NULL is NULL.
- Migration `0020` has no `awards_session` index, because nothing reads it. The event console shows no extra minutes per entry yet. Phase 7 adds the index with the other foreign-key child indexes.
- `set_intake` takes a `mode`. `create_contest` requires a schedule. `update_contest` takes an optional one, and an omitted schedule keeps the current value, including none. The edit form shows schedule fields for a contest with no schedule only after **Add a schedule**, so renaming such a contest leaves it unscheduled. `update_contest` never changes the mode, so staff choose **Return to schedule** for a contest that has been held by hand.
- `/api/contest-awards` takes `{sessionId, requestId, command}` and answers with `AuthenticationError` statuses, 400 for input, 403 for authority, and 409 for state. Each decision, confirmation, and withdrawal writes an `admin_audit` row, `contest_award`, `contest_award_applied`, and `contest_award_withdrawn`. A command notifies the staff and every team of the contest. It read 101 rows to grant and 105 to confirm with 24 teams, above the 60-row target of the workflow commands, like `set_intake`. A contest of 800 teams adds about 800 rows for the team list.
- The calendar is in the account page's Sessions section and on the site dashboard. The event console has no calendar tab, because its Contests tab lists the schedules. `ContestPicker` shows the start time of each contest in the event's time zone, and a note such as "Running now".
- Minsky writes `?contest=` to the address only for a person with more than one contest. For a person with one contest, a used tab can still carry a stale value, and the list check ignores it. The picker's note comes from the server's `intake.reason`, not from a clock in the browser. The note is as old as the session list. While the tab is visible, that list reads again at least every 60 seconds. A hidden tab skips those reads and reads once when the person returns. A clock decides only the default contest, because a held or waiting reason never expires. The [frontend architecture](frontend-architecture.md#contest-picker) describes that clock.
- The index `contest_awards_unconfirmed` (migration `0020`) closes the duplicate award that a lost response, a reload, or an edit could record. It leaves three limits. A retry with different minutes records a second award, because nothing can tell it from a new decision. A retry after staff confirmed the first award records another, for the same reason. Migration `0021` adds the `withdraw` command (see Withdrawing a contest-wide award). The browser keeps the request ID in memory for the same page session (`useContestAwards`), so an ordinary retry returns the first receipt and clears the form. After a reload or an edit the server refuses the retry, the form keeps its text, and the list refreshes.
- A volunteer or specialist sees the contest-wide awards that wait for confirmation above the queue. Jury see the full panel on the award pages.
- The new files that the module map does not list are `src/connected/contestClock.ts`, `ContestClock.tsx`, `ContestAwards.tsx`, `Calendar.tsx`, `calendarModel.ts`, `intakeText.ts`, `hooks/useContestAwards.ts`, `src/event/ScheduleFields.tsx`, and `scheduleForm.ts`.
- A rollback during a running contest closes intake for the scheduled contests until staff reopen them, because the previous Worker reads only `intake_open`.
- `scripts/rollback-check.mjs` reports the one failure of Phase 4 and no other. The previous Worker's `set_intake` still changes `intake_open` and the version, and a contest that follows its schedule reads as closed through `intake_open` until its switch changes (`previousWorker.test.ts`).

Phase 7 differs from this page and the sketches in these points:

- `event_deletions.lease_until` is `NOT NULL DEFAULT 0`. A NULL never matches the range `lease_until <= ?`, so a new row would never be claimed. The table has no `attempts` column, because nothing reads it. `blocked` holds the blocking account's ID, and the site read joins `accounts` to name it.
- `event_deletion_targets.done` means done in the current step. The batch that moves to `live` or to `files` clears it for the contests, because that step visits them again. Every update that sets `done` also checks the step in SQL. So a runner whose lease expired cannot mark a contest after the clear, which would skip its R2 prefix.
- `foreignKeyIndexes.test.ts` derives the index list of `0023` from `sqlite_master` and `pragma_foreign_key_list`. A search must bind every column of the key, or a complete unique key, because a search on the first column of a composite key reads the whole session for each deleted issue. Against the sketch, the list adds `account_operations(account_id)`, `announcement_images(session_id, announcement_id)`, `announcement_receipts(session_id, announcement_id)`, `awards(session_id, issue_id)`, `contest_awards(withdrawn_by)`, `issue_images(session_id, issue_id)`, `grants(event_id)`, and `grants(session_id)`. It drops `contest_awards_actor`, which repeats an automatic index. `awards(issue_id, resolution_id)` needs no index, because `resolution_id` is unique. The `installation` singleton is exempt. `event_deletions_finished` serves the site read.
- The new indexes add writes on hot paths: one entry for each history row, issue, resolution, award, image, and workflow receipt, and one for each staff action on an issue owner, reopened resolution, or removed image.
- The fence also revokes the logins of the event's accounts. The resolver fence does not stop the surfaces that read outside it: avatars, the password change, and the member calendar. A late avatar upload would write a file that no target covers. Webmasters keep their logins. The `login_access_notifications` trigger writes one outbox row for each login and seat.
- The revocation reaches only the logins that exist when the fence commits. A sign-in reads the fence before its password check, which takes the time of one password hash. So the batch that writes a login also asserts `NOT EXISTS event_deletions` for the account's event. A password change writes its new login through the same batch. D1 runs the fence and that batch one after the other. So either the fence revokes the new login, or the batch fails with 409 and writes no login. A password change whose new login fails keeps its new password, and the account stays signed out. A refused batch leaves a Better Auth identity session with no login. No surface accepts a session without a login, and the rows step deletes it with the account. `eventDeletion.test.ts` fences the event at that batch for a sign-in and for a password change, and signs in an account of another event and a webmaster across the fence.
- The fence writes one set-based `staff` outbox row for each contest, and not one row for each team. Any `/notify` checks every socket again in `grants()`, so one row closes every socket that lost its access, including those of webmasters.
- The fence holds no audit statement. `commit` in `manage.ts` writes the one site audit row. `fenceFixtureEvent` reuses the same statements with no audit.
- The fence check is in the member calendar's scalar subquery, and not in its `WHERE` clause. A term there made SQLite read the materialized `reach` rows without its automatic index. The webmaster branch takes the term in its `WHERE` clause and keeps its plan.
- The rows step probes with one `CASE WHEN EXISTS` statement, because `count(*)` reads every remaining row on every round. `advanceRows` reads the step first, so a stale runner stops once the step has moved.
- The rows step classifies each table under a contest. Activity grows with use and goes in chunks of one table per unit, before the contest row: `issues` and `announcements` at 100 rows, and `notifications`, `admin_audit`, `announcement_receipts`, `contest_awards`, and `account_operations` at 1,000 rows. `history`, `resolutions`, `awards`, `command_receipts`, `issue_images`, `image_deletions`, `announcement_images`, and `announcement_image_deletions` go with those parents. The contest row's cascade then removes only roster-sized rows: `audience_sequences`, `credential_scopes`, `grants`, `memberships`, `membership_roles`, `session_issue_sequences`, and `teams`. `eventDeletionCoverage.test.ts` fails when a new table under a contest has no class. D1 runs one query at a time and advises chunks of about 1,000 rows, so a long statement would make other events wait.
- Before the last batch, the rows step adds a target for each contest and account of the event that a target does not cover, and it continues if it added one. So a contest that a writer without the guard added after the fence still gets its `/erase` and its file pass. A refused account chunk does the same first, because such a contest can hold the refused row. The last batch asserts that the event holds no contest and no account, and that failure also continues.
- An account batch first deletes the `account_operations` rows between two targets that name no contest. Without this, an admin in one chunk who reset a contestant in a later chunk fails its `NO ACTION` key and looks blocked. An operation on an account outside the targets still blocks. So does an operation that names a contest, because this event's contests are gone and that contest is in another event.
- An account batch also asserts that the chunk holds no row of `memberships`, `announcement_receipts`, `command_receipts`, or `credential_scopes`, and no `account_operations` row with a contest. After the contests go, any such row is in another event, and the account's delete would cascade into it. No key refuses that cascade. `eventDeletionCoverage.test.ts` fails when a new cascade child of `accounts` is neither one of these nor the account's own data: `grants`, `logins`, and `manage_receipts`.
- On a key failure or that assertion, a chunk retries one account at a time, in order. Earlier accounts commit. The first that fails goes in `blocked`, the deletion stops, and `lease_until` moves one hour ahead. A later success clears `blocked`, so the deletion continues when the other event's own deletion removes the rows. Any other error propagates and retries on the next lease. The log line `deletion.advance_failed` names the `phase`, which it reads from the journal, and a fixed `cause`, which it derives from the error's text. It never holds that text. A key that fails when the last batch commits gives `internal error; reference = ...` on local D1, so `cause` cannot always name the key. `phase` is then the certain fact.
- An account batch also adds an `avatar_owner` target for any avatar row of the chunk. The current Worker starts no login after the fence. The previous Worker after a revert signs in without the fence, so a login that it creates can reserve an avatar after the fence. The fence's own avatar statement stays, as this page states.
- `/erase` takes `{ sessionId, eventId }`, because the key of `event_deletion_targets` starts with the event. `SessionMaintenance` takes `{ eventId }` and erases the contest targets of that journal. Its capability is `eventLiveErase`. Hosted fixtures still delete exact R2 keys and list no prefix.
- The files step makes one pass after the wait. While `unixepoch() < unixepoch(rows_done_at) + 3900`, it moves `lease_until` to that instant and returns. So no R2 call and no claim happens for 65 minutes. Without this, a one-minute cron would make about 52,000 list operations for 800 owners.
- A slow request body can keep an upload running past the file pass. So an announcement image upload reads its image again through the resolver after the R2 write, as an issue image upload already did. For a fenced event, that read fails. The upload then deletes its file when no usable image row remains, which is the case after the rows step. Before the rows step ends, the row stays, and the later file pass removes the file. A Worker that stops between the write and that read still leaves the file, and after the deletion no row remains to find it. `announcements.test.ts` fences the event and removes the image row during the write.
- A lease lasts 55 seconds, longer than the 20-second budget and shorter than the minute between cron ticks, so the next tick finds it expired. The budget also counts 400 D1, R2, and Durable Object calls. A rows unit counts as 4 calls: the state, the next chunk's read, a reconcile, and the write.
- D1's `rows_read` counter reports 2 for the idle claim, also on an empty table: 1 for the index seek and 1 for `RETURNING`. A plain `SELECT` probe reports 1. No form reports 0, so the claim stays one statement. `cronReads.test.ts` holds the count at 2 with 20 finished deletions and one leased deletion in the table.
- `SiteOverview.deletions` lists the open deletions and the latest 50 finished ones. `useSite` reads again every 15 seconds while one is open. After a deletion starts, focus moves to the **Deletions** heading, because the row that opened the dialog is gone.
- The rows step's last batch deletes each `manage_receipts` row whose command field `eventId` or result field `eventId` is the event's ID, and each row whose command field `contestId` is a contest of the event. Every command of an event names it in `eventId`, including `issue_credentials`. A `create_event` receipt names the event only in its result. A contest command can hold a contest name or a location, and it names only the contest. The match reads these fields and never the text, because a person's name can hold a pasted ID. Both columns have a `json_valid` check, so `json_extract` cannot fail on a stored receipt. Each `delete_event` receipt stays, so its replay still answers. The lead made this decision, and the owner can overrule it in review. The match reads every receipt once per deletion. On local D1 with a load average near 11, with receipts of about 190 bytes and three runs each, it took 14 to 16 ms for 20,000 receipts, 66 to 76 ms for 100,000, and 275 to 301 ms for 400,000. The earlier form, which searched the text of each receipt, measured 13 to 22 ms, 68 to 83 ms, and 285 to 302 ms in the same runs. So the fields cost no measurable time. The match read one row for each receipt, plus one for each contest. A later retry of a deleted `create_event` request has no receipt to answer it, so it would create a new event. `authority_audit` site rows and the journal row stay, as this page states.
- Test cleanups call `removeFixtureEvent` in `eventDeletionFixture.ts`, or its three parts when a fixture must also clear R2 and Durable Objects. The deletion tests run that cleanup only on a hosted database, because a local database goes with its test file and the rows step took most of a test's time. `D1Fixture` accounts have an explicit `event_id`, and the fixture accepts contests that a test added to its event. A site account in a local test stays in the temporary database. The hosted fixtures create no site account. `liveCredentials.test.ts` loses its test of a direct account delete, because `0024` refuses that delete. `eventDeletionCoverage.test.ts` covers the same cascade through the journal.
- The new files that the module map does not list are `src/site/DeleteEventDialog.tsx`, `src/site/Deletions.tsx`, `src/server/adapters/cloudflare/eventDeletionFixture.ts`, `src/server/adapters/d1/eventDeletionHarness.ts`, `src/server/adapters/d1/eventDeletionCrash.test.ts`, `src/server/adapters/d1/eventDeletionCrashRows.test.ts`, `src/server/adapters/d1/eventDeletionLegacy.test.ts`, `src/server/adapters/d1/foreignKeyIndexes.test.ts`, and `scripts/event-deletion-timing.mjs`.
- The fence also deletes the `installation` row when it names the event's owner or contest, and not only the event. `0017` placed an owner by the majority of its memberships, so the row can name another event. No runtime code reads the row. `installation.ts` checks only that the table exists.
- An event with an empty name confirms its deletion with its code. An event can have an empty name, because `0006` added the column with an empty default. Every event has a code, because `0018` backfilled the column and a trigger fills it on insert. A stored name has no length limit in the command.
- Rehearsal of `0023` on 2026-11-07, on the separate fictional database `minsky-preview-rehearsal-0023`, deleted afterwards. The steps were an empty database, `0001` to `0022` through `wrangler d1 migrations apply --remote`, then two fictional events and a webmaster that filled 35 of 39 tables, then `0023` the same way. `0023` executed 35 commands in 4.13 ms of D1 time. `PRAGMA foreign_key_check` returned no rows, and none of the 39 tables changed its rows. All five deletion test files then passed against that database at the final revision: 63 tests in 715.56 s. R2 and Durable Objects are test doubles in those files. The same day, `scripts/deploy-workers.mjs` applied `0011` to `0023` to `minsky-preview`, which held one event and one account, with no foreign key failure.
- Hosted deletion proof on 2026-11-07, on `minsky-preview` with the Worker deployed from this branch, real R2 in `minsky-preview-images`, and real Durable Objects. Two fictional events, A and B, were made through the management commands, credential issue, sign-in, and the upload routes. Each had 5 R2 objects (an issue original and thumbnail, an announcement image, and two avatars), open sockets, and a contest Durable Object with stored data. A was deleted from the console at a 390 px width, and B later through `/api/manage`.
  - **Fence and rows.** `rows_done_at` came 3.6 s and 3.2 s after `requested_at`. The request's `waitUntil` ran the rows and live steps. Open sockets closed with 1008 at the fence's notify, before `/erase`, and reconnects got `401`, or `403` for the webmaster.
  - **Durable Objects.** `/erase` returned 200 in 77 to 84 ms for each contest. Within 7 minutes the namespace listed A's and B's objects as holding no stored data, while B's object kept its data through A's deletion. The objects stay in the namespace list.
  - **Files.** The journal waited in `files` until `rows_done_at` plus 3,900 s, and the next cron tick ran one pass. A finished 65 min 49.7 s after `rows_done_at`, and B 65 min 57.3 s after. Bucket listings found each event's 5 keys before its pass and none after, and the other event's keys stayed, matched by key and etag. R2 operation analytics did not count the Worker's calls reliably, so the listings are the proof.
  - **Isolation.** Through A's deletion, B's 94 rows and the preview event's 25 rows stayed byte-identical. Afterwards B's sign-ins, its 5 objects, a new socket, and an update worked. The `delete_event` receipt replayed the same answer after the fence, after the rows step, and after `done`. Tail recorded 0 `deletion.advance_failed` in 81 cron runs.
  - **Not observed.** Whether `/erase` closes a socket, because the fence closed every socket first. The Worker's individual R2 calls.
  - **Left behind.** The test webmaster stays without a password or sessions, because `grant_last_webmaster` keeps the last webmaster. Three Durable Object entries stay with no stored data.
- Hosted timing on 2026-11-07, `npm run perf:deletion -- --remote --database=minsky-preview`, twice, with the same seed as the local runs. The deletion took 10,237 and 10,381 ms of server time over 533 calls and 591 statements, with 916,787 rows read and 253,387 rows written. The slowest statement took 278.4 and 235.5 ms. It deletes 100 issues, 4,350 rows, the same limiter as on local D1. That is about 12 times the local server time, and every statement stays far below the 20-second budget of one cron run. The run needs at least 2 cron runs, because a run stops at 400 calls. Errors were 0, event A left no rows, and event B changed no table. The seed wrote 2,211,254 rows in 118.7 and 108.7 s. Wall time from the test machine was 82 to 84 s, which includes a network round trip for each call.

A Worker rollback after Phase 3 loses these:

- Accounts that the Phase 3 Worker creates cannot sign in to the previous Worker until roll-forward. Their login key is their ID without dashes, and nobody types it. These include contest accounts, added webmasters, and a newly bootstrapped webmaster. The previous Worker's member list shows that login key as their username.
- A legacy account without a username, which got a handle and then its login key at a Phase 3 reset, cannot sign in there either.
- A legacy account whose handle changed signs in there with its old username. If another account later took that old handle, the old username still opens the legacy account there (`previousWorker.test.ts`).
- The previous Worker ignores event codes and time zones, and its sign-in form asks for no event code.

This page explains how one shared Minsky installation can host the events of many organizers. It settles GitHub issues #119 and #136 under the owner's decisions of 2026-10-27, which [PLAN.md](../PLAN.md) records. It supersedes an earlier multi-competition design, which proposed one installation per organization.
The [sketches page](event-platform-sketches.md) holds the full type sketch and migration sketch.
Every `path:line` citation refers to `main` at `f90b1f5`.
Every SQL check that this page names ran in local SQLite 3.51, not D1. Nothing on this page was measured on D1.

## Terms

This page uses these words:

- A **webmaster** runs the whole site. A webmaster belongs to no event.
- An **event**, such as "XXXX Olympiad 2026", has one time zone, its own accounts, and one or more contests.
- An **event admin** has full authority inside one event.
- A **contest** is one scheduled session of an event, such as "Live 1". In the database, a contest is a `sessions` row.
- A **contest admin** manages one contest. Event admins assign contest admins, and an event can have none.
- An **entrant** is a team or a single contestant of an event. An **entry** is that entrant's place in one contest, stored as a `teams` row.
- A **handle** is the name that a person types to sign in. A **login key** is the stored name that Better Auth knows. Nobody types a login key.
- A **grant** is a stored row that gives authority at the site, event, or contest scope.
- The **resolver** is the one SQL query that answers what an account may do in a target.
- The deletion **journal** is the record that drives the permanent deletion of one event, step by step.

## Problem

One shared Minsky installation must host the events of many organizers. Today it has two levels of authority. A `memberships` row gives authority in one contest. The maintainer terminal creates everything else (`src/server/adapters/cloudflare/installation.ts:86-138`). Every read and write joins that one row. The join is copied in about fifteen places, for example `src/server/adapters/cloudflare/application.ts:30-52`, `src/server/adapters/d1/store.ts:36-70`, `src/server/adapters/cloudflare/authentication.ts:189-203`, and `src/server/adapters/cloudflare/live.ts:103-120`. The copies already disagree on the meaning of "staff" (`src/server/adapters/cloudflare/application.ts:35` against `src/server/adapters/d1/store.ts:65-66`).

The owner's 2026-10-27 decisions add webmasters above events and event admins above contests. They add per-event usernames, scheduled contests with automatic intake, personal end times, a calendar, and permanent event deletion. Six facts make the shape hard:

- Guards re-run access inside D1 batches and compare version counters with `=` (`src/server/adapters/cloudflare/application.ts:226-231`, `src/server/adapters/d1/store.ts:143`, `src/server/adapters/d1/migrations/0001_transaction_proof.sql:95-99`). So authority must be a SQL fragment that a batch can re-evaluate, and nothing in it may be NULL.
- Workers Builds applies each migration while the previous Worker still serves (`scripts/deploy-workers.mjs:212-274`). The guard rejects drops and renames (`src/server/adapters/cloudflare/tooling/migrations.mjs:19-36`). Every new trigger must accept or repair the previous Worker's writes, and a Worker rollback must keep working.
- `ba_user.username` and `ba_user.email` are inline `UNIQUE` columns that cannot change without a table rebuild (`src/server/adapters/d1/migrations/0004_identity.sql:6`, `src/server/adapters/d1/migrations/0004_identity.sql:11`). Better Auth finds a user by that column alone (`node_modules/better-auth/dist/plugins/username/index.mjs:171-177`). The previous Worker signs in with `SELECT * FROM accounts WHERE username = ?` (`src/server/adapters/cloudflare/authentication.ts:130`).
- `issues.team_id` is `NOT NULL` with a composite key to `teams(session_id, id)` (`src/server/adapters/d1/migrations/0001_transaction_proof.sql:53`, `src/server/adapters/d1/migrations/0001_transaction_proof.sql:60`). There is no event-level contestant.
- D1 cascades never reach R2 or Durable Object storage. The only complete deletion is fixture-only (`tests/providers/cloudflare/fixture.ts:342-407`, `src/server/adapters/cloudflare/live.ts:260-263`). Test cleanup deletes events and accounts directly (`src/server/adapters/d1/testFixture.ts:205-207`).
- The old `adminCondition` lets a contest admin reset any account whose every contest the admin also administers (`src/server/adapters/cloudflare/authentication.ts:194-199`). On a one-contest site, that includes a webmaster. A rolled-back Worker keeps that rule.

This design replaces these sections of the earlier design: "Names and levels", "Rosters", "Authority", "Audit", "Setup module", "Type sketch", "Migration sketch", and "Delivery phases". It keeps that page's contest kinds and its reason for fresh live passwords. The module map lists every superseded statement.

## How each person uses the platform

This section describes the behavior from each person's view. All eight phases are built.

### Quickstart for an organizer

These steps take a new installation to a working event:

1. A maintainer runs `npm run cloudflare:install -- bootstrap` on an empty hosted database, with the flags that the [installation guide](../site/src/content/docs/operators/installation.mdx) lists. The command reaches the hosted database only. It has no local mode. Minsky creates one webmaster and writes a temporary password once, to a private file.
2. The webmaster opens `https://minsky.example/`, chooses **Site sign-in**, signs in, and changes the temporary password.
3. The webmaster selects **Create event**. The form takes the name "XXXX Olympiad 2026", the event code `xxxx-2026`, the time zone `Asia/Singapore`, and the first event admin, with handle `chen` and name "Chen Li". Minsky shows Chen's credential sheet once. The sheet holds the link `https://minsky.example/?event=xxxx-2026`, the handle, and the temporary password.
4. Chen signs in from that link and builds the event. That work covers contests, staff, teams, single contestants, and assignments.
5. Each staff member and contestant gets a sheet with the same event link. The link fills in the event code. A person types the code only when they open the plain sign-in page, so keep the code short and easy to read aloud.

The sign-in form labels the handle field **Username**, because people know that word. In code and on this page, the typed name is the **handle**. The stored name that Better Auth knows is the **login key**. Nobody sees or types a login key.

### Webmaster

A webmaster works in this order:

1. The webmaster signs in with **Site sign-in**. Webmasters belong to no event, so this form has no event code.
2. The webmaster lands on the **Site** dashboard. It lists each event with its derived span ("3 to 5 Nov, Asia/Singapore") and its contest and account counts. It also shows a calendar of every event's contests, the webmasters, the setting **Webmasters read contest data only after joining**, and the progress of deletions.
3. The webmaster selects **Create event** (step 3 of the quickstart). One batch creates the event, the admin's account, and the event grant. Then the browser asks for that one account's credentials.
4. The webmaster opens any event console and does anything that an event admin can do. For example, the webmaster resets the password of a locked-out event admin.
5. The webmaster opens a contest. By default, the contest opens at once. While the restriction is on, Minsky first says "Join this contest to read its issues and notes. The contest's admins see your join in their audit." **Join** writes a contest-scope grant. D1 then writes the audit rows itself.
6. The webmaster adds or removes webmasters. Removing the last enabled webmaster fails with "The last webmaster cannot be removed".
7. The webmaster deletes an event by typing its name. Minsky fences the event at once, which stops its reads, writes, and sign-ins. The dashboard shows progress. Rows go first. Files get a final check about an hour later. The dashboard keeps a "Deleted" record.

### Event admin

An event admin builds the event in this order:

1. The event admin signs in at `?event=xxxx-2026` and lands on the **Event** console.
2. **Contests.** The event admin creates contests with a name, a type (teams, singles, or mixed), and a schedule with a grace period. The console takes and shows times in the event's time zone. A contest also has a kind, so the event admin creates "Practice 1" as practice and "Live 1" and "Live Singles" as live.
3. **Entrants.** The event admin imports a list of teams and single contestants. Each row gives a kind, a name, and a handle. Minsky creates the entrant and its one sign-in.
4. **People.** The event admin imports staff, each with a handle and a name.
5. **Assignments.** The event admin uses a grid of contests by entrants, and a grid of contests by staff with roles (contest admin, jury, volunteer, and specialist). One entrant can enter several contests. One staff member can serve in several.
6. **Credentials.** The event admin issues passwords and prints sheets. Before "Live 1", the event admin selects **Issue live passwords for Live 1**. Minsky lists the teams and the live contests that each new password will also open. Those are the team's live contests whose window overlaps "Live 1". Minsky issues eight accounts per request with a progress bar. "Live 1" shows "Waiting for live passwords: 3 teams" until the last team is done.
7. The event admin adds a second event admin with **Make event admin**.

### Contest admin

A contest admin manages one contest:

1. The contest admin signs in with the event link. The picker lists the contests of the event with start times in the event's time zone. It opens the contest that runs now, or the next one. The choice stays in the address (`?contest=...`), so a refresh keeps it.
2. The intake panel says "Following schedule. Opens 13:00, closes 18:15 (15 minutes grace)". **Open now** and **Close now** override the schedule. **Return to schedule** ends the override. A live contest that waits for passwords says so, and no override can open it.
3. The contest admin edits categories, image limits, and team locations, and publishes announcements, as today.
4. **Staff.** The contest admin sees the contest's staff and their roles. To add or remove a staff member, the contest admin asks an event admin. An event that wants no contest admins assigns none.
5. The contest admin reissues a password or changes the handle of an account at the desk. The contest admin can do this only for an account that holds no grant and whose every assignment is one of the admin's contests.

### Volunteer

A volunteer works as today, with one contest at a time:

1. The volunteer signs in with the event link and their own handle.
2. The volunteer picks one contest at a time. The calendar view shows the day's contests of the event. It lists contests where the volunteer has no seat, but the volunteer cannot open them.
3. The volunteer works the queue as today. Nothing in the issue workflow changes.

### Contestant

A contestant sees these changes:

1. The contestant opens the sheet's link. The form already shows "Event code: xxxx-2026", and the device remembers the code for the next sign-in. The contestant enters the handle and the temporary password, then chooses a new password. The forced change stays.
2. The contestant sees a clock, such as "Live 1 ends in 1:42:10". With confirmed extra time, the clock says "Your end time is 18:10. It includes 10 minutes that staff confirmed as applied."
3. The report form says why it is closed, such as "Reporting opens at 13:00", "Reporting closed at 18:25", or "Reporting opens when every team has its live password".
4. A person who competes alone in "Live Singles" and in a team in "Live 1" has two sign-ins, as the owner decided.

### Three call sites

These sketches show the server and browser code in this codebase's idiom.

#### Management command (`src/server/adapters/cloudflare/manage.ts`)

```ts
async execute(caller: Caller, requestId: RequestId, input: unknown): Promise<ManageReceipt> {
  const command = manageCommandSchema.parse(input); // IDs become EventId, ContestId, ...
  const replay = await this.replay(caller, requestId, command);
  if (replay) return replay;
  const requirement = requirementFor(command); // requirementOf, exhaustive by type
  const authority = requireAuthority(await resolveAuthority(this.db, caller, requirement.target),
    { manage: 'level' in requirement ? requirement.level : 'none' }, true);
  const plan = await this.plan(command, authority);
  await this.commit(authority, requestId, command, plan); // authorityGuard first, receipt last
  return plan.receipt;
}

// Two cases of plan(). An event admin reaches both. A contest admin reaches only set_handle.
case 'assign_staff': // requirementOf: the contest, level 'event'
  return {
    statements: [
      this.statement(`INSERT INTO memberships (session_id, account_id, is_admin) VALUES (?, ?, ?)
        ON CONFLICT (session_id, account_id) DO UPDATE SET is_admin = excluded.is_admin`,
      command.contestId, command.accountId, Number(command.admin)),
      ...this.replaceRoles(command.contestId, command.accountId, command.roles),
    ],
    guards: [this.staffOfEvent(command.accountId, authority.eventId)], // no entrant, same event
    audit: { action: 'assign_staff', target: command.accountId, detail: { roles: command.roles } },
    notify: [{ contestId: command.contestId, audiences: ['staff', `account:${command.accountId}`] }],
    receipt: {},
  };
case 'set_handle': // requirementOf: the event, plus manageAccountSql for this one account
  return {
    statements: [this.statement('UPDATE accounts SET handle = ? WHERE id = ? AND event_id = ?',
      command.handle, command.accountId, command.eventId)],
    guards: [this.manageAccount(authority.caller.accountId, command.accountId)],
    audit: { action: 'set_handle', target: command.accountId, detail: { handle: command.handle } },
    notify: [],
    receipt: {},
  };
```

An account requirement such as `set_handle` asks only for an authority row in the event, which every account of the event and every webmaster has. `manageAccountSql` then decides inside the batch. The caller never states its authority. `requirementOf` derives the target from the command, and `authorityGuard` re-runs the resolver inside the batch. A handle change writes only `accounts.handle`, so it never touches Better Auth and never ends an open session.

#### Snapshot query (`src/server/adapters/cloudflare/application.ts`)

```ts
export const snapshotSql = `WITH login AS (${currentReadyLoginSql}),
  access AS MATERIALIZED (${contestDataSql('caller')}),
  visible_issues AS MATERIALIZED (...unchanged, reads a.team_id and a.staff...)
SELECT json_object(
  'session', (SELECT json_object('id', s.id, 'event_id', s.event_id, 'name', s.name,
    'kind', s.kind, 'type', s.contest_type, ...) FROM sessions s WHERE s.id = ? AND c.account_id IS NOT NULL),
  'access', (SELECT json_object('manage', c.manage) WHERE c.account_id IS NOT NULL),
  'clock', (SELECT json_object('time_zone', e.time_zone, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'grace_minutes', s.grace_minutes, 'intake', json(${intakeStateSql('s', 'c.team_id')}),
      'personal_end_at', ${personalEndSql('s', 'c.team_id')})
    FROM sessions s JOIN events e ON e.id = s.event_id WHERE s.id = c.session_id),
  'contest_awards', ...,
  ...the other sections are unchanged...
) AS snapshot FROM login LEFT JOIN access c ON true`;
```

Only the `access` line and the new sections change. Each section reads `c`, the one resolver row in the FROM clause. D1 compiles every statement on every call, and SQLite compiles a CTE again at each place that names it. So a section that names `access` again adds a compile of the resolver to every snapshot. See [the diagnosis of the read gate](measurements/scoped-authority-gate.md#diagnosis). `contestDataSql` keeps the column names that embedders read from `CurrentAccessRow` (`src/server/adapters/cloudflare/application.ts:9-26`), and its bindings keep the order of `currentAccessBindings` (`src/server/adapters/cloudflare/application.ts:58-60`). `contestDataSql` is the only export of the contest resolver. The unfiltered row stays private to `authority.ts`, so an embedder cannot skip the webmaster restriction.

#### Sign-in in the browser and on the server

```tsx
// src/screens/SignIn.tsx
const target: SignInTarget = siteMode ? { kind: 'site' } : { kind: 'event', code: eventCode };
await backend.auth.signIn(target, String(data.get('username') ?? ''), String(data.get('password') ?? ''));
rememberEventCode(eventCode); // localStorage, in try/catch

// src/server/adapters/cloudflare/authentication.ts, inside signIn(target, input, password)
const handle = usernameSchema.parse(input) as Handle; // a parse failure gives the same 401
const row = await this.statement(signInAccountSql(target.kind), ...signInBindings(target, handle)).first<SignInRow>();
if (!row && target.kind === 'event') throw incorrect(); // unknown event code; the IP limit applies
const key = signInLimitKey(row?.event_id ?? 'site', handle);
await this.assertBelowLimit(key, signInFailureLimits.perUsername);
try {
  if (!row?.account_id) throw incorrect(); // unknown handle: Better Auth is never called
  return await this.createLogin(row.login_key, password); // unchanged, src/server/adapters/cloudflare/authentication.ts:129-153
} catch (error) {
  if (error instanceof AuthenticationError && error.status === 401) await this.recordFailure(key);
  throw error;
}
```

An unknown handle never reaches Better Auth. Better Auth looks up the text that it receives as a login key, and a legacy login key in another event could equal the typed handle.

## Shape

### Data structures

Every invariant below has one home. The "Enforced by" column names it.

| Structure | Key | Invariant | Enforced by |
| --- | --- | --- | --- |
| `grants` (new) | partial unique per scope | `site`: the holder has no event. `event`: the holder belongs to that event and is not an entrant's sign-in. `contest`: only a webmaster holds it, only while the site restricts reads, and D1 writes its audit. A change moves `accounts.access_version`. Grants are never edited. The last enabled webmaster cannot lose the grant or be disabled. | D1 triggers `grant_holder_scope`, `grant_holder_not_entrant`, `grant_join_needs_restriction`, `grant_join_audited`, `grant_added`, `grant_removed`, `grant_immutable`, `grant_last_webmaster`, `account_last_webmaster` |
| `site_settings` (new) | singleton | An absent row means "webmasters read everything". `version` moves on every change, and the resolver stamps `COALESCE(version, 0)`. | No seeded row, which keeps bootstrap's emptiness check (`src/server/adapters/cloudflare/installation.ts:56-65`). Trigger `site_settings_changes` |
| `accounts.event_id` (new) | `accounts_event` | Every account that is not a webmaster belongs to one event, fixed for life. | Triggers `account_event_fixed`, `membership_adopts_event` |
| `accounts.username`, the login key (kept) | `accounts_username`, unchanged (`src/server/adapters/d1/migrations/0003_authentication.sql:5`) | Globally unique. Equals `ba_user.username`. A new account's login key is its UUID without dashes. A legacy account keeps its old value. Never changes after creation. | The existing unique index and column CHECK. Nothing in the new Worker writes it after creation |
| `accounts.handle` (new) | `accounts_event_handle (event_id, handle)`; `accounts_site_handle (handle)` where `event_id IS NULL` | Unique inside one event, and unique among site accounts. Legacy accounts keep their visible name as handle. | Two partial unique indexes. Trigger `accounts_handle_default` for the previous Worker's writes |
| `memberships` (kept) | `(session_id, account_id)` | Contest staff seats and contestant seats. Contestant seats are a projection of entries. An entrant's sign-in holds a seat in exactly the contests that hold its entry. A membership never crosses events. An entrant's sign-in never holds a staff seat or a role. | Triggers `membership_event_scope`, `entry_seats_added`, `entry_seats_removed`, `account_entrant_seats`, `seat_matches_entrant`, `contestant_has_no_role` |
| `events` | `id`; `events_code` unique | `code` is the name that a sign-in gives. `time_zone` is an IANA name. Dates are derived from contests, never stored. | Unique index. The Worker validates the zone with `Intl` |
| `entrants` (new) | `id` | Owned by one event. `kind` is team or single. Names are unique inside the event. | FK cascade from `events`. Name uniqueness by a read and an in-batch guard, like `noClash` (`src/server/adapters/cloudflare/application.ts:325-326`), because old fixture data has empty and duplicate names |
| `teams` (kept, now "entry") | `(session_id, entrant_id)` unique | One entry per entrant per contest. The entrant belongs to the contest's event and fits the contest type. The entry shows its entrant's name. | Triggers `entry_fits_contest`, `entry_entrant_fixed`, `contest_type_fits_entries`, `entrant_renamed`, `entry_renamed`, `entry_default_entrant` |
| `sessions` (kept, "contest") | `id` | `kind` is fixed. A live contest has a schedule. Schedule instants are well formed and ordered. `unready_seats` counts the contestant seats without a password issued for this contest, exactly. | CHECK on `kind`; triggers `session_kind_fixed`, `session_schedule_*`, and the five seat and scope counters; `CHECK (unready_seats >= 0)` |
| `credential_scopes` (new) | `(account_id, session_id)` | The live contests that the current password opens. An admin issue by any writer ends all old scopes. | Trigger `credential_issue_ends_scopes`; written by `replaceCredentialStatements` |
| `account_operations` (kept) | `id` | A lower authority never resets or renames a higher one, under any Worker version. | Trigger `account_operation_takeover` |
| `contest_awards` (new) | `id`; `(actor, request_id)` | A decision and a separate confirmation, each written once. | `UNIQUE`, `CHECK`, trigger `contest_award_fixed` |
| `authority_audit` (new) | `id` | Site rows (`event_id` NULL) survive event deletion. Event rows go with the event. | FK cascade; no FK on actor or target |
| `event_deletions`, `event_deletion_targets` (new) | `event_id`; `(event_id, kind, id)` | The journal survives the cascade. It lists exactly what the deletion may touch. It moves forward one step at a time and always names the same event. | No FK to `events` or `accounts`. Triggers `event_deletion_step_order`, `event_deletion_fixed` |
| Delete guards (new) | on `events`, `sessions`, `accounts` | A row of an event, a contest, or an event account disappears only while that event's journal is in step `rows`. A site account never disappears this way. | Triggers `events_delete_guard`, `sessions_delete_guard`, `accounts_delete_guard` |

Access patterns traced through these structures:

- **Every contest read and write** (snapshot, workflow, images, announcements, avatars, live sockets) evaluates one resolver row. Its lookups are the login (as today), the contest and the event by primary key, the membership by primary key, two partial-index probes on `grants`, two primary-key reads of `site_settings`, the entrant by primary key, and one primary-key probe of `event_deletions`. That is about six probes more than `accessSql` today. Phase 1 measures them and decides on a gate (see "Delivery phases"). A local query-plan check showed no table scan for either selection form in local SQLite.
- **Is intake open now** reads columns of the contest row and D1's clock. For a contestant, it adds the confirmed awards of the contestant's own entry through `issues_session_team` (`src/server/adapters/d1/migrations/0013_membership_account_index.sql:9`). Nothing counts the contest's 800 seats on a read, because D1 keeps `unready_seats` exact.
- **Sign-in** reads `events_code`, then `accounts_event_handle`. A site sign-in reads `accounts_site_handle`, then `grants_site`. Better Auth then reads `ba_user` by the login key, as today. The previous Worker's lookup by username still uses `accounts_username` in the local query-plan check.
- **Calendar and picker** read `sessions_event_schedule (event_id, starts_at)` for one event, and `sessions_ends` for a webmaster's window.
- **Event console** reads `accounts_event`, `entrants_event`, and `sessions_event`, then memberships by primary key per contest.
- **`forContests`** reads the target contest by primary key, the event's contests that start before the target's window ends, and one membership each by primary key.
- **Deletion** reads `event_deletion_targets_pending`, then deletes by primary key or by the contest's index. One statement reads every `manage_receipts` row, once per deletion. Every foreign-key child has an index (`0023`).

### Authority model

Authority is grants at three scopes, resolved in one place.

- **Site** (`grants.scope = 'site'`) is a webmaster, with full authority everywhere.
- **Event** (`grants.scope = 'event'`) is an event admin, with full authority inside one event.
- **Contest** authority comes from today's `memberships` and `membership_roles` (contest admin, jury, volunteer, specialist, contestant seat). A webmaster's audited join adds `grants.scope = 'contest'`.

`authority.ts` resolves "what may this account do here" for one target: the site, an event, or a contest (`Target` and `Authority` in the [type sketch](event-platform-sketches.md#type-sketch)). The result has three parts:

- `manage` is none, contest, event, or site. It ranks authority over structure.
- `seat` is null, a contestant seat, or a staff seat with `admin` and roles. The one rule table, `capabilityRule` in `src/connected/capabilities.ts`, answers contest data questions from it.
- `stamp` is an opaque JSON array of version counters. `authorityGuard` re-runs the same SQL inside the batch and compares it.

Event admins and webmasters resolve to a staff seat with `admin: true` in every contest that they reach. So today's rules for contest admins apply to them unchanged. They can resolve any assigned issue, submit for any team, and read members and audit (`src/server/workflow.ts:107-117`, `src/server/workflow.ts:172-173`). They cannot award, claim, or accept without a role, because award stays jury-only (`src/server/workflow.ts:190`).

Isolation is built in, in three layers. The first lives in D1 triggers, the second in the resolver's SQL, and the third in `requirementOf` with in-batch guards:

1. A membership or an event grant cannot cross events (`membership_event_scope`, `grant_holder_scope`). This closes today's attach-any-UUID hole (`src/server/adapters/cloudflare/application.ts:428-431`, `src/organiser/admin/AccountForms.tsx:364`).
2. The resolver admits a contest only when `a.event_id = s.event_id OR a.event_id IS NULL`, and the NULL case grants nothing without a site grant or an existing membership.
3. Every command derives its target from its own IDs through `requirementOf`. A command that names a row inside an event, such as `rename_entrant` or `set_handle`, also names the event. Its in-batch guard checks that the row belongs to that event. So no row of `requirementOf` reads the event by hand.

**Two storage tables, one resolver.** The cleanest form of "one structure" would put contest staff into `grants` too. That fails the rollback constraint. The previous Worker reads `memberships` in about fifteen places. `membership_roles` holds a foreign key into it (`src/server/adapters/d1/migrations/0001_transaction_proof.sql:48`), and it holds the composite key to `teams` (`src/server/adapters/d1/migrations/0001_transaction_proof.sql:41`). Every account notification trigger fans out over it (`src/server/adapters/d1/migrations/0014_notification_claims.sql:39-44`). Moving it needs a rebuild of `memberships` and `membership_roles` with paused publication, and it would change no answer that the resolver gives. The contest scope of `grants` holds only joins. A join must not look like a contest admin, must not count for last-admin rules, and must not be removable by the contest's own admins.

**Webmaster visibility** lives only in the resolver's `data` column. A site grant alone decides it. The value is 1 when the setting is absent or off, or when a contest-scope grant exists. A webmaster's own membership never opens data while the restriction is on, so a webmaster cannot skip the audited join by assigning themselves. A local behavior check shows this for a promoted webmaster who holds the jury role. Structure authority ignores the setting, because the restriction covers contest data. So a webmaster can still reset accounts and edit schedules without joining. A change of the setting moves `site_settings.version`. Every stamp includes it, so in-flight webmaster commands fail and retry. A local behavior check shows this.

**The audited join is a database fact.** D1 refuses a contest-scope grant unless the site restricts reads (`grant_join_needs_restriction`). After the insert, D1 writes an `admin_audit` row in that contest and a site row in `authority_audit` (`grant_join_audited`). The contest's admins read the first in their snapshot audit (`src/server/adapters/cloudflare/application.ts:149-160`). The second survives event deletion. No writer of a grant can skip either row.

**Account management** (credentials and handles) uses one SQL condition, `manageAccountSql` in the [type sketch](event-platform-sketches.md#type-sketch):

- A webmaster may manage any other account.
- An event admin may manage any other account of the event. Webmasters have no event, so an event admin never manages one.
- A contest admin may manage an account that holds no grant and whose every assignment is a contest that the admin administers in an unarchived event.

This keeps the existing "admin of every affected session" rule (`src/server/adapters/cloudflare/authentication.ts:195-199`) for contest admins, and adds the levels above them. D1 repeats the core of the rule for every Worker version. `account_operation_takeover` refuses a reset or rename of a webmaster by anyone but a webmaster. It also refuses a change to an event admin by anyone but a webmaster or an event admin of that event. Every admin issue and rename inserts an `account_operations` row in the same batch as its writes (`src/server/adapters/cloudflare/authentication.ts:241-242`, `src/server/adapters/cloudflare/authentication.ts:263-268`). So a refusal rolls the whole batch back. An actor may act on the own account, which keeps `change_password` and trusted recovery working (`src/server/adapters/cloudflare/installation.ts:170-171`, `src/server/adapters/cloudflare/adminRecovery.ts:131`).

**Last webmaster.** Two triggers count the enabled webmasters. One refuses deleting the last grant, and one refuses disabling the last account.

**Encoded lesson.** A repository test, `src/server/authorityCopies.test.ts`, fails when server code outside `authority.ts` contains `JOIN memberships`, `FROM memberships m`, or `JOIN grants`. Because `contestAuthoritySql` is not exported, an import of it fails to compile. A new reader cannot copy the old check or skip the restriction by accident.

### Identity and sign-in

Each account has two names:

- The **login key** is `accounts.username`. It keeps the global unique index `accounts_username` (`src/server/adapters/d1/migrations/0003_authentication.sql:5`) and its column CHECK (`src/server/adapters/d1/migrations/0003_authentication.sql:2-4`). Better Auth stores the same value in `ba_user.username` and signs in by it alone. A new account gets `loginKeyFor(id)`, its UUID without dashes. That is 32 characters of `[0-9a-f]`, which passes the CHECK and the plugin's validator (`src/server/adapters/cloudflare/identity.ts:116-122`). A legacy account keeps its old username as login key. The new Worker never changes a login key.
- The **handle** is `accounts.handle`. It is the name that a person types. It is unique inside one event (`accounts_event_handle`), and unique among site accounts (`accounts_site_handle`). A legacy account's handle equals its login key.

This split keeps three things true:

1. The previous Worker's sign-in lookup keeps its unique index. After a rollback it reads one row through `accounts_username` and never meets two rows for one name. The local query-plan check pins the plan. A same-name replacement of `accounts_username` by `(event_id, username)` would pass the guard. But the old lookup then reports `SCAN accounts` in local SQLite. Also, NULLs are distinct in a unique index, so the old Worker could insert duplicates with `event_id` NULL.
2. `src/server/adapters/cloudflare/credentialReset.ts:57-60`, `src/server/adapters/cloudflare/installation.ts:69-74`, and `src/server/adapters/cloudflare/authentication.ts:240` keep writing `ba_user.username = accounts.username`. They need no new rule about which name to write.
3. No migration touches `ba_user`.

The cost is naming. TypeScript carries two branded types, `Handle` and `LoginKey` (see the [type sketch](event-platform-sketches.md#type-sketch)), so the compiler stops a mix-up.

Sign-in works this way:

1. The request becomes `{event: code | null, handle, password}` (`SignInTarget` in the [type sketch](event-platform-sketches.md#type-sketch)). `src/server/authenticationHttp.ts:8` widens its strict schema.
2. `signInAccountSql` resolves the account in one of two statements, never one with OR, so each uses its own unique index. The event form reads `events_code`, then `accounts_event_handle`. It returns the event ID even when the handle is unknown. The site form reads `accounts_site_handle` and requires a site grant, so an orphan with no event cannot sign in as a webmaster.
3. The failure key becomes `handle:<eventId or 'site'>:<handle>`. Two events' `team01` no longer share a counter (`src/server/adapters/cloudflare/authentication.ts:119`). An unknown event code fails at once with no key, and the IP limit applies (`src/server/adapters/cloudflare/worker.ts:36`).
4. An unknown handle counts a failure and gives 401 without calling Better Auth.
5. `createLogin(loginKey, password)` runs unchanged (`src/server/adapters/cloudflare/authentication.ts:129-153`). `changePassword` already passes the stored login key (`src/server/adapters/cloudflare/authentication.ts:347`).

Temporary passwords, the forced change at the database boundary (`src/server/adapters/d1/migrations/0003_authentication.sql:31-35`), and the eight-hour session stay.

The credential sheet prints `https://<origin>/?event=<code>` and the handle. The form prefills the code and remembers the last code on the device. Codes read like names (`xxxx-2026`). A wrong code, handle, or password gives one message. The sign-in page makes no unauthenticated lookup of an event.

**`set_handle`** replaces `set_username`. It writes `accounts.handle` only. `ba_user` and the login key stay, so a handle change never ends an open session. It inserts an `account_operations` row with the existing action `set_username`, so the takeover trigger checks it.

**The previous Worker's writes converge.** It inserts an account with a username and no event, then a membership (`src/server/adapters/cloudflare/authentication.ts:253-256`). `membership_adopts_event` places the account in that contest's event. `accounts_handle_default` then sets the handle to the username. The previous Worker's `set_username` only fills a NULL username (`src/server/adapters/cloudflare/authentication.ts:238`), and the handle follows it the same way. If the username is already a handle in that event, the unique index fails the whole batch, and the previous Worker reports an error. A local behavior check shows each case.

### Event roster and contest assignment

- An **entrant** is a team or a single contestant. It belongs to the event and has one sign-in (`accounts.entrant_id`).
- A **`teams` row is the entrant's entry in one contest**. It keeps today's key, so `issues.team_id NOT NULL`, the `(session_id, team_id)` foreign keys, `memberships_staff` (`src/server/adapters/d1/migrations/0016_staff_membership_index.sql:6`), and the `team:<id>` live audience keep working. A single contestant also has an entry, so their issues need no schema change.
- **Assigning an entrant** inserts one entry. D1 seats the entrant's sign-in (`entry_seats_added`), checks the contest type, and copies the entrant's name. Unassigning deletes the entry and its seat. The command is refused while the entry has issues, as `delete_team` is today (`src/server/adapters/cloudflare/application.ts:365-388`).
- **Assigning staff** upserts a membership and roles, as `manageMember` does today (`src/server/adapters/cloudflare/application.ts:422-455`). D1 refuses an entrant's sign-in and an account of another event.
- **Names.** Renaming an entrant renames every entry. Renaming an entry, which the previous Worker's `update_team` does, renames the entrant. `teams.name` is a projection that D1 keeps equal, not a second source.

Who does what:

- **Event admins and webmasters** own the event roster. They create accounts (`create_people`, `create_entrants`), assign and unassign entrants, assign and unassign staff in any contest of the event, and make event admins.
- **Contest admins** manage only their own contest. They keep contest settings (categories, image limits, and team locations), announcements, the intake override, the issue workflow, and confined credential reissue and handle change through `manageAccountSql`. They no longer create accounts, assign entrants, or add and remove staff. `requirementOf` gives `assign_staff` and `unassign_staff` the event level. An event that wants no contest admins assigns none (decision 2).
- Event admins and webmasters always reach every contest, so the per-contest "last admin" rule (`src/server/adapters/cloudflare/application.ts:428-431`) is dropped.

**Backfill (`0019`).** Teams that share a normalized name inside an event become one entrant only when they share a contestant account, so a team that the same people entered in two existing contests becomes one entrant. Same-named teams with no shared account stay separate. Each contestant account links to the entrant of its oldest team in its own event. Data with several accounts per team, or with unnamed teams, stays as it is. Seats stay in `memberships`, so legacy oddities keep working.

### Contest schedule, clock, time awards, and intake

- A contest has `starts_at`, `ends_at`, and `grace_minutes`. It runs continuously, and contests may overlap.
- **Intake is derived, never stored or flipped.** `intakeOpenSql` in the [type sketch](event-platform-sketches.md#type-sketch) evaluates D1's clock in every read and again inside the submit batch, through the workflow `dependency` value. So a submit that crosses the close fails and retries. No cron writes intake, and no audit actor is needed. The terms are evaluated in this order:
  1. The live gate comes first. It is `kind = 'practice' OR unready_seats = 0`. No override opens a live contest that waits for passwords.
  2. While the contest follows its schedule, intake is open from `starts_at` until the end plus `grace_minutes`. For a contestant, the end is the personal end time.
  3. Otherwise `intake_open` decides. That is today's switch, and also the manual override.
- Intake closure still blocks only new contestant submissions. Staff work and reopening are unaffected (`src/server/workflow.ts:109-118`).
- **Personal end time** is `ends_at`, plus the minutes of the entry's issue awards whose application staff confirmed, plus the minutes of confirmed contest-wide awards (`personalEndSql`). The snapshot returns it, and the browser only displays it. Minsky still changes no external clock. Staff apply minutes outside Minsky, and Minsky counts only confirmed minutes. The `apply` history text stays true (`src/server/workflow.ts:206`).
- **Contest-wide award.** The jury grants it, and support or jury confirms its external application, as with issue awards. A repeated grant with the same request ID inserts nothing (`UNIQUE (actor, request_id)`), and the server checks that receipt first. A new request ID cannot repeat a pending size: the partial unique index `contest_awards_unconfirmed` on `(session_id, minutes) WHERE applied_at IS NULL` allows one unconfirmed award of each size in a contest, whoever granted it (409, "An award of this length is waiting for confirmation."). A reload or an edited explanation after a lost response therefore records no second award. A repeated confirmation finds `applied_request` equal to its own request and succeeds without a write.
- **Withdrawing a contest-wide award.** Migration `0021` adds `withdrawn_at`, `withdrawn_by`, `withdrawn_name`, and `withdrawn_request`. A jury member runs `{ type: 'withdraw', awardId }` on an award that nobody confirmed. The row stays, so the history is complete, and the award gives no time, because only a confirmed award adds minutes. A contestant reads only confirmed awards, so never reads a withdrawn one. Staff read withdrawn awards, with who withdrew them. The command is idempotent: a repeat with the same request ID and actor returns the award without a second write, and any other request gets 409 ("Someone already withdrew that award."). It writes an `admin_audit` row `contest_award_withdrawn` and notifies the staff and every team, like a grant. An archived event refuses it. The trigger `contest_award_fixed` now also freezes a withdrawn row, and `contest_award_outcome_changed` and `contest_award_outcome_inserted` refuse a half-written withdrawal and an award that is both confirmed and withdrawn. So a confirmed award can never be withdrawn and a withdrawn award can never be confirmed, even by a direct write. A confirm and a withdraw that race let one win, because each `UPDATE` requires the other column to be empty, and the loser fails its own guard. The index `contest_awards_unconfirmed` keeps its name and gains `AND withdrawn_at IS NULL`, so a withdrawal frees the size. The name stays because the guard in `migrations.mjs` accepts a dropped index only when the same file creates the same name again, and no code reads the name (the grant matches the violated columns). The previous Worker, after a rollback, lists a withdrawn award as waiting. Its confirmation of that award fails on the trigger, and a grant of a freed size works. `schedule.test.ts` runs those statements.
- **Withdrawing an issue award.** Migration `0025` adds `withdrawn_at`, `withdrawn_by`, and `withdrawn_name` to `awards`. A jury member runs the workflow command `withdraw_award` on an award that nobody confirmed. The row stays, and a withdrawn award gives no time. `issue_id` and `resolution_id` stay `UNIQUE`, because SQLite cannot drop a column constraint without a table rebuild. So an issue with a withdrawn award cannot take a corrected award.
- **Time zone.** The server stores instants only. The browser converts the event-local wall time with `zonedWallTime` and formats with `formatInZone`. A DST gap moves forward, and an overlap takes the earlier instant.

A local behavior check shows a running contest open, a contest in grace open, an ended contest closed, an override that cannot open a waiting live contest, and a contestant with 20 confirmed minutes who may still report.

### Live password rule

A live contest's intake stays closed until every contestant seat in it holds a completed password issued for it. That is the 2026-10-25 rule. `issueCredentials` is the only way to make a password.

**`forContests` has one definition.** It is the set of live contests that a new password opens. The server derives it per account with `forContestsSql`. The set holds the live contests of the account's entries whose window overlaps the window of the target contest. A window runs from the scheduled start to the scheduled end plus grace. Every live contest has a schedule, because the `kind` column CHECK requires one. The request names only the target contest. The organizer cannot widen or narrow the set.

The rule has these consequences:

- One issue serves overlapping live contests that share a sign-in. A local behavior check shows that an issue for "Live 1" covers the overlapping "Live 2" and both become ready.
- An issue never opens a later live contest that does not overlap. An issue on day 1 for "Live 1" does not open "Live 3" on day 3, so "Live 3" gets its own fresh password. A "not ended" rule would break that. A contest that starts exactly at the end plus grace does not overlap.
- An issue is refused when it would sign a contestant out of a contest outside the set whose intake is open now. That is the earlier Rule 3, restated for automatic intake. When two open contests block each other, the refusal tells the organizer to close one contest and then issue.
- A contestant's own forced change keeps the scope. A reset by either Worker ends it, and the contest closes until reissue.
- Each scope records the target contest's window at the issue. A schedule move that no longer overlaps that fixed window ends the scope and recounts `unready_seats`, in a D1 trigger. So a postponed contest does not open with old passwords, and small repeated shifts cannot walk away from an issue. An end extension or a shift that still overlaps keeps the scope.
- A move that would end scopes while the new window still holds the current time, on a contest that is open, gets 409. The organizer closes reporting first. A move that ends the running period is allowed, because the organizer can see that it stops the contest.
- `assign_entrants` and `add_entrant_sign_in` get 409 when they would close an open live contest, unless the request carries `closeReporting: true`. The batch repeats the check. The console asks first, names the number of teams, tells every team when the contest closes or opens, and then opens the issue sheet for the new sign-ins. An entrant without a sign-in adds no seat, so that assignment does not ask.
- An issue gets 409 when the account holds a scope for a live contest that has not ended and that lies outside `forContests`, unless the request carries `voidLivePasswords: true`. The console preview says "These passwords stop working for: ...", and only then sends the flag. A stale preview therefore gets the refusal. `recoveryContest` names an open contest, then the entrant's next live contest.
- `memberships.account_id` is fixed by a trigger, because the count keys on it. No Worker writes it.
- The hash runs before one batch that holds every write, so an interrupted issue leaves the old password valid. Readiness never shows a gap.
- `unready_seats` is not in `session_changes`. A credential issue therefore does not fail in-flight staff commands. The submit batch re-checks intake through its dependency value.

### Calendar

`Workflows.contests(query)` serves both the picker and the calendar. It takes an event, or a time window. Members see every contest of their own event, with `seat: null` for contests that they cannot open. Webmasters see every event's contests in the window. There is no public listing. The calendar groups contests by event and day in the event's time zone, and marks the intake state and the caller's seat.

### Webmaster dashboard and event console

- `Management.site()` returns the site dashboard data, and `Management.event(eventId)` returns the event console data (`SiteOverview` and `EventConsole` in the [type sketch](event-platform-sketches.md#type-sketch)). Each is a single read.
- Every change goes through `Management.execute(requestId, command)` with one command union. Site, event, account, and contest commands share one receipt table, one guard, one audit path, and one outbox helper.
- Credentials go through `Management.issueCredentials` in batches of eight. A lost response returns the account IDs without passwords on replay, and the sheet offers **Issue again** for exactly those.

### Event deletion

The goal is a deletion that is complete across D1, R2, and Durable Objects, safe to repeat after a crash at any point, and unable to remove or rewrite another event's records. A legacy seat that crosses events can cause two small writes outside the event. Item 4 names them.

1. **Fence.** One batch, run by a webmaster after a typed confirmation of the event's name, or of its code when it has no name (`fenceStatements` in the [type sketch](event-platform-sketches.md#type-sketch)):
   - It inserts the journal row (`event_deletions`, step `rows`) and captures the targets by `event_id`. The targets are the contests, the accounts (never a NULL-event account), and the avatar owners.
   - It sets `events.archived = 1`. Both Workers already refuse writes for archived events: every write requires `Authority.writable` in `src/server/adapters/cloudflare/authority.ts`, and `D1ApplicationStore.commit` in `src/server/adapters/d1/store.ts` asserts `current.archived = 0`.
   - It deletes the legacy `installation` row when the row names this event, its contest, or its account, because the row would otherwise block the delete (`src/server/adapters/d1/migrations/0008_installation.sql:5-7`).
   - It revokes the logins of the event's accounts, and queues one `staff` outbox row for each contest so that open sockets close. The command's `commit` writes the one site audit row in the same batch.
   - From this batch on, the resolvers and sign-in refuse the event through `NOT EXISTS event_deletions`. A repeated fence fails its assertion and changes nothing.
2. **Advance** (`advanceDeletions`, from `waitUntil` and the minute cron). A lease claims one deletion at a time. Each step is bounded and idempotent:
   - `rows` (`advanceRows`). For each contest, it deletes one chunk of one activity table per unit, at most 100 issues or 1,000 outbox rows, then the contest row. Then it deletes at most 100 accounts per batch, with their avatar rows, `ba_user` rows, and limiter keys. It then reconciles the targets. Last it deletes the site receipts that name the event, the `events` row, and the `handle:<eventId>:` key range.
   - `live`. A Durable Object `/erase` runs for each contest.
   - `files`. R2 lists and deletes the prefixes `<contestId>/` and `accounts/<id>/`. A final empty listing must come at least 65 minutes after the rows are gone.
   - `done`. The targets go, and the journal row stays as the site record.
3. **Guards.** `0024` adds the three delete guards. A row of an event, a contest, or an event account disappears in D1 only while that event's journal is in step `rows`. The journal moves forward one step at a time and keeps naming the same event (`event_deletion_step_order`, `event_deletion_fixed`). So each guard opens once per event and closes for good. It refuses an ad hoc `DELETE` from any Worker version, a test, or a console. A site account is never deleted this way. `eventDeletion.test.ts` checks each refusal, a site account during an open deletion, and another event's rows during an open deletion.
4. **No other event's record is removed or rewritten.** Every delete names target IDs or prefixes derived from them, and the receipt match reads the ID fields of a receipt. Activity keys into `accounts` stay `NO ACTION`. If a legacy account acted in another event, the account batch fails on a foreign key, records `blocked`, and stops. A seat, a receipt, a credential scope, or a scoped operation in another event has a cascade key instead, so an assertion in the batch does the same. Neither cascades into the other event. The account batch deletes an operation between two accounts of this event only when the operation names no contest. An operation that names a contest in another event stays and blocks, also when no audit row names it, because `0009` added that audit with no backfill. `eventDeletionLegacy.test.ts` shows this. The event stays fenced, the dashboard names the account, and the deletion tries again every hour. It finishes when the other event's rows no longer name the account. Any other way to finish it needs an owner decision, because it would change the other event's history (see the risks). Two deletions block each other for good when operations that name no contest run in both directions between an account of each event, because neither event's contests can take those rows away. The operator guide gives the one statement that frees both, and `eventDeletionLegacy.test.ts` shows it.
   Two harmless writes still reach outside the event through a legacy seat, and tests pin both. For an account of this event with a login and an inert seat in another event, the fence's login revocation runs `login_access_notifications`, which adds one `audience_sequences` row and one `notifications` row for `account:<id>` to the other contest. For an account of another event with an inert seat here, the seat's delete moves that account's `access_version` once for each row that goes. A seat with two roles moved it by 3.
5. **Coverage.** `eventDeletionCoverage.test.ts` seeds two events with every writer and deletes one through `fenceStatements` and `advanceRows`. It compares the contents of every table with the database that held the other event alone. It reads `sqlite_master`, `pragma_foreign_key_list`, and `pragma_table_info`, so it keeps no table list by hand. It fails when any table that references events, contests, or accounts, directly or through another such table, holds no seeded row. It also fails when a table has a column that names an event, a contest, an account, or an issue, a team, or another row under one of those, and the seed leaves the table empty or no foreign key chain reaches it. Five tables outside the chains are listed with a reason. After the deletion, exactly these rows may differ: the journal row, the event's targets, and the one `authority_audit` site row of the audited join. The site setting's `version` may move, because seeding moves it. The webmaster's `access_version` may move, because seeding moves it and the deletion moves it again. The deletion moved it by 2 for the webmaster's seat and contest grant, which went with their contests. No other column of those rows may differ.
6. **Cost.** `0023` indexes every foreign-key child. Without these indexes, each account delete would scan every event's history. A local measurement recorded 11,363 ms for one event at N = 80,000 without one of these indexes. That was local SQLite, not D1. An earlier seed without an outbox measured 3,814 ms, 46.9 million rows read, and 757 ms in one statement without the child indexes. `npm run perf:deletion` now seeds the outbox at the ratio that `store.ts` writes, 140,000 rows for 80,000 history rows, with 2,000 audit rows and 21,000 site receipts. With the indexes and the chunks, the final three runs measured 901 to 933 ms of server time, 916,381 rows read, 253,387 rows written, 533 calls, and 21 to 27 ms for the slowest statement, beside an equally large event, at a load average near 4. The slowest statement deletes 100 issues, and it writes 4,350 rows with its cascade. The largest write is the fence's `UPDATE logins`, which wrote 12,000 rows through its trigger in 12 ms. The receipt statement of the last batch took 11 to 12 ms over 21,000 receipts. In three runs interleaved with four of the earlier form at a load average between 5 and 15, it took 13 to 29 ms, and the earlier form, which searched the text of each receipt, took 13 to 26 ms. So the field match adds no measurable time. That write grows with live logins times seats, because each revoked login writes one outbox row and one sequence for each seat of its account. It is one statement. A probe of 800 accounts with 10 live logins and 6 seats each wrote 308,800 rows in it, in 587 ms at a load average near 5 and in 1,451 ms at a higher load. Three runs of the same seed without the chunks measured 991 to 1,043 ms of server time and 89 calls, and they held the writer for 227 to 244 ms in one `DELETE FROM sessions`, which wrote 42,903 rows. A separate probe held it for 2,635 to 5,458 ms for 400,000 outbox rows in one statement, with the load on the machine as the difference. So the chunks trade six times the calls for a tenth of the longest wait. All of these runs used local D1, not hosted D1. The runs without the chunks and the probe used a machine with a load average below 3. The `events` row's cascade removes the event's `authority_audit` rows in one statement. Each row is one management command that a person sent, so this table stays small and has no chunks. On local D1, with a load average near 11, beside a neighbor that held 100,000 such rows, three runs each took 12 to 16 ms for 1,000 rows, 88 to 125 ms for 10,000, and 854 to 950 ms for 100,000.
7. **Durable Objects.** `/erase` replaces the fixture-only `cleanup()` (`src/server/adapters/cloudflare/live.ts:245-285`). It refuses unless D1 shows the contest in `event_deletion_targets` and no `sessions` row. So no request can wipe a running contest's object.
8. **Fixtures.** Every test cleanup records its own event in the journal and runs the same rows step (Phase 7). One deletion procedure then serves the product and the tests.

This is the deletion of one named event that the owner approved. It is not a shared-data reset, and it adds no persona control.

### Contest archive

Issue #116 asks for one download that keeps a contest's support record and media outside Minsky. The deletion fence makes every read of the event fail, so the archive must come before a deletion. The deletion does not wait for it (decision 6).

- **Who.** `export_contest` in `capabilityRule` (`src/connected/capabilities.ts`) admits an admin staff seat: a contest admin, an event admin, or a webmaster. `D1ContestRecordService` (`src/server/adapters/cloudflare/contestRecord.ts`) reads the seat through `contestDataSql('caller')`, so the webmaster read restriction and `notBeingDeletedSql` apply. It checks the seat again after the last read, so access revoked during the read returns nothing.
- **Unit.** One contest. An event's contests can overlap and end at different times. The delete dialog links to the event console, which has one button for each contest.
- **When.** At any time. A practice contest can have no schedule, a hand override hides the `ended` intake reason, and personal end times differ by entrant. So no single "ended" test fits every contest. The record states `exported_at`.
- **Read.** `GET /api/contest-record?sessionId=` returns JSON that parses with `contestRecordSchema` (`src/connected/contestRecord.ts`, format `minsky-contest-record`, version 1). Each table is read in keyset pages of 1,000 rows. Each row is one `json_object` text, and the Worker joins the text without parsing rows. D1 caps one value near 2 MB, so the snapshot's single `json_object` cannot hold a large contest.
- **Zip.** The browser builds the zip with `fflate`, which loads on the first click. It fetches each image through `/api/image/` and `/api/announcement-image/`, which check access before and after the R2 read. It checks each image against its stored SHA-256 digest. An image that fails stays out of the zip and is listed in `manifest.json`. A contest admin can fetch a ready image of a removed announcement, so the archive can hold it.
- **Layout.** `staff-only/` holds `record.json`, `log.html`, two CSV files, staff-only images, and images of removed announcements. `contestant-visible/` holds a log and the images that teams could see. `manifest.json` lists every file with its size and checksum.

The Worker does not build the zip because of its configured CPU limit, `limits.cpu_ms: 1000` in `src/server/adapters/cloudflare/deploy/*.wrangler.jsonc`. A stored zip costs about 1.9 ms of CPU for each MiB in local Node 22 with `fflate`, a proxy for workerd. That makes about 500 MiB the most that one request could pack. One issue can hold 120 MB of images, and no limit applies to a whole contest. A job that writes the zip to R2 would need state, cleanup, and work split across many requests. The browser path adds no new route that serves image bytes.

A local measurement of the read used a contest with 2,000 issues, 80,000 history rows, 2,000 audit rows, and 4,000 images, beside an event of the same size. Three runs took 1,385 to 1,605 ms of wall time and 103 D1 calls, read 212,555 rows, and returned 22,387,553 bytes. The Worker's own work, replayed from recorded pages without I/O, took about 80 to 120 ms of CPU and peaked at 42.8 MiB of memory above the baseline. So a record above roughly 50 to 60 MiB could exceed the 128 MB memory of an isolate. These are local numbers, not hosted D1. Four sections sort the contest's rows again for each page. A contest with 24,000 images read 900,001 rows for its image section.

### Live updates

- One Durable Object per contest stays (`src/server/adapters/cloudflare/live.ts:301`). `access()` reads `contestDataSql('logins')`, so event admins and webmasters receive the `staff` audience without a membership.
- A revocation for these derived seats has no `account:` outbox row, because the account triggers fan out over `memberships` (`src/server/adapters/d1/migrations/0014_notification_claims.sql:39-44`). Any notify in the contest re-checks every socket (`src/server/adapters/cloudflare/live.ts:221-222`), and the alarm re-checks within 30 s (`src/server/adapters/cloudflare/live.ts:151-158`).
- Schedule, intake override, and type changes notify the contest's audiences, as `setIntake` does today (`src/server/adapters/cloudflare/application.ts:259-268`).
- Time boundaries send no hint. The browser refreshes at `intake.changesAt` with 0 to 15 s of jitter, so 800 clients do not refresh in the same second. The server's gate stays authoritative.
- The event console and the site dashboard have no socket. They read on focus and after their own commands.

### What this design deliberately does not do

- It adds no problems, submissions, judging, scoreboard, payment, plans, self sign-up, email, SMTP, or public listing.
- It adds no read-only state for one contest. The earlier Phase 7 with `contest_state` is dropped, because no 2026-10-27 decision asks for it. `events.archived` stays the read-only fence.
- It rebuilds no table and drops no index. `reviewedDestructiveMigrations` stays empty.
- It never stores a password and never changes a login key.
- It runs no per-contest cron work. The cron gains one idle probe for open deletions.
- It does not change an external contest clock.
- It does not measure the 800-user target. "Risks" names the new hot-path work.

## Decision coverage

| Owner decision of 2026-10-27, or accepted assumption | Mechanism |
| --- | --- |
| Minsky stays a support desk | No new domain beyond structure, schedule, and awards. See the list of what the design does not do |
| One shared installation hosts many organizers for free; self-hosters run the same code | One Worker, one D1 database, one bucket. Isolation by `accounts.event_id`, D1 triggers, and the resolver. `bootstrapSite` serves self-hosters |
| Webmasters have full authority | `grants.scope = 'site'` resolves to `manage: 'site'` everywhere and to an admin seat in every contest |
| Webmasters create events | `create_event` at site level |
| Webmasters create and reset any account, event admins included | `create_people`, `create_entrants`, `add_webmaster`, `issueCredentials` under the webmaster branch of `manageAccountSql` |
| Webmasters delete events permanently | `delete_event`, the journal, `advanceDeletions`, and the delete guards |
| Webmasters add or remove webmasters; the last cannot be removed | `add_webmaster`, `remove_webmaster`; triggers `grant_last_webmaster` and `account_last_webmaster` |
| Webmasters see all contest data by default | An absent `site_settings` row gives `data = 1` for site grants |
| A site setting restricts reads to joined contests; the join is audited | `set_webmaster_reads`; `join_contest` writes a contest grant; D1 refuses it in open mode and writes both audit rows (`grant_join_needs_restriction`, `grant_join_audited`); enforced only in the resolver's `data` column |
| An event has one time zone and spans several days | `events.time_zone`; the span is derived from contest schedules |
| Event admins; a webmaster appoints the first; event admins add more | `grants.scope = 'event'`; `create_event.firstAdmin`; `set_event_admin` at event level |
| Every non-webmaster account belongs to one event | `accounts.event_id`, `account_event_fixed`, `membership_adopts_event`; site sign-in requires a site grant |
| A username is unique only inside its event; sign-in names the event | `accounts.handle` with `accounts_event_handle` and `accounts_site_handle`; `SignInTarget`; the login key stays globally unique for Better Auth |
| A contest is a `sessions` row; an event has many | Tables keep their names; the UI says Contest |
| Scheduled start and end, continuous, may overlap | `starts_at`, `ends_at`; no pause state; no overlap constraint; one issue serves overlapping live contests |
| Contest type: singles only, mixed, teams only | `sessions.contest_type`; `entry_fits_contest`, `contest_type_fits_entries` |
| Contest admins stay; event admins assign staff and contestants to one or more contests | Contest admin is `memberships.is_admin`; `assign_staff`, `unassign_staff`, `assign_entrants`, and `unassign_entrant` require the event level, so contest admins assign nobody (decision 2) |
| Staff switch between contests one at a time | One selected contest and one socket, as today (the subscribe effect of `useSessionSnapshot`), with `?contest=` kept across reloads |
| A team keeps one shared sign-in; a single contestant has a personal sign-in; two sign-ins for both | `entrants.kind`; one `accounts.entrant_id` per entrant; an entrant's sign-in holds only its own entries |
| The 2026-10-25 live password rule stays | `credential_scopes`, `unready_seats`, the live gate first in `intakeOpenSql`, `issueCredentials`, and the single `forContests` rule |
| Award minutes are extra time; personal end = scheduled end + confirmed minutes | `personalEndSql` counts only rows with `applied_at IS NOT NULL` |
| A contest-wide award gives minutes to every contestant of one contest | `contest_awards`, counted for every entry of the contest |
| Intake opens and closes automatically with grace and a manual override | `intake_follows_schedule`, `grace_minutes`, `set_intake` modes; derived by `intakeOpenSql` |
| Calendar of each member's own events; webmasters see every event; no public listing | `Workflows.contests(query)`; `seat: null` rows; nothing unauthenticated |
| Roles stay; announcements, categories, image limits stay per contest | No role values added; those columns and tables unchanged |
| Names become Webmaster, Event, Contest | Labels and docs; `labels.ts` maps the schema words |
| Organizers create every account; no self sign-up, payment, or plan | `disableSignUp` (`src/server/adapters/cloudflare/identity.ts:90`) stays; only `Management` creates accounts |
| The two development contest admins become webmasters | `0017` promotes the accounts named `organizer` and `playtest-admin`, and nobody on a database without them (decision 1, "Migration plan") |
| Assumption: Cloudflare only (Workers, D1, R2, Durable Objects) | All mechanisms use these four |
| Assumption: each migration works with the previous Worker; rollback keeps working | Per-file "Previous Worker" notes in the [migration sketch](event-platform-sketches.md#migration-sketch); repair triggers; the local probe; `scripts/rollback-check.mjs` in every phase |
| Assumption: the guard and reviewed exceptions | No destructive statement and no index replacement, checked locally with the repository's `destructiveStatements` |
| Assumption: development data survives | Every backfill keeps rows; promotion keeps the admins' memberships; the local probe |
| Assumption: organizer-created usernames, temporary passwords, forced change, no email | Unchanged mechanisms; synthetic `.invalid` emails stay, built from the login key |
| Assumption: no shared-data reset or persona; deletion cannot touch another event | One named event; journal targets; delete guards in D1; `NO ACTION` keys stop at the event boundary; webmasters act as themselves |
| Assumption: 800 users unmeasured; name hot-path work | Access pattern trace above; the Phase 1 gate; "Risks" |

The design keeps each behavior that `AGENTS.md` asks to preserve:

| Behavior | How it stays |
| --- | --- |
| The timer starts on submission; the first assignment is separate; elapsed time comes from persisted timestamps; refresh does not reset it | Issue columns and `unresolvedTime` (`src/connected/model.ts:199-211`) unchanged |
| The owner is kept during escalation until a specialist accepts | `decideWorkflow` unchanged except for its seat input |
| The timer stops on resolution; reopening resumes unresolved time; every summary, actor, and timestamp is kept | `resolutions` unchanged |
| Owners and actors are people; capabilities combine across roles | Roles merge per contest; the derived admin seat adds to them |
| On reopening, the owner, award, and application status stay | Unchanged |
| Public replies and internal notes stay separate; contestants never see notes | `read_internal` needs a staff seat; the `snapshotSql` history filter is unchanged |
| An award is separate from its application, and Minsky changes no external clock | Both kept for issue and contest awards; the personal end counts confirmed minutes only |
| Shared history names the authenticated actor | Unchanged; the audit records name actors |
| Repeated actions create no duplicate awards or invalid transitions | Receipts; `UNIQUE (actor, request_id)`; `applied_request`; `contest_award_fixed` |
| Isolated fixtures delete only their own records | Fixture cleanup uses the journal, whose targets are its own event; the delete guards refuse anything else |
| No shared-data reset or persona impersonation | Not added; the restricted mode uses the webmaster's own identity and an audited join |

## Module map

The design adds these files:

| File | Purpose |
| --- | --- |
| `src/server/adapters/d1/migrations/0017_scoped_authority.sql` to `0024_deletion_guards.sql` | Schema in the [migration sketch](event-platform-sketches.md#migration-sketch) |
| `src/server/adapters/cloudflare/authority.ts` | The one resolver for contest, event, and site, `authorityGuard`, `manageAccountSql`, `requireAuthority`. Only `contestDataSql` leaves the module |
| `src/server/adapters/cloudflare/manage.ts` | `D1ManageService`: `site`, `event`, `execute`, `requirementOf`, planners |
| `src/server/adapters/cloudflare/credentials.ts` | `loginKeyFor`, `forContestsSql`, `replaceCredentialStatements`, `D1CredentialService.issue` |
| `src/server/adapters/cloudflare/schedule.ts` | `intakeOpenSql`, `intakeStateSql`, `personalEndSql`, `extraMinutesSql`, `viewerExtraSql` |
| `src/server/adapters/cloudflare/contestAwards.ts` | Grant and confirm contest-wide awards |
| `src/server/adapters/cloudflare/eventDeletion.ts` | `fenceStatements`, `advanceRows`, `finishStatements`, `advanceDeletions` |
| `src/connected/capabilities.ts` | `capabilityRule` and `can`, shared by the Worker and the browser |
| `src/connected/zonedTime.ts` | Event-zone conversion and formatting |
| `src/connected/ContestPicker.tsx`, `src/connected/Calendar.tsx` | One picker replaces five; the calendar view |
| `src/site/SiteDashboard.tsx`, `src/site/useSite.ts` | Webmaster dashboard |
| `src/event/EventConsole.tsx`, `src/event/useEventConsole.ts`, `src/event/CredentialSheet.tsx` | Event console tabs and the batched credential sheet |
| `scripts/rollback-check.mjs` | Checks out the previous release (`origin/main`) into a temporary worktree outside the repository and copies this branch's migration files into it. Then it runs that release's `npm run test:d1` against the new schema. The previous release's tests then run its own writes, guards, and cleanup on the new triggers. The local probe is its model |
| Tests: `authority.test.ts` (an isolation matrix of two events, every role, and every reader), `manage.test.ts`, `credentials.test.ts`, `schedule.test.ts`, `eventDeletion.test.ts`, `eventDeletionCrash.test.ts` and `eventDeletionCrashRows.test.ts` (a crash after each write), `eventDeletionLegacy.test.ts` (rows that cross events), `eventDeletionCoverage.test.ts` (derived from `sqlite_master`, with the non-vacuous seed rule), `previousWorker.test.ts` (replays the previous Worker's statements, as the probe does), `authorityCopies.test.ts` | Behavior tests at the D1 boundary |

It changes these files:

| File | Change |
| --- | --- |
| `src/backend/contracts.ts` | Types in the [type sketch](event-platform-sketches.md#type-sketch); `Administration` removed; `sessions(userId)` becomes `contests(query)`; `signIn` takes a target and a handle; `AccountStatus.username` becomes `handle` |
| `src/server/adapters/cloudflare/application.ts` | Keeps `snapshot` and `contests`; access fragments move to `authority.ts`; admin methods move to `manage.ts` |
| `src/server/adapters/d1/store.ts`, `src/server/workflow.ts` | `workflowSql` joins the resolver; `dependency` carries the stamp and the intake value; `decideWorkflow` reads `capabilityRule` |
| `src/server/adapters/cloudflare/authentication.ts`, `src/server/authenticationHttp.ts` | Sign-in by event code or site and handle; the limiter key; account commands leave for `manage.ts` and `credentials.ts`; `createLogin` is unchanged |
| `src/server/adapters/cloudflare/http.ts`, `applicationWorker.ts` | Routes `/api/contests`, `/api/site`, `/api/event`, `/api/manage`, `/api/credentials`, `/api/contest-awards`, `/api/contest-record`; cron task `advance-deletions` |
| `src/server/adapters/cloudflare/live.ts` | `access()` through the resolver; `/erase` replaces `cleanup()` |
| `announcements.ts`, `images.ts`, `announcementImages.ts`, `avatars.ts` | Their access copies become `contestDataSql`; `PrivateBucket` (`src/server/adapters/cloudflare/images.ts:18-27`) gains `list` |
| `src/server/adapters/cloudflare/installation.ts`, `tooling/install.mjs`, `tooling/configuration.mjs` | `bootstrapSite` and `recoverWebmaster` by site handle; the competition file becomes a site file |
| `src/backend/cloudflare/backend.ts`, `src/backend/cloudflare/authentication.ts` | Client for the new routes and the sign-in body |
| `src/connected/model.ts` | Snapshot gains `access`, `clock`, `contest_awards`, `session.kind`, `session.type`; `isStaff`, `isSupport`, `uiKindFor` read `capabilities.ts` |
| `src/connected/hooks/useSessionSnapshot.ts`, `Workspace.tsx`, `ConnectedApp.tsx`, `src/screens/SignIn.tsx`, `src/screens/NoSessionAccess.tsx` | Role landing, event code, site mode, `?contest=`, the join prompt, boundary refresh |
| `src/organiser/admin/SessionSettings.tsx`, the staff panel, contestant views | Intake panel with schedule and override; a staff panel that lists the contest's staff without assignment controls, because staff assignment moves to the event console's grid; the clock |
| `queryPlans.test.ts`, `readVolume.test.ts`, `cronReads.test.ts`, `tests/connector/runtime.test.ts:256-257`, `authenticationCases.ts`, `signInLimits.test.ts`, `installation.test.ts` | New plans and ceilings; the new list shape; sign-in by event and handle (about 40 calls in `authenticationCases.ts`) |
| Every test cleanup that deletes rows directly: `src/server/adapters/d1/testFixture.ts:205-207`, `src/server/adapters/d1/store.test.ts:772`, `src/server/adapters/cloudflare/authenticationCases.ts:182`, `src/server/adapters/cloudflare/authenticationCases.ts:465`, `src/server/adapters/cloudflare/live.test.ts:630`, `tests/connector/runtime.test.ts:397-401`, `tests/connector/local-ui-fixture.ts:92-97`, `tests/auth/fixtureWorker.ts:46-48`, `tests/providers/cloudflare/fixture.ts:376-381`, `scripts/provider-test-cloudflare.test.mjs` | In Phase 7, each one records its event in the journal and runs the rows step. Fixture accounts get an `event_id`, because the guard never deletes a NULL-event account |
| `site/src/content/docs/operators/installation.mdx`, `site/src/content/docs/guides/contestants.md` | Product words, webmaster recovery, event sign-in and handles, per-contest type, automatic intake, and deletion, each in the phase that ships it. "Follow-up" lists the `AGENTS.md` change |

It deletes these items:

| Item | Reason |
| --- | --- |
| `src/server/adapters/cloudflare/adminRecovery.ts`, its test, `scripts/recover-cloudflare-admin.mjs`, `npm run cloudflare:recover-admin` | `recoverWebmaster` is the one trusted recovery |
| `recoverInstallationOwner`, `ownerCondition`, and the event, contest, and team fields of `competitionSchema` (`src/server/adapters/cloudflare/installation.ts:5-22`, `src/server/adapters/cloudflare/installation.ts:140-204`) | Recovery no longer needs an anchor contest |
| `src/server/adapters/cloudflare/credentialReset.ts` | Folded into `credentials.ts`, which also replaces the inline copies (`src/server/adapters/cloudflare/installation.ts:165-169`, `src/server/adapters/cloudflare/installation.ts:190-193`) |
| `accessSql`, `currentAccessSql`, `currentAccessForLoginsSql`, `sessionsListSql`, `adminGate`, `manageMember` (`src/server/adapters/cloudflare/application.ts:30-60`, `src/server/adapters/cloudflare/application.ts:176-183`, `src/server/adapters/cloudflare/application.ts:218-232`, `src/server/adapters/cloudflare/application.ts:412-455`); `adminCondition`, `adminAssertions` (`src/server/adapters/cloudflare/authentication.ts:189-221`) | Superseded by `authority.ts` and `manage.ts` |
| `Administration`, `/api/admin`, `/api/accounts`, `/api/sessions` | Superseded by `Management` and `/api/contests` |
| `cleanup()` and the fixture name check (`src/server/adapters/cloudflare/live.ts:245-285`); the two-ID `maintainFixtureSessions` schema (`src/server/adapters/cloudflare/live.ts:365-387`) | Superseded by `/erase` and the journal |
| `AssignByIdForm` (`src/organiser/admin/AccountForms.tsx:364`) and the five contest pickers (`src/organiser/desktop/ConsoleChrome.tsx:122-163`, `src/organiser/phone/PhoneTabs.tsx:539-565`, `src/connected/AccountSections.tsx:303-355`, `src/contestant/ContestantTopBar.tsx:82-110`, `src/screens/NoSessionAccess.tsx:99-117`) | Assignment comes from the event's lists; one `ContestPicker` |

From the earlier design, this design supersedes these statements:

- "Minsky deletes no contest data and has no data reset" (now true for everything but whole events).
- "Names and levels" and "One installation holds one organization, so the global username rule is correct".
- "Rosters", the copy roster, and `roster_key`.
- Rule 1, which is replaced by `issueCredentials` with the single `forContests` rule.
- Rule 3, which is restated for automatic intake. Rule 2 stays as the live gate.
- "One contest type per event", which becomes one type per contest.
- Manual intake, which becomes intake that follows the schedule, with a grace period and an override.
- "Authority": `admin_grants`, "A grant gives authority over structure, not access to data", and `join_session` as the default.
- "Archive" Phase 7 and `contest_state`, which are dropped.
- `organization_audit`, which becomes `authority_audit`.
- The `Setup` module, which becomes `Management`.
- The type and migration sketches, Phases 2 to 10, the earlier design's Decisions 1 and 4, and its open item on one installation per organization.

It keeps the practice and live kinds, the reason for fresh live passwords, batched credentials, and "no password is stored". It also supersedes two statements of the [product direction](product-direction.md): "Each event has one contest type", because the type is now per contest, and "Staff manually open and close contestant intake", because intake now follows the schedule.

## Migration plan

| File | What moves | How existing data survives |
| --- | --- | --- |
| `0017` | `grants`, `site_settings`, `authority_audit`, `manage_receipts`, `accounts.event_id`, isolation triggers, takeover and join triggers, promotion | The promotion inserts site grants first. Then every other account takes the event of most of its memberships. Accounts with none take the bootstrap event. No row is deleted. Promoted accounts keep their admin memberships, so they still work as contest admins under the previous Worker |
| `0018` | `events.code` (random `e` + 16 hex), `events.time_zone`, `accounts.handle`, the two handle indexes | Every account with an event or a site grant gets `handle = username`. Usernames were globally unique, so the handle indexes cannot fail. `accounts_username` and `ba_user` are not touched |
| `0019` | `entrants`, `teams.entrant_id`, `accounts.entrant_id`, `contest_type`, roster triggers | One entrant per normalized team name per event when the teams share a contestant account, else one per team. Merged team names take the entrant's spelling, which differs only in case and spaces. Accounts link to the entrant of their oldest team in their own event |
| `0020` | Schedule columns, `contest_awards` | Existing contests have no schedule and keep manual intake |
| `0021` | Contest-award withdrawal columns and triggers | Existing awards stay as they are |
| `0022` | `kind` (default practice), `credential_scopes`, `unready_seats` | Existing contests are practice, so nothing that is open closes. No scope is backfilled, because only a live contest reads one |
| `0023` | Deletion journal, targets, foreign-key child indexes | Indexes only add entries |
| `0024` | Delete guards on `events`, `sessions`, `accounts` | No data statement |

`0020` comes before `0022` because the live password rule needs schedules. `0024` is separate from `0023` because the previous release's test cleanup deletes rows directly (`src/server/adapters/d1/testFixture.ts:205-207`). So `scripts/rollback-check.mjs` for `0023` must still run that cleanup. From `0024` on, the previous release cleans up through the journal.

**Promotion of the two development accounts.**

- **Rule.** `0017` gives a site grant to the accounts whose username is `organizer` or `playtest-admin`, by name (decision 1). Usernames are globally unique (`src/server/adapters/d1/migrations/0003_authentication.sql:5`), so the rule matches at most two accounts. A matching account must also be a contest admin and hold no team seat. So a self-hosted team or volunteer that uses one of these names is not promoted. On a database without them, it promotes nobody. `organizer` is the development webmaster. The owner supplied `playtest-admin`. The repository does not mention it, and it passes the username CHECK (`src/server/adapters/d1/migrations/0003_authentication.sql:2-4`). No count or query runs before the merge.
- **Reach.** `0017` runs on every database that applies the repository's migrations. These are all of them:
  - `minsky-development`, through the `minsky-dev` Workers Builds trigger after the merge (`AGENTS.md:65`). It promotes `organizer` and `playtest-admin`.
  - `minsky-preview`, when an agent applies migrations to it. It holds only test data. An account there with either username becomes a webmaster.
  - The CI target database of the hosted connector suites. Fixture usernames start with `pc-` (`tests/providers/cloudflare/fixture.ts:127`), so nobody is promoted. A local probe shows that a contest admin with another username stays an event account.
  - Local test databases (`npm run test:d1`, `npm run test:auth`) apply every migration to an empty database first, so nobody is promoted.
  - A future `minsky-prod` database starts empty, so nobody is promoted.
  - A self-hosted installation that upgrades promotes an account with either username. The example installation file names its admin `organizer` (`src/server/adapters/cloudflare/tooling/competition.example.json:2`). A self-hoster who chose another name gets no webmaster (see the risks).
- **Accounts with memberships in several events.** Each such account takes the event of most of its memberships. Its memberships in other events become inert under the resolver. On `minsky-development`, every contest is in the bootstrap event, because only bootstrap creates events today (`src/server/adapters/cloudflare/installation.ts:119`).
- **After the merge.** The two webmasters sign in with **Site sign-in** from Phase 3. Until then they sign in exactly as before, because their handle and login key equal their old username.
- **Bootstrap never creates more than one webmaster.** Until Phase 4, bootstrap keeps its shape (`src/server/adapters/cloudflare/installation.ts:86-138`). From Phase 2, it also inserts the site grant for its one account before that account's admin membership, so the account stays a site account. From Phase 4, `bootstrapSite` creates exactly one webmaster and nothing else.

The deploy prints a D1 Time Travel bookmark before it applies migrations (`scripts/deploy-workers.mjs:256-264`). A restore discards every organizer's later writes on a shared installation, so the bookmark is a last resort. The designed recovery is a Worker rollback, which every file supports. It is unknown whether `wrangler d1 migrations apply` wraps a file in one transaction. A file that stops halfway cannot simply run again, because its `CREATE` statements would fail. So each file is rehearsed before its pull request is ready (see the risks).

## Delivery phases

Each phase is one draft pull request into `main`, on a branch `feature/<title>` started from updated `main`. Every phase runs these checks:

- `npm run ci`, `npm run test:d1`, and `npm run test:connector:runtime`.
- `node scripts/rollback-check.mjs`, from Phase 1 on.
- The focused tests named below.
- `npm run test:e2e` and `npm run test:connector:ui:local` when a screen changes. Browser and hosted checks stay manual commands.

To revert a phase, revert its pull request. The previous Worker then runs against the newer schema. That is the rollback case that each migration's "Previous Worker" note describes, and that `scripts/rollback-check.mjs` tests. Rows written by the reverted feature stay inert.

The [type sketch](event-platform-sketches.md#type-sketch) shows the final shape. Each phase ships only the clauses whose tables exist by then:

| Clause | Enters in |
| --- | --- |
| Resolver with grants, `site_settings`, `data`, `manage`, `stamp`; `entrant_kind` is the constant `'team'` | Phase 1 |
| `/api/sessions`, `/api/admin`, `/api/accounts` served through the resolver and `manageAccountSql`; `/api/sessions` still returns `[{id, name}]` (`tests/connector/runtime.test.ts:256-257`) | Phase 1, deleted in Phase 4 |
| `issueCredentials` without `forContests` and without scopes | Phase 2 |
| Sign-in by event code or site and handle; `loginKeyFor` for new accounts; `set_handle` | Phase 3 |
| Resolver with `entrant_kind` from `entrants`; `/api/contests` with `{eventId}` | Phase 4 |
| Schedule terms in `intakeOpenSql`; `/api/contests` with `{window}` | Phase 5 |
| The live gate in `intakeOpenSql`; `forContestsSql`; `credential_scopes` | Phase 6 |
| `NOT EXISTS event_deletions` in the resolvers and in sign-in | Phase 7 |

1. **`feature/scoped-authority` (migration `0017`). Riskiest unknown first.** It touches every read and write path, adds work to the hot path, and is the only phase with a data migration on development accounts.
   - **Scope, in commit order.**
     1. `authority.ts` behind today's exports `currentAccessSql` and `currentAccessForLoginsSql`, with `queryPlans.test.ts` and `readVolume.test.ts` updated.
     2. The gate measurement below. The gate decides before the next commits are written.
     3. `scripts/rollback-check.mjs`.
     4. The resolver replaces every copy of the access check: `workflowSql`, live `access()`, `adminCondition`, and the client gates through `capabilities.ts`.
     5. The promotion of `organizer` and `playtest-admin`.
   - **The gate.** It runs in two places:
     - Locally, `npm run perf:reads -- --plan=full --out=<file>` runs on `main` and on the branch, three repeats each, on the same fictional seed.
     - On `minsky-preview`, the `main` Worker and then the branch Worker are deployed to a `minsky-preview-*` Worker, with a preview Wrangler configuration that names only `minsky-preview` resources. The load tool accepts only such targets (`scripts/load/fixtures.mjs:55-61`). Each Worker runs `npm run load -- run --steps=50,200 --step-seconds=120` twice, then `npm run load -- analytics`. Agents may manage these preview resources (`AGENTS.md:50-51`).
   - **Threshold.** All four must hold:
     - Every request type reads at most 10 more rows than on `main` in `npm run perf:reads`.
     - Every ceiling in `readVolume.test.ts` holds unchanged, for example the contestant snapshot under 130 rows (`src/server/adapters/d1/readVolume.test.ts:267`) and each command under 60 (`src/server/adapters/d1/readVolume.test.ts:371`).
     - At the 200-user step, the p95 latency of snapshot reads and of issue submits grows by at most 10 percent over the `main` Worker. The comparison uses the better of the two runs of each Worker, because hosted p95 is noisy.
     - D1 rows read per request, from the analytics, grow by at most 10.
   - **Fallback if the gate fails.** The fallback is a per-login authority cache keyed by the stamp:
     - The Worker keeps the parsed `Authority` for each (login, contest) in isolate memory, with its stamp.
     - Reads with a cache entry embed `stampSql`, which reads only the counters of the stamp, and bind the cached seat. A stamp mismatch inside the statement returns no access row. The Worker then resolves again and retries once.
     - Every grant, membership, role, login, contest, event, and setting change moves a counter in the stamp. So a hit returns exactly what a full resolve returns.
     - Writes keep `authorityGuard` unchanged, so the cache never widens a write.
     - It saves the two grant probes, the role aggregate, and the entrant lookup per read. That saving is an estimate, not a measurement.
     - These tests then change. `queryPlans.test.ts` pins the stamp form's plan, `readVolume.test.ts` gains ceilings for a hit and a miss, `authority.test.ts` runs its isolation matrix cold and warm, and a new `authorityCache.test.ts` shows that each stamp counter forces a miss and a fresh answer.
     - If the cache also fails the gate, the phase stops and the owner decides between the membership projection in "Alternatives considered" and a slower request path.
   - **Focused tests.**
     - `authority.test.ts`: two events, every role, every reader, restricted on and off, and an assigned webmaster without a join.
     - `authorityCopies.test.ts`.
     - `previousWorker.test.ts`, including the takeover refusal on a one-contest site.
     - The existing `authenticationCases.ts` and `store.test.ts`.
     - `npm run perf:reads`.
   - **Browser test.** A promoted webmaster opens the development contest as before (`npm run test:e2e`).
   - **Revert.** The previous Worker ignores `grants`. Promoted admins keep their memberships. The takeover and isolation triggers stay and only refuse writes that were already unsafe.
2. **`feature/webmaster-management` (no migration).**
   - **Scope.** A first `manage.ts` with `/api/manage` for `add_webmaster`, `remove_webmaster`, `set_webmaster_reads`, and `join_contest`. `/api/credentials` (`issueCredentials`), so that a new webmaster gets a password. `recoverWebmaster`. Bootstrap marks its one account as a webmaster. The join prompt and the Webmasters screen.
   - **Focused tests.** `manageSite.test.ts` for the site commands. The join is refused in open mode, and D1 writes both audit rows. The last webmaster. Receipts on retry. `installation.test.ts`.
   - **Browser test.** A webmaster turns the restriction on, joins a contest, and sees the audit row.
   - **Revert.** Grants and settings rows stay. The previous Worker ignores them.
3. **`feature/event-sign-in` (`0018`).**
   - **Scope.** Event codes, time zones, handles, `loginKeyFor` for new accounts, sign-in by event code or site and handle, the limiter key, `set_handle`, and the sign-in form with the event code and site mode.
   - **Focused tests.**
     - The same handle in two events signs in to the right account.
     - A wrong event code gives 401.
     - An unknown handle never reaches Better Auth.
     - A legacy account signs in with its old username as handle.
     - The previous Worker's lookup still finds one row through `accounts_username`.
     - The limiter is per event.
     - A handle change keeps an open session.
     - `npm run test:auth`, `signInLimits.test.ts`.
   - **Browser test.** A contestant signs in from `?event=`. A webmaster signs in with **Site sign-in**.
   - **Revert.** Legacy accounts sign in to the previous Worker as before. Accounts created in this phase have a login key that nobody types, so they cannot sign in until roll-forward. A legacy account whose handle changed in this phase signs in to the previous Worker with its old username.
4. **`feature/event-console` (`0019`).**
   - **Scope.**
     - Entrants, entries, assignments, and contest type.
     - `Management.site`, `Management.event`, and the event, account, and contest commands in `execute`, including `assign_staff` and `unassign_staff` at event level.
     - The dashboard, the console, `create_event` with the first admin, and `bootstrapSite`.
     - `/api/contests` with `{eventId}` and one `ContestPicker`.
     - The last callers move off `/api/admin`, `/api/accounts`, and `/api/sessions`, which are deleted in the same pull request.
   - **Focused tests.**
     - `manage.test.ts`: every command's requirement, cross-event refusals, a contest admin refused `assign_staff` in the own contest, and receipts on retry.
     - The roster triggers through the previous Worker's `add_teams`, `update_team`, and `save_member`.
     - Type guards.
   - **Browser test.** An event admin creates a contest, imports entrants, and assigns them, and a contestant opens the contest. An event admin adds a volunteer of the event to a contest.
   - **Revert.** The previous Worker's roster edits still work through the repair triggers.
5. **`feature/contest-clock` (`0020`).**
   - **Scope.** Schedules in the event zone, derived intake with grace and override, personal end times, contest-wide awards, the calendar with `/api/contests` `{window}`, and the boundary refresh with jitter.
   - **Focused tests** (`schedule.test.ts`, with D1 time moved by writing schedules relative to now):
     - Before start, running, grace, and after end.
     - The personal extension, counting confirmed minutes only.
     - A submit that crosses the close retries and is rejected.
     - A repeated award grant and confirmation.
     - Overlapping contests.
   - **Browser test.** The contestant clock and the closed-form message. Manual phone-width checks of the volunteer screens.
   - **Revert.** Scheduled contests act manual under the previous Worker.
6. **`feature/live-credentials` (`0022`).**
   - **Scope.** Contest kind, `forContestsSql` and `credential_scopes` in `issueCredentials`, `unready_seats`, the live gate, the batched live sheet, and confined reissue by contest admins.
   - **Focused tests.**
     - A live contest stays closed until the last seat is issued.
     - An override cannot open it.
     - A self change keeps readiness.
     - A reset by either Worker closes it.
     - Overlapping live contests share one issue, and a later live contest that does not overlap does not.
     - An issue that would sign a contestant out of an open contest is refused.
     - A lost response replays without passwords.
     - `npm run test:auth:hash` for the per-batch CPU.
   - **Browser test.** Issue live passwords and watch the readiness count reach zero.
   - **Revert.** Readiness columns stay. The previous Worker ignores them, so after a Worker rollback a live contest opens without the password gate. D1 does not enforce the gate. Organizers must close live contests before a rollback.
7. **`feature/event-deletion` (`0023`).**
   - **Scope.**
     - `delete_event`, `advanceDeletions` with the lease and the cron task, the `event_deletions` fence in the resolvers and in sign-in, `/erase`, `PrivateBucket.list`, and the dashboard progress.
     - Every test cleanup in the module map moves to the journal.
     - `eventDeletionCoverage.test.ts`.
   - **Focused tests** (`eventDeletion.test.ts`, `eventDeletionCrash.test.ts`, `eventDeletionCrashRows.test.ts`, and `eventDeletionLegacy.test.ts`):
     - A crash injected after each step, then the run repeated.
     - A second event's rows, objects, and Durable Object state untouched.
     - A legacy cross-event actor gives `blocked`, not a cascade.
     - The cron idle cost stays within the budget of `src/server/adapters/d1/cronReads.test.ts:210-212`.
     - A deletion of a 2,000-issue event with 80,000 history rows and 140,000 outbox rows, timed locally and on `minsky-preview`, with the indexes.
     - `PrivateBucket.list` on `minsky-preview-images`.
   - **Browser test.** A webmaster deletes a fixture event and sees "Deleted".
   - **Revert.** The previous Worker treats a fenced event as archived. Its sign-in has no fence, so members can sign in and read a half-deleted event until the new Worker returns. A login that it creates stays live after that. The new Worker's session read and avatar upload accept it until the login expires or the rows step deletes the account, whichever comes first. A blocked deletion keeps the account, so then only the expiry ends it. A password change through such a login commits its new password, and its new login is refused. An unfinished deletion pauses until roll-forward, and its journal stays intact.
8. **`feature/deletion-guards` (`0024`).**
   - **Scope.** The three delete guards. Nothing else.
   - **Focused tests.** An ad hoc delete of an event, a contest, or an event account is refused. A site account is never deleted. The rows step of one event cannot delete in another. `eventDeletionCoverage.test.ts` still passes through the guards. `scripts/rollback-check.mjs` runs Phase 7's `npm run test:d1`, whose cleanup already uses the journal.
   - **Browser test.** None. No screen changes.
   - **Revert.** The guards stay in D1 and only refuse deletes that bypass the journal. The previous Worker never deletes these rows in production code.

## Tradeoffs accepted

- The design accepts two storage tables for authority (`grants` and `memberships`) under one resolver, in exchange for no rebuild and a previous Worker that keeps working. A single physical grants table is the cleaner picture, but it would not change any answer that the resolver gives.
- The design accepts two names for one account, the handle and the login key, in exchange for a rollback whose sign-in keeps its unique index and never meets two rows. Branded types keep the two names apart in code.
- The design accepts that a lower-authority rule lives in two places. `manageAccountSql` holds the full rule. `account_operation_takeover` holds its core in D1 for every Worker version. The trigger is a floor, and the tests check that both agree on the takeover cases.
- The design accepts `unready_seats`, a count that D1 keeps exact through five triggers, in exchange for an intake check that reads one column. Counting up to 800 seats on every contestant snapshot is the alternative. The count has one writer (D1), a `CHECK` that fails loudly on drift, and a test that recounts after random seat and scope changes.
- The design accepts `teams.name` as a two-way projection of `entrants.name`, in exchange for unchanged readers and a previous Worker whose renames stay correct.
- The design accepts 49 new triggers and three same-name replacements, in exchange for invariants that no Worker version and no future caller can bypass. Each trigger states one rule in its name and message.
- The design accepts hashing before a single credential batch instead of today's two batches, in exchange for an issue that is atomic and a live contest that never shows a gap. An interrupted issue now leaves the old password valid instead of the account locked.
- The design accepts that the organizer cannot choose the contests that a live password opens. Narrowing the set would only produce a later refusal, and widening it would break "each live contest gets fresh passwords".
- The design accepts that deletion safety arrives in two releases. The journal comes first, and the guards come one release later. In exchange, `scripts/rollback-check.mjs` stays meaningful for both releases.
- The design accepts rollback degradation for new data only:
  - Accounts created after Phase 3 cannot sign in to the previous Worker.
  - A legacy account whose handle changed signs in to the previous Worker with its old username.
  - Scheduled contests act manual.
  - A live contest closes after its resets until reissue.
  - Contest admins can assign staff again, because the previous Worker's `manageMember` keeps the contest-level rule (`src/server/adapters/cloudflare/application.ts:422-455`). The isolation trigger still refuses an account of another event.
- The design accepts one index write per history row, issue, resolution, award, and receipt (`0023`), in exchange for a deletion that does not scan other events.
- The design accepts that a revocation for a derived seat reaches an open socket within 30 s through the alarm, not through the outbox.
- The design accepts that a contestant with confirmed extra minutes may report until their personal end plus grace. That follows "extra contest time" literally (decision 4).

## Alternatives considered

- **A membership projection.** Webmasters and event admins would become derived `memberships` rows, kept equal to a view by sixteen triggers. The access SQL and its plans would stay unchanged. It stores W x M rows that the resolver derives. It needs five replaced notification triggers and a second gate for the control plane. A restriction flip writes up to W x M rows in one statement. Its reader load is high. It stays the second fallback of the Phase 1 gate.
- **One `grants` table for every scope, contest staff included.** The surface would be smaller on paper. It would expose a rebuild of `memberships` and `membership_roles`, fifteen readers of the previous Worker, and the account notification fan-out. The resolver already hides the difference, so it loses on cost with no gain in interface depth.
- **A same-name replacement of `accounts_username` by `(COALESCE(event_id, ''), username)`.** An earlier draft of this design used this shape. It passes the guard. After a rollback, the previous Worker's lookup scans `accounts` and can meet two rows for one name. Rejected for the handle and login key split.
- **Event-qualified Better Auth usernames such as `xxxx-2026.team01`.** These break the 32-character limit (`src/server/adapters/cloudflare/identity.ts:120`) and need a rename on every code change. The UUID login key hides the namespace completely.
- **Membership-only access with `join_session` (the earlier design).** The access check would stay unchanged. Every webmaster read would then need a copied admin membership per contest, which is state to sync. It contradicts the owner's new default of full visibility.
- **An intake flag flipped by the minute cron.** This stores a derivable value, lags up to 60 s, needs an audit actor (`src/server/adapters/d1/migrations/0006_application.sql:17`), and breaks with overlapping contests. Derivation in SQL has no state.
- **A clock view in D1 (`contest_clock`).** One view would hold the rules for all readers. It cannot take the contestant's entry as a parameter, so the personal end time would need a second view per entry. The SQL fragments in `schedule.ts` take the entry and are tested through the same checks.
- **Entrant equals account (no `entrants` table).** It fails for teams without a sign-in yet, for old teams with several sign-ins, and for the previous Worker's `add_teams`, which creates the team before the account.
- **Delete guards in the same release as the journal.** One release fewer. `scripts/rollback-check.mjs` would then run the previous release's direct-delete cleanup against the guards and fail on a cleanup step that production never runs.
- **A database per event.** The owner chose one shared installation. Cross-event webmaster reads and the calendar would need fan-out reads. The design keeps the option open, because every query is scoped to one event.

## Decisions

The owner made these decisions on 2026-10-27, after the first draft of this design:

1. **Promotion.** `0017` promotes exactly the accounts with usernames `organizer` and `playtest-admin` to webmasters, by name, when each is a contest admin with no team seat. On a database without them, it promotes nobody. This replaces the earlier rule, every contest admin of the installation event, and the owner's read-only count before the merge.
2. **Who assigns people.** Event admins and optional contest admins both stay, with no setting. Only event admins and webmasters create accounts and assign people, entrants and staff, to contests. A contest admin manages only their own contest: settings, categories, announcements, the intake override, the issue workflow, and confined password reissue and handle change. A contest admin no longer adds or removes staff. An event that wants no contest admins assigns none. This design reads team locations and image limits as contest settings, so `set_location` and `set_image_limits` stay at contest level. It reads a contest's name, type, and schedule as event structure, so `update_contest` stays at event level. The owner can move either.
3. **The override and the live gate.** **Open now**, **Close now**, and **Return to schedule** cannot open a live contest whose seats are not all ready. The live gate comes first in `intakeOpenSql`.
4. **Reporting after the scheduled end.** A contestant with confirmed extra minutes may report until their personal end plus grace.
5. **Single contestants.** They follow the live password rule, as teams do.
6. **Deletion and export.** An event deletion does not wait for the contest support log export (issue #116). The typed confirmation names what is lost. The [contest archive](#contest-archive) now exists, and the delete dialog links to the event console, where admins download it.
7. **Contest-wide awards.** They have no recipient exceptions. Each award gives minutes to every entry of the contest.
8. **Existing contests.** Every existing development contest becomes a practice contest. The kind is fixed.
9. **A webmaster's join.** It persists when the restriction is switched off and on again, because it was audited. A new join is refused while the restriction is off.
10. **The sign-in screen.** It does not show the event name, so it makes no unauthenticated lookup by code.
11. **Contest kinds.** Practice and live stay beside the contest types. The live password rule needs them.
12. **Member lists.** Webmasters do not appear in a contest's member list. The member list shows assigned members, and the audit shows joins.
13. **Deletion progress.** A deletion shows "done" after 65 minutes. That covers upload reservations that live 3,600 s (`src/server/adapters/d1/migrations/0006_application.sql:34`).
14. **Own handle.** Decided 2026-11-01. A staff account, admins included, may change its own handle with `set_handle` in Phase 3. A contestant account may not, because its handle is printed on the credential sheet that venue staff use. No setting controls this. Today `set_username` only assigns a username to an account that has none (`src/server/adapters/cloudflare/authentication.ts:238`), so nobody can rename an assigned username before Phase 3.
15. **Sign-in timing gap.** Decided 2026-11-04. The owner accepted the remaining timing gap of Phase 3 sign-in. A real handle with a wrong password is refused about 26 ms slower than other refusals (local medians, real hasher), because only that path reaches the database reads of Better Auth. An attacker needs the event code first, and the failure limits apply. No code change follows.

The owner made these decisions on 2026-11-05, during the review of Phase 4:

- **Seat move after a revert.** Accepted. The previous Worker's move of a seat to another team is refused after a revert, and it fails closed. The one `store.test.ts` rollback failure stays as a recorded known failure. `scripts/rollback-check.mjs` does not change.
- **Admin commands above 60 rows.** Accepted. Occasional admin commands may exceed the 60-row target with their own ceilings. Hot-path workflow commands stay under 60. The 300-entrant hosted measurement is still reported.
- **Last event admin.** Accepted. The last event admin can be removed, because a webmaster can appoint another.
- **Picker start times.** A follow-up, not in Phase 4.

Rehearsal of `0019` on 2026-11-05, on the separate fictional database `minsky-preview-rehearsal-0019`, deleted afterwards, through `wrangler d1 migrations apply --remote` as deploys run it. Wrangler sends each file to the `/query` endpoint.

- **Atomicity.** Hosted D1 applied a file atomically in this one probe. A file whose third statement failed left no table and no `d1_migrations` row. This is an observation, not a provider promise, so `0019` stays safe statement by statement.
- **Apply.** `0019` applied in 121 ms of D1 time on 406 teams and 404 accounts. The foreign key check returned no rows. The three-team chain formed one entrant. Unrelated same-named teams stayed apart. The staff account with a team seat stayed unlinked.
- **Bulk assignment.** The `assign_entrants` insert of 300 entrants took 7 ms of D1 time, read 5,399 rows, wrote 3,000 rows, and seated 300 sign-ins. This measures that one statement through `wrangler d1 execute`, at 1,296 ms including Wrangler and the network. It does not measure the Worker request or the guards in its batch.

Rehearsal of `0019` and `0020` together on 2026-11-05, on the separate fictional database `minsky-preview-rehearsal-0020`, deleted afterwards. The steps were `0001` to `0018`, then fictional data, then `wrangler d1 migrations apply --remote` for `0019` and `0020`, as deploys run it.

- **Data.** 400 teams in 6 contests of 2 events, 300 accounts, and 401 seats. 100 pairs of teams, one in each of two contests, shared one account each, with names that differ in case and trailing space. One account held a staff seat in one contest and a team seat in another. Four teams named "Falcons" in four contests had unrelated accounts. One team had an empty name.
- **Apply.** `0019` ran 35 commands in 50.61 ms of D1 time. `0020` ran 14 commands in 7.89 ms. Both applied, and `d1_migrations` held 20 rows.
- **Checks.** `PRAGMA foreign_key_check` returned no rows. `SELECT count(*) FROM teams WHERE entrant_id IS NULL` returned 0. The backfill made 300 entrants: 100 from the shared teams, 4 for the "Falcons", 1 for the empty name, 1 for the staff team, and 194 other teams. 299 of 300 accounts linked to an entrant, and the staff account stayed unlinked. An update that made a contestant seat an admin seat failed with "A contestant holds no admin seat". All 6 existing contests kept `intake_follows_schedule = 0`.

Rehearsal of `0020` again on 2026-11-05, after it gained `contest_awards_unconfirmed`, on the separate fictional database `minsky-preview-rehearsal-0020b`, deleted afterwards. The steps were `0001` to `0019`, then 1 event, 2 contests, and 2 accounts, then `wrangler d1 migrations apply --remote` for `0020`. `0020` ran 15 commands. Awards of 15 and 20 minutes in one contest, and of 15 minutes in another contest, were accepted. After the first 15-minute award was confirmed, a second 15-minute award was accepted. A third 15-minute award in the first contest, while the second waited, failed with `UNIQUE constraint failed: contest_awards.session_id, contest_awards.minutes`. `PRAGMA foreign_key_check` returned no rows.

The owner accepted these decisions on 2026-11-06:

16. **Late entrant in a running live contest.** Decided 2026-11-06. The organizer confirms the assignment. Then reporting closes for every team until that seat is issued. The console asks first, as the live password rule describes.
17. **Rollback protection for the gate.** Decided 2026-11-06. Rollback protection stays a documented procedure, with no D1 enforcement. Organizers close live contests before a rollback, as the Phase 6 revert note states.
18. **Named reset during an open practice contest.** Decided 2026-11-06. A named reset stays refused while the contestant holds another open contest, including an open practice contest. No practice exemption is added. The named target contest stays exempt, as the Phase 6 list near the top of this page states.
19. **Withdrawing single-issue awards.** Decided 2026-11-06. Built as migration `0025`. Jury can withdraw an unconfirmed issue award. The issue cannot take another award afterwards, as the note on withdrawing an issue award states.
20. **Assign control for event admins.** Decided 2026-11-06. Event admins keep the **Assign** control on each staff row, because it is their only way to take a staff seat.

## Risks

Each risk names its measurement.

- **Hot-path reads.** The resolver adds about six probes per evaluation on every read path. Measured by the Phase 1 gate, locally with `npm run perf:reads` and the pinned plans, and on `minsky-preview` with `npm run load`. The fallback is named in Phase 1.
- **Sign-in burst.** At contest start, 800 contestants sign in and make the forced change: a verify, a hash, and a verify each (`src/server/adapters/cloudflare/authentication.ts:310-347`). The sign-in adds one index search for the event code. Measured in Phase 3 at the 200-user step of `npm run load` on `minsky-preview`. The 800-user target stays unmeasured until the owner asks for a capacity run. A free-tier preview run does not establish production capacity.
- **Hosted D1 limits for chunked deletes and the trigger fan-out on bulk assignment.** The local coverage and behavior checks passed in local SQLite. Measured in Phase 7 by timing a 2,000-issue event with 80,000 history rows on `minsky-preview`, and in Phase 4 by a bulk assignment of 300 entrants there.
- **Trigger behavior on hosted D1.** The design relies on child `DELETE` triggers that fire during a cascade (for `unready_seats`), on `AFTER` triggers whose order does not matter, and on a column CHECK that reads another column (`kind`). Verified in local SQLite 3.51 only. D1 runs an older SQLite. Measured by running `previousWorker.test.ts`, `eventDeletion.test.ts`, and the readiness tests against `minsky-preview` in Phases 1, 6, and 7.
- **Plan pins in the rollback check.** `scripts/rollback-check.mjs` runs the previous release's whole `npm run test:d1`. That suite includes the pinned plans of `queryPlans.test.ts` (`src/server/adapters/d1/queryPlans.test.ts:70-77`) and the ceilings of `readVolume.test.ts`. The new indexes, for example `issues_reporter`, `issues_owner`, and `history_actor` in `0023`, could make SQLite choose another index for an old query. Then an old pin fails on a schema whose rollback works. Nothing here shows whether the old pins hold. Measured by the first rollback check of Phase 1 and of Phase 7. A failure caused only by a plan pin is triaged as a pin, not as a rollback break.
- **Migration atomicity.** It is unknown whether `wrangler d1 migrations apply` runs a file in one transaction. Measured by rehearsing each file on an empty D1 database and on a `minsky-preview` copy of the development data shape before its pull request is ready.
- **R2 listing.** `list({prefix})` exists on the Workers R2 binding, and the local test bucket supports it (`src/server/adapters/cloudflare/announcements.test.ts:20`, `src/server/adapters/cloudflare/announcements.test.ts:94`). `PrivateBucket` must expose it. Measured in Phase 7 on `minsky-preview-images`.
- **A self-hosted installation without a webmaster.** A self-hosted database whose admin has neither username has no webmaster after `0017`. Its admin stays a contest admin of the bootstrap event and cannot create events. `recoverWebmaster` finds only an existing webmaster, and bootstrap needs an empty database. A local probe shows this case in local SQLite. Measured by `SELECT count(*) FROM grants WHERE scope = 'site'` after the upgrade, which the release notes ask self-hosters to run. The follow-up is a trusted terminal command that creates the first webmaster when a database has none.
- **A very long issue.** An issue chunk is bounded by its count of issues, and not by its count of rows. So one issue with a very long history still cascades all of that history in one statement. The seed holds 40 history rows for each issue.
- **A blocked deletion.** A legacy account that acted in another event, through today's attach-any-UUID hole, stops its event's deletion as `blocked`. The design deletes nothing of the other event to finish it. Measured before Phase 7 by a read-only query on `minsky-development` for accounts whose activity rows name contests of two events. The owner decides how such a deletion ends.
- **Shared writer.** One D1 primary serves every event's live contests, calendars, and deletions. The owner deferred scale. Not measured here.

## How this design was chosen

Two separate design runs each produced one complete design from the same owner decisions. One rubric then compared the two designs.

- The first design kept the contest membership as the only access check. It gave webmasters and event admins derived membership rows, which triggers kept equal to a view.
- The second design resolved authority from grants at the site, event, and contest scope in one resolver, with an event-owned roster.

A separate reviewer and the design lead each chose the second design as the base. It replaces about fifteen copies of the access check with one resolver. It stores no synced projection. It also lets overlapping live contests that share a sign-in open together, which the first design could not do.

This design took three parts from the first design:

1. The handle and login key split, so that the previous Worker's sign-in keeps its unique index after a rollback.
2. The delete guards in D1, and a coverage test that derives its table list from the schema.
3. The takeover and join audit triggers in D1, and a rollback check that runs the previous release's tests on the new schema.

Review added the overlap rule for the contests that one live password opens, and the measured gate for the resolver's added reads in Phase 1.
Review rejected the derived membership rows and their triggers, a second gate for the control plane, and a same-name replacement of the `accounts_username` index.
The owner's answers of 2026-10-27 then replaced the promotion rule with the by-name rule and removed staff assignment from contest admins. The section [Decisions](#decisions) lists every answer.

Local checks ran on the final sketches. The checks are not part of the repository. Phase 1 turns them into repository tests (see "Module map"). They showed these results:

- The repository's migration guard, `destructiveStatements`, finds nothing in any of the seven sketch files.
- An empty database stays empty after every file, and the previous Worker's bootstrap still runs on the new schema.
- 86 behavior checks pass on development-shaped data. They cover identity and sign-in, isolation, takeover protection, the audited join, the resolver for every role, account management, staff assignment at event level, `forContests`, intake, the personal end time, awards, and the delete guards.
- 38 probe checks pass. They cover the promotion by name, a database where nobody is promoted, a team account and a volunteer that use the two names and are not promoted, the backfills, the previous Worker's writes, and a legacy cross-event actor that blocks its own deletion.
- No new lookup scans a table, and the previous Worker's sign-in keeps `accounts_username`.
- A deletion of one event leaves exactly the database that holds the other event, across all 31 tables that reference events, contests, or accounts.
- Every citation in the sketches exists in the repository.
- The type sketch type-checks against the repository's modules with the repository's compiler options.

Every SQL check ran in local SQLite 3.51 or the local TypeScript compiler. None of them ran on D1 or measured hosted cost.

## Follow-up

These changes are outside this page and wait for later pull requests:

- A trusted terminal command that creates the first webmaster on a database that has none. A self-hosted installation needs it when its admin has neither development username (see "Risks").
- The operator and contestant guides, `site/src/content/docs/operators/installation.mdx` and `site/src/content/docs/guides/contestants.md`, change in the phase that ships each behavior.

## Next implementation step

Phase 7, `feature/event-deletion`, is the next phase in [Delivery phases](#delivery-phases).
