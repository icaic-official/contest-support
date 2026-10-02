# Cloud onboarding for T0003

Status: planning guide, checked against official documentation on 2026-10-02. No provider resources, account invitations, payments or deployments were performed during scoping. The application is still the local demo. T0003 must turn this guide into a tested walkthrough and record the actual setup outcomes. See [ticket scope and acceptance](tickets.md#t0003--cloud-onboarding-and-authenticated-shared-product).

## 1. Accounts and ownership

Create or select the Supabase organization and Cloudflare account that will own Minsky. Use individual provider logins and invite maintainers through the provider's membership controls; do not share an owner's password. Record the project owner and billing contact. Most contributors should work locally without provider-console access. Provider membership and Minsky contestant/staff/admin accounts are separate.

The user completes provider sign-in, account verification and any card entry directly on the provider website. Keep passwords, recovery codes, database credentials and API secrets out of chat, committed files and issue reports. Store billing receipts for reimbursement if a paid service becomes necessary.

## 2. Start with free plans

| Service | Initial choice | When to consider paying |
| --- | --- | --- |
| Cloudflare Workers | Free, with the supplied `workers.dev` hostname | Dynamic request/CPU limits obstruct the measured pilot workload. Paid Workers starts at USD 5/month plus applicable usage. |
| Supabase | One Free development project; local projects for contributors | Database, bandwidth or active-project limits become restrictive, or project inactivity pausing disrupts development. Pro starts at USD 25/month; extras may cost more. |
| Authentication email | Custom SMTP with a suitable free allowance and a verified sender | Recipient volume, sender requirements or delivery needs exceed the provider's free offering. Select the provider during onboarding. |
| Uploaded images | No bucket needed for T0003; Supabase Storage recommended for the attachment ticket | Review actual file volume and downloads when attachments are scoped. No R2 or AWS account is required now. |

Workers Free currently allows 100,000 dynamic requests/day with a 10 ms CPU limit per invocation. Static-asset requests are free and unlimited when served without invoking Worker code. These are distinct limits. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [limits](https://developers.cloudflare.com/workers/platform/limits/).

Supabase Free currently includes a 500 MB database per project, 1 GB file storage, 5 GB uncached plus 5 GB cached egress, and up to two active projects. Free projects can pause after one week of inactivity. These allowances do not establish capacity for a live contest. See [Supabase pricing](https://supabase.com/pricing).

Record the selected plans and review usage dashboards after initial testing. Before any paid upgrade, identify the actual blocker, current price, expected monthly cost and applicable usage controls. The user accepts necessary spending, but no paid upgrade is currently selected. A custom application domain is optional; authentication email may separately require a sender domain. Do not assume a spending control is an absolute bill cap.

## 3. Supabase setup

1. Create a development project on the Free plan. Choose a region close to the pilot users; Singapore is a candidate if the pilot is based there. Save the database password securely. Record the project reference and URL, not its secrets.
2. Enable email/password authentication and disable public signup for this organizer-provisioned product. Once URLs are known, configure the site URL and exact local/deployed invitation and recovery redirect URLs. Use the [password authentication guide](https://supabase.com/docs/guides/auth/passwords).
3. Configure custom SMTP and verify its sender. Supabase's default email service sends only to project-team addresses and currently allows two messages/hour. It cannot support normal pilot-user invitations/recovery. Test invitation, password setup and recovery with a recipient outside that provider team. See [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp).
4. During implementation, apply reviewed, repository-owned migrations and access policies using the Supabase CLI. Document the exact target selection and migration commands. Keep database changes reproducible rather than relying on unrecorded SQL edits in the dashboard. See [migration workflow](https://supabase.com/docs/guides/local-development/database-migrations).
5. Bootstrap the first application admin through the ticket's trusted command. Invite pilot accounts through the minimal admin UI after deployment. Local fixtures must never run automatically against the hosted database.
6. Test team/session isolation and private-note access through direct API requests as well as the UI. Row-level policies and transactional operations must enforce access independently of hidden controls. See [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 4. Cloudflare setup

1. Select Workers Free and a `workers.dev` subdomain in the owning account. Keep the existing React/Vite app; T0003 adds the Cloudflare Vite integration and repository deployment configuration. See [React on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/).
2. Authenticate the deployment CLI as a maintainer. Use a scoped deployment credential for trusted CI only if automated deployment is configured. Do not give contributors the account owner's credentials.
3. Separate frontend configuration (Supabase URL and publishable key) from server-only secrets. The privileged Supabase secret/service-role credential belongs only in the Worker secret store for authorized administration. Never place it in a `VITE_` variable. Ignore local Worker secret files and commit a placeholder example.
4. Run the implemented checks, apply compatible migrations and deploy the reviewed build. Record the tested command, URL and revision. Update Supabase authentication redirects to the actual URL, then run the hosted smoke test.
5. Verify that refresh on application routes works, privileged endpoints reject unauthorized callers, and two different logged-in browsers see shared updates. Keep the hosted environment visibly identified as development.

## 5. Contributor onboarding

T0003 must provide a tested fresh-clone sequence: install the documented Node/npm versions and a Docker-compatible runtime, run `npm ci`, start local Supabase, apply migrations and fictional seeds, create local test accounts, copy the environment example, and run the connected app and checks. The exact new npm script names will be documented when implemented; they do not exist yet. The [Supabase local CLI guide](https://supabase.com/docs/guides/local-development/cli/getting-started) describes the container requirement and local services, including email capture.

Commit the Supabase configuration, migrations, fictional seeds, environment examples, Worker configuration and CI workflow. Document how to create and test a new migration. PR checks should run against local disposable services and must not need hosted credentials. Keep preview deployments and untrusted branches away from shared-data writes.

## Completion record to fill during implementation

- Account/organization owner and billing contact: not configured.
- Supabase project reference, region and selected plan: not configured.
- Worker name, deployment URL and selected plan: not configured.
- SMTP provider, sender and actual cost: not selected.
- Bootstrap/admin onboarding and non-team email delivery: not verified.
- Fresh-clone setup, CI, deployed revision and hosted journey: not verified.
- Actual recurring charges: none incurred by this scoping run.
