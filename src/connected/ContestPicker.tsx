import { type ReactElement, useId } from "react";
import type { ContestSummary } from "@/backend/contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { type ContestRow, contestRows, rowDetail, rowText } from "./contestList";

interface PickerProps {
  contests: readonly ContestSummary[];
  /** The ID of the open contest. */
  value: string;
  onSelect: (contestId: string) => void;
  disabled?: boolean | undefined;
}

/**
 * A row's name on the first line, and its start time and intake note on the
 * second. The note is text, so a screen reader reads it too. The name breaks
 * anywhere, because a long name must not widen a narrow phone screen. The
 * second line takes the text color of a focused menu row, because the muted
 * color falls below 4.5:1 on that row's background.
 */
function RowLines({ row }: { row: ContestRow }) {
  const detail = rowDetail(row);
  return (
    <span className="flex min-w-0 flex-1 flex-col text-left [overflow-wrap:anywhere]">
      <span>{row.name}</span>
      {detail !== null && (
        <span
          className={cn(
            "text-xs in-focus:text-accent-foreground",
            row.open ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {detail}
        </span>
      )}
    </span>
  );
}

/**
 * The one picker for the contests that a person may open, in three shapes:
 * a menu behind a trigger button, radio rows for a phone, and a select for the
 * no-access screen. It lists the contests of `data.sessions`, which come from
 * `/api/contests`, in the order that the hook gives. Each row shows the name,
 * the start time in the event's zone and what the intake does now. A person
 * with one contest sees no picker; the caller shows the name instead.
 */
export function ContestPicker(
  props: PickerProps &
    (
      | {
          variant: "menu";
          /** The button that opens the menu. It receives the menu's trigger behavior. */
          trigger: ReactElement;
          align?: "start" | "end";
          className?: string;
        }
      | { variant: "radios"; legend: string }
      | { variant: "select"; label: string }
    ),
) {
  const { value, onSelect, disabled } = props;
  const id = useId();
  const rows = contestRows(props.contests);
  if (props.variant === "menu") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          {props.trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={props.align ?? "start"}
          className={cn(
            "max-w-[min(24rem,var(--radix-dropdown-menu-content-available-width))]",
            props.className,
          )}
        >
          <DropdownMenuLabel>Contest session</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (next !== value) onSelect(next);
            }}
          >
            {rows.map((row) => (
              <DropdownMenuRadioItem key={row.id} value={row.id}>
                <RowLines row={row} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (props.variant === "radios") {
    return (
      <fieldset disabled={disabled} className="divide-y rounded-xl border bg-card">
        <legend className="sr-only">{props.legend}</legend>
        {rows.map((row) => (
          <label
            key={row.id}
            className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 text-[15px]"
          >
            <input
              type="radio"
              name={`${id}-contests`}
              value={row.id}
              checked={row.id === value}
              onChange={() => onSelect(row.id)}
              className="size-4 shrink-0 accent-current"
            />
            <RowLines row={row} />
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${id}-select`}>{props.label}</Label>
      <select
        id={`${id}-select`}
        value={value}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
        className="h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {rowText(row)}
          </option>
        ))}
      </select>
    </div>
  );
}
