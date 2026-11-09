# Backend contracts

`Backend` in [contracts.ts](../src/backend/contracts.ts) is the interface between the browser application and the server.
It describes Minsky operations. It does not expose database queries, access tokens, provider clients, or channel objects.

Cloudflare is the only implementation. [createCloudflareBackend()](../src/backend/cloudflare/backend.ts) implements every group through same-origin HTTP, cookies, and WebSockets. The tables below name its routes.
Identifiers in the contract call a contest a session, so a `sessionId` is a contest ID.

[Cloudflare backend design](cloudflare-backend-design.md) explains the server. [Server workflow reference](server-workflow.md) defines the issue commands. [Add a backend provider](add-provider.md) lists the steps for another implementation. [Frontend architecture](frontend-architecture.md) describes the callers.

## Groups

| Group | Interface | Operations |
| --- | --- | --- |
| `auth` | `Authentication` | Sign-in, sign-out, account status, and password change. |
| `workflows` | `Workflows` | Contest list, contest snapshot, and issue commands. |
| `manage` | `Management` | Site and event administration, and temporary passwords. |
| `contestAwards` | `ContestAwards` | Time awards for a whole contest. |
| `images` | `ImageTransport` | Issue images. |
| `announcements` | `Announcements` | Contest announcements and their images. |
| `avatars` | `Avatars` | Profile pictures. |
| `updates` | `LiveUpdates` | Live change hints. |

## Rules for every request

The server checks permissions and commits each command as a unit. A browser check only decides which controls to show.

- The Worker gets `Caller` from the identity service. A request body cannot supply it.
- An account with a temporary password receives 403 on every route outside `/api/auth/`.
- A `POST` or `PUT` needs the exact origin, `X-Minsky-Request: 1`, and the current `X-CSRF-Token`.
- A JSON body holds at most 16 KiB. `POST /api/announcements` allows 64 KiB, and `POST /api/manage` allows 128 KiB.
- An image transfer needs an exact `Content-Length` and the SHA-256 digest in `X-Minsky-Digest`. R2 verifies the digest. An avatar transfer holds at most 256 KiB.
- A request ID identifies one attempted action, including its retries. A repeat with the same content does not repeat the write. A repeat with other content is rejected.

The [authentication reference](cloudflare-authentication.md) defines the rules for `/api/auth/` routes.

## Authentication

| Operation | Route | Result |
| --- | --- | --- |
| `currentUser()` | `GET /api/auth/session` | Returns `AccountIdentity` or `undefined`. The identity contains `id`, optional `email`, and optional `name`. |
| `subscribe(onChange)` | `GET /api/auth/session` | Reports the current account when authentication changes. Reports `undefined` after sign-out. Returns a cleanup function. |
| `signIn(target, handle, password)` | `POST /api/auth/sign-in` | Signs in. `target` is `{ kind: 'event', code }` or `{ kind: 'site' }`. A wrong event code, handle, or password gives the same refusal. |
| `signOut()` | `POST /api/auth/sign-out` | Ends the login. |
| `accountStatus()` | `GET /api/auth/session` | Returns `handle`, `must_change`, `session_valid`, and `can_change_handle`. |
| `changePassword(currentPassword, newPassword)` | `POST /api/auth/change-password` | Resolves only after the password changes and the temporary-password gate clears. |

`currentUser()` restores the browser's login state. Its result does not grant access to contest data.
After a reset removes the identity session, `accountStatus()` returns a restricted status with no account identity.

Subscriptions read the session every 60 seconds, on window focus, and on page restoration. They invoke callbacks synchronously.
The cleanup function can run more than once. No callback runs after cleanup returns.

## Contests and workflow commands

| Operation | Route | Result |
| --- | --- | --- |
| `contests(query?)` | `GET /api/contests` | Returns a `ContestSummary` for each contest that the query selects. |
| `snapshot(sessionId)` | `GET /api/snapshot` | Returns a validated `Snapshot`. |
| `execute(sessionId, requestId, command)` | `POST /api/workflow` | Runs one `Command` and returns the issue ID. |
| `executeAndRead(sessionId, requestId, command)` | `POST /api/workflow` | Optional. Follows the rules of `execute`, and also returns the snapshot that the server read right after the commit. |

`contests()` accepts one of these query forms:

- No query selects every contest that the caller can open. An account of an event reaches only that event. A webmaster reaches every event.
- `{ eventId }` narrows that list to one event.
- `{ window: { from, to } }` selects scheduled contests that overlap a window of at most 92 days, with at most 500 rows. It lists every contest of the caller's event. A webmaster gets every event. `canOpen` is false for a contest that the caller cannot open.

