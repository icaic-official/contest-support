import { type ReactNode, useId, useState } from "react";
import { Search, Settings2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { normalizeTeamText } from "@/connected/teamSearch";
import type { Snapshot } from "@/connected/model";
import { cn } from "@/lib/utils";
import { ActionDialog } from "../actions/ActionDialog";
import {
  AdminActivity,
  AdminFeedback,
  Collapsible,
  MemberActions,
} from "../admin/AccountAccess";
import { AssignByIdForm, CreateAccountForm } from "../admin/AccountForms";
import { CredentialReveal } from "../admin/CredentialReveal";
import { ImageLimitsForm, IntakeSwitch } from "../admin/SessionSettings";
import {
  accountKind,
  limitsOfSession,
  type SessionMember,
} from "../admin/adminModel";
import type { SessionAdmin } from "../admin/useSessionAdmin";
import { PersonAvatar } from "../components/issueDisplay";
import { visibleIssues } from "../organiserModel";
import type { ConsolePageProps } from "./consoleProps";
import { awardSummary, categoryCounts, ownerWorkload } from "./consoleModel";
import { StatCards } from "./IssueTable";
import { PageHeader } from "./QueuePages";

/** A card with a heading for the admin pages. */
function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("rounded-xl border bg-card p-5", className)}
    >
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Session health from the snapshot: status cards, reports by category, award
 * totals and the active issues of each owner.
 */
