import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { statusNames } from "@/connected/labels";
import { type Issue, type Resolution, unresolvedTime } from "@/connected/model";
import { clockDuration } from "@/connected/ui";
import { cn } from "@/lib/utils";
import { ageClass, ageTier, initials, placeOf } from "../organiserModel";

const statusIcons = {
  open: CircleDashed,
  claimed: CircleDot,
  escalated: ArrowUpRight,
  resolved: CircleCheck,
} as const;

/** The text color of each issue status. */
export const statusColors: Record<Issue["status"], string> = {
  open: "text-status-open",
  claimed: "text-status-claimed",
  escalated: "text-status-escalated",
  resolved: "text-status-resolved",
};

/** An issue status with an icon and a label, never color alone. */
export function StatusBadge({
  status,
  className,
}: {
  status: Issue["status"];
  className?: string;
}) {
  const Icon = statusIcons[status];
  return (
    <Badge
      variant="outline"
      className={cn("bg-background", statusColors[status], className)}
    >
      <Icon aria-hidden="true" />
      {statusNames[status]}
    </Badge>
  );
}

/** The status icon alone, for counts that show the label elsewhere. */
export function StatusIcon({
  status,
  className,
}: {
  status: Issue["status"];
  className?: string;
}) {
  const Icon = statusIcons[status];
  return (
    <Icon aria-hidden="true" className={cn(statusColors[status], className)} />
  );
}

/**
 * The seat number of a team location in a square tile, with the area above
 * it. Organisers find the team by its table first.
 */
export function PlaceTile({
  location,
  size = "md",
  inverted = false,
}: {
  location: string;
  size?: "sm" | "md" | "lg";
  inverted?: boolean;
}) {
  const place = placeOf(location);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-lg text-center leading-none",
        inverted ? "bg-primary text-primary-foreground" : "bg-muted",
        size === "sm" && "size-10",
        size === "md" && "size-12",
        size === "lg" && "size-14 rounded-xl",
      )}
    >
      <span className="px-0.5">
        {place.area && (
          <span className="block max-w-12 truncate text-[10px] opacity-70">
            {place.area}
          </span>
        )}
        <span
          className={cn(
            "block font-bold",
            size === "sm" ? "text-base" : "text-xl",
            size === "lg" && "text-2xl",
            !place.seat && "text-sm",
          )}
        >
          {place.seat || "—"}
        </span>
      </span>
    </span>
  );
}

/**
 * The unresolved time of an issue from its persisted timestamps. It turns
 * amber after 10 minutes and rose after 20 minutes while the issue is open.
 */
export function UnresolvedTimer({
  issue,
  resolutions,
  now,
  className,
}: {
  issue: Issue;
  resolutions: readonly Resolution[];
  now: number;
  className?: string;
}) {
  const ms = unresolvedTime(issue, resolutions, now);
  const resolved = issue.status === "resolved";
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        ageClass(ageTier(ms), resolved),
        className,
      )}
    >
      {clockDuration(ms)}
    </span>
  );
}

/** The Realtime state: Live, or Reconnecting while the channel is down. */
export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
    >
      {connected ? (
        <>
          <span className="size-2 rounded-full bg-emerald-500" />
          <Wifi aria-hidden="true" className="size-3.5" />
          Live
        </>
      ) : (
        <>
          <span className="size-2 animate-pulse rounded-full bg-amber-500" />
          <WifiOff aria-hidden="true" className="size-3.5" />
          Reconnecting
        </>
      )}
    </span>
  );
}

/** A round avatar with initials, or a dashed circle for nobody. */
export function PersonAvatar({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  return name ? (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold",
        className,
      )}
    >
      {initials(name)}
    </span>
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "size-8 shrink-0 rounded-full border border-dashed border-border",
        className,
      )}
    />
  );
}
