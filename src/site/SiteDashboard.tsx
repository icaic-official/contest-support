import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CalendarPlus, Clock, KeyRound, LogOut, ShieldCheck, Trash2, UserMinus, UserPlus } from "lucide-react";
import { type AccountIdentity, type EventCode, type PersonInput, type SiteOverview, deletionConfirmation, parseEventCode, parseHandle } from "@/backend/contracts";
import { BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  ReturningDialogContent as DialogContent,
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
import { Calendar } from "@/connected/Calendar";
import { useNow } from "@/connected/hooks/useNow";
import { eventPath, useRouteFocus, workspacePaths } from "@/connected/navigation";
import { ConfirmDialog } from "@/organiser/admin/AccountAccess";
import { CredentialReveal } from "@/organiser/admin/CredentialReveal";
import { usernamePattern } from "@/organiser/admin/adminModel";
import type { Credentials } from "@/organiser/admin/useSessionAdmin";
import { PersonAvatar } from "@/organiser/components/issueDisplay";
import { DeleteEventDialog } from "./DeleteEventDialog";
import { Deletions } from "./Deletions";
import { JoinContests } from "./JoinContests";
import { joinContest, type SiteState, useSite } from "./useSite";

const headingId = "site-heading";
const deletionsHeadingId = "site-deletions";

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
              The events, the webmasters, and the site setting.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to={workspacePaths.queue}>Open contests</Link>
          </Button>
        </div>
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{state.error}</p>
            </AlertDescription>
          </Alert>
        )}
        {site && state.readError && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>This page may be out of date. {state.readError}</p>
              <Button type="button" variant="outline" className="mt-2 h-11" onClick={() => void state.reload()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {site && (
          <section aria-label="Calendar of every event" className="rounded-xl border bg-card p-4 sm:p-5">
            <Calendar
              refreshKey={site.events.reduce((total, event) => total + event.contests, 0)}
              onOpen={(contest) => {
                data.selectSession(contest.id);
                void navigate(workspacePaths.queue);
              }}
            />
          </section>
        )}
        {site ? (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            <div className="space-y-5">
              <Events site={site} state={state} />
              {site.deletions.length > 0 && (
                <SiteCard title={`Deletions · ${site.deletions.length}`} headingId={deletionsHeadingId}>
                  <Deletions deletions={site.deletions} />
                </SiteCard>
              )}
              <Webmasters site={site} self={user.id} state={state} />
            </div>
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
              <p>{state.readError}</p>
              <Button type="button" variant="outline" className="mt-2 h-11" onClick={() => void state.reload()}>
                Retry
              </Button>
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
  headingId,
  children,
}: {
  title: string;
  action?: ReactNode;
  /** A heading that a finished command can move focus to. */
  headingId?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const id = headingId ?? generatedId;
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card">
      <div className="flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
        <h2 id={id} tabIndex={headingId ? -1 : undefined} className="text-sm font-semibold outline-none">
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
      setCredentials({ username: issued.handle, password: issued.temporaryPassword, signIn: { kind: "site" } });
    } else {
      setNotice("The password was issued, but this page did not receive it. Choose Reset password to issue a new one.");
    }
  }
  return (
    <SiteCard
      title="Webmasters"
      action={
        <Button type="button" variant="outline" className="h-11" onClick={() => {
          state.clearError();
          setAdding(true);
        }}>
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
              <p className="truncate font-mono text-xs text-muted-foreground">{webmaster.handle}</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {!webmaster.ready && <Badge variant="secondary">Needs a password</Badge>}
              {webmaster.id !== self && (webmaster.ready ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                 
                  aria-label={`Reset password for ${webmaster.name}`}
                  onClick={() => setConfirming({ kind: "reset", webmaster })}
                >
                  <KeyRound aria-hidden="true" />
                </Button>
              ) : (
                <Button type="button" variant="outline" className="h-11" onClick={() => void issue(webmaster)}>
                  Issue password
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="icon"
               
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
      <p role="status" className="mt-2 text-xs break-words text-muted-foreground empty:hidden">
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
        returnFocus
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
  onAdd: (person: PersonInput) => Promise<void>;
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
  onAdd: (person: PersonInput) => Promise<void>;
}) {
  const id = useId();
  const [submitted, setSubmitted] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitted(true);
    void onAdd({ name: String(form.get("name") ?? ""), handle: String(form.get("username") ?? "") });
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
              <p>{error}</p>
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
        <div className="flex min-h-11 items-center">
        <Switch
          id={id}
          checked={on}
         
          aria-describedby={`${id}-state`}
          onCheckedChange={(restricted) => void state.execute({ type: "set_webmaster_reads", restricted })}
        />
        </div>
      </div>
    </SiteCard>
  );
}

type SiteEvent = SiteOverview["events"][number];

/**
 * The events of the site. A webmaster creates an event with its first event
 * admin, then shares that admin's password once. The event admin runs the rest
 * in the event console.
 */
function Events({ site, state }: { site: SiteOverview; state: SiteState }) {
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<(Credentials & { eventName: string }) | undefined>();
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<SiteEvent | undefined>();
  // The deleted event's row, which opened the dialog, is gone. So focus moves to its progress.
  const deleted = useRef(false);
  return (
    <SiteCard
      title={`Events · ${site.events.length}`}
      action={
        <Button type="button" variant="outline" className="h-11" onClick={() => {
          state.clearError();
          setCreating(true);
        }}>
          <CalendarPlus aria-hidden="true" />
          Create event
        </Button>
      }
    >
      {site.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events yet. Create one and name its first event admin.</p>
      ) : (
        <ul className="divide-y">
          {site.events.map((item: SiteEvent) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1 basis-36 leading-tight">
                <p className="truncate text-sm font-medium">
                  {item.name || "Unnamed event"}
                  {item.archived && <span className="ml-1 text-xs font-normal text-muted-foreground">(archived)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="font-mono">{item.code}</span> · {item.contests} {item.contests === 1 ? "contest" : "contests"} ·{" "}
                  {item.accounts} {item.accounts === 1 ? "account" : "accounts"}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button asChild variant="outline" className="h-11">
                  <Link to={eventPath(item.id)} aria-label={`Open the console of ${deletionConfirmation(item).text}`}>
                    Open console
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  aria-label={`Delete ${deletionConfirmation(item).text}`}
                  onClick={() => {
                    state.clearError();
                    setDeleting(item);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Delete event
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="mt-2 text-xs break-words text-muted-foreground empty:hidden">
        {notice}
      </p>
      <DeleteEventDialog
        event={deleting}
        busy={state.busy}
        error={state.error}
        onOpenChange={(open) => {
          // The dialog stays open while its request runs, so its outcome closes it and places focus.
          if (!open && !state.busy) setDeleting(undefined);
        }}
        onCloseAutoFocus={(event) => {
          if (!deleted.current) return;
          deleted.current = false;
          event.preventDefault();
          document.getElementById(deletionsHeadingId)?.focus();
        }}
        onDelete={async (confirmName) => {
          if (!deleting) return;
          const receipt = await state.execute({ type: "delete_event", eventId: deleting.id, confirmName });
          if (!receipt) return;
          setNotice(`Deleting ${deletionConfirmation(deleting).text}. Its progress is under Deletions.`);
          deleted.current = true;
          setDeleting(undefined);
        }}
      />
      <CreateEvent
        open={creating}
        busy={state.busy}
        error={state.error}
        onOpenChange={setCreating}
        onCreate={async (input) => {
          const receipt = await state.execute({
            type: "create_event",
            name: input.name,
            code: input.code,
            timeZone: input.timeZone,
            firstAdmin: input.firstAdmin,
          });
          const adminId = receipt?.accountIds?.[0];
          if (!receipt?.eventId || !adminId) return;
          setCreating(false);
          const issued = await state.issue(adminId, receipt.eventId);
          if (issued?.temporaryPassword) {
            setCredentials({
              eventName: input.name,
              username: issued.handle,
              password: issued.temporaryPassword,
              signIn: { kind: "event", code: input.code as EventCode },
            });
          } else {
            setNotice(`${input.name} exists, but its first admin has no password yet. Open the console and choose Issue password.`);
          }
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
            <DialogTitle>First event admin of {credentials?.eventName}</DialogTitle>
            <DialogDescription>Give these to the event admin in person.</DialogDescription>
          </DialogHeader>
          {credentials && <CredentialReveal credentials={credentials} onDone={() => setCredentials(undefined)} />}
        </DialogContent>
      </Dialog>
    </SiteCard>
  );
}

function CreateEvent({
  open,
  busy,
  error,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; code: string; timeZone: string; firstAdmin: PersonInput }) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto">
        <DialogHeader className="text-left">
          <DialogTitle>Create an event</DialogTitle>
          <DialogDescription>
            The first event admin runs the event. Minsky shows that admin's first password once.
          </DialogDescription>
        </DialogHeader>
        <CreateEventForm busy={busy} error={error} onCancel={() => onOpenChange(false)} onCreate={onCreate} />
      </DialogContent>
    </Dialog>
  );
}

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone !== "";
  } catch {
    return false;
  }
}

/** Mounted with the dialog, so each opening starts empty. */
function CreateEventForm({
  busy,
  error,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  error: string;
  onCancel: () => void;
  onCreate: (input: { name: string; code: string; timeZone: string; firstAdmin: PersonInput }) => Promise<void>;
}) {
  const id = useId();
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState("");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = parseEventCode(String(form.get("code") ?? ""));
    const handle = parseHandle(String(form.get("admin-username") ?? ""));
    if (!code) return setProblem("Use 3 to 40 lowercase letters, digits, or hyphens for the event code.");
    if (!validTimeZone(String(form.get("time-zone") ?? "").trim())) {
      return setProblem("Choose a time zone from the list, for example Europe/London.");
    }
    if (!handle) return setProblem("Use 3 to 32 letters, digits, hyphens, or underscores for the admin username.");
    setProblem("");
    setSubmitted(true);
    void onCreate({
      name: String(form.get("name") ?? "").trim(),
      code,
      timeZone: String(form.get("time-zone") ?? "").trim(),
      firstAdmin: { name: String(form.get("admin-name") ?? "").trim(), handle },
    });
  }
  const field = "h-11 text-base md:text-sm";
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <>
      <form id={id} className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-name`}>Event name</Label>
          <Input id={`${id}-name`} name="name" required maxLength={200} autoComplete="off" className={field} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-code`}>Event code</Label>
          <Input
            id={`${id}-code`}
            name="code"
            required
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            aria-describedby={`${id}-code-rule`}
            className={`${field} font-mono`}
          />
          <p id={`${id}-code-rule`} className="text-xs text-muted-foreground">
            3 to 40 lowercase letters, digits, or hyphens, for example xxxx-olympiad-2026. People type it to sign in.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-zone`}>Time zone</Label>
          <Input id={`${id}-zone`} name="time-zone" required defaultValue={zone} list={`${id}-zones`} autoComplete="off" spellCheck={false} className={field} />
          <datalist id={`${id}-zones`}>
            {zones.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-admin-name`}>First event admin, name</Label>
          <Input id={`${id}-admin-name`} name="admin-name" required maxLength={200} autoComplete="off" className={field} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-admin-username`}>First event admin, username</Label>
          <Input
            id={`${id}-admin-username`}
            name="admin-username"
            required
            pattern={usernamePattern}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            className={`${field} font-mono`}
          />
        </div>
        {problem && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{problem}</p>
            </AlertDescription>
          </Alert>
        )}
        {submitted && !busy && error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{error}</p>
            </AlertDescription>
          </Alert>
        )}
      </form>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" form={id} className="h-11" disabled={busy} loading={busy}>
          Create event
        </Button>
      </DialogFooter>
    </>
  );
}