A `Snapshot` holds `session`, `clock`, `contest_awards`, `event`, `membership`, `has_specialist`, `teams`, `issues`, `resolutions`, `history`, `attachments`, `pending_removals`, `awards`, `members`, `audit`, and `server_time`.
The server leaves out what the caller cannot read:

- A contestant reads only the issues of the own team, with public history, public images, and confirmed contest-wide awards.
- Only an admin reads `members` and `audit`. `audit` holds the latest 50 entries.
- A valid login without a seat receives a snapshot with a null `membership` and empty lists. An invalid login receives 401.

`clock` holds the time zone, the schedule, the intake state, and the contestant's personal end time. D1 derives these values, and the browser only displays them. `clock.intake.reason` is `before_start`, `running`, `grace`, `ended`, `override_open`, `override_closed`, or `awaiting_live_passwords`. `clock.intake.changes_at` is the next instant at which the state changes by time alone. `ContestSummary.intake` holds the same state, with the field name `changesAt`.

`Command` is defined in [model.ts](../src/connected/model.ts). The adapter sends the request ID and the command unchanged.
`executeAndRead` saves the client a second read. The server returns a committed result even when the read after it fails, and the reply then has no `snapshot`. The client then reads again.

`WorkflowRejectedError` confirms that the server rejected the command. The UI can clear the pending request and accept a new command.
Other failures leave the write outcome unknown, including an invalid success response. The UI keeps the request ID and the command for **Retry last request**.

## Management

