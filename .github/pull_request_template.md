<!--
Title: [Type] Brief description of what the PR addresses.
Capitalize the type. Example: [Bugfix] Prevent racing of requests
For several contribution types, use several brackets: [Bugfix] [Feature] Prevent racing of requests and add support for Chinese language
Use the contribution types in AGENTS.md. The branch name is <type>/<title>.

Replace the next line with <type>[optional scope]: <description>, in commit message form.
Put optional footers, such as Closes #123, at the end of the description.
-->
<type>[optional scope]: <description>

## Change

Describe the problem.
Describe the resulting behavior.
If a GitHub issue describes the change, reference it.

## Verification

List the commands you ran.
Record the observed results.
Identify checks you did not run.
Identify required manual checks and known limitations.
Explain deliberate TypeScript style exceptions.

## Review checklist

Complete each applicable item after review.
Explain each item that does not apply.

- [ ] The change stays within the scope that this PR describes.
- [ ] The code is readable. It contains no unnecessary abstractions or unrelated rewrites.
- [ ] The change preserves authorization and separation of public data from internal data. Credentials remain outside Git and frontend builds.
- [ ] The change preserves ownership, timers, lifecycle history, awards, and external application status.
- [ ] Database and function changes have a compatible deployment order. The PR documents their effects on existing data.
- [ ] Required CI checks pass. The PR records manual interface checks and remaining limitations.
- [ ] Documentation describes the implemented behavior and observed verification results.
