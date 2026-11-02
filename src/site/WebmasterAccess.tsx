import type { ReactNode } from "react";
import { Link } from "react-router";
import { ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { SessionData } from "@/connected/hooks/useSessionSnapshot";
import { sitePath } from "@/connected/navigation";
import { JoinContests } from "./JoinContests";
import { joinContest, useSite } from "./useSite";

/**
 * What a webmaster sees when no contest is open to them: the contests to
 * join while the site restricts webmaster reads, and the way to the site
 * page, where the setting changes. Anyone else sees `fallback`.
 */
export function WebmasterAccess({
  data,
  fallback,
}: {
  data: SessionData;
  fallback: ReactNode;
}) {
  const state = useSite();
  const { site } = state;
  if (!site) return fallback;
  return (
    <div className="grid w-full max-w-md gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>
            <p role="alert">{state.error}</p>
          </AlertDescription>
        </Alert>
      )}
      {site.restrictWebmasterReads ? (
        <JoinContests
          contests={site.contestsToJoin}
          busy={state.busy}
          onJoin={(contestId) => void joinContest(state, data, contestId)}
        />
      ) : (
        fallback
      )}
      <Button asChild variant="outline" className="h-11">
        <Link to={sitePath}>
          <ShieldCheck aria-hidden="true" />
          Open the site page
        </Link>
      </Button>
    </div>
  );
}
