# Multiple competitions per installation

**Status.** Proposed. Not implemented.
This page explains how one Minsky installation runs several competitions, each with a practice contest and a live contest.
The owner made the main [decisions](#decisions) on 2026-10-25.
Nothing in this page exists on `main` at `5792530`, and every `path:line` citation refers to that revision.
Cloudflare is the only backend. The shared contracts in `src/backend/contracts.ts` stay the provider boundary.

## Problem

An organizer must prepare a contest in the app, without an agent or Cloudflare credentials. Today the `Administration` contract has only `account`, `setIntake`, `setImageLimits`, `saveMember`, and `removeMember` (`src/backend/contracts.ts:75-88`). Bootstrap creates the only event, session, categories, and teams, and only on an empty database (`src/server/adapters/cloudflare/installation.ts:86-94`).

The owner also wants each competition to have a practice contest and a live contest. Three facts on `main` decide the shape:

- Usernames are unique across the whole database (`src/server/adapters/d1/migrations/0003_authentication.sql:5`, `0004_identity.sql:11`). Additive migrations cannot make them unique per organization.
- Only the trusted installer creates events, sessions, and teams. `0008_installation.sql:1` says "No HTTP endpoint can grant this authority".
- `events.archived` is the only read-only flag (`0001_transaction_proof.sql:18-22`). Thirteen lines in seven D1 files read it directly. A practice contest and a live contest in one event share it. To reproduce the count, run `grep -rnE "\b(e|te)\.archived" src/server --include=*.ts | grep -vE "\.test\.ts|Cases\.ts"`.

## How an organizer prepares a contest

This is the target procedure for the first production contest, with the phase that ships each step.

1. The installer runs bootstrap. The bootstrap account becomes the first organization admin (Phase 3).
2. An organization admin selects **New competition**. Minsky creates the competition with two empty contests, **Practice** and **Live** (Phase 5).
3. In the practice contest, an admin imports a CSV file of teams and staff. Minsky creates the teams and accounts and shows a credential sheet once, to print or download (Phase 2). The admin corrects teams and categories in the editors (Phase 1).
4. Teams use the practice contest. Each team changes its temporary password at first sign-in.
5. After practice, an admin opens the live contest and selects **Copy roster from Practice**. The preview says that every team account gets a new temporary password. After the admin confirms, Minsky shows the live credential sheet once (Phase 4).
6. The admin archives the practice contest. It becomes read-only (Phase 7).
7. The admin opens intake in the live contest. Intake opens only if no team account still has a password from practice (Phase 4).
8. After the contest, the admin archives the competition (Phase 5).

A second practice round is a new practice contest copied from the old one. Minsky deletes nothing and has no reset.

## Names and levels

The schema keeps its table names, because additive migrations cannot rename tables. Code names follow the schema. `labels.ts` is the only map from schema names to product words.

| Product word | Table | What it owns |
| --- | --- | --- |
| Organization | `installation` | Accounts and usernames, organization admins, the organization audit, one database, one bucket, and one Durable Object namespace. |
| Competition | `events` | The name, the archive state of all its contests, and competition admins. |
| Contest | `sessions` | A fixed kind, practice or live. Settings, teams, memberships, contest admins, operational data, the live channel, and the contest audit. From Phase 7, its own archive state. |

## Shape

### Data

A competition is an `events` row. A contest is a `sessions` row with a new `kind` column. All operational data already belongs to one session, and the live channel is per session (`src/server/adapters/cloudflare/live.ts:252`). So practice and live share no operational data.

One installation holds one organization, so the global username rule is the correct rule per organization, and no table gets an `organization_id` column. A team account is one `accounts` row with one username and a membership in each contest of its competition. `teams.roster_key` links a copied team to its source team, so a copy maps each team account to the right team, and a repeated copy inserts nothing.

### Authority

`admin_grants` holds grants with scope `installation` for organization admins or `event` for competition admins. A contest admin is still `memberships.is_admin`, and no contest admin satisfies a grant check.

Bootstrap writes the first installation grant. On an older installation, the owner runs the trusted recovery command once to write the grant. Today two recovery commands exist, `npm run cloudflare:install recover` and `npm run cloudflare:recover-admin`. The planned `chore/one-admin-recovery` change keeps one, and Phase 3 extends that one. Later grants and revocations go through `POST /api/setup`, which reverses `0008_installation.sql:1` for grants only. A trigger rejects the removal of the last installation grant. Each authority check runs inside the D1 write batch of its command, because a check before the batch proves nothing at commit time.

A grant gives authority over structure, not access to data. The creator of a contest becomes its admin through an ordinary membership, so `currentAccessSql` (`src/server/adapters/cloudflare/application.ts:32-50`) stays unchanged. To read a contest, an organization admin runs `join_session`, which adds an admin membership and a contest audit row.

A contest admin can never reset an account that holds a grant. Today a contest admin may reset any account in contests that the admin administers (`src/server/adapters/cloudflare/authentication.ts:159-173`), so a contest admin could otherwise take over the owner's grant.

### Team credentials across practice and live

Teams keep their usernames in both contests, and a leaked practice password must not open the live contest. Two rules give that result.

**Rule 1.** A copy that adds team accounts to a contest also starts a password reset of each of those accounts, in the same atomic batch. The reset is the existing `beginCredentialReset` (`src/server/adapters/cloudflare/credentialReset.ts:13-21`). It revokes every login and sets `credential_state = 'pending'`, so no earlier password works. Staff accounts keep their passwords.

**Rule 2.** Intake in a live contest opens only if, for every team account in it, the newest admin-issued password was issued for this live contest. `account_operations` already records the contest of each `create_account` and `reset_password` operation (`0003_authentication.sql:14-23`), so the rule needs no new schema. Rule 2 also covers a live contest that got its team accounts first.

The reset in Rule 1 hashes nothing. Recorded hash samples took 56 to 96 ms of CPU (`docs/history/run-log.md:1701-1703`), and the Worker has `cpu_ms: 1000` (`src/server/adapters/cloudflare/tooling/configuration.mjs:76`). So a credential batch issues the passwords:

1. One atomic batch creates the accounts or starts their resets, with one pending `account_operations` row for each account.
2. The browser calls `next` until no account remains. Each call hashes the passwords that fit in one request, completes those accounts, and returns the usernames and passwords.
3. The browser builds the credential sheet from the responses and shows it once.

No password enters a receipt, a table, or a log, so a lost response loses its passwords. The sheet lists each username without a password, and **Issue again** starts a new batch for those accounts. Bulk import and the live copy use the same batch and sheet.

A reset sets `must_change = 1`, so each team changes its temporary password at first live sign-in. The new password also opens practice, which has ended by then.

### Setup module

`Setup` has three methods. `overview()` lists the competitions the caller administers. `preview(command)` reports what a command creates, copies, and resets, and writes nothing. `execute(requestId, command)` runs one command in one atomic batch. It hides the authority check, IDs, roster keys, the copy, the Rule 1 resets, receipts, and audit rows. A copy never includes operational data, audit records, receipts, or the intake state.

The preview of a copy counts rows with the same SQL `WHERE` fragments that the copy uses. Rows can change before the commit, so the preview is advisory.

`setupCommandSchema` parses commands at the HTTP boundary. `setup_receipts` keys each command on the actor and the request ID, so a retry returns the first result. A different command under a used request ID is rejected. A grant change bumps `access_version`, so the existing optimistic guards reject commands that started before the change.

### Client

`SessionSummary` gains the kind, the competition, and the archive state. After a refresh, the client opens the first listed contest (`src/connected/hooks/useSessionSnapshot.ts:63-66`), and D1 orders the list by name (`application.ts:177-188`). So the browser sorts the list with `sortSessions`: live first, then practice, then archived. The console already has a contest picker (`src/organiser/desktop/ConsoleChrome.tsx:120`). A practice contest shows a **Practice contest** badge.

### Type sketch

```ts
// src/backend/contracts.ts. EventId, SessionId, and AccountId are branded strings.
export type SessionKind = 'practice' | 'live';

/** Phase 2. A password exists only in the response of next. */
export interface CredentialBatches {
	/** One atomic batch. Creates the accounts, or starts their resets. Hashes nothing. */
	begin(sessionId: SessionId, request: { import: RosterRow[] } | { reissue: AccountId[] }): Promise<{ usernames: string[] }>;
	/** Completes the next pending accounts that this admin started in this contest. */
	next(sessionId: SessionId): Promise<{ issued: Array<{ username: string; temporaryPassword: string }>; remaining: number }>;
}

export type GrantScope = { scope: 'installation' } | { scope: 'event'; event_id: EventId };

export type SetupCommand =
	| { type: 'grant_admin'; username: string; grant: GrantScope }                                 // Phase 3
	| { type: 'revoke_admin'; account_id: AccountId; grant: GrantScope }                           // Phase 3
	| { type: 'add_session'; event_id: EventId; name: string; kind: SessionKind; from?: SessionId } // Phase 4
	| { type: 'copy_roster'; from: SessionId; to: SessionId }                                       // Phase 4
	| { type: 'join_session'; session_id: SessionId }                                               // Phase 4
	| { type: 'create_event'; name: string }                                                       // Phase 5
	| { type: 'set_archived'; target: { event_id: EventId } | { session_id: SessionId }; archived: boolean }; // Phase 5 and 7
```

A `RosterRow` is one CSV line: a team with its username, name, and location, or a staff member with a username, a name, and roles. `copy_roster` copies teams, staff with roles, team accounts, categories, and image limits within one competition. `add_session` with `from` creates a contest and runs the same copy. Phase 1 adds `saveTeam` and `setCategories` to `Administration`. In `authority.ts`, `requiredAuthority` maps each command type to `installation` or `event`, so a new command without an entry fails to compile. Only `grant_admin`, `revoke_admin`, and `create_event` need `installation`.

### Migration sketch

Each phase takes the next free migration number on `main` when its pull request opens. `0011_account_avatars.sql` is taken, and other open pull requests may take the next number.

```sql
-- Phase 3. Organization and competition admins.
CREATE TABLE admin_grants (
	id TEXT PRIMARY KEY,
	account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
	scope TEXT NOT NULL CHECK (scope IN ('installation', 'event')),
	event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
	granted_by TEXT REFERENCES accounts(id),
	granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	CHECK ((scope = 'installation') = (event_id IS NULL))
) STRICT;
CREATE UNIQUE INDEX admin_grants_installation ON admin_grants(account_id) WHERE scope = 'installation';
CREATE UNIQUE INDEX admin_grants_event ON admin_grants(account_id, event_id) WHERE scope = 'event';
CREATE TRIGGER admin_grant_immutable BEFORE UPDATE ON admin_grants
BEGIN
	SELECT RAISE(ABORT, 'Admin grants are replaced, not edited');
END;
CREATE TRIGGER admin_grant_last BEFORE DELETE ON admin_grants
WHEN OLD.scope = 'installation' AND NOT EXISTS (
	SELECT 1 FROM admin_grants WHERE scope = 'installation' AND id <> OLD.id)
BEGIN
	SELECT RAISE(ABORT, 'The last organization admin cannot be removed');
END;
CREATE TRIGGER admin_grant_added AFTER INSERT ON admin_grants
BEGIN
	UPDATE accounts SET access_version = access_version + 1 WHERE id = NEW.account_id;
END;
CREATE TRIGGER admin_grant_removed AFTER DELETE ON admin_grants
BEGIN
	UPDATE accounts SET access_version = access_version + 1 WHERE id = OLD.account_id;
END;
CREATE TABLE organization_audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES accounts(id),
	action TEXT NOT NULL, target TEXT, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) STRICT;

-- Phase 4. Practice and live contests. Every existing contest is live.
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('practice', 'live'));
CREATE TRIGGER session_kind_fixed BEFORE UPDATE OF kind ON sessions
WHEN NEW.kind <> OLD.kind
BEGIN
	SELECT RAISE(ABORT, 'A contest kind is fixed at creation');
END;
-- NULL means the team is its own source. The index makes a repeated copy insert nothing.
ALTER TABLE teams ADD COLUMN roster_key TEXT;
CREATE UNIQUE INDEX teams_roster_key ON teams(session_id, COALESCE(roster_key, id));
CREATE TABLE setup_receipts (
	actor TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
	request_id TEXT NOT NULL,
	command TEXT NOT NULL CHECK (json_valid(command)),
	result TEXT NOT NULL CHECK (json_valid(result)),
	at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	PRIMARY KEY (actor, request_id)
) STRICT;
CREATE INDEX memberships_by_account ON memberships(account_id);

-- Phase 7. Archive one contest. Every archive read uses contest_state.
ALTER TABLE sessions ADD COLUMN archived_at TEXT;
CREATE VIEW contest_state AS
	SELECT s.id AS session_id, (e.archived = 1 OR s.archived_at IS NOT NULL) AS archived
	FROM sessions s JOIN events e ON e.id = s.event_id;
```

## Delivery phases

Each phase is one draft pull request into `main`. Workers Builds applies a merged migration before it publishes the Worker, so each migration must work under the previous Worker. Each phase ends with `npm run ci`, `npm run test:d1`, `npm run test:connector:runtime`, and its focused tests. To revert a phase, revert its pull request. Only Phase 7 has a revert caveat.

Phases 0 to 7 are required for the first production contest. Phases 8 to 10 can follow it.

### Phase 0. Remove the second contest list (required)

Delete `D1AuthenticationService.sessions()` (`src/server/adapters/cloudflare/authentication.ts:318-322`), which returns the ID as the name. Delete the route (`src/server/authenticationHttp.ts:64`), the browser method and schema (`src/backend/cloudflare/authentication.ts:13,155-158`), the alias (`src/server/adapters/cloudflare/http.ts:77`), and the routing exception (`src/server/adapters/cloudflare/applicationWorker.ts:56`). The test probe at `authenticationCases.ts:705-706` moves to `accountStatus()`. No product code calls the browser method.

### Phase 1. Team and category editors (required)

Branch `feature/organiser-roster-editors`. A contest admin creates and renames teams, sets team locations, and edits the category list. No migration. Teams and categories that an issue uses stay. Check with D1 tests for authority and archive rejection, and with a connector journey step.

### Phase 2. Bulk accounts (required)

Branch `feature/bulk-accounts`. A contest admin imports a CSV file of teams and staff through `CredentialBatches`. A reissue uses the same authority rule as a single reset. No migration. First measure the hashing cost at concurrency, then choose how many passwords one `next` call issues. Check with D1 tests: the begin step is atomic, the row limit holds, a resumed batch creates no duplicate account, and no temporary password exists in any D1 table after a run. Add a browser test for the sheet.

### Phase 3. Organization admins (required)

A migration adds `admin_grants` and `organization_audit`. Bootstrap and the one recovery command write the first grant. `Setup` ships with `grant_admin` and `revoke_admin`, and an **Administrators** page lists and changes grants. The rule that a contest admin cannot reset a grant holder ships here. Check with D1 tests: a contest admin without a grant is rejected and cannot reset the owner, a repeated request ID writes one grant, and the last organization admin cannot be revoked. `minsky-dev` shows no setup page until the owner runs the recovery command once. An agent does not run it.

### Phase 4. Practice and live contests (required)

A migration adds `sessions.kind`, `teams.roster_key`, `setup_receipts`, and `memberships_by_account`. `Setup` gains `add_session`, `copy_roster`, `join_session`, and `preview`. The copy ships with Rules 1 and 2, because without them practice and live would share passwords. A second pull request adds the client part: the new `SessionSummary` fields, `sortSessions`, and the badge. Check with D1 tests:

- A copied team account lands on the copied team, and no operational data copies.
- The preview counts equal the inserted rows.
- After a copy, the old password of a team account fails sign-in.
- Live intake fails to open after a practice password and opens after a live password.
- A repeated request ID returns one contest.
- `join_session` restores access after a contest admin removes the owner.

One manual browser check confirms that an issue filed in practice never appears in the live queue.

### Phase 5. Competitions and competition archive (required)

Branch `feature/archive-event`. `create_event` creates a competition with an empty practice contest and an empty live contest. `set_archived` archives a competition on the existing `events.archived` flag. A **Competitions** page lists both actions. Owner recovery stops requiring an active admin membership in the first contest (`src/server/adapters/cloudflare/installation.ts:140-145`). Check with D1 tests: one call creates both contests, an archived competition rejects writes, and owner recovery works after the first competition is archived.

### Phase 6. Account authority (required)

`accountAuthority` replaces the target branch of `adminCondition`. A grant covers every contest of its competition, archived or not. Today any membership of the target in an archived event blocks its reset (`src/server/adapters/cloudflare/authentication.ts:168`). After Phase 7, an archived practice contest would block every team password reset on contest day. Check with D1 tests: a team account in an archived practice contest can be reset, and a contest admin still cannot reset an account outside the admin's contests.

### Phase 7. Archive one contest (required)

A migration adds `sessions.archived_at` and `contest_state`. One sweep moves every direct read that the grep in [Problem](#problem) still lists to `contest_state`, and a repository test fails on a new direct read. Both ship in one pull request, because a missed read would leave a write path open. Check with D1 tests: practice archives while live keeps working, and an archived contest rejects every write. After a revert, a contest archived through `archived_at` becomes writable again, because the old Worker reads only `events.archived`.

### Phase 8. Contest addresses (later)

Routes under `/contests/<id>/` keep the contest after a refresh, and the picker groups contests by competition. Check with a browser journey that refreshes a deep link.

### Phase 9. Accounts across competitions (later)

Today a contest admin can add any account by its UUID (`src/organiser/admin/AccountForms.tsx:372-373`). `attachAuthority` limits that to accounts of the same competition. It matters only with more than one competition.

### Phase 10. Hosted control plane (later)

This phase waits for the hosted service decision. A separate Worker would provision installations and apply migrations to each one. Its limits, prices, and isolation are unverified.

## Relation to the production readiness audit

The owner's production readiness audit of 2026-10-25 is not in the repository. Its Blocker B4 lists the minimum organizer tools. Its proposed pull requests map to this plan:

| Audit step | This plan |
| --- | --- |
| 8. `feature/organiser-roster-editors` | Phase 1 |
| 9. `feature/bulk-accounts` | Phase 2 |
| 10. `feature/archive-event` | Phase 5, after Phase 3, because archive needs competition authority |
| 11. `chore/one-admin-recovery` (L2) | Phase 3 extends that command |

B4 let several sessions per event wait. The owner's later decision makes them required.

## Decisions

The owner decided these points on 2026-10-25:

1. The product names are Organization, Competition, and Contest.
2. Admins grant and revoke admin rights in the app. The first admin comes from a trusted command. The last organization admin cannot be removed.
3. Team accounts keep their usernames, and the live contest gets fresh temporary passwords.
4. Organization admins see contest data only after `join_session`, which the contest audit records.
5. Cloudflare is the only backend for this design.
6. The first production contest needs team and category editors, bulk accounts, competitions and contests, and archive.

These decisions are still open:

- Whether the hosted service runs one installation per organization. Only Phase 10 waits for it.
- Whether team accounts must change their temporary password. This design keeps today's forced change.

## Tradeoffs accepted

- A grant holder runs `join_session` to read a contest, in exchange for an unchanged `currentAccessSql`.
- The live copy ends every team sign-in to practice, and a lost credential response must be issued again. In exchange, no password is stored or shared between contests.
- A late roster change needs a second copy or an edit in each contest.

## Alternatives considered

- **Many organizations in one database.** Two organizations could not both create `admin`, and every query must filter by organization.
- **One roster per competition.** Issues reference `teams(session_id, id)` (`0001_transaction_proof.sql:60`), and `memberships` keys on `session_id` (`0001_transaction_proof.sql:34-42`). A change to those keys needs a table rebuild.
- **Access derived from a grant.** If `currentAccessSql` accepted a grant, every reader of it would change at once.
- **A `competitions` table above `events`.** Per-contest archive would need no sweep, but "event" would mean two levels.

## Risks

- **Sign-in burst.** After the live copy, every team signs in and changes its password. The change alone runs a verify, a hash, and a second verify (`src/server/adapters/cloudflare/authentication.ts:292-315`). Nobody has measured this burst at 800 users.
- **Copy cost.** A copy writes each copied team account several times: its membership, the `membership_added` trigger (`0001_transaction_proof.sql:117-120`), the reset, and the reset triggers. All of it runs in one batch on the single D1 primary (`ROADMAP.md:24`). Nobody has measured this cost or two active contests. Copy the roster before the live contest opens.
- **The anchor contest.** `installation.event_id` and `installation.session_id` point at the first contest (`0008_installation.sql:2-9`). Until Phase 5, do not archive the first competition.

## Next implementation step

Build Phase 0 and Phase 1. They are independent, and no open decision blocks them.
