import { ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { sitePath } from "@/connected/navigation";
import { cn } from "@/lib/utils";
import { useSite } from "./useSite";

/** A link to the site page. Only a webmaster sees it, because only a webmaster can read the site. */
export function SiteLink({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  const { site } = useSite();
  if (!site) return null;
  return (
    <Link
      to={sitePath}
      className={cn(
        "flex h-9 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
      <span className={cn(collapsed && "sr-only")}>Site</span>
    </Link>
  );
}
