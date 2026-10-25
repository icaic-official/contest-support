# Multiple competitions per installation

**Status.** Proposed. Phases 0 and 1 are built in draft pull requests #95 and #96. No other part is built.
This page explains how one Minsky installation runs several competitions. Each competition holds an ordered list of contests, for example Practice 1, Live 1, Practice 2, and Live 2.
The owner made the main [decisions](#decisions) on 2026-10-25.
Every `path:line` citation refers to `main` at `5415a76`.

## Problem

An organizer must prepare contests in the app, without an agent or Cloudflare credentials. Today the `Administration` contract has only five account and settings methods (`src/backend/contracts.ts:75-88`). Bootstrap creates the only event, session, and teams, and only on an empty database (`src/server/adapters/cloudflare/installation.ts:86-94`).

Three facts on `main` decide the shape:

- Usernames are unique across the whole database (`src/server/adapters/d1/migrations/0003_authentication.sql:5`, `0004_identity.sql:11`). Additive migrations cannot make them unique per organization.
- Only the trusted installer creates events, sessions, and teams. `0008_installation.sql:1` says "No HTTP endpoint can grant this authority".
- `events.archived` is the only read-only flag (`0001_transaction_proof.sql:18-22`). Thirteen lines in seven server files read it directly, so all contests of one event share it. To reproduce the count, run `grep -rnE "\b(e|te)\.archived" src/server --include=*.ts | grep -vE "\.test\.ts|Cases\.ts"`.

## How an organizer runs a competition

This is the target procedure for the first production contest. The phase that ships each step is in parentheses.

1. The installer runs bootstrap. It creates the first competition and its first contest, **Practice 1**, of kind practice (Phase 4). The bootstrap account becomes the first organization admin (Phase 3).
2. For a later competition, an organization admin selects **New competition** and names its first contest (Phase 5).
3. In Practice 1, an admin imports a CSV file of teams and staff, and Minsky shows a credential sheet once (Phase 2). The admin corrects teams and categories in the editors (Phase 1).
4. The admin selects **Add contest**, names it **Live 1**, and chooses kind live. The roster source defaults to the last contest, Practice 1. The preview says that every team gets a new password, and Minsky then shows the Live 1 sheet once (Phase 4).
5. The admin archives Practice 1 (Phase 7) and opens intake in Live 1 (Phase 4).
6. Later, the admin adds **Practice 2** from Live 1, and teams keep their passwords. Then the admin adds **Live 2** from Practice 2, which issues a new sheet.
7. After the last contest, the admin archives the competition (Phase 5).

Minsky deletes no contest data and has no data reset.

## Names and levels

Additive migrations cannot rename tables, so `labels.ts` maps schema names to product words.

| Product word | Table | What it owns |
| --- | --- | --- |
| Organization | `installation` | Accounts and usernames, organization admins, the organization audit, one database, one bucket, and one Durable Object namespace. |
| Competition | `events` | The name, the order of its contests, the archive state of all its contests, and competition admins. |
| Contest | `sessions` | A name, a kind, and a position. Settings, teams, memberships, contest admins, operational data, the live channel, the contest audit, and from Phase 7 its own archive state. |

One installation holds one organization, so the global username rule is correct. Operational data and the live channel are per session (`src/server/adapters/cloudflare/live.ts:252`), so contests share no operational data.

## Shape

### Contests in a competition

A contest has three properties:

- **Name.** Free text, for example "Live 2", unique within its competition.
- **Kind.** `practice` or `live`, fixed at creation. The kind selects the credential rules below and nothing else.
- **Position.** Contests list by position, then name. A new contest takes the next position. **Reorder** rewrites all positions of a competition in one batch. Positions are not unique, so a reorder never fails on a temporary duplicate.

Two kinds are enough, because only two credential behaviors exist. A label such as "Mock" goes in the name.

The server returns contests in competition and position order, not by name as today (`src/server/adapters/cloudflare/application.ts:184-195`). The picker groups them by competition, with a **Practice** or **Live** badge. Without a remembered contest, the browser opens the first contest that is not archived, not the first listed one (`src/connected/hooks/useSessionSnapshot.ts:63-66`).

### Rosters

**Copy roster** copies one contest's roster into any other contest of the same competition, for example Live 1 into Practice 2. It adds the teams, team memberships, and staff memberships with roles that the target lacks, and changes nothing that exists. So a repeated copy inserts nothing.

`teams.roster_key` links each copied team to the first team in its chain, so every contest maps a team account to the same team. A team that first appears in Live 1 starts its own key.

**Add contest** creates a contest and copies a roster in the same batch. The source defaults to the last contest in the list, and the admin can choose another or none. A new contest also takes the source's categories and image limits. A copy into an existing contest keeps its own, because its issues use them.

A copy never includes operational data, audit records, receipts, the intake state, or the archive state.

### Team credentials

The owner's rule is that leaked practice credentials cannot open the live contest. An account has one password at a time, and that password opens every contest the account belongs to.

The **issuing contest** of an account is the `session_id` of its newest `create_account` or `reset_password` row in `account_operations` that is not superseded. That column already exists (`0003_authentication.sql:14-23`). A team's own password change records no contest (`src/server/adapters/cloudflare/authentication.ts:340`), so it keeps the issuing contest. The `issued_contest` view reads it.

**Rule 1.** A copy into a live contest starts a password reset of each team account that it adds, issued for that contest, in the same atomic batch. The reset is the existing `beginCredentialReset` (`src/server/adapters/cloudflare/credentialReset.ts:13-21`). It revokes every login and sets `credential_state = 'pending'`. A copy into a practice contest resets nobody. Staff keep their passwords.

**Rule 2.** Intake in a live contest opens only if every team account in it has a completed password issued for this contest. A pending reset does not count.

**Rule 3.** While a contest has intake open, its team accounts get new passwords only from that contest. Minsky refuses a reset, a reissue, or a Rule 1 copy from any other contest that would change such a password. The copy preview names the affected contests.

The rules give these results:

| Situation | Result |
| --- | --- |
| Practice 1 to Live 1 | Rule 1 resets each team account. A leaked Practice 1 password fails. |
| Live 1 to Practice 2 | No reset. Teams use their Live 1 passwords. |
| Two practice contests | They share whatever password each team holds. |
| Practice 2 to Live 2 | Rule 1 resets each team account. Live 1 and Practice 2 passwords fail. |
| Live 1 to Live 2 | The same, but refused while Live 1 intake is open (Rule 3). |
| A Practice 2 reissue while Live 1 intake is open | Refused (Rule 3). The admin reissues from Live 1. |
| An existing account attached to a live contest | Rule 2 blocks intake until a reissue from that contest. |
| A CSV import into a live contest | `create_account` names that contest, so Rule 2 passes. |
| A contest that exists today | It becomes live and keeps its passwords, which name it. |

The reset in Rule 1 hashes nothing, because hash samples took 56 to 96 ms of CPU (`docs/history/run-log.md:1701-1703`) and the Worker has `cpu_ms: 1000` (`src/server/adapters/cloudflare/tooling/configuration.mjs:76`). After the copy, the browser calls `CredentialBatches.next` until no account remains. Each call hashes the passwords that fit in one request and returns them for the sheet. No password is stored, so a lost response needs **Issue again**.

### Authority

`admin_grants` holds grants with scope `installation` for organization admins or `event` for competition admins. A contest admin is still `memberships.is_admin` and satisfies no grant check. `create_event`, `grant_admin`, and `revoke_admin` need `installation`. Other `Setup` commands need `event`.

Bootstrap writes the first installation grant. On an older installation, the owner runs the trusted recovery command once. Later grants go through `POST /api/setup`, which reverses `0008_installation.sql:1` for grants only. Each authority check runs inside the write batch of its command.

A grant gives authority over structure, not access to data. Contest access stays an ordinary membership, so `currentAccessSql` (`src/server/adapters/cloudflare/application.ts:31-53`) stays unchanged. To read a contest, an organization admin runs `join_session`, which adds an admin membership.

A contest admin can never reset an account that holds a grant. Otherwise a contest admin could take over the owner's grant, because today a contest admin may reset any account in the admin's contests (`src/server/adapters/cloudflare/authentication.ts:189-203`).

### Archive

Phase 5 archives a competition on `events.archived`. Phase 7 adds `sessions.archived_at` and the `contest_state` view, so each contest archives alone. An archived contest rejects every write and stays readable.

`installation.session_id` points at bootstrap's first contest, the anchor (`0008_installation.sql:2-9`). Owner recovery requires an admin membership in the anchor and an active event (`src/server/adapters/cloudflare/installation.ts:140-145`). The anchor is usually Practice 1, the first contest to be archived. So Phase 5 moves owner recovery to the installation grant before Phase 7 can archive the anchor.

### Audit

`organization_audit` records grants, new competitions, competition archives, and reorders. The existing contest audit, `admin_audit`, records `add_session`, `join_session`, a contest archive, and `copy_roster` with its source and counts. An existing trigger already audits each Rule 1 reset in the target (`0009_notifications.sql:8-13`).

### Setup module

`Setup` has three methods. `overview()` lists the competitions and contests the caller administers. `preview(command)` reports what a command would create, copy, and reset, and writes nothing. `execute(requestId, command)` runs one command in one atomic batch, which repeats every check of the preview. `setup_receipts` keys each command on the actor and the request ID, so a retry returns the first result. A grant change bumps `access_version`, so the existing optimistic guards reject commands that started before it.

### Type sketch

```ts
// src/backend/contracts.ts. EventId, SessionId, and AccountId are branded strings.
export type SessionKind = 'practice' | 'live';

/** Phase 2. A password exists only in the response of next. */
export interface CredentialBatches {
	begin(sessionId: SessionId, request: { import: RosterRow[] } | { reissue: AccountId[] }): Promise<{ usernames: string[] }>;
	next(sessionId: SessionId): Promise<{ issued: Array<{ username: string; temporaryPassword: string }>; remaining: number }>;
}

export type GrantScope = { scope: 'installation' } | { scope: 'event'; event_id: EventId };
export type NewContest = { name: string; kind: SessionKind };

export type SetupCommand =
	| { type: 'grant_admin'; username: string; grant: GrantScope }                      // Phase 3
	| { type: 'revoke_admin'; account_id: AccountId; grant: GrantScope }                // Phase 3
	| ({ type: 'add_session'; event_id: EventId; from: SessionId | null } & NewContest) // Phase 4
	| { type: 'copy_roster'; from: SessionId; to: SessionId }                            // Phase 4
	| { type: 'order_sessions'; event_id: EventId; order: SessionId[] }                  // Phase 4
	| { type: 'join_session'; session_id: SessionId }                                    // Phase 4
	| { type: 'create_event'; name: string; first: NewContest }                          // Phase 5
	| { type: 'set_archived'; target: { event_id: EventId } | { session_id: SessionId }; archived: boolean }; // Phase 5 and 7
```

A `RosterRow` is one CSV line for a team or a staff member. `order_sessions` lists every contest of the competition once. `requiredAuthority` maps each command type to `installation` or `event`, so a new command without an entry fails to compile.

### Migration sketch

Each phase takes the next free migration number on `main` when its pull request opens. Numbers up to `0012_history_index.sql` are taken.

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

-- Phase 4. Contests in a competition. Every existing contest is live.
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('practice', 'live'));
CREATE TRIGGER session_kind_fixed BEFORE UPDATE OF kind ON sessions
WHEN NEW.kind <> OLD.kind
BEGIN
	SELECT RAISE(ABORT, 'A contest kind is fixed at creation');
