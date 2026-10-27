import { Fragment, type ReactNode, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  Activity,
  Camera,
  KeyRound,
  Layers,
  LifeBuoy,
  type LucideIcon,
  LogOut,
  MapPin,
  Palette,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/organiser/components/issueDisplay";
import { currentPasswordFieldId } from "@/screens/PasswordForm";
import {
  AccessSection,
  ActivitySection,
  AppearanceSection,
  HelpSection,
  ProfileSection,
  SecuritySection,
  SessionsSection,
} from "./AccountSections";
import {
  accountKind,
  accountName,
  accountSections,
  accountTitle,
  capabilities,
  capabilityInfo,
} from "./accountModel";
import { useAvatarEditor } from "./hooks/useAvatarEditor";
import type { Membership, Snapshot } from "./model";
import {
  focusRequest,
  requestedFocusId,
  workspacePaths,
} from "./navigation";
import { PictureEditor } from "./PictureEditor";
import type { ShellProps } from "./shell";

type SectionId = (typeof accountSections)[number]["id"];

const sectionIcons: Record<SectionId, LucideIcon> = {
  profile: UserRound,
  access: ShieldCheck,
  sessions: Layers,
  security: KeyRound,
  appearance: Palette,
  activity: Activity,
  help: LifeBuoy,
};

/**
 * Returns a function that opens the Security section of the account page and
 * focuses the Current password field. It also works on the account page.
 */
export function useOpenPasswordChange(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate(
      { pathname: workspacePaths.account, hash: "#security" },
      { state: focusRequest(currentPasswordFieldId) },
    );
  }, [navigate]);
}

/**
 * Moves focus to the section that the address names, such as `#security`,
 * and scrolls it into view. A focus request in the location state picks one
 * control inside the section. The scroll container is not the window, so the
 * browser does not scroll on its own after a client-side navigation.
 */
function useSectionFocus(): void {
  const location = useLocation();
  const { hash, key } = location;
  const state: unknown = location.state;
  useEffect(() => {
    const id = hash.slice(1);
    if (!accountSections.some((section) => section.id === id)) return;
    const section = document.getElementById(id);
    if (!section) return;
    const requested = requestedFocusId(state);
    const target =
      (requested && document.getElementById(requested)) || section;
    target.focus({ preventScroll: true });
    section.scrollIntoView({ block: "start" });
  }, [hash, key, state]);
}

/**
 * The account settings page of the signed-in person for the selected
 * session. The contestant app and the organiser desktop console both render
 * it. The caller provides the scroll container and the page padding.
 */
export function AccountPage({
  shell,
  state,
  member,
  headingId,
  now,
  locked,
  onSessionChange,
}: {
  shell: ShellProps;
  state: Snapshot;
  member: Membership;
  headingId: string;
  /** The server-adjusted time for the relative times in Activity. */
  now: number;
  /** True while a workflow command runs. Switching session waits. */
  locked: boolean;
  /** Clears the caller's selection after the session changes. */
  onSessionChange: () => void;
}) {
  const { hash } = useLocation();
  useSectionFocus();
  const kind = accountKind(state, member);
  const picture = useAvatarEditor();
  const name = accountName(state, shell.user, shell.username);
  const title = accountTitle(kind, name);
  const login = shell.username ?? shell.user.email ?? shell.user.id;
  const props = { shell, state, member, kind };
  const views: Record<SectionId, ReactNode> = {
    profile: (
      <ProfileSection {...props} name={name} title={title} picture={picture} />
    ),
    access: <AccessSection {...props} />,
    sessions: (
      <SessionsSection
        shell={shell}
        locked={locked}
        onSessionChange={onSessionChange}
      />
    ),
    security: <SecuritySection shell={shell} />,
    appearance: <AppearanceSection />,
    activity: <ActivitySection {...props} now={now} />,
    help: <HelpSection />,
  };
  return (
    <div className="@container mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1
          id={headingId}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          My account
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your profile, access, security and preferences.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5 shadow-sm">
        <button
          type="button"
          aria-label="Change profile picture"
          disabled={picture.busy}
          onClick={picture.pick}
          className="relative shrink-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
        >
          <PersonAvatar
            name={title}
            personId={shell.user.id}
            className="size-16 text-xl"
          />
          <span
            aria-hidden="true"
            className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full border bg-background text-muted-foreground"
          >
            <Camera className="size-3.5" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{title}</p>
          <p className="truncate font-mono text-sm text-muted-foreground">
            {login}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {kind.kind === "team" ? (
              <>
                <Badge variant="secondary">
                  <Users aria-hidden="true" />
                  Team account
                </Badge>
                {kind.location && (
                  <Badge variant="outline">
                    <MapPin aria-hidden="true" />
                    {kind.location}
                  </Badge>
                )}
              </>
            ) : (
              capabilities(kind).map((capability) => (
                <Badge key={capability} variant="secondary">
                  {capabilityInfo[capability].label}
                </Badge>
              ))
            )}
          </div>
        </div>
        <Button type="button" variant="outline" onClick={shell.signOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </div>
      <PictureEditor picture={picture} />
      <div className="grid gap-6 @3xl:grid-cols-[12rem_minmax(0,1fr)]">
        <nav
          aria-label="Account sections"
          className="@3xl:sticky @3xl:top-6 @3xl:self-start"
        >
          <ul className="flex flex-wrap gap-1.5 @3xl:flex-col @3xl:gap-0.5">
            {accountSections.map(({ id, label }) => {
              const Icon = sectionIcons[id];
              return (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    aria-current={hash === `#${id}` ? "location" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      "aria-[current=location]:bg-accent aria-[current=location]:font-medium aria-[current=location]:text-accent-foreground",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    {label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          {accountSections.map(({ id }) => (
            <Fragment key={id}>{views[id]}</Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
