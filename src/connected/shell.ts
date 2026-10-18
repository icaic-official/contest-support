import type { AccountIdentity } from "@/backend/contracts";
import type { SessionData } from "./hooks/useSessionSnapshot";

/** What the UI selector passes to the contestant and organiser shells. */
export interface ShellProps {
  user: AccountIdentity;
  /** The organizer-assigned username, or null for an older email login. */
  username: string | null;
  data: SessionData;
  /** Opens the voluntary password change screen. */
  changePassword: () => void;
  signOut: () => void;
}
