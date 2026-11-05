import { CheckCheck } from "lucide-react";
import { useId, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { can } from "./capabilities";
import { keepFocus } from "./hooks/useRefreshOnReturn";
import { type ContestAwardRunner, useContestAwards } from "./hooks/useContestAwards";
import { awardMinutesLabel } from "./labels";
import type { Membership, Snapshot } from "./model";
import { seatOf } from "./capabilities";

/** The most minutes that one contest-wide award gives. D1 enforces the same bound. */
export const CONTEST_AWARD_MINUTES_MAX = 1440;

/** The minutes field as a whole number from 1 to 1440, or undefined. */
export function parseContestAwardMinutes(text: string): number | undefined {
  if (!/^\d{1,4}$/.test(text.trim())) return undefined;
  const minutes = Number(text);
  return minutes >= 1 && minutes <= CONTEST_AWARD_MINUTES_MAX ? minutes : undefined;
}

function AwardForm({ runner, disabled }: { runner: ContestAwardRunner; disabled: boolean }) {
  const id = useId();
  const [minutes, setMinutes] = useState("");
  const [explanation, setExplanation] = useState("");
  const parsed = parseContestAwardMinutes(minutes);
  const text = explanation.trim();
  return (
    <form
      className="mt-3 grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed === undefined || !text || disabled) return;
        void runner.run({ type: "grant", minutes: parsed, explanation: text }).then((done) => {
          if (done) {
            setMinutes("");
            setExplanation("");
          }
        });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-minutes`}>Minutes for every contestant</Label>
        <Input
          id={`${id}-minutes`}
          inputMode="numeric"
          value={minutes}
          readOnly={disabled}
          className="h-11 text-base sm:max-w-40 md:text-sm"
          aria-invalid={minutes !== "" && parsed === undefined}
          onChange={(event) => setMinutes(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">A whole number from 1 to {CONTEST_AWARD_MINUTES_MAX}.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-why`}>Why</Label>
        <Textarea
          id={`${id}-why`}
          value={explanation}
          maxLength={2000}
          readOnly={disabled}
          className="text-base md:text-sm"
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>
      {/* aria-disabled, not disabled, so the focused button keeps focus when the form clears. The submit handler checks the same condition. */}
      <Button
        type="submit"
        className="h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:w-fit"
        aria-disabled={disabled || parsed === undefined || !text}
      >
        Record the decision
      </Button>
    </form>
  );
}

/**
 * Time awards for the whole contest. The jury records the decision. Support or
 * jury confirm that staff applied the minutes in the external contest system.
 * Minsky changes no external clock, and a contestant's end time grows only by
 * minutes that staff confirmed. With `pendingOnly`, the panel lists only the
 * awards that wait for confirmation, and it is empty when none does.
 */
export function ContestAwardsPanel({
  state,
  member,
  refresh,
  pendingOnly = false,
}: {
  state: Snapshot;
  member: Membership;
  refresh: () => Promise<void>;
  pendingOnly?: boolean;
}) {
  const id = useId();
  const sessionId = state.session?.id ?? "";
  const runner = useContestAwards(sessionId, refresh);
  const seat = seatOf(member);
  const mayGrant = can(seat, "award");
  const mayApply = can(seat, "apply");
  const archived = Boolean(state.event?.archived);
  const awards = pendingOnly ? state.contest_awards.filter((award) => !award.applied_at) : state.contest_awards;
  if (!sessionId || (pendingOnly && awards.length === 0)) return null;
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border bg-card p-4">
      <h2 id={`${id}-title`} className="text-sm font-semibold">
        {pendingOnly ? "Time awards to confirm" : "Time awards for the whole contest"}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {pendingOnly
          ? "Apply the minutes in the external contest system, then confirm here."
          : "Each award gives minutes to every contestant. Minsky does not change the contest clock. Staff apply the minutes outside Minsky and confirm here. A contestant's end time grows only by confirmed minutes."}
      </p>
      {runner.error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>
            <p role="alert">{runner.error}</p>
          </AlertDescription>
        </Alert>
      )}
      {awards.length > 0 ? (
        <ul aria-label="Contest-wide awards" className="mt-3 divide-y">
          {awards.map((award) => (
            <li key={award.id} className="py-3 first:pt-0 last:pb-0">
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xl font-bold tabular-nums">{awardMinutesLabel(award.minutes)}</span>
                <span className="min-w-0 flex-1 basis-40 text-sm break-words">“{award.explanation}”</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Decided by {award.actor_name}</p>
              {award.applied_at ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-status-resolved">
                  <CheckCheck aria-hidden="true" className="size-3.5" />
                  Applied · confirmed by {award.applied_name}
                </p>
              ) : (
                mayApply &&
                !archived && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 h-11 w-full aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:w-fit"
                    aria-disabled={runner.busy}
                    onClick={() => void runner.run({ type: "apply", awardId: award.id }).then(() => keepFocus())}
                  >
                    <CheckCheck aria-hidden="true" />
                    Confirm applied externally
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No award for the whole contest yet.</p>
      )}
      {!pendingOnly && mayGrant && !archived && <AwardForm runner={runner} disabled={runner.busy} />}
    </section>
  );
}
