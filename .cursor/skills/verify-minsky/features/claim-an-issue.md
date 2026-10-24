# Claim an issue

A volunteer takes an open report from the queue. The report leaves the waiting state, the volunteer becomes the owner, and the first assignment time is stored. The contestant timer keeps the time that started at submission.

## Sub-features

- `claim-see-open` shows the open report in the queue.
- `claim-take` records the volunteer as the owner.
- `claim-assigned` shows the report as in progress and removes **Claim**.

## How to get to it (user POV)

- Sign in as `volunteer` on a window at least 1024 px wide. The console opens on **Queue**. Choose **Claim ISS-1** on that row. The sidebar **Queue** button is the same page.
- On a window narrower than 1024 px, open the **Queue** tab in **Organiser sections**. Choose **Claim and go** on the oldest waiting report, or **Claim ISS-1** on its card.

## Driving it with minsky-verify

Preconditions:

- `serve --seed empty` is ready and `doctor` reports `"ok": true`.
- The viewport is `1280x800`.
- The report journey has already sent one report in this same database, then signed out, so the **Sign in** heading is visible and the only issue is open ISS-1 for Aurora.
- The evidence directory exists: `mkdir -p .verify-minsky/evidence/claim-an-issue`.

- **Sign in as the volunteer.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Username --value volunteer --exact`, `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Password --value verification-only --exact`, and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Sign in" --exact`. Then run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role navigation --name "Console pages" --exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait-text --text Live --exact`. The desktop console is visible.
- **Open the queue.** Choose **Queue**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name Queue`. The command prints `{"ok":true}`. The row for ISS-1 is on the page.
- **Claim the report.** Choose **Claim ISS-1**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Claim ISS-1" --exact`. The command prints `{"ok":true}`.
- **See the new state.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait-text --text "In progress"` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts absent --role button --name "Claim ISS-1" --exact`. Both commands print `{"ok":true}`. The row shows **In progress**, and **Claim ISS-1** is gone.
- **Proof.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts screenshot --out .verify-minsky/evidence/claim-an-issue/01-claimed.png`, `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts aria --out .verify-minsky/evidence/claim-an-issue/claimed.aria.txt`, and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts snapshot --user volunteer --out .verify-minsky/evidence/claim-an-issue/snapshot.json`. The screenshot shows **In progress**. The snapshot issue has status `claimed`, a non-null `owner`, and a non-null `first_assigned_at`. Append every JSON line to `.verify-minsky/evidence/claim-an-issue/transcript.jsonl`.

## Gotchas

- The empty seed has no report until a contestant sends one. The jury seed has no open report. If **Claim ISS-1** is missing, stop. Do not claim a resolved or in-progress issue to make the button appear.
- The desktop button name includes the issue number. After a fresh report the number is 1. A later report uses the next number. Use the number on the row.
- The phone path uses **Claim and go** and a width below 1024 px. A desktop run does not verify that button.
- `absent` succeeds when **Claim ISS-1** is gone. If it returns `"ok": false`, the claim did not stick. Report the journey as failed.
- Sign out of the contestant account before this recipe. One window holds one signed-in person.
