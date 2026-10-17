import type { User } from "@supabase/supabase-js";
import type { SessionData } from "./hooks/useSessionSnapshot";

/** What the UI selector passes to the contestant and organiser shells. */
export interface ShellProps {
  user: User;
  /** The organizer-assigned username, or null for an older email login. */
  username: string | null;
  data: SessionData;
  /** Opens the voluntary password change screen. */
  changePassword: () => void;
  signOut: () => void;
}
