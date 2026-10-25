import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.117.2";
import { createAvatarHandler } from "./handler.ts";

function connect(
  url: string,
  key: string,
  authorization?: string,
): SupabaseClient {
  return createClient(url, key, {
    global: authorization
      ? { headers: { Authorization: authorization } }
      : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(createAvatarHandler({
  projectUrl: Deno.env.get("SUPABASE_URL") ?? "",
  publicKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  origins: (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",")
    .map((origin) => origin.trim()).filter(Boolean),
}, connect));
