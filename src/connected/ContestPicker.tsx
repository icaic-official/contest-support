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

interface PickerProps {
  contests: readonly ContestSummary[];
  /** The ID of the open contest. */
  value: string;
  onSelect: (contestId: string) => void;
  disabled?: boolean | undefined;
}

/**
 * The one picker for the contests that a person may open, in three shapes:
 * a menu behind a trigger button, radio rows for a phone, and a select for the
 * no-access screen. It lists the contests of `data.sessions`, which come from
 * `/api/contests`. A person with one contest sees no picker; the caller shows
 * the name instead.
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
  const { contests, value, onSelect, disabled } = props;
  const id = useId();
  if (props.variant === "menu") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          {props.trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={props.align ?? "start"} className={props.className}>
          <DropdownMenuLabel>Contest session</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (next !== value) onSelect(next);
            }}
          >
            {contests.map((item) => (
              <DropdownMenuRadioItem key={item.id} value={item.id}>
                {item.name}
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
        {contests.map((item) => (
          <label
            key={item.id}
            className={cn(
              "flex min-h-12 cursor-pointer items-center gap-3 px-4 text-[15px]",
            )}
          >
            <input
              type="radio"
              name={`${id}-contests`}
              value={item.id}
              checked={item.id === value}
              onChange={() => onSelect(item.id)}
              className="size-4 accent-current"
            />
            <span className="flex-1">{item.name}</span>
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
        className="h-11 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {contests.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}
