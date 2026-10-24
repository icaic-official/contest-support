import type { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const migrations = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));

/**
 * Stand in for the managed Supabase Auth and Storage schemas in embedded
 * PostgreSQL, then apply every repository migration in order.
 */
export async function migrateSupabaseTestDatabase(db: PGlite): Promise<void> {
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}', encrypted_password text default 'initial-hash', banned_until timestamptz, deleted_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default clock_timestamp(),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create publication supabase_realtime;
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    -- Match the managed Storage table's security before application migrations.
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)] $$;
    grant usage on schema storage to authenticated, service_role;
    grant all on storage.buckets, storage.objects to authenticated, service_role;`,
  );
  for (const name of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrations, name), "utf8"));
  }
}
