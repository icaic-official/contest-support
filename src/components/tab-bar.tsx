import type { LucideIcon } from "lucide-react";
import { SlidingIndicator } from "@/components/ui/sliding-indicator";
import { cn } from "@/lib/utils";

export interface TabBarItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

/**
 * The bottom tab bar of the phone apps. Each tab is a button of at least
 * 44 by 44 pixels. The bar sits in the page flow, so it never covers content,
 * and it keeps the safe area under it. A contestant's bar hides while a text
 * field has focus (see src/index.css).
 */
export function TabBar<T extends string>({
  label,
  items,
  current,
  onSelect,
}: {
  /** The accessible name of the navigation landmark. */
  label: string;
  items: readonly TabBarItem<T>[];
  current: T;
  onSelect: (tab: T) => void;
}) {
  return (
    <nav
      aria-label={label}
      className="shrink-0 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul
        className="relative isolate grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        <SlidingIndicator className="top-0 left-0 h-[3px] w-[calc(var(--indicator-w)-2rem)] translate-x-[calc(var(--indicator-x)+1rem)] rounded-b-full bg-foreground" />
        {items.map(({ id, label: text, icon: Icon }) => {
          const active = id === current;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(id)}
                className={cn(
                  "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors duration-(--motion-fast) ease-out active:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn("size-5", active && "stroke-[2.4]")}
                />
                {text}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
