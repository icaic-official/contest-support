# Webmaster, event, and contest platform

**Status.** Proposed. Phase 1, `feature/scoped-authority`, implements the contest resolver, migration `0017`, and its gate. The local half passed. The hosted half, run on 2026-11-01, was inconclusive and did not pass. The snapshot p95 grew by 11 to 58 percent at 200 users, and the cause is not isolated. The [gate record](history/scoped-authority-gate.md) holds the measurements. Phases 2 to 8 are not built.

Phase 1 differs from this page and the sketches in these points:

- The foreign key on `accounts.event_id` is `DEFERRABLE INITIALLY DEFERRED`. Test cleanups delete an event and then its accounts in one batch, and an immediate key refuses that order.
- The resolver starts from the contest and its event, then joins the login tables, so the live form reads them once. Only a webmaster's stamp reads `site_settings`.
- `/api/sessions` lists every contest that the caller can read. For a webmaster, that is every contest of the site.
- `authorityCopies.test.ts` also refuses `FROM grants`. It exempts the two trusted terminal commands, `installation.ts` and `adminRecovery.ts`, which check an admin membership without a login.

This page explains how one shared Minsky installation can host the events of many organizers. It settles GitHub issues #119 and #136 under the owner's decisions of 2026-10-27, which [PLAN.md](../PLAN.md) records. It supersedes the [earlier multi-competition design](history/multi-competition-design.md).
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

This design replaces these sections of the [earlier design](history/multi-competition-design.md): "Names and levels", "Rosters", "Authority", "Audit", "Setup module", "Type sketch", "Migration sketch", and "Delivery phases". It keeps that page's contest kinds and its reason for fresh live passwords. The module map lists every superseded statement.

## How each person uses the platform

This section describes the target behavior from each person's view. None of it is built.

### Quickstart for an organizer

These steps take a new installation to a working event:

1. A maintainer runs `npm run cloudflare:install -- bootstrap --site=site.json` on an empty database. Minsky creates one webmaster and prints a temporary password once.
2. The webmaster opens `https://minsky.example/`, chooses **Site sign-in**, signs in, and changes the temporary password.
3. The webmaster selects **New event**. The form takes the name "XXXX Olympiad 2026", the event code `xxxx-2026`, the time zone `Asia/Singapore`, and the first event admin, with handle `chen` and name "Chen Li". Minsky shows Chen's credential sheet once. The sheet holds the link `https://minsky.example/?event=xxxx-2026`, the handle, and the temporary password.
4. Chen signs in from that link and builds the event. That work covers contests, staff, teams, single contestants, and assignments.
5. Each staff member and contestant gets a sheet with the same event link. Nobody types an event code that they could mistake.

The sign-in form labels the handle field **Username**, because people know that word. In code and on this page, the typed name is the **handle**. The stored name that Better Auth knows is the **login key**. Nobody sees or types a login key.

### Webmaster

A webmaster works in this order:

1. The webmaster signs in with **Site sign-in**. Webmasters belong to no event, so this form has no event code.
2. The webmaster lands on the **Site** dashboard. It lists each event with its derived span ("3 to 5 Nov, Asia/Singapore") and its contest and account counts. It also shows a calendar of every event's contests, the webmasters, the setting **Webmasters read contest data only after joining**, and the progress of deletions.
3. The webmaster selects **New event** (step 3 of the quickstart). One batch creates the event, the admin's account, and the event grant. Then the browser asks for that one account's credentials.
4. The webmaster opens any event console and does anything that an event admin can do. For example, the webmaster resets the password of a locked-out event admin.
5. The webmaster opens a contest. By default, the contest opens at once. While the restriction is on, Minsky first says "Join this contest to read its issues and notes. The contest's admins see your join in their audit." **Join** writes a contest-scope grant. D1 then writes the audit rows itself.
6. The webmaster adds or removes webmasters. Removing the last enabled webmaster fails with "The last webmaster cannot be removed".
7. The webmaster deletes an event by typing its name. Minsky fences the event at once, which stops its reads, writes, and sign-ins. The dashboard shows progress. Rows go first. Files get a final check about an hour later. The dashboard keeps a "Deleted" record.

### Event admin

An event admin builds the event in this order:

