# Multiple competitions per installation

**Status.** Proposed. Not implemented.
This page records a design for the owner to decide on. Nothing in it exists on `main` at `a3db2ad`, and every `path:line` citation refers to that revision.

## Problem

The owner wants an admin to create several competitions in one Minsky installation, each with a practice contest and a live contest.
The owner also plans a free hosted service for many organizations, like Let's Encrypt, and self-hosting from the same code.

Four facts on `main` decide the shape:

- Usernames and emails are unique across the whole database (`src/server/adapters/d1/migrations/0003_authentication.sql:5`, `0004_identity.sql:6,11`). D1 migrations may only add schema, so usernames cannot become unique per organization.
- Only the trusted installer creates events, sessions, and teams. `0008_installation.sql:1` says "No HTTP endpoint can grant this authority", and `src/server/adapters/cloudflare/installation.ts:82-85` says the same of bootstrap. In-product creation reverses that decision.
- `events.archived` is the only read-only flag (`0001_transaction_proof.sql:18-22`). Thirteen lines in seven D1 files read it directly. A practice contest and a live contest in one event would share it.
- One D1 database has one primary, runs one query at a time, and holds at most 10 GB (`ROADMAP.md:24`).

To reproduce the archive count, run `grep -rnE "\b(e|te)\.archived" src/server --include=*.ts | grep -vE "\.test\.ts|Cases\.ts"`.

## How an admin uses it

Each step names the phase that ships it.

**Create a competition (Phase 2).** An organization admin opens **Competitions** and selects **New competition**. The form asks for a name and a team list, which the admin can paste as CSV. Minsky creates the competition with two contests, **Practice** and **Live**, with the same teams. The admin becomes an admin of both contests.

**Add a practice contest from the live roster (Phase 1).** On **Administration**, then **Settings**, an organization admin sees **Contests in this competition** and an **Add contest** form. The form asks for a name and a kind, practice or live. Three boxes are checked by default: teams, staff, and settings. Before the admin confirms, the form shows a preview. For example, the copy creates 24 teams, 6 staff members, and 24 team accounts, with 5 categories and the image limits. The preview also lists what the copy never includes: issues, history, resolutions, awards, images, announcements, audit records, and receipts. Intake starts closed. After the admin confirms, the app opens the new contest.

**Switch between contests (Phase 4).** Each contest has its own address, such as `/contests/<id>/issues`, so a refresh stays on it. The switcher groups contests by competition and puts archived contests last. A practice contest shows a **Practice contest** badge in the console header, the contestant top bar, and the switcher.

**Start another practice round (Phase 5).** The admin adds a new practice contest from the old one, then archives the old one. Nothing is deleted. Minsky has no reset.

The same steps in client code look like this:

```ts
const command = {
	type: 'add_session', event_id: live.event.id,
	session: { name: 'Practice contest', kind: 'practice' },
	seed: { from: 'session', session_id: live.id, teams: true, staff: true, settings: true },
} satisfies SetupCommand;
const preview = await backend.setup.preview(command);   // shown in the form, writes nothing
const { sessionId } = await backend.setup.execute(requestId, command);
navigate(sessionPath(sessionId, 'queue'));

const created = await backend.setup.execute(requestId, practiceAndLive('NOI 2027', roster));

const list = await backend.workflows.sessions(userId);  // unordered from either provider
const current = chooseSession(list, route.sessionId, remembered);
```

A retry after a lost response reuses `requestId`. It returns the first result and writes nothing.

## Names and levels

The product uses three words for three levels. The schema keeps its table names, because additive migrations cannot rename tables, and code names follow the schema. `labels.ts` is the only map from schema names to product words. A docs glossary states the same map.

| Product word | Table | What it owns |
| --- | --- | --- |
| Organization | `installation` | Accounts and usernames, organization admins, the organization audit, one database, one bucket, and one Durable Object namespace. |
| Competition | `events` | The name, the archive state of all its contests, and competition admins. |
| Contest | `sessions` | A fixed kind, practice or live. Intake, categories, image limits, teams, memberships, contest admins, issues, awards, announcements, images, the live channel, and the contest audit. From Phase 5, its own archive state. |

