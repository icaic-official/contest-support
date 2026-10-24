# Minsky verification map

This directory is the maintained source for user-facing Minsky behavior. Read this index, then follow one feature file. The launch, doctor, and cleanup commands live in [the skill](../SKILL.md).

Update this map in the same change as any user-facing behavior change. Announcements have no feature file yet.

## Baseline preconditions

- The repository root is the current directory.
- `npm ci` and `npx playwright install chromium` have completed.
- No `.env.local` is required. Do not log in to Cloudflare or Supabase for these journeys. The helper uses a fresh local D1 database.
- One `serve` process is running and has printed `ready https://127.0.0.1:5199`.
- `doctor` prints `"ok": true` for that same origin.
- The viewport is `1280x800` unless the feature asks for the phone width.
- The seed is `empty` unless the feature asks for `jury`.

## Driving conventions

- Start from the baseline unless the feature names a different seed or viewport.
- Use the accessible role and name in the command. Keep `--exact` where the recipe includes it.
- Run each command from the repository root.
- Treat the command text as literal, including quotes.
- Append each JSON result to the transcript path in the feature.
- Create the evidence directory before the first screenshot.
- A second browser on this session is a failed run. Do not start another `serve` while one is ready.

## Proof and skip reporting

- Record the action and the state it produces.
- A write is proved by the screen and by the `snapshot` file together.
- Name the feature and the entry point in the transcript header or the directory name.
- When a control is missing, stop. Report the command, the exit code, and the unmet precondition from Gotchas.
- A desktop run does not verify a phone entry point. Report the phone path as not driven.
- Do not change a recipe so that a failing local limit counts as a pass.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior. It then has exactly these H2 sections, in order:

1. `Sub-features` lists short IDs, one behavior per line.
2. `How to get to it (user POV)` lists every entry point.
3. `Driving it with minsky-verify` starts with `Preconditions:` and then labeled bullets. Each bullet pairs a user action with an exact command and the result you can observe. The last bullet is `Proof`.
4. `Gotchas` lists traps that waste or invalidate a run.

Keep implementation details out of the map. Name user paths, handles, required state, commands, and observable results.

## Features index

- [Sign in](./sign-in.md) covers the username form, the workspace, and sign-out.
- [Report an issue](./report-an-issue.md) covers a contestant report, the timer, and the saved issue.
- [Claim an issue](./claim-an-issue.md) covers a volunteer taking an open report from the queue.
- [Award review](./award-review.md) covers the jury lists for decisions, external application, and applied awards.
- [Accounts](./accounts.md) covers an administrator creating a team account and the one-time password screen.
