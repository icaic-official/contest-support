# Current state

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

These operational items stay deferred.
They are not part of T0005:

- Provider ownership and billing records.
- GitHub merge enforcement and vulnerability alerts.
- Remaining user and manual acceptance checks.

Older reports below describe their recorded revisions.
Use this status when an older report still says that T0005 is unimplemented or that PR #13 is open.

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
The manual steps are in [manual verification](manual-verification.md#10-team-search).
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