END;
ALTER TABLE sessions ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
-- NULL means the team is its own original. The index makes a repeated copy insert nothing.
ALTER TABLE teams ADD COLUMN roster_key TEXT;
CREATE UNIQUE INDEX teams_roster_key ON teams(session_id, COALESCE(roster_key, id));
CREATE INDEX account_operations_by_account ON account_operations(account_id);
-- The contest of each account's newest admin-issued password. Rules 2 and 3 read it.
CREATE VIEW issued_contest AS
	SELECT o.account_id, o.session_id, o.state FROM account_operations o
	WHERE o.rowid = (SELECT n.rowid FROM account_operations n WHERE n.account_id = o.account_id
		AND n.action IN ('create_account', 'reset_password') AND n.state <> 'superseded'
		ORDER BY n.rowid DESC LIMIT 1);
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

Each phase is one draft pull request into `main`. Workers Builds applies a merged migration before it publishes the Worker, so each migration must work under the previous Worker. Each phase ends with `npm run ci`, `npm run test:d1`, `npm run test:connector:runtime`, and its focused tests. To revert a phase, revert its pull request.

Phases 0 to 7 are required for the first production contest. Phases 8 to 10 can follow it. The owner's readiness audit of 2026-10-25, which is not in the repository, maps its steps 8 to 10 to Phases 1, 2, and 5.