Existing `sessionId` parameters already mean "contest ID" and keep their names.

## Shape

### Data

A competition is an `events` row. A contest is a `sessions` row with a new `kind` column. All operational data already belongs to one session, and the live channel is already per session (`src/server/adapters/cloudflare/live.ts:252`). So practice and live share no issues, awards, announcements, or images.

Migration 0012 adds the `admin_grants` table, `sessions.kind`, `teams.roster_key`, the `setup_receipts` table, and an index on `memberships(account_id)`. It writes no rows. Migration 0013 in Phase 2 adds `installation.name` and `organization_audit`. Migration 0014 in Phase 5 adds `sessions.archived_at` and the `contest_state` view.

### Authority

`admin_grants` holds grants with scope `installation` or `event`. An organization admin holds an `installation` grant. A competition admin holds an `event` grant. A contest admin is still `memberships.is_admin`. The two checks, `installationAdmin` and `eventAuthority`, read only `admin_grants`, so no contest admin can satisfy them.

The root of authority is a trusted command, not an HTTP path:

- On Cloudflare, `npm run cloudflare:install -- grant-admin --installation <uuid> --account <uuid>` writes an installation grant. Today the installer accepts only `bootstrap` and `recover` (`src/server/adapters/cloudflare/tooling/operations.mjs:138`).
- On Supabase, a trusted SQL script writes the same grant.
- Bootstrap writes the first grant on both providers. Owner recovery re-inserts it if someone revoked it.
- A rerun of `grant-admin` writes nothing, because it uses `ON CONFLICT DO NOTHING` on `admin_grants_installation`.

Later grants go through `POST /api/setup`. This reverses `0008_installation.sql:1` for grants only. The `installation` row and its owner stay command-line only. Each authority check runs inside the D1 write batch of its command, because a check before the batch proves nothing at commit time. Provider access creates no grant and no membership.

A grant gives authority over structure, not access to data. Whoever creates a contest becomes its admin through an ordinary membership. So `currentAccessSql` (`src/server/adapters/cloudflare/application.ts:32-50`) and everything that reads it stay unchanged. An organization admin who needs to read or repair a contest runs `join_session`, which writes a contest audit row.

A contest admin can never reset an account that holds a grant. Today a contest admin may reset any account if that admin administers every contest the account belongs to (`src/server/adapters/cloudflare/authentication.ts:159-173`). The owner is an admin of every contest the owner creates, and a copy also copies the other admins. Without the new rule, one of those admins could reset the owner's password and use the owner's grant. Phase 1 ships the rule, because Phase 1 gives the owner's account that power.

Phase 3 fixes two problems in today's account rules. First, a contest admin can add any account by its UUID (`src/organiser/admin/AccountForms.tsx:372-373`). `attachAuthority` allows a new member only from the same competition, unless the actor already has authority over that account. Second, any membership in an archived event blocks resets of that account (`authentication.ts:168`). A grant covers every contest of its competition, archived or not.

### Practice and live

`add_session` copies teams, team account memberships, staff, roles, and settings with a fixed number of `INSERT ... SELECT ... ON CONFLICT DO NOTHING` statements. `teams.roster_key` maps each copied team to its source team, so a repeated or reverse copy inserts nothing. The new contest starts with intake closed. One team account and one password work in both contests. The kind is fixed at creation, so a practice contest can never become the record of real awards.

### Setup module

`Setup` has three methods. `overview()` lists the competitions the caller administers. `preview(command)` reports what a copy creates and what it does not copy. `execute(requestId, command)` runs one command in one atomic batch. `Workflows` and `Announcements` have the same shape.

Callers pass drafts (`RosterDraft`, `SessionDraft`, and `SessionSeed`). Templates and CSV parsing are pure client functions that produce drafts. `execute` hides the authority check, ID generation, roster keys, the copy statements, the creator's membership, receipts, and audit rows. A caller never coordinates copy steps.

`preview` accepts only the commands that create contests or teams, and it writes nothing. For a seed from another contest, the counts come from the same SQL `WHERE` fragments that `addSessionStatements` uses. For a draft, the counts come from the draft. `notCopied` is one constant in `setupModel.ts`, and the form prints it. A D1 test checks that the preview counts equal the rows that `execute` inserts. The preview is advisory, because rows can change before the commit.

