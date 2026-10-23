import { ArrowUpRight, CircleCheck, CircleDashed, CircleDot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { statusNames } from "@/connected/labels";
import type { Issue } from "@/connected/model";
import { cn } from "@/lib/utils";

const statusIcons = {
  open: CircleDashed,
  claimed: CircleDot,
  escalated: ArrowUpRight,
  resolved: CircleCheck,
} as const;

const statusColors: Record<Issue["status"], string> = {
  open: "text-status-open",
  claimed: "text-status-claimed",
  escalated: "text-status-escalated",
  resolved: "text-status-resolved",
};

/** An issue status with an icon and a label, never color alone. */
export function StatusBadge({ status }: { status: Issue["status"] }) {
  const Icon = statusIcons[status];
  return (
    <Badge variant="outline" className={cn("bg-background", statusColors[status])}>
      <Icon aria-hidden="true" />
      {statusNames[status]}
    </Badge>
  );
}
