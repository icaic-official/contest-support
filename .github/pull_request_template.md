## Change

Describe the problem and resulting behavior. Reference the development ticket.

## Verification

List commands and observed results. Identify checks not run, required manual
checks, and known limitations. Explain deliberate TypeScript style exceptions.

## Review checklist

Complete applicable items after review; explain any that are not applicable.

- [ ] The change fits the active ticket and acceptance criteria.
- [ ] The code is readable, with no unnecessary abstractions or unrelated rewrites.
- [ ] Authorization and public/internal data separation are preserved; credentials stay out of Git and frontend builds.
- [ ] Ownership, timers, lifecycle history and award/application behavior are preserved.
- [ ] Database/function changes have a compatible deployment order and documented effects on existing data.
- [ ] Required CI checks pass; manual interface checks and remaining limits are recorded.
- [ ] Documentation describes the implemented behavior and actual verification.