1. The event admin signs in at `?event=xxxx-2026` and lands on the **Event** console.
2. **Contests.** The event admin creates "Practice 1" (practice, teams, 3 Nov 09:00 to 11:00), "Live 1" (live, teams, 3 Nov 13:00 to 18:00, 15 minutes grace), and "Live Singles" (live, singles, 4 Nov 09:00 to 12:00). The console takes and shows times in the event's time zone.
3. **Entrants.** The event admin imports a list of teams and single contestants. Each row gives a kind, a name, and a handle. Minsky creates the entrant and its one sign-in.
4. **People.** The event admin imports staff, each with a handle and a name.
5. **Assignments.** The event admin uses a grid of contests by entrants, and a grid of contests by staff with roles (contest admin, jury, volunteer, and specialist). One entrant can enter several contests. One staff member can serve in several.
6. **Credentials.** The event admin issues practice passwords and prints sheets. Before "Live 1", the event admin selects **Issue live passwords for Live 1**. Minsky lists the teams and the live contests that each new password will also open. Those are the team's live contests whose window overlaps "Live 1". Minsky issues eight accounts per request with a progress bar. "Live 1" shows "Waiting for live passwords: 3 teams" until the last team is done.
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
    'kind', s.kind, 'type', s.contest_type, ...) FROM sessions s WHERE s.id = ? AND EXISTS (SELECT 1 FROM access)),
  'access', (SELECT json_object('manage', manage) FROM access),
  'clock', (SELECT json_object('time_zone', e.time_zone, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'grace_minutes', s.grace_minutes, 'intake', json(${intakeStateSql('s', 'a.team_id')}),
      'personal_end_at', ${personalEndSql('s', 'a.team_id')})
    FROM access a JOIN sessions s ON s.id = a.session_id JOIN events e ON e.id = s.event_id),
  'contest_awards', ...,
  ...the other sections are unchanged...
) AS snapshot WHERE EXISTS (SELECT 1 FROM login)`;
```

Only the `access` line and the new sections change. `contestDataSql` keeps the column names that embedders read from `CurrentAccessRow` (`src/server/adapters/cloudflare/application.ts:9-26`), and its bindings keep the order of `currentAccessBindings` (`src/server/adapters/cloudflare/application.ts:58-60`). `contestDataSql` is the only export of the contest resolver. The unfiltered row stays private to `authority.ts`, so an embedder cannot skip the webmaster restriction.

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
- **Deletion** reads `event_deletion_targets_pending`, then deletes by primary key. Every foreign-key child has an index (`0022`).

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

This keeps T0003's "admin of every affected session" rule (`src/server/adapters/cloudflare/authentication.ts:195-199`) for contest admins, and adds the levels above them. D1 repeats the core of the rule for every Worker version. `account_operation_takeover` refuses a reset or rename of a webmaster by anyone but a webmaster. It also refuses a change to an event admin by anyone but a webmaster or an event admin of that event. Every admin issue and rename inserts an `account_operations` row in the same batch as its writes (`src/server/adapters/cloudflare/authentication.ts:241-242`, `src/server/adapters/cloudflare/authentication.ts:263-268`). So a refusal rolls the whole batch back. An actor may act on the own account, which keeps `change_password` and trusted recovery working (`src/server/adapters/cloudflare/installation.ts:170-171`, `src/server/adapters/cloudflare/adminRecovery.ts:131`).

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

**Backfill (`0019`).** Teams that share a normalized name inside an event become one entrant, so a team in two existing contests becomes one entrant. Each contestant account links to the entrant of its oldest team. Data with several accounts per team, or with unnamed teams, stays as it is. Seats stay in `memberships`, so legacy oddities keep working.

### Contest schedule, clock, time awards, and intake

