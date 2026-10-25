# Supabase provider records

These dated records moved from the Supabase provider guide and the former Supabase workflow verification guide on 2026-10-24.
They describe earlier setups. They are not current instructions.
On 2026-10-25 the owner removed the Supabase implementation and its guide.

## Retirement of the project's Supabase projects, 2026-10-24

On 2026-10-24 the owner decided that the project no longer operates Supabase projects.
The adapter code, migrations, functions, and local tests stay. Readers run the adapter on their own projects.
The change removed `npm run test:hosted`, `scripts/cloud-smoke.mjs`, `cloud:link`, `cloud:functions`, and the Supabase static upload path in `scripts/deploy-workers.mjs`.
It changed no hosted resource, secret, or repository setting. The owner deletes these resources separately:

| Project | Reference | Use before retirement |
| --- | --- | --- |
| `Minsky` | `ovymmobupzowotvrywek` | Shared development project for Supabase contributor work and trial accounts. It stopped serving the development URL when Cloudflare became the live backend on 2026-10-23. |
| `Minsky CI` | `ghtztmovdkhuketcbjmq` | Isolated fixtures for the hosted Supabase suites. |

The hosted test guards still refuse `ovymmobupzowotvrywek` while that project exists, because it holds trial accounts.
The GitHub repository still holds the `SUPABASE_*` secrets of the retired `cloud` job. No workflow reads them.

### Last recorded state of `Minsky` development

- T0005, 2026-10-11: the user authorized use of the development project for the T0005 preview. The attachment migration and the `admin` and `attachments` functions were applied to `Minsky`. `Minsky CI` stayed unchanged at that time.
- The function setting was `ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:4174`. The stable Cloudflare URL did not need a Supabase origin.
- The project already had an admin. The bootstrap command was not to run there again.
- Contributors linked their primary checkout to `Minsky` with `npm run cloud:link`. `npm run cloud:functions` deployed `admin`, `attachments`, and `announcement-images` to it.

### Last recorded state of `Minsky CI`

