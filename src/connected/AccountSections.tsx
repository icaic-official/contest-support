import { type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import {
  Archive,
  Camera,
  Check,
  CircleCheck,
  Copy,
  ExternalLink,
  Lock,
  LogOut,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { backend } from "@/backend";
import { errorMessage } from "@/backend/errors";
import { BuildId } from "@/components/build-id";
import { themeOptions } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { documentationUrl } from "@/lib/links";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { UsernameForm } from "@/organiser/admin/AccountForms";
import { setHandleCommand } from "@/organiser/admin/adminModel";
import { PersonAvatar } from "@/organiser/components/issueDisplay";
import { PasswordChangeForm } from "@/screens/PasswordForm";
import {
  type AccountActivityItem,
  accountActivity,
  type AccountKind,
  capabilities,
  capabilityInfo,
  teamAccountDescription,
} from "./accountModel";
import { AVATAR_SOURCE_MAX_BYTES } from "./avatarPicture";
import { Calendar } from "./Calendar";
import { calendarKey } from "./calendarModel";
import { type AvatarEditorControls, changePictureButtonId } from "./hooks/useAvatarEditor";
import { megabytes } from "./imageFile";
import { formatDate, relativeAge } from "./labels";
import type { Membership, Snapshot } from "./model";
import { canOpenPage, workspacePaths } from "./navigation";
import type { ShellProps } from "./shell";
import { Meta } from "@/components/meta";

/** What every section reads. The page builds it once. */
export interface AccountSectionProps {
  shell: ShellProps;
  state: Snapshot;
  member: Membership;
  kind: AccountKind;
}

/**
 * A titled card that the section nav links to. The section takes focus when
 * the address names it, so the section needs `tabIndex={-1}`.
 */
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const headingId = `account-${id}-heading`;
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="scroll-mt-6 outline-none"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId} className="text-base font-semibold">
              {title}
            </h2>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

/** One label and value row of a details list. */
function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0 @lg:grid-cols-[9rem_minmax(0,1fr)] @lg:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (result === "idle") return;
    const timer = window.setTimeout(() => setResult("idle"), 3000);
    return () => window.clearTimeout(timer);
  }, [result]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void copy();
        }}
      >
        {result === "copied" ? (
          <Check aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
        {result === "copied" ? "Copied" : "Copy"}
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {result === "copied" && `${label} copied.`}
        {result === "failed" && "Copy is not available. Select the text and copy it."}
      </span>
    </span>
  );
}

/**
 * The account's username. The server says whether the account may change it
 * (owner decision 14, 2026-11-01): a team account may not, because venue
 * staff read its username from the sign-in sheet, and a webmaster belongs to
 * no event.
 */
function OwnUsername({ shell, state }: AccountSectionProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ failed: boolean; text: string }>();
  const shown = <span className="font-mono">{shell.username ?? shell.user.email ?? "Not set"}</span>;
  const event = state.event;
  if (!shell.canChangeUsername || !event) return shown;
  return (
    <div className="grid max-w-sm gap-3">
      {shown}
      <UsernameForm
        key={shell.username ?? ""}
        current={shell.username}
        disabled={busy || event.archived}
        onSubmit={(next) => {
          setBusy(true);
          setResult(undefined);
          void backend.manage.execute(crypto.randomUUID(), setHandleCommand(event.id, shell.user.id, next))
            .then(async () => {
              setResult({ failed: false, text: `Username changed. Sign in with ${next} next time.` });
              await Promise.all([shell.refreshAccount(), shell.data.refresh()]);
            })
            .catch((cause: unknown) => setResult({ failed: true, text: errorMessage(cause) }))
            .finally(() => setBusy(false));
        }}
      />
      {result && (
        <p role={result.failed ? "alert" : "status"} className={cn("text-sm", result.failed ? "text-destructive" : "text-muted-foreground")}>
          {result.text}
        </p>
      )}
    </div>
  );
}