- A contest has `starts_at`, `ends_at`, and `grace_minutes`. It runs continuously, and contests may overlap.
- **Intake is derived, never stored or flipped.** `intakeOpenSql` in the [type sketch](event-platform-sketches.md#type-sketch) evaluates D1's clock in every read and again inside the submit batch, through the workflow `dependency` value. So a submit that crosses the close fails and retries. No cron writes intake, and no audit actor is needed. The terms are evaluated in this order:
  1. The live gate comes first. It is `kind = 'practice' OR unready_seats = 0`. No override opens a live contest that waits for passwords.
  2. While the contest follows its schedule, intake is open from `starts_at` until the end plus `grace_minutes`. For a contestant, the end is the personal end time.
  3. Otherwise `intake_open` decides. That is today's switch, and also the manual override.
- Intake closure still blocks only new contestant submissions. Staff work and reopening are unaffected (`src/server/workflow.ts:109-118`).
- **Personal end time** is `ends_at`, plus the minutes of the entry's issue awards whose application staff confirmed, plus the minutes of confirmed contest-wide awards (`personalEndSql`). The snapshot returns it, and the browser only displays it. Minsky still changes no external clock. Staff apply minutes outside Minsky, and Minsky counts only confirmed minutes. The `apply` history text stays true (`src/server/workflow.ts:206`).
- **Contest-wide award.** The jury grants it, and support or jury confirms its external application, as with issue awards. A repeated grant with the same request ID inserts nothing (`UNIQUE (actor, request_id)`). A repeated confirmation finds `applied_request` equal to its own request and succeeds without a write.
- **Time zone.** The server stores instants only. The browser converts the event-local wall time with `zonedWallTime` and formats with `formatInZone`. A DST gap moves forward, and an overlap takes the earlier instant.

A local behavior check shows a running contest open, a contest in grace open, an ended contest closed, an override that cannot open a waiting live contest, and a contestant with 20 confirmed minutes who may still report.

### Live password rule

A live contest's intake stays closed until every contestant seat in it holds a completed password issued for it. That is the 2026-10-25 rule. `issueCredentials` is the only way to make a password.

**`forContests` has one definition.** It is the set of live contests that a new password opens. The server derives it per account with `forContestsSql`. The set holds the live contests of the account's entries whose window overlaps the window of the target contest. A window runs from the scheduled start to the scheduled end plus grace. Every live contest has a schedule, because the `kind` column CHECK requires one. The request names only the target contest. The organizer cannot widen or narrow the set.

The rule has these consequences:

- One issue serves overlapping live contests that share a sign-in. A local behavior check shows that an issue for "Live 1" covers the overlapping "Live 2" and both become ready.
- An issue never opens a later live contest that does not overlap. An issue on day 1 for "Live 1" does not open "Live 3" on day 3, so "Live 3" gets its own fresh password. A "not ended" rule would break that. A contest that starts exactly at the end plus grace does not overlap.
- An issue is refused when it would sign a contestant out of a contest outside the set whose intake is open now. That is the earlier Rule 3, restated for automatic intake.
- A contestant's own forced change keeps the scope. A reset by either Worker ends it, and the contest closes until reissue.
- The hash runs before one batch that holds every write, so an interrupted issue leaves the old password valid. Readiness never shows a gap.
- `unready_seats` is not in `session_changes`. A credential issue therefore does not fail in-flight staff commands. The submit batch re-checks intake through its dependency value.

### Calendar

`Workflows.contests(query)` serves both the picker and the calendar. It takes an event, or a time window. Members see every contest of their own event, with `seat: null` for contests that they cannot open. Webmasters see every event's contests in the window. There is no public listing. The calendar groups contests by event and day in the event's time zone, and marks the intake state and the caller's seat.

### Webmaster dashboard and event console

- `Management.site()` returns the site dashboard data, and `Management.event(eventId)` returns the event console data (`SiteOverview` and `EventConsole` in the [type sketch](event-platform-sketches.md#type-sketch)). Each is a single read.
- Every change goes through `Management.execute(requestId, command)` with one command union. Site, event, account, and contest commands share one receipt table, one guard, one audit path, and one outbox helper.
- Credentials go through `Management.issueCredentials` in batches of eight. A lost response returns the account IDs without passwords on replay, and the sheet offers **Issue again** for exactly those.

### Event deletion

The goal is a deletion that is complete across D1, R2, and Durable Objects, safe to repeat after a crash at any point, and unable to touch another event.

1. **Fence.** One batch, run by a webmaster after a typed confirmation of the event's name (`fenceStatements` in the [type sketch](event-platform-sketches.md#type-sketch)):
   - It inserts the journal row (`event_deletions`, step `rows`) and captures the targets by `event_id`. The targets are the contests, the accounts (never a NULL-event account), and the avatar owners.
   - It sets `events.archived = 1`. Both Workers already refuse writes for archived events (`src/server/adapters/cloudflare/application.ts:222`, `src/server/adapters/d1/store.ts:143`).
   - It deletes the legacy `installation` row of this event, which would otherwise block the delete (`src/server/adapters/d1/migrations/0008_installation.sql:5-7`).
   - It writes a site audit row, and queues outbox rows so that open sockets refresh.
   - From this batch on, the resolvers and sign-in refuse the event through `NOT EXISTS event_deletions`. A repeated fence fails its assertion and changes nothing.
2. **Advance** (`advanceDeletions`, from `waitUntil` and the minute cron). A lease claims one deletion at a time. Each step is bounded and idempotent:
   - `rows` (`advanceRows`). It deletes at most 100 issues per statement, then each contest row. Then it deletes at most 100 accounts per batch, with their avatar rows, `ba_user` rows, and limiter keys. Last it deletes the `events` row and the `handle:<eventId>:` key range.
   - `live`. A Durable Object `/erase` runs for each contest.
   - `files`. R2 lists and deletes the prefixes `<contestId>/` and `accounts/<id>/`. A final empty listing must come at least 65 minutes after the rows are gone.
   - `done`. The targets go, and the journal row stays as the site record.
3. **Guards.** In D1, a row of an event, a contest, or an event account disappears only while that event's journal is in step `rows` (`0023`). The journal moves forward one step at a time and keeps naming the same event (`event_deletion_step_order`, `event_deletion_fixed`). So the guard opens once per event and closes for good. An ad hoc `DELETE` from any Worker version, a test, or a console is refused. A site account is never deleted this way.
4. **No other event is reached.** Every delete names target IDs or prefixes derived from them. Activity keys into `accounts` stay `NO ACTION`. If a legacy account acted in another event, the account batch fails on a foreign key, records `blocked`, and stops. It does not cascade into the other event. A local probe shows this. The event stays fenced, and the dashboard names the account. Finishing that deletion needs an owner decision, because it would change the other event's history (see the risks).
5. **Coverage.** `eventDeletionCoverage.test.ts` seeds two events with every writer and deletes one through `fenceStatements` and `advanceRows`. It compares every table's row count with a database that holds the other event alone. It reads `sqlite_master` and `pragma_foreign_key_list`, so it keeps no table list by hand. It fails when any table that references events, contests, or accounts, directly or through another such table, holds no seeded row. A new table therefore needs a seed row, or the test fails. A local coverage check models it. It covers 31 tables, and only the two expected site records differ.
6. **Cost.** `0022` indexes every foreign-key child. Without these indexes, each account delete would scan every event's history. A local measurement recorded 11,363 ms for one event at N = 80,000 without one of these indexes. That was local SQLite, not D1.
7. **Durable Objects.** `/erase` replaces the fixture-only `cleanup()` (`src/server/adapters/cloudflare/live.ts:245-285`). It refuses unless D1 shows the contest in `event_deletion_targets` and no `sessions` row. So no request can wipe a running contest's object.
8. **Fixtures.** Every test cleanup records its own event in the journal and runs the same rows step (Phase 7). One deletion procedure then serves the product and the tests.

This is the deletion of one named event that the owner approved. It is not a shared-data reset, and it adds no persona control.

### Live updates

- One Durable Object per contest stays (`src/server/adapters/cloudflare/live.ts:301`). `access()` reads `contestDataSql('logins')`, so event admins and webmasters receive the `staff` audience without a membership.
- A revocation for these derived seats has no `account:` outbox row, because the account triggers fan out over `memberships` (`src/server/adapters/d1/migrations/0014_notification_claims.sql:39-44`). Any notify in the contest re-checks every socket (`src/server/adapters/cloudflare/live.ts:221-222`), and the alarm re-checks within 30 s (`src/server/adapters/cloudflare/live.ts:151-158`).
- Schedule, intake override, and type changes notify the contest's audiences, as `setIntake` does today (`src/server/adapters/cloudflare/application.ts:259-268`).
- Time boundaries send no hint. The browser refreshes at `intake.changesAt` with 0 to 15 s of jitter, so 800 clients do not refresh in the same second. The server's gate stays authoritative.
- The event console and the site dashboard have no socket. They read on focus and after their own commands.

### What this design deliberately does not do

- It adds no problems, submissions, judging, scoreboard, payment, plans, self sign-up, email, SMTP, or public listing.
- It adds no per-contest archive. The earlier Phase 7 with `contest_state` is dropped, because no 2026-10-27 decision asks for it. `events.archived` stays the read-only fence.
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
| Staff switch between contests one at a time | One selected contest and one socket, as today (`src/connected/hooks/useSessionSnapshot.ts:170-175`), with `?contest=` kept across reloads |
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
| `src/server/adapters/d1/migrations/0017_scoped_authority.sql` to `0023_deletion_guards.sql` | Schema in the [migration sketch](event-platform-sketches.md#migration-sketch) |
| `src/server/adapters/cloudflare/authority.ts` | The one resolver for contest, event, and site, `authorityGuard`, `manageAccountSql`, `requireAuthority`. Only `contestDataSql` leaves the module |
| `src/server/adapters/cloudflare/manage.ts` | `D1ManageService`: `site`, `event`, `execute`, `requirementOf`, planners |
| `src/server/adapters/cloudflare/credentials.ts` | `loginKeyFor`, `forContestsSql`, `replaceCredentialStatements`, `D1CredentialService.issue` |
| `src/server/adapters/cloudflare/schedule.ts` | `intakeOpenSql`, `intakeStateSql`, `personalEndSql`, `extraMinutesSql` |
| `src/server/adapters/cloudflare/contestAwards.ts` | Grant and confirm contest-wide awards |
| `src/server/adapters/cloudflare/eventDeletion.ts` | `fenceStatements`, `advanceRows`, `finishStatements`, `advanceDeletions` |
| `src/connected/capabilities.ts` | `capabilityRule` and `can`, shared by the Worker and the browser |
| `src/connected/zonedTime.ts` | Event-zone conversion and formatting |
| `src/connected/ContestPicker.tsx`, `src/connected/Calendar.tsx` | One picker replaces five; the calendar view |
| `src/site/SiteDashboard.tsx`, `src/site/useSite.ts` | Webmaster dashboard |
| `src/event/EventConsole.tsx`, `src/event/useEventConsole.ts`, `src/event/CredentialSheet.tsx` | Event console tabs and the batched credential sheet |
| `scripts/rollback-check.mjs` | Checks out the previous release (`origin/main`) into a temporary worktree outside the repository and copies this branch's migration files into it. Then it runs that release's `npm run test:d1` against the new schema. The previous release's tests then run its own writes, guards, and cleanup on the new triggers. The local probe is its model |
| Tests: `authority.test.ts` (an isolation matrix of two events, every role, and every reader), `manage.test.ts`, `credentials.test.ts`, `schedule.test.ts`, `eventDeletion.test.ts` (a crash after each step), `eventDeletionCoverage.test.ts` (derived from `sqlite_master`, with the non-vacuous seed rule), `previousWorker.test.ts` (replays the previous Worker's statements, as the probe does), `authorityCopies.test.ts` | Behavior tests at the D1 boundary |

It changes these files:

| File | Change |
| --- | --- |
| `src/backend/contracts.ts` | Types in the [type sketch](event-platform-sketches.md#type-sketch); `Administration` removed; `sessions(userId)` becomes `contests(query)`; `signIn` takes a target and a handle; `AccountStatus.username` becomes `handle` |
| `src/server/adapters/cloudflare/application.ts` | Keeps `snapshot` and `contests`; access fragments move to `authority.ts`; admin methods move to `manage.ts` |
| `src/server/adapters/d1/store.ts`, `src/server/workflow.ts` | `workflowSql` joins the resolver; `dependency` carries the stamp and the intake value; `decideWorkflow` reads `capabilityRule` |
| `src/server/adapters/cloudflare/authentication.ts`, `src/server/authenticationHttp.ts` | Sign-in by event code or site and handle; the limiter key; account commands leave for `manage.ts` and `credentials.ts`; `createLogin` is unchanged |
| `src/server/adapters/cloudflare/http.ts`, `applicationWorker.ts` | Routes `/api/contests`, `/api/site`, `/api/event`, `/api/manage`, `/api/credentials`, `/api/contest-awards`; cron task `advance-deletions` |
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

From the [earlier design](history/multi-competition-design.md), this design supersedes these statements:

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
| `0019` | `entrants`, `teams.entrant_id`, `accounts.entrant_id`, `contest_type`, roster triggers | One entrant per normalized team name per event. Team names take the entrant's spelling, which differs only in case and spaces. Accounts link to their oldest team's entrant |
| `0020` | Schedule columns, `contest_awards`, `awards_session` | Existing contests have no schedule and keep manual intake |
| `0021` | `kind` (default practice), `credential_scopes`, `unready_seats` | Scopes come from each account's newest completed admin-issued credential, as in the earlier `issued_contest` view. Existing contests are practice, so nothing that is open closes |
| `0022` | Deletion journal, targets, foreign-key child indexes | Indexes only add entries |
| `0023` | Delete guards on `events`, `sessions`, `accounts` | No data statement |

`0020` comes before `0021` because the live password rule needs schedules. `0023` is separate from `0022` because the previous release's test cleanup deletes rows directly (`src/server/adapters/d1/testFixture.ts:205-207`). So `scripts/rollback-check.mjs` for `0022` must still run that cleanup. From `0023` on, the previous release cleans up through the journal.

**Promotion of the two development accounts.**

- **Rule.** `0017` gives a site grant to the accounts whose username is `organizer` or `playtest-admin`, by name (decision 1). Usernames are globally unique (`src/server/adapters/d1/migrations/0003_authentication.sql:5`), so the rule matches at most two accounts. A matching account must also be a contest admin and hold no team seat. So a self-hosted team or volunteer that uses one of these names is not promoted. On a database without them, it promotes nobody. The repository names `organizer` as the development owner (`docs/activate-cloudflare-development.md:36`). The owner supplied `playtest-admin`. The repository does not mention it, and it passes the username CHECK (`src/server/adapters/d1/migrations/0003_authentication.sql:2-4`). No count or query runs before the merge.
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
   - **Focused tests.** `manage.test.ts` for the site commands. The join is refused in open mode, and D1 writes both audit rows. The last webmaster. Receipts on retry. `installation.test.ts`.
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
6. **`feature/live-credentials` (`0021`).**
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
   - **Revert.** Readiness columns stay. The previous Worker ignores them.
7. **`feature/event-deletion` (`0022`).**
   - **Scope.**
     - `delete_event`, `advanceDeletions` with the lease and the cron task, the `event_deletions` fence in the resolvers and in sign-in, `/erase`, `PrivateBucket.list`, and the dashboard progress.
     - Every test cleanup in the module map moves to the journal.
     - `eventDeletionCoverage.test.ts`.
   - **Focused tests** (`eventDeletion.test.ts`):
     - A crash injected after each step, then the run repeated.
     - A second event's rows, objects, and Durable Object state untouched.
     - A legacy cross-event actor gives `blocked`, not a cascade.
     - The cron idle cost stays within the budget of `src/server/adapters/d1/cronReads.test.ts:210-212`.
     - A deletion of a 2,000-issue event with 80,000 history rows, timed locally and on `minsky-preview`, with the indexes.
     - `PrivateBucket.list` on `minsky-preview-images`.
   - **Browser test.** A webmaster deletes a fixture event and sees "Deleted".
   - **Revert.** The previous Worker treats a fenced event as archived. An unfinished deletion pauses until roll-forward, and its journal stays intact.
8. **`feature/deletion-guards` (`0023`).**
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
- The design accepts one index write per history row, issue, resolution, award, and receipt (`0022`), in exchange for a deletion that does not scan other events.
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
6. **Deletion and export.** An event deletion does not wait for the contest support log export (issue #116). The typed confirmation names what is lost.
7. **Contest-wide awards.** They have no recipient exceptions. Each award gives minutes to every entry of the contest.
8. **Existing contests.** Every existing development contest becomes a practice contest. The kind is fixed.
9. **A webmaster's join.** It persists when the restriction is switched off and on again, because it was audited. A new join is refused while the restriction is off.
10. **The sign-in screen.** It does not show the event name, so it makes no unauthenticated lookup by code.
11. **Contest kinds.** Practice and live stay beside the contest types. The live password rule needs them.
12. **Member lists.** Webmasters do not appear in a contest's member list. The member list shows assigned members, and the audit shows joins.
13. **Deletion progress.** A deletion shows "done" after 65 minutes. That covers upload reservations that live 3,600 s (`src/server/adapters/d1/migrations/0006_application.sql:34`).

## Risks

Each risk names its measurement.

- **Hot-path reads.** The resolver adds about six probes per evaluation on every read path. Measured by the Phase 1 gate, locally with `npm run perf:reads` and the pinned plans, and on `minsky-preview` with `npm run load`. The fallback is named in Phase 1.
- **Sign-in burst.** At contest start, 800 contestants sign in and make the forced change: a verify, a hash, and a verify each (`src/server/adapters/cloudflare/authentication.ts:310-347`). The sign-in adds one index search for the event code. Measured in Phase 3 at the 200-user step of `npm run load` on `minsky-preview`. The 800-user target stays unmeasured until the owner asks for a capacity run. A free-tier preview run does not establish production capacity.
- **Hosted D1 limits for chunked deletes and the trigger fan-out on bulk assignment.** The local coverage and behavior checks passed in local SQLite. Measured in Phase 7 by timing a 2,000-issue event with 80,000 history rows on `minsky-preview`, and in Phase 4 by a bulk assignment of 300 entrants there.
- **Trigger behavior on hosted D1.** The design relies on child `DELETE` triggers that fire during a cascade (for `unready_seats`), on `AFTER` triggers whose order does not matter, and on a column CHECK that reads another column (`kind`). Verified in local SQLite 3.51 only. D1 runs an older SQLite. Measured by running `previousWorker.test.ts`, `eventDeletion.test.ts`, and the readiness tests against `minsky-preview` in Phases 1, 6, and 7.
- **Plan pins in the rollback check.** `scripts/rollback-check.mjs` runs the previous release's whole `npm run test:d1`. That suite includes the pinned plans of `queryPlans.test.ts` (`src/server/adapters/d1/queryPlans.test.ts:70-77`) and the ceilings of `readVolume.test.ts`. The new indexes, for example `issues_reporter`, `issues_owner`, and `history_actor` in `0022`, could make SQLite choose another index for an old query. Then an old pin fails on a schema whose rollback works. Nothing here shows whether the old pins hold. Measured by the first rollback check of Phase 1 and of Phase 7. A failure caused only by a plan pin is triaged as a pin, not as a rollback break.
- **Migration atomicity.** It is unknown whether `wrangler d1 migrations apply` runs a file in one transaction. Measured by rehearsing each file on an empty D1 database and on a `minsky-preview` copy of the development data shape before its pull request is ready.
- **R2 listing.** `list({prefix})` exists on the Workers R2 binding, and the local test bucket supports it (`src/server/adapters/cloudflare/announcements.test.ts:20`, `src/server/adapters/cloudflare/announcements.test.ts:94`). `PrivateBucket` must expose it. Measured in Phase 7 on `minsky-preview-images`.
- **A self-hosted installation without a webmaster.** A self-hosted database whose admin has neither username has no webmaster after `0017`. Its admin stays a contest admin of the bootstrap event and cannot create events. `recoverWebmaster` finds only an existing webmaster, and bootstrap needs an empty database. A local probe shows this case in local SQLite. Measured by `SELECT count(*) FROM grants WHERE scope = 'site'` after the upgrade, which the release notes ask self-hosters to run. The follow-up is a trusted terminal command that creates the first webmaster when a database has none.
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

- `AGENTS.md` needs two edits in the phase that ships each behavior. In "Behavior to preserve" (`AGENTS.md:139-140`), add a clause that says that the deletion of one named event through its journal is not a shared-data reset. In "Product and provider constraints" (`AGENTS.md:272`), write contest admins in place of session admins.
- A trusted terminal command that creates the first webmaster on a database that has none. A self-hosted installation needs it when its admin has neither development username (see "Risks").
- The operator and contestant guides, `site/src/content/docs/operators/installation.mdx` and `site/src/content/docs/guides/contestants.md`, change in the phase that ships each behavior.

## Next implementation step

Write `authority.ts` with the contest resolver, and serve today's `currentAccessSql` and `currentAccessForLoginsSql` exports from it. Run `queryPlans.test.ts`, `readVolume.test.ts`, and `npm run perf:reads` on `main` and on the branch with `0017` applied, before any caller changes. Then run the hosted half of the Phase 1 gate on `minsky-preview`.