export function OverviewPage({ props }: { props: ConsolePageProps }) {
  const { state, member, now } = props;
  const issues = visibleIssues(state.issues, member);
  const categories = categoryCounts(issues, state.session?.categories ?? []);
  const most = Math.max(1, ...categories.map((item) => item.count));
  const awards = awardSummary(issues, state.awards);
  const workload = ownerWorkload(issues);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={`Session health for ${state.session?.name ?? "this session"} at a glance.`}
      />
      <StatCards issues={issues} state={state} now={now} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Reports by category">
          {categories.length ? (
            <ul className="space-y-3">
              {categories.map(({ category, count }) => (
                <li
                  key={category}
                  className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3 text-sm"
                >
                  <span className="truncate text-muted-foreground">
                    {category}
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-2.5 overflow-hidden rounded-full bg-muted"
                  >
                    <span
                      className="block h-full rounded-full bg-foreground/80"
                      style={{ width: `${(count / most) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No categories.</p>
          )}
        </Panel>
        <Panel
          title="Awards"
          description="An award decision and its application in the contest system are separate steps."
        >
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                [awards.minutes, "minutes decided"],
                [awards.pending, "pending application"],
                [awards.applied, "applied externally"],
                [awards.undecided, "resolved, no decision"],
              ] as const
            ).map(([value, label]) => (
              <div key={label} className="flex flex-col-reverse">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Active issues by owner" className="xl:col-span-2">
          {workload.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {workload.map((entry) => (
                <li
                  key={entry.owner}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <PersonAvatar name={entry.name} personId={entry.owner} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {entry.name}
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {entry.active} active
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nobody owns an active issue.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** The accounts dialog: a new account, or the actions of one account. */
type AccountDialog =
  | { type: "create" }
  | { type: "member"; userId: string; member: SessionMember };

function matchesAccount(
  item: SessionMember,
  teams: Snapshot["teams"],
  query: string,
): boolean {
  const text = normalizeTeamText(query);
  if (!text) return true;
  const kind = accountKind(item.membership, teams);
  return normalizeTeamText(
    [item.person.name, item.person.username ?? "", kind.team ?? "", ...kind.labels].join(" "),
  ).includes(text);
}

/**
 * The accounts of the session in a table, with a filter. Create account and
 * Manage open a dialog. A new account and a password reset end on the
 * one-time credential screen in the same dialog.
 */
export function AccountsPage({
  props,
  admin: requests,
}: {
  props: ConsolePageProps;
  admin: SessionAdmin;
}) {
  const { state } = props;
  const id = useId();
  const [query, setQuery] = useState("");
  // The dialog content stays until the closing animation ends.
  const [dialog, setDialog] = useState<AccountDialog>();
  const [open, setOpen] = useState(false);
  // New credentials open the dialog again if the admin closed it while the
  // request ran, because they are shown only once.
  const reveal = (done: boolean) => {
    if (done) setOpen(true);
    return done;
  };
  const admin: SessionAdmin = {
    ...requests,
    createAccount: (account) => requests.createAccount(account).then(reveal),
    resetPassword: (userId) => requests.resetPassword(userId).then(reveal),
  };
  const disabled = admin.busy || admin.archived;
  const selected =
    dialog?.type === "member"
      ? (state.members.find((item) => item.person.id === dialog.userId) ??
        dialog.member)
      : undefined;
  const openDialog = (next: AccountDialog) => {
    admin.dismissCredentials();
    setDialog(next);
    setOpen(true);
  };
  const close = () => setOpen(false);
  let title = "Create account";
  let description: string | undefined =
    "One account per team. Individual accounts for staff.";
  if (admin.credentials) {
    title = "Share these credentials securely";
    description = undefined;
  } else if (selected) {
    title = selected.person.name;
    description = selected.person.username ?? "Username not assigned";
  }
  const shown = state.members.filter((item) =>
    matchesAccount(item, state.teams, query),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Team accounts are shared. Staff accounts belong to one person and combine their roles."
        action={
          <Button
            type="button"
            disabled={disabled}
            onClick={() => openDialog({ type: "create" })}
          >
            <UserPlus aria-hidden="true" />
            Create account
          </Button>
        }
      />
      <div className="relative max-w-xs">
        <label htmlFor={`${id}-filter`} className="sr-only">
          Filter accounts
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={`${id}-filter`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, username, team or role"
          className="pl-9"
        />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <caption className="sr-only">
            Accounts · {state.members.length}
          </caption>
          <TableHeader>
            <TableRow className="text-xs hover:bg-transparent">
              <TableHead className="pl-4 text-muted-foreground">Name</TableHead>
              <TableHead className="text-muted-foreground">Username</TableHead>
              <TableHead className="text-muted-foreground">Access</TableHead>
              <TableHead className="pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((item) => {
              const kind = accountKind(item.membership, state.teams);
              return (
                <TableRow key={item.person.id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <PersonAvatar name={item.person.name} personId={item.person.id} />
                      <span className="font-medium">{item.person.name}</span>
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-xs text-muted-foreground",
                      item.person.username && "font-mono",
                    )}
                  >
                    {item.person.username ?? "Username not assigned"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {kind.team ? (
                        <Badge variant="outline">{kind.team}</Badge>
                      ) : (
                        kind.labels.map((label) => (
                          <Badge
                            key={label}
                            variant={label === "Admin" ? "default" : "outline"}
                          >
                            {label}
                          </Badge>
                        ))
                      )}
                      {!kind.team && !kind.labels.length && (
                        <span className="text-xs text-muted-foreground">
                          No roles
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      id={`account-${item.person.id}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        openDialog({
                          type: "member",
                          userId: item.person.id,
                          member: item,
                        })
                      }
                      aria-label={`Manage ${item.person.name}`}
                    >
                      <Settings2 aria-hidden="true" />
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!shown.length && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={4}
                  className="p-8 text-center text-sm text-muted-foreground"
                >
                  No matching accounts.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Collapsible title="Assign an existing account by ID">
          <p className="mb-3 text-sm text-muted-foreground">
            For trusted provisioning and accounts that already exist.
          </p>
          <AssignByIdForm
            teams={state.teams}
            disabled={disabled}
            onAssign={admin.saveMembership}
          />
        </Collapsible>
        <Collapsible title="Recent administration activity">
          <AdminActivity state={state} />
        </Collapsible>
      </div>
      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        onClosed={() => {
          setDialog(undefined);
          admin.dismissCredentials();
        }}
        title={title}
        description={description}
        showCancel={!admin.credentials}
      >
        {admin.credentials ? (
          <CredentialReveal credentials={admin.credentials} onDone={close} />
        ) : (
          <>
            <AdminFeedback
              error={admin.error}
              notice=""
              className="mb-3 empty:hidden"
            />
            {selected && (
              <MemberActions
                key={selected.person.id}
                member={selected}
                teams={state.teams}
                selfId={state.membership?.user_id}
                admin={admin}
                onDone={close}
              />
            )}
            {dialog?.type === "create" && (
              <CreateAccountForm
                teams={state.teams}
                disabled={disabled}
                busy={admin.busy}
                onCreate={admin.createAccount}
              />
            )}
          </>
        )}
      </ActionDialog>
    </div>
  );
}

/**
 * Session settings: contestant intake, image limits and the categories. In
 * an archived event every control is disabled.
 */
export function SettingsPage({
  props,
  admin,
}: {
  props: ConsolePageProps;
  admin: SessionAdmin;
}) {
  const session = props.state.session;
  if (!session) return null;
  const disabled = admin.busy || admin.archived;
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Session settings"
        description={`These settings apply to ${session.name}.`}
      />
      <IntakeSwitch
        open={session.intake_open}
        disabled={disabled}
        onChange={(next) => {
          void admin.setIntake(next);
        }}
      />
      <ImageLimitsForm
        key={`${session.max_image_bytes}-${session.max_images_per_issue}-${session.max_image_bytes_per_issue}`}
        limits={limitsOfSession(session)}
        disabled={disabled}
        onSave={(limits) => {
          void admin.saveImageLimits(limits);
        }}
      />
      <Panel
        title="Categories"
        description="Contestants choose one of these when they report an issue. A category editor is not available yet."
      >
        <div className="flex flex-wrap gap-2">
          {session.categories.map((category) => (
            <Badge key={category} variant="outline">
              {category}
            </Badge>
          ))}
        </div>
      </Panel>
    </div>
  );
}
