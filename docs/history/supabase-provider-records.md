# Supabase provider records

These dated records moved from the [Supabase provider guide](../supabase-provider.md) on 2026-10-24.
They describe earlier setups. They are not current instructions.

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
