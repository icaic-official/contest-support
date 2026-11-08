import { LogOut } from "lucide-react";
import { Link } from "react-router";
import { BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useRouteFocus, workspacePaths } from "@/connected/navigation";

/** What each staff page tells a person who holds no authority over it. */
export const levelRefusals = {
  site: { heading: "Site", message: "Only a webmaster can open the site page." },
  event: { heading: "Event console", message: "Only an event admin or a webmaster can change this event." },
} as const;

const headingId = "level-refusal-heading";

/**
 * The page of a person who holds no authority over the site or an event. It
 * stands in for the staff screen, so that the person never downloads that
 * code, and says what the screen says when the server refuses its read.
 */
export function NoLevelAccess({
  page,
  signOut,
}: {
  page: keyof typeof levelRefusals;
  signOut: () => void;
}) {
  const { heading, message } = levelRefusals[page];
  useRouteFocus(headingId, true);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
        <BrandMark />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" onClick={signOut}>
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 id={headingId} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
            {heading}
          </h1>
          <Button asChild variant="outline">
            <Link to={workspacePaths.queue}>Open contests</Link>
          </Button>
        </div>
        <Alert variant="destructive">
          <AlertDescription>
            <p>{message}</p>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
