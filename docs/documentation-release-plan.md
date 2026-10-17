# Documentation release plan and audit

## Decision and scope

On 2026-10-17, the user required documentation suitable for an open-source release.
The intended reader has no access to project conversations or the maintainers' cloud accounts.
The documentation must help that reader use, install, operate, and contribute to Minsky.
Treat documentation as part of each feature's acceptance criteria.
The later [writing rules](writing-guide.md) apply the user's supplied `unslop` and `technical-writing` principles.
Public pages each have one purpose: tutorial, how-to, reference, or explanation.

This audit inspected T0011 revision `3c18cbb` and `main` at `de92d54` on 2026-10-17.
GitHub reported a private repository, no selected license, and no published releases.
The local checkout had no tags.
PRs #20, #21, #23, and #29 remained open.
The docs site's earlier build and browser checks passed. Those checks do not establish release-quality content.

The entries below are acceptance work within T0011 and its T0007 dependency, not newly created development tickets.
They do not authorize new cloud resources, repository publication, license selection, or deployment.
Capacity validation and outage features retain their existing scope and remain separate work.

## Reader structure

Keep one canonical guide for each task. Link to it from other pages.

| Section | Reader outcome |
| --- | --- |
| Start | Understand Minsky, its release status, prerequisites, and the correct path for the reader's role. |
| Use | Complete contestant, support, jury, and administrator tasks with exact interface labels. |
| Install | Complete one tested installation path from a clean checkout to the first verified contest workflow. |
| Operate | Check health, upgrade, preserve data, restore data, and recover administrator access. |
| Reference | Find configuration values, permission rules, limits, supported versions, and error meanings. |
| Understand | Understand components, issue states, handoffs, timers, and the separation of public and staff information. |
| Contribute | Prepare a fork, run checks without shared credentials, propose changes, and report problems. |

These are content responsibilities. They do not require seven top-level navigation groups.
Use task names in navigation. Keep ticket numbers and run reports in repository records.
Add pages when they provide useful content. Do not publish empty sections or speculative feature guides.

## Required content corrections

### 1. Select the release license and publication policy

**Observed:** the repository is private. It contains no application `LICENSE`, `CONTRIBUTING.md`, or `SECURITY.md`.
The Public Sans font notice is present, but it is not an application license.
Public pages link to source and PRs that readers without repository access cannot inspect.

**Complete when:** the owner selects the application and documentation licensing terms and approves repository publication.
Add the selected license, attribution information, contribution instructions, and an approved private vulnerability-reporting route.
State where ordinary support requests belong and which versions receive support.
Do not invent a contact address, response commitment, or license.
The npm `private: true` fields prevent package publication. They do not need removal for a public source repository.

### 2. Identify the documented release

**Observed:** [feature status](../site/src/content/docs/reference/status.md) mixes merged commits, open PRs, and a dated development deployment.
There is no published release to which the guides can refer.
The deployed app's exact revision was not established by the earlier HTTP check.

**Complete when:** each published guide clearly belongs to a named release or a development revision.
State supported installation paths and their verification limits for that revision.
Move pending announcements and jury-worklist details out of normal release task guides.
Keep the distinction between merged, deployed, and verified.
Do not add a version selector before there are distinct versions worth maintaining.

### 3. Remove the shared-development assumption

