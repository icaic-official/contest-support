import { Link } from "react-router";
import { ClipboardList } from "lucide-react";
import type { SessionData } from "@/connected/hooks/useSessionSnapshot";
import { eventPath } from "@/connected/navigation";
import { cn } from "@/lib/utils";

/**
 * A link to the event console. Only a caller with event authority over the
 * open contest sees it. The server checks the authority again on every read.
 */
export function EventLink({
  data,
  collapsed = false,
  className,
}: {
  data: Pick<SessionData, "sessions" | "sessionId">;
  collapsed?: boolean;
  className?: string;
}) {
  const open = data.sessions.find((item) => item.id === data.sessionId);
  if (!open || (open.manage !== "event" && open.manage !== "site")) return null;
  return (
    <Link
      to={eventPath(open.eventId)}
      className={cn(
        "flex h-9 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <ClipboardList aria-hidden="true" className="size-4 shrink-0" />
      <span className={cn(collapsed && "sr-only")}>Event console</span>
    </Link>
  );
}
