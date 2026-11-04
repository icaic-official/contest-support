import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IntakeMode } from "@/backend/contracts";
import { intakeHeadline } from "@/connected/intakeText";
import type { ContestClock, Issue } from "@/connected/model";
import { formatInZone, viewerNote } from "@/connected/zonedTime";
import { StatusIcon } from "../components/issueDisplay";
import {
  type ImageLimits,
  imageLimitBounds,
  isValidLimit,
  statusCounts,
  stepLimit,
} from "./adminModel";

/** The number of issues in each status, with an icon and a label. */
export function StatusCounts({ issues }: { issues: readonly Issue[] }) {
  return (
    <ul aria-label="Issue status counts" className="grid grid-cols-4 gap-2">
      {statusCounts(issues).map(({ status, label, count }) => (
        <li
          key={status}
          className="rounded-xl border bg-card p-2.5 text-center"
        >
          <StatusIcon status={status} className="mx-auto size-5" />
          <div className="mt-1 text-xl font-bold tabular-nums">{count}</div>
          <div className="text-[11px] leading-tight text-muted-foreground">
            {label}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The clock of a contest in words, for example "Opens 13:00, closes 18:15 (15 minutes grace)". */
export function scheduleSummary(clock: ContestClock): string {
  const schedule = clock.schedule;
  if (!schedule) return "This contest has no schedule.";
  const zone = clock.time_zone;
  const closes = new Date(Date.parse(schedule.ends_at) + schedule.grace_minutes * 60_000).toISOString();
  const grace = schedule.grace_minutes > 0 ? ` (${schedule.grace_minutes} minutes grace)` : "";
  const note = viewerNote(schedule.starts_at, zone, "datetime");
  return `Opens ${formatInZone(schedule.starts_at, zone, "datetime")}, closes ${formatInZone(closes, zone, "datetime")}${grace}.${note ? ` ${note}.` : ""}`;
}

/** How staff hold intake: with the schedule, or by hand. */
export function intakeMode(clock: ContestClock | null | undefined, open: boolean): IntakeMode {
  return clock ? (clock.follows_schedule ? "schedule" : open ? "open" : "closed") : open ? "open" : "closed";
}

/**
 * Shows when contestant intake opens and closes. Staff can open or close it
 * by hand, and return it to the schedule.
 */
export function IntakePanel({
  clock,
  open,
  disabled,
  onChange,
}: {
  clock: ContestClock | null | undefined;
  open: boolean;
  disabled: boolean;
  onChange: (mode: IntakeMode) => void;
}) {
  const id = useId();
  const mode = intakeMode(clock, open);
  const hasSchedule = !!clock?.schedule;
  const unavailable = "h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50";
  const change = (next: IntakeMode) => {
    if (!disabled && next !== mode) onChange(next);
  };
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border bg-card p-4">
      <h3 id={`${id}-title`} className="text-[15px] font-medium">
        Contestant intake
      </h3>
      <p id={`${id}-state`} className="mt-1 text-sm">
        {clock ? intakeHeadline(clock.intake.reason) : open ? "Intake open" : "Intake closed"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {mode === "schedule" && clock
          ? `Following the schedule. ${scheduleSummary(clock)}`
          : mode === "open"
            ? "Staff opened intake by hand. It stays open until staff close it or return it to the schedule."
            : "Staff closed intake by hand. It stays closed until staff open it or return it to the schedule."}
      </p>
      {mode !== "schedule" && clock?.schedule && (
        <p className="mt-1 text-xs text-muted-foreground">If it followed the schedule: {scheduleSummary(clock)}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-describedby={`${id}-state`}>
        {/* aria-disabled, not disabled, so the pressed button keeps keyboard focus while the request runs. */}
        <Button type="button" variant="outline" className={unavailable} aria-disabled={disabled || mode === "open"} onClick={() => change("open")}>
          Open now
        </Button>
        <Button type="button" variant="outline" className={unavailable} aria-disabled={disabled || mode === "closed"} onClick={() => change("closed")}>
          Close now
        </Button>
        {hasSchedule && mode !== "schedule" && (
          <Button type="button" variant="secondary" className={unavailable} aria-disabled={disabled} onClick={() => change("schedule")}>
            Return to schedule
          </Button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Closing intake stops new contestant reports. Staff work and reopening remain available.
      </p>
    </section>
  );
}

const limitRows: readonly {
  key: keyof ImageLimits;
  label: string;
  unit?: string;
}[] = [
  { key: "fileMb", label: "Largest image", unit: "MB" },
  { key: "count", label: "Images per issue" },
  { key: "totalMb", label: "Total per issue", unit: "MB" },
];

const limitHelp: Record<keyof ImageLimits, string> = {
  fileMb: "One file",
  count: "Team-visible and staff-only together",
  totalMb: "Combined size of all images",
};

/**
 * Edits the image limits of the session. Each limit has a number field and
 * labelled − and + buttons. The parent sets a `key` from the saved limits so
 * the form restarts when they change.
 */
export function ImageLimitsForm({
  limits,
  disabled,
  onSave,
}: {
  limits: ImageLimits;
  disabled: boolean;
  onSave: (limits: ImageLimits) => void;
}) {
  const id = useId();
  const [values, setValues] = useState<Record<keyof ImageLimits, string>>({
    fileMb: String(limits.fileMb),
    count: String(limits.count),
    totalMb: String(limits.totalMb),
  });
  const set = (key: keyof ImageLimits, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <form
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        const next = {
          fileMb: Number(values.fileMb),
          count: Number(values.count),
          totalMb: Number(values.totalMb),
        };
        const valid = limitRows.every(({ key }) =>
          isValidLimit(key, next[key]),
        );
        if (valid) onSave(next);
      }}
    >
      <h2
        id={`${id}-title`}
        className="px-1 pb-2 text-xs font-medium text-muted-foreground"
      >
        Issue images
      </h2>
      <fieldset disabled={disabled} className="divide-y rounded-xl border bg-card">
        <legend className="sr-only">Image limits</legend>
        {limitRows.map(({ key, label, unit }) => {
          const { min, max } = imageLimitBounds[key];
          const value = Number(values[key]);
          return (
            <div key={key} className="flex items-center gap-2 p-3 pl-4">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`${id}-${key}`}
                  className="block text-[15px] font-medium"
                >
                  {label}
                  {unit && ` (${unit})`}
                </label>
                <p id={`${id}-${key}-help`} className="text-xs text-muted-foreground">
                  {limitHelp[key]}, {min}–{max}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11"
                aria-label={`Decrease ${label.toLowerCase()}`}
                disabled={value <= min}
                onClick={() => set(key, String(stepLimit(key, value, -1)))}
              >
                <Minus aria-hidden="true" />
              </Button>
              <Input
                id={`${id}-${key}`}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                required
                value={values[key]}
                onChange={(event) => set(key, event.target.value)}
                aria-describedby={`${id}-${key}-help`}
                aria-invalid={!isValidLimit(key, value)}
                className="h-11 w-14 px-1 text-center font-mono text-base tabular-nums md:text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11"
                aria-label={`Increase ${label.toLowerCase()}`}
                disabled={value >= max}
                onClick={() => set(key, String(stepLimit(key, value, 1)))}
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
          );
        })}
        <div className="p-3">
          <Button type="submit" variant="secondary" className="h-11 w-full">
            Save image limits
          </Button>
        </div>
      </fieldset>
      <p className="mt-1.5 px-1 text-xs text-muted-foreground">
        JPEG, PNG and WebP images. A lower limit does not remove images that
        are already attached.
      </p>
    </form>
  );
}
