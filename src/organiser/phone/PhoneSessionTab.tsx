import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionSheet } from "../actions/ActionSheet";
import {
  AccountList,
  AdminActivity,
  AdminFeedback,
  Collapsible,
  MemberActions,
} from "../admin/AccountAccess";
import { AssignByIdForm, CreateAccountForm } from "../admin/AccountForms";
import { CredentialReveal } from "../admin/CredentialReveal";
import {
  ImageLimitsForm,
  IntakeSwitch,
  StatusCounts,
} from "../admin/SessionSettings";
import { type SessionMember, limitsOfSession } from "../admin/adminModel";
import { type SessionAdmin, useSessionAdmin } from "../admin/useSessionAdmin";
import type { PhoneTabProps } from "./PhoneTabs";

/**
 * The content of the Session tab sheet: a new account, or one account. The
 * member copy keeps the sheet filled while it closes after a removal.
 */
type AdminSheet =
  | { type: "create" }
  | { type: "member"; userId: string; member: SessionMember };

/**
 * Session administration for admins: status counts, contestant intake,
 * image limits and accounts. New accounts and password resets end on a
 * one-time credential screen in the same sheet. In an archived event every
 * change is disabled. `PhoneStatus` above the tab shows the archived banner.
 */
export function SessionTab({ state, shell }: PhoneTabProps) {
  const requests = useSessionAdmin(state, shell.data.refresh);
  // The sheet content stays until the closing animation ends, so it does
  // not change while the sheet moves down.
  const [sheet, setSheet] = useState<AdminSheet>();
  const [open, setOpen] = useState(false);
  const session = state.session;
  if (!session) return null;
  // New credentials open the sheet again if the admin closed it while the
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
    sheet?.type === "member"
      ? (state.members.find((item) => item.person.id === sheet.userId) ??
        sheet.member)
      : undefined;
  const openSheet = (next: AdminSheet) => {
    admin.dismissCredentials();
    setSheet(next);
    setOpen(true);
  };
  const closeSheet = () => setOpen(false);
  let title = "New account";
  let description: string | undefined =
    "One account per team. Individual accounts for staff.";
  if (admin.credentials) {
    title = "Share these credentials securely";
    description = undefined;
  } else if (selected) {
    title = selected.person.name;
    description = selected.person.username ?? "Username not assigned";
  }
  return (
    <div className="space-y-5">
      {!open && admin.error && (
        // The error stays in view, because the form that failed can be far
        // down the page.
        <AdminFeedback
          error={admin.error}
          notice=""
          className="sticky top-0 z-10 rounded-lg bg-background shadow-sm"
        />
      )}
      <AdminFeedback error="" notice={admin.notice} className="empty:hidden" />
      <StatusCounts issues={state.issues} />
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
      <section aria-labelledby="session-accounts" className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <h2
            id="session-accounts"
            className="flex-1 text-xs font-medium text-muted-foreground"
          >
            Accounts · {state.members.length}
          </h2>
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            disabled={disabled}
            onClick={() => openSheet({ type: "create" })}
          >
            <UserPlus aria-hidden="true" />
            New account
          </Button>
        </div>
        <AccountList
          members={state.members}
          teams={state.teams}
          onOpen={(userId) => {
            const member = state.members.find(
              (item) => item.person.id === userId,
            );
            if (member) openSheet({ type: "member", userId, member });
          }}
        />
        <p className="px-1 text-xs text-muted-foreground">
          Open an account to update permissions or reset access.
        </p>
      </section>
      <Collapsible title="Assign an existing account by ID">
        <p className="mb-3 text-sm text-muted-foreground">
          For trusted provisioning and accounts already created in Supabase.
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
      <ActionSheet
        open={open}
        onOpenChange={setOpen}
        onClosed={() => {
          setSheet(undefined);
          admin.dismissCredentials();
        }}
        title={title}
        description={description}
        showCancel={!admin.credentials}
      >
        {admin.credentials ? (
          <CredentialReveal
            credentials={admin.credentials}
            onDone={closeSheet}
          />
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
                onDone={closeSheet}
              />
            )}
            {sheet?.type === "create" && (
              <CreateAccountForm
                teams={state.teams}
                disabled={disabled}
                busy={admin.busy}
                onCreate={admin.createAccount}
              />
            )}
          </>
        )}
      </ActionSheet>
    </div>
  );
}
