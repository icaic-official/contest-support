import { readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface Fixture {
  event: string;
  sessions: string[];
  teams: string[];
  accounts: Record<string, { id: string; email: string; password: string; username: string }>;
}
export const url = process.env.SUPABASE_URL ?? "";
export const anonKey = process.env.SUPABASE_ANON_KEY ?? "";
export function service(): SupabaseClient {
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Run through npm run test:cloud.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function fixture(): Fixture {
  return JSON.parse(
    readFileSync(process.env.MINSKY_CLOUD_FIXTURE ?? "", "utf8"),
  ) as Fixture;
}
export function save(value: Fixture) {
  writeFileSync(process.env.MINSKY_CLOUD_FIXTURE ?? "", JSON.stringify(value), {
    mode: 0o600,
  });
}
export async function account(name: string) {
  const details = fixture().accounts[name];
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword(details);
  if (error)
    throw new Error(`Test account ${name} could not sign in: ${error.message}`);
  return client;
}
export async function cleanup(state: Fixture) {
  const admin = service();
  // Delete only rows belonging to this run's UUID sessions. Never reset the project.
  if (state.sessions.length) {
    for (const table of [
      "admin_audit",
      "history",
      "awards",
      "resolutions",
      "issues",
      "changes",
      "staff_changes",
      "memberships",
      "teams",
    ]) {
      const { error } = await admin
        .from(table)
        .delete()
        .in("session_id", state.sessions);
      if (error)
        throw new Error(
          `Fixture cleanup failed for ${table}: ${error.message}`,
        );
    }
    const { error } = await admin
      .from("sessions")
      .delete()
      .in("id", state.sessions);
    if (error) throw error;
  }
  if (state.event) {
    const { error } = await admin.from("events").delete().eq("id", state.event);
    if (error) throw error;
  }
  for (const details of Object.values(state.accounts)) {
    const { error } = await admin.from("people").delete().eq("id", details.id);
    if (error) throw error;
    const { error: authError } = await admin.auth.admin.deleteUser(details.id);
    if (authError) throw authError;
  }
}