### Phase 0. Remove the second contest list (built in #95)

Draft pull request #95 deletes `D1AuthenticationService.sessions()`, which returns the ID as the name (`src/server/adapters/cloudflare/authentication.ts:348-352`), and everything that serves it.

### Phase 1. Team and category editors (built in #96)

Draft pull request #96 lets a contest admin add, rename, and delete teams and edit the category list. It adds no migration.

### Phase 2. Bulk accounts (required)

Branch `feature/bulk-accounts`. A contest admin imports a CSV file of teams and staff through `CredentialBatches`. No migration. First measure the hashing cost at concurrency. Check with D1 tests: the begin step is atomic, a resumed batch creates no duplicate account, and no temporary password stays in any D1 table. Add a browser test for the sheet.

### Phase 3. Organization admins (required)

A migration adds `admin_grants` and `organization_audit`. Bootstrap and the recovery command write the first grant. `Setup` ships with `grant_admin` and `revoke_admin` on an **Administrators** page. A contest admin can no longer reset a grant holder. Check with D1 tests: a contest admin cannot grant or reset the owner, and a repeated request ID writes one grant. `minsky-dev` shows no setup page until the owner runs the recovery command. An agent does not run it.

### Phase 4. Contests in a competition (required)

A migration adds the Phase 4 schema, and the bootstrap configuration gains the first contest's kind. `Setup` gains `add_session`, `copy_roster`, `order_sessions`, `join_session`, and `preview`. Rules 1 to 3 ship in the same pull request, because without them contests would share passwords. A second pull request adds the new `SessionSummary` fields and the grouped picker. Check with D1 tests:

