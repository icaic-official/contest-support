# Code quality and review

The user selected mandatory CI, a short PR review checklist, and secret/dependency
scanning on 2026-10-02. These changes extend T0003. The user reviews and merges;
cloud deployment and branch-preview automation remain separate setup work.

## Automated checks

Pull requests and pushes to `main` run these check names:

| Check | Required behavior |
| --- | --- |
| `checks` | Type checking, ESLint, Deno function checking, focused/database tests, build and public landing/login browser tests must pass. |
| `secrets` | Gitleaks scans fetched Git history, including secrets removed in later commits. Findings are redacted; any finding fails the check. |
| `dependencies` | `npm audit --package-lock-only --audit-level=high` checks locked runtime and development dependencies. High/critical advisories fail the check; lower severities remain visible for review. Registry failures also fail the check. |

Security checks also run weekly on the default branch and can be dispatched
manually. The weekly schedule and Dependabot updates take effect after their
configuration reaches `main`. Dependabot proposes weekly npm and GitHub Actions
updates, with at most three open update PRs per ecosystem. Updates require the
same checks and review as other changes. Nothing automatically applies upgrades
or runs `npm audit fix`.

Workflows use read-only repository permissions, pinned action commits, job timeouts
and credential-free checkout. Gitleaks uses a pinned, checksum-verified binary.
PR security jobs do not use cloud credentials or execute package install scripts.
The privileged cloud integration job remains manually dispatched against the
separate, protected `cloud-test` project; it is not a routine required PR check.

Run the usual README checks locally. With Gitleaks 8.30.1 installed, scan history
using `gitleaks git --redact --log-opts=--all .`. This checks committed history;
review uncommitted files before committing. If a real secret is detected, revoke
or rotate it and follow the provider's incident steps. Removing its current file
does not remove it from Git history. Investigate false positives and document any
narrow exception; do not suppress whole secret classes or all historical findings.

## Human review

[The PR template](../.github/pull_request_template.md) covers scope, readability,
authorization/privacy, workflow semantics, migration compatibility, verification
and documentation. Checkboxes record review; they do not automatically verify it.
Apply the same checklist to existing PRs, which do not receive new templates
retroactively. The Google TypeScript style policy and manual interface checks in
AGENTS.md still apply.

## Owner setup for mandatory merges

The user deferred remote merge enforcement and vulnerability-alert setup on 2026-10-02 and moved these scope notes from T0004 to T0005 on 2026-10-03. The existing checks and prepared configuration remain in T0003; the owner steps below have not been completed. Protected cloud integration CI environment setup remains a separate T0003 requirement.

Repository inspection on 2026-10-02 confirmed that the available account,
`GiftedNovaHD`, has write access but no administration access. No repository
rulesets were returned. The branch-protection lookup returned HTTP 404; with these
permissions this does not establish whether a protection rule already exists.
Remote enforcement has not been configured by this change.

The repository owner must review existing protections, then configure `main` to:

- Require pull requests and one independent approving review.
- Dismiss approvals when reviewable changes arrive and resolve review threads.
- Require `checks`, `secrets` and `dependencies` from GitHub Actions, with the
  branch up to date before merging.
- Apply protection to administrators and disallow force pushes and deletion.

After the new checks have appeared on PR #2, apply the settings in GitHub's
branch-protection UI. Alternatively, an authenticated repository administrator
can use the prepared payload **after reconciling it with existing rules**:

```sh
gh api --method PUT repos/notbowen/minsky/branches/main/protection \
  --input .github/main-protection.json
gh api --method GET repos/notbowen/minsky/branches/main/protection
gh api --method PUT repos/notbowen/minsky/vulnerability-alerts
```

The payload replaces branch protection; preserve any stricter existing settings.
Check sources are bound to GitHub Actions app ID `15368`, verified from the
existing PR check runs. See [GitHub's branch-protection API](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).
The final command enables Dependabot vulnerability alerts, separately from update
PRs. The owner can also enable alerts in Settings → Advanced Security. Native
secret scanning/push protection and dependency review have private-repository plan
requirements; do not enable paid upgrades implicitly. The committed Gitleaks and
npm audit jobs work without those features. CI secret scanning catches committed
secrets after push; it is not GitHub push protection.

If the owner's GitHub plan does not support protection for this private repository,
record that limitation and the concrete upgrade cost before selecting a paid plan.
Do not claim merge enforcement until the owner verifies the remote rules.
