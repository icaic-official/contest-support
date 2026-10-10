## Change

Describe the problem.
Describe the resulting behavior.
Reference the development ticket.

## Verification

List the commands you ran.
Record the observed results.
Identify checks you did not run.
Identify required manual checks and known limitations.
Explain deliberate TypeScript style exceptions.

## Review checklist

Complete each applicable item after review.
Explain each item that does not apply.

- [ ] The change fits the active ticket and its acceptance criteria.
- [ ] The code is readable. It contains no unnecessary abstractions or unrelated rewrites.
- [ ] The change preserves authorization and separation of public data from internal data. Credentials remain outside Git and frontend builds.
- [ ] The change preserves ownership, timers, lifecycle history, awards, and external application status.
- [ ] Database and function changes have a compatible deployment order. The PR documents their effects on existing data.
- [ ] Required CI checks pass. The PR records manual interface checks and remaining limitations.
- [ ] Documentation describes the implemented behavior and observed verification results.
