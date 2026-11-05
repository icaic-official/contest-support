import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ThemePreference, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** The theme choices in display order. Every theme picker uses this table. */
export const themeOptions: readonly {
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "system", label: "Device", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** A menu button that sets the light or dark theme. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, theme, setPreference } = useTheme();
  const Current = theme === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("max-lg:size-11", className)} aria-label="Color theme">
          <Current />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            const option = themeOptions.find((item) => item.value === value);
            if (option) setPreference(option.value);
          }}
        >
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
