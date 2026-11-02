import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Clock, KeyRound, LogOut, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import type { AccountIdentity, SiteOverview } from "@/backend/contracts";
import { BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { SessionData } from "@/connected/hooks/useSessionSnapshot";
import { useNow } from "@/connected/hooks/useNow";
import { useRouteFocus, workspacePaths } from "@/connected/navigation";
import { ConfirmDialog } from "@/organiser/admin/AccountAccess";
import { CredentialReveal } from "@/organiser/admin/CredentialReveal";
import { usernamePattern } from "@/organiser/admin/adminModel";
import type { Credentials } from "@/organiser/admin/useSessionAdmin";
import { PersonAvatar } from "@/organiser/components/issueDisplay";
import { JoinContests } from "./JoinContests";
import { joinContest, type SiteState, useSite } from "./useSite";

const headingId = "site-heading";

/**
 * The webmaster's site page: the webmasters, the read restriction, and the
 * contests to join while it is on. The server refuses every other person.
 */
export function SiteDashboard({
  user,
  data,
  signOut,
}: {
  user: AccountIdentity;
  data: SessionData;
  signOut: () => void;
}) {
  const state = useSite();
  const navigate = useNavigate();
  useRouteFocus(headingId, state.loaded);
  const { site } = state;
  async function join(contestId: string) {
    if (await joinContest(state, data, contestId)) void navigate(workspacePaths.queue);
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader name={user.name ?? ""} webmaster={!!site} signOut={signOut} />
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              id={headingId}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none"
            >
              Site
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The webmasters and the site setting.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to={workspacePaths.queue}>Open contests</Link>
          </Button>
        </div>
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p role="alert">{state.error}</p>
            </AlertDescription>
          </Alert>
        )}
        {site ? (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Webmasters site={site} self={user.id} state={state} />
            <div className="space-y-5">
              <SiteSetting site={site} state={state} />
              {site.restrictWebmasterReads && (
                <JoinContests
                  contests={site.contestsToJoin}
                  busy={state.busy}
                  onJoin={(contestId) => void join(contestId)}
                />
              )}
            </div>
          </div>
        ) : state.loaded ? (
          <Alert variant="destructive">
            <AlertDescription>
              <p role="alert">{state.readError}</p>
            </AlertDescription>
          </Alert>
        ) : (
          <div aria-busy="true" className="grid gap-5 lg:grid-cols-2">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        )}
      </div>
    </div>
  );
}

/** The viewer's own clock. It is not an event's time zone. */
function YourTime() {
  const now = useNow();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const time = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return (
    <div className="leading-tight">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock aria-hidden="true" className="size-3" />
        Your time
      </p>
      <p className="text-sm font-medium">
        <span className="font-mono tabular-nums">{time}</span>{" "}
        <span className="font-normal text-muted-foreground">{zone}</span>
      </p>
    </div>
  );
}