| Operation | Route | Result |
| --- | --- | --- |
| `site()` | `GET /api/site` | Returns `SiteOverview`: the webmasters, the read restriction, the events with their counts, and the contests to join. Returns `null` for a caller who is not a webmaster. |
| `event(eventId?)` | `GET /api/event` | Returns `EventConsole`: the event, its admins, people, entrants, contests, staff assignments, entries, and latest 50 audit entries. Requires an event admin of the event or a webmaster. Without an ID, it reads the caller's own event. |
| `execute(requestId, command)` | `POST /api/manage` | Runs one `ManageCommand`. Returns a `ManageReceipt` with the created IDs. |
| `issueCredentials(requestId, input)` | `POST /api/credentials` | Issues a temporary password for each of 1 to 8 accounts. |
| `contestRecord(sessionId)` | `GET /api/contest-record` | Returns the complete `ContestRecord` of one contest for the [contest archive](event-platform-design.md#contest-archive). Requires a contest admin, an event admin, or a webmaster who can read the contest's data. |

`requirementOf` in [manage.ts](../src/server/adapters/cloudflare/manage.ts) holds one row for each command. The levels have these meanings:

- `site` means a webmaster.
- `event` means an event admin of that event, or a webmaster.
- `contest` means an admin of that contest, an event admin of its event, or a webmaster.

| Command | Requires | Effect |
| --- | --- | --- |
| `create_event` | `site` | Creates an event with a name, a code, an IANA time zone, and its first event admin. |
| `add_webmaster` | `site` | Creates a webmaster account without a password. |
| `remove_webmaster` | `site` | Removes the site grant and ends the logins of another webmaster. The last enabled webmaster stays. A webmaster who leaves needs another webmaster who can sign in. |
| `set_webmaster_reads` | `site` | Turns the webmaster read restriction on or off. |
| `join_contest` | `site` | Records a webmaster's audited join. D1 accepts it only while the read restriction is on. |
| `update_event` | `event` | Changes the name, the code, and the time zone. |
| `set_event_admin` | `event` | Adds or removes an event admin. An entrant's sign-in cannot be an event admin. |
| `create_people` | `event` | Creates 1 to 300 staff accounts without passwords. |
| `create_entrants` | `event` | Creates 1 to 300 teams or single contestants. Each gets one sign-in account without a password. |
| `rename_entrant` | `event` | Renames the entrant, and its entry in every contest. |
| `add_entrant_sign_in` | `event` | Creates a sign-in for an entrant that has none. |
| `create_contest` | `event` | Creates a `practice` or `live` contest with a type, a schedule, and categories. The kind stays fixed. Intake follows the schedule. |
| `update_contest` | `event` | Changes the name and the type. An optional schedule replaces the current one. |
| `assign_entrants` | `event` | Enters 1 to 300 entrants in a contest, each with a location. D1 seats each entrant's sign-in and checks the contest type. |
| `unassign_entrant` | `event` | Removes an entry that has no issue. |
| `assign_staff` | `event` | Sets the admin flag and the roles of a staff seat. The seat needs the flag, a role, or both. |
| `unassign_staff` | `event` | Removes a staff seat. |
| `set_intake` | `contest` | Sets the mode. `schedule` follows the contest's schedule, and needs one. `open` and `closed` hold intake by hand. |
| `set_image_limits` | `contest` | Sets the file size of 1 to 50 MB, the count of 1 to 24, and the combined size of 1 to 120 MB. The file size cannot exceed the combined size. One MB is 1,048,576 bytes. |
| `set_categories` | `contest` | Replaces the ordered list of 1 to 50 categories. A category that an issue uses stays. |
| `set_location` | `contest` | Sets the location of one entrant in the contest. |
| `set_handle` | Account rule | Changes a handle. The [authentication reference](cloudflare-authentication.md#credentials-and-permissions) defines who can. |

These rules apply to the text and the state of a command:

- Names hold 1 to 200 characters without control characters. A location holds at most 200 characters.
- Two entrants of one event cannot share a name, and two categories of one contest cannot share a name. Minsky ignores capital letters, Unicode form, and spaces at the ends when it compares names.
- An event code holds 3 to 40 lowercase letters, digits, or hyphens, and starts with a letter or digit. Codes are unique on the site.
- A schedule ends after it starts, with at most 240 minutes of grace.
- `assign_entrants` and `add_entrant_sign_in` receive 409 when they would close an open live contest, unless the command carries `closeReporting: true`.
- `update_contest` receives 409 when a new schedule would stop a running live contest. Close reporting first, then move the contest and issue new passwords.
- An archived event rejects every command that targets it.

A repeat with the same request ID and command returns the first receipt. A receipt never holds a password.
A 4xx reply becomes `RequestRefusedError`, which carries the server's reason. A 409 can also say that the outcome is unknown, and the caller then refreshes before it retries. Other failures leave the outcome unknown, and the caller retries with the same request ID.

`issueCredentials` takes a `CredentialIssue` with these fields:

- `eventId` names the event of the accounts. The caller must be able to manage each account. Null means other webmasters, and only a webmaster can ask.
- `accountIds` holds 1 to `ISSUE_BATCH`, which is 8, different accounts. The caller's own account is refused with 400.
- `contestId` names the contest that the organizer issues for. A live target opens the overlapping live contests. Each account needs a seat in it.
- `voidLivePasswords` confirms that the new password stops the passwords of live contests that have not ended. Without it, that issue receives 409.

An issue also receives 409 when the new password would sign a contestant out of a contest with open intake.
Each `IssuedCredential` holds `accountId`, `handle`, and `temporaryPassword`. The server returns the password once and never stores it. A repeat with the same request ID returns null passwords, and the organizer issues again with a new request ID.

## Contest-wide awards

`contestAwards.execute(sessionId, requestId, command)` calls `POST /api/contest-awards` and resolves to the award ID. An archived event rejects each command.

| Command | Who | Effect |
| --- | --- | --- |
| `grant` | Jury | Records 1 to 1,440 minutes and an explanation of 1 to 2,000 characters for every contestant. One contest holds one unconfirmed award of each size. |
| `apply` | Volunteer, specialist, or jury | Confirms that staff applied the minutes outside Minsky. |
| `withdraw` | Jury | Withdraws an unconfirmed award. The record stays and gives no time. A confirmed award cannot be withdrawn. |

Only confirmed minutes extend a contestant's personal end time. Minsky changes no external contest clock.
A repeat with the same request ID does not write again. A refusal has a 4xx status and carries the reason.
An award for one issue is the workflow command `award`.

## Images

| Operation | Route | Result |
| --- | --- | --- |
| `begin(input)` | `POST /api/images` | Reserves an image for one hour, using the request ID, issue, visibility, name, and size. Returns the image ID and the original and thumbnail paths. |
| `upload(path, body, contentType, onProgress)` | `PUT /api/image/<path>` | Uploads one object and reports the bytes sent. |
| `finish(sessionId, attachmentId)` | `POST /api/images` | Validates and publishes the reserved image. A repeat after a lost success response does not publish another image. |
| `remove(sessionId, attachmentId)` | `POST /api/images` | Removes the image. Only the uploader can remove it. A failed file deletion stays retryable. |
| `abandon(sessionId, attachmentId)` | `POST /api/images` | Cleans up an unfinished upload. |
| `download(path)` | `GET /api/image/<path>` | Returns a `Blob` after the server checks access. |

Only staff of an active event reserve an image. Visibility is `public` or `internal`, and it stays fixed.
The server removes control characters and invisible direction marks from the name, replaces `/` and `\` with `-`, and keeps the first 200 characters.

Each download checks current access instead of reusing an earlier authorized response. These checks cannot retract bytes that a person already received.

`attachmentPath()` defines the object key as `sessionId/issueId/attachmentId/original` or `sessionId/issueId/attachmentId/thumbnail`.
An object key is not a public URL or an access credential.

`ImageRequestError` has three flags:

- `validation` marks a rejected request.
- `restart` means that the caller starts a new upload.
- `incomplete` means that `finish()` needs the original or the thumbnail first. The UI resumes the upload after a retry check, without reading a provider's error text.

## Announcements

`Backend.announcements` reads and writes contest announcements. It is separate from the issue snapshot, so a slow or failed read cannot delay issue work.
The [announcement reference](session-announcements.md) defines the behavior and the routes.

| Operation | Result |
| --- | --- |
| `snapshot(sessionId, signal?)` | Returns the announcements and ready images that the caller can read, with server time. Members read active records. Admins and jury also read expired records. Nobody reads removed records through this call. A newer read can abort an older one. |
| `execute(sessionId, requestId, command)` | Publishes, edits, or removes one announcement and returns its ID. Removal hides the announcement from every member and keeps its record, images, and files for the contest archive. |
| `uploadImage(input)` | Reserves, transfers, and publishes one image. A repeated request ID does not add a second image. |
| `removeImage(sessionId, imageId)` | Removes the image through the authorized server operation. A failed file deletion stays retryable. |
| `downloadImage(image)` | Returns a `Blob` after the server checks current access. A contest admin can also download a ready image of a removed announcement. |

`AnnouncementRejectedError` extends `WorkflowRejectedError`. It confirms that the server rejected the command.
Its `conflict` field is true when the announcement changed after the caller read it.
Other failures leave the write outcome unknown, and the caller keeps the request ID for a retry.
Image failures use `ImageRequestError`.

## Avatars

`Backend.avatars` reads and changes profile pictures. A picture belongs to an account, not to a contest.
The account page and the phone **Me** tab change the caller's picture. `PersonAvatar` shows the pictures. See [Profile pictures](frontend-architecture.md#profile-pictures).

This visibility rule decides which pictures a caller can read:

- Every account reads its own picture.
- In one contest, staff read the pictures of the assigned staff of that contest. An assigned staff seat has no team, and it has the admin flag or a role. An event admin or a webmaster without such a seat holds no assigned seat, so other staff do not read that picture.
- A team account reads only its own picture.

| Operation | Route | Result |
| --- | --- | --- |
| `list(sessionId)` | `GET /api/avatars` | Returns a `PersonAvatar` for each picture that the caller can read in the contest. A record has `person_id` and `avatar_id`. |
| `upload({ requestId, file })` | `PUT /api/avatar/<requestId>` | Replaces the caller's picture and returns the new record. A repeated request ID returns its first result and stores no other picture. |
| `remove()` | `POST /api/avatars` | Removes the caller's picture. It succeeds when the caller has no picture. |
| `download(sessionId, avatar)` | `GET /api/avatar/<sessionId>/<avatarId>` | Returns a `Blob` after the server checks the rule for that contest again. |

The server accepts a JPEG, PNG, or WebP file of up to `AVATAR_MAX_BYTES`, 262,144 bytes, from [imageFile.ts](../src/connected/imageFile.ts).
It checks the file signature and stores that type. The declared content type does not change the result.
The frontend crops the picture to a square and encodes it as a JPEG of no more than 512 by 512 pixels before upload. The new encoding removes EXIF and location metadata.
Each stored picture has its own `avatar_id`, so a client can use it as a cache key.

Failures use `ImageRequestError`. `validation` marks a rejected file or request. `restart` means that the upload expired, and the caller selects the picture again with a new request ID.

The issue snapshot and its `members` list do not contain pictures, and a picture change sends no live signal.
The frontend reads `list()` again after each live signal and on the snapshot timer, which runs every 60 seconds. Other people see a changed picture after their next read.

The [Cloudflare design](cloudflare-backend-design.md#account-avatars-use-the-private-image-bucket) describes how the Worker stores pictures.

## Live updates

`Backend.updates.subscribe()` accepts the session ID, user ID, `onChange`, and `onConnection`. It connects to `GET /api/updates`.

- `onChange()` signals that the current snapshot may be stale. It does not deliver issue bodies, staff notes, or membership records.
- `onConnection(true)` reports that the live connection is ready to receive changes. The UI reads a new authorized snapshot when the connection opens, drops, or reconnects.
- The cleanup function can run more than once and stops later callbacks.
- Subscriptions on the same `Backend` are independent, also when an earlier subscription is still closing.

The UI also reads on a timer, on focus, and at each time boundary of the contest. The [refresh schedule](frontend-architecture.md#refresh-schedule) defines those reads. They detect revoked access even when the subscriber receives no more events.
Live notifications do not authorize reads or writes.

## Modules

| Module | Responsibility |
| --- | --- |
| [contracts.ts](../src/backend/contracts.ts) | Defines `Backend` and each group of operations. |
| [errors.ts](../src/backend/errors.ts) | Defines workflow rejection, announcement rejection, request refusal, and image retry errors. |
| [index.ts](../src/backend/index.ts) | Creates `backend` for the current origin. |
| [cloudflare/backend.ts](../src/backend/cloudflare/backend.ts) | Calls the same-origin API and manages independent live connections. |
| [server/workflow.ts](../src/server/workflow.ts) | Defines shared decisions, orchestration, and the operation-level persistence interface. |
| [server/adapters/d1/store.ts](../src/server/adapters/d1/store.ts) | Persists workflow commands in guarded D1 batches. |
| [server/adapters/cloudflare/applicationWorker.ts](../src/server/adapters/cloudflare/applicationWorker.ts) | Constructs the Cloudflare services and handles application and maintenance requests. |
| [server/adapters/cloudflare/http.ts](../src/server/adapters/cloudflare/http.ts) | Checks each application request and maps it to a service. |
| [server/adapters/cloudflare/authority.ts](../src/server/adapters/cloudflare/authority.ts) | Resolves what an account may do in the site, an event, or a contest. |
| [server/adapters/cloudflare/application.ts](../src/server/adapters/cloudflare/application.ts) | Reads contest lists and authorized snapshots. |
| [server/adapters/cloudflare/manage.ts](../src/server/adapters/cloudflare/manage.ts) | Reads the site and event consoles, runs management commands, and issues temporary passwords. |
| [server/adapters/cloudflare/schedule.ts](../src/server/adapters/cloudflare/schedule.ts) | Defines the SQL that derives intake, personal end times, and the contest clock. |
| [server/adapters/cloudflare/contestAwards.ts](../src/server/adapters/cloudflare/contestAwards.ts) | Commits contest-wide award commands. |
| [server/adapters/cloudflare/announcements.ts](../src/server/adapters/cloudflare/announcements.ts) | Reads announcement snapshots and commits guarded announcement commands. |
| [server/adapters/cloudflare/announcementImages.ts](../src/server/adapters/cloudflare/announcementImages.ts) | Manages private announcement image reservations, transfers, publication, and cleanup. |
| [server/adapters/cloudflare/avatars.ts](../src/server/adapters/cloudflare/avatars.ts) | Stores, lists, reads, and removes account avatars, and retries their file cleanup. |
| [server/adapters/cloudflare/images.ts](../src/server/adapters/cloudflare/images.ts) | Manages private image reservations, transfers, publication, and cleanup. |
| [server/adapters/cloudflare/live.ts](../src/server/adapters/cloudflare/live.ts) | Delivers audience-specific invalidations and manages current connection access. |
| [connected/model.ts](../src/connected/model.ts) | Defines workflow commands and validates snapshots. It has no provider imports. |
| [connected/capabilities.ts](../src/connected/capabilities.ts) | Holds the one table of what a seat may do. |
| [connected/imageFile.ts](../src/connected/imageFile.ts) | Defines file checks, attachment paths, and error classification. |

The UI imports the contracts, the shared errors, and `backend`.
ESLint rejects provider SDKs, browser implementations, and server adapters in shared application code, shared server rules, and shared test scenarios.
It checks static imports, re-exports, and literal dynamic UI imports, and it rejects computed dynamic UI paths because it cannot determine their provider.

## Test coverage

`npm test` runs the D1, R2, Durable Object, and browser adapter tests with local bindings.
`npm run test:e2e` runs browser journeys against a local Worker or mocked responses. It covers request-ID reuse after an uncertain write and a new request after a definitive rejection.
The [shared provider suite](provider-test-contracts.md) checks these contracts through the real browser adapter against hosted resources. It does not cover `announcements`, `avatars`, or `contestAwards`, and it covers only some `manage` commands.
[Run the provider tests](run-provider-tests.md) gives the hosted commands.
