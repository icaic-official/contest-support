# Current state

## PR #42 review fixes and cleanup, 2026-10-18

The owner requested the review fixes, removal of obsolete tests and code, and fresh verification before PR #42 is ready.
Supabase remains active. The owner reviews and merges.

The current code removes the historical D1 proof implementation, its command and configuration, and the test-only issue-view interface.
D1 workflow tests now call the shared service and the real authorized application snapshots.
Their 70 cases remain intact. Workflow decision reads no longer aggregate history or audience sequences.
The isolated authentication target remains separate and retains its focused checks.
One provider-owned hosted runner replaces two runners. Each child owns its recovery journals through a private temporary directory.

Image expiry recovery now queues the persisted expired set, so a deadline crossing cannot strand a storage object without a deletion task.
Wrangler operations clear inherited environment selection before using the reviewed target.
Protected CI retains the hosted React recovery journal and the consolidated runner's scoped D1 journals.
Authentication and application HTTP routes share the bounded JSON reader.
Node.js supplies exact configuration comparison in place of duplicate sorting functions.

The complete installation procedure now lives in [the public installation source](../site/src/content/docs/operators/installation.md).
Completed proof and implementation instructions link to their frozen historical source.
The [review run report](t0020-run-report.md) lists changes, commands, checks, and remaining verification.

