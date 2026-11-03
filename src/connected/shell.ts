import type { AccountIdentity } from "@/backend/contracts";
import type { SessionData } from "./hooks/useSessionSnapshot";

/** What the UI selector passes to the contestant and organiser shells. */
export interface ShellProps {
  user: AccountIdentity;
  /** The organizer-assigned username, or null for an older email login. */
  username: string | null;
  /** True when the account may change its own username. */
  canChangeUsername: boolean;
  /** Reads the username again, without the full account check screen. */
  refreshAccount: () => Promise<void>;
  data: SessionData;
  /**
   * Opens the full-screen password change. Only the phone Me tab uses it.
   * The other UIs change the password on the account page.
   */
  changePassword: () => void;
  signOut: () => void;
}
