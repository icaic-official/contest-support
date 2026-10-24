# Award review

A jury member reviews resolved reports, records a time award, and sees which awards still need external application. Recording an award does not change the contest clock. Staff confirm external application separately. Minsky does not edit that external clock.

## Sub-features

- `award-decide` lists resolved reports that have no award.
- `award-apply` lists awards that are not confirmed as applied.
- `award-applied` lists resolved reports whose award is marked applied.

## How to get to it (user POV)

- Sign in as `jury` on a window at least 1024 px wide. Choose **Award review** in **Console pages**.
- On a window narrower than 1024 px, choose the **Awards** tab in **Organiser sections**.

## Driving it with minsky-verify

Preconditions:

- `serve --seed jury` is ready and `doctor` reports `"ok": true`.
- The viewport is `1280x800`.
- The **Sign in** heading is visible.
- The evidence directory exists: `mkdir -p .verify-minsky/evidence/award-review`.

- **Sign in as the jury member.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Username --value jury --exact`, `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Password --value verification-only --exact`, and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Sign in" --exact`. Then run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role navigation --name "Console pages" --exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait-text --text Live --exact`. The desktop console is visible.
- **Open award review.** Choose **Award review**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Award review"` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role heading --name "Award review" --exact`. The heading **Award review** is visible.
- **Read decisions.** The **To decide** list is the one already selected. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts text --role list --name "To decide"`. The printed `text` contains `Issue 1 verification` and `Issue 2 verification`.
- **Read awards waiting for application.** Choose **To apply**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "To apply"` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts text --role list --name "To apply"`. The printed `text` contains `Issue 3 verification` and `Issue 4 verification`.
- **Read applied awards.** Choose **Applied**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name Applied` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts text --role list --name Applied`. The printed `text` contains `Issue 5 verification`.
- **Proof.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts screenshot --out .verify-minsky/evidence/award-review/applied.png`, `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts aria --out .verify-minsky/evidence/award-review/applied.aria.txt`, and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts snapshot --user jury --out .verify-minsky/evidence/award-review/snapshot.json`. The screenshot shows **Issue 5 verification** on the applied list. The snapshot contains that issue and an award with `applied_at` set. Append every JSON line to `.verify-minsky/evidence/award-review/transcript.jsonl`.

## Gotchas

- The empty seed has no resolved reports. **To decide** is empty, and this journey fails. Use `--seed jury`. Do not insert an award by hand to fill the list.
- Sidebar and list buttons include a count, so the recipe omits `--exact` on **Award review**, **To decide**, **To apply**, and **Applied**. Adding `--exact` makes the click miss.
- The phone **Awards** tab is a separate entry. A desktop run does not verify it.
- This recipe reads the seeded lists. It does not submit a new award. A run that only opens the page has not proved a new decision.
- Issue 6 is reopened and has no award, so it is absent from these three lists. Do not treat its absence as a failed filter.
