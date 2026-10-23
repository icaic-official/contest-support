# Code quality and review

On 2026-10-02, the user selected mandatory CI, a short PR review checklist, and scans for secrets and dependencies.
These changes extend T0003.
The user reviews and merges.
The frontend deployment job waits for all three required checks.
[Deployment activation](cloudflare-builds.md) requires separate account setup.

## Automated checks

Repository branch pushes and fork pull requests run these checks.
Same-repository PRs use branch-push results and skip the duplicate jobs.
The [event reference](cloudflare-build-settings.md#events-and-prerequisites) records names and merge-commit coverage.

| Check | Required behavior |
| --- | --- |
| `checks` | Type checking, ESLint, Deno function checks, unit and database tests, both site builds, docs links, and both browser suites must pass. |
| `secrets` | Gitleaks scans fetched Git history, including secrets that later commits removed. It redacts findings. Any finding fails the check. |
| `dependencies` | `npm audit --package-lock-only --audit-level=high` checks locked runtime and development dependencies. High and critical advisories fail the check. Lower severities remain visible for review. Registry failures also fail the check. |

The security jobs now run in `Checks`, alongside `checks`. Their required status names stay the same.
Security checks also run weekly on the default branch.
Manual dispatch runs all checks and the separate protected cloud job. It does not publish either frontend.
The weekly schedule and Dependabot updates take effect after their configuration reaches `main`.
Dependabot proposes weekly npm and GitHub Actions updates.
It permits at most three open update PRs per ecosystem.
TypeScript major updates are ignored.
`typescript-eslint` 8.71 accepts TypeScript `>=4.8.4 <6.1.0`.
TypeScript 7 makes `npm ci` fail.
Patch and minor TypeScript updates remain enabled.
Updates require the same checks and review as other changes.

No process automatically applies upgrades or runs `npm audit fix`.
Workflows use repository permissions that permit reading only, pinned action commits, job timeouts, and checkout without retained credentials.
Gitleaks uses a pinned binary with a verified checksum.
PR security jobs do not use cloud credentials or execute package install scripts.
The privileged cloud integration job requires manual dispatch against the separate, protected `cloud-test` project.
It is not a routine required PR check.
On trusted branch pushes, `deploy` waits for `checks`, `secrets`, and `dependencies` to pass.
The workflow publishes previews for feature branches and stable sites for `main`.
Pull requests, forks, and Dependabot do not receive deployment credentials.
Disabling independent Cloudflare Git builds prevents a second deployment path that skips these CI prerequisites.

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
They are not part of the T0005 issue-image ticket.
Existing checks and prepared configuration remain in T0003.
The owner steps below remain incomplete.
Setup of the protected cloud integration CI environment remains a separate T0003 requirement.

Repository inspection on 2026-10-02 confirmed that `GiftedNovaHD` had write access without administration access.
The lookup returned no repository rulesets.
The branch-protection lookup returned HTTP 404.
With these permissions, that response does not establish whether a protection rule already exists.
This change did not configure remote enforcement.

The repository owner must first review existing protections.
Then configure `main` with these requirements:

- Require pull requests and one independent approving review.
- Dismiss approvals when reviewable changes arrive.
- Require resolution of review threads.
- Require `checks`, `secrets`, and `dependencies` from GitHub Actions.
- Require the branch to be current before merge.
- Apply protection to administrators.
- Prohibit force pushes and branch deletion.

After the new checks appear on PR #2, apply the settings in GitHub's branch-protection UI.
An authenticated repository administrator can also use the prepared payload.
Before you use it, reconcile it with existing rules.

```sh
gh api --method PUT repos/GiftedNovaHD/minsky/branches/main/protection \
  --input .github/main-protection.json
gh api --method GET repos/GiftedNovaHD/minsky/branches/main/protection
gh api --method PUT repos/GiftedNovaHD/minsky/vulnerability-alerts
```

The payload replaces branch protection.
Preserve any stricter existing settings.
Check sources use GitHub Actions app ID `15368`.
Existing PR check runs verified this ID.
See [GitHub's branch-protection API](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).

The final command enables Dependabot vulnerability alerts separately from update PRs.
The owner can also enable alerts in **Settings → Advanced Security**.

Native secret scanning, push protection, and dependency review have plan requirements for private repositories.
Do not enable paid upgrades implicitly.
The committed Gitleaks and npm audit jobs work without those features.
CI secret scanning detects committed secrets after push.
It does not provide GitHub push protection.

If the owner's GitHub plan does not support protection for this private repository, record the limitation.
Record the concrete upgrade cost before you select a paid plan.
Do not claim merge enforcement until the owner verifies the remote rules.
