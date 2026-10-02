import { createClient } from "@supabase/supabase-js";
import { type Command, snapshotSchema } from "./model";
import { z } from "zod";

const accountStatusSchema = z.object({
  username: z.string().nullable(),
  must_change: z.boolean(),
  session_valid: z.boolean(),
});
export type AccountStatus = z.infer<typeof accountStatusSchema>;
export async function accountStatus(): Promise<AccountStatus> {
  const { data, error } = await requireClient().rpc("account_status");
  if (error) throw error;
  return accountStatusSchema.parse(data);
}
export function loginIdentifier(value: string): string {
  const identifier = value.trim().toLowerCase();
  // Existing development accounts retain email login until an admin assigns a username.
  if (identifier.includes("@")) return identifier;
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(identifier)) {
    throw new Error("Enter your organizer-provided username.");
  }
  return `${identifier}@accounts.minsky.invalid`;
}

// Only public connection settings belong in a browser build.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const client = url && key
  ? createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  : undefined;

export function requireClient() {
  if (!client) {
    throw new Error(
      "Supabase connection is missing. Follow the cloud onboarding guide.",
    );
  }
  return client;
}
export function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "The request could not be completed.";
}
export async function snapshot(session: string) {
  const { data, error } = await requireClient().rpc("session_snapshot", {
    p_session: session,
  });
  if (error) throw error;
  return snapshotSchema.parse(data);
}
export async function execute(
  session: string,
  request: string,
  command: Command,
): Promise<string> {
  const { data, error } = await requireClient().rpc("workflow", {
    p_session: session,
    p_request: request,
    p_action: command,
  });
  if (error) throw error;
  return z.string().uuid().parse(data);
}