**Observed:** [README setup](../README.md#local-development) and [contributor setup](../site/src/content/docs/contributing/development.md) assume the project's development backend.
`cloud:link`, `cloud:functions`, and the root Wrangler configuration target the original installation.
The public contributor guide omits the fork and clone steps.

**Complete when:** a new contributor can clone a fork and run ordinary checks without provider access.
Provide a separate connected-development path with explicit backend selection and account prerequisites.
Label commands reserved for authorized maintainers.
Do not require shared service credentials for ordinary public contributions.
Keep isolated fixtures and preserve the decision to retire the local demo.

### 4. Verify one complete installation path

**Observed:** [installation](../site/src/content/docs/operators/installation.md) requires the unmerged T0007 branch.
The guide correctly labels container startup and a fresh independent backend as unverified.
Its three hosting options do not have equivalent verification evidence.

**Complete when:** select a release revision and test a clean installation using only the published instructions.
Record prerequisites, exact tool versions, account requirements, commands, expected results, and the tested revision.
Complete the authenticated journey with fictional accounts and both image visibility modes.
Keep other hosting paths labeled experimental until their own checks pass.
T0007 owns the missing container and independent-installation evidence.

### 5. Make first-administrator setup reproducible

**Observed:** [backend setup](../site/src/content/docs/operators/backend.md) says to create and confirm an account through trusted administration.
It then tells the reader to apply generated SQL through trusted database access.
Neither task has a complete procedure or an expected result.

**Complete when:** specify the supported account-creation method, confirmation setting, UUID lookup, SQL execution method, and target check.
Use fictional values and explain each replacement.
Show how to check the resulting administrator, session, roster, categories, and closed intake.
State how to stop after a partial failure without repeating first-install initialization.
Resolve the ordering of the frontend hostname, backend redirect settings, and first frontend deployment.

### 6. Add a configuration reference

**Observed:** `.env.example`, `supabase/config.toml`, Wrangler files, and installation prose each describe part of the configuration.
There is no public table of names, requirements, defaults, or when a changed value takes effect.

**Complete when:** document the supported configuration values from the selected release.
Include public frontend variables, function secrets, allowed origins, Auth settings, hosting settings, and image limits.
For each value, state its location, purpose, format, default, required status, and whether it is secret.
State whether a change needs a frontend rebuild, function deployment, or another explicit step.
Explain the comma-separated `ALLOWED_ORIGINS` format with a local-development example.
Document T0007 configuration only for a revision that contains those files.

### 7. State exact workflow permissions

**Observed:** [staff](../site/src/content/docs/guides/staff.md), [contestant](../site/src/content/docs/guides/contestants.md), and [jury](../site/src/content/docs/guides/jury.md) guides omit important action restrictions.
The workflow implementation in `supabase/migrations/202610020003_private_signals.sql` requires the following:

- Only the current support owner can request a handoff or resolve the issue.
- A different specialist must accept the handoff. An owner with specialist access cannot accept their own handoff.
- Resolved issues reject replies and internal notes.
- Support staff or the affected team can reopen an issue. Reopening requires a reason.
- Jury-only access does not grant claim, resolution, or reopening controls.
- Session-admin access alone does not grant all support and jury actions.
- Workflow text requires 1–2,000 characters after trimming spaces.

**Complete when:** the task guides state their relevant prerequisites and a shared permission table covers all supported actions.
Check combined roles, archived events, closed intake, and removed membership against the selected release.
Explain the difference between a reply, image upload, award decision, and external application confirmation.

### 8. Complete account-management instructions

**Observed:** [administration](../site/src/content/docs/guides/administration.md) omits username validation and account-wide permission restrictions.
It omits what to do if the one-time credential response is lost.
The repository's cloud-onboarding guide contains more detail than the public guide.

**Complete when:** document the 3–32 character username rule, lowercase storage, and required initial letter or digit.
Explain the temporary credential display and recovery after a lost response.
State that username changes and password resets require admin access to every session assigned to that account.
An archived membership blocks those account-wide changes.
Explain the scope of ordinary session permission changes and the last-admin safeguard.
Document the distinction between the current password and the new password during a required change.

### 9. Document operator recovery

**Observed:** [troubleshooting](../site/src/content/docs/operators/troubleshooting.md) sends users to an organizer for password recovery.
It gives no public procedure for loss of the sole administrator account.
The repository already contains `scripts/recover-admin.mjs` and a maintainer procedure in `docs/cloud-onboarding.md`.

**Complete when:** publish a scoped operator procedure with the required provider access and explicit project check.
Explain private handling of the generated password, prior-session invalidation, and the next required password change.
Check the procedure on an isolated installation before claiming that installation supports it.
Do not publish real credentials or run recovery as part of ordinary docs verification.

### 10. Replace maintenance advice with tested procedures

**Observed:** [verification](../site/src/content/docs/operators/verification.md) states upgrade order and recommends backup and restoration.
It does not supply a tested upgrade or restoration procedure.

**Complete when:** for each installation path advertised as supported, document its actual operating procedure.
Cover database records, Auth data, private Storage files, configuration, and the information required to restore their relationships.
Test restoration into an isolated target and verify access, issues, history, awards, and images.
Document upgrade prerequisites, compatible component revisions, stopping conditions, and recovery after partial deployment.
Distinguish restoring static frontend assets from reversing database changes.
Do not imply that these procedures already exist or that capacity validation passed.

### 11. Make troubleshooting lead to a result

**Observed:** several entries end with advice to check errors or contact an operator.
There is no common format for symptoms, likely causes, exact checks, expected results, and next actions.

**Complete when:** use that format for sign-in failure, missing membership, rejected actions, image failures, and backend connection failures.
Identify where an operator reads relevant function errors.
State which diagnostic details are safe to include in a bug report.
Explain how to check whether Minsky saved an action before retrying it.
Track reply retry behavior under its application work. Do not promise a fix from this docs audit.

## Structure and maintenance corrections

### 12. Separate public guidance from project operations

**Observed:** [docs contribution](../site/src/content/docs/contributing/documentation.md) mixes writing instructions with the project's account ID and deployment exception.
[local development](../site/src/content/docs/contributing/development.md) refers to "the user" and agent-specific commit rules.
The homepage links to the shared development app.

**Complete when:** public contribution instructions address an outside contributor directly.
Keep project deployment targets, historical exceptions, and agent rules in linked maintainer records.
The account ID is a routing identifier, not a secret. Its problem here is relevance and reuse.
Keep any development-app link explicitly restricted to approved development use.
Do not present it as the destination for an unrelated competition.

### 13. Add a concise explanation of the system

**Observed:** public pages explain tasks but provide no architecture page, shared glossary, or lifecycle diagram.

**Complete when:** show how the browser, static host, Auth, database, Realtime, Storage, and privileged functions relate.
Explain event, session, team, issue, owner, handoff, resolution, award, and external application.
Show timer behavior across resolution and reopening.
Explain authorization at the backend and the separation of public and staff information.
Document actual components. Do not imply a stable public integration API without such a commitment.

### 14. Reconcile current guidance with historical records

**Observed:** `docs/product-direction.md` still says "beyond the demo" and refers to future demo feedback.
Current-scope notes still discuss T0005 as active work, although its PR merged.
The code-quality guide still says to apply settings after PR #2 checks appear.
Older records also contain the former repository owner name.

**Complete when:** current instructions describe the connected app and current workflow.
Retain dated run reports and PR links as historical evidence.
Replace stale owner paths in executable examples without treating historical links as proof of current ownership or access.
Update the code-quality checks table for docs builds, browser checks, and the separate dependency audit.
Recheck remote settings before changing any claim about protection or provider access.

### 15. Complete the docs-only contribution path

**Observed:** the docs workflow runs `docs:test` without its own Chromium-install prerequisite.
The application and docs packages have different Node.js minimums.
There is no page edit link or direct documentation-error reporting link in the site configuration.

**Complete when:** a clean checkout can install, preview, build, and check docs using one complete procedure.
State the supported Node.js version for that path and the browser-install step or a direct prerequisite link.
Add source-edit and error-report links once their destinations are accessible to intended readers.
Explain how to propose a docs change without deploying it.
Show the expected local URL and the difference between development search and built-site search.

## Site checks and hosting

### 16. Define the public address and preserve links

**Observed:** the docs use a separate Worker at `minsky-docs.icaic-minsky.workers.dev`.
The origin appears in the Astro configuration, local-link checker, application links, and several guides.

**Complete when:** record the canonical public address, meaning the preferred address used in published links.
If the owner selects a custom domain, update all current references and configure redirects for old public addresses.
Verify deep links, search results, canonical metadata, and sitemap URLs on the selected address.
Keep historical deployment evidence accurate.

Workers assigns `<worker>.<account-subdomain>.workers.dev`, as specified in its [address documentation](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
An address such as `docs.minsky.example` requires an owned domain and a [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
The existing separate Worker can serve that address. A third site is unnecessary.
A purchased domain is not a prerequisite for writing or reviewing the docs.

### 17. State the limits of automated link checks

**Observed:** `site/scripts/check-links.mjs` checks generated HTML `href`, `src`, and local heading anchors.
It skips other origins and does not check repository Markdown links, CSS URLs, or `srcset` targets.
It cannot detect an instruction that uses a nonexistent command.

**Complete when:** retain fast local-link checks and add appropriate checks for newly supported content types.
Review external and repository links, including their accessibility to a signed-out reader.
Validate executable examples against their stated revision.
Keep network-dependent link checks separate from deterministic build checks if they would cause unrelated failures.
Do not add application tests that merely repeat prose.

### 18. Broaden usability evidence

**Observed:** the three docs tests cover selected Chromium pages, keyboard search, phone navigation, direct reload, and a missing page.
Earlier visual review covered light and dark themes.
This does not establish screen-reader usability, cross-browser behavior, zoom behavior, or complete keyboard operation.

**Complete when:** check representative task, reference-table, and code-heavy pages with keyboard navigation and a screen reader.
Check enlarged text, zoom, focus visibility, contrast, long content, and the supported browser set.
Check both themes and phone widths.
Add targeted automated coverage for observed defects. Do not claim accessibility certification from the existing three tests.

### 19. Resolve the known build warning

**Observed:** the recorded docs build warns about duplicate `/404` routes.
The earlier browser checks confirmed correct missing-page content and HTTP status.
The generated sitemap exists and excludes the 404 page.

**Complete when:** find a supported custom-404 configuration that avoids the duplicate route, or document a bounded upstream limitation.
Retain checks for HTTP 404 status, useful navigation, and exclusion from the sitemap and search index.
Do not remove the custom error page solely to silence the warning.

### 20. Make documentation review part of release review

**Observed:** the PR template checks documentation generally, but it has no explicit reader or command-reproduction criteria.
The existing T0011 acceptance boxes describe the initial deployment, not open-source release readiness.

**Complete when:** each behavior change updates its affected guides and reference material in the same PR.
Review prerequisites, interface labels, limits, examples, and failure paths against code and observed behavior.
Record the documented revision, checks, remaining limits, and deployment revision separately.
Ask a reader without project context to complete the main task from the docs alone.
Record and fix every missing step found during that review.

## Corrections completed during this audit

- Removed the `.env.example` comment advertising the deleted `npm run dev:demo` command.
- Corrected the three maintenance command paths in `docs/code-quality.md` to `GiftedNovaHD/minsky`.
- Added the four reported permission rules to the public staff, contestant, jury, and administrator guides.

The maintenance corrections change comments and instructions only. The maintenance commands were not executed.
Historical links and run reports remain intact.

### Permission documentation fixes

These are existing behavior rules. The proposed fixes clarify the guides and interface feedback, without changing authorization.

| Existing rule | Guide correction in this branch | Remaining proposed work |
| --- | --- | --- |
| Only the current owner can resolve an issue | Staff guide states the owner requirement. | Include the rule in the full permission table. Check whether unavailable controls explain the requirement. |
| A different specialist must accept a handoff | Staff guide explicitly excludes self-acceptance. | Check the combined owner/specialist case in the reader walkthrough. |
| Resolved issues reject replies and internal notes | Staff and contestant guides explain reopening. Jury guide explains its reopening limit. | Include the rule in the action/state table and check the closed-conversation explanation. |
| Account-wide resets require admin access to all assigned sessions | Administrator guide states the permission requirement and archived-membership restriction. | Add a troubleshooting example for an admin who controls only one of the account's sessions. |

Source: `supabase/migrations/202610020003_private_signals.sql` for issue actions and `supabase/migrations/202610020004_usernames.sql` for account administration.
The broader permission table and account-guide work in findings 7 and 8 remain incomplete.

## Recommended order

1. Complete factual corrections, audience separation, and the contributor path within T0011.
2. Use T0007's verified revision to finish installation, configuration, recovery, and operating procedures.
3. Resolve owner decisions about licensing, publication, support, and the canonical address before announcing a public release.
4. Review the complete reader journey, run applicable checks, and publish through the selected deployment workflow.

The owner decisions can proceed alongside writing.
A development preview may remain public with clear limits while release work continues.
Do not claim production readiness or verified 800-user capacity as a consequence of documentation completion.