- A copy in each direction maps team accounts by roster key, copies no operational data, and inserts nothing when repeated. The preview counts equal the inserted rows.
- A copy into live revokes old passwords, and a copy into practice revokes none.
- Live intake fails before the sheet and after a newer password from another contest.
- Rule 3 refuses a reset and a live copy that touch a team in another contest with open intake.
- `join_session` restores access after a contest admin removes the owner.

### Phase 5. Competitions and competition archive (required)

Branch `feature/archive-event`. A **Competitions** page offers `create_event`, which also creates the first contest, and `set_archived` for a competition. Owner recovery checks the installation grant instead of a membership in the anchor. Check with D1 tests: an archived competition rejects writes, and owner recovery works after the anchor's competition is archived.

### Phase 6. Account authority (required)

`accountAuthority` replaces the target branch of `adminCondition`, and keeps Rule 3. A grant covers every contest of its competition, archived or not. Today any membership of the target in an archived event blocks its reset (`src/server/adapters/cloudflare/authentication.ts:198`). After Phase 7, an archived Practice 1 would block resets in Live 1. Check with D1 tests: a team account in an archived practice contest can be reset, and a contest admin still cannot reset an account outside the admin's contests.

### Phase 7. Archive one contest (required)

Phase 7 needs Phase 5. A migration adds `sessions.archived_at` and `contest_state`. In the same pull request, one sweep moves every direct read that the grep in [Problem](#problem) lists to `contest_state`, and a repository test fails on a new direct read. A missed read would leave a write path open. Check with D1 tests: Practice 1 archives while Live 1 keeps working, and an archived contest rejects every write. A revert makes contests archived through `archived_at` writable again.

### Phase 8. Contest addresses (later)

Routes under `/contests/<id>/` keep the contest after a refresh. Check with a browser journey that refreshes a deep link.

### Phase 9. Accounts across competitions (later)

Today a contest admin can add any account by its UUID (`src/organiser/admin/AccountForms.tsx:373`). `attachAuthority` limits that to accounts of the same competition. Roster copies between competitions wait for it.

### Phase 10. Hosted control plane (later)

This phase waits for the hosted service decision. A separate Worker would provision and migrate installations.

## Decisions

The owner decided these points on 2026-10-25:

1. The product names are Organization, Competition, and Contest.
2. Admins grant and revoke admin rights in the app. The first admin comes from a trusted command. The last organization admin cannot be removed.
3. Team accounts keep their usernames, and the live contest gets fresh temporary passwords.
4. Organization admins see contest data only after `join_session`, which the contest audit records.
5. Cloudflare is the only backend for this design.
6. The first production contest needs team and category editors, bulk accounts, competitions and contests, and archive.
7. Correction: "Each competition can have multiple contests. Live and practice contests are just examples. In reality a competition can have more than two contests, e.g. practice 1, live 1, practice 2, live 2, etc." A competition now holds an ordered list of contests instead of one practice and one live contest. Decision 3 applies to each live contest.

These decisions are still open:

- Whether the hosted service runs one installation per organization. Only Phase 10 waits for it.
- Whether team accounts must change their temporary password. This design keeps today's forced change.

## Tradeoffs accepted

- Each live copy ends team sign-ins to earlier contests, and a lost credential response must be issued again. In exchange, no password is stored, and no password from another contest opens live intake.
- Rule 3 blocks a reset while two contests that share a team both have intake open. The admin closes one first.

## Alternatives considered

- **One roster per competition.** Issues reference `teams(session_id, id)` (`0001_transaction_proof.sql:60`), and `memberships` keys on `session_id` (`0001_transaction_proof.sql:34-42`). A change to those keys needs a table rebuild.
- **A reset on every copy.** A copy into Practice 2 would sign teams out of Live 1 and print a sheet that nobody needs.

## Risks

- **Sign-in burst.** After a live copy, every team signs in and changes its password. The change runs a verify, a hash, and a second verify (`src/server/adapters/cloudflare/authentication.ts:310-346`). Nobody has measured this burst at 800 users.
- **Copy cost.** A copy writes each team account several times, including the `membership_added` trigger (`0001_transaction_proof.sql:117-120`) and the reset triggers, in one batch on the single D1 primary (`ROADMAP.md:23`). Nobody has measured this cost. Copy the roster well before a live contest opens.

## Next implementation step

Review and merge Phases 0 and 1. Then build Phases 2 and 3. They are independent.
