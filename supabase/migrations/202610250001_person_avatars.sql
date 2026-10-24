-- Profile pictures belong to people, not sessions. The ready row is the person's current
-- avatar. Retired and expired rows keep their object names until the avatars function
-- confirms the file deletion. That function is the only writer of stored files.
-- Deleting a person fails while avatar rows exist, so a cleanup must delete the files first.
-- SQLSTATE MN422 marks a rejected picture request. MN410 marks an expired upload.
create table public.person_avatars (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  request_id uuid not null,
  bytes bigint not null check (bytes between 1 and 262144),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','ready','retired','expired')),
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  retired_at timestamptz,
  files_removed_at timestamptz,
  unique (person_id,request_id),
  check (status<>'ready' or ready_at is not null),
  check (status<>'retired' or retired_at is not null)
);
create unique index person_avatars_current on public.person_avatars(person_id) where status='ready';
alter table public.person_avatars enable row level security;
-- Callers read and write only through the functions below.
revoke all on public.person_avatars from public,anon,authenticated;

create function app_private.avatar_object(p_person uuid,p_avatar uuid) returns text
language sql immutable set search_path = '' as $$
  select p_person::text||'/'||p_avatar::text
$$;
-- Every ready account reads its own avatar. Staff of a session read the avatars of the
-- session's other staff. Team accounts read no one else's avatar.
create function app_private.avatar_visible(p_session uuid,p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_person=auth.uid() and app_private.account_ready())
    or (app_private.staff(p_session) and exists(select 1 from public.memberships m
      where m.session_id=p_session and m.user_id=p_person and m.team_id is null
        and (m.is_admin or cardinality(m.roles)>0)))
$$;
create function app_private.avatar_cleanup(p_person uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(app_private.avatar_object(a.person_id,a.id) order by a.created_at),'[]'::jsonb)
  from public.person_avatars a
  where a.person_id=p_person and a.status in ('retired','expired') and a.files_removed_at is null
$$;

create function public.avatar_list(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('person_id',a.person_id,'avatar_id',a.id) order by a.person_id),'[]'::jsonb)
  from public.person_avatars a where a.status='ready' and app_private.avatar_visible(p_session,a.person_id)
$$;

create function public.begin_avatar(p_request uuid,p_bytes bigint,p_type text,p_digest text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid(); avatar public.person_avatars;
begin
  if who is null or p_request is null or not app_private.account_ready() then raise exception 'Sign in first.'; end if;
  -- One avatar change per person at a time keeps one ready row and one row per request.
  perform 1 from public.people where id=who for update;
  select * into avatar from public.person_avatars where person_id=who and request_id=p_request;
  if found then
    if avatar.bytes<>p_bytes or avatar.content_type<>p_type or avatar.digest<>p_digest then
      raise exception 'This picture request ID has different content.' using errcode='MN422';
    end if;
    if avatar.status='expired' or (avatar.status='pending' and avatar.created_at<=clock_timestamp()-interval '15 minutes') then
      raise exception 'The picture upload expired. Select the picture again.' using errcode='MN410';
    end if;
    return jsonb_build_object('id',avatar.id,'status',avatar.status,'path',app_private.avatar_object(who,avatar.id));
  end if;
  if p_bytes is null or p_bytes not between 1 and 262144 then raise exception 'Choose a picture of up to 256 KB.' using errcode='MN422'; end if;
  if p_type is null or p_type not in ('image/jpeg','image/png','image/webp') or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Choose a JPEG, PNG, or WebP picture.' using errcode='MN422';
  end if;
  update public.person_avatars set status='expired'
    where person_id=who and status='pending' and created_at<=clock_timestamp()-interval '15 minutes';
  insert into public.person_avatars(person_id,request_id,bytes,content_type,digest)
  values(who,p_request,p_bytes,p_type,p_digest) returning * into avatar;
  return jsonb_build_object('id',avatar.id,'status',avatar.status,'path',app_private.avatar_object(who,avatar.id));
end $$;

-- The stored object must match the reservation. The result lists the caller's files to delete.
create function public.complete_avatar(p_avatar uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid(); avatar public.person_avatars; object_metadata jsonb;
begin
  if who is null or not app_private.account_ready() then raise exception 'Sign in first.'; end if;
  perform 1 from public.people where id=who for update;
  select * into avatar from public.person_avatars where id=p_avatar and person_id=who;
  if avatar.id is null then raise exception 'Picture unavailable.'; end if;
  if avatar.status='pending' and avatar.created_at<=clock_timestamp()-interval '15 minutes' then
    update public.person_avatars set status='expired' where id=avatar.id returning * into avatar;
  end if;
  if avatar.status='pending' then
    select metadata into object_metadata from storage.objects
      where bucket_id='person-avatars' and name=app_private.avatar_object(who,avatar.id);
    if (object_metadata->>'size')::bigint is distinct from avatar.bytes
      or object_metadata->>'mimetype' is distinct from avatar.content_type then
      raise exception 'Upload the picture before finishing.';
    end if;
    update public.person_avatars set status='retired',retired_at=clock_timestamp() where person_id=who and status='ready';
    update public.person_avatars set status='ready',ready_at=clock_timestamp() where id=avatar.id returning * into avatar;
  end if;
  return jsonb_build_object('status',avatar.status,'cleanup',app_private.avatar_cleanup(who));
end $$;

create function public.remove_avatar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
begin
  if who is null or not app_private.account_ready() then raise exception 'Sign in first.'; end if;
  perform 1 from public.people where id=who for update;
  update public.person_avatars set status='retired',retired_at=clock_timestamp() where person_id=who and status='ready';
  return jsonb_build_object('cleanup',app_private.avatar_cleanup(who));
end $$;

-- Only the avatars function confirms deleted files, with the service key.
create function public.avatar_files_removed(p_objects text[]) returns void
language sql security definer set search_path = '' as $$
  update public.person_avatars set files_removed_at=clock_timestamp()
  where status in ('retired','expired') and files_removed_at is null
    and app_private.avatar_object(person_id,id)=any(p_objects)
$$;

-- The object name has no session, so Storage allows a read in any session where the rule allows it.
create function app_private.read_avatar_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.person_avatars a
    where a.status='ready' and app_private.avatar_object(a.person_id,a.id)=object_name
      and (app_private.avatar_visible(null,a.person_id) or exists(select 1 from public.memberships m
        where m.user_id=a.person_id and app_private.avatar_visible(m.session_id,a.person_id))))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('person-avatars','person-avatars',false,262144,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
do $$ begin
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'Row level security must already be enabled on storage.objects.';
  end if;
end $$;
create policy avatar_object_read on storage.objects for select to authenticated
using(bucket_id='person-avatars' and app_private.read_avatar_object(name));

revoke all on function app_private.avatar_object(uuid,uuid),app_private.avatar_visible(uuid,uuid),
  app_private.avatar_cleanup(uuid),app_private.read_avatar_object(text),public.avatar_list(uuid),
  public.begin_avatar(uuid,bigint,text,text),public.complete_avatar(uuid),public.remove_avatar(),
  public.avatar_files_removed(text[]) from public,anon,authenticated;
grant execute on function app_private.read_avatar_object(text),public.avatar_list(uuid),
  public.begin_avatar(uuid,bigint,text,text),public.complete_avatar(uuid),public.remove_avatar() to authenticated;
grant execute on function public.avatar_files_removed(text[]) to service_role;