Local verification passes all 612 tests across 40 files without skips, all 45 ordinary browser cases, three authentication browser cases, the complete HTTPS runtime, and the complete local React journey.
Type checks, lint, both builds, 12 function tests, three documentation browser cases, and locked dependency audits pass.
The documentation build verifies 528 local links and assets across 13 pages.
The new expiry and environment-isolation regressions fail before their fixes and pass afterward.
Executable source is `2b6f6f093eabec159857863c295ab21fd04bae83`.
Ordinary [push CI](https://github.com/GiftedNovaHD/minsky/actions/runs/39114654044) and [PR CI](https://github.com/GiftedNovaHD/minsky/actions/runs/39114656733) pass on that source.
Protected Cloudflare verification, protected Supabase compatibility verification, and fresh installation pass as recorded below.
The final evidence update changes documentation only. Its ordinary PR checks must pass before merge.
Earlier records below apply to their recorded source revisions.

### Protected verification after review fixes

Protected [Cloudflare run 39114678438](https://github.com/GiftedNovaHD/minsky/actions/runs/39114678438) passes on executable source `2b6f6f0`.
Its ordinary checks, secret scan, and dependency audits also pass.
All 70 hosted D1 workflow cases and 82 account cases pass with zero failures or skips.
The workflow step runs from 09:24:53 to 09:28:35 UTC. The account step runs from 09:28:35 to 09:32:49 UTC.
The job deploys CI Worker version `222b1998-5aa6-4e53-aab7-cdefa78ed16f`.
All eight shared browser scenarios pass in 2.9 minutes.
The complete hosted React journey passes with zero failures, skips, or flaky results.
Its step runs from 09:36:43 to 09:39:01 UTC.
The runners verify scoped fixture cleanup. No incomplete marker, retained recovery journal, or recovery artifact remains.
The artifact step checks provider, hosted UI, and per-child D1 journal paths.
This protected run uses the separate store and application CI targets recorded below. It does not deploy the active development backend.

Protected [Supabase run 39114729684, attempt 1](https://github.com/GiftedNovaHD/minsky/actions/runs/39114729684/attempts/1) passes its prerequisite checks, but two of 16 hosted browser cases fail at five-second UI assertions.
The specialist queue is present without an error alert in the immediate post-failure diagnostics. This establishes a late transition, but not the delayed request.
The reset failure has no response status, timing, or final admin state. Its cause remains undiagnosed.
No relevant Supabase browser, admin, migration, or fixture runtime changed in this review follow-up.
The two failed cases then pass unchanged in a local hosted run in 1.1 minutes.
A separate complete ordered local hosted run passes all 16 cases in 2.5 minutes, with unchanged assertions and scoped cleanup.
Temporary credential-free request instrumentation does not reproduce either failure and is not committed.
Protected [attempt 2](https://github.com/GiftedNovaHD/minsky/actions/runs/39114729684/attempts/2) passes on the same `2b6f6f0` source.
All 16 browser cases pass in 3.5 minutes, all eight shared scenarios pass in 2.2 minutes, and all five trusted workflow cases pass.
Assertion deadlines and retry settings remain unchanged. The original reset failure's cause remains undiagnosed.
The target is the existing Minsky CI project, `ghtztmovdkhuketcbjmq`.
Configuration changes, migrations, function deployments, and secret updates are skipped.
Scoped cleanup passes, with no retained fixture journal or recovery artifact.

### Fresh installation after review fixes

A clean checkout of `2b6f6f0` followed the public installation procedure in account `458ad6a930b0fb717796dfa19ca6a2b1`.
The locked dependency installation reports zero vulnerabilities.
All nine migrations, the isolated Cloudflare build, deployment dry run, deployment, bootstrap, and initial secret creation pass.
D1 reports APAC placement. The Worker reports `aws:ap-southeast-1` placement.
The private R2 bucket has no public development URL or custom domain.

| Resource | Identity |
| --- | --- |
| Worker and D1 name | `minsky-install-pr42-18af3da3` |
| Application origin | `https://minsky-install-pr42-18af3da3.icaic-minsky.workers.dev` |
| D1 database | `a212a06c-3827-43fd-bfac-85a18e8dca23` |
| Private R2 bucket | `minsky-install-pr42-18af3da3-images` |
| Installation | `ad0bae25-1255-4235-8b5a-5aab38f0ea7c` |
| Initial owner | `6d053c11-42c6-42a1-b5ac-19b26924b7f7` |
| Initial Worker version | `527f5ade-fbb7-41fb-b3c2-8c4b5ed14774` |
| Active Worker version after secret creation | `ec659c7b-ac50-4ed9-9c79-efc2e9728798` |

Before initialization, the landing page returns 200, `/.env` returns 404, and sign-in returns 503.
Accounts, installation markers, and rate-limit rows are empty at that boundary.
The first owner must change the temporary password. The configured event, session, categories, roster, and closed intake match the input.
Repeated initialization and initial-secret creation refuse safely.

The complete React trial runs from 09:18:20.830 to 09:22:30.030 UTC on 18 October 2026.
Its browser case passes in 248.574 seconds, with no failures, skips, flaky results, infrastructure errors, or retries.
It covers the jury worklist, workflow, images, live updates, phone layout, keyboard behavior, and authorization changes.
Trusted sole-owner recovery revokes the old session and requires a replacement-password change.
Full installation, membership, role, issue, and history rows match before and after recovery.

Scoped cleanup removes only this trial's fictional records and confirms empty fixture coordinators before removing its recovery journal.
The final read-only audit passes at 09:24:06.795 UTC.
One owner, identity, credential, event, session, and admin membership remain with two configured teams.
The installation retains 20 delivered notifications, three monotonic audience counters, and seven audit rows.
Workflow records, staff roles, images, deletion tasks, pending notifications, and R2 objects are zero.
Intake remains closed. The initialized installation remains available for owner review.
A final read-only refusal proof passes at 09:24:53.362 UTC without provider or database writes.
Earlier installations remain untouched. No paid upgrade occurred.
Private credential files have mode `0600`; their contents were not printed or committed.

## T0020 connector implementation, 2026-10-18

T0020 starts from merged PR #41 at `7d19b00`.
The active branch is `feature/t0020-cloudflare-connector`.
Hosted CLI, protected Cloudflare verification, and the current empty-installation trial pass on `25b2033`.
Supabase remains active.
During final verification, the owner merged PR #23 at `c144a2a`.
T0020 includes that main revision and preserves the jury worklist.
The combined source passes 614 unit and database tests across 41 files and all 45 ordinary browser cases.
The complete local React journey also passes through the merged jury worklist.
The [ticket](tickets.md#t0020-complete-cloudflare-connector) records the complete acceptance criteria.
The [PR #21 component record](pr21-installation-disposition.md) explains installation reuse decisions.
The [run report](t0020-run-report.md) lists changed files, commands, results, and remaining work.

Wrangler `whoami` confirmed account `458ad6a930b0fb717796dfa19ca6a2b1` before resource changes.
The database list contains the existing, separate authentication and bounded-proof CI databases.
No complete connector or installation database existed at that check.
The initial `wrangler r2 bucket list` command failed with Cloudflare code `10042`.
The owner then confirmed R2 activation. The repeated account check and bucket list pass.
The isolated hosted checks then passed as recorded below.

### Implementation and observed checks

The D1 adapter implements all nine commands through `WorkflowService`.
The full Worker supplies maintained authentication, authorized snapshots, administration, private R2 images, and Durable Object invalidations.
The browser can select this connector with `VITE_BACKEND=cloudflare` for an isolated build.
The default remains Supabase.
Provider-owned installation tooling validates public configuration, checks the exact target, and creates one initial owner only in an empty database.
The [installation guide](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/install-cloudflare.md) passed its current hosted empty-installation trial on source `25b2033`.
This evidence supports isolated development installations. It does not establish production capacity or a migration path.

Observed results during implementation are separate from final PR verification:

- All 70 workflow tests pass locally and on hosted D1. Hosted fixture cleanup passes.
- All 82 hosted account tests pass on the new connector D1 schema, with zero skips and verified fixture cleanup.
- All 554 local tests pass across 33 files on `59121f7`. The local account suite includes 83 cases, including its separate execution-clock probe.
- Corrected ordinary CI passes 579 tests across 35 files on `9b0ef6b`, plus all 45 application browser regressions and the complete local React journey.
- All eight unchanged shared provider scenarios pass against Minsky CI on Supabase, `ghtztmovdkhuketcbjmq`. Fixture cleanup passes.
- The same eight scenarios pass against the deployed Cloudflare connector on `1ee8cbf`, with scoped D1, R2, and Durable Object cleanup.
- The complete hosted React journey passes on `59121f7`, with zero failures, skips, or flaky results.
- A separate empty hosted installation passes the documented procedure and complete React journey on `25b2033`.
- The local complete HTTPS Worker journey passes with actual authentication, D1, R2, and Durable Object bindings.
- The complete local React journey passes through actual HTTPS and emulated bindings, including phone keyboard checks and exact fixture cleanup.
- All 45 ordinary application browser regressions pass after main integration. Three local HTTPS authentication browser cases pass at the earlier revision.
- Both frontend builds, type checking, lint, Deno checks, and all 12 function tests pass after the review corrections.
- Both locked dependency audits report zero vulnerabilities.
- Full-history secret scanning passes in both ordinary CI runs on `25b2033`.

The hosted D1 run uses the new `minsky-connector-ci` database, `de43cf95-c024-4e44-860d-8ff179e4e08d`.
All nine repository D1 migrations are applied there.
The test executes production persistence through a remote D1 binding. It does not test the deployed application Worker.
Both hosted D1 runners and the repeated Supabase shared run verify source `de1ecbd`.
The shared Supabase CLI suite passes again on `1ee8cbf`, with all eight scenarios and verified scoped cleanup.
After both D1 runners finish, a separate read-only query confirms zero rows in all 27 application tables.
The D1 migration records remain intact. No fixture recovery journals remain from these successful runs.
The existing authentication and bounded-proof databases remain separate.
The direct D1 suites now require a separate store CI target, described below.
The isolated connector Worker is deployed at `https://minsky-connector-ci.icaic-minsky.workers.dev`.
Its initial version is `2a3fe2f1-7b4e-4017-bd45-43c3fdf8cbeb`.
Initial secret creation produced active version `6133f70f-5762-479b-88d6-dfa3f2b376e7`.
That initial application deployment uses source `59121f7`. The later `1ee8cbf` changes only the provider test bridge and its regression test.
Its new Standard bucket, `minsky-connector-ci-images`, exists in APAC. Its public `r2.dev` URL is disabled.
Anonymous checks return 200 for the landing page and 401 for protected session routes.
Both `/.env` and `/src/main.tsx` return 404.
The implementation is in [PR #42](https://github.com/GiftedNovaHD/minsky/pull/42).
Ordinary push CI passes `checks`, `secrets`, and `dependencies` in [run 39095244800](https://github.com/GiftedNovaHD/minsky/actions/runs/39095244800).
Ordinary PR CI also passes in [run 39095267935](https://github.com/GiftedNovaHD/minsky/actions/runs/39095267935).
Protected Supabase verification passes on that revision in [run 39095319959](https://github.com/GiftedNovaHD/minsky/actions/runs/39095319959).
The protected Supabase run uses the existing CI backend without changing its configuration, migrations, or functions.
Protected [run 39098783172](https://github.com/GiftedNovaHD/minsky/actions/runs/39098783172) on `9b0ef6b` passes all 70 workflow and 82 account cases.
It deploys CI Worker version `33977804-a8c2-475d-ad52-27906df0a136`, then passes six of eight shared scenarios.
Both failing scenarios exceed their 90-second limit. The lifecycle then reports a sign-in message, and the image case reports a closed page.
The static sign-in message does not establish HTTP 401. The hosted React step is not reached.
Fixture cleanup reports no retained recovery marker or artifact. The later region-selected run below corrects these timeouts.
Ordinary push CI passes on that corrected revision in [run 39098769818](https://github.com/GiftedNovaHD/minsky/actions/runs/39098769818).

The `cloud-test` environment now permits `feature/t0020-cloudflare-connector`.
The API showed five existing branch entries before this change. All five entries and their IDs remain unchanged.
The existing protection rule, `69128862`, remains unchanged.
The new entry is `63431697`.
This later API observation does not rewrite the earlier four-entry record below.

Review added final credential checks to administration, image, login, and account commits.
Self-password changes retain both original deadlines while deliberately revoking the old session.
Review also added fair notification retries, late-upload cleanup, and complete Durable Object fixture cursor cleanup through a trusted service binding.
The internal cleanup binding has passed a local runtime test. The public application has no cleanup route.
Installation commands reject missing or foreign migrations and override inherited Wrangler settings that could log credentials.
An initial shared Cloudflare browser run stopped before login because its test bridge omitted a Vite runtime asset.
The narrow asset correction and a real module-loading regression pass. The repeated hosted suite passes all eight scenarios.
No application route or deployed source changed for that correction.
No development backend deployment, real-account reset, real-data export or migration, or active backend switch occurred.

### Direct D1 test isolation

Protected [run 39097062812](https://github.com/GiftedNovaHD/minsky/actions/runs/39097062812) on `1ee8cbf` passed 69 workflow cases and failed one.
Its per-case assertion output was withheld to protect credentials. The exact failed assertion is unavailable.
Its D1 cleanup completed, and no recovery artifact remained.
Protected [run 39097803510](https://github.com/GiftedNovaHD/minsky/actions/runs/39097803510) on the integrated `c1530bb` source also reported 69 passed and one failed.
Its cleanup completed without retained artifacts. It did not reach deployment or hosted browser checks.
Both ordinary checks pass on `c1530bb`, in [push run 39097793939](https://github.com/GiftedNovaHD/minsky/actions/runs/39097793939) and [PR run 39097795860](https://github.com/GiftedNovaHD/minsky/actions/runs/39097795860).

A separate controlled local test confirmed a test-isolation defect after deploying the complete CI Worker.
Scheduled outbox delivery can change `attempts`, `delivered`, and `last_attempt_at` between a direct test's snapshots.
It can also create coordinator cursors that the direct D1 fixture cannot remove.
The controlled test establishes this hazard. It does not identify the historical failed assertion.

The direct workflow and account suites therefore use `minsky-connector-store-ci`, database `341350ba-7c74-4c46-8b21-edfdcda475f5`.
The account and name were checked before creation. The new database is in APAC.
Its configuration has only a D1 binding. It has no Worker entry point, assets, R2, live namespace, or scheduled trigger.
This adds no subscription upgrade. The database uses the existing D1 service and its usage charges.
The hosted application retains its separate `minsky-connector-ci` database and all real delivery behavior.
Full notification snapshot comparisons remain intact in the direct suites.
Runner diagnostics expose only failed assertion positions as numbers. Provider output and credential values remain withheld.

A read-only audit at 04:45:45 UTC found zero application rows in the connector CI database.
The Worker's live namespace is `aa46f35cf51440bfaa9fe6d5dc6ff6b8`.
Its [object listing](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/subresources/objects/methods/list/) returned one object with `hasStoredData=false`.
No object reported stored data. No stored orphan state was observed at that check.
The audit made no cleanup mutation and did not inspect the separate installation baseline.
The repeated audit at 04:53:09 UTC returned the same storage flags and zero queried application rows after the second failed run.
The later protected runs use the corrected isolation.
The guarded migration command applied all nine migrations to the new store database.
All 70 direct workflow cases pass there, with zero skips and verified scoped cleanup, using the changes committed as `9b0ef6b`.
All 82 account CLI cases also pass on that store target at `9b0ef6b`, with zero skips and verified scoped cleanup.

### Hosted check duration

The owner requested a root-cause correction after the account phase exceeded 17 minutes.
In protected run `39098783172`, that phase passed all 82 cases but took 20 minutes 6 seconds.
Its preceding 70-case workflow phase took 4 minutes 55 seconds.

A local instrumented baseline counted 5,323 D1 binding calls across the 82 account cases.
Fixture setup used 987 calls. Case bodies used 3,135. Cleanup used 1,201.
The runner serialized these independent UUID fixtures in one file.
It also captured all progress until the child process exited.

A read-only hosted probe compared twelve separate `SELECT 1` calls with one twelve-statement batch.
Separate calls took about 1.63 seconds. The batch took 133 milliseconds.
The database reported less than two milliseconds of SQL execution for the separate calls.
This sample measures transport overhead. It does not establish application latency or capacity.

Batching the same fixture writes, credential snapshots, and cleanup reads reduces account calls to 3,410, a 35.9% reduction.
All 82 local baseline and corrected cases pass. Maintained password operations remain 122 hashes and 183 verifications.
All unique-key cleanup assertions remain. Twenty-two duplicate username absence reads are removed.
The same correction reduces the workflow suite from 992 calls to 850 without changing its SQL statement count.
All 70 cases pass before and after the correction.

Four explicit account files now own separate fixtures and can run concurrently.
Their groups contain 21 session cases, 15 recovery cases, 24 initiation cases, and 22 completion cases.
Cases within each file remain serial. Every original case body and parameter list remains intact.
The local-only execution-clock case remains separate, for a local total of 83.
Both direct runners now report completed cases, active cases, elapsed time, and numeric database measurements during execution.
Reported SQL time covers provider metadata from `all`, `run`, and `batch`. It excludes `first`, which returns no metadata.
Summed call wall time can exceed elapsed time when files run concurrently.
The corrected account CLI run passes all 82 cases with zero skips and verified cleanup in 148 seconds from this machine.
Its measured totals include 3,423 calls and 10,536 statements, including suite initialization and maintained schema checks.
This result is separate from GitHub timing.
Protected run `39102298675` passes all 82 cases in 5 minutes 21 seconds, from 06:10:22 to 06:15:43 UTC.
That is 14 minutes 45 seconds, or 73.4%, shorter than the earlier protected phase.
Its workflow phase passes all 70 cases in 4 minutes 36 seconds.
The next protected run, `39105044129` on `e44cb69`, passes all 82 account cases in 5 minutes 9 seconds.
That is 14 minutes 57 seconds, or 74.4%, shorter than the original phase.
Its workflow phase passes all 70 cases in 4 minutes 19 seconds.
Protected run `39107250938` on `25b2033` passes all 82 account cases in 5 minutes, from 07:30:06 to 07:35:06 UTC.
That is 15 minutes 6 seconds, or 75.1%, shorter than the original phase.
Its workflow phase passes all 70 cases in 4 minutes 17 seconds.
The later application-placement setting does not change this separate store target.
The elapsed comparison combines batching and concurrency changes. It does not isolate their individual effects.

The remaining shared-scenario failures now have provider-owned HTTP diagnostics.
Each client reports endpoint names, status counts, and request durations before logout.
A resource authentication rejection also records cookie presence and reads only that fixture account's authentication flags.
The flags describe its newest login wrapper. The wrapper count identifies ambiguity when several logins exist.
Diagnostics omit URLs, query values, account IDs, cookies, password data, and provider error text.
Local regression checks verify these boundaries and confirm that the state read finishes before browser logout.
The repeated hosted CLI suite passes all eight shared scenarios on the changes committed as `ab4a8ff`.
Its 29 client summaries cover 290 HTTP requests before teardown logout. The longest observed request takes 1,947 milliseconds.
No resource authentication rejection occurs, so no fixture authentication-state read is needed.
Scoped D1, R2, and coordinator cleanup passes without a retained recovery journal.
The complete hosted React journey also passes on that source, with zero failures, skips, or flaky results.
These CLI checks use deployed Worker version `33977804-a8c2-475d-ad52-27906df0a136`.
These CLI checks do not reproduce the earlier protected timeouts.

### Hosted browser duration

Protected [run 39102298675](https://github.com/GiftedNovaHD/minsky/actions/runs/39102298675) on `ab4a8ff` passes both direct suites, then passes six of eight shared scenarios.
It deploys Worker version `0c0c7675-9486-44d3-a8f9-7b356914127f`.
Both failed scenarios reach the unchanged 90-second limit. The hosted React step is skipped.
Cleanup reports no retained marker, recovery paths, or artifact.

The lifecycle records 45 completed requests totaling 87,863 milliseconds before teardown, with a maximum of 3,178 milliseconds.
All 13 observed snapshots and all 16 authentication-session reads return 200.
The image scenario records 45 requests totaling 88,547 milliseconds, with a maximum of 3,160 milliseconds.
All 20 observed authentication-session reads return 200.
The scenarios await these requests sequentially. Successful HTTP time consumes almost their entire budget.
No resource HTTP 401 appears in the summaries before logout.

The earlier `39098783172` lifecycle log also contains a 90-second timeout before its sign-in error.
The earlier interpretation as an authentication rejection was too strong.
Teardown can revoke a session while a timed-out browser operation remains in flight.
The observed order supports that explanation for the later message. It does not prove the pending request's response status.

Read-only adaptive analytics cover 06:16:32 to 06:28:00 UTC.
Successful invocations report median CPU time of 9.663 milliseconds and median request duration of 1,541.840 milliseconds.
The estimates include 405 invocations in IAD, 11 in ARN, and one in SJC, with zero runtime errors.
The database is in APAC. Waiting dominates CPU, but these aggregates do not identify the slow binding or queue.
Smart Placement was a configuration candidate for a controlled comparison.
The isolated CI candidate deploys as `f34b1519-525d-4dde-85bc-4b63c0dc1f02` after account, database, configuration, build, and dry-run checks.
Its placement metadata reports `smart` and `SUCCESS`, with analysis at 06:37:32 UTC.
This status does not establish a latency improvement. The same hosted assertions must pass from the GitHub runner.
The generated full-application configuration includes the same candidate setting. Direct store and bounded authentication configurations remain unchanged.
Older generated application files require regeneration from their original public settings before current operator commands will accept them.
The default local frontend build is restored to Supabase after the isolated deployment.
The candidate's complete hosted CLI suite passes all eight scenarios in 3.5 minutes, with scoped cleanup.
Its 29 clients record 290 requests totaling 135,640 milliseconds, with a maximum of 2,837 milliseconds.
No resource authentication rejection occurs. This Singapore-origin run does not prove improvement from the GitHub runner.

Protected [run 39105044129](https://github.com/GiftedNovaHD/minsky/actions/runs/39105044129) tests that Smart Placement candidate on `e44cb69`.
The shared step passes six cases and fails the same two after 10 minutes 30 seconds. Both failures reach 90 seconds.
The lifecycle records 49 completed requests totaling 87,556 milliseconds. Its 17 authentication-session reads and 15 snapshots return 200.
The image scenario records 47 requests totaling 88,773 milliseconds. Its 21 authentication-session reads and two snapshots return 200.
No resource authentication rejection appears. Scoped cleanup leaves no recovery marker or artifact. The hosted React step is skipped.
The deployed Worker version is `32077ca5-1f36-4d66-a7ce-3dce1fea61d8`.
Read-only analytics for 07:02 to 07:08 UTC report 237 invocations in MSP and six in ORD, with zero runtime errors.
Median request duration is 1,537.415 milliseconds. Median CPU time is 8.192 milliseconds.
The placement status reports `SUCCESS`, but execution remains in North America. This candidate does not correct the observed wait.
Cloudflare's [2025-02-13 change](https://developers.cloudflare.com/workers/platform/changelog/#2025-02-13) removed automatic placement beside a bound D1 database.
The current placement logic uses traffic measurements and previously observed execution locations.
The next comparison tests an explicit region near the database.

The exact-target `SELECT 1` metadata confirms `served_by_region=APAC` and `served_by_primary=true`, with 0.1465 milliseconds of SQL time.
This result identifies the serving region, not a physical database city.
Public installation settings now accept an optional `placementRegion`.
The generator emits `placement.region` for that option. The six original fields still generate Smart Placement.
Strict target reconstruction rejects mixed placement modes, extra hosts, changed bindings, and credentials.
Fixture journals retain the same six resource identifiers and configuration path.
The CI candidate uses `aws:ap-southeast-1`, which selects Cloudflare execution near Singapore without creating an AWS resource.
All 79 focused tooling and provider-safety tests pass, with type checking and focused lint.
Target checks, both builds, and the deployment dry run pass.
The isolated deployment produces version `48827ab3-7931-4733-95df-12060185c326`.
The default local build is restored to Supabase. The protected comparison below supplies the separate hosted improvement evidence.
The region candidate's complete hosted CLI command passes all eight unchanged scenarios in 169.449 seconds, including startup.
Its 29 clients record 290 requests totaling 110,006 milliseconds, with a maximum of 1,594 milliseconds.
No resource authentication rejection occurs. Scoped D1, R2, and coordinator cleanup passes without a retained journal.
The tested source is committed as `25b2033`. Protected [run 39107250938](https://github.com/GiftedNovaHD/minsky/actions/runs/39107250938) supplies the separate GitHub comparison.
Ordinary [PR run 39107232566](https://github.com/GiftedNovaHD/minsky/actions/runs/39107232566) passes on that source.
It reports 614 unit and database tests across 41 files, 45 ordinary browser cases, three authentication browser cases, and three docs cases.
The local HTTPS runtime and complete local React journey each pass their required case, with no failures, skips, or flaky results.

### Final protected connector verification

Protected [run 39107250938](https://github.com/GiftedNovaHD/minsky/actions/runs/39107250938) passes on `25b2033`.
Its ordinary checks report 614 unit and database tests across 41 files. Secret and dependency checks pass.
The hosted job passes all 70 workflow cases, all 82 account cases, all eight unchanged shared scenarios, and one complete React journey.
The hosted React result has zero failures, skips, or flaky results.
The shared step takes 3 minutes 9 seconds. The hosted React step takes 2 minutes 27 seconds.
The deployed CI Worker version is `f47c52c7-2487-4a2b-a5d4-97d225cbdb52`.
Scoped cleanup reports no incomplete marker, retained journal, or recovery artifact.

The lifecycle completes 59 requests totaling 26,932 milliseconds. The image case completes 66 requests totaling 32,638 milliseconds.
All scenarios complete. The 29 client summaries cover 290 requests, with a maximum of 1,417 milliseconds and no unexpected resource HTTP 401.
The earlier Smart Placement lifecycle and image cases time out after fewer completed requests totaling about 88 seconds each.
Assertions, the 90-second scenario limit, password parameters, and current-access checks remain unchanged.

Read-only analytics for 07:36 to 07:38 UTC report 305 invocations in SIN and two in ORD, with zero runtime errors or client disconnects.
Median request duration is 125.215 milliseconds, compared with 1,537.415 milliseconds in the earlier Smart Placement sample.
The 95th percentile is 472.854 milliseconds, compared with 3,339.228 milliseconds.
Median CPU time is 14.754 milliseconds. The analytics window includes all invocation types.
The two ORD entries report zero request duration and no subrequests.
Measured execution location, lower request times, and completed assertions support repeated distant database calls as the timeout cause.
This comparison verifies the isolated correction. It does not establish contest capacity or latency targets for other installations.

Ordinary [push run 39107229711](https://github.com/GiftedNovaHD/minsky/actions/runs/39107229711) and [PR run 39107232566](https://github.com/GiftedNovaHD/minsky/actions/runs/39107232566) also pass separately on `25b2033`.
Final documentation changes preserve that executable source and configuration. Final-head checks are published in [PR #42](https://github.com/GiftedNovaHD/minsky/pull/42).

### Documentation search verification

Ordinary push run `39102274608` fails its search-result assertion after five seconds on `ab4a8ff`.
The same revision passes all three docs cases in its PR and protected runs.
A controlled 5,500-millisecond search-module delay reproduces the assertion failure.
The unchanged query then returns the expected result at 5,889 milliseconds, without JavaScript errors.
The visible input correctly retains the query while the index loads.
The test incorrectly includes network initialization in its five-second result assertion.
The historical CI log does not establish which initialization step took longer in that run.

The corrected test holds the real index request and checks the visible loading message and retained query.
It releases that request, waits for the completed response, then checks the result and keyboard activation.
It passes under the same controlled delay. All three docs cases and the site build pass locally.
The application, overall timeout, and retry settings are unchanged.
The loading message and completed response are explicit failure signals for later runs.

### Session preflight errors

A separate browser-adapter check reproduces misleading errors for legitimate service failures.
The session preflight maps every unsuccessful response, including HTTP 503, to a sign-in prompt.
Only HTTP 401 now produces that prompt. Other failures retain the server message or a fixed request-error fallback.
Twelve boundary cases cover workflow, administration, image completion, and image upload preflights.
Each case verifies that the failed preflight sends no mutation.
The focused browser transport and authentication suites pass all 40 cases. Types, lint, and the default frontend build also pass.
Snapshots do not use this helper. This correction does not explain the earlier snapshot error after timeout.
The complete local suite then passes all 610 tests across 41 files, with zero skips, in 104.54 seconds.
Global lint also passes.
After the placement configuration checks are added, the full local suite passes all 611 tests across 41 files without skips.

### Empty hosted installation

A separate clean checkout of `59121f7` followed the installation guide after `npm ci`.
The operator confirmed the account and the absence of each new resource before creation.
All nine migrations, build, deployment dry run, deployment, bootstrap, and initial secret creation passed in the documented order.

| Resource | Trial value |
| --- | --- |
| Worker and D1 name | `minsky-install-t0020-b4b578a2` |
| Origin | `https://minsky-install-t0020-b4b578a2.icaic-minsky.workers.dev` |
| D1 UUID | `c3fcd906-3d4e-428f-b174-eb9ac1794aa1` |
| Private Standard R2 bucket | `minsky-install-t0020-b4b578a2-images` |
| Initial Worker version | `4eb3492e-37e3-464e-8e9a-a9c706678272` |
| Active version after secret creation | `5ca7b4b2-9159-4a10-8041-f888f0103a4a` |
| Installation UUID | `cb2ae35b-fcb7-4dc0-8293-9411194ed707` |
| Initial owner UUID | `3bb1beb8-b6dd-4ed3-83f5-90353b17a262` |

Before bootstrap, the landing page returned 200, `/.env` returned 404, and sign-in returned 503 without creating authentication-limit rows.
The first owner changed the temporary password through the deployed React page before gaining session access.
The configured event, session, categories, two-team roster, and closed intake matched the input file.
Repeated bootstrap and initial-secret commands refused to replace existing state.

The complete React assertions then passed with fictional accounts prepared through a private fixture copy guarded to this exact installation target.
The committed CI fixture guards were unchanged. No browser request used Supabase.
Trusted owner recovery through the actual operator command invalidated the old session with HTTP 401.
The replacement password required another change before access.
Account IDs, installation IDs, membership, and a fictional issue and its history stayed identical across recovery.

UUID-scoped cleanup removed the journey accounts, sessions, workflow rows, and exact R2 objects.
Both journey coordinators confirmed empty storage, no alarms, no sockets, and no socket attachments before journal deletion.
Exact guarded deletion then removed the separate recovery-proof issue, history, receipt, and delivered notifications.
Final counts retain one installation, owner, event, session, administrator membership, and two teams.
There are zero staff roles, issues, history rows, receipts, issue-number counters, images, image deletions, or pending notifications.
The bucket is empty. Intake stays closed, and installation and recovery audits remain intact.
Baseline audience counters and their matching coordinator cursors remain monotonic to prevent sequence reuse.
No fixture recovery journal remains.

This trial passed at 04:21 UTC on 2026-10-18. Its final proof cleanup passed at 04:25 UTC.
It is separate from the connector CI Worker and protected GitHub Actions runs.
The fictional initialized installation remains available for owner review.

A final read-only audit at 06:06:54 UTC confirms the same initial IDs, owner membership, two teams, and closed intake.
All nine migration names match the trial checkout. The private bucket contains zero objects.
The retained baseline includes 20 delivered notifications, three audience counters, seven audit records, and four completed account operations.
There are zero pending notifications or account operations. Journey workflow and image rows remain absent.
The audit reads no private credentials and makes no provider changes.

### Smart Placement empty installation

A second clean checkout follows the current guide at `e44cb69b8f72499d5ba9e5c1d35e1b64bd0b4fe9`.
Its generated configuration includes Smart Placement. The earlier installation remains intact.
The account and exact name absence are checked before any resource creation.
`npm ci` installs 262 packages and reports zero vulnerabilities.
All nine migrations, build, deployment dry run, deployment, atomic bootstrap, and initial secret creation pass in order.

| Resource | Trial value |
| --- | --- |
| Worker and D1 name | `minsky-install-t0020-b1b80054` |
| Origin | `https://minsky-install-t0020-b1b80054.icaic-minsky.workers.dev` |
| D1 UUID | `771001e6-9735-4320-94fd-38d320a26bee` |
| Private Standard R2 bucket | `minsky-install-t0020-b1b80054-images` |
| Initial Worker version | `6cf4977a-7146-4034-b7ef-67b8e912eff4` |
| Active version after initial secret | `9b48ef91-299b-4a88-9602-2a4837dfacc8` |
| Installation UUID | `f8c10093-fcd7-4dcc-bf39-ed3945ff9bbe` |
| Owner UUID | `605022c0-ee04-4d4d-a12b-4ee207c40257` |

The complete current React journey passes once, with zero failures, skips, retries, flaky results, or infrastructure errors.
It includes the merged jury worklist and the same workflow, image, live-update, phone, keyboard, and revocation assertions.
The first-owner password gate, configured roster, and closed intake pass.
Repeated bootstrap and initial-secret commands refuse to replace existing state.
Trusted sole-owner recovery invalidates the old owner session with HTTP 401 and requires another password change.
The original installation, account, membership, issue, and history remain identical across recovery.

Scoped cleanup removes the journey's exact D1 records, R2 objects, and coordinator state before journal removal.
A separate atomic ownership guard removes only the recovery-proof issue, history, receipt, two notifications, and issue counter.
Final checks retain one installation, account, identity, credential, event, session, and administrator membership, plus two teams.
Workflow records, staff roles, image records, deletion records, and pending notifications are zero. The private bucket is empty.
Twenty delivered baseline notifications, seven audits, and three monotonic audience counters remain with their matching coordinator cursors.
Intake remains closed. The owner is enabled and ready after the final password change.

The browser trial passes at 06:51:33 UTC. Proof cleanup passes at 06:52:56 UTC, and final read-only checks pass at 06:53:29 UTC.
The fictional installation remains available for owner review. No real data or active backend is changed.
Current owner credentials remain in the private mode `0600` file `/tmp/minsky-empty-install-b1b80054/private/owner-recovered-current.json`.
Earlier password files are stale. Open the current file privately.

### Current-source empty installation

A new clean checkout of `25b2033aef57fce8900487e4afa7df7c12c76100` repeats the complete installation procedure with explicit placement.
The exact account and resource-name absence checks precede provisioning. Both earlier installations remain intact.
Database creation requests `--location=apac`. A real `SELECT 1` confirms an APAC primary, with 0.3967 milliseconds of SQL execution.
Public settings include `placementRegion: "aws:ap-southeast-1"`. Deployed service metadata confirms the targeted mode and region.
`npm ci` installs 262 packages with zero reported vulnerabilities.
All nine migrations, build, deployment dry run, deployment, bootstrap, and initial secret creation pass in order.

| Resource | Current trial value |
| --- | --- |
| Worker and D1 name | `minsky-install-t0020-a0dd9afc` |
| Origin | `https://minsky-install-t0020-a0dd9afc.icaic-minsky.workers.dev` |
| D1 UUID | `4a96403e-99ea-4b07-b581-fe06ace879aa` |
| Private Standard R2 bucket | `minsky-install-t0020-a0dd9afc-images` |
| Initial Worker version | `ff7ff6ab-c8bd-4f7d-83f5-ba5ca61b21aa` |
| Active version after initial secret | `0a39a579-6be3-4c71-b2ed-c268fa592534` |
| Installation UUID | `fa6029d0-63a6-48cb-a9a2-4ce15c56f69b` |
| Owner UUID | `62055103-98b6-4bea-9653-ebb851aedea2` |

The complete trial passes once in 178.275 seconds, with zero failures, skips, retries, flaky results, or infrastructure errors.
It includes the unchanged current React journey, merged jury worklist, phone and keyboard checks, workflow, private images, live updates, and revocation.
First-owner password gates, configured roster, closed intake, and repeated bootstrap and secret refusals pass.
Trusted owner recovery rejects the old session with HTTP 401 and requires another UI password change.
The exact installation and account IDs, administrator membership, issue, and history remain identical across recovery.
The private fixture checks the explicit region separately and retains the unchanged strict journal identity.
No browser request uses Supabase.

UUID-scoped cleanup verifies the journey's D1 records, exact R2 objects, and empty fixture coordinator state before journal removal.
Atomic ownership guards then delete only the separate recovery-proof rows. Browser contexts close.
Final counts retain one installation, account, identity, credential, event, session, and administrator membership, plus two teams.
Workflow fixture rows, staff roles, images, deletion records, pending notifications, and bucket objects are zero.
Twenty delivered baseline notifications, seven audits, and three monotonic audience counters remain with matching baseline coordinator cursors.
Intake remains closed. The owner is enabled and ready after the final password change.
The bucket's public development URL is disabled, and no public custom domain exists.

The browser trial passes at 07:26:14 UTC. Proof cleanup passes at 07:27:19 UTC, and final read-only checks pass at 07:28:01 UTC.
A separate refusal check passes at 07:28:36 UTC with writes forbidden and no password hashing started.
At 07:31:53 UTC, both documented metadata commands also pass with the provisioning configuration, without a D1 binding.
They confirm the exact database name and UUID, then return `1` from the APAC primary. Neither command changes data.
Current owner credentials remain only in the private mode `0600` file `/tmp/minsky-empty-install-a0dd9afc/private/owner-recovered-current.json`.
Open that file privately. Earlier password files for this trial are stale.
The initialized fictional installation remains available for owner review. This trial does not replace protected GitHub verification or establish production capacity.

### R2 need and cost

The connector needs private R2 buckets for fictional image uploads and deletion-recovery checks.
The empty installation needs a separate bucket to prove resource isolation.
Use Standard storage. Do not enable Infrequent Access or other storage products.
[Cloudflare pricing](https://developers.cloudflare.com/r2/pricing/) was checked on 2026-10-18.
Standard includes 10 GB-month of storage, one million Class A operations, and ten million Class B operations each month.
Usage above those allowances costs US$0.015 per GB-month, US$4.50 per million Class A operations, and US$0.36 per million Class B operations.
Internet egress is free. These are account-wide allowances, not separate allowances for each bucket.
Small fictional fixtures should fit within them, but this estimate does not prove the account's remaining allowance.
Workers Paid is already active. No further Workers plan upgrade is proposed.
The owner confirmed R2 activation during this run. No further subscription upgrade was required.

The newest record appears first. Older sections describe their own revisions and targets.

## T0009 parallel maintenance, 2026-10-18

The owner requested current-main integration and verification of [PR #23](https://github.com/GiftedNovaHD/minsky/pull/23).
Work uses the existing `feature/t0009-jury-worklist` branch in `/tmp/minsky-t0009`.
The integration baseline is `main` at `7d19b00`, which includes PR #41.
This T0009 run did not edit the separate connector checkout.
T0020 retains its complete-connector and empty-installation scope.

The worklist uses provider-neutral `Backend` contracts and authorized snapshots.
Existing workflow operations enforce current permissions, transitions, stale revisions, and request receipts at the server.
Supabase remains active. This maintenance adds no schema, backend feature, provider implementation, or runtime dependency.
The owner reviews and merges. No application deployment or data migration is authorized.

### Current local checks

| Check | Observed result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run build` | Passed. The final build emits a 308.24 kB JavaScript bundle without a size warning. |
| `npm run check:functions`, `npm run test:functions` | Passed. All 12 function tests passed. |
| `npm run docs:build` | Passed. Built 14 pages and checked 566 local links and assets. The existing `/404` route warning remains. |
| `npm run test:providers:list` | Listed eight scenarios. This lists tests and does not verify a hosted provider. |
| `npm test` | Passed all 276 tests in 22 files in 33.88 seconds after the resource-heavy browser suites ended. |
| `npm test -- --no-file-parallelism` | Passed all 276 tests in 22 files in 73.30 seconds. No assertion or timeout changed. |
| `npm run test:e2e -- --workers=2 --output=/tmp/minsky-t0009-e2e-results` | Passed all 44 cases in 42.5 seconds, including all ten jury cases. |
| `npm run docs:test` | Passed all three cases in 4.9 seconds. |
| Repository Markdown links | Checked 181 local links in eight affected root documents. Passed. |
| `npm run test:auth:browser -- --output=/tmp/minsky-t0009-auth-results` | Passed all three cases in 9.6 seconds. The local HTTPS Worker logged expected self-signed TLS alerts. |

Initial setup attempts hit sandbox `esbuild` `EPERM`, loopback restrictions, and missing or incomplete Chromium binaries.
The checks passed after correcting permissions and installing the pinned browser.
One default-parallel unit attempt timed out during resource-heavy concurrent checks and then hit a cleanup assertion.
Both serial and default-parallel execution passed afterward. No timeout or assertion changed.

The application suite covers eligibility, ordering, zero-minute decisions, reopening, two-client updates, and uncertain retries.
It checks drafts, focus, queue independence, role and session changes, membership removal, archival, failed reads, and isolation.
These browser cases use simulated transport with the current migration-owned PostgreSQL rules, snapshots, and workflow transactions.
They do not establish hosted acceptance.
Desktop and 320px and 390px screenshots were inspected without visible clipping.
Keyboard navigation, return focus, CSS zoom, and reflow checks pass.

Two new test assumptions required correction.
The isolation precondition tried to reply to a resolved issue. The server correctly rejected that action.
The test now reopens the issue before replying.
The membership-removal test expected an exception, but the current snapshot intentionally returns null membership and empty protected data.
The test now checks that exact authorized response.
Concurrent browser suites also shared an output directory and hit an artifact `ENOENT` error.
Separate `/tmp` output directories corrected the artifact collision without changing application assertions.

### Hosted and protected checks

The hosted-service CLI run targets only Minsky CI, `ghtztmovdkhuketcbjmq`.
Prerequisite inspection found all nine local migrations and the account and attachment functions already present.
An unrelated remote migration, `202610110002`, remains unchanged.
The final full local CLI run against hosted services passed all 16 cases in 2.3 minutes.
It started at `2026-10-18T03:06:52.639Z` and used runtime source revision `f45d03f`.
Two real jury cases check Realtime updates and wait for the confirmed snapshot before checking draft and focus preservation.
They also cover zero-minute decisions, reopening, re-resolution, and committed actions whose responses are deliberately dropped.
Award and external-confirmation retries retain identical request IDs.
The tests confirm one award, one confirmation, and one history entry for each action.

The first full hosted attempt passed 15 of 16 cases.
Its second new jury case failed at a status-selector locator before completing.
The exact label included wrapped option text. The corrected locator uses the exact **Status** combobox role.
This correction changes no application assertion.

Cleanup checks found zero remaining run-owned records in all 16 categories, including Storage, Auth, and request receipts.
Both the completed run and the failed attempt were checked.
Audit records are `/tmp/t0009-cloud-audit-1792292812639-cleanup.json` and `/tmp/t0009-cloud-audit-1792292637288-cleanup.json`.
Unrelated fixtures, migrations, and provider configuration remain unchanged.

The owner approved adding only `feature/t0009-jury-worklist` to the protected `cloud-test` branch allowlist.
The branch policy was added as ID `63431065`.
The four existing entries and branch protection ID `69128862` remain unchanged.
Ordinary [push checks](https://github.com/GiftedNovaHD/minsky/actions/runs/39092550990) and [PR checks](https://github.com/GiftedNovaHD/minsky/actions/runs/39092552506) passed on `f45d03f`.
The protected `existing_backend=true` check passed on `f45d03f` in [run 39092567628](https://github.com/GiftedNovaHD/minsky/actions/runs/39092567628).
Its results are separate from the local hosted-service CLI run:

| Protected check | Observed result |
| --- | --- |
| Unit and database tests | All 276 passed. |
| Function tests | All 12 passed. |
| Application browser tests | All 44 passed. |
| Authentication and documentation browser tests | All three cases in each suite passed. |
| Hosted application journey | All 16 cases passed in 2.9 minutes. |
| Supabase shared provider scenarios | All eight passed in 1.8 minutes. |
| Hosted shared server workflow | All five passed. |

No recovery journals remained after provider and workflow cleanup.
The deployment job and all six backend preparation steps were skipped.
Repository variable `CLOUDFLARE_DEPLOY_ENABLED=false` is confirmed. No application deployment was performed.

### Integration boundaries and remaining checks

The worklist changes overlap T0020 at `ConnectedApp.tsx` navigation, selection, and issue-detail return handling.
Shared styles contain a separate jury-worklist block.
Planning-document changes preserve T0020's connector scope. This T0009 run did not edit that checkout.

Required verification and hosted acceptance pass for runtime source `f45d03f`.
PR #23 is prepared for owner review.
The final follow-up changes documentation only. It does not change that verified runtime source.
Checks for the documentation follow-up must be reported against its own revision after the commit exists.
No required runtime verification remains outstanding.
The 2026-10-15 results below are historical and do not establish current-main compatibility.
Record local browser simulations, hosted-service CLI runs, and protected GitHub Actions results separately.
Physical devices, native browser zoom, screen readers, and other browser engines remain unverified.

## T0009 jury worklist (2026-10-15)

Historical record. These results apply to the stated revision only.
Current-main integration and verification appear in the 2026-10-18 record above.

Implemented on `feature/t0009-jury-worklist`, from updated `main` at `1ed603a`.
Source revision: `2ce66bd`; [draft PR #23](https://github.com/notbowen/minsky/pull/23).
The user authorized this work independently of the open T0005–T0008 branches.
Those branches were not merged or copied into this implementation.
The feature is not deployed. The user reviews and merges; merge does not deploy.

Implemented:

- Jury and combined-role members have a separate sidebar entry. Admin-only,
  support-only, and contestant accounts gain no new capabilities.
- **Needs decision** lists resolved issues without an award, oldest resolution
  first. **Pending external application** lists every unapplied award, oldest
  decision first, including zero-minute decisions and reopened issues. Counts,
  resolution evidence, authenticated attribution, and timing use the existing snapshot.
- Existing issue details and forms handle decisions and explicit external
  confirmation. Jury-only members can reach a reopened issue's pending award.
  Return focus goes to the originating row or section heading. Queue filters and
  selection remain independent. Re-resolution does not create a second award.
- Existing refresh, Realtime invalidations, revision checks, and request receipts
  are reused. No schema, policy, backend function, provider resource, or runtime
  dependency was added. The HTML title no longer refers to the retired local demo.

Verification:

| Check | Observed result |
| --- | --- |
| Type checking, lint, production build, Deno function check | Passed locally |
| `npm test` | All 34 focused and database tests passed, including 12 new worklist cases |
| `npm run test:e2e` | All 10 browser cases passed: seven jury cases and three existing public-page cases |
| Local two-client updates | Passed with simulated Auth/HTTP/Realtime transport and actual migration-owned PostgreSQL RLS, snapshots, and workflow transactions |
| Cloud integration | Could not start: the credential lookup for the isolated Minsky CI project failed before fixture creation |
| Protected GitHub cloud job and hosted deployment | Not run; no deployment was performed |
| Dependency audit | `npm audit --audit-level=high` reported zero vulnerabilities |
| Documentation | All 63 local links/anchors and whitespace checks passed |

Browser plugin not available; repository Playwright/Chromium was used at
`http://127.0.0.1:4173`. Checks covered eligibility, ordering, zero-minute decisions,
reopened confirmations, queue-filter independence, two-client updates, preserved
drafts, lost-response retries without duplicate decisions, session/role changes,
membership removal, archival, failed reads, refresh, empty states, and focus.
The screenshot case checks page title, meaningful content, interactions, and
absence of application errors or warnings. Desktop and 390/320px screenshots
were reviewed; 720px reflow and 200% CSS zoom are also automated. Native browser
zoom, physical phones, screen readers, and other browser engines remain unverified.
Screenshots, traces, and browser output are outside the repository under `/tmp`.

The build retains the main-bundle size warning. Deno synchronized workspace
metadata with dependency versions already accepted on `main`; the function's
resolved dependencies are unchanged. The Google TypeScript guide was read before
source changes. Repository double quotes, React component capitalization, and
inferred component returns are deliberate existing style/framework exceptions.

Verification corrections: the first network commands lacked sandbox network
access, then passed with that access. The first dependency install used an
unwritable home cache, then passed with a `/tmp` cache. Fixture UUID defaults were
typed explicitly, the Playwright fixture callback was renamed to avoid a React
Hook lint false positive, and overly strict label locators were corrected.
The simulated Realtime payload now includes PostgreSQL column metadata. Browser
testing caught the return-focus case after a row moved sections; it was corrected
before the passing run. None of those failed attempts count as passing checks.

The [specification](jury-worklist.md) and [manual walkthrough](manual-verification.md#13-jury-worklist-t0009)
record remaining acceptance. Cloud results must not be inferred from local
transport simulations. The hosted test includes zero-minute award, reopening,
external confirmation, re-resolution, and rejection of a second award, but is unverified.

### PR23 review fixes (2026-10-15)

The shared cloud journey now saves the volunteer's changed password in its
private fixture file and restores the event's previous archive state in `finally`,
including when an assertion fails. The later jury case can reuse that fixture
without inheriting stale credentials or an archived event. All updates stay
within the run's UUID-scoped fixture; no shared project state was changed.

The two-client browser case now waits for the first client's completed snapshot
response containing the other issue's award before checking the explanation
draft and keyboard focus. An unchanged pre-refresh draft can no longer satisfy
the check before that response arrives.

After these fixes, type checking, lint, build, Deno checking, all 34 unit/database
tests, and all 10 credential-free browser cases passed. Browser plugin not
available; Playwright used system Chromium and a temporary configuration outside
the repository. The cloud runner still cannot retrieve credentials for the
isolated Minsky CI project `ghtztmovdkhuketcbjmq`; it stopped before fixture
creation. Listing the cloud suite confirms 13 cases, but does not execute them.
Hosted verification remains unverified, and PR23 remains a draft. The build
retains its existing bundle-size warning. No deployment was performed.


## PR #41 review corrections and paid authentication, 2026-10-18

The owner requested the PR #41 fixes, a second review, bounded code cleanup, and completion of hosted authentication verification.
Implementation commit `7abaf2e` is on `feature/t0019-shared-server-workflow` and is pushed to PR #41.
The owner confirmed Workers Paid activation during this run.
Supabase remains the active application backend. The owner still reviews and merges.

### Expiry correction and code review

The review found one P2 defect in the shared Supabase commit path.
`statement_timestamp()` retained the statement's start time while the commit waited on locks.
A login that expired during that wait could still authorize a write or receipt replay.

Migration `202610180002_shared_workflow_expiry.sql` replaces the read helper with current wall-clock checks.
The helper is volatile because its result can change during a statement.
The installed initial migration remains unchanged, and the service-only grants remain in place.
Two embedded PostgreSQL regressions simulate expiry during a commit statement.
Both failed before the correction and pass afterward, without workflow writes or receipt replay.

The cleanup removes unused D1 permission projections and repeated text normalization from the persistence adapter.
The shared service counts each text value's Unicode code points once.
Authentication now reuses its existing cryptographic secret generator.
Password parameters, credential gates, attempt limits, and current-access guards remain unchanged.
The second review found no additional defect in the affected paths.
Existing D1 and database tests retain their local quote style. Runtime imports retain the extensions required by their tools.

### Observed verification

- Local: all 264 tests pass across 21 files, including 23 shared PostgreSQL cases and 42 bounded D1 cases.
- Local: type checking, lint, the application build, Deno function checks, and all 12 function tests pass.
- Browser: all 34 application cases and three local HTTPS authentication cases pass.
- Documentation: the build checks 14 pages and 566 local links and assets. All three documentation browser cases pass.
- Hosted Supabase: all five focused cases pass on `7abaf2e` through the CI workflow function at version 3. The run began at 2026-10-18 02:26:13 UTC and took 43.48 seconds.
- Hosted D1: all 42 bounded proof cases pass on `7abaf2e`. The run began at 2026-10-18 02:26:57 UTC and took 31.46 seconds.
- Hosted authentication HTTP: the complete case passes on `7abaf2e`. The run began at 2026-10-18 02:25:21 UTC and took 20.42 seconds.
- Final authentication deployment: the same HTTP case passes again after restoring the reviewed PR source. The run began at 2026-10-18 02:39:22 UTC and took 16.67 seconds.
- Protected authentication: [run 39089988536](https://github.com/GiftedNovaHD/minsky/actions/runs/39089988536) passes on merged `main` at `68e8642`. All 30 hosted account cases pass in 454.95 seconds. The complete hosted HTTP case passes in 121.67 seconds.
- Ordinary PR #41 CI: `checks`, `secrets`, and `dependencies` pass on `7abaf2e` in [push run 39090161332](https://github.com/GiftedNovaHD/minsky/actions/runs/39090161332) and [PR run 39090164240](https://github.com/GiftedNovaHD/minsky/actions/runs/39090164240).

The hosted runners verified scoped fixture cleanup and removed their recovery journals.
The authentication HTTP case checks the password-change lifecycle, temporary-password gates, recovery, permissions, cookies, revoked sessions, CSRF protection, and origins.
The local HTTPS fixture reports expected self-signed certificate alerts. All three browser assertions pass.

### Hosted changes and evidence boundaries

The Supabase project list confirmed Minsky CI, `ghtztmovdkhuketcbjmq`, before mutation.
An isolated operational directory fetched the complete migration history, including the CI-only announcement migration.
The fetched initial workflow migration differed only in empty lines. Its recorded source was preserved.
The dry run selected only `202610180002_shared_workflow_expiry.sql`, and that migration was applied.
The current workflow function was deployed only to Minsky CI, at version 3 with `verify_jwt=false`.
Its bundle SHA-256 is `ae8b4836df76cccc2e0927f09d02e46e1b70580e6eee592e1ef566a742035174`.
The first post-migration hosted run also passed five cases before the function refresh. The final run above verifies the refreshed function.

The bounded D1 proof used the separate `minsky-d1-proof-ci` database, `06560c1c-8907-47d6-b2b6-f22e129ebbe4`.
Authentication used only `minsky-auth-ci`, database `5d746d29-0a66-4346-96a6-4974126685d7`, in account `458ad6a930b0fb717796dfa19ca6a2b1`.
The authentication database required no new migrations.
Workers Paid accepted the existing 1,000 ms cap. The earlier Free-plan error `100328` no longer blocks deployment.
The PR #41 HTTP run used Worker version `9504e46d-e216-44eb-9065-cc36492e6fd9`.
The protected `main` run deployed version `7eedbdc3-ac11-48dc-ba69-6a67ec6a43f1`.
Its recovery-artifact step found no remaining fixture journals after both suites passed.
After that run, the CI Worker was restored to the reviewed PR source at version `afaa6c59-1143-4a0b-9593-a8263a5c5dc6`.
The repeated HTTP suite passed against that final deployment and verified scoped cleanup.
The maintained scrypt settings remain unchanged.

The protected authentication workflow uses `main`, which the existing `cloud-test` allowlist already permits.
It verifies the merged PR #40 source. The PR #41 hosted runs separately verify the revised source.
The environment's four branch entries and its protection rules remain unchanged.
This run made no development backend deployment, real-account change, data export, or active backend switch.

### Run report

1. Summary of changes. Corrected expiry after lock waits, added two regression cases, removed duplicate adapter work, and verified hosted authentication on Workers Paid.
2. Files changed. Added `supabase/migrations/202610180002_shared_workflow_expiry.sql`. Updated `src/server/adapters/supabase/store.test.ts`, `src/server/adapters/d1/store.ts`, `src/server/adapters/cloudflare/authentication.ts`, and `src/server/workflow.ts`. Updated `AGENTS.md`, `PLAN.md`, `docs/current-state.md`, `docs/tickets.md`, `docs/server-workflow.md`, and `docs/verify-server-workflow.md`. Updated `docs/cloudflare-authentication-choice.md`, `docs/verify-cloudflare-authentication.md`, `docs/product-direction.md`, `docs/cloudflare-backend-design.md`, and `site/src/content/docs/reference/status.md`.
3. Commands run. Used `git status`, `log`, `diff`, `fetch`, `add`, `commit`, and `push`. Used `gh api`, `workflow run`, `run view`, `run list`, `pr checks`, and `pr edit`. Read repository files with `cat`, `sed`, and `rg`. Read the Google TypeScript guide and Cloudflare's limits and pricing. Ran `npm test`, `typecheck`, `lint`, `build`, `check:functions`, `test:functions`, `test:e2e`, `test:auth:browser`, `docs:build`, and `docs:test`. Ran `test:workflow:hosted`, `test:d1:hosted`, and `test:auth:http` with the isolated targets. Supabase commands included `projects list`, `link`, `migration fetch`, `db push --dry-run`, `db push --yes`, `functions deploy`, and `functions list`. Ran `node scripts/auth-target.mjs`, Wrangler CI migrations and deployment, local Markdown link checks, and `git diff --check`. Provider access and local sockets required escalation. The two new regressions failed before the fix. The first migration comparison stopped on empty-line differences before any mutation.
4. Build/test results. All listed local, hosted, protected authentication, and ordinary implementation CI checks pass.
5. Manual verification steps. Inspected expiry semantics, migration history, target isolation, service-only grants, retry behavior, permission guards, refactor equivalence, and fixture cleanup. Interactive product screens were not manually repeated. Automated browser checks cover the existing phone and keyboard regressions.
6. Risks. The active application still uses legacy SQL. The replacement workflow is deployed only to CI. T0019's protected Supabase job was not run because its branch remains outside the existing allowlist. Full D1 persistence, live delivery, migration, and contest capacity remain unverified.
7. Follow-up tickets. Owner review and merge of T0019. Existing candidates remain the remaining D1 commands, full connector verification, and an approved Supabase-path activation.
8. Docs that need updating. None for this scope.

## T0019 shared server workflow, 2026-10-18

T0019 starts from updated `main` at `0c797ad` on `feature/t0019-shared-server-workflow`.
The separate worktree is `/tmp/minsky-t0019`.
The authentication checkout remains unchanged.
The owner merged PR #40 into `main` at `68e8642` on 2026-10-17 at 17:16:41 UTC.
T0019 then merged that updated main to resolve review conflicts and preserve the authentication implementation.
Its protected HTTP authentication result remains incomplete after the Workers Free resource limit.
No paid subscription change occurred.

The [workflow reference](server-workflow.md) inventories all nine existing commands and their effective SQL definitions.
`WorkflowService` now makes the shared decisions and coordinates request receipts and guarded commits.
The Supabase `workflow` Edge Function verifies the bearer with Auth, then calls the shared service.
Service-only persistence functions recheck current access and captured state under locks.
PostgreSQL supplies authoritative commit timestamps and atomic state, history, notification, and receipt writes.
The active browser adapter retains the legacy SQL path during replacement verification.
D1 still supports only `claim`, `message`, and its limited issue view. Its commands now use the shared decisions and orchestration.

Review is in [PR #41](https://github.com/GiftedNovaHD/minsky/pull/41).
The final implementation commit is `61da723438a435586b1c1332939e5a30353a4a1d`.

### Observed verification

- Local after main integration: 262 tests pass across 21 files. These include 21 shared PostgreSQL cases, 42 local D1 cases, and authentication regressions.
- Local: type checking, lint, application build, Deno function checks, 12 function tests, all 34 application browser regressions, and three HTTPS authentication browser cases pass.
- Documentation: the build checks 14 pages and 566 local links/assets. All three documentation browser tests pass.
- Hosted Supabase: all five focused cases pass through the deployed `workflow` function on Minsky CI, `ghtztmovdkhuketcbjmq`. The final run checked committed implementation `61da723438a435586b1c1332939e5a30353a4a1d`. It began at 2026-10-17 17:28:18 UTC and took 49.25 seconds.
- Hosted D1: all 42 changed bounded-proof cases pass against `minsky-d1-proof-ci`, database `06560c1c-8907-47d6-b2b6-f22e129ebbe4`. The run began at 2026-10-17 17:12:57 UTC and took 69.32 seconds. Fixture deletion checks passed.
- Ordinary GitHub Actions: [implementation run 39053057235](https://github.com/GiftedNovaHD/minsky/actions/runs/39053057235) passed `checks`, `secrets`, and `dependencies` on `8f8145c`. Cloud and deployment jobs did not run.
- Ordinary GitHub Actions after main integration: [run 39053704275](https://github.com/GiftedNovaHD/minsky/actions/runs/39053704275) passed on `42caed9`. The final submit-validation assertion follows that run.
- Protected GitHub Actions: not run for T0019. The `cloud-test` branch allowlist excludes this branch. Its existing entries and protection rules remain unchanged.

Hosted Supabase verifies the shared lifecycle, all command variants, persisted history, public/private separation, and team/session isolation.
It also verifies duplicate and conflicting request IDs, concurrent claims, and a response lost after commit followed by retry.
It also rejects forged browser identity fields, unsigned callers, direct browser commit plans, and a permission change between read and commit.
The additional local PostgreSQL cases test credential, login, account, event, membership, intake, and private-state changes before commit, repeated resolution timing, rollback, and direct table denial.
The [verification guide](verify-server-workflow.md) gives exact commands and recovery steps.

### CI preparation and cleanup

The project list confirmed the target as Minsky CI before changes.
An operational directory fetched its existing migration history, including `202610110002_announcements`.
The dry run selected only `202610180001_shared_workflow.sql`.
The CLI applied that migration. It made no history repair or unrelated migration change.
The applied source matches the repository migration.
The main-merge resolution did not change the shared service, Supabase function, commit migration, or D1 adapter.
The final compatibility review also preserved ignored contestant team overrides, including malformed unused values.
A local regression and the hosted identity-boundary case verify this input behavior.
The bounded D1 claim/message paths remain unchanged by that submit validation fix.
Local D1 now loads migrations `0001` through `0004`. The hosted proof retains `0001` and `0002`.
The CLI deployed only the new `workflow` function, at version 2 with `verify_jwt=false`. Its handler verifies every bearer itself.
Its deployment ID is `a8d178ba-7c60-459c-a64e-ba155cc50ddb`.
The CLI reported bundle SHA-256 `ef1eb24f67d037ca4648a47044b65fc4b89e67c7e6e043ed6dda57d37b76cabf`.
No development backend deployment, real-account change, backend switch, or data export occurred.

The first hosted attempt passed four cases. Its fifth fixture setup hit Auth's password-update rate limit.
A second attempt hit the same limit during setup. Both cleaned up their own records.
The final harness uses one UUID-owned run and organizer-provisioned fixture passwords.
It still completes the real mandatory-password database gate after Auth changes the hash.
Existing authentication scenarios retain their normal setup and checks.
The passing run removed its recovery journal after ownership-checked cleanup.
These results do not verify the user password-change endpoint or live notification delivery.
The final runner also passed its read-only database and function prerequisites before fixture creation.
A wrong-target invocation refused to create fixtures.
Explicit `.ts` imports support the Deno runtime. The no-emit TypeScript check permits these imports.
Existing D1 and SQL test files retain their local quote style.

### Run report

1. Summary of changes. Extracted existing workflow decisions and request orchestration. Added a trusted Supabase execution path and aligned the bounded D1 proof.
2. Files changed. Created `src/server/workflow.ts`, `src/server/workflow.test.ts`, `src/server/adapters/supabase/store.ts`, `src/server/adapters/supabase/store.test.ts`, `src/server/adapters/supabase/http.ts`, and `src/server/adapters/supabase/http.test.ts`. Created `src/backend/supabase/workflow.ts`, `src/backend/supabase/workflow.test.ts`, `supabase/functions/workflow/index.ts`, `supabase/functions/workflow/deno.json`, and `supabase/functions/workflow/deno.lock`. Created `supabase/migrations/202610180001_shared_workflow.sql`, `tests/workflow/supabase.test.ts`, `scripts/workflow-proof.mjs`, `vitest.workflow.config.ts`, `docs/server-workflow.md`, and `docs/verify-server-workflow.md`. Updated `src/server/adapters/d1/store.ts`, `tests/providers/supabase/fixture.ts`, `.github/workflows/checks.yml`, `supabase/config.toml`, `eslint.config.js`, `package.json`, `playwright.config.ts`, and `tsconfig.json`. Updated `AGENTS.md`, `PLAN.md`, `README.md`, `docs/backend-contracts.md`, `docs/provider-test-contracts.md`, `docs/cloudflare-backend-design.md`, `docs/cloudflare-implementation-plan.md`, `docs/d1-transaction-proof.md`, `docs/product-direction.md`, `docs/tickets.md`, `docs/current-state.md`, and `site/src/content/docs/reference/status.md`. Removed `src/server/issueRules.ts`.
3. Commands run. Used `git` for status, fetch, worktree creation, diffs, commits, trailer checks, push, and the merge from updated main. Used `gh` for PR inspection, creation, checks, and environment-policy reads. Read source and migrations with `cat`, `sed`, and `rg`. Read the official TypeScript guide and Supabase Auth documentation. Ran `npm run typecheck`, `lint`, `build`, `check:functions`, `test:functions`, `test:e2e`, `test:providers:list`, `docs:build`, and `docs:test`. Ran `npm test`, `npm run test:auth:browser`, `npm ci --prefix site`, and `playwright install chromium`. Ran `npm run test:workflow:hosted` and `npm run test:d1:hosted` with explicit isolated targets. Supabase commands included `projects list`, `link`, `migration list`, `migration fetch`, `db push --dry-run`, `db push --yes`, `functions deploy`, and `functions list`. Confirmed existing Cloudflare access with `wrangler whoami`. Ran documentation path, writing, and whitespace checks. Initial sandbox Git, sockets, provider access, and Deno downloads needed escalation. Corrected initial test compilation and lint issues. Excluded the hosted Vitest suite from Playwright discovery and supplied its missing browser binary under `/tmp`. Astro required a local locked install instead of a dependency symlink.
4. Build/test results. The list above gives observed passing results. Initial hosted failures were fixture Auth rate limits. Protected GitHub results remain separate and unverified.
5. Manual verification steps. Inspected effective migrations, identity boundaries, commit dependencies, provider targets, cleanup scope, and unchanged environment restrictions. Bounded agents independently inventoried rules, implemented persistence/tests, and reviewed the shared service. Manual product UI checks: not repeated. The active UI path remains unchanged.
6. Risks. The active backend still uses legacy SQL. The new path has verification evidence on CI only. D1 identity-backed workflows need commit guards for credential generations and Better Auth session expiry and deletion. Full D1 commands, live delivery, installation, migration, and contest capacity remain unverified. T0018's hosted HTTP check remains incomplete.
7. Follow-up tickets. Owner review and merge of T0019. Later candidates are remaining D1 persistence through the shared service, full connector verification, and an approved Supabase-path activation. PR #40 has merged. Its authentication source remains unchanged by this extraction. AWS, Terraform, R2, and migration tooling remain deferred.
8. Docs that need updating. None for the completed scope. A later approved protected run must add its separate evidence.


## T0018 Cloudflare authentication, 2026-10-18

T0018 starts from `main` at `0c797ad` after PR #39 merged on 2026-10-17 at 15:49:49 UTC.
The working tree was clean. The branch is `feature/t0018-cloudflare-authentication`.
[PR #40](https://github.com/GiftedNovaHD/minsky/pull/40) contains implementation commit `48ed3dbc2f1359e8160610fdfe7ffa4cec313f44`.
The owner reviews and merges.
Supabase remains the active application backend. No real-data export, real-account reset, migration, or backend switch occurred.

### Implemented behavior

Better Auth `1.7.10` supplies username authentication and signed cookie sessions through a server identity adapter.
The bounded browser adapter implements the shared `Authentication` interface.
The HTTP boundary enforces exact origins, JSON requests, custom headers, and current CSRF tokens.
Hosted cookies are host-only, Secure, HttpOnly, SameSite Strict, and fixed to eight hours without refresh.
Every protected request checks current identity and approved D1 login state.

Guarded D1 operations preserve account IDs, memberships, permissions, and history.
Organizer resets require admin access to every assigned session. Any archived assigned event blocks the reset.
Temporary-password gates and revoked credentials are enforced at the server.
Resets revoke prior sessions before hashing. A persisted operation ID prevents older updates from replacing newer credentials.
Interrupted create or reset operations remain restricted and can receive another authorized reset.
Self changes hash before one atomic credential batch so a sole organizer can retry a rejected change.
An unknown commit outcome requires checking the new credentials. It does not prove a rollback.

The same temporary-authentication lifecycle assertions now serve Supabase and Cloudflare.
Cloudflare's complete workflow, image, and live-update provider scenarios remain later connector work.
See the [API reference](cloudflare-authentication.md), [choice and costs](cloudflare-authentication-choice.md), and [verification guide](verify-cloudflare-authentication.md).

### PR review corrections, 2026-10-18

The owner requested both PR #40 review fixes on the existing ticket branch.
Password changes now create a guarded replacement login without consuming another public username attempt.
The separate password-change limit, current-password verification, and credential-generation checks still apply.
Login, logout, and password changes invalidate overlapping subscription reads when each request finishes.
This prevents delayed reads from replacing the completed browser state after success, rejection, or an uncertain response.

Two added D1 cases check the exhausted username window and the separate password-change limit.
Eleven added transport cases check delayed focus, polling, and subscription reads, including failed logout requests.
All 224 local tests pass across 17 files. This includes 30 D1 account cases and 23 browser-adapter cases.
All three HTTPS authentication browser cases pass. Type checking, ESLint, the application build, and whitespace checks pass.
The existing application chunk-size warning remains.
The original delayed-logout reproduction now ends with the signed-out notification.
The new password-change regression failed with 429 before the fix and passes afterward.

Commands were `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`.
The browser run used `PLAYWRIGHT_BROWSERS_PATH=/tmp/minsky-playwright npm run test:auth:browser`.
The focused account command used `npm run test:auth -- --testNamePattern='last permitted username login|separate password-change attempt limit'`.
The initial sandbox run could not open the emulator's local socket. The authorized rerun reached the regression assertion.
No product screens changed. Interactive phone and keyboard checks were not repeated.
The hosted HTTP result remains incomplete until Workers Paid is active and protected verification passes.

`node scripts/auth-target.mjs` confirmed the existing account and isolated `minsky-auth-ci` database before fixture writes.
The local CLI then ran these two regression cases against hosted D1:

```sh
npm run test:auth:hosted -- \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=5d746d29-0a66-4346-96a6-4974126685d7 \
  '--test-name-pattern=last permitted username login|separate password-change attempt limit'
```

Both cases passed in 79.93 seconds. The other 28 cases were skipped.
The fixtures verified scoped cleanup. This was a focused local CLI run, separate from protected GitHub Actions.
No schema, Worker deployment, or paid subscription changed during this correction run.

### Resources and execution evidence

Existing Wrangler OAuth access matched account `458ad6a930b0fb717796dfa19ca6a2b1` before provisioning.
Development and HTTPS browser checks use disposable local databases.
Hosted checks use separate `minsky-auth-ci`, ID `5d746d29-0a66-4346-96a6-4974126685d7`, in APAC with read replication disabled.
All four repository migrations are applied there.
The dedicated Worker is `https://minsky-auth-ci.icaic-minsky.workers.dev`.
Its private random secret was installed without printing or storing the value in repository files.
The protected job deployed Worker version `99cbba19-3afd-4e46-ab15-e09f7bd3115a` from `8cfd7a5`.

| Check | Observed result |
| --- | --- |
| Local unit, script, PostgreSQL, D1, and authentication checks | 211 tests passed across 17 files. Includes 28 account cases and three password-component cases. |
| Local type checking and ESLint | Passed. |
| Application build | Passed. Existing large-chunk warning remains. |
| Supabase function checks | Deno type checks passed. All 12 attachment function tests passed. |
| Existing application browser regressions | All 34 passed. These tests use mocked provider responses. |
| Local authentication browser security | All three passed against Chromium, HTTPS workerd, and isolated D1. |
| Documentation build and browser checks | 14 pages and 566 links checked. All three browser cases passed. Existing duplicate `/404` warning remains. |
| Shared provider registry | Eight scenarios listed. The existing Supabase scenario now uses the extracted authentication helper. |
| Dependency audit | Root and site lockfile audits reported zero vulnerabilities. |
| Local CLI against hosted D1 | All 28 cases passed across the initial run and focused verification. Initial run: 25 of 26 passed in 719.74 seconds. Focused run: three passed in 61.96 seconds. |
| Hosted Worker HTTP | One comprehensive scenario passed in 108.29 seconds. It used the real adapter and shared lifecycle assertions. |
| Protected GitHub Actions | [Run 39049037968](https://github.com/GiftedNovaHD/minsky/actions/runs/39049037968) on `8cfd7a5` passed ordinary checks and all 28 hosted D1 account cases. The hosted HTTP scenario failed when Cloudflare terminated a password-change request for exceeding runtime resources. |

The first protected dispatch permitted only `main`, `feature/t0014-backend-adapters`, and `feature/t0015-provider-contract-tests`.
The owner then approved adding the exact T0018 branch to that allowlist on 2026-10-18 SGT.
The three prior entries and the environment protection remained in place. The first rejected job used no hosted credentials.
Protected run `39049037968` passed its target check, schema step, and deployment using the existing GitHub credential.
Its complete 28-case hosted D1 step passed in about 332 seconds.
A final focused hosted check populated issue history before reset and proved that the history, receipt, and notifications remained unchanged.
That additional case passed in 201.27 seconds, with 27 other cases skipped and scoped cleanup verified.
A later assertion-only change discards credential-bearing success values before expected-rejection checks.
This prevents a failing test from printing a generated password or cookie. Runtime behavior is unchanged.

The initial hosted D1 run returned an uncertain database outcome in the sole-organizer retry case.
The focused run passed that case and the two added regressions for Unicode equivalence and a lost committed response.
The focused run skipped the other 25 cases. It was not a complete 28-case run.
All fixtures verified scoped cleanup and removed their recovery journals.

The final hosted HTTP run started on 2026-10-18 at 00:07:32 SGT.
It checked exact 401 and 403 rejections, mandatory changes, reset recovery, cross-session permissions, expiry, revocation, cookies, origins, and CSRF.
A prior read encountered a connection reset. The fixture driver now retries safe GET requests at most three times.
It never automatically retries a state-changing request.
All local-CLI hosted HTTP cleanup assertions passed. The protected failed HTTP run also completed fixture cleanup.
The shared IP-attempt counter remains for daily expiry because no single fixture owns it.

The HTTPS browser suite checked cookie flags, scope, restoration, no browser credential storage, logout replay, stale passwords, other-browser revocation, hostile previews, preflight, and forged forms.
Those browser checks disabled traces, screenshots, and videos.
The browser runner verified empty UUID fixture records and removed its temporary database directory.
No new product screen requires a manual phone-layout check in this ticket.

### Password resource limits

Local workerd samples measured 56 to 62 ms for hashing and 52 to 61 ms for verification.
Hosted adaptive analytics recorded 66.425 ms for verification and 75.577 ms for an initial hash sample.
A separate small hash sample recorded a 96.311 ms median and a 196.446 ms 99th percentile.
These samples exceed the Workers Free 10 ms CPU allowance.
The selected maintained hash therefore needs a larger CPU allowance for dependable hosting.
The [choice record](cloudflare-authentication-choice.md#resource-evidence-and-deployment-cost) documents Standard's minimum US$5 monthly cost and usage charges.
No paid upgrade occurred. Three temporary benchmark Workers were deleted.
The protected HTTP failure produced one `exceededResources` invocation at 252.901 ms CPU.
The same invocation reported 16,724,317 bytes of memory in adaptive metrics. That value does not establish peak native allocation or concurrent capacity.
Cloudflare rejected a 1,000 ms CPU setting with error `100328`, which confirms that this account is on Workers Free.
The repository now requests that bounded CPU allowance for later paid verification. The rejected deployment did not change the active Worker.
The owner chose to obtain the subscription later on 2026-10-18 SGT. Hosted HTTP verification remains incomplete for the selected target plan.
Do not infer reliable Free operation from the earlier successful CLI runs.
These checks do not establish a fresh supported installation, production capacity, or contest latency targets.

### Limits and follow-up

The active Supabase backend is unchanged.
The remaining hosted HTTP result requires Workers Paid and another protected run. No paid upgrade occurred.
The Cloudflare connector still lacks the remaining workflow operations, private R2 images, and Durable Object notification delivery.
Better Auth upgrades must recheck the pinned schema and password format before deployment.
The experimental session summaries use IDs as names until the complete contest-session schema exists.
Venue-wide IP rate limits need later capacity review.
A Cloudflare owner-recovery procedure for lost sole-organizer credentials is required before independent installations are supported.
Full migration tooling, real-data exports, and cutover remain later authorized phases. AWS and Terraform remain deferred.


### Commands run and file inventory

The run used Git inspection, fetch, branch creation, and PR #39 metadata checks.
It used existing Wrangler access, D1 target inspection, isolated database creation, migrations, Worker deployment, private secret installation, and version inspection.
A later deployment with the prepared CPU cap failed with Cloudflare error `100328` on Free.
Read-only analytics established the resource rejection. The existing login received 403 for billing access. No subscription action ran.
It installed exact `better-auth@1.7.10` with npm.
The verification commands were `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run check:functions`, and `npm run test:functions`.
Browser commands were `npm run test:e2e`, `npm run test:auth:browser`, and `npm run docs:test`, with Chromium installed under `/tmp/minsky-playwright`.
Documentation checks used `npm run docs:build`, `npm run test:providers:list`, and `git diff --check`.
Both package lockfiles passed `npm audit --package-lock-only --audit-level=high` in their respective package directories.
The focused suites used `npm run test:auth`, `npm run test:auth:hosted`, and `node scripts/auth-http-test.mjs` with the explicit CI targets.
Hash measurements used `node scripts/auth-hash-benchmark.mjs` locally and with the explicit hosted account and separate operations.
`node scripts/auth-target.mjs` verified the automatic target guard.
The run created PR #40 and dispatched `checks.yml` with `cloudflare_auth=true`.
All new commits passed the exact required co-author trailer check before push.
Default exports in Worker entry points and test configuration follow the framework requirement.

Initial sandbox network and socket restrictions required authorized retries.
An initial browser launch lacked Chromium until the configured `/tmp` installation was selected.
The first hosted HTTP run had a connection reset. The D1 run and benchmark propagation limits are recorded above.
No new product screens received manual layout verification. Browser checks supplied the observed interaction evidence.
The owner still reviews and merges the PR. Remaining connector work follows that merge and scope selection.
Relevant ticket documentation is current. Broader release gaps remain tracked in the existing documentation release plan.

The created or modified files are:

```text
.github/workflows/checks.yml
AGENTS.md
PLAN.md
README.md
deno.lock
docs/backend-contracts.md
docs/cloud-onboarding.md
docs/cloudflare-authentication-choice.md
docs/cloudflare-authentication.md
docs/cloudflare-backend-design.md
docs/cloudflare-implementation-plan.md
docs/current-state.md
docs/d1-transaction-proof.md
docs/manual-verification.md
docs/product-direction.md
docs/provider-test-contracts.md
docs/tickets.md
docs/verify-cloudflare-authentication.md
eslint.config.js
package-lock.json
package.json
playwright.auth.config.ts
playwright.config.ts
scripts/auth-browser-fixture.mjs
scripts/auth-hash-benchmark.mjs
scripts/auth-http-test.mjs
scripts/auth-target.mjs
scripts/auth-test.mjs
site/src/content/docs/reference/status.md
src/backend/cloudflare/authentication.test.ts
src/backend/cloudflare/authentication.ts
src/server/adapters/cloudflare/authentication.test.ts
src/server/adapters/cloudflare/authentication.ts
src/server/adapters/cloudflare/hostedHttp.test.ts
src/server/adapters/cloudflare/identity.ts
src/server/adapters/cloudflare/password.test.ts
src/server/adapters/cloudflare/password.ts
src/server/adapters/cloudflare/worker.ts
src/server/adapters/d1/migrations/0003_authentication.sql
src/server/adapters/d1/migrations/0004_identity.sql
src/server/adapters/d1/testFixture.ts
src/server/authentication.ts
src/server/authenticationHttp.test.ts
src/server/authenticationHttp.ts
tests/auth/fixtureWorker.ts
tests/auth/security.spec.ts
tests/auth/wrangler.jsonc
tests/providers/scenarios/authentication-lifecycle.ts
tests/providers/scenarios/authentication.ts
tsconfig.json
vite.config.ts
vitest.auth-http.config.ts
vitest.auth.config.ts
wrangler.auth-ci.jsonc
```

## T0017 D1 transaction proof, 2026-10-17

T0017 starts from merged `main` at `53f9dfd` on `feature/t0017-d1-transaction-proof`.
The working tree was clean. Open PRs #20, #21, and #23 cover separate tickets.
Supabase remains active. This ticket adds an experimental store, not a complete Cloudflare connector.

The owner selected organizer-issued replacement temporary passwords for the later migration.
Mandatory changes preserve the contest-access gate. Account IDs, memberships, permissions, and history remain required.
Password-hash import is no longer required. Earlier T0016 reports below describe their original decisions.
Authentication and remaining connector operations follow this proof. Migration tooling follows connector verification.

### Scope and target

The provider-independent `ApplicationStore` implements `claim`, `message`, and a limited authorized issue view.
Each command commits its state, actor/request receipt, authenticated history, audience sequence, and notification records together.
False, missing, or stale assertions cause a database error and roll back the batch.
A separate internal issue version detects private changes without exposing them through public revisions.
Original message text remains in receipt comparison. Stored history trims the text.

Existing Wrangler OAuth access matched account `458ad6a930b0fb717796dfa19ca6a2b1` before provisioning.
The owner authorized isolated development and CI resources. Development uses temporary local D1 databases.
The new hosted CI database is `minsky-d1-proof-ci`, ID `06560c1c-8907-47d6-b2b6-f22e129ebbe4`, in APAC.
Both proof migrations are applied. Read replication is disabled.
No paid upgrade, real-data export, real-account reset, application deployment, or backend switch occurred.
The static frontend configurations have no D1 binding.

### Verification

The hosted suite passed all 42 cases on committed implementation revision `edb4bd05202ba0ee1443e032605bcabfb7d6b621`.
The run started at 2026-10-17 14:47:48 UTC and completed in 192.50 seconds.
It used the ordinary remote D1 binding with read replication disabled.
Each fixture verified deletion of its own workflow and access records. All final-run recovery journals were removed.
A separate fixture remained readable while another fixture's cleanup ran.

The cases prove these bounded behaviors on hosted D1:

- Failed permission, state, false, and NULL assertions roll back receipts and every command write.
- Competing claims have one winner. Equal duplicate requests replay one history entry. Different command content rejects request-ID reuse.
- A lost committed response produces an unknown outcome. Retrying the original request returns the saved result without another write.
- Membership revocation, account restrictions, login expiry or revocation, team changes, and event archival prevent unauthorized commits and receipt replay.
- A primary snapshot racing revocation returns one permitted view or no view. The next read after revocation denies access.
- Private messages change only internal versions and staff notifications. Contestant history, public revisions, and team sequences remain unchanged.
- Private conflicts trigger bounded internal reevaluation. Exhausted retries expose an unknown outcome, without a private conflict signal.

Ordinary [PR CI](https://github.com/GiftedNovaHD/minsky/actions/runs/39042256683) passed `checks`, `secrets`, and `dependencies` on `edb4bd0`.
The protected cloud job and frontend deployment job were skipped. A skipped cloud job is not hosted evidence.
[PR #39](https://github.com/GiftedNovaHD/minsky/pull/39) contains the implementation for owner review.
The [proof guide](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/d1-transaction-proof.md) contains exact commands, target checks, and recovery steps.
This local CLI run against hosted D1 is separate from protected GitHub Actions verification.

### Run report

1. Summary of changes. Added the bounded D1 command foundation, SQLite migrations, independent rules, isolated tests, recovery journals, and owner decisions.
2. Files changed. Created `src/server/applicationStore.ts`, `src/server/issueRules.ts`, `src/server/adapters/d1/connection.ts`, `src/server/adapters/d1/store.ts`, `src/server/adapters/d1/store.test.ts`, `src/server/adapters/d1/testFixture.ts`, both migrations under `src/server/adapters/d1/migrations/`, `scripts/d1-proof.mjs`, `vitest.d1.config.ts`, `wrangler.d1-proof.jsonc`, and `docs/d1-transaction-proof.md`. Updated `AGENTS.md`, `PLAN.md`, `README.md`, `package.json`, `tsconfig.json`, `eslint.config.js`, `docs/backend-contracts.md`, `docs/provider-test-contracts.md`, `docs/cloudflare-backend-design.md`, `docs/cloudflare-implementation-plan.md`, `docs/product-direction.md`, `docs/tickets.md`, `docs/current-state.md`, and `site/src/content/docs/reference/status.md`.
3. Commands run. Git inspection, fetch, branch creation, diff checks, commits, trailer checks, and pushes. GitHub PR creation, edits, and CI queries. File inspection with `cat`, `sed`, and `rg`. Wrangler `whoami`, `d1 list`, `d1 create`, `d1 info`, `d1 migrations apply`, and `d1 migrations list`. Ran `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:d1`, `npm run check:functions`, `npm run test:functions`, `npm run test:e2e`, `npm run test:providers:list`, `npm ci --prefix site`, `npm run docs:build`, `npm run docs:test`, the STE checker, and `git diff --check`. Ran hosted proof commands with explicit target IDs. A wrong-target runner check rejected access before fixture creation.
4. Build and test results. Type checking, lint, application build, function checks, 157 local tests, 12 function tests, 34 browser tests, and three docs browser tests pass. The final focused local and hosted suites each pass all 42 D1 cases. Docs build checks 14 pages and 566 local links/assets. The first D1 run lacked sandbox socket permission. The first executable run passed 35 of 36 cases, with a claim-text expectation mismatch that is corrected. Initial lint found missing Node globals in the new script, now imported. The first docs build lacked installed site dependencies, then passed after installation. Known build warnings remain the app chunk size and duplicate docs 404 route. Hosted D1 and ordinary GitHub CI pass on implementation revision `edb4bd0`. Initial Git writes, GitHub access, and local socket tests required sandbox escalation. An exploratory `/tmp` scan hit protected system directories and was replaced with a scoped path scan.
5. Manual verification. Checked the current repository, base revision, open PRs, account and database targets, provider boundaries, authorization dependencies, and fixture deletion scope. Two bounded subagents added adversarial tests and reviewed correctness independently. Manual product UI checks were not repeated because the product UI did not change. Documented manual fixture-recovery commands were not executed.
6. Risks. Authentication, HTTP handlers, remaining operations, R2, notification delivery, complete connector tests, installation, migration, and contest capacity remain unverified. This proof does not authorize the later backend switch. Failed or interrupted fixture cleanup retains a credential-free recovery journal under `/tmp/minsky-d1-proof-*`.
7. Follow-up tickets. Complete T0017 review and owner merge. Authentication and remaining connector operations are next candidates. Full migration tooling follows connector verification. AWS adapters and Terraform remain deferred.
8. Docs that need updating. None for this proof. Later authentication and connector work must update the existing design and implementation plan with its own evidence.

## PR #36 merge-conflict repair, 2026-10-17

The user merged T0015 in [PR #37](https://github.com/GiftedNovaHD/minsky/pull/37) at `738ef4a` on 2026-10-17 at 13:44:12 UTC.
PR #36 now includes that `main` revision. Its remaining changes are documentation only.
The records below retain the original verification results. T0015's hosted results are not a new cloud run for this repair.

1. Summary of changes. Merged `main` into the T0016 branch. Retained the shared provider tests, Supabase fixes, and Cloudflare design. Updated current planning and ticket status after PR #37 merged.
2. Files changed. Resolved `AGENTS.md`, `PLAN.md`, `README.md`, `docs/current-state.md`, and `docs/tickets.md`. Updated `docs/cloudflare-implementation-plan.md` to use the merged test suite and its coverage limits. Other merged files match `main`.
3. Commands run. Git status, log, branch, remote, fetch, switch, merge, diff, commit, trailer check, and push. GitHub PR and check queries. Read documents with `cat`, `sed`, and `rg`. Ran Python documentation checks, the STE structural checker, and `git diff --check`. Initial GitHub access and branch switching required sandbox escalation.
4. Build and test results. Documentation paths, anchors, heading structure, conflict-marker checks, and whitespace checks pass. Application builds, browser tests, and cloud tests were not run for this documentation-only repair.
5. Manual verification. Compared the resolved records with PR #37's merge and verification evidence. Confirmed that application code, tests, workflows, and dependency files match `main` exactly.
6. Risks. None added by this repair. The proposed Cloudflare implementation and migration remain unverified, as recorded in T0016.
7. Follow-up tickets. At the time of this report, T0016 still awaited review in PR #36. The user merged PR #36 at `b68ef72` on 2026-10-17 at 13:50:36 UTC. T0015 is merged.
8. Docs that need updating. None for this repair. Record future identity decisions and implementation evidence in T0016's existing plan.

## T0016 Cloudflare backend design, 2026-10-17

The user authorized this design in parallel with shared provider tests while PR #32 was under review.
`feature/t0016-cloudflare-backend-design` started from that PR at `d158906`.
The user then merged PR #32 at `ef6a029` on 2026-10-17 at 12:51:42 UTC.
This branch now includes that merge commit.
The user merged T0016 in [PR #36](https://github.com/GiftedNovaHD/minsky/pull/36) at `b68ef72` on 2026-10-17 at 13:50:36 UTC. The design review is complete.
The [design](cloudflare-backend-design.md) separates existing contracts from proposed server components.
The [implementation plan](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/cloudflare-implementation-plan.md) defines bounded phases and acceptance evidence.
Supabase remains active. No Cloudflare backend, authentication replacement, or data migration is implemented here.

1. Summary of changes. Prepared the Cloudflare architecture and implementation acceptance plan. Recorded the parallel branch exception and AWS portability motivation.
2. Files changed. `AGENTS.md`, `PLAN.md`, `README.md`, `docs/cloudflare-backend-design.md`, `docs/cloudflare-implementation-plan.md`, `docs/current-state.md`, `docs/product-direction.md`, and `docs/tickets.md`.
3. Commands run. Git status, branch and worktree inspection, source reads with `sed`, `cat`, and `rg`, Python documentation checks, the STE writing checker, and `git diff --check`. The initial `python` command was unavailable. The checks ran with `python3`. Consulted current official Cloudflare and Supabase documentation.
4. Build and test results. Documentation paths, heading structure, and whitespace pass. The structural writing check passes with synonym warnings disabled after review. Its initial pass flagged terminology such as confirmed rejection and validated response. Those terms retain distinct meanings. Application builds and tests were not run for this prose-only change. Cloudflare behavior remains unverified.
5. Manual verification. Compared the design with `Backend`, workflow transactions, private signals, password restrictions, and image lifecycle code. Checked primary provider references near factual claims.
6. Risks. The D1 assertion pattern, replacement identity implementation, hash compatibility, hosted limits, notification latency, and post-write rollback require implementation evidence. None is presented as verified.
7. Follow-up tickets. Review T0015 and T0016. T0014 merged. The implementation plan defines later phases without opening speculative development tickets.
8. Docs that need updating. Record approved identity settings and measured implementation results when those decisions and tests are complete.

## T0015 shared provider tests, 2026-10-17

[PR #37](https://github.com/GiftedNovaHD/minsky/pull/37) implements and verifies the shared provider suite.
The [protected run](https://github.com/GiftedNovaHD/minsky/actions/runs/39036173268) passed on code revision `672ec6d` with `existing_backend=true`.
All 14 existing hosted UI tests passed in 3.0 minutes. All eight shared provider scenarios passed in 2.0 minutes.
The ordinary checks, secret scan, and dependency audits passed too.
Fixture cleanup completed without retained recovery files. The run produced no recovery artifact.
This documentation update changes no application, workflow, or test code.

The user authorized this work in parallel with T0016 Cloudflare design while PR #32 was under review.
PR #32 then merged at `ef6a029`. Both follow-up branches include that revision.
T0015 implements [shared test contracts](provider-test-contracts.md) and a [run and recovery guide](run-provider-tests.md).
Supabase is the first hosted fixture implementation. Cloudflare and AWS implementations remain future work.

The scenarios call the real browser adapter through a typed bridge.
Each connected account has a separate browser context, including its cookies and storage.
Six credential-free browser tests check the bridge itself, including HttpOnly cookie isolation and deliberate callback failures.
Those synthetic tests do not count as hosted provider verification.

The first hosted shared run passed six cases and failed two.
Image downloads remained available after membership removal, and the live-update case did not receive all required notifications.
Fixture cleanup completed. Read-only checks found zero remaining records, accounts, receipts, or image objects for the captured first fixture identifiers.
The strict assertions remain in place. The branch corrects the discovered defects.

The image diagnostic confirmed that `snapshot.membership` was null after removal.
The original download and a browser-only `no-store` request still returned HTTP 200 with `CF-Cache-Status: HIT`.
A fresh Supabase `cacheNonce` combined with `cache: no-store` returned HTTP 400 with `DYNAMIC` after revocation.
The targeted hosted case then passed, including access after membership restoration and complete fixture cleanup.
The adapter now uses both controls. A focused SDK request test checks them.
This correction affects new download calls. It cannot retract image bytes already received.

The live diagnostic found a subscription-readiness race.
All three clients reported connected. Two received the public change, while the third missed it.
The third account remained valid and its snapshot contained the issue.
Its database subscription became ready only after the other clients received that change.
The adapter now sets `postgres_changes_options.wait` to `true`.
It delays its ready signal until the database subscription is active.
The focused adapter checks pass. One local attempt hit the provider Auth rate limit during fixture setup and cleaned up without running the scenario.
The next targeted hosted run passed with unchanged assertions in 25.9 seconds, including setup and cleanup.
No rate limit or provider setting changed.

The [first protected run](https://github.com/GiftedNovaHD/minsky/actions/runs/39035271460) passed 13 of 14 existing hosted UI tests.
The layout test remained at `Connecting` during its five-second assertion. The shared suite did not run after that failure.
Further inspection found that the SDK reuses a channel topic while asynchronous removal is pending.
A regression test reproduced the collision for independent subscriptions on one `Backend`.
The adapter now assigns each subscription a unique topic. The regression test passes.
This also protects rapid unsubscribe and resubscribe, including React StrictMode cleanup.
The shared live scenario now checks multiple subscriptions on one `Backend` and immediate cancellation followed by replacement.

A targeted UI rerun still failed its original five-second assertion after channel isolation.
Temporary metadata-only diagnostics found two invalid-input errors for subscriptions with an empty session ID.
The valid subscription became ready after 9.627 seconds. The UI showed `Live` by 10.041 seconds.
The dashboard now waits for session selection before it subscribes. Initial reads and polling remain active.
A browser regression fails before that guard and passes after it.
The diagnostic code was removed. The original hosted assertion remains unchanged.
The targeted hosted layout case then passed in 24.2 seconds with complete fixture cleanup.

The separate Cloudflare design is in [PR #36](https://github.com/GiftedNovaHD/minsky/pull/36).
Its ordinary GitHub checks, secret scan, and dependency audits pass.
That design does not implement a Cloudflare connector or migrate existing data.

1. Summary of changes. Added provider-neutral behavior scenarios, isolated browser clients, Supabase fixtures, exact-ID recovery, and protected CI execution. Recorded the parallel branch exception and PR #32 merge.
2. Files changed. Added `tests/providers/`, `tests/provider-bridge.spec.ts`, `playwright.providers.config.ts`, `scripts/provider-test.mjs`, `scripts/provider-test-options.mjs`, `scripts/provider-test-options.test.mjs`, `scripts/provider-fixture.test.mjs`, `docs/provider-test-contracts.md`, and `docs/run-provider-tests.md`. Updated `.github/workflows/checks.yml`, `package.json`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.js`, `tests/landing.spec.ts`, `tests/workspace-refresh.spec.ts`, `src/connected/ConnectedApp.tsx`, `src/backend/supabase/backend.ts`, `src/backend/supabase/backend.test.ts`, `src/backend/supabase/images.ts`, `src/backend/supabase/images.test.ts`, `README.md`, `AGENTS.md`, `PLAN.md`, `docs/backend-contracts.md`, `docs/cloud-onboarding.md`, `docs/tickets.md`, and this record.
3. Commands run. Git and GitHub inspection, fetch, isolated worktree creation, and fast-forward to merged `main`. Locked npm installs, type checking, lint, build, unit tests, Deno checks, browser tests, docs build and browser checks, scenario discovery, import-boundary checks, documentation link checks, and whitespace checks. Added the exact T0015 branch to the existing `cloud-test` allowlist. Ran the shared suite against Minsky CI and read-only fixture cleanup queries. No development migration or deployment ran.
4. Build and test results. Type checking, lint, app build, docs build, function checks, 115 unit and database tests, 12 function tests, six browser bridge tests, and three docs browser tests pass. The initial full isolated browser run passed 32 cases and failed a pre-existing keyboard test that pressed Tab before sign-in rendering completed. The corrected test waits for the sign-in heading. All 33 ordinary browser cases then passed on an isolated server. The session-selection regression adds one case, and all 34 now pass. The final protected run passed all 14 hosted UI tests and all eight shared scenarios after the earlier failures recorded above.
5. Manual verification. Reviewed provider imports, typed errors, cookie isolation, image byte transfer, callback cleanup, and exact fixture ownership. Verified the CI target is `ghtztmovdkhuketcbjmq` and the deployment switch remains `false`. No shared development account journey ran.
6. Risks. The existing CI backend includes unmerged announcement migration `202610110002`, so these runs use its existing schema and functions. The suite does not verify fresh installation, migration correctness, capacity, or an unimplemented provider. At the time of this report, PRs #36 and #37 both updated planning documents. PR #36 later reconciled those documents and merged at `b68ef72`.
7. Follow-up tickets. T0015 merged in PR #37, and T0016 design merged in PR #36. Complete the identity, transaction, notification, connector, and migration acceptance work in the implementation plan before cutover. AWS implementation and Terraform remain deferred.
8. Docs that need updating. At the time of this report, reconcile the shared planning documents after the first parallel PR merges. PR #36 later completed that reconciliation.

## T0014 existing backend verification, 2026-10-17

The [completed hosted run](https://github.com/GiftedNovaHD/minsky/actions/runs/39027288113) passed on `a3b3c70` with `existing_backend=true`.
All 14 hosted cases passed in 2.8 minutes, and global teardown completed without a cleanup error or retained recovery file.
The ordinary CI jobs passed too. PR #32 is ready for user review.
The following documentation update changes no application, workflow, or test code.

The run recorded all seven repository migration versions and the additional announcement version `202610110002`.
The active functions were `admin` version 6, `attachments` version 2, and `announcement-images` version 3.
This verifies the shared interfaces and Supabase adapter against the prepared CI backend.
It does not verify a fresh installation, a Cloudflare backend, or the published Cloudflare frontend.
`CLOUDFLARE_DEPLOY_ENABLED` remains `false`.

The owner replaced `SUPABASE_ACCESS_TOKEN` in `cloud-test`.
The [retry on `1a5349b`](https://github.com/GiftedNovaHD/minsky/actions/runs/39026364030) passed the ordinary checks, connected to Minsky CI, and applied Auth configuration.
Database preparation then stopped because remote migration `202610110002` is absent from PR #32.
That version belongs to `202610110002_announcements.sql` in open PR #20.
The retry deployed no functions and created no fixtures.

PR #32 changes no files under `supabase/` compared with its merge base on `main`.
The new `existing_backend` workflow input permits a regression check against the already deployed CI backend.
It records migration and function versions, then skips backend preparation.
The default remains backend preparation with the migration-history check.
Neither mode resets the database or repairs its migration history.

1. Summary of changes. Added an explicit existing-backend mode for the hosted connector check after tracing the migration mismatch to PR #20. Added a prerequisite check before fixture creation. Prepared the missing merged CI backend and recovered the failed run's temporary records.
2. Files changed. `.github/workflows/checks.yml`, `scripts/check-cloud-backend.mjs`, `scripts/check-cloud-backend.test.mjs`, `docs/cloud-onboarding.md`, `docs/tickets.md`, and `docs/current-state.md`.
3. Commands run. Git status, fetch, worktree creation, source and migration inspection, commit, trailer verification, and push. GitHub metadata queries, workflow dispatch, run monitoring, failed-log inspection, and PR updates. YAML and shell checks, documentation path checks, and `git diff --check`. Supabase project list, isolated link, read-only database queries, migration fetch into a temporary directory, migration dry run and push, function deployment, and test-origin configuration. `npm ci --offline --no-audit --no-fund`, the prerequisite unit suite, lint, the live prerequisite check, fixture recovery through the existing cleanup function, and zero-count queries.
4. Build and test results. Final GitHub CI passed type checking, lint, both builds, function checks, 99 unit and database tests, 12 function tests, 27 app browser tests, three docs browser tests, and 14 hosted cases. The docs build checked 14 pages and 566 local links and assets. Earlier ordinary CI passed on `1a5349b` and `81eddfb`. The first existing-backend run passed five hosted tests and failed nine because CI lacked the image schema and function. Teardown stopped at the missing attachments table. Recovery completed after CI preparation. All ten prerequisite tests and the live prerequisite check pass. The sandbox blocked esbuild's install check. Dependency installation passed outside the sandbox. Initial checks caught an incorrect parameterized fixture and missing JavaScript global declarations. Both were corrected.
5. Manual verification. Confirmed target `ghtztmovdkhuketcbjmq`, the CI environment branch restrictions, the replacement secret timestamp, and `CLOUDFLARE_DEPLOY_ENABLED=false`. Compared PR #32's Supabase files with `main`. Confirmed zero remaining events, sessions, teams, people, Auth accounts, and command receipts for the recovered fixture identifiers.
6. Risks. A regression run against the existing backend does not verify a fresh backend installation. Minsky CI includes an unmerged announcement migration. Full backend preparation still requires reconciliation of that difference. The prerequisite check verifies version records and function availability, not source equivalence. The existing Cloudflare frontend still needs a configured build.
7. Follow-up tickets. The user reviews and merges T0014 in PR #32. Resolve the CI migration history with the PR #20 work before a later backend installation check. Shared contract checks, Cloudflare implementation, and migration rehearsal remain later work.
8. Docs that need updating. None for this verification.

The [first existing-backend run](https://github.com/GiftedNovaHD/minsky/actions/runs/39026689165) tested `81eddfb`.
Its version log showed that CI lacked `202610110001_attachments.sql` and `202610140001_attachment_fixes.sql`.
CI had `admin` version 4 and `announcement-images` version 2, but no `attachments` function.
The tests started without those prerequisites, and fixture teardown could not query the missing table.
The new prerequisite check prevents that sequence.

CI preparation used a temporary directory with the fetched remote announcement migration and the merged repository migrations.
The dry run selected only the two missing image migrations.
Both applied without seeds or a reset. The `admin` and `attachments` functions then deployed from the reviewed source.
The test origin remains `http://127.0.0.1:4174`.
The announcements migration, function, and data remain intact.

Recovery identified event `7c800db8-716b-40e6-bbd5-aff5c381d10a` through its unique test tag and the run's account-creation window.
Exact generated account names and session memberships identified its nine temporary accounts, including the legacy-account test.
The existing fixture cleanup deleted that event, its two sessions, and those accounts.
Read-only queries confirmed zero remaining records for the recovered identifiers, including command receipts.
No development project records were involved.

## T0014 update after the documentation merge, 2026-10-17

The user merged PR #29 at `aaa6bbc` on 2026-10-17 at 10:36:06 UTC.
PR #32 now includes that revision, including the earlier reply retry and image preview fixes.
The shared interfaces and Supabase adapter remain the active work.
Hosted Supabase verification precedes the Cloudflare adapter and any data migration.

1. Summary of changes. Merged current `main` into the connector branch and retained both sets of project records. Recorded the confirmed migration order and PR #29 merge. Restricted the existing `cloud-test` environment to `main` and `feature/t0014-backend-adapters`.
2. Files changed. Resolved `AGENTS.md`, `PLAN.md`, `docs/cloud-onboarding.md`, `docs/current-state.md`, and `docs/tickets.md`. The merge also brings the already-reviewed documentation site, deployment workflow, reply retry cleanup, image preview guards, and their tests into this branch.
3. Commands run. Git fetch, worktree creation, merge, diff, status, commit, trailer verification, and push. GitHub PR, variable, secret-name, environment, and branch-policy queries. GitHub environment branch-policy updates, PR description update, workflow dispatch, run inspection, and failed-log inspection. `npm ci --offline --no-audit --no-fund` for the root and docs packages. Type checking, lint, both builds, unit and database tests, both Deno checks, app browser tests, and docs browser tests. A second app build uses the existing public GitHub variables. HTTP asset inspection and a local Chromium sign-in check verify the missing-settings diagnosis.
4. Build and test results. Type checking, lint, both builds, and both Deno checks pass. `npm test` passes 89 tests. The function suite passes 12 tests. The app browser suite passes 27 tests, and the docs browser suite passes three tests. The docs build checks 14 HTML pages and 566 local links and assets. Its existing duplicate `/404` warning remains. The configured app build retains the existing chunk-size warning.
5. Manual verification. Reviewed the merged application and provider boundaries. The configured local build displays the sign-in form, omits the setup error, and reports no browser page errors. No account login or shared development record write was part of this check. The hosted test target is `Minsky CI`, reference `ghtztmovdkhuketcbjmq`.
6. Risks. Hosted Supabase verification is blocked by the access-token format error recorded below. The old Cloudflare preview and the stable app both serve bundles without the development Supabase URL or publishable key. They cannot connect until a configured frontend build replaces them. The deployment switch remains `false`. The GitHub environment has branch restrictions but no required-reviewer rule. The account-plan API did not expose a plan, so reviewer availability remains unverified.
7. Follow-up tickets. Complete T0014 hosted verification and user review. Test the same contracts against Cloudflare before a migration rehearsal and data cutover. Other provider adapters and Terraform remain deferred.
8. Docs that need updating. Add the hosted run result after it finishes. Record frontend deployment separately when publication is activated.

The user supplied the old preview URL `https://ccdd90fb-minsky-dev.icaic-minsky.workers.dev`.
That preview serves `index-B4jx6y34.js`. The stable app serves `index-CSDiNndQ.js`.
Both bundles contain the setup message and omit the development Supabase URL and publishable key prefix.
Setting GitHub variables does not change already published assets.
No application or documentation deployment occurred in this update.

The [hosted workflow](https://github.com/GiftedNovaHD/minsky/actions/runs/39025809230) ran on `6f46e54`.
Its ordinary checks, secret scan, and dependency audits passed.
The cloud job confirmed the CI project reference, then failed at `supabase link`.
The CLI reported an invalid `SUPABASE_ACCESS_TOKEN` format and required an `sbp_` personal access token.
Configuration changes, migrations, function deployment, and fixture creation did not run.
The owner must replace that environment secret before the hosted check can proceed.
The separate [push run](https://github.com/GiftedNovaHD/minsky/actions/runs/39025807758) passed on the same revision.
PR #32 remains in draft until hosted verification passes.

## T0014 backend adapters 2026-10-17

The branch is `feature/t0014-backend-adapters`, from updated `main` at `de92d54`.
The user authorized this first migration step while the other pull requests remain open.

1. Summary of changes. The UI now uses `Backend` for authentication, session reads, workflows, administration, images, and live updates. Supabase implements those contracts through the existing services. Server permissions, database functions, and provider resources remain unchanged. The reference and product direction distinguish this extraction from the later D1 migration.
2. Files changed. Added `src/backend/contracts.ts`, `errors.ts`, `index.ts`, `supabase/backend.ts`, `supabase/images.ts`, `supabase/backend.test.ts`, and `supabase/images.test.ts`. Moved `src/connected/client.test.ts` to `src/backend/supabase/login.test.ts` and removed `src/connected/client.ts`. Updated `src/connected/ConnectedApp.tsx`, `IssueImages.tsx`, `imageFile.ts`, `imagePreview.tsx`, and `imageUpload.ts`. Updated `tests/workspace-refresh.spec.ts` and `eslint.config.js`. Added `docs/backend-contracts.md`. Updated `AGENTS.md`, `PLAN.md`, `README.md`, `docs/tickets.md`, `docs/product-direction.md`, `docs/cloud-onboarding.md`, and this record.
3. Commands run. Git status, diff, fetch, and worktree creation. Repository inspection with `rg`, `sed`, and `cat`. `gh pr list` and `gh api repos/GiftedNovaHD/minsky/environments`. `npm ci --offline --no-audit --no-fund`. `npx deno fmt --single-quote src/backend`. `npm run typecheck`, `npm run lint`, `npm run build`, `npm test -- src/backend/supabase`, `npm test`, `npm run check:functions`, `npm run test:functions`, and `npm run test:e2e`. `git diff --check` and a Python check of documentation paths and anchors. Commit, trailer verification, push, and PR preparation complete the repository workflow.
4. Build and test results. Local type checking, lint, and build pass. The unit and embedded database suite passes 70 tests. The function suite passes 12 tests. Both functions pass Deno type checking. The browser suite passes 19 Chromium tests. The sandbox blocked the dependency install check and browser server. It also affected the existing child-process stderr test. Those commands pass outside the sandbox. Initial checks caught a test URL mismatch, test type errors, lint errors, and a moved helper still imported by the attachment function. The corrections retain that helper at its original path.
5. Manual verification. Reviewed the extraction and provider imports against the existing calls. Automated browser checks cover narrow layouts, keyboard controls, image retries, membership refresh, and workflow retry IDs. No new manual hosted account journey ran. The protected hosted check remains pending.
6. Risks. GitHub reports zero configured environments, so `cloud-test` cannot run. No hosted verification result is claimed for this revision. PRs #30 and #31 also edit the reply and image components. Their eventual merge may require conflict resolution and another verification run. The interfaces do not prove a Cloudflare implementation, password migration, or production capacity. Existing UI files retain double-quoted strings for consistency. New backend modules use single-quoted strings under the Google TypeScript Style Guide.
7. Follow-up tickets. Complete T0014 protected cloud verification and user review. The next candidate is a shared hosted contract suite before the Cloudflare implementation. Authentication migration, D1, R2, Durable Objects, and eventual data cutover remain later work. Other providers and Terraform remain deferred.
8. Docs that need updating. None for the implemented extraction. Future hosted verification must add its result to this record.

The [backend contracts](backend-contracts.md) describe the interfaces and retry rules.
The [cloud onboarding guide](cloud-onboarding.md#verification-and-protected-cloud-ci) lists the `cloud-test` environment configuration.

[Draft PR #32](https://github.com/GiftedNovaHD/minsky/pull/32) contains implementation commit `408dafa`.
[GitHub Checks](https://github.com/GiftedNovaHD/minsky/actions/runs/39022916356) and the [secret and dependency checks](https://github.com/GiftedNovaHD/minsky/actions/runs/39022916361) passed for that commit.
The protected cloud job was skipped.
An in-memory ESLint check also confirmed that UI imports of the SDK and provider implementation fail lint.

The independent [Cloudflare build for `minsky-dev`](https://dash.cloudflare.com/458ad6a930b0fb717796dfa19ca6a2b1/workers/services/view/minsky-dev/production/builds/41169b14-a851-4c69-8c39-d696b3da6a9f) failed.
Its GitHub check exposes no failure details.
A read-only Builds API request returned HTTP 401 with `Authentication error`, so the cause remains unverified.
`npx --no-install wrangler --help` succeeded but could not write its diagnostic log in the sandbox.
The failed provider check and missing protected environment remain recorded setup gaps.
The PR stays in draft.

## T0011 update from main (2026-10-17)

PR #29 now includes `main` at `f8a8cac`, after the user merged PRs #30 and #31.
The merge preserves the reply retry and image preview fixes and their browser tests.
Conflicts affected `docs/current-state.md` and `docs/tickets.md`.
Both sets of records remain. The ticket records and public feature-status guide now show both completed merges.
Review of the combined source found no new blocking issue.

Local type checking, lint, app and docs builds, and both Deno checks passed.
All 68 unit and database tests, 12 function tests, 25 app browser tests, and three docs browser tests passed.
The app build also passed with fictional public backend settings.
It retained the existing chunk-size warning. The docs build retained its duplicate `/404` route warning.
The docs build checked 14 HTML pages and 566 local links and assets. Its 404 browser check passed.
The browser checks used fictional responses or local static documentation.
Protected cloud tests and verification after deployment were not run.
The [push run](https://github.com/GiftedNovaHD/minsky/actions/runs/39024745166) and [PR run](https://github.com/GiftedNovaHD/minsky/actions/runs/39024747650) passed on merge commit `d37e0ab`.
Both runs skipped protected cloud tests and deployment.
Current GitHub checks are available on [PR #29](https://github.com/GiftedNovaHD/minsky/pull/29).

The user also requested the deployment variables.
GitHub now stores the development `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the existing local configuration.
Both values passed the deployment validator and a read-back check.
`CLOUDFLARE_DEPLOY_ENABLED` is `false` while token setup and hosted checks remain pending.

A read-only browser check of `minsky-dev.icaic-minsky.workers.dev` confirmed the missing-Supabase-settings screen and no sign-in form.
This is the development app. Setting the GitHub variables does not change its published build.
Cloudflare reports a newer Worker version from 2026-10-17, but its source revision remains unverified.
The docs Worker's preview routing is still disabled. The local login could not read Cloudflare build triggers.
No manual application or docs deployment was performed during this update.

Pushing the reviewed merge exposed a separate Cloudflare Git build for `minsky-dev`.
It published a branch preview before the GitHub checks finished, despite the GitHub deployment switch being off.
The user then confirmed that they disabled those Cloudflare Git builds.
This confirmation came from the user; the local login could not verify the build setting through the API.
The GitHub deployment switch remains off until the token and other activation checks are complete.

## Deployment after CI passes, 2026-10-17

The user requested automatic publication only after CI passes, then requested the completed workflow and setup instructions before adding credentials.
T0011 now uses GitHub Actions for both static Workers.
This replaces the earlier Cloudflare Git build proposal below.
The user still reviews and merges PR #29.

`Checks` now runs for all repository branch pushes and pull requests.
The existing `secrets` and `dependencies` jobs moved into that workflow, with their names and weekly schedule preserved.
`deploy` depends on `checks`, `secrets`, and `dependencies`.
Trusted branch pushes publish previews. Pushes to `main` publish both stable sites.
Pull requests, forks, Dependabot, scheduled runs, and manual dispatch do not publish frontends.
The manually dispatched `cloud` job retains the separate `cloud-test` environment and now waits for all three prerequisite jobs.

The deployment script checks the account, development backend, public key format, Worker names, and asset directories.
It creates stable preview names with branch hashes and checks the current remote commit before each upload.
A deleted branch or outdated run skips remaining uploads.
Each upload includes `minsky-revision.json`. The script checks that the published file contains the expected source revision.
The run summary records the preview name, published URLs, and revision-check results.
A retry cannot deliberately publish an outdated branch commit.
App and docs uploads remain separate operations, so a failure can leave only one site updated.

`wrangler.docs.jsonc` now enables `preview_urls`.
The earlier guide incorrectly treated that setting as relevant only to older version URLs.
Current Cloudflare guidance and the installed Wrangler source also require it for Worker Preview routing on `workers.dev`.
The setup guide includes the one-time dashboard routing change before the first docs preview.
No remote Worker setting changed in this run.

The repository Actions API reported zero secrets and zero variables during inspection.
The user chose to complete those settings later through [the setup guide](cloudflare-builds.md).
Automatic uploads and hosted revision checks remain unverified. This run does not deploy either site.
Disable independent Cloudflare Git builds before activation so they cannot publish before GitHub checks finish.
Previews share development data and need approved function origins for account and image operations.

The first stable app update also needs a compatible backend.
The latest recorded hosted attachment verification predates `202610140001_attachment_fixes.sql` and its matching function correction.
Confirm that backend release before merging with frontend deployment enabled.
This CI change does not apply that migration or deploy Supabase functions.

Local verification used Node.js `22.22.1` and npm `11.12.0`.
Type checking, ESLint, both builds, both Deno checks, 68 unit and database tests, and 12 function tests passed.
The 68 tests include 19 deployment cases for event selection, branch names, settings, stale revisions, failed uploads, and hosted revision checks.
All 17 app browser tests and all three docs browser tests passed.
The docs build checked 14 HTML pages and 566 local links and assets.
Actionlint `1.7.12` accepted the workflow. Both Wrangler dry runs accepted the assets without uploading them.
The read-only GitHub revision lookup also passed for the real T0011 branch, including its slash-containing name.
GitHub run results appear on [PR #29](https://github.com/GiftedNovaHD/minsky/pull/29).

The first docs browser run found a page-title mismatch with its navigation label.
Restoring the matching title fixed the check. The final build and all docs browser checks passed.
Astro still reports its existing duplicate `/404` route warning. The generated missing page passes its browser check.
Protected Supabase cloud checks and new hosted deployment checks were not run.

## Branch preview and permission-guide follow-up (2026-10-17)

This earlier record describes the initial configuration. The CI workflow above replaces its Git build setup.

The user selected automatic branch previews and stable frontend deployment from `main`.
Both static Workers now have empty `previews` configurations for the installed Wrangler preview command.
[Cloudflare build setup](cloudflare-builds.md) gives the exact Git connection, branch, command, and build-variable settings.
The dashboard connection and first automatic builds remain unverified. No provider settings changed during this preparation.
The setup preserves separate app and docs hosting. Supabase migrations and functions remain explicit deployment steps.
App previews share the configured development backend and need approved origins for account and image operations.
The preview explanation records a proposed origin registry as separate backend work.

The public guides now state the current-owner resolution rule, different-specialist handoff rule, and resolved-conversation restriction.
The administrator guide explains account-wide reset permissions and the archived-membership restriction.
The [audit](documentation-release-plan.md#permission-documentation-fixes) maps these corrections and remaining proposed improvements.
These changes preserve application authorization behavior.

The user supplied `unslop` and `technical-writing` principles.
The [writing guide](writing-guide.md) records their application to repository writing.
Cloudflare setup steps, settings reference, and backend explanation now have separate pages.

`npm run docs:build` passed, including its local-link check.
All three `npm run docs:test` browser checks passed.
Both Wrangler configuration dry runs accepted the static assets and reported no bindings.
The first dry runs could not write their logs inside the filesystem sandbox.
Both dry runs passed outside the sandbox without log errors.
Repository Markdown paths, heading anchors, whitespace, and the new writing guides passed their checks.
No automatic preview or stable deployment was run. The live docs still use the earlier published source.

Temporary cleanup removed old review files, caches, test results, and completed PR notes.
The saved package edits were already present in `main`, and T0012 already had PR #30.
The active T0013 checkout and its temporary test files were left intact during this cleanup.

## Documentation release audit (2026-10-17)

The user required documentation suitable for an open-source release and requested a specific cleanup audit.
The [release plan](documentation-release-plan.md) records 20 findings, their source files, and completion criteria.
It covers outside contributors, versioned guidance, installation, operating procedures, permissions, usability, and hosting.
The initial site remains a working development baseline. Release readiness remains incomplete.

The audit inspected docs revision `3c18cbb` and `main` at `de92d54`.
GitHub reported a private repository, no selected license, and no published releases.
The docs PR remains open. Ordinary, dependency, and secret checks passed on `3c18cbb`.
The protected cloud job was skipped. It did not pass a cloud integration check.

The follow-up removes the obsolete demo-command comment from `.env.example`.
It also corrects maintenance command paths in `docs/code-quality.md` to `GiftedNovaHD/minsky`.
Those commands were not executed. Historical links remain intact.
Contributor rules and the planning record now require public-reader quality and evidence for supported installation paths.
No public-site content, application behavior, provider settings, or deployment changed in this follow-up.

Checks passed for 74 repository Markdown targets and anchors, unchanged environment declarations, and all three corrected maintenance paths.
The new release plan passed the STE structural check. Whitespace checks passed.
Application builds, browser tests, and cloud checks were not repeated for these repository-prose and comment changes.

## T0011 documentation site (2026-10-17)

The user requested a written documentation site and its deployment to Cloudflare Workers.
The branch `feature/t0011-documentation-site` starts from `main` at `de92d54`.
The user authorized the initial docs deployment before merge. The user still reviews and merges the source PR.

The site contains 13 guides and a 404 page, built from `site/src/content/docs/` with Astro Starlight.
It covers user workflows, accounts, image rules, T0007 installation steps, verification, troubleshooting, and docs maintenance.
T0007 remains an open PR, and its container and independent-backend limits are explicit in the guides.
Search uses a static Pagefind index. The site requires no application backend or credentials.

The Worker target is `minsky-docs`, account `458ad6a930b0fb717796dfa19ca6a2b1`, at `https://minsky-docs.icaic-minsky.workers.dev`.
`wrangler.docs.jsonc` uploads only `site/dist`.
Its dry run passed with 77 assets and no bindings.
The Cloudflare account check passed, and the deployment-list check confirmed the new Worker did not yet exist.
The site is deployed and verified at that address.
Review PR: [#29](https://github.com/GiftedNovaHD/minsky/pull/29).
Deployed source: `718402fbe19e2e34f942ce5be0660d7c447c8259`.
Worker version: `c591634a-100a-405a-99ed-465d2da72d82`.
`npm run docs:deploy` completed on 2026-10-17 at approximately 14:19 SGT.
All three browser checks passed against the public docs URL in 3.4 seconds.
All 56 published files matched the build by SHA-256.
The custom missing-page response returned HTTP 404 with the expected content, and the configured response headers were present.
No application, database, or function deployment is part of this change.
The app's new documentation links will appear when its frontend is separately deployed.

Local checks used Node.js `22.22.1` and npm `11.12.0`.
Type checking, ESLint, the app build, both function checks, all 49 unit/database tests, all 12 function tests, and all 17 app browser tests passed.
The docs build generated 14 HTML pages and checked 569 local links and assets.
All three docs browser tests passed, including search, keyboard access, direct page reload, 320px navigation, and the 404 page.
Desktop light and dark screenshots and the 320px phone screenshot were reviewed.
The local browser reported no page errors or horizontal overflow, and the Public Sans font loaded.
The final dependency audits reported zero vulnerabilities for both lockfiles.

The initial dependency audit found a CSS selector parsing advisory in the docs build dependencies.
The site pins `postcss-selector-parser` to `7.1.6` under `postcss-nested` until its upstream dependency range includes the fix.
The subsequent audit reported zero vulnerabilities.
This override affects build-time CSS processing and passed the docs build and browser checks.

The first sandboxed unit run hit the existing child-process stderr failure. All tests passed outside the sandbox without source changes.
Astro initially needed permission to create its local configuration directory.
Its automatic background preview mode caused the first browser run to stop early; `--ignore-lock` now keeps previews in the foreground.
The first search assertion used `searchbox`; the rendered control exposes `textbox`. The corrected check passed.
The link checker now handles Workers' clean URLs for flat HTML files, including `404.html`.
Astro reports a duplicate `/404` route warning for Starlight's custom error content; the generated error page and 404 response pass the browser checks.

The STE prose check passed structural rules with lexical synonym checks disabled.
Terms such as Auth confirmation, removal, and verification keep their distinct operational meanings.
Existing TSX double quotes and component conventions are retained as project style exceptions.
New Starlight content exports follow its required framework interface.

The repository adds docs build, browser, and dependency checks to ordinary CI.
GitHub's ordinary, dependency, and secret checks passed on `7007e63`.
The [ordinary job](https://github.com/GiftedNovaHD/minsky/actions/runs/39009536861) completed in 1 minute 54 seconds. Its protected cloud job was skipped.
The PR reports results for each subsequent revision.
Protected Supabase cloud checks are not required for this static site and were not run here.

The final editing-preview check found that Vite blocked the shared font outside `site/`.
The docs configuration now permits only the site directory and the existing `public/fonts` directory.
The editing page and font returned HTTP 200, with no browser page errors.
Lint and the docs build passed after this fix.
All 57 build files, including the local `_headers` configuration, remained byte-identical to the published build.
No second deployment was needed for this development-server setting.

### Current merge status

T0005 merged through PR #19, T0008 through PR #22, and T0010 through PR #24 on 2026-10-15.
The Supabase CLI update merged through PR #28 on 2026-10-17.
T0006, T0007, and T0009 remain separate open PRs.
The latest recorded main application deployment is still `d1c36fd` from 2026-10-11.
This docs change does not establish the running application revision.
The older sections below record their original runs.

## T0012 reply retry cleanup (2026-10-17)

The user selected the reply-retry finding from the review of `main` at `de92d54`.
The branch is `feature/t0012-reply-retry-cleanup`.
The user requested an independent PR for each of the two review findings.

The pending reply retains its success cleanup with its request ID and command.
After a successful retry, the reply text clears and the audience returns to its default.
**Send reply** stays disabled until new text is entered.
Repeated transport failures retain the draft and original request.
A rejected request leaves the draft available for correction.

Checks passed on Node.js `22.22.1` and npm `11.12.0`:

- `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- `npm test` passed all 49 local tests outside the sandbox.
- `npm run check:functions` passed, and `npm run test:functions` passed all 12 tests.
- `npm run test:e2e` passed all 20 Chromium tests outside the sandbox.

The new browser tests lose two responses for the same recorded reply.
They check public replies, internal notes, exact retry requests, one history entry, cleared controls, and a subsequent new reply.
Both retry tests failed against the original app because the reply text remained after success.
The first test attempt needed an accessible combobox selector for **Audience**.
A separate test checks that server rejection preserves the draft.
These tests use fictional Auth and database responses. They do not access hosted data.
The suite also retains the existing phone-width and keyboard checks.

The build retains the existing JavaScript chunk-size warning.
Hosted checks, real-device checks, and deployment were not run.
The app keeps its existing double quotes and JSX conventions for consistency with the surrounding code.
No database migration or function change is required.

## Supabase CLI upgrade (2026-10-17)

The user approved the existing Supabase CLI update from `2.119.0` to `2.121.0`.
The maintenance branch is `chore/supabase-cli-2.121.0`, from updated `main` at `bb45c06`.
`package.json` pins the new version, and `package-lock.json` records its platform packages.
`npm ci` installs the update successfully.
The Deno checks also synchronized workspace metadata with the accepted dependencies in `package.json`.
The resolved function dependencies did not change.
See the [upstream release](https://github.com/supabase/cli/releases/tag/v2.121.0).

Checks used Node.js `22.22.1` and npm `11.12.0`.

| Check | Result |
| --- | --- |
| `npm ci` | Passed |
| `npx --no-install supabase --version` | Reports `2.121.0` |
| `npm run typecheck`, `npm run lint`, and `npm run build` | Passed |
| `npm run check:functions` | Both functions passed |
| `npm run test:functions` | 12 passed |
| `npm test` | 49 passed outside the sandbox |
| `npm run test:e2e` | 17 Chromium tests passed |
| `npm audit --package-lock-only --audit-level=high` | Zero vulnerabilities |
| `npm run cloud:plan` | Read-only plan passed for `ovymmobupzowotvrywek` (development). No migrations or seeds were pending. |
| `npx --no-install supabase functions deploy --help` | The CLI still supports `--use-api` for bundling without Docker. |

Two sandboxed test attempts did not capture the child process's cleanup error message.
The focused test and full suite passed outside the sandbox without code changes.
The build retains the existing warning for a JavaScript chunk larger than 500 kB.
Full cloud and hosted workflow tests were not run for this maintenance change.
No application code, database migration, function, or frontend deployment changed.
The user reviews and merges the maintenance PR.

## Ticket status

T0012 merged into `main` in [PR #30](https://github.com/GiftedNovaHD/minsky/pull/30) on 2026-10-17.
It fixes reply cleanup after a successful retry.
See [T0012 verification](#t0012-reply-retry-cleanup-2026-10-17).

T0010 merged into `main` in [PR #24](https://github.com/GiftedNovaHD/minsky/pull/24) on 2026-10-15.
It fixes the three earlier P2 findings. Deployment remains a separate step.
See [T0010 verification](#t0010-p2-review-fixes-2026-10-15).

T0008 fuzzy team search merged into `main` in [PR #22](https://github.com/notbowen/minsky/pull/22) on 2026-10-15 (SGT).
It is not deployed.
It was developed separately from T0005, T0006, and T0007.
The T0005 branch now includes the accepted search through a merge from `main` at `d961f5b`.
See [T0008 fuzzy team search](#t0008-fuzzy-team-search-2026-10-11).

T0001 and T0002 merged in PR #1.
T0003's connected cloud app merged in [PR #2](https://github.com/notbowen/minsky/pull/2) on 2026-10-02.
T0004's UI makeover merged in [PR #9](https://github.com/notbowen/minsky/pull/9) on 2026-10-11 (SGT).
The documentation rewrite merged in [PR #13](https://github.com/notbowen/minsky/pull/13).
The TypeScript major-update rule merged in [PR #14](https://github.com/notbowen/minsky/pull/14).
The T0004 frontend remains deployed to development.
T0005 adds issue images and has an approved frontend preview using the shared development backend.
The main Worker frontend remains on the approved `main` revision.
See [T0005 issue images](#t0005-issue-images-2026-10-11).

T0013 merged into `main` in [PR #31](https://github.com/GiftedNovaHD/minsky/pull/31) on 2026-10-17.
It fixes delayed image preview responses.
See [T0013 verification](#t0013-image-preview-request-handling-2026-10-17).

These operational items stay deferred.
They are not part of T0005:

- Provider ownership and billing records.
- GitHub merge enforcement and vulnerability alerts.
- Remaining user and manual acceptance checks.

Older reports below describe their recorded revisions.
Use this status when an older report still says that T0005 is unimplemented or that PR #13 is open.

## T0013 image preview request handling (2026-10-17)

The branch is `feature/t0013-image-preview-race`, from `main` at `de92d54`.
The user requested separate PRs for this fix and T0012 reply retry cleanup.

Each preview has a request number. A completed download must match the current number and an open dialog.
Older downloads cannot replace the current image or its download link.
Older failures cannot report an error for a closed preview.
Current failures still report the error.
Closing a preview, replacing its image, or leaving the page releases its temporary browser URL.

Checks passed on Node.js `22.22.1` and npm `11.12.0`:

- `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- `npm test` passed all 49 local tests outside the sandbox.
- `npm run check:functions` passed, and `npm run test:functions` passed all 12 tests.
- `npm run test:e2e` passed all 22 Chromium tests outside the sandbox.

Four new tests failed against the original app. They confirm that late downloads and errors cannot affect a newer preview after **Close** or Escape.
The focused image suite now passes all 11 tests.
It also checks that current errors still appear, focus returns, and a closed preview releases its browser URL.
The development image harness can delay a response or return an error. The tests control its clock.
Existing phone-width, upload, removal, contestant, and archived-event checks still pass.

The build retains the existing JavaScript chunk-size warning.
Hosted checks, real-device checks, and deployment were not run.
The source keeps its existing double quotes and JSX conventions for consistency with the surrounding code.
No database migration or function change is required.

## T0005 merge-conflict repair (2026-10-15)

**Summary of changes:** merged `main` at `d961f5b` into the T0005 branch after the user merged team search in PR #22.
Resolved conflicts in the app imports and three documentation files.
Both team search and issue images remain present.
The team-search browser fixture now supplies the image limits and empty attachment and removal lists required by the combined snapshot type.
The ticket records now show that PR #22 is merged.

**Files changed:** `AGENTS.md`, `PLAN.md`, `README.md`, `docs/current-state.md`, `docs/manual-verification.md`, `docs/product-direction.md`, `docs/tickets.md`, `src/connected/ConnectedApp.tsx`, `src/connected/TeamSearch.tsx`, `src/connected/teamSearch.ts`, `src/connected/teamSearch.test.ts`, `src/styles.css`, and `tests/team-search.spec.ts`.
Most changes come directly from the accepted team-search revision.
The search component and matching rules are unchanged from `main`.

**Commands run:** `git fetch origin main feature/t0005-issue-attachments`, `git merge --no-commit --no-ff origin/main`, Git diff and conflict-marker checks, `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:functions`, `npm run test:functions`, `npm run build`, `npm run test:e2e -- --output=/tmp/minsky-pr19-merge-test-results --reporter=line`, and a temporary Playwright interaction script outside Git.
Initial type and build checks caught the incomplete team-search fixture; both passed after correction.
The first Deno and browser attempts hit sandbox network restrictions; both passed with network access enabled.
The temporary visual script needed its visibility-control locator corrected before it passed.

**Build/test results:** all local checks passed on Node.js 24.19.0.
There are 45 passing unit and embedded database tests, 12 passing attachment-function tests, and 15 passing Chromium browser tests.
Type checking, ESLint, both Deno function checks, and the production build passed.
The build retains the existing warning for a JavaScript chunk larger than 500 kB.
Protected cloud tests remain unrun because their credentials are unavailable in this environment.

**Manual verification steps:** used Playwright at `http://127.0.0.1:4187/` with isolated Auth and session responses at 1400×950 and 320×844.
Browser plugin not available; regular Playwright was used.
The flow was sign in, choose Aurora by keyboard, apply the Open status filter, and open the remaining issue.
The expected issue and image controls appeared with **Staff only** selected.
Page identity, meaningful content, absence of a framework overlay, console health, screenshots, and interaction results passed.
Neither viewport had horizontal page overflow or app errors.
Screenshots and the detailed QA result remain outside Git under `/tmp/minsky-pr19-merge-*`.
The mocked fixture has no Realtime server and displays **Connecting**.
It does not establish hosted Auth or Storage results.

**Risks:** protected cloud verification and the previously listed real-device and assistive-technology checks remain pending.
This repair does not deploy a function, migration, or frontend and does not merge PR #19.

**Follow-up tickets:** None. Finish cloud verification within the existing work when access is available.

**Docs that need updating:** None for this repair. Record the protected cloud result after that check runs.

## T0005 review fixes (2026-10-14)

The user requested fixes for the six findings in PR #19.
The work continues on `feature/t0005-issue-attachments` from reviewed revision `c68bb10`.
Current `main` was merged into the PR branch for the final checks.
This includes the accepted dependency updates and the existing narrow exception for the synthetic announcement fixture in Git history.
The first attachment migration stays unchanged.
The new migration is `supabase/migrations/202610140001_attachment_fixes.sql`.

- Upload completion checks the verified login session, password status, current staff membership, and active event.
- Removed staff cannot read or change unfinished files. Archived events reject unfinished-file writes.
- Storage accepts only the exact original and thumbnail paths for reads and writes.
- The visibility and file controls stay locked during upload and retry. **Cancel upload** removes the unfinished files before allowing another choice.
- Retries reuse the original request ID. A lost completion response can be checked again without attaching the same image twice.
- Storage deletion errors reach the UI. **Retry removal** remains available to the uploader after refresh until both files are deleted and the database confirms cleanup.
- Other members cannot see the uploader's cleanup records. Previously attached images remain when limits are lowered.
- Completion checks the current image-count limit while the issue is locked.
- The protected cloud workflow deploys both `admin` and `attachments` before running tests.
- Secret-free CI also runs the new attachment-handler failure tests.

Deployment requires the new migration, then the updated attachment function, then the frontend.
The old service-only completion function is removed by the migration.
Do not leave the older attachment function running after applying it.
The existing development preview remains on its recorded revision until a separate deployment.
This run does not deploy or merge the PR.

Local checks passed on Node.js 24.19.0:

| Check | Result |
| --- | --- |
| Type checking, ESLint, and production build | Passed |
| Focused and embedded PostgreSQL tests | 38 passed |
| Deno checks for both functions | Passed |
| Attachment HTTP-handler tests with fake clients | 12 passed |
| Public sign-in and image browser tests | 9 passed |
| Production preview-harness exclusion and Git whitespace | Passed |

The database tests run the repository migrations.
They cover membership removal, loss of staff access, password resets, old and incorrect login sessions, missing login timestamps after reset, archival during transfer, extra file paths, lower count limits, repeated completion, saved cleanup records, and retryable expired-file cleanup.
Password setup, password reset, provider recovery, and upload completion share an account lock.
This also protects older accounts whose password-status row does not exist yet.
Handler tests check error responses and service calls without cloud credentials.
Browser tests check locked visibility, cancel and restart, failed removal after the image row disappears, saved removal after refresh, and a lost completion response.
The cloud suite adds a real-account access-removal case and checks actual file deletion with the service role.
These new hosted checks remain unverified in this run.

Rendered verification used Playwright because the Browser plugin was not available.
The local flow was `image-preview.html` → failed team-visible upload → locked choice → cancel → a new choice.
The second flow was image preview → failed removal → **Retry removal** → completed cleanup.
Saved cleanup was also checked after refresh.
The page identity, meaningful content, absence of a framework error overlay, and interactions passed.
Screenshots were inspected at 1280×900 and 320×740.
The layout had no horizontal overflow at those widths or at 390×844.
The preview harness requested a missing favicon and received HTTP 404; no application errors were found.
Screenshots and the detailed browser log remain outside Git under `/tmp/minsky-pr19-fixes-*`.

Protected cloud verification remains pending.
GitHub environment, secret-name, and variable lookups for `cloud-test` returned HTTP 404.
The session has repository write access but no administration access.
Those responses do not establish whether the environment exists.
The Supabase CLI also could not create its default directory at `/home/agent/.supabase` on the read-only filesystem.
No credentials, shared database records, or provider settings were changed.
Configure or expose the protected CI environment, then dispatch **Checks** on the updated PR branch.
Keep its target on the separate `Minsky CI` project, `ghtztmovdkhuketcbjmq`.

Required run report:

| Field | Record |
| --- | --- |
| Summary of changes | Implemented all six review fixes and added tests. Updated the release and recovery instructions. |
| Files changed | `.github/workflows/checks.yml`, `package.json`, `README.md`, `docs/current-state.md`, `docs/cloud-onboarding.md`, `docs/manual-verification.md`, `docs/tickets.md`; `src/connected/ConnectedApp.tsx`, `IssueImages.tsx`, `imageUpload.ts`, `imageFile.ts`, `model.ts`, `imagePreview.tsx`, and `database.test.ts`; `supabase/functions/attachments/index.ts`, `handler.ts`, and `handler.test.ts`; `supabase/migrations/202610140001_attachment_fixes.sql`; `tests/images.spec.ts` and `tests/cloud/attachments.spec.ts`. The merge also includes current `main` changes in `.github/workflows/security.yml`, `.gitleaksignore`, `package-lock.json`, and `docs/code-quality.md`; `deno.lock` now matches the merged dependencies. |
| Commands run | Git inspection, fetch, worktree setup, and merge of current `main`; `npm ci` with a writable cache; TypeScript-guide fetch; `npm run typecheck`, `lint`, `build`, `check:functions`, `test:functions`, `npm test`, and `test:e2e`; `deno fmt`; local Vite and Playwright checks; GitHub access/environment lookups; a captured Supabase project-list attempt; `git diff --check`. Initial tests caught a request-ID type mismatch, an invalid staff-membership test setup, and selectors that also counted a form option. All were corrected before the passing runs. A repeated dev-server start found the existing port in use; verification used that server. |
| Build/test results | Local results are in the table above. Protected and hosted cloud tests were not run. Follow the live PR checks for the pushed revision's GitHub results. |
| Manual verification steps | Inspected desktop and phone screenshots and checked the browser's identity, console, layout, and rendered state through Playwright. Real devices, screen readers, other browser engines, 200% zoom, and hosted admin-limit acceptance remain unverified. |
| Risks | Cloud verification is pending. The new migration and attachment function must be released together in the documented order. The current hosted preview does not contain these fixes. |
| Follow-up tickets | Continue T0005/PR #19 through review and the explicit release step. Existing operational and manual-acceptance work stays deferred. No new ticket was created. |
| Docs that need updating | Record protected cloud and deployment results when they occur. Existing preview records remain historical. |

## T0005 development preview (2026-10-11)

The user requested a Cloudflare preview before merge and explicitly selected the existing `Minsky` development backend.
Preview: https://t0005-minsky-dev.icaic-minsky.workers.dev.
Frontend source revision: `da71d3a` (later verification/documentation changes do not change the frontend build).
Worker version: `0140e7ae-8b52-434e-83c8-71f576ec4d84`.
The main Worker stays on version `0384f2e5-7743-4ac1-9eb2-fbe6cea9aaef` at 100% traffic.
Its JavaScript remains `index-D_rCfhHh.js`.
PR #19 remains open for the user's review and merge.

The first hosted migration attempt failed because `postgres` cannot alter the Supabase-owned `storage.objects` table.
The corrected migration checks the existing Storage RLS prerequisite instead of changing ownership or re-enabling RLS.
The embedded fixture now enables Storage RLS before application migrations, matching the managed service.
The corrected migration applied successfully to development with no seeds.
The `admin` and `attachments` functions deployed with `--use-api`.
`ALLOWED_ORIGINS` retains the main and both local origins and adds the exact preview origin.
No CI project, production resource, or paid plan changed.

`npm run deploy:preview -- --preview-alias t0005` builds and uploads a version without deploying it to the main URL.
No permanent preview Git branch or automatic preview build is configured.
The preview uses existing development accounts, database, and Storage; its data is shared with the main app.

Verification used Node.js 22.22.1 and the existing installed dependencies after confirming identical lockfile hashes.
Build, lint, type checking, and Deno checking passed.
All 29 focused/database tests and all five public/image browser tests passed.
The preview HTML, JavaScript, CSS, font, and license returned HTTP 200 and matched the local build by SHA-256.
CORS preflights passed for both functions from the preview origin.
The build retains the existing Zod annotation and bundle-size warnings.

The hosted attachment check covers actual uploads of staff-only and team-visible PNGs, persistence after refresh, phone-width layout, full-size preview, download, uploader removal, contestant rendering, private Storage denial, and cross-team denial.
The fixture cleanup removes only the run's attachment paths and UUID-scoped rows before deleting its accounts.
The first hosted run passed the 12 existing cases but exceeded the new upload assertion's five-second wait.
That assertion now permits 30 seconds for function startup and two Storage transfers.
The final hosted suite passed all 13 cases in 1.4 minutes and completed fixture teardown.
Its temporary credential directory was removed.
These hosted development checks are separate from protected GitHub cloud CI, which was not run.
A hosted 320px support screenshot was reviewed; the images section and workflow controls fit the viewport.
Real devices, screen readers, other browser engines, 200% zoom, and manual admin-limit acceptance remain unverified.

Files changed in this preview follow-up: `package.json`, `wrangler.jsonc`, `deno.lock`, `src/connected/database.test.ts`, `supabase/migrations/202610110001_attachments.sql`, `tests/cloud/fixture.ts`, `tests/cloud/attachments.spec.ts`, `README.md`, `docs/cloud-onboarding.md`, `docs/tickets.md`, and this document.
Commands included repository/GitHub inspection, build/lint/type/function checks, focused/public/hosted tests, Supabase link/dry-run/migration/function/allowed-origin commands, Worker version upload/deployment listing, asset/CORS verification, and documentation/whitespace checks.
Sandbox restrictions required elevated retries for Git/network/provider operations.
An initial asset check used incorrect font filename casing; the corrected check passed.
Existing double quotes and inferred returns remain repository TypeScript style exceptions.
Operational follow-up items remain deferred as listed above; automatic PR preview uploads are not implemented.

## Main development deployment (2026-10-11)

The user authorized deployment of `main` to the existing development Worker and requested removal of temporary files afterward.
Deployed revision: `d1c36fdde9d5d61160688d12c330de59fca37ec3`.
Worker version: `0384f2e5-7743-4ac1-9eb2-fbe6cea9aaef`.
URL: https://minsky-dev.icaic-minsky.workers.dev.

The source came from a fresh archive of fetched `origin/main` in a temporary directory.
Both the frontend configuration and hosted-test target were confirmed as development project `ovymmobupzowotvrywek`.
The exact revision's GitHub [Checks](https://github.com/notbowen/minsky/actions/runs/38071450262) and [Security](https://github.com/notbowen/minsky/actions/runs/38071450234) workflows passed before deployment.
`npm ci` passed with zero reported vulnerabilities.
`npm run deploy` passed its TypeScript/build steps and published the Worker.
Cloudflare reported no changed static assets to upload.
No backend source changes relative to the previously deployed revision required migrations or an account-function deployment.

Hosted verification completed at approximately 01:27 SGT:

- The HTML, JavaScript, CSS, Public Sans font, and license returned HTTP 200 and matched the local build by SHA-256.
- `npm run test:hosted` passed all 12 real-account cases in 1.2 minutes, including the complete workflow, authorization, recovery, phone layouts, keyboard behavior, and archived access.
- The suite completed teardown of its UUID-scoped records and temporary accounts. Its temporary credential directory was removed.
- The temporary deployment checkout, copied local environment file, dependencies, build output, and test artifacts were removed after verification.

The build retains the existing two Zod annotation warnings and bundle-size warning.
Sandbox restrictions initially prevented Git fetch and GitHub access; elevated retries passed.
The sandboxed dependency installation stalled and was interrupted; the elevated installation passed.
A Python asset request received HTTP 403; the Node verification passed for all five public assets.
No additional manual browser review or protected cloud CI run was performed for this deployment.
T0005 retains the remaining manual acceptance work.
Only this deployment record changed in the repository; no application code changed.

## T0005 issue images (2026-10-11)

Implemented on `feature/t0005-issue-attachments`:

- Staff add JPEG, PNG, or WebP images from the issue detail.
- Each ready image records its uploader, time, visibility, size, and file name.
- The uploader chooses **Staff only** or **Visible to the team**.
- **Staff only** is the default, and the choice stays fixed.
- Contestants see team-visible images on their own team's issues.
- Volunteers, specialists, jury members, and session admins can upload while the event is active.
- Only the uploader can remove an image, and only while the event is active.
- Session admins set the file size, image count, and combined size inside the ranges in [T0005](tickets.md#t0005--issue-images).
- Resolved issues keep their images and still accept authorized uploads.
- Archived events keep the files for preview and download.
- Uploads, removal, and limit changes stop after archive.
- The private `issue-attachments` bucket stores the original and a browser-made JPEG thumbnail.
- Thumbnails do not count toward the image count or the issue total.
- Postgres and Storage enforce membership, visibility, and limits.
- Clients cannot insert attachment rows directly.
- Supabase Free includes 1 GB of file storage and does not include image transformations.
- This ticket does not enable transformations or a paid plan.
- At the default 120 MB issue total, about eight full issues use 1 GB.

The migration is `supabase/migrations/202610110001_attachments.sql`.
It is applied to `Minsky` development for the user-approved preview.
`Minsky CI` is unchanged.
Review pull request: [PR #19](https://github.com/notbowen/minsky/pull/19).
The `admin` and `attachments` functions are deployed to development.
The frontend is uploaded at the `t0005` Worker version alias; the main Worker deployment is unchanged.
Merging does not deploy this change.
Apply the migration first, then deploy `admin` and `attachments`, then deploy the frontend.

Verification on Node.js 24.11.0: `npm run typecheck`, `npm run lint`, `npm run check:functions`, and `npm run build` passed.
`npm test` passed 29 tests.
`npm run test:e2e` passed the three public sign-in cases and both image cases.
The production build does not include `image-preview.html`.
That page is a development harness for the image component.

Chromium checks at 390×844 opened a thumbnail, showed the full-size preview, download, and removal control, and returned focus on close.
The thumbnail uses the dark canvas.
The add and download controls stay amber.
At 320×740, the contestant section has no file input and no staff-only image.
The archived preview fits the screen, has no removal control, and does not overflow.
A real phone, screen reader, other browser engines, and 200% zoom were not checked.
The original implementation run did not check a signed-in upload or the admin limit form.
The later preview verification is recorded below.
The build keeps the existing Zod annotation warnings.
The main JavaScript bundle is 584.6 kB, or 167.3 kB gzip.

The [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) was read before the changes.
Existing double quotes and inferred component returns remain repository exceptions.
The thumbnail effect omits the attachment array from its dependency list because that array is recreated on each render.
The visible attachment ids are the dependency instead.

## T0010 P2 review fixes (2026-10-15)

Incoming reports preserve the displayed issue and its reply draft.
Membership forms use the current saved roles, admin flag, and team. Unchanged membership values preserve local edits.
Cloud test cleanup retains its recovery file on failure and removes it after success.
See [fixture recovery](cloud-onboarding.md#fixture-recovery) for the recovery steps.

At `c785964`, all 33 unit/database tests and 11 browser tests passed on Node.js 24.19.0.
Lint, type checking, the Deno function check, the production build, and whitespace checks also passed.
The browser tests use fictional API responses. Hosted Auth, Realtime, and cloud integration remain unverified.
The changes are not deployed.

After the merge from `main` at `9c0341c`, all 49 unit/database tests, 12 function tests, and 17 browser tests passed.
Lint, type checking, both Deno function checks, the production build, and whitespace checks passed.
Cloud integration was not run.

[PR #24](https://github.com/notbowen/minsky/pull/24) records detailed commands, browser observations, and TypeScript style exceptions.

## T0008 fuzzy team search (2026-10-11)

Staff search team names and locations from the session snapshot.
The issue queue and **Report for team** share one selection.
Suggestions show the team name, location, and unresolved-issue count.
An explicit choice stores the team's database id.
The status filter still applies. Jury-only members stay on resolved issues.
Contestants do not see the search.
There is no migration and no new roster field.

Focused Vitest coverage is in `src/connected/teamSearch.test.ts`.
`npm test` passed: 4 files, 28 tests.
`npm run lint`, `npm run typecheck` through `tsc --noEmit`, `npm run build`, and `git diff --check` passed.
Signed-in browser use of the queue and report form was not run in this change.
The manual steps are in [manual verification](manual-verification.md#11-team-search).
Cloud integration checks and deployment were not run.

## T0008 review fixes (2026-10-14)

Numeric search tokens now match only equal whole numbers, with leading zeros ignored.
They cannot match prefixes or nearby numbers through spelling distance.
Suggestion buttons stay outside the Tab order, so Tab moves to Status in the queue or Category in the report form.
Arrow keys, Enter, and pointer selection still choose an explicit team id.
Successful snapshot refreshes clear the choice after a session change, loss of staff access, or removal of the chosen team.
This also covers automatic session fallback after membership revocation.

On Node.js 24.19.0, `npm test` passed all 29 tests in four files.
Type checking, ESLint, production build, and whitespace checks passed.
The build retains the existing warning about a JavaScript chunk larger than 500 kB.
`npm run test:e2e` passed all seven cases: three public-page checks and four team-search regressions.
An external local Playwright configuration selected the preinstalled `/usr/bin/chromium` and stored artifacts under `/tmp`.
No dependency or repository browser configuration changed.

The Browser plugin was unavailable; local Playwright 1.63.0 exercised the actual app at `http://127.0.0.1:4173` with mocked Auth, session snapshots, and workflow responses.
Checked shared selection, the submitted team id, status filtering, counts, focus after Tab, volunteer/jury/admin/contestant controls, membership changes, and explicit session changes.
Desktop 1400×950 and phone 390×844/320×844 screenshots were captured and visually checked.
The phone layouts had no horizontal page overflow. No JavaScript or console errors were observed, and no framework error overlay appeared.
Realtime was disconnected by the fixture, so the local UI correctly showed Connecting.

Hosted real-account checks, protected cloud CI, assistive technology, other browser engines, and deployment remain unverified.
No migration or backend deployment is needed for these frontend fixes.
The edited files retain their existing double-quote style and inferred React component return types for consistency; the new browser tests use single quotes.

## T0008 keyboard clearing (2026-10-15)

**Clear team** now works with Enter and Space in both the queue and report form.
The input's focus handler publishes only an actual focus-state change, so refocusing after Clear cannot replay the previous selected team.
Both fields clear, focus returns to the initiating input, and the existing status filter remains active across all teams.
The report category and draft remain intact. Submission stays disabled until staff choose another team.
Pointer clearing and choosing another team still work.

The two new browser regressions reproduced the old failure with Enter and Space before the fix.
After the fix, all 29 unit/database tests and all nine credential-free browser tests passed on Node.js 24.19.0.
Type checking, ESLint, production build, and whitespace checks passed; the existing chunk-size warning remains.
The browser cases cover both controls, keyboard focus, shared selection, status filtering, draft retention, disabled submission, subsequent selection, and pointer clearing.

The Browser plugin was unavailable; Playwright 1.63.0 used installed Chromium at `http://127.0.0.1:4197` with mocked Auth and session responses.
Desktop 1400×950 and phone 320×844 screenshots were captured and visually checked after clearing.
Both fields were empty, the draft remained visible, Submit issue was disabled, and focus was on the report input.
There was no horizontal page overflow, framework error overlay, JavaScript error, or console error.
No workflow request was sent during the clear checks. Realtime remained disconnected by the fixture.

No migration, dependency, backend, or deployment change is included.
Hosted real-account checks, protected cloud integration, assistive technology, and other browser engines remain unverified.
The existing double-quote style in the React component remains unchanged; the browser tests retain single quotes.

## Ticket allocation (2026-10-03)

[T0004](tickets.md#t0004--ui-makeover) uses the user's dark green workspace and centered sign-in references.
Previous T0004 scope notes move to [T0005](tickets.md#t0005--issue-images).
They include the operational work above and candidate organizer tools and configurable issue attachments.
The [T0005 section](#t0005-issue-images-2026-10-11) records the later attachment decisions and implementation.

Protected cloud CI remains a recorded T0003 setup gap.
Repository inspection during the recorded run found no GitHub environments.
Historical reports refer to the earlier T0004 candidate scope.
Those references describe the scope at that time.
The 2026-10-03 ticket decision replaces that scope.

## T0004 merge and documentation follow-up (2026-10-11)

The user merged [PR #9](https://github.com/notbowen/minsky/pull/9) into `main` at `2026-10-10T16:53:00Z`.
This is `2026-10-11 00:53 SGT`.
Merge commit: [`52ff99133bd727626b3589b40a507ab438f508da`](https://github.com/notbowen/minsky/commit/52ff99133bd727626b3589b40a507ab438f508da).
Reviewed branch head: `601a0ab4bb31934fad4741647ac8a88b6c653a6c`.
The user deleted `feature/t0004-ui-makeover` after merge.

The user later merged [PR #13](https://github.com/notbowen/minsky/pull/13) into `main` at `44677c7`.
[PR #14](https://github.com/notbowen/minsky/pull/14) then merged the TypeScript major-update rule.
T0005 implements issue images.
See [T0005 issue images](#t0005-issue-images-2026-10-11).
At that point, the [2026-10-03 development deployment](#t0004-development-deployment-2026-10-03) was the latest frontend deployment.
The later main deployment and T0005 preview are recorded above.
Earlier reports retain the PR status and verification results from their recorded runs.

## T0004 UI makeover (2026-10-03)

Implemented:

- Centered public sign-in on a dark green canvas, local SVG Minsky mark, username/password fields, keyboard-operable Show/Hide password, amber sign-in button and always-visible organizer access/recovery guidance. The previous marketing sections and top navigation are replaced by the supplied sign-in composition. Development identification remains visible.
- Compact sidebar with actual contest/session context, person/team identity, combined permissions, account settings and sign-out. Administration remains admin-only; phone navigation expands through Menu. Password changes now start in My account; forced temporary-password changes retain their database boundary.
- Four-column desktop queue with status filters, green selected rows, team/location and owner/unresolved time. Phone rows become cards. Report an issue / Report for team opens the existing submission form, with cancel/success focus return. Narrow-screen selection focuses issue details; Back to queue focuses the queue heading.
- Detail heading/category/status, owner and timing facts, amber specialist acceptance panel, chronological activity and lock-marked internal notes. Active conversation follows the timeline; resolved issues show resolution/reopening/award controls before history. Blank replies disable Send reply. Timer presentation uses minutes:seconds while the persisted timestamp calculation is unchanged.
- Matching dark theme for password, account and administration screens. No schema, account-function or runtime dependency change. Deno's check synchronized its workspace dependency metadata with the dependency versions already merged on main; the lock's resolved function dependencies did not change.
- Updated browser checks use real authenticated accounts. The layout case adds five reports and category configuration only in its UUID-scoped CI session, including a pending handoff and private note. The recovery test now creates a temporary link to its selected test project instead of using the developer checkout's link; its temporary directory is removed in a finally block.

Verification: `npm run typecheck`, `npm run lint`, `npm run build` and `npm run check:functions` passed. `npm test` passed all 22 focused/database tests; the final credential-free browser run passed all three sign-in cases. `MINSKY_TEST_PROJECT_REF=ghtztmovdkhuketcbjmq npm run test:cloud` passed all 12 cases on the isolated Minsky CI project (about 1.5 minutes), with fixture teardown completed. The development checkout's project link was retained. This local cloud run is separate from protected GitHub Actions verification; the repository still has no `cloud-test` environment. Documentation paths/anchors and whitespace passed.

Visual review checked [desktop workspace](ui/t0004-workspace.png), laptop queue/detail, 390/320px support, [centered sign-in](ui/t0004-sign-in.png), contestant resolution/award, account and desktop/phone administration screenshots. Browser checks exercised keyboard focus/skip links, report open/cancel, phone menu/queue/detail return, password visibility, refresh, temporary passwords and reset, retained handoff ownership, repeated reopening, separate awards/application, private-note exclusion, races, revocation and read-only archived navigation. Real-device, screen-reader, other-engine and 200% zoom acceptance remains manual in T0005. The development deployment is recorded below.

Initial failures were corrected before the final runs: npm's sandboxed network lookup failed, then the approved install passed; an early build/browser attempt overlapped dependency installation and lacked installed tools, then checks passed after installation. Playwright's sandboxed server start failed, then the approved run passed. The first password-toggle test kept the old accessible name after the toggle; its locator was corrected. The first cloud run exposed the password-button navigation change and the recovery test's checkout-project assumption; both were corrected. The failed recovery call used a CI UUID absent from development and was rejected before any account mutation. Automatic review rejected a broad formatting cleanup; the narrower cleanup first proved three unrelated tests had identical TypeScript syntax trees, then removed only their incidental formatting changes.

The build retains two existing Zod annotation warnings and a 572.7 kB main JavaScript bundle (163.7 kB gzip). No capacity certification is implied. The [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) was read before changes; existing double quotes, React component capitalization and inferred component return types remain deliberate repository/framework exceptions. Native SVG path data stays on individual lines for maintainability; unchanged administration logic is retained after formatting.

Files changed: `src/connected/ConnectedApp.tsx`, `src/connected/ui.tsx`, `src/styles.css`, `tests/landing.spec.ts`, `tests/cloud/journey.spec.ts`, `deno.lock`, `README.md`, `AGENTS.md`, `PLAN.md`, `docs/tickets.md`, `docs/product-direction.md`, `docs/manual-verification.md`, `docs/cloud-onboarding.md`, `docs/code-quality.md`, `docs/ui/t0004-sign-in.png`, `docs/ui/t0004-workspace.png`, and this document. Commands included Git/gh repository and CI inspection, `npm ci`, the checks above, pinned Prettier formatting, documentation-link and syntax-tree comparisons, screenshot copies/review, `git add`/`commit`/`push` and `gh pr create`. Implementation commit `4f12c37` is pushed, and [PR #9](https://github.com/notbowen/minsky/pull/9) is open for user review. Remote PR check results are reported on the PR; protected cloud CI has not run. T0005 retains the deferred scope notes.

## T0004 development deployment (2026-10-03)

The user explicitly requested "Deploy first" after PR #9 was prepared, authorizing this development frontend deployment before merge. `npm run deploy` built and deployed revision `e7f73d8cdd4894d8b41275a284464ea4e1d05213` to [minsky-dev](https://minsky-dev.icaic-minsky.workers.dev), Worker version `2d487ed1-c4df-45fa-bbf1-56b790bb9042`. The configured Worker/account and frontend Supabase URL were checked before deployment; both the frontend and checkout target development project `ovymmobupzowotvrywek`. No schema, account-function, provider configuration or paid-resource change was required.

The landing page returned HTTP 200. SHA-256 comparisons confirmed that deployed JavaScript `index-D_rCfhHh.js`, CSS `index-jTiosHgl.css`, Public Sans font and its license match the local build byte for byte. `npm run test:hosted` passed all 12 real-account cases in 58.1 seconds, including the full issue journey, public/internal separation, account recovery, role authorization, responsiveness and keyboard navigation. These hosted tests created isolated temporary development accounts and UUID-scoped records, completed fixture teardown and removed their temporary fixture directory. They are separate from the earlier local Minsky CI run and protected GitHub Actions cloud verification. Hosted desktop sign-in/workspace and 320px workspace screenshots were reviewed.

GitHub `checks`, `dependencies` and `secrets` passed on the deployed source revision; the ordinary PR cloud job was skipped. The protected `cloud-test` environment remains a recorded setup gap. The build passed with the existing Zod annotation and bundle-size warnings. PR #9 remains open for user review and merge; the following documentation commit records deployment without changing the deployed application source.

Files changed during deployment: `AGENTS.md`, `PLAN.md`, `docs/tickets.md`, `docs/cloud-onboarding.md`, and this document. Commands: repository/configuration/environment inspection, `npm run deploy`, `npm run test:hosted`, Node HTTPS/asset-hash checks, `gh pr view`, screenshot review, documentation-path/whitespace checks, `git add`/`commit`/`push` and `gh pr edit`. No deployment or hosted-test command failed. Remaining manual acceptance stays in T0005; relevant documentation is current.

## T0004 dependency repair and PR clarification (2026-10-11)

[PR #9](https://github.com/notbowen/minsky/pull/9) implements the T0004 UI makeover. [PR #13](https://github.com/notbowen/minsky/pull/13) is a documentation rewrite based on PR #9's branch. Both branches belong to T0004. The ticket index now explains their relationship and the requirement to retarget PR #13 to `main` after PR #9 merges. Until then, `main` retains the older proposed T0004 follow-up scope; the 2026-10-03 allocation in PR #9 moves those notes to T0005. T0005 implementation has not started.

A fresh audit of PR #9's original lockfile reported three high-severity package findings from one [sharp/librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). The earlier green dependency checks predated the advisory's addition to GitHub's database. Wrangler is now pinned to `4.149.0`, bringing Miniflare `5.20261006.1-alpha`, sharp `0.35.5` and its patched native dependencies into the npm lockfile. Lockfile changes are limited to Wrangler and its dependency tree. Deno checking synchronized the workspace's Wrangler version in `deno.lock`; resolved account-function dependencies did not change.

Verification: a clean `npm ci` passed, and `npm audit --package-lock-only --audit-level=high` reported zero vulnerabilities. Type checking, lint, Deno function checking and the production build passed. All 22 focused/database tests and all three public sign-in browser tests passed. Wrangler `deploy --dry-run --outdir /tmp/minsky-pr9-worker-dry-run --no-autoconfig` prepared the static frontend successfully and exited without uploading it. The build retains the two recorded Zod annotation warnings and the 572.7 kB main JavaScript bundle warning. Documentation paths, ticket numbering and whitespace were checked before commit. GitHub check results are reported on PR #9.

No cloud suite or live deployment was run for this deployment-tooling patch. Protected GitHub cloud CI remains the recorded T0003 setup gap. Real-device, screen-reader, other-engine and 200% zoom acceptance remains in T0005. PR #13 still needs its separate review and an update to the patched base; its previous failed audit is historical evidence, not a check of this patch.

Files changed: `package.json`, `package-lock.json`, `deno.lock`, `docs/tickets.md` and this document. Commands included Git/gh inspection, Node lockfile comparisons, the targeted npm lockfile update, `npm ci`, the checks above, `npm ls`, Wrangler help/dry-run and documentation validation. The sandbox blocked a read-only Node/Git comparison; its approved retry passed. No application verification check failed. This patch remains within T0004; it does not start another development ticket.

## Dependabot TypeScript majors (2026-10-11)

[PR #10](https://github.com/notbowen/minsky/pull/10) (`@types/node` 26.6.4) and [PR #11](https://github.com/notbowen/minsky/pull/11) (`typescript-eslint` 8.71.1) rebased onto the Wrangler pin and passed `checks`, `secrets` and `dependencies`. [PR #12](https://github.com/notbowen/minsky/pull/12) proposed TypeScript 7.0.2. Its `dependencies` and `secrets` checks passed after that rebase, and `checks` failed in `npm ci`: `typescript-eslint` 8.71 requires TypeScript `>=4.8.4 <6.1.0`. The npm registry's latest `typescript-eslint` is still 8.71.1 with that same peer range. Dependabot closed PR #12 after an ignore-this-major-version comment and will not reopen TypeScript 7.x unless that pull request is reopened. `.github/dependabot.yml` also ignores every TypeScript major update. Patch and minor TypeScript updates remain enabled. That committed ignore takes effect after this configuration reaches `main`.

Conflict resolution for [PR #14](https://github.com/notbowen/minsky/pull/14) merged `main` at `44677c7` into `feature/dependabot-typescript-majors`.
The resolution retains the documentation rewrite from PR #13 and the TypeScript major-update rule from PR #14.
Dependabot YAML validation, all 30 local documentation links and anchors, and whitespace checks passed.
Only the five intended configuration and documentation files differ from `main`.
Application checks were not rerun locally for this resolution; GitHub CI runs on the pushed revision.

## Login landing page, sidebar and demo retirement (2026-10-02)

The user requested a main login landing page and side navigation, then explicitly requested removing the old local demo, unnecessary old tests and residue, and pushing the changes. This extends the current T0003 branch. The app has one runtime: real Supabase accounts/shared data. The original development event/roster remains configured data, not a persona simulation. Broader organizer editors and assignment tools are still missing; deployment completion does not imply a complete contest-management product.

Implemented:

- Public login landing page with **How it works**/**Sign in** navigation and role/workflow guidance. Existing username/password login and organizer-assisted recovery remain.
- Desktop sidebar separates issues, **Administration** and **My account**. Administration appears only for a current admin membership. Team and jury issue labels reflect their existing permissions. Account details show the signed-in username, session and permissions with access to password change.
- On phones, **Menu** expands/collapses navigation. Selecting a section closes it and focuses its heading. Queue/selection/filter state remains in the current dashboard while switching sections; reload returns to issues. Current membership is still refetched and all backend permission checks remain.
- Removed the local demo entry point, personas/reset, seed/domain code, browser-local issue storage and v1 migration, demo-only unit/browser tests, v1 fixture, demo command, specification and obsolete manual walkthrough. Isolated cloud verification fixtures remain and clean only their own records. Supabase's ordinary Auth session persistence remains; it is not local issue storage.
- Credential-free PR browser checks now exercise the connected public landing/login page with placeholder public connection settings. Full authenticated behavior remains covered by embedded database tests and isolated cloud tests. No runtime dependency, schema or account-function change was needed.

Verification so far: type checking, ESLint, Deno account-function checking and production build passed. All 22 focused/database tests passed; all two public landing/login browser cases passed (2.8 seconds); all ten local-frontend/real-cloud cases passed (53.2 seconds), with fixture cleanup. The cloud cases include the new sidebar role/desktop/mobile/keyboard checks plus the shared journey, privacy, races, revocation, archives, temporary credentials/reset, identity preservation and trusted admin recovery. The initial sandboxed browser run could not start its web server; the approved rerun passed. Documentation paths and whitespace passed.

Agent screenshot review checked desktop login, account/sidebar and administration plus support at 320px. Real-device, screen-reader, other-engine and 200% zoom checks remain manual. The build retains the existing two Zod annotation warnings and about 572 kB main JavaScript (163 kB gzip); no capacity certification is implied.

Cloudflare deployment succeeded with `npm run deploy`: Worker version `740199b0-1e8c-4e89-9d3b-4b4a9d8b8b99`, JavaScript `index-DlDOlXFP.js`, CSS `index-CaL9-49B.css`, at https://minsky-dev.icaic-minsky.workers.dev. All ten hosted cases passed (54.2 seconds), including sidebar navigation and the full real-account journey; cloud fixture cleanup completed. Hosted administration screenshots were also reviewed. Removed generated `dist/`, `test-results/`, TypeScript build info, Vite caches and the empty legacy fixture directory after verification. No cloud test temporary paths remained. Push/remote checks are recorded in the PR; the user reviews and merges. The older local-demo reports below describe prior commits; removed files/commands must not be treated as current setup. Existing double quotes, React component capitalization and inferred component returns remain deliberate Google TypeScript style exceptions. Unchanged issue-detail and account-administration logic was retained after formatting.

Files changed: `src/connected/ConnectedApp.tsx`, `src/connected/model.ts`, `src/connected/model.test.ts`, `src/main.tsx`, `src/styles.css`, `tests/cloud/journey.spec.ts`, `tests/landing.spec.ts`, `playwright.config.ts`, `package.json`, `README.md`, `AGENTS.md`, `PLAN.md`, `docs/cloud-onboarding.md`, `docs/code-quality.md`, `docs/manual-verification.md`, `docs/product-direction.md`, `docs/tickets.md`, and this document. Deleted: `src/App.tsx`, `src/domain.ts`, `src/domain.test.ts`, `src/storage.ts`, `src/storage.test.ts`, `src/legacy-state.ts`, `tests/journey.spec.ts`, `tests/fixtures/v1.json`, `docs/demo-spec.md`.

## Interface refinement (2026-10-02)

The user requested installing Anthropic's `frontend-design` skill temporarily, applying it to the existing application, pushing the changes and deploying to Cloudflare, then deleting the skill. This is a refinement of the active T0003 branch.

Implemented:

- Indigo/teal visual system, locally served variable Public Sans with its SIL Open Font License, and a handoff illustration on desktop sign-in. Phone sign-in keeps the introduction compact so credentials remain easy to reach. No external font request or new npm dependency is required.
- Responsive account controls, reporting forms and administration sections. The connected queue now sits beside the selected issue on desktop and stacks on phones; its previous `columns` class had no corresponding style. Submission markup now matches the intended form layout. Status names, ownership, timing, privacy and award/application semantics are preserved.
- Keyboard-visible focus, 44px minimum form/control heights, and recovery help with expanded/collapsed state. Empty queues explain where reports will appear or suggest changing the filter. The historical demo shares the visual styles and retains its local controls.
- Browser coverage for sign-in at 800/390/320px, keyboard recovery help, and desktop queue/detail placement. Existing real-account journey checks still cover phone widths, refresh, private notes, handoffs, repeated resolutions, awards and organizer account operations.

Verification before deployment: `npm run typecheck`, `npm run lint`, `npm run build` and `npm run check:functions` passed; `npm test` passed all 72 focused tests. All 21 demo browser tests passed on the final sequential run (9.0 seconds). All nine local-frontend/real-cloud cases passed (52.4 seconds), with fixture cleanup completed. `git diff --check` and local documentation-path checks passed.

The initial restricted-network skill command was interrupted and the approved download succeeded using `npx --yes skills add https://github.com/anthropics/skills --skill frontend-design --agent codex --yes`. One verification attempt ran demo and cloud browser suites together; both use `test-results`, so cloud startup removed demo trace artifacts and eight demo cases failed during artifact cleanup. Running the final suites sequentially resolved that tool-level conflict. No failed run is counted as a passing check.

Agent screenshot review checked desktop sign-in/contestant/admin views, support views at 390px/320px and hosted admin at 390px. It led to a more compact phone introduction and a corrected word break. Real-device, screen-reader, other-engine and 200% zoom checks remain manual steps in the guide. This work is not capacity or production-security certification.

Cloudflare deployment succeeded with `npm run deploy`: Worker version `b0874359-0138-410e-b113-8e51061bb29e`, JavaScript `index-JCwcwqsc.js`, CSS `index-CzChhVyC.css`, at https://minsky-dev.icaic-minsky.workers.dev. All nine hosted cases passed (47.2 seconds), including the full workflow and new interface checks; test fixtures were cleaned up. HTTP checks confirmed the deployed JavaScript, CSS, font and license match the local build byte for byte. The temporary skill was removed with `npx --yes skills remove frontend-design --agent codex --yes`; its remaining downloaded source, lockfile and empty installation directories were deleted explicitly. The installation artifacts are absent from the final repository change.

The build retains the existing two Zod annotation warnings and a 572 kB main-bundle warning (about 163 kB gzip). Style preserves repository double quotes, React component capitalization and inferred component returns; unchanged domain/administration logic was retained after formatting. These are the existing deliberate Google TypeScript Style Guide exceptions.

Files changed: `src/connected/ConnectedApp.tsx`, `src/styles.css`, `tests/cloud/journey.spec.ts`, `public/fonts/public-sans-variable.woff2`, `public/fonts/OFL-Public-Sans.txt`, `README.md`, `docs/tickets.md`, `docs/manual-verification.md`, and this document. No schema or account-function change was needed. Candidate T0004 and pending provider/protected-CI acceptance items remain unchanged.

## Username/password revision (2026-10-02)

The user selected organizer-created usernames/passwords and organizer-assisted recovery. SMTP and personal email addresses are no longer T0003 prerequisites. The user also confirmed signing into the original hosted admin account.

Implemented:

- Username login backed by Supabase internal email-format identities. Existing email logins work until username assignment; assigning a username keeps the existing Auth UUID, password, memberships and history.
- Admin account creation with server-generated temporary passwords, shown for that create/reset action only. Existing passwords cannot be retrieved. Forgot-password guidance sends users to organizers rather than email recovery.
- Required first-login/reset password changes enforced by database policies and the workflow RPC, not only UI. Completion checks the actual Auth password hash; client metadata cannot bypass it.
- Resets invalidate prior Auth sessions and refresh tokens. Database session cutoffs continue denying old JWTs even after the replacement password changes. Current password is requested for ordinary and required password changes.
- Account-wide resets/username assignment require admin access to every affected session and reject archived memberships. Ordinary roles/intake remain session scoped. Own password changes use the signed-in flow; trusted provider recovery covers a lost sole-admin password.
- Redesigned administration with padding, four status cards, a separate intake control, account creation/management columns, readable expandable rows, conditional staff permissions and collapsed advanced/audit sections. It stacks on phones; sign-in/password forms also have proper spacing.
- Migrations `202610020004_usernames.sql` and `202610020005_admin_recovery.sql`; `cloud:recover-admin` is a private maintainer command. Service-only provisioning/recovery functions are unavailable to ordinary app accounts.

Final verification:

| Check | Observed result |
| --- | --- |
| Type checking, ESLint, Deno function check, production build | Passed; lint has no warnings |
| `npm test` | 72 tests passed, including temporary-password RLS/RPC gates, stale-session denial, cross-session account administration and service-only admin recovery |
| `npm run test:e2e` | All 21 historical demo browser tests passed |
| `npm run test:cloud` | Seven final local-frontend/real-cloud cases passed (46.6 seconds), including the redesigned account controls and private maintainer recovery command |
| `npm run test:hosted` | All eight hosted cases passed (49.0 seconds), additionally verifying existing-email account conversion without changing UUID/password/membership |
| Migrations/function/deployment | Both new migrations applied without seeds; account function deployed with cloud bundling; frontend deployed successfully |
| Documentation links and `git diff --check` | Passed |

Current verified Worker version: `d0a04423-74fd-4a29-997e-f74c5b22f7db`; assets `index-BL2ghMjy.js` and `index-wMQJQd8C.css`. The build retains the two Zod annotation warnings and a 569 kB main-bundle warning (about 163 kB gzip).

Hosted tests exercised organizer creation, case-insensitive username login, forced password change after refresh, denied pre-change reads/completion, reset/session/refresh-token invalidation, denied old-token Auth updates, replacement-password change, existing-account conversion, trusted provider recovery and the original complete shared journey/privacy/races/revocation/archive cases. Disposable fixtures were cleaned up. No real admin password was requested, inspected, changed or reset.

Screenshot inspection checked the redesigned desktop admin workspace and phone layout. Browser layout checks passed at 390px and 320px; prior keyboard skip/form/refresh coverage remains. Real-device, assistive-technology and other-browser checks remain manual. The user should refresh the hosted app, optionally assign their own username, then create a development team/staff account and securely distribute its temporary credentials.

Initial verification issues were resolved: ESLint’s account-effect dependency warning, an explicit Node console import for the maintainer script, and a documentation-edit script’s formatting anchor. The Supabase CLI initially failed because the sandbox prevented telemetry writes; approved execution applied the migrations. No checks are counted as passing from those failed attempts. The first PR secret scan flagged the public development-user UUID in newly compact onboarding wording. The wording was clarified, and `.gitleaksignore` records only that exact historical fingerprint; no broad UUID, path or rule exclusion was added. Full history scanning remains enabled, now with verbose redacted diagnostics. Provider plan/ownership and the protected separate cloud CI environment remain pending; no paid service was enabled.

Style keeps repository double quotes, React component capitalization, concise JSX callbacks and inferred component/Zod types. Shared logic uses named exports. Unchanged workflow code and historical tests were restored after formatting to avoid unrelated rewrites.

Files changed in this revision:

- Application: `src/connected/ConnectedApp.tsx`, `src/connected/client.ts`, `src/connected/model.ts`, `src/styles.css`.
- Backend/recovery: `supabase/functions/admin/index.ts`, `supabase/functions/.env.example`, `supabase/migrations/202610020004_usernames.sql`, `supabase/migrations/202610020005_admin_recovery.sql`, `scripts/recover-admin.mjs`, `package.json`.
- Tests/CI: `.gitleaksignore`, `.github/workflows/security.yml`, `src/connected/client.test.ts`, `src/connected/database.test.ts`, `tests/cloud/fixture.ts`, `tests/cloud/setup.ts`, `tests/cloud/journey.spec.ts`, `.github/workflows/checks.yml`.
- Guidance: `AGENTS.md`, `PLAN.md`, `README.md`, `docs/cloud-onboarding.md`, `docs/current-state.md`, `docs/manual-verification.md`, `docs/product-direction.md`, `docs/tickets.md`.

Original email-flow results below are historical; they do not describe current onboarding requirements.

## Original connected implementation (historical T0003 baseline, 2026-10-02)

- Cloudflare Workers Static Assets at https://minsky-dev.icaic-minsky.workers.dev; all backend operations use Supabase project `ovymmobupzowotvrywek`, region `ap-southeast-1`, PostgreSQL 17. Final deployed Worker version: `dcbba8b9-39af-4528-8fda-70ce61534ddf` (after private signals and archived-read refinement).
- Supabase email/password sign-in, logout, session restoration and password change. Invitation/password-setup and recovery UI/function paths are implemented; hosted delivery remains unverified without custom SMTP. Public signup/anonymous access settings are user-reported disabled. The user confirmed the deployed Site URL and exact local/deployed redirects.
- Three repository-owned migrations for group events/sessions, teams, people/memberships, issues, resolutions/reopening, separate history/awards, admin audit, request receipts and private/public live signals. All were applied without seeds. Server timestamps, issue locks/revisions and one-award constraints preserve the existing semantics. Persisted request IDs make retries safe, including submission/message retries.
- Contestant own-team dashboard, support triage/handoff/reopening, jury awards and combined-role capabilities. Support reports retain the actual reporter and affected roster team. Admin is separate from support/jury.
- Current-membership RLS protects direct reads, history, counts and snapshots. Internal notes use staff-only signals and do not increment public issue/team counters. Realtime refetches authorized snapshots, with serialized reads to prevent old responses restoring a stale revision. Current membership is also checked on focus/reconnect and every ten seconds. Database access is denied immediately after revocation, even for existing login sessions.
- Admin UI for invitations, existing-account assignments, fixed role unions, revocation, resend/recovery and intake. Transactional administration prevents removing the last admin and records actor/time. Privileged account operations use a caller-verified Edge Function and check current admin membership before using service credentials.
- Explicit trusted bootstrap created the initial development group event/session, three roster teams, and admin membership for the existing user-selected Auth account. Its password was not requested or changed. Intake starts closed. No first-login auto-promotion, hosted reset, persona impersonation or demo-data import exists.
- Archived records permit queue navigation/read access while disabling writes. The server also rejects archived writes.
- Cloud contributor setup assumes full authorized cloud access per the user's latest instruction. Docker is optional. Functions deploy with `--use-api`; embedded PostgreSQL checks run without cloud credentials or Docker. Cloud tests provision isolated temporary accounts/sessions and clean up their own rows. The historical local demo stays available through `dev:demo` and is excluded from production assets.
- PR CI is implemented for secret-free checks. Protected, manually dispatched cloud integration CI requires a separate test project and owner-configured environment secrets; it has not run yet. No preview/deployment automation writes to the shared project.

## Original T0003 verification (historical baseline)

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings on final implementation |
| `npm run check:functions` | Deno check passed |
| `npm test` | 66 focused tests passed, including actual migrations/RLS on embedded PostgreSQL with an Auth-context stub |
| `npm run test:e2e` | All 21 historical demo Chromium tests passed |
| `npm run test:cloud` | Five real-cloud cases passed with staff-only signals and unchanged public counters; the final hosted suite also exercises repeated cycles |
| `npm run test:hosted` | All five final cases passed on Worker version `dcbba8b9-39af-4528-8fda-70ce61534ddf`, including repeated reopening and private counters |
| `npm run cloud:plan`, `cloud:migrate`, `cloud:bootstrap` | Dry run, all migrations and explicit first-admin bootstrap succeeded |
| `npm run cloud:functions` | Final formatted source redeployed successfully with server-side bundling |
| `npm run deploy` | Workers Static Assets deployment succeeded |
| `git diff --check`, local documentation path scan | Passed |

The hosted browser suite covers multiple real Auth accounts, live updates, private replies, retained handoffs, zero award/external confirmation, reopening, refresh persistence, concurrent claims/awards, cross-team/session/anonymous denials, current revocation, last-admin guard, admin UI role assignment, password change/logout and phone/keyboard checks. The added archive case checks that read navigation remains enabled while writes are disabled. The final privacy case additionally checks staff-only live signals and unchanged contestant-visible counters.

Screenshot inspection checked the connected support screen at 320px and the desktop admin membership form. Browser actions exercised support at 390px, layout/no-overflow at 320px, keyboard skip navigation and refresh. These are agent-driven Chromium checks, not real-device, screen-reader, other-engine or 200% zoom verification. Those remain manual steps in the guide.

Initial failures were resolved: two embedded test-fixture assertions, a demo keyboard wait after dynamic module loading, an award-dropdown locator that included option text, an older Realtime snapshot restoring a stale revision, and a duplicate test sign-in after adding a second live staff observer. Action errors now remain visible across background refreshes. The initial CLI function deployment tried local container bundling and was interrupted; the committed command uses server-side bundling. A formatter invocation inside the sandbox stalled and was interrupted; approved cache/network access completed it. No database/test Docker stack was started.

The build passes with two existing Zod annotation warnings and a 563 kB main-bundle warning (about 161 kB gzip). This is not capacity/performance certification. New npm installs reported zero audit vulnerabilities at installation time.

Style: preserve repository double quotes, React component capitalization, concise JSX callbacks, inferred component returns and Zod-inferred data types for framework readability and repository consistency. New shared logic uses named exports. These are deliberate exceptions to individual Google TypeScript style rules; no unrelated style rewrites were made.


Final hosted result: `npm run test:hosted` passed all five cases (30.2 seconds), including three resolutions/two reopenings across real clients, preserved external application, staff-only note signals, unchanged public revisions, direct private-note exclusion, concurrent claim/award winners, admin role assignment, password changes/logout, current revocation and archived navigation. Test fixture cleanup completed successfully. The user confirmed saving Site URL and exact redirect URLs; real mail delivery is still not verified.

Clean-checkout verification: `/tmp/minsky-t0003-clean` at `bfe94e1` used a fresh `node_modules` install and only public Supabase frontend settings. `npm ci`, type checking, lint, all 66 focused tests, Deno checking and the production build passed, producing the same `index-BwjV5kgP.js` asset as the deployed build. The install reported zero audit vulnerabilities. After installation, `cloud:link` succeeded and `cloud:plan` reported the remote database up to date with no pending migrations or seeds. An initial premature link attempt failed with `supabase: not found`; the sequential rerun passed.

## Pending acceptance and known limits

- Email invitations/recovery and SMTP were removed from T0003 by explicit user decision. Organizer credential delivery and identity checks before recovery are operational responsibilities.
- Protected cloud CI remains incomplete in T0003. Initial inspection on 2026-10-02 found no GitHub environments and only the shared development Supabase project; the separate CI project has since been prepared as recorded below. The available GitHub account has write access without admin access; the user confirmed they are a contributor and the owner is unavailable. The `Checks` workflow file is absent from `main`, so manual dispatch also requires it to reach the default branch through review and merge. Neither environment protection nor a privileged CI pass is claimed.
- Selected billing plans, ownership/billing contact/receipt records, GitHub merge enforcement/vulnerability alerts and remaining user/manual acceptance checks are deferred to T0005. No paid upgrade was selected or payment information handled by the agent.
- Membership revocation preserves historical ownership. If an active owner loses support membership, restore it to continue owner-only work or have another specialist accept an already pending handoff. General reassignment tools are not in T0003.
- Group contests and one award per issue only. Uploads and broader organizer editors remain candidate T0005 scope; shared incidents, imports, alerts/push, offline/resilience and 800-user capacity testing remain deferred. T0004's UI makeover is implemented and verified locally; T0005 implementation has not started.

## Separate CI project and development workflow (2026-10-02)

The user created `Minsky CI` (`ghtztmovdkhuketcbjmq`). Supabase CLI verified it is active and healthy in Tokyo (`ap-northeast-1`), in organization `gayymsuhfqsboksikzwx`, with PostgreSQL 17. A separate temporary checkout was linked to this target; the main checkout retained its development link. All five migrations were applied without seeds, the admin function was deployed with `--use-api`, and the test origin was configured. No shared development accounts or data were copied or changed.

The first cloud setup failed because the repository's previous `auth.email.enable_signup = false` setting disabled hosted email/password login when pushed. The configuration now enables that provider while retaining the global public-signup block and explicitly disabling anonymous sign-in. A new real Auth check verifies public signup is denied and organizer-created accounts can log in. The cloud job now applies repository-owned configuration before migrations. A failed fixture setup also exposed a second teardown attempt against already deleted accounts; successful setup-failure cleanup now clears its fixture file before rethrowing the original error. Repeating the initial failure verified the secondary cleanup error was removed.

The isolated CI project's full local cloud suite passed all 11 cases, including managed Auth, workflow, permissions, competing claims/awards, password reset, sole-admin recovery, phone/keyboard/refresh and archival behavior. The final signup check was rerun and passed after its lint correction. Fixture teardown completed; a separate provider check found zero events, sessions, teams, people, issues, audit rows and Auth users in the CI project. Configuration comparison found no pending declared changes. Type checking, lint, the production build, Deno function checking, all 22 focused/database tests and both public landing/login browser tests passed. Workflow YAML validation and documentation links/whitespace passed; actionlint was unavailable on PATH and its invocation could not run. The temporary CI checkout and generated local build/test artifacts were removed afterward. These local results are not a protected GitHub Actions run.

The development → isolated CI → future production process is now explicit in AGENTS.md, README.md and cloud-onboarding.md. Production has not been provisioned; the current hosted app remains development. The user reviews and merges; deployment is an explicit subsequent action. Owner-controlled GitHub environment setup and default-branch workflow availability remain pending in T0003. Provider records, remote merge enforcement/vulnerability alerts and remaining user/manual acceptance checks remain deferred to T0004.

## Selected code-quality controls (2026-10-02)

T0003 now includes the user-selected CI/review/security improvements:

- Existing quality CI uses pinned action commits, credential-free checkout and job timeouts. New pushes cancel obsolete ordinary checks; manual cloud runs are kept separate so automatic cancellation does not interrupt fixture cleanup.
- A short PR template covers scope/readability, authorization/privacy, workflow invariants, compatible migrations, verification and documentation.
- Secret-free security CI runs redacted Gitleaks history scanning and a lockfile audit that fails on high/critical runtime or development advisories. Both run on PRs, `main`, manual dispatch and a weekly default-branch schedule.
- Weekly Dependabot npm/action update PRs are configured. Update scheduling begins after this configuration reaches `main`.
- The prepared branch-protection payload requires up-to-date `checks`, `secrets` and `dependencies` from GitHub Actions, one independent approval, resolved threads and no administrator bypass, force pushes or branch deletion. **Remote merge protection and vulnerability alerts still require owner setup**: the available account has write permission, not administration access. Private-repository plan availability has not been verified. See [code-quality.md](code-quality.md).

Local verification for this change: actionlint and YAML/JSON validation passed;
documentation paths and whitespace passed; type checking, ESLint, Deno checking,
all 66 focused tests, build and all 21 historical demo browser tests passed.
The dependency audit found zero vulnerabilities. Gitleaks found no leaks in all
16 existing commits or tracked/pending non-ignored files. A temporary synthetic
token fixture was detected even after removal in a later commit, and output
redaction was verified. No scanner exceptions were needed. PR #2 records remote
CI results for the quality-control changes.

Initial restricted GitHub/npm access and browser-server startup failed; approved
network/browser execution succeeded. Existing Zod annotation and bundle-size
warnings remain. No application behavior, cloud data or deployment changed;
hosted tests were not repeated for these workflow/documentation changes.

## Historical local-demo implementation and verification

## Implemented

- React/TypeScript/Vite app with a clearly labeled simulation and five seeded personas, including Robin Ellis with volunteer + technical specialist roles.
- Three seeded teams/issues in one fictional group-contest session. Contestant submissions use Aurora's roster location and seed-configured categories.
- Staff status queues and ownership handoff. Public replies, staff-only notes, resolution summaries, accumulated unresolved-time timers and original first-assignment delay.
- One discretionary award per issue, recorded while resolved in a separate ledger, with separate external-application confirmation and actor/timestamps.
- Person-based ownership and capability unions. Any support helper can claim; another specialist must accept a handoff. Jury membership does not suppress support capabilities.
- Contestant/helper reopening with a public reason, retained owner, structured resolution/reopening history and unchanged awards/application. Resolved intervals do not count toward unresolved time.
- Validated v1-to-v2 browser-local migration, preserved v1 source, v2 precedence, explicit error recovery and confirmed v2 reset.
- Responsive layouts, native labeled controls, keyboard focus styles and a skip link.
- Domain/storage tests and a browser journey plus phone/keyboard and recovery cases.

## Review refinements — 2026-10-02

Implemented zero-minute award decisions and award choices of 0, 5, 10, 15, 30, 60 and Custom. The required public explanation, one-award rule and separate application confirmation also apply to zero. The v2 schema now accepts non-negative whole minutes without changing the stored representation; existing v2 data remains compatible and the v1 migration validator stays frozen.

Resolution now offers Resolved without comment, Service restored, Device issue resolved, Problem statement clarified and Custom. Custom preserves free-text validation. The no-comment choice stores its explicit text. Reopening requires a fresh resolution choice.

After these refinements, type checking, lint, all **51 focused tests**, the production build, all **21 Chromium browser tests**, whitespace checks and local documentation links passed. The existing two Zod annotation warnings remain non-blocking. The first browser run used an exact label-text locator that included the dropdown options; switching that test locator to the accessible combobox name fixed the failure. All final browser cases passed, including every preset, custom zero/non-preset values, invalid custom values, preset/custom switching, fresh choices after reopening and refresh persistence.

An agent-driven walkthrough and screenshot review checked custom resolution fields at 390 × 844 and 320 × 740, the desktop award controls, keyboard resolution submission, and persistence of both a zero-minute award and the no-comment resolution. No horizontal overflow or browser page errors occurred. Temporary scripts, screenshots and generated build/test artifacts were removed; maintained regression tests remain. The earlier style exceptions and unverified real-device/accessibility checks below still apply.

## Initial T0002 verification — 2026-10-02

Observed on Node.js 22.22.1, npm 11.12.0 and Playwright Chromium:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 49 focused tests passed, including role unions, direct triage, self-handoff rejection, reopening cycles/timing, awards and validated v1/v2 persistence |
| `npm run build` | Passed; the same two non-blocking Zod dependency annotation warnings remain |
| `npm run test:e2e` | 10 tests passed: original journey/recovery, direct specialist and combined-role claims, keyboard handoffs/reopening at both phone widths, repeated reopening with awards/privacy/refresh, support + jury fixture, and legacy migration/reset |
| `git diff --check` and documentation link checks | Passed |

An additional agent-driven Chromium walkthrough and screenshot review checked desktop contestant/jury views, combined-role labels and reopening forms at 390 × 844 and 320 × 740, keyboard skip/claim/handoff/reopen actions, public/internal separation, reopening after refresh, pending award application while reopened, and both reset cancellation and acceptance. Neither phone width overflowed. No page errors occurred. Native select text truncates at narrow widths; the full person name and both roles wrap in the page heading.

Initial browser tests and server startup failed under sandbox restrictions; approved execution passed. The first unrestricted browser run exposed a missing JSON import attribute in the new fixture import. After correction all 10 tests passed. The separate walkthrough also required approved execution because the sandbox blocked Chromium. The initial GitHub PR lookup hit restricted networking; the approved lookup succeeded.

Style choices: keep existing double-quoted formatting, React component capitalization/default App export, concise JSX handlers and inferred Zod schema types for repository consistency and framework readability. New shared functions use named exports. These are deliberate exceptions to the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), without unrelated style rewrites.

Real-device touch, screen readers, other browser engines and 200% browser zoom remain unverified. Follow the [manual guide](manual-verification.md) for those checks. Local testing provides no evidence of production authorization, offline operation or 800-user capacity.

## Historical T0001 verification

The earlier T0001 implementation and ESLint 10 tooling update passed type checking, lint, 20 focused tests, the build and 3 browser tests. Its browser walkthrough covered desktop contestant/jury views, volunteer screens at both phone widths, keyboard entry points, refresh, privacy and reset. That run also reported zero dependency audit vulnerabilities. These are historical observations; the T0002 results above describe this run. No dependency changes or new dependency audit were performed for T0002.

## Limitations and next work

The demo uses one tab and one local dataset. It does not synchronize concurrent tabs and devices. Browser storage may be cleared or unavailable. Device-clock changes affect running timers. The demo rejects backwards action timestamps. Simulated roles are not authorization, and local history is editable browser data.

Persona/filter selections reset on refresh. These checks establish no production security, offline operation, or 800-user capacity.

T0002 retains one award per issue, even after reopening; award adjustments and role editors remain deferred. [T0003](tickets.md#t0003--cloud-onboarding-and-authenticated-shared-product) now scopes cloud onboarding, authenticated shared workflows, role dashboards, minimal admin controls and contributor setup. Its planning changes were prepared on updated `main`; no application code or provider resources were changed. The [onboarding guide](cloud-onboarding.md) distinguishes setup tasks from completed work.

The user explicitly chose cloud features first and deferred outage/resilience work. Free tiers are preferred; necessary paid services are acceptable after identifying the cost and reason. Helpers' issue-linked images and configurable volunteer upload permissions are recorded for the next candidate alongside broader admin tools. Attachment visibility and setting scope/defaults remain undecided. No T0004 is created. UI redesign, notifications, CSV imports and shared incidents remain deferred.
