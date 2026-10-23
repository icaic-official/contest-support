import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Issue } from "@/connected/model";
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

/**
 * Opens or closes contestant intake. The whole row is the label of the
 * switch, so the touch target is the full row.
 */
export function IntakeSwitch({
  open,
  disabled,
  onChange,
}: {
  open: boolean;
  disabled: boolean;
  onChange: (open: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="rounded-xl border bg-card">
      <label
        htmlFor={`${id}-intake`}
        className="flex min-h-14 cursor-pointer items-center gap-3 p-4 has-[:disabled]:cursor-not-allowed"
      >
        <span className="flex-1">
          <span className="block text-[15px] font-medium">
            Contestant intake
          </span>
          <span
            id={`${id}-state`}
            className="block text-xs text-muted-foreground"
          >
            {open
              ? "Open. Teams can submit new reports."
              : "Closed. Teams cannot submit new reports."}
          </span>
        </span>
        <Switch
          id={`${id}-intake`}
          checked={open}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-describedby={`${id}-state ${id}-help`}
          // The switch is small. The pseudo-element makes a 44 px target.
          className="relative after:absolute after:-inset-x-2 after:-inset-y-3.5"
        />
      </label>
      <p id={`${id}-help`} className="px-4 pb-4 text-xs text-muted-foreground">
        Closing intake stops new contestant reports. Staff work and reopening
        remain available.
      </p>
    </div>
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
