---
title: Prepare an independent installation
description: Prepare an isolated Cloudflare application with its own accounts, database, and private images.
---

:::note[Verified development installation]
T0020's complete hosted procedure passed on 18 October 2026 at source `25b2033`.
The isolated trial checked the full React workflow, private images, live updates, owner recovery, and fixture cleanup.
Use new isolated resources. Production capacity and real-data migration remain unverified.
Supabase remains the project's active development backend.
:::

## Prepare the checkout and provider access

Select the reviewed source revision that contains T0020.
Record its commit ID with `git rev-parse HEAD`.
Use Node.js 22.22 or later within 22.x, or Node.js 24 or later.
Install the locked dependencies with `npm ci`.

The Cloudflare application uses one Worker, D1 database, private R2 bucket, and Durable Object namespace.
It serves its frontend and API from the same HTTPS origin.
Workers Paid and R2 must already be active in the selected account.
Review provider costs before activation.
The repository does not activate paid services.

```sh
npx wrangler whoami
```

Confirm the account before creating resources.
If login is missing, run `npx wrangler login`, then repeat the account check.

## Follow the provider-owned procedure

Read `docs/install-cloudflare.md` in the same reviewed checkout.
That guide supplies exact commands, expected results, target checks, costs, and failure recovery.
Keep that guide open throughout installation.

Complete its steps in this order:

1. Create a provisioning configuration with your confirmed account ID.
2. Create a new D1 database and record its UUID.
3. Set the public provider and competition JSON files. Keep credentials outside them.
4. Run `npm run cloudflare:install -- plan` with the guide's explicit settings and configuration paths.
5. Generate and review the complete Worker configuration.
6. Create the new private R2 bucket and apply the schema to the confirmed D1 target.
7. Build with `VITE_BACKEND=cloudflare`, inspect the dry run, and deploy the isolated Worker.
8. Bootstrap the empty competition database, then create its initial private secret.
9. Open the private credential file and change the owner's temporary password through the application.
10. Complete the guide's authenticated workflow, image, live-update, revocation, and owner-recovery checks.

Use your generated configuration for every provider command.
The root Wrangler configuration targets the original development frontend.
The installer rejects existing application records instead of deleting them.
It leaves contestant intake closed.

## Preserve credentials and verification evidence

Bootstrap saves one-time credentials to a new file outside the checkout with mode `0600`.
Do not print its contents, include it in a report, or commit it.
Retain a failed operation's private result until you establish its outcome.
Use the documented owner-recovery command if a bootstrap or recovery committed without a usable response.
Recovery retains account IDs, memberships, and history.

Record the source revision, deployed version, target IDs, and each observed result.
A login page or passing database test does not prove the full installation.
Use the [verification guide](/operators/verification/) to distinguish completed checks from pending checks.

[PR #21](https://github.com/GiftedNovaHD/minsky/pull/21) contains earlier installation scaffolding.
T0020 reuses its suitable configuration checks and bootstrap safeguards.
It replaces its Supabase-specific installation code.
The PR remains open for the owner's disposition decision.
The T0020 component record recommends that the owner close PR #21 as superseded for Cloudflare installation.
Container packaging, AWS, Terraform, and real-data migration remain outside this procedure.