function SiteHeader({
  name,
  webmaster,
  signOut,
}: {
  name: string;
  webmaster: boolean;
  signOut: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
      <BrandMark />
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
        <YourTime />
        {webmaster && (
          <Badge variant="outline">
            <ShieldCheck aria-hidden="true" />
            Webmaster
          </Badge>
        )}
        <span className="hidden text-sm font-medium sm:inline">{name}</span>
        <ThemeToggle />
        <Button variant="ghost" onClick={signOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </header>
  );
}

function SiteCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card">
      <div className="flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

type Webmaster = SiteOverview["webmasters"][number];

/** A change to one webmaster that waits for confirmation. */
type Confirming = { kind: "remove" | "reset"; webmaster: Webmaster } | undefined;

function Webmasters({
  site,
  self,
  state,
}: {
  site: SiteOverview;
  self: string;
  state: SiteState;
}) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>();
  const [credentials, setCredentials] = useState<Credentials>();
  const [notice, setNotice] = useState("");
  async function issue(webmaster: Pick<Webmaster, "id">) {
    setNotice("");
    const issued = await state.issue(webmaster.id);
    if (!issued) return;
    if (issued.temporaryPassword) {
      setCredentials({ username: issued.username, password: issued.temporaryPassword });
    } else {
      setNotice("The password was issued, but this page did not receive it. Choose Reset password to issue a new one.");
    }
  }
  return (
    <SiteCard
      title="Webmasters"
      action={
        <Button type="button" variant="outline" size="sm" disabled={state.busy} onClick={() => setAdding(true)}>
          <UserPlus aria-hidden="true" />
          Add
        </Button>
      }
    >
      <ul className="divide-y">
        {site.webmasters.map((webmaster) => (
          <li key={webmaster.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <PersonAvatar name={webmaster.name} />
            <div className="min-w-0 flex-1 basis-32 leading-tight">
              <p className="truncate text-sm font-medium">
                {webmaster.name}
                {webmaster.id === self && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>
                )}
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground">{webmaster.username}</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {!webmaster.ready && <Badge variant="secondary">Needs a password</Badge>}
              {webmaster.id !== self && (webmaster.ready ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={state.busy}
                  aria-label={`Reset password for ${webmaster.name}`}
                  onClick={() => setConfirming({ kind: "reset", webmaster })}
                >
                  <KeyRound aria-hidden="true" />
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled={state.busy} onClick={() => void issue(webmaster)}>
                  Issue password
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={state.busy}
                aria-label={`Remove ${webmaster.name}`}
                onClick={() => setConfirming({ kind: "remove", webmaster })}
              >
                <UserMinus aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">The last webmaster cannot be removed.</p>
      <p role="status" className="mt-2 text-xs text-muted-foreground empty:hidden">
        {notice}
      </p>
      <AddWebmaster
        open={adding}
        busy={state.busy}
        error={state.error}
        onOpenChange={setAdding}
        onAdd={async (person) => {
          const receipt = await state.execute({ type: "add_webmaster", person });
          const added = receipt?.accountIds?.[0];
          if (!added) return;
          setAdding(false);
          await issue({ id: added });
        }}
      />
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        title={confirming?.kind === "reset"
          ? `Reset the password of ${confirming.webmaster.name}?`
          : `Remove ${confirming?.webmaster.name ?? "this webmaster"}?`}
        description={confirming?.kind === "reset"
          ? "The current password stops working, and every open session ends. The new password is shown once."
          : confirming?.webmaster.id === self
            ? "You lose site authority. You stay signed in."
            : "This person loses site authority, and every open session ends."}
        confirmLabel={confirming?.kind === "reset" ? "Reset password" : "Remove"}
        onConfirm={() => {
          if (!confirming) return;
          if (confirming.kind === "reset") void issue(confirming.webmaster);
          else void state.execute({ type: "remove_webmaster", accountId: confirming.webmaster.id });
        }}
      />
      <Dialog
        open={!!credentials}
        onOpenChange={(open) => {
          if (!open) setCredentials(undefined);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle>Webmaster password</DialogTitle>
            <DialogDescription>
              Give these to the webmaster in person.
            </DialogDescription>
          </DialogHeader>
          {credentials && (
            <CredentialReveal credentials={credentials} onDone={() => setCredentials(undefined)} />
          )}
        </DialogContent>
      </Dialog>
    </SiteCard>
  );
}

function AddWebmaster({
  open,
  busy,
  error,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  busy: boolean;
  /** The last command error. The form shows it only after its own submission. */
  error: string;
  onOpenChange: (open: boolean) => void;
  onAdd: (person: { name: string; username: string }) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle>Add a webmaster</DialogTitle>
          <DialogDescription>
            A webmaster runs the whole site. Minsky shows the first password once.
          </DialogDescription>
        </DialogHeader>
        <AddWebmasterForm busy={busy} error={error} onCancel={() => onOpenChange(false)} onAdd={onAdd} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted with the dialog, so each opening starts empty. */
function AddWebmasterForm({
  busy,
  error,
  onCancel,
  onAdd,
}: {
  busy: boolean;
  error: string;
  onCancel: () => void;
  onAdd: (person: { name: string; username: string }) => Promise<void>;
}) {
  const id = useId();
  const [submitted, setSubmitted] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitted(true);
    void onAdd({ name: String(form.get("name") ?? ""), username: String(form.get("username") ?? "") });
  }
  return (
    <>
      <form id={id} className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input id={`${id}-name`} name="name" required maxLength={200} autoComplete="off" className="h-11" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-username`}>Username</Label>
          <Input
            id={`${id}-username`}
            name="username"
            required
            pattern={usernamePattern}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-username-rule`}
            className="h-11 font-mono"
          />
          <p id={`${id}-username-rule`} className="text-xs text-muted-foreground">
            3 to 32 letters, digits, hyphens, or underscores. The webmaster types it to sign in.
          </p>
        </div>
        {submitted && !busy && error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p role="alert">{error}</p>
            </AlertDescription>
          </Alert>
        )}
      </form>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" form={id} className="h-11" disabled={busy} loading={busy}>
          Add webmaster
        </Button>
      </DialogFooter>
    </>
  );
}

function SiteSetting({ site, state }: { site: SiteOverview; state: SiteState }) {
  const id = useId();
  const on = site.restrictWebmasterReads;
  return (
    <SiteCard title="Site setting">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor={id} className="text-sm font-medium">
            Webmasters read contest data only after joining
          </Label>
          <p id={`${id}-state`} className="mt-1 text-xs text-muted-foreground">
            {on
              ? "On. A webmaster joins a contest before reading its issues and notes. The contest admins see every join in their audit."
              : "Off. Webmasters read every contest at once. Turn it on to make each webmaster join a contest first."}
          </p>
        </div>
        <Switch
          id={id}
          checked={on}
          disabled={state.busy}
          aria-describedby={`${id}-state`}
          onCheckedChange={(restricted) => void state.execute({ type: "set_webmaster_reads", restricted })}
        />
      </div>
    </SiteCard>
  );
}
