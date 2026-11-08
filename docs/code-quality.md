# Code quality and review

This reference lists the checks, type rules, dependency policy, and review rules for Minsky.

## Automated checks

Workers Builds runs `npm run ci` for each push to a branch in this repository. A pull request from a fork starts no build, so run the command yourself.
The [CI reference](cloudflare-build-settings.md#workers-builds) owns the command list, limits, and on-demand checks.
`npm run ci` fails on type errors, lint errors, test failures, a failed build, a docs link error, a high or critical `npm audit` advisory, or any Gitleaks finding.
Its tests also fail on a D1 migration that drops or renames schema, because `main` publishes automatically. See [Change the D1 schema](cloudflare-builds.md#change-the-d1-schema).
Browser suites and hosted provider suites are on-demand commands. They are not required pull request checks.

### Type rules

`tsconfig.json` turns on `strict`, unused locals and parameters, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noImplicitReturns`, and `noUncheckedIndexedAccess`.

`noUncheckedIndexedAccess` gives `array[index]` and `record[key]` the type `T | undefined`. In application code, handle the missing value where it can occur:

- Destructure the first element (`const [first] = items`) and test it, instead of a length check followed by `items[0]`.
- Keep values that belong together in one object, instead of two arrays read with the same index.
- Where an index can only be in range, such as a matrix cell, read it through one local accessor that throws a `RangeError` for a missing value. Do not replace the value with a default.

Tests can use `value!` on fixture data. A missing value then fails the test.

The `no-unnecessary-condition` rule is not enabled. It reports correct checks of a React ref or a cleanup flag after an `await` as unnecessary.

`exactOptionalPropertyTypes` makes `prop?: T` mean that the key is absent or holds a `T`. An explicit `undefined` is then an error. Choose the declaration by meaning:

- Write `prop?: T | undefined` when a missing value and `undefined` mean the same thing, such as an optional component prop that a caller passes through.
- Write `prop: T | undefined` when every value has the key but it can be empty, such as a computed statistic or a hook result.
- For a library type, such as `RequestInit` or a Playwright option, leave the key out or pass the library's own empty value, such as `null`.
- For JSON that a zod schema parses, use `.exactOptional()` when the type must match a contract that declares `prop?: T`.

`npm run lint` also runs type-aware rules on `src/`, `tests/`, and the root configuration files.
These rules reject:

- non-null assertions (`value!`), in application code only,
- type assertions that do not change the type,
- type assertions on object literals (annotate the variable instead),
- values of type `any` that flow into assignments, arguments, calls, member access, or return values,
- a `switch` on a union that misses a member and has no `default`.

The vendored components in `src/components/ui/` keep only the syntactic rules.
When a value comes from outside the program, such as JSON, router state, or a library typed as `any`, narrow it with a check or give it a declared type at that boundary.
In a test, a cast of parsed data to the type that the test expects is enough, because the assertions that follow check it.
If an assertion is the only option, explain in a comment why it is safe.

## Dependency updates

Dependabot proposes weekly npm updates for the application and the documentation site.
It permits at most three open update pull requests per directory.
There is no scheduled scan. A week with no pushes is not scanned.
No process automatically applies upgrades or runs `npm audit fix`.
Updates require the same checks and review as other changes.

TypeScript major updates are ignored.
`typescript-eslint` 8.71 accepts TypeScript `>=4.8.4 <6.1.0`.
TypeScript 7 makes `npm ci` fail.
Patch and minor TypeScript updates remain enabled.

`package.json` overrides `undici` to `7.30.1`, because `undici` 7.29.1 has high-severity advisories (GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c).
Remove the override when the `miniflare` in `package-lock.json` depends on `undici` 7.30.1 or later. Then run `npm install` and `npm run ci`.
The locked `miniflare` meets that condition now, and the override is still in place.

## Secret scanning

`npm run ci` runs Gitleaks with pinned release 8.30.1 and a verified SHA-256 checksum. That binary supports only Linux x64.
The scan reads fetched Git history, including secrets that later commits removed. It redacts findings.
Ordinary builds do not receive cloud credentials.
The `minsky-dev` trigger runs `npm run ci` before `npm run deploy` in one build, so a failed check stops publication.
`npm run ci` removes the deployment token before it installs packages or runs checks.

With Gitleaks 8.30.1 installed, scan history with this command:

```sh
gitleaks git --redact --log-opts=--all .
```

This command checks committed history.
Review uncommitted files before you commit them.
`.gitignore` excludes local secret files: `.env*` (except `.env.example`) and `.dev.vars*`, which Wrangler reads next to each configuration.
If you detect a real secret, revoke or rotate it.
Then follow the provider's incident steps.
Deleting the current file does not remove the secret from Git history.

Investigate false positives.
Document any narrow exception.
Do not suppress whole secret classes or all historical findings.

`.gitleaksignore` records exact finding fingerprints for reviewed false positives.
Each entry covers one commit, file, rule, and line. Other findings, including new findings in the same file, still fail the scan.
These entries exist:

- `tests/support/announcementServer.ts:148` in commit `0e38d2b93eb9b066a4f4b45d9990c1f4d663199b` constructs a mock Auth token with a fixed JWT header, a generated fixture payload, and a literal `.fixture` signature. It contains no provider credential or signing key.
- `docs/cloud-onboarding.md:83` in commit `b34c3a34e4869f74587d1d51753aeb1c8e2bc27d` contains a public user UUID. It is not a credential.

## Cursor cloud agents

Cursor runs `.cursor/install.sh` when a saved environment uses `.cursor/environment.json`.
The script installs the root lockfile and the `site` lockfile with `npm ci`.
It then installs Playwright Chromium and the system libraries used by browser tests.
You can run the script again on a prepared machine. `npm ci` reinstalls from the lockfiles.
The script does not start the app, deploy it, or read secrets.
The machine must already have Node.js 22.22 or later within 22.x, or Node.js 24 or later. The script does not install Node.js.

## Human review

[The pull request template](../.github/pull_request_template.md) covers scope, readability, authorization, privacy, workflow behavior, migration compatibility, verification, and documentation.
Checkboxes record review.
They do not automatically verify a change.
Apply the same checklist to existing pull requests.
New templates do not automatically appear in existing pull requests.
The Google TypeScript style policy and manual interface checks in [AGENTS.md](../AGENTS.md) also apply.

## Merge enforcement

Merge enforcement is not active. Do not claim it until an administrator verifies the remote rules.

`.github/main-protection.json` records the intended protection for `main`. The file is not applied.
The repository is private and on GitHub Free, and GitHub Free does not support branch protection or rulesets on a private repository.
These facts change when the repository becomes public. [GitHub Free supports protected branches on public repositories](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), so an administrator can then apply the file.

The file records these requirements:

- Require pull requests and one independent approving review.
- Dismiss approvals when reviewable changes arrive.
- Require resolution of review threads.
- Require the status check `Workers Builds: minsky-ci`. The check entry omits the app ID.
- Require the branch to be current before merge.
- Apply protection to administrators.
- Prohibit force pushes and branch deletion.

Do not send this payload while the plan does not support it. When the plan or the visibility supports branch protection, an administrator can apply the file with these commands:

```sh
gh api --method PUT repos/GiftedNovaHD/minsky/branches/main/protection \
  --input .github/main-protection.json
gh api --method GET repos/GiftedNovaHD/minsky/branches/main/protection
gh api --method PUT repos/GiftedNovaHD/minsky/vulnerability-alerts
```

The payload replaces branch protection. Before you use it, reconcile it with existing rules and preserve any stricter settings.
See [GitHub's branch-protection API](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).

The final command enables Dependabot vulnerability alerts separately from update pull requests.
An administrator can also enable alerts in **Settings > Advanced Security**.

Native secret scanning, push protection, and dependency review have plan requirements for private repositories.
Do not enable paid upgrades implicitly. Check those requirements again when the visibility changes.
The committed Gitleaks and npm audit commands work without those features.
CI secret scanning detects committed secrets after push.
It does not provide GitHub push protection.
