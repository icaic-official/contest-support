import { useId } from "react";
import { Link } from "react-router";
import { LogOut } from "lucide-react";
import type { AccountIdentity } from "@/backend/contracts";
import { BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouteFocus, sitePath, workspacePaths } from "@/connected/navigation";
import { AssignmentsTab, ContestsTab } from "./ContestTabs";
import { CredentialSheet } from "./CredentialSheet";
import { EntrantsTab, PeopleTab } from "./PeopleTabs";
import { useEventConsole } from "./useEventConsole";

const headingId = "event-heading";

/**
 * The console of one event, for its event admins and for webmasters. Without
 * an event ID it opens the caller's own event. The server refuses anyone else.
 */
export function EventConsolePage({
  eventId,
  user,
  signOut,
  hasContests,
}: {
  eventId: string | undefined;
  user: AccountIdentity;
  signOut: () => void;
  /** True when the caller can open a contest, so the header links to the queue. */
  hasContests: boolean;
}) {
  const state = useEventConsole(eventId);
  const { console: data } = state;
  const tabsId = useId();
  useRouteFocus(headingId, state.loaded);
  const names = new Map<string, string>();
  const handles = new Map<string, string>();
  for (const person of data?.people ?? []) {
    names.set(person.id, person.name);
    if (person.handle) handles.set(person.id, person.handle);
  }
  for (const entrant of data?.entrants ?? []) {
    if (!entrant.accountId) continue;
    names.set(entrant.accountId, entrant.name);
    if (entrant.handle) handles.set(entrant.accountId, entrant.handle);
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
        <BrandMark />
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="hidden text-sm font-medium sm:inline">{user.name}</span>
          <ThemeToggle />
          <Button variant="ghost" onClick={signOut}>
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 id={headingId} tabIndex={-1} className="text-2xl font-semibold tracking-tight break-words outline-none">
              {data ? data.event.name : "Event console"}
            </h1>
            {data && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>
                  Event code <span className="font-mono">{data.event.code}</span>
                </span>
                {data.event.archived && <Badge variant="secondary">Archived</Badge>}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.manage === "site" && (
              <Button asChild variant="outline">
                <Link to={sitePath}>Site</Link>
              </Button>
            )}
            {hasContests && (
              <Button asChild variant="outline">
                <Link to={workspacePaths.queue}>Open contests</Link>
              </Button>
            )}
          </div>
        </div>
        {data ? (
          <Tabs defaultValue="people" className="gap-4">
            <div className="overflow-x-auto">
              <TabsList aria-label="Event console" id={tabsId} className="w-full min-w-max sm:w-fit">
                <TabsTrigger value="people" className="min-h-9 px-3">People</TabsTrigger>
                <TabsTrigger value="entrants" className="min-h-9 px-3">Entrants</TabsTrigger>
                <TabsTrigger value="contests" className="min-h-9 px-3">Contests</TabsTrigger>
                <TabsTrigger value="assignments" className="min-h-9 px-3">Assignments</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="people">
              <PeopleTab data={data} state={state} />
            </TabsContent>
            <TabsContent value="entrants">
              <EntrantsTab data={data} state={state} />
            </TabsContent>
            <TabsContent value="contests">
              <ContestsTab data={data} state={state} />
            </TabsContent>
            <TabsContent value="assignments">
              <AssignmentsTab data={data} state={state} />
            </TabsContent>
          </Tabs>
        ) : state.loaded ? (
          <Alert variant="destructive">
            <AlertDescription>
              <p role="alert">{state.readError}</p>
            </AlertDescription>
          </Alert>
        ) : (
          <div aria-busy="true" className="space-y-4">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        )}
      </div>
      {state.sheet && data && (
        <CredentialSheet
          sheet={state.sheet}
          code={data.event.code}
          names={names}
          handles={handles}
          onIssueAgain={(ids) => void state.issue(ids)}
          onClose={state.dismissSheet}
        />
      )}
    </div>
  );
}