From Phase 2, `create_event` and bootstrap both write a competition through `createEventStatements`.

`requiredAuthority` maps each command type to the authority it needs. A new command without an entry fails to compile. A repository test fails if `currentAccessSql` mentions `admin_grants`.

### Client

`SessionSummary` gains the kind, the competition, the archive state, and the intake state. Providers return the list unordered, and the browser sorts it with `sortSessions`. Today D1 orders by name (`application.ts:177-188`) and Supabase does not order the list (`src/backend/supabase/backend.ts:120`).

The address holds the contest, and `useSessionSnapshot` reads it from the route. Today the selection lives only in React state and falls back to the first listed contest (`src/connected/hooks/useSessionSnapshot.ts:63-66`). `localStorage` remembers the last contest only for `/`.

### Tenancy and the hosted service

One installation holds exactly one organization. A self-hoster runs one installation. The hosted service runs one installation per organization, each with its own D1 database, R2 bucket, Durable Object namespace, origin, and `AUTH_SECRET`.

So the global username rule is the correct rule per organization, and two organizations can both have `team01`. No query can mix organizations, because no database holds two of them. Each organization gets its own D1 primary. No table has an `organization_id` column. A separate control plane provisions installations, as [Phase 7](#phase-7-hosted-control-plane) describes. On Postgres, the same rule maps to one database or schema per organization. That mapping is unverified on PlanetScale and Hyperdrive.

### Validation and idempotency

`setupCommandSchema` parses commands at the HTTP boundary. Inside the server, the types are trusted. `setup_receipts` keys each command on the actor and the request ID. The same request ID with the same command returns the first result. The same request ID with a different command is rejected. A grant change bumps `access_version`, so the existing optimistic guards reject commands that started before the change.

### Type sketch

```ts
// src/backend/contracts.ts
export type EventId = Brand<string, 'EventId'>;      // a competition
export type SessionId = Brand<string, 'SessionId'>;  // a contest
export type AccountId = Brand<string, 'AccountId'>;
export type SessionKind = 'practice' | 'live';

/** One contest the caller belongs to. Replaces `{ id, name }`. Providers return it unordered. */
export interface SessionSummary {
	id: SessionId;
	name: string;
	kind: SessionKind;
	event: { id: EventId; name: string };
	archived: boolean;   // the competition is archived. Phase 5 adds the contest.
	intakeOpen: boolean; // Phase 4
}

export interface Setup {
	/** Competitions the caller administers, each with every contest. Empty for everyone else. */
	overview(): Promise<SetupOverview>;
	/** Writes nothing. Uses the same SQL fragments as execute. Advisory, because rows can change. */
	preview(command: PreviewCommand): Promise<SetupPreview>;
	/**
	 * One atomic batch. The same request ID with the same command returns the first result.
	 * Only SetupRejectedError confirms a rejection. After any other failure the outcome is
	 * unknown, and the caller keeps the request ID for its retry.
	 */
	execute<C extends SetupCommand>(requestId: string, command: C): Promise<SetupResults[C['type']]>;
}

export interface Backend {
	// auth, workflows, admin, images, announcements, and updates are unchanged.
	setup: Setup;
}

// src/connected/setupModel.ts, shared by the browser and both servers
export const notCopied = ['issues', 'history', 'resolutions', 'awards', 'images',
	'announcements', 'audit records', 'receipts', 'intake state (a new contest starts closed)'] as const;

export interface SetupPreview {
	creates: { sessions: number; teams: number; staff: number; teamAccounts: number; categories: string[] };
	notCopied: typeof notCopied;
	warnings: Array<{ kind: 'contest_name_taken' | 'source_has_no_teams'; name?: string }>;
}

export interface TeamDraft { name: string; location: string }
export interface RosterDraft { categories: string[]; teams: TeamDraft[] }
export interface SessionDraft { name: string; kind: SessionKind }
export type SessionSeed =
	| { from: 'session'; session_id: SessionId; teams: boolean; staff: boolean; settings: boolean }
	| { from: 'draft'; roster: RosterDraft };
export type GrantScope = { scope: 'installation' } | { scope: 'event'; event_id: EventId };
export type ArchiveTarget = { event_id: EventId } | { session_id: SessionId };

export type SetupCommand =
	| { type: 'add_session'; event_id: EventId; session: SessionDraft; seed: SessionSeed }   // Phase 1
	| { type: 'join_session'; session_id: SessionId }                                        // Phase 1
	| { type: 'create_event'; name: string; roster: RosterDraft; sessions: [SessionDraft, ...SessionDraft[]] } // Phase 2
	| { type: 'grant_admin'; username: string; grant: GrantScope }                             // Phase 2
	| { type: 'revoke_admin'; account_id: AccountId; grant: GrantScope }                       // Phase 2
	| { type: 'set_archived'; target: ArchiveTarget; archived: boolean }                       // Phase 2, contests in Phase 5
	| { type: 'copy_roster'; from: SessionId; to: SessionId; teams: boolean; staff: boolean }; // Phase 6

/** The commands that create contests or teams. Only these have a preview. */
export type PreviewCommand = Extract<SetupCommand, { type: 'add_session' | 'create_event' | 'copy_roster' }>;

export interface SetupResults {
	add_session: { sessionId: SessionId };
	join_session: Record<string, never>;
	create_event: { eventId: EventId; sessionIds: SessionId[] };
	grant_admin: { accountId: AccountId };
	revoke_admin: Record<string, never>;
	set_archived: Record<string, never>;
	copy_roster: { teamsAdded: number; membersAdded: number };
}

// src/server/adapters/cloudflare/authority.ts
/**
 * 'event' means a grant on the competition that owns the target contest, or an installation grant.
 * A copy source must belong to the same competition. Grants change only with an installation grant,
 * because the map cannot read the requested scope.
 */
export const requiredAuthority: { [T in SetupCommand['type']]: 'installation' | 'event' } = {
	add_session: 'event', join_session: 'event', set_archived: 'event', copy_roster: 'event',
	create_event: 'installation', grant_admin: 'installation', revoke_admin: 'installation',
};

/**
 * May the actor change this account's credentials or username? Replaces the target branch of
 * adminCondition in authentication.ts and authorize_account_admin on Supabase.
 * Every membership of the target must be covered. A grant covers any contest of its competition,
 * archived or not. A contest admin membership covers only an active contest.
 * Every grant the target holds must be covered by a grant the actor holds.
 */
export declare function accountAuthority(actor: AccountId, target: AccountId): SqlCheck;
```

### Migration 0012 sketch

```sql
-- 0012_contests.sql. Every statement only adds schema.

-- Authority above the contest. Each grant names one application account.
-- Bootstrap, owner recovery, and the trusted grant-admin command write grants with
-- granted_by NULL. Only an existing grant holder writes any other grant.
-- No memberships.is_admin flag satisfies a grant check. Provider access writes nothing here.
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
CREATE INDEX admin_grants_by_event ON admin_grants(event_id) WHERE event_id IS NOT NULL;

-- A grant is inserted or deleted, never edited. Each change bumps access_version,
-- so the existing optimistic guards reject commands that started before the change.
CREATE TRIGGER admin_grant_immutable BEFORE UPDATE ON admin_grants
BEGIN
	SELECT RAISE(ABORT, 'Admin grants are replaced, not edited');
END;
CREATE TRIGGER admin_grant_added AFTER INSERT ON admin_grants
BEGIN
	UPDATE accounts SET access_version = access_version + 1 WHERE id = NEW.account_id;
END;
CREATE TRIGGER admin_grant_removed AFTER DELETE ON admin_grants
BEGIN
	UPDATE accounts SET access_version = access_version + 1 WHERE id = OLD.account_id;
END;

-- Practice or live, fixed at creation. A practice contest never becomes the record
-- of real awards. Every existing contest is live.
ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('practice', 'live'));
CREATE TRIGGER session_kind_fixed BEFORE UPDATE OF kind ON sessions
WHEN NEW.kind <> OLD.kind
BEGIN
	SELECT RAISE(ABORT, 'A contest kind is fixed at creation');
END;

-- One team across the contests of a competition. NULL means the team is its own
-- source, so the key is COALESCE(roster_key, id). A copy stores its source's key.
-- The expression index makes a repeated or reverse copy insert nothing.
ALTER TABLE teams ADD COLUMN roster_key TEXT;
CREATE UNIQUE INDEX teams_roster_key ON teams(session_id, COALESCE(roster_key, id));

-- One request ID identifies one setup command and its retries.
CREATE TABLE setup_receipts (
	actor TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
	request_id TEXT NOT NULL,
	command TEXT NOT NULL CHECK (json_valid(command)),
	result TEXT NOT NULL CHECK (json_valid(result)),
	at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	PRIMARY KEY (actor, request_id)
) STRICT;

-- The contest list query filters memberships by account. Every client runs it every
-- 10 seconds. Without this index, SQLite scans the primary key index.
CREATE INDEX memberships_by_account ON memberships(account_id);
```

The Supabase twin adds `kind`, `roster_key`, `app_private.admin_grants`, `app_private.setup_receipts`, the setup functions, and the grant-holder rule in `authorize_account_admin`. It writes no grant, because `supabase/migrations/202610020001_cloud.sql:1` forbids automatic admin promotion in migrations. It needs no new index, because `memberships_user` already exists (`supabase/migrations/202610020002_indexes.sql:4`).


## Synthesis decision

Two independent design drafts answered the same brief, and a review scored both and checked their claims. This design uses the first draft as the base.

**Why the first draft.** Authority is the hardest part to change later, and the first draft handles it best. It has one grant table, a check inside the write batch, and an unchanged `currentAccessSql`. It protects grant holders from contest admins, frees owner recovery from the first competition, and adds `join_session` for repair. It keeps `events` as the parent and `sessions` as the child, which matches the snapshot's `event` field (`src/connected/model.ts:76-78`) and line 44 of [product direction](product-direction.md). The second draft made "event" mean contest in storage while the product says competition. The first draft also has the smaller interface, and an executable script tested its schema and copy statements. The cost is that one contest cannot be archived alone until Phase 5.

The base takes six grafts:

1. The `memberships_by_account` index, from the second draft. The review found that the contest list query scans the primary key index.
2. The exhaustive `requiredAuthority` map and the `currentAccessSql` test, from the second draft.
3. `Setup.preview` and the single `notCopied` list, from the second draft. That draft built its preview on a TypeScript planner. This design has no planner, so a preview of a copy reuses the copy SQL, and a test compares its counts with `execute`. The preview accepts only the commands that create contests or teams, because the review objected to a preview that accepts any command.
4. The trusted `grant-admin` command as the root, from the second draft on the review's advice. It replaces the first draft's migration that backfilled the owner's grant. It works the same way on both providers, and no migration promotes anyone.
5. A concrete control plane phase, from the second draft. The first draft left the hosted service unscheduled.
6. A complete Phase 0, from the review. The first draft deleted only the server route. The browser method, the alias in `http.ts`, and the routing exception must go too.

The review corrected two claims. The first draft said that Cloudflare documentation confirms Workers for Platforms bindings. That claim is unverified. The second draft said that Supabase `events.contest_type` allows "individual or group". It allows only `'group'` (`202610020001_cloud.sql:8`).

This design rejects these parts of the second draft:

- A `competitions` table above `events`, with each contest as its own `events` row. Per-contest archive is free, but "event" would mean two levels.
- Two grant tables, `operators` and `competition_admins`. One table with a scope is enough.
- A looser archive rule for account changes, in place of grant coverage.
- A pass-through `list` method and a chain of exported internal stages.
- A shared TypeScript planner. Set-based SQL keeps a copy at a fixed number of statements.

Both drafts reached these points independently, so this design treats them as settled:

- One installation is one organization. The hosted service runs one installation per organization, with no organization column.
- The contest creator gets an ordinary admin membership, and `currentAccessSql` does not change.
- Practice and live are separate rows with their own operational data and live channel.
- A copy includes teams, team accounts, staff, roles, and settings, and never operational data.
- No reset exists. Receipts keyed by request ID make setup idempotent.
- The contest goes into the address, and the client orders the list.

## Tradeoffs accepted

- We accept one database per organization and a provisioning tool, in exchange for per-organization usernames without a schema change.
- We accept code names that differ from product names, in exchange for no table renames.
- We accept that a grant holder runs `join_session` to read a contest, in exchange for an unchanged access check.
- We accept that only an organization admin grants or revokes admins. The authority map cannot read the requested scope, and the rule also limits who can raise authority.
- We accept a preview that can differ from the commit, in exchange for a preview that writes and locks nothing.
- We accept the copy rule in two languages, D1 SQL and PL/pgSQL, in exchange for a fixed number of statements per copy.
- We accept copied rosters that drift after a late change until Phase 6, in exchange for keys, issue numbers, and live channels that stay per contest.
- We accept a manual `grant-admin` run on each existing installation, in exchange for no promotion inside a migration.
- We accept the Phase 5 sweep, in exchange for one archive rule per provider and a test that blocks new direct reads.

## Alternatives considered

- **Many organizations in one database.** Two organizations could not both create `admin`. A prefix such as `acme-` must fit the 32-character username limit. Every query must filter by organization, and all organizations share one D1 primary. This shape gives callers the most to get wrong.
- **One roster per competition.** Issues reference `teams(session_id, id)` (`0001_transaction_proof.sql:60`), and `memberships` keys on `session_id` (`0001_transaction_proof.sql:34-42`). Changing those keys needs a table rebuild.
- **Access derived from a grant.** If `currentAccessSql` accepted a grant, the snapshot, the admin gate, announcements, images, and live sockets would all change at once. Explicit memberships give the same result.
- **One installation per contest.** Practice and live would share no accounts. Reset authority across a person's contests needs one database (lines 114-118 of [Cloudflare backend design](cloudflare-backend-design.md)).

## Risks

- **Shared team credentials.** Credentials handed out for practice also open the live contest.
- **A copy during a running contest.** Each copied membership fires the `membership_added` trigger, which updates `accounts` (`0001_transaction_proof.sql:117-120`). A copy of N team accounts therefore writes about 2N rows plus the team rows in one batch on the single D1 primary. Nobody has measured this. Each copied account also sees one retry. Create the practice contest before the live contest opens.
- **The anchor contest.** `installation.event_id` and `installation.session_id` point at the first contest (`0008_installation.sql:2-9`), and owner recovery needs it active (`installation.ts:140-145`). Until Phase 2, do not archive the first competition.
- **Two contests on one primary.** No measurement supports 800 users while a practice contest and a live contest run together.
- **Hosted limits.** D1 and R2 limits per account, Workers for Platforms bindings, and prices are unverified. The estimate of about 160 requests per second from polling at 800 users is also unverified.
- **Supabase issue numbers.** Supabase numbers issues with one global sequence (`supabase/migrations/202610020001_cloud.sql:54`), so practice and live numbers interleave there.

## Decisions the owner must make

1. Do the product names Organization, Competition, and Contest work for you? This design assumes yes.
2. May admins grant admin authority over HTTP, which reverses `0008_installation.sql:1` for grants only? This design assumes yes, with the first grant from `grant-admin`, bootstrap, or recovery only.
3. How should team credentials work across practice and live? This design assumes one shared password. The alternatives are new live passwords at copy time, or separate team accounts per contest.
4. Should an organization admin see contest data without a membership? This design assumes no. The admin runs `join_session`, and the contest audit records it.
5. Should the hosted service run one installation per organization? This design assumes yes.

## Delivery phases

Each phase is one draft pull request into `main` with the D1 and Supabase changes together. Workers Builds applies a merged migration before it publishes the Worker, so each migration must work under the previous Worker. Each phase ends with `npm run ci`, the local Supabase adapter tests, and the focused tests named below. To revert any phase, revert its pull request. Each migration only adds schema, so the old Worker ignores it. Phase 5 has one exception.

### Phase 0. Remove the second contest list

This phase deletes `D1AuthenticationService.sessions()` (`src/server/adapters/cloudflare/authentication.ts:318-322`), which returns the ID as the name. It also deletes the route (`src/server/authenticationHttp.ts:64`), the browser method and schema (`src/backend/cloudflare/authentication.ts:13,155-158`), the alias (`src/server/adapters/cloudflare/http.ts:72`), and the routing exception (`src/server/adapters/cloudflare/applicationWorker.ts:55`). The test probe at `authenticationCases.ts:705-706` moves to `accountStatus()`. The authentication and hosted HTTP tests verify it. Nothing breaks for users, because no product code calls the browser method.

### Phase 1. Add a practice contest

This phase ships migration 0012, `grant-admin`, the first grant in bootstrap, `authority.ts`, the grant-holder reset rule, and `Setup` for `add_session` and `join_session`. It also ships `SessionSummary.kind` and `event`, the **Add contest** form with its preview, the badge, and docs. Tests on D1 and on Supabase with embedded PostgreSQL cover these cases:

- A copied team account lands on the copied team, and no `notCopied` item copies.
- The preview counts equal the inserted rows.
- A contest admin without a grant is rejected and cannot reset the owner.
- A repeated request ID returns one contest.
- `join_session` restores access after a contest admin removes the owner.

One manual browser check confirms that an issue filed in practice never appears in the live queue. Copied accounts each see one retry. `minsky-dev` shows no setup panel until the owner runs `grant-admin` once. An agent does not run it.

### Phase 2. Competitions and competition admins

This phase ships migration 0013, `create_event`, `grant_admin`, `revoke_admin`, and competition archive. It also ships CSV team import, the **Competitions** page, bootstrap through `createEventStatements`, and owner recovery that needs only the owner record. Tests show that one call makes both contests and that the last organization admin cannot be revoked. A further test shows that owner recovery works after the first competition is archived. Nothing existing breaks.

### Phase 3. Account authority across competitions

This phase ships `accountAuthority` and `attachAuthority` on both providers. **Add a person from this competition** replaces the UUID field. Tests reject a cross-competition attach and allow resets of staff who also belong to an archived practice contest. An admin who attached accounts across competitions must now ask an organization admin.

### Phase 4. Contest addresses and the switcher

This phase ships routes under `/contests/<id>/`, `sortSessions`, `chooseSession`, `groupByEvent`, and `intakeOpen`. Unit tests cover order and choice. The browser journey opens a deep link and refreshes. Phone and keyboard checks cover the switcher. Old bookmarks pass through one redirect.

### Phase 5. Archive one contest

This phase ships migration 0014 and one sweep that moves the 13 D1 reads to `contest_state` or `currentAccessSql`. On Supabase, `app_private.contest_archived` replaces the direct reads in 18 function names, some of them superseded. To reproduce that count, run `awk 'tolower($0) ~ /create (or replace )?function/ { match(tolower($0), /function [a-z_.]+/); name=substr(tolower($0), RSTART+9, RLENGTH-9) } /archived/ && name != "" { print name }' supabase/migrations/*.sql | sort -u | wc -l`. A repository test fails on a new direct read. Tests show that practice archives while live keeps working. This is the widest change, so it ships as one pull request with the guard test. A missed read would leave one write path open in an archived contest. After a revert, a contest archived through `archived_at` becomes writable again, because the old Worker reads only `events.archived`.

### Phase 6. Roster sync and bulk accounts

This phase ships `copy_roster`, CSV teams into an existing contest, and a bulk team account flow with a credential sheet. Tests show that a repeated sync adds nothing and that a bulk run resumes without duplicate accounts. Measure the password hashing cost before you choose a batch size. Nothing existing breaks.

### Phase 7. Hosted control plane

First, read the Workers for Platforms limits and prices and the D1 and R2 account limits. If one installation per organization does not fit, the fallback is self-hosting plus manual onboarding. The phase ships a separate Worker with its own database, outside the application. It has an installation registry and a provisioning state machine that resumes after a failure. A fan-out command applies additive migrations to every installation and records each result. An isolation test runs on resources named `minsky-preview` only. It shows that a cookie, a username, a stored object, and a live channel from one organization do not reach another. A fan-out test holds one installation back to show that the old Worker runs on the new schema. The application does not change.

## Next implementation step

Build Phase 0. It removes the duplicate contest list and depends on none of the owner decisions.
