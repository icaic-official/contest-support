# Documentation release plan

This page lists the work that remains before Minsky's repository and documentation go public.
Remove an item when it is complete. When the list is empty, delete this page.

## Decisions that only the maintainers can make

Do not invent an answer to any of these items.

- **License.** Select the application and documentation licenses, and add `LICENSE`. Until then, `README.md` and the [feature status page](../site/src/content/docs/reference/status.md) state that no license is chosen.
- **Git history.** The repository is private. Publishing it also publishes its whole history, including the deleted project records and their infrastructure names. Choose between publishing the history as it is, rewriting it, and starting a new repository. A rewrite or a new repository must not lose the review evidence that the maintainers want to keep.
- **Security reports.** Choose a private reporting route, and add `SECURITY.md`. GitHub's private vulnerability reporting needs a repository setting.
- **Support and conduct.** State where ordinary support requests belong and which versions get support. Decide whether to add a code of conduct.
- **Public address.** Decide whether `minsky-docs.icaic-minsky.workers.dev` stays the canonical documentation address. A custom domain needs redirects from the old address. Check deep links, search results, canonical metadata, and sitemap URLs on the selected address.
- **Infrastructure names.** The `wrangler*.jsonc` files and the files in `src/server/adapters/cloudflare/deploy/` name this project's Cloudflare account and resources. An account ID is a routing identifier, not a secret. Decide whether these stay in the public tree or move to an example configuration.
- **Merge rules.** A public repository can use branch protection on GitHub Free. Decide whether to apply `.github/main-protection.json` and Dependabot alerts, as [code quality](code-quality.md) describes.

## Documentation that does not exist yet

- **Configuration reference.** A table of each value in `.env.example`, the Wrangler files, and the installation settings. For each value, state its location, format, default, required status, whether it is secret, and what a change needs.
- **Permission table.** One table of each action, role, and issue state, checked against `src/server/workflow.ts`, including combined roles, archived events, closed intake, and removed membership.
- **Backup, restore, and upgrade.** A tested procedure for D1 records, R2 files, and configuration, restored into an isolated target. Do not imply that this procedure exists until it passes.
- **Glossary.** Plain definitions of event, contest, team, issue, owner, handoff, resolution, award, and external application.
- **Troubleshooting format.** Give each entry a symptom, a cause, a check, an expected result, and a next action. State where an operator reads Worker errors, and which details are safe in a bug report.

## Checks before announcement

- A reader without project context completes the local run and the installation from the docs alone. Fix each missing step.
- Run the installation guide on a clean, isolated Cloudflare account at the release revision, and record that revision.
- Check task, reference, and code-heavy pages with keyboard navigation, a screen reader, zoom, and both themes. The three tests in `site/tests/docs.spec.ts` do not establish accessibility.
- Add source-edit and error-report links to the site when their targets are public.
- Keep the capacity statement until a load test on a production-like installation supports it. Documentation work does not establish production readiness or capacity for 800 simultaneous users.
