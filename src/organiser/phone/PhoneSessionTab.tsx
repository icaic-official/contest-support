import { useState } from "react";
import { EventLink } from "@/event/EventLink";
import { SiteLink } from "@/site/SiteLink";
import { ActionSheet } from "../actions/ActionSheet";
import {
  AccountList,
  AdminActivity,
  AdminFeedback,
  Collapsible,
  MemberActions,
} from "../admin/AccountAccess";
import { CredentialReveal } from "../admin/CredentialReveal";
import { CategoryEditor, TeamLocationEditor } from "../admin/RosterEditors";
import {
  ImageLimitsForm,
  IntakePanel,
  StatusCounts,
} from "../admin/SessionSettings";
import { type SessionMember, limitsOfSession } from "../admin/adminModel";
import { type SessionAdmin, useSessionAdmin } from "../admin/useSessionAdmin";
import type { PhoneTabProps } from "./PhoneTabs";

/**
 * The content of the Session tab sheet: one account. The member copy keeps the
 * sheet filled while it closes.
 */
interface AdminSheet {
  userId: string;
  member: SessionMember;
}

/**
 * Session administration for admins: status counts, contestant intake,
 * image limits, accounts, team locations and categories. Password resets end on a
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
    resetPassword: (userId) => requests.resetPassword(userId).then(reveal),
  };
  const disabled = admin.busy || admin.archived;
  const selected =
    sheet
      ? (state.members.find((item) => item.person.id === sheet.userId) ??
        sheet.member)
      : undefined;
  const openSheet = (next: AdminSheet) => {
    admin.dismissCredentials();
    setSheet(next);
    setOpen(true);
  };
  const closeSheet = () => setOpen(false);
  let title = "Account";
  let description: string | undefined;
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
      <IntakePanel
        clock={state.clock}
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
        </div>
        <AccountList
          members={state.members}
          teams={state.teams}
          onOpen={(userId) => {
            const member = state.members.find(
              (item) => item.person.id === userId,
            );
            if (member) openSheet({ userId, member });
          }}
        />
        <p className="px-1 text-xs text-muted-foreground">
          Open an account to change its username or reset its password.
        </p>
      </section>
      <Collapsible title={`Team locations · ${state.teams.length}`}>
        <TeamLocationEditor state={state} admin={admin} />
      </Collapsible>
      <Collapsible title="Categories">
        <CategoryEditor state={state} admin={admin} />
      </Collapsible>
      <Collapsible title="Recent administration activity">
        <AdminActivity state={state} />
      </Collapsible>
      <EventLink data={shell.data} className="h-12 rounded-xl border bg-card px-4 text-[15px] font-medium" />
      <SiteLink className="h-12 rounded-xl border bg-card px-4 text-[15px] font-medium" />
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
                selfId={state.membership?.user_id}
                admin={admin}
                onDone={closeSheet}
              />
            )}
          </>
        )}
      </ActionSheet>
    </div>
  );
}
