---
title: Install an isolated Cloudflare instance
description: Install the complete Cloudflare application with its own accounts, database, private images, and live updates.
---

This guide installs Minsky into new Cloudflare resources from a reviewed checkout.
It covers configuration, deployment, the first owner, verification, and recovery.
Supabase remains the project's active development backend.

:::note[Development installation]
The empty-installation procedure passed on 18 October 2026 at source `2b6f6f0`.
The trial checked the complete React workflow, first-owner password gates, trusted owner recovery, and scoped cleanup.
See the [dated evidence](https://github.com/GiftedNovaHD/minsky/blob/main/docs/current-state.md#fresh-installation-after-review-fixes) for the tested source, resources, and results.
This procedure does not establish production capacity or real-data migration.
:::

## Prepare the tools and account

You need these prerequisites:

- A separate checkout of the reviewed Minsky revision.
- Bash, npm, and Node.js 22.22 or later within 22.x, or Node.js 24 or later.
- Cloudflare account access for Workers, D1, R2, and Durable Objects.
- An activated Workers Paid subscription and activated R2 service.
- A browser and a private local editor or password manager for the generated credentials.

The generated Worker requests a 1,000 ms CPU cap.
Measured password hashing exceeds the Workers Free allowance.
Workers Paid starts at US$5 per account per month.
Usage above its included allowances costs more.
See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and the [password measurements](https://github.com/GiftedNovaHD/minsky/blob/main/docs/cloudflare-authentication-choice.md).
Review [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), and [Durable Object](https://developers.cloudflare.com/durable-objects/platform/pricing/) usage charges too.
No repository command activates or upgrades a subscription.

From the checkout root, install the locked tools:

```sh
npm ci
node --version
npx wrangler --version
unset CLOUDFLARE_ENV
export WRANGLER_LOG_SANITIZE=true WRANGLER_WRITE_LOGS=false WRANGLER_SEND_METRICS=false
npx wrangler whoami
```

Use this shell for the remaining commands.
The environment settings prevent inherited target selection and private Wrangler log files.
The lockfile pins Wrangler and the password implementation.
Confirm that `whoami` lists the intended account.
If you lack a current login, run `npx wrangler login`, then repeat `whoami`.
Do not paste provider tokens into command arguments, source files, or bug reports.

## Select independent resources

Use names that do not identify an existing deployment or verification resource.
Keep this installation separate from development, CI, and future production resources.

Prepare the public configuration files:

```sh
mkdir -p .wrangler/installation
cp src/server/adapters/cloudflare/tooling/provision.example.jsonc .wrangler/installation/provision.jsonc
cp src/server/adapters/cloudflare/tooling/provider.example.json .wrangler/installation/provider.json
cp src/server/adapters/cloudflare/tooling/competition.example.json .wrangler/installation/competition.json
```

Set `account_id` in `provision.jsonc` to the account you confirmed.
This file selects the account before the new database has an ID.
Keep the root development Wrangler configuration unchanged.
Wrangler gives a configuration's account ID priority over the account environment variable.

For the commands below, set these public values:

```sh
MINSKY_INSTALL_ACCOUNT_ID='REPLACE_WITH_CONFIRMED_ACCOUNT_ID'
MINSKY_INSTALL_DATABASE='fictional-competition-database'
MINSKY_INSTALL_BUCKET='fictional-competition-images'
MINSKY_INSTALL_ORIGIN='https://fictional-competition-app.REPLACE_ACCOUNT_SUBDOMAIN.workers.dev'
MINSKY_INSTALL_CONFIG="$PWD/.wrangler/installation/wrangler.jsonc"
```

Replace every placeholder before continuing.
Use a new Worker name such as `fictional-competition-app`.
Cloudflare's account subdomain appears in the account's Workers settings.
This procedure uses the generated `workers.dev` address and needs no purchased domain.

Confirm the provisioning account, then create the empty D1 database:

```sh
npx wrangler whoami --config=.wrangler/installation/provision.jsonc
npx wrangler d1 create "$MINSKY_INSTALL_DATABASE" --config=.wrangler/installation/provision.jsonc --update-config=false
```

For an APAC installation, add `--location=apac` to the creation command.
A [D1 location hint](https://developers.cloudflare.com/d1/configuration/data-location/#provide-a-location-hint) requests a region. It does not guarantee a physical location.
The creation result gives the new database UUID.
Record that UUID in a public shell variable:

```sh
MINSKY_INSTALL_DATABASE_ID='REPLACE_WITH_NEW_DATABASE_UUID'
```

Confirm the database name, UUID, and actual serving region:

```sh
npx wrangler d1 info "$MINSKY_INSTALL_DATABASE" --config=.wrangler/installation/provision.jsonc --json
npx wrangler d1 execute "$MINSKY_INSTALL_DATABASE" --config=.wrangler/installation/provision.jsonc --remote --command='SELECT 1' --json
```

The metadata must match the new UUID. The query metadata reports `served_by_region` and `served_by_primary`.
The APAC trial reports `APAC` and `true`. This read creates no application records.

Edit `provider.json` with these exact settings:

| Field | Value |
| --- | --- |
| `accountId` | The confirmed account ID. |
| `workerName` | The new Worker name from the origin. |
| `databaseName` | `MINSKY_INSTALL_DATABASE`. |
| `databaseId` | `MINSKY_INSTALL_DATABASE_ID`. |
| `bucketName` | `MINSKY_INSTALL_BUCKET`. |
| `origin` | `MINSKY_INSTALL_ORIGIN`, without a trailing slash or path. |
| `placementRegion` | Optional. A supported Cloudflare placement region near the D1 primary, such as `aws:ap-southeast-1` for Singapore. |

The six required values and optional region are public settings.
Do not add credentials to this file.
The validator rejects placeholders, unknown fields, and inconsistent `workers.dev` names.
Hosted operations require HTTPS.
The explicit `--local` option permits loopback origins for planning and configuration only.

Choose an explicit placement region when you know the database location.
For an APAC primary, `"placementRegion": "aws:ap-southeast-1"` selects Worker execution near Singapore.
The identifier selects a Cloudflare execution location. It does not create an AWS resource or require an AWS account.
Use a [supported placement region](https://developers.cloudflare.com/workers/configuration/placement/#specify-a-cloud-region) near your own database.
Do not copy the APAC choice for a database in another region.
If the location is unknown, omit `placementRegion` to use Smart Placement.
Smart Placement does not guarantee execution beside D1.

## Generate and review the configuration

Preview the configuration without contacting Cloudflare:

```sh
node src/server/adapters/cloudflare/tooling/install.mjs plan --settings=.wrangler/installation/provider.json --config="$MINSKY_INSTALL_CONFIG"
```

Expected output includes `"status": "plan_only"`, the selected target, and the required bindings.
Confirm the account, database UUID, names, and origin.
Then create the generated configuration:

```sh
node src/server/adapters/cloudflare/tooling/install.mjs configure --settings=.wrangler/installation/provider.json --config="$MINSKY_INSTALL_CONFIG"
```

Expected output is `Created the public Cloudflare configuration. No provider resources changed.`
The command refuses an existing destination file.
It configures D1, private R2 access, the live-update coordinator, static assets, and a recovery cron each minute.
An explicit `placementRegion` produces a `placement.region` setting for application requests.
Without that option, the generator enables Smart Placement.
Smart Placement analysis can take 15 minutes and requires traffic from multiple locations.
See [Cloudflare placement](https://developers.cloudflare.com/workers/configuration/placement/).
It disables preview URLs and includes no authentication secret.
Do not hand-edit bindings or add environment overrides.
If public settings need correction, generate a new configuration path and review that result.
If current operator commands reject an older configuration, regenerate it from the same public settings at a new path.
Review the account and resource IDs before using the new file. Current operator commands require this checkout's complete generated configuration.

Create the new R2 bucket through this explicit target:

```sh
npx wrangler r2 bucket create "$MINSKY_INSTALL_BUCKET" --config="$MINSKY_INSTALL_CONFIG" --update-config=false
```

The command must report the requested new bucket.
Keep public access disabled in the R2 dashboard.
Do not enable an `r2.dev` URL or attach a public custom domain to the bucket.
The application serves authorized image bytes through its Worker.

## Apply the schema and deploy the application

Apply the checkout's D1 migrations:

```sh
node src/server/adapters/cloudflare/tooling/install.mjs migrate --config="$MINSKY_INSTALL_CONFIG" --account="$MINSKY_INSTALL_ACCOUNT_ID" --database="$MINSKY_INSTALL_DATABASE_ID"
```

The command confirms current Wrangler access and the exact hosted database before mutation.
Expected output is `The operation completed for the confirmed Cloudflare account and database.`
It neither creates resources nor initializes the application account.

Build the Cloudflare frontend in this independent checkout:

```sh
VITE_BACKEND=cloudflare npm run build
npx wrangler deploy --config="$MINSKY_INSTALL_CONFIG" --dry-run
```

Review the Worker name, account, D1 UUID, R2 bucket, Durable Object binding, and asset output.
The dry run must complete before deployment.
Before the first deployment, open **Workers & Pages** in the confirmed account's dashboard.
Search for the exact `workerName` from `provider.json`.
That Worker must not exist.
If it exists, select a new name and matching origin, then generate and review a new configuration path.
Do not replace an existing Worker for this procedure.
The dry run checks the bundle and configuration; it does not establish that the Worker name is unused.
Then publish this isolated application:

```sh
npx wrangler deploy --config="$MINSKY_INSTALL_CONFIG"
```

The result must identify the Worker and origin selected above.
The static login page can load before account initialization.
Authentication remains unavailable until its private secret exists.

## Initialize the competition and first owner

Edit `competition.json` with the fictional event, session, categories, roster, and owner name.
Set the owner's username in `adminUsername`.
Usernames contain 3 to 32 lowercase letters, digits, underscores, or hyphens.
The first character must be a letter or digit.
The validator normalizes surrounding spaces and username case.
Names and locations must contain 1 to 200 characters without null bytes.
Category names and team names must be unique after trimming.
An empty roster is allowed, but the current application has no general roster editor.
Do not add a password or provider credential to the competition file.

Create a private directory outside the checkout:

```sh
MINSKY_INSTALL_PRIVATE_DIR="$(mktemp -d)"
chmod 700 "$MINSKY_INSTALL_PRIVATE_DIR"
```

Initialize the empty database and save the one-time result:

```sh
node src/server/adapters/cloudflare/tooling/install.mjs bootstrap --config="$MINSKY_INSTALL_CONFIG" --account="$MINSKY_INSTALL_ACCOUNT_ID" --database="$MINSKY_INSTALL_DATABASE_ID" --competition=.wrangler/installation/competition.json --credentials="$MINSKY_INSTALL_PRIVATE_DIR/owner.json"
```

Expected output is `The operation completed. Credentials were saved to the requested private file.`
The new file has mode `0600` and contains the owner credentials and installation IDs.
Open it with your private editor or password manager.
Do not print, upload, or commit its contents.

Bootstrap creates the identity, event, session, teams, administrator membership, and audit records atomically.
It leaves contestant intake closed and requires the owner to change the temporary password.
It refuses any existing application or identity records, including a partial foreign installation.
Repeated or concurrent initialization cannot create another installation.
The command never deletes data to make bootstrap succeed.
Bootstrap, recovery, and initial secret creation require the exact migration list from this checkout.
Missing or foreign migration versions stop those commands before an account or secret changes.

## Enable authentication

Create the initial authentication secret after bootstrap:

```sh
node src/server/adapters/cloudflare/tooling/install.mjs secret --config="$MINSKY_INSTALL_CONFIG" --account="$MINSKY_INSTALL_ACCOUNT_ID" --database="$MINSKY_INSTALL_DATABASE_ID"
```

The command confirms the account, database, and current Worker secret metadata.
It sends a new random `AUTH_SECRET` through private stdin.
It never prints the secret or places the secret in an argument or configuration file.
It refuses an existing `AUTH_SECRET` rather than rotating it.
Run initial secret creation from one operator process at a time.
If the Worker does not exist or secret metadata cannot be read, the command stops.
The application also rejects sign-in before an account exists, without writing password-attempt counters.
The installation commands force Wrangler log sanitization and disable its local debug files.
Inherited Wrangler logging settings cannot enable credential logging for these commands.

## Verify the new installation

Open the configured origin in a browser.
Sign in with the saved owner credentials.
Change the temporary password before accessing the session.
Confirm the event, session, categories, roster, and closed intake.

Confirm that a private source path returns HTTP `404`:

```sh
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' "$MINSKY_INSTALL_ORIGIN/.env"
```

The Worker checks every request before it serves static assets.
Private paths must not receive the application page.

Create separate fictional contestant, volunteer, specialist, and jury accounts through account administration.
Use separate browser profiles for the different accounts.
Each new account must change its temporary password.
Then complete these checks:

1. Open intake and submit a contestant issue. Refresh the browser and confirm its timer persists.
2. Claim the issue, request a specialist handoff, and confirm the owner remains until another specialist accepts.
3. Add a public reply and an internal note. Confirm the contestant sees only the public reply.
4. Upload a team-visible image and a staff-only image. Confirm the contestant can download only the team-visible image.
5. Resolve the issue, record an award, and separately confirm its external application. Reopen the issue and verify its retained owner and award.
6. Disconnect and reconnect a browser. Confirm its view refreshes after another account changes the issue.
7. Revoke an account's access. Confirm that account cannot read, write, download images, or retain authorized live access.
8. Exercise trusted owner recovery below. Confirm old sessions fail and the replacement password requires another change.

Record the reviewed revision, deployed Worker version, target IDs, results, and any failures.
A landing-page response or database-only check does not verify the complete connector.
The [shared provider guide](https://github.com/GiftedNovaHD/minsky/blob/main/docs/run-provider-tests.md) describes the repository's protected fictional fixtures.
Its Cloudflare target guard restricts automated runs to the dedicated connector CI resources.
Do not redirect that suite to an unrelated installation by bypassing its guard.

The repository's direct D1 suites use a separate database without a deployed Worker.
Their target guard refuses a live application database.
Scheduled notification delivery must not change transaction snapshots or create coordinators for database-only fixtures.
Use the [shared provider guide](https://github.com/GiftedNovaHD/minsky/blob/main/docs/run-provider-tests.md) for the exact CI commands and scoped recovery rules.

## Recover after installation failures

| Symptom | Action |
| --- | --- |
| Configuration or target checks fail | Correct the public settings or account access. Regenerate the configuration at a new path. No account initialization is required. |
| R2 creation reports error `10042` | Complete R2 activation in the selected account. Confirm whether the named bucket exists before retrying creation. |
| Migration command fails | Inspect the selected database's applied migration list. Do not reset the database or rerun bootstrap to repair a schema failure. |
| Secret command fails | Confirm that the selected Worker exists and secret metadata is readable. Check whether `AUTH_SECRET` already exists. The installation command does not rotate it. |
| Credential output already exists | Retain that file. Select a new private destination for a new operation. Existing files are never overwritten. |
| Bootstrap fails or its response is lost | Retain any private result file. Inspect the installation marker through trusted D1 access before another attempt. An existing marker requires owner recovery. |
| A full workflow fixture leaves a journal | Retain its reviewed repository configuration and IDs-only journal. Follow [scoped fixture recovery](https://github.com/GiftedNovaHD/minsky/blob/main/docs/run-provider-tests.md#recover-direct-d1-fixtures). Never reset the database. |

To inspect a possible committed bootstrap, run this read-only query:

```sh
npx wrangler d1 execute "$MINSKY_INSTALL_DATABASE" --remote --config="$MINSKY_INSTALL_CONFIG" --command='SELECT id, owner_account_id, event_id, session_id FROM installation'
```

A committed installation has one marker row.
The query exposes IDs, not passwords or hashes.
If the marker is absent but application or identity records exist, stop and inspect those records.
Bootstrap does not repair or remove partial foreign data.

## Recover the installation owner

For lost sole-owner credentials, record the marker's installation and owner IDs:

```sh
MINSKY_INSTALL_ID='REPLACE_WITH_INSTALLATION_UUID'
MINSKY_INSTALL_OWNER_ID='REPLACE_WITH_OWNER_ACCOUNT_UUID'
MINSKY_RECOVERY_PRIVATE_DIR="$(mktemp -d)"
chmod 700 "$MINSKY_RECOVERY_PRIVATE_DIR"
node src/server/adapters/cloudflare/tooling/install.mjs recover --config="$MINSKY_INSTALL_CONFIG" --account="$MINSKY_INSTALL_ACCOUNT_ID" --database="$MINSKY_INSTALL_DATABASE_ID" --installation="$MINSKY_INSTALL_ID" --owner="$MINSKY_INSTALL_OWNER_ID" --credentials="$MINSKY_RECOVERY_PRIVATE_DIR/owner-recovery.json"
```

The command requires trusted provider access and a new private output file.
It preserves the owner's ID, history, and memberships.
It does not enable a disabled owner or restore removed administrator membership.
The initial session must remain active.
Recovery revokes earlier sessions and requires a change of the replacement temporary password.
If recovery stops after revocation, the owner remains restricted.
A later trusted attempt with a new output file supersedes the interrupted operation.

Do not delete retained result files until you establish the operation's outcome and secure the current credentials.
The installer does not delete provider resources.