export function ProfileSection({
  shell,
  state,
  member,
  kind,
  name,
  title,
  picture,
}: AccountSectionProps & {
  name: string;
  title: string;
  picture: AvatarEditorControls;
}) {
  const { user } = shell;
  return (
    <Section
      id="profile"
      title="Profile"
      description="How this account appears in Minsky."
    >
      <dl className="divide-y">
        <Field label="Picture">
          <div className="flex flex-wrap items-center gap-4">
            <PersonAvatar
              name={title}
              personId={user.id}
              className="size-16 text-xl"
            />
            <div className="grid min-w-0 gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  id={changePictureButtonId}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={picture.busy}
                  onClick={picture.pick}
                >
                  <Camera aria-hidden="true" />
                  Change picture
                </Button>
                {picture.hasPicture && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={picture.busy}
                    onClick={picture.askRemove}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove picture
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground">
                JPEG, PNG or WebP, up to {megabytes(AVATAR_SOURCE_MAX_BYTES)} MB.
                Saving removes any location or camera data from the photo.
              </p>
            </div>
          </div>
        </Field>
        {kind.kind === "team" ? (
          <>
            <Field label="Team">{kind.teamName}</Field>
            {kind.location && <Field label="Location">{kind.location}</Field>}
          </>
        ) : (
          <Field label="Name">{name}</Field>
        )}
        <Field label="Username">
          <OwnUsername shell={shell} state={state} member={member} kind={kind} />
        </Field>
        <Field label="Account ID">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono break-all">{user.id}</span>
            <CopyButton value={user.id} label="account ID" />
          </div>
          <p className="mt-2 text-muted-foreground">
            A session admin can use this ID to add the account to a session.
          </p>
        </Field>
        <Field label="Account type">
          {kind.kind === "team" ? "Team account" : "Staff account"}
        </Field>
        <Field label="Signing in">
          <p>
            An organizer created your username and first password. If you
            forget your password, ask a session admin to reset it. The admin
            gives you a temporary password, and you choose a new one at your
            next sign in.
          </p>
        </Field>
      </dl>
    </Section>
  );
}

export function AccessSection({ state, member, kind }: AccountSectionProps) {
  const archived = Boolean(state.event?.archived);
  const held = capabilities(kind);
  return (
    <Section
      id="access"
      title="Access in this session"
      description="What this account can do in the session you have open."
    >
      <div className="space-y-5">
        <dl className="divide-y">
          <Field label="Event">{state.event?.name ?? "Your contest"}</Field>
          <Field label="Session">{state.session?.name ?? "No session"}</Field>
        </dl>
        {archived && (
          <Alert>
            <Archive aria-hidden="true" />
            <AlertDescription>
              This event is archived. Records are read only.
            </AlertDescription>
          </Alert>
        )}
        {kind.kind === "team" ? (
          <p className="text-sm">{teamAccountDescription}</p>
        ) : held.length ? (
          <ul aria-label="Roles" className="divide-y rounded-lg border">
            {held.map((capability) => (
              <li
                key={capability}
                className="flex flex-col gap-2 p-4 @lg:flex-row @lg:items-start @lg:gap-4"
              >
                <Badge variant="secondary" className="@lg:mt-0.5 @lg:w-28">
                  {capabilityInfo[capability].label}
                </Badge>
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {capabilityInfo[capability].description}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            This account has no staff role in this session. Ask a session
            admin to give it one.
          </p>
        )}
        {canOpenPage("accounts", member) && (
          <Button variant="outline" asChild>
            <Link to={workspacePaths.accounts}>Manage session accounts</Link>
          </Button>
        )}
      </div>
    </Section>
  );
}

export function SessionsSection({
  shell,
  locked,
  onSessionChange,
}: {
  shell: ShellProps;
  locked: boolean;
  onSessionChange: () => void;
}) {
  const { data } = shell;
  return (
    <Section
      id="sessions"
      title="Sessions"
      description="The contest sessions this account can open. Your role can differ in each one."
    >
      <ul aria-label="Contest sessions" className="divide-y rounded-lg border">
        {data.sessions.map((session) => {
          const current = session.id === data.sessionId;
          return (
            <li
              key={session.id}
              className="flex items-center gap-3 p-3 pl-4"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {session.name}
              </span>
              {current ? (
                <Badge variant="outline">
                  <Check aria-hidden="true" />
                  Current
                </Badge>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  aria-label={`Switch to ${session.name}`}
                  onClick={() => {
                    data.selectSession(session.id);
                    onSessionChange();
                  }}
                >
                  Switch
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-6">
        <Calendar
          currentId={data.sessionId}
          currentIntake={data.snapshot?.clock?.intake.reason}
          refreshKey={calendarKey(data.snapshot)}
          onOpen={(contest) => {
            data.selectSession(contest.id);
            onSessionChange();
          }}
        />
      </div>
    </Section>
  );
}

export function SecuritySection({ shell }: { shell: ShellProps }) {
  return (
    <Section
      id="security"
      title="Security"
      description="Change your password and manage this device."
    >
      <div className="space-y-6">
        <div className="max-w-md">
          <h3 className="text-sm font-medium">Change password</h3>
          <p className="mt-1 mb-5 text-sm text-muted-foreground">
            Enter your current password, then choose a new one.
          </p>
          <PasswordChangeForm successMessage="Your password was changed." />
        </div>
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">This device</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign out to end your sign in on this device.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={shell.signOut}>
            <LogOut aria-hidden="true" />
            Sign out of this device
          </Button>
        </div>
      </div>
    </Section>
  );
}

export function AppearanceSection() {
  const id = useId();
  const theme = useTheme();
  return (
    <Section
      id="appearance"
      title="Appearance"
      description="Choose the color theme for this device. Device follows your system setting."
    >
      <fieldset className="grid gap-3 @lg:grid-cols-3">
        <legend className="sr-only">Color theme</legend>
        {themeOptions.map(({ value, label, icon: Icon }) => {
          const selected = theme.preference === value;
          return (
            <label
              key={value}
              className={cn(
                "relative flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-medium has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                selected ? "border-primary bg-accent" : "hover:bg-accent/50",
              )}
            >
              <input
                type="radio"
                name={`${id}-theme`}
                checked={selected}
                onChange={() => theme.setPreference(value)}
                className="sr-only"
              />
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {selected && <Check aria-hidden="true" className="size-4" />}
            </label>
          );
        })}
      </fieldset>
    </Section>
  );
}

const activityKinds: Record<
  AccountActivityItem["kind"],
  { label: string; icon: typeof MessageSquare }
> = {
  reply: { label: "Reply", icon: MessageSquare },
  note: { label: "Internal note", icon: Lock },
  resolution: { label: "Resolution", icon: CircleCheck },
};

export function ActivitySection({
  state,
  member,
  kind,
  shell,
  now,
}: AccountSectionProps & { now: number }) {
  const activity = accountActivity(state, member, shell.user.id);
  const team = kind.kind === "team";
  const stats = [
    {
      label: team ? "Open reports" : "Open issues you own",
      value: activity.open,
    },
    {
      label: team ? "Resolved reports" : "Resolutions you recorded",
      value: activity.resolved,
    },
    {
      label: team ? "Messages you sent" : "Replies and notes",
      value: activity.messages,
    },
  ];
  return (
    <Section
      id="activity"
      title="Activity"
      description="What this account did in the session you have open."
    >
      <div className="space-y-6">
        <dl className="grid gap-3 @lg:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border p-4">
              <dt className="text-sm text-muted-foreground">{stat.label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        <div>
          <h3 className="text-sm font-medium">Recent</h3>
          {activity.recent.length ? (
            <ul aria-label="Recent activity" className="mt-3 divide-y rounded-lg border">
              {activity.recent.map((item) => {
                const { label, icon: Icon } = activityKinds[item.kind];
                return (
                  <li key={item.id} className="flex gap-3 p-3 pl-4">
                    <Icon
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        <Meta>
                          <span className="font-mono">ISS-{item.issueNumber}</span>
                          <span>{label}</span>
                          <time dateTime={item.at} title={formatDate(item.at)} className="tabular-nums">
                            {relativeAge(item.at, now)}
                          </time>
                        </Meta>
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm break-words">
                        {item.text}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {team
                ? "Your messages appear here after you write to the helpers."
                : "Your replies, notes and resolutions appear here after you record them."}
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}

export function HelpSection() {
  return (
    <Section
      id="help"
      title="Help"
      description="Guides for staff and contestants, and the version you are using."
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button variant="outline" asChild>
          <a href={documentationUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            Documentation
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          <BuildId />
        </p>
      </div>
    </Section>
  );
}
