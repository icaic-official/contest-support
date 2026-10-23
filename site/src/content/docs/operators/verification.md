---
title: Verify and maintain an installation
description: Check the complete workflow, preserve data, and record the revision you operate.
---

## Record the installation

Record the source commit, frontend address, backend project, migration state, and deployed function revisions.
Keep credentials in your approved credential store.
Use a development or test session with fictional accounts for verification.
Delete only data created for those checks.
Never reset a shared project to make a test pass.

## Check the complete journey

Use separate browser profiles for a contestant, volunteer, specialist, jury member, and administrator.

1. Sign in with a temporary password.
2. Check that contest access requires a password change.
3. Submit an issue as the contestant.
4. Claim it as the volunteer.
5. Send a public reply and an internal note.
6. Check that the contestant sees only the public reply.
7. Request a specialist handoff.
8. Check that the volunteer remains the owner until the specialist accepts.
9. Accept the handoff and resolve the issue as the specialist.
10. Record an award as the jury member.
11. Confirm external application as staff after completing the external action.
12. Reopen the issue and check its owner, accumulated time, resolution history, and award.

Refresh each browser during the journey.
Check the saved state and shared updates.
Repeat relevant controls with the keyboard and at phone widths.

## Check images and access

- Upload a staff-only image and a team-visible image.
- Check that the contestant sees only the team-visible image.
- Check that another team cannot read either image or the issue.
- Check that only the uploader can remove an image.
- Check file size, image count, and combined size limits.
- Revoke membership and check that the former member loses access.
- Check archived records with authorized and unauthorized accounts.

Browser appearance alone does not establish backend authorization.
Use the repository's policy tests and isolated cloud suite when verifying an installation.
The repository's hosted-test shortcuts target its recorded development and CI environments.
Inspect their target checks before adapting them for another installation.

## Upgrade in a controlled order

Read the changes and migration instructions for the selected revision.
Validate that revision in development and an isolated CI project first.
For Cloudflare, apply reviewed D1 migrations, then deploy the complete Worker and its assets with the selected configuration.
For the Supabase provider, apply migrations, deploy account and attachment functions and configuration, then deploy the frontend.
Preserve its authentication secret, R2 objects, and Durable Object migration history.
Verify the complete installation afterward.
Merging a pull request does not deploy the app.

Back up database records and private image files together.
Record and rehearse restoration on an isolated installation before relying on it.
Replacing the frontend must not delete backend data.
Do not reverse database migrations simply to restore an older frontend.

## Understand the remaining checks

Passing ordinary CI does not verify a hosted Cloudflare Worker or a hosted Supabase project.
A local cloud run does not replace a protected GitHub cloud run.
Neither establishes 800-user capacity or live-contest readiness.
See [feature status](/reference/status/) for the current limits.