- As of 2026-10-17, the merged T0005 image migrations and the `admin` and `attachments` functions were installed.
- That preparation kept migration version `202610110002` from closed PR #20. Its file is not in `main`.
- On 2026-10-17 the project also ran an `announcement-images` function from PR #20, version 3.
- No record shows migration `202610240001_announcements.sql` or the PR #62 version of `announcement-images` there. That migration creates `public.announcements` without `if not exists`.
- Contributors ran CI commands from a separate checkout linked to `Minsky CI`. They used explicit `--project-ref ghtztmovdkhuketcbjmq` commands for `config push`, `db push`, `functions deploy`, and `secrets set ALLOWED_ORIGINS=http://127.0.0.1:4174`.
- The shared workflow migrations `202610180001_shared_workflow.sql` and `202610180002_shared_workflow_expiry.sql` and the `workflow` function were installed through a temporary operational directory. That directory fetched the remote migration records, so it kept the extra CI records. It added only the missing workflow migrations.
- `scripts/workflow-proof.mjs` and `tests/workflow/supabase.test.ts` accepted only this project until the retirement change.
- See the [T0014 verification record](run-log.md#t0014-existing-backend-verification-2026-10-17) for setup and recovery evidence.

### Retired legacy wrapper

`npm run test:hosted` ran the `test:cloud` fixtures against `https://minsky-dev.icaic-minsky.workers.dev`.
After Cloudflare activation on 2026-10-19, those Supabase fixtures could not verify that frontend.

## Ownership and cost decisions, 2026-10-02 to 2026-10-24

- On 2026-10-02 the user deferred records of provider ownership and billing. On 2026-10-03 the user moved these notes from T0004. They stayed deferred.
- The original T0003 pilot selected Supabase Free and Workers Free. It required no SMTP provider, image bucket, custom domain, R2, or AWS account.
- Later Cloudflare work activated Workers Paid and R2 after the password-hashing requirement and cost were recorded. The owner limited verification to the existing US$5 monthly plan.
- Before a paid upgrade, the rule was to record the concrete blocker, current cost, and expected monthly spend.

## T0004 deployment exception, 2026-10-03

The user's "Deploy first" instruction authorized frontend deployment to the existing `minsky-dev` Worker before merge.
That deployment and all 12 hosted cases passed.
[Run log](run-log.md#t0004-development-deployment-2026-10-03) records the revision, version, and asset checks.
No database migration or account-function deployment was necessary.
The user merged [PR #9](https://github.com/notbowen/minsky/pull/9) on 2026-10-11 (SGT).
The [merge record](run-log.md#t0004-merge-and-documentation-follow-up-2026-10-11) identifies its revision and timestamp.

## Historical T0005 Worker preview, 2026-10-11

The approved T0005 preview used `https://t0005-minsky-dev.icaic-minsky.workers.dev` with the `Minsky` Supabase accounts, database, and Storage.
Its functions allowed that exact origin alongside the main and local origins.
That frontend preview did not isolate backend changes or data.
The old `deploy:preview` script was removed. Do not use an assets-only preview upload against the complete application Worker.
Current app previews remain disabled until independent resources exist. Follow [deployment setup](../cloudflare-builds.md).
The attachment migration checks that Supabase already enabled Storage RLS rather than altering its managed table.

## Initial completion record (2026-10-02)

These notes describe the initial setup. Later verification records supersede their pending status claims.
Use [run log](run-log.md) for current CI and deployment evidence.

- Supabase project: `Minsky`, URL `https://ovymmobupzowotvrywek.supabase.co`, reference `ovymmobupzowotvrywek`, organization `gayymsuhfqsboksikzwx`, Singapore region `ap-southeast-1`, PostgreSQL 17. Provider access and CLI login/link were independently verified in the initial implementation.
- Separate CI project: `Minsky CI`, URL `https://ghtztmovdkhuketcbjmq.supabase.co`, reference `ghtztmovdkhuketcbjmq`, organization `gayymsuhfqsboksikzwx`, Tokyo region `ap-northeast-1`, PostgreSQL 17. CLI verified `ACTIVE_HEALTHY`. All five migrations were applied without seeds; the admin function was deployed with server-side bundling and `ALLOWED_ORIGINS=http://127.0.0.1:4174`. Repository-owned Auth configuration was applied. No trial accounts or shared development records were copied.
- CI project verification: all 11 local cloud workflow/Auth/authorization cases passed with fixture teardown. This is project preparation evidence, not a protected GitHub Actions run. Detailed outcomes and the initial configuration failure are recorded in [run log](run-log.md#separate-ci-project-and-development-workflow-2026-10-02).
- Cloudflare account: `458ad6a930b0fb717796dfa19ca6a2b1`; Worker `minsky-dev` under `icaic-minsky.workers.dev`. Provider access and deployment were verified. Current deployment version and tests are in [run log](run-log.md).
- Initial development account identifier: `1b8c9cb2-f84c-4d13-92f9-b70088db38f8`. Trusted bootstrap verified existence and assigned the initial development event/session/three teams. The user subsequently confirmed signing into the hosted app. Their password was never requested or inspected. Assign a username through the app without recreating this account.
- Authentication settings: user reported Email enabled, public signup and anonymous sign-in disabled, email confirmation enabled and exact local/hosted redirects saved. Keep these settings; the trusted function confirms organizer-created internal identities.
- Historical migrations `202610020001_cloud.sql` through `202610020003_private_signals.sql` and the first bootstrap were applied without seeds. Both username/password migrations were applied without seeds, the account function was deployed, and all eight final hosted cases passed. Current deployment/version and detailed verification are recorded in current-state.md.
- SMTP: deliberately removed from T0003 requirements by the user. No sender domain or paid mail service was configured; prior SMTP blockers are historical.
- Ownership/billing: selected plans, organization owner, billing contact, recurring charges and receipt handling remain unverified. They stay deferred and are not part of the T0005 issue-image ticket. No paid upgrade was selected or payment action performed by the agent.
- Protected cloud CI (superseded on 2026-10-23, when the GitHub workflow was removed): remains in T0003. The separate test project is prepared; protected GitHub environment setup and the first protected cloud run remain pending, including owner access and default-branch workflow availability. Local runs against isolated fixtures are separate evidence.
