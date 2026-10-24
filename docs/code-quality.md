# Code quality and review

On 2026-10-02, the user selected mandatory CI, a short PR review checklist, and scans for secrets and dependencies.
These changes extend T0003.
The user reviews and merges.
Workers Builds publishes `main` to the `minsky-dev` development application after the checks pass in the same build.
[Publish the application](cloudflare-builds.md#publish-the-application) describes that trigger.

## Automated checks

Workers Builds runs `npm run ci` for each push to a branch in this repository.
The [CI reference](cloudflare-build-settings.md#workers-builds) owns the command list, limits, and on-demand checks.
`npm run ci` fails on type errors, lint errors, test failures, a failed build, a docs link error, a high or critical `npm audit` advisory, or any Gitleaks finding.
Browser suites and hosted provider suites are on-demand commands. They are not required PR checks.
`npm run ci` keeps the Supabase adapter checks: Deno function checks and tests, and embedded-PostgreSQL migration and policy tests. They need no Supabase project.
The project operates no Supabase project. Hosted Supabase suites run only against a project that the person running them owns.

## Dependency updates

Dependabot proposes weekly npm updates for the application and the documentation site.
It permits at most three open update PRs per directory.
The GitHub Actions ecosystem is not monitored. The repository has no Actions workflow.
There is no scheduled scan. A week with no pushes is not scanned.
No process automatically applies upgrades or runs `npm audit fix`.
Updates require the same checks and review as other changes.

TypeScript major updates are ignored.
`typescript-eslint` 8.71 accepts TypeScript `>=4.8.4 <6.1.0`.
TypeScript 7 makes `npm ci` fail.
Patch and minor TypeScript updates remain enabled.

`package.json` overrides `undici` to `7.30.1`.
`miniflare`, through `wrangler`, pins `undici` 7.29.1, which has high-severity advisories (GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c).
The override was added on 2026-10-24.
Remove it when the installed `miniflare` depends on `undici` 7.30.1 or later. Then run `npm install` and `npm run ci`.

## Secret scanning

Gitleaks uses pinned release 8.30.1 and a verified SHA-256 checksum.
The scan reads fetched Git history, including secrets that later commits removed. It redacts findings.
Ordinary builds do not receive cloud credentials.
The `minsky-dev` trigger runs `npm run ci` before `npm run deploy` in one build, so a failed check stops publication.
`npm run ci` removes the deployment token before it installs packages or runs checks.

Run the usual README checks locally.
With Gitleaks 8.30.1 installed, scan history with this command:

```sh
gitleaks git --redact --log-opts=--all .
```

This command checks committed history.
Review uncommitted files before you commit them.
If you detect a real secret, revoke or rotate it.
Then follow the provider's incident steps.
Deleting the current file does not remove the secret from Git history.

Investigate false positives.
Document any narrow exception.
Do not suppress whole secret classes or all historical findings.

`.gitleaksignore` records exact finding fingerprints for reviewed false positives.
The browser fixture in commit `0e38d2b93eb9b066a4f4b45d9990c1f4d663199b`,
`tests/support/announcementServer.ts:148`, constructs a mock Auth token with a
fixed JWT header, a generated fixture payload, and a literal `.fixture` signature.
Its mocked requests target `example.supabase.co`; it contains no provider credential
or signing key. Scans of all fetched history include this announcements-branch commit,
even on dependency PRs. The exception covers only that commit, file, rule, and line.
Other findings, including new findings in the same file, still fail the scan.

## Prepare a Cursor cloud agent

Cursor runs `.cursor/install.sh` when a saved environment uses `.cursor/environment.json`.
The script installs the root lockfile and the `site` lockfile with `npm ci`.
When `deno` is missing from `PATH`, the script copies the Deno 2.9.6 binary from that locked package to `/usr/local/bin`.
It then installs Playwright Chromium and the system libraries used by browser tests.
Run the script again on a prepared machine. `npm ci` reinstalls from the lockfiles, and the Deno copy is skipped when `deno` already runs.
The script does not start the app, deploy it, or read secrets.
The machine must already have Node.js 22.22 or later, or Node.js 24. The script does not install Node.js.

## Human review

[The PR template](../.github/pull_request_template.md) covers scope, readability, authorization, privacy, workflow behavior, migration compatibility, verification, and documentation.
Checkboxes record review.
They do not automatically verify a change.
Apply the same checklist to existing PRs.
New templates do not automatically appear in existing PRs.
The Google TypeScript style policy and manual interface checks in AGENTS.md still apply.

## Owner setup for mandatory merges

On 2026-10-02, the user deferred remote merge enforcement and setup of vulnerability alerts.
On 2026-10-03, the user moved these scope notes from T0004.
They stay deferred.
The owner steps below remain incomplete.
Hosted provider checks are on-demand commands. No protected GitHub environment runs them.

Repository inspection on 2026-10-02 confirmed that `GiftedNovaHD` had write access without administration access.
The lookup returned no repository rulesets.
The branch-protection lookup returned HTTP 404.
With these permissions, that response does not establish whether a protection rule already exists.
This change did not configure remote enforcement.

`.github/main-protection.json` records the intended protection for `main`.
The repository is private, and the owner keeps GitHub Free.
GitHub Free does not support branch protection or rulesets on a private repository.
The file is not applied.
The required status check is `Workers Builds: minsky-ci`.
The check entry omits the app id.

The file records these requirements:

- Require pull requests and one independent approving review.
- Dismiss approvals when reviewable changes arrive.
- Require resolution of review threads.
- Require the status check `Workers Builds: minsky-ci`.
- Require the branch to be current before merge.
- Apply protection to administrators.
- Prohibit force pushes and branch deletion.

While the repository stays on GitHub Free, do not send this payload.
When the plan supports branch protection for this private repository, an administrator can apply the file.
Before you use it, reconcile it with existing rules.

```sh
gh api --method PUT repos/GiftedNovaHD/minsky/branches/main/protection \
  --input .github/main-protection.json
gh api --method GET repos/GiftedNovaHD/minsky/branches/main/protection
gh api --method PUT repos/GiftedNovaHD/minsky/vulnerability-alerts
```

The payload replaces branch protection.
Preserve any stricter existing settings.
See [GitHub's branch-protection API](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).

The final command enables Dependabot vulnerability alerts separately from update PRs.
The owner can also enable alerts in **Settings → Advanced Security**.

Native secret scanning, push protection, and dependency review have plan requirements for private repositories.
Do not enable paid upgrades implicitly.
The committed Gitleaks and npm audit commands work without those features.
CI secret scanning detects committed secrets after push.
It does not provide GitHub push protection.

Do not claim merge enforcement until the owner verifies the remote rules.
