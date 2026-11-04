import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { zoneLabel } from "@/connected/zonedTime";
import { fieldClass } from "./forms";
import type { ScheduleDraft } from "./scheduleForm";

/**
 * The start, end, and grace of a contest. The times are wall times in the
 * event's zone, and the label says which zone.
 */
export function ScheduleFields({
  draft,
  timeZone,
  disabled,
  onChange,
}: {
  draft: ScheduleDraft;
  timeZone: string;
  disabled: boolean;
  onChange: (next: ScheduleDraft) => void;
}) {
  const id = useId();
  const set = (field: keyof ScheduleDraft) => (value: string) => onChange({ ...draft, [field]: value });
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-medium">
        Schedule <span className="font-normal text-muted-foreground">in {timeZone} ({zoneLabel(timeZone)})</span>
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-start-date`}>Start date</Label>
          <Input id={`${id}-start-date`} type="date" value={draft.startDate} className={fieldClass}
            onChange={(event) => set("startDate")(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-start-time`}>Start time</Label>
          <Input id={`${id}-start-time`} type="time" value={draft.startTime} className={fieldClass}
            onChange={(event) => set("startTime")(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-end-date`}>End date</Label>
          <Input id={`${id}-end-date`} type="date" value={draft.endDate} className={fieldClass}
            onChange={(event) => set("endDate")(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-end-time`}>End time</Label>
          <Input id={`${id}-end-time`} type="time" value={draft.endTime} className={fieldClass}
            onChange={(event) => set("endTime")(event.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-grace`}>Grace after the end (minutes)</Label>
        <Input id={`${id}-grace`} inputMode="numeric" value={draft.grace} className={`${fieldClass} sm:max-w-40`}
          onChange={(event) => set("grace")(event.target.value)} />
      </div>
    </fieldset>
  );
}
