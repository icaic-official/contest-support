-- Session announcements are independent of issue images: separate records, snapshot, bucket and function.
-- SQLSTATE MN409 marks a stale revision so clients can offer a review instead of a retry.
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  title text not null check (length(btrim(title)) between 1 and 160),
  details text not null check (length(btrim(details)) between 1 and 10000),
  author uuid not null references public.people(id),
  author_name text not null,
  published_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  edited_at timestamptz,
  edited_by uuid references public.people(id),
  edited_name text,
  removed_at timestamptz,
  removed_by uuid references public.people(id),
  removed_name text,
  revision bigint not null default 0,
  unique(session_id,id),
  check (expires_at is null or expires_at > published_at),
  check ((removed_at is null) = (removed_by is null)),
  check ((edited_at is null) = (edited_by is null))
);
create index announcements_by_session on public.announcements(session_id,published_at desc);

create function public.can_manage_announcements(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (app_private.member(p_session)).is_admin
    or 'jury' = any((app_private.member(p_session)).roles), false)
$$;
create function app_private.announcement_access(p_session uuid,p_announcement uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (app_private.member(p_session)).user_id is not null and exists(
    select 1 from public.announcements a where a.session_id=p_session and a.id=p_announcement
    and (public.can_manage_announcements(p_session)
      or (a.removed_at is null and (a.expires_at is null or a.expires_at > statement_timestamp())))
  )
$$;
alter table public.announcements enable row level security;
revoke all on public.announcements from public,anon,authenticated;
grant select on public.announcements to authenticated;
create policy announcement_read on public.announcements for select to authenticated using (
  app_private.announcement_access(session_id,id)
);

create function public.announcement_command(p_session uuid,p_request uuid,p_action jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid(); who_name text; s public.sessions; m public.memberships;
  a public.announcements; receipt app_private.receipts; result uuid;
  kind text := p_action->>'type'; headline text; body text; expiry timestamptz; stamp timestamptz;
begin
  if who is null or p_request is null then raise exception 'Sign in first.'; end if;
  select * into s from public.sessions where id=p_session for update;
  select * into m from public.memberships where session_id=p_session and user_id=who for share;
  if m.user_id is null or not app_private.account_ready() then raise exception 'No access to this session.'; end if;
  if not public.can_manage_announcements(p_session) then raise exception 'Only session admins and jury can manage announcements.'; end if;
  if exists(select 1 from public.events where id=s.event_id and archived) then raise exception 'This event is archived.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(who::text||p_request::text,0));
  select * into receipt from app_private.receipts where actor=who and request_id=p_request;
  if found then
    if receipt.session_id<>p_session or receipt.command<>p_action then raise exception 'Request ID already used.'; end if;
    return receipt.result;
  end if;
  select name into who_name from public.people where id=who;
  stamp := clock_timestamp();
  if kind in ('publish','edit') then
    headline := btrim(p_action->>'title'); body := btrim(p_action->>'details');
    if headline is null or length(headline) not between 1 and 160 then raise exception 'Enter a title of 1 to 160 characters.'; end if;
    if body is null or length(body) not between 1 and 10000 then raise exception 'Enter details of 1 to 10,000 characters.'; end if;
    expiry := nullif(p_action->>'expires_at','')::timestamptz;
    if expiry is not null and expiry<=stamp then raise exception 'Choose a future expiry time or no expiry.'; end if;
  end if;
  if kind='publish' then
    insert into public.announcements(session_id,title,details,author,author_name,published_at,expires_at)
    values(p_session,headline,body,who,who_name,stamp,expiry) returning id into result;
  elsif kind in ('edit','remove') then
    select * into a from public.announcements where id=(p_action->>'id')::uuid and session_id=p_session for update;
    if a.id is null or a.removed_at is not null then raise exception 'Announcement unavailable.'; end if;
    if (p_action->>'revision') is null or (p_action->>'revision')::bigint<>a.revision then
      raise exception 'Announcement changed. Review the latest version and try again.' using errcode='MN409';
    end if;
    result := a.id;
    if kind='edit' then
      update public.announcements set title=headline,details=body,expires_at=expiry,
        edited_at=stamp,edited_by=who,edited_name=who_name,revision=revision+1 where id=a.id;
    else
      update public.announcements set removed_at=stamp,removed_by=who,removed_name=who_name,
        revision=revision+1 where id=a.id;
    end if;
  else raise exception 'Unknown announcement action.';
  end if;
  update public.sessions set revision=revision+1 where id=p_session;
  insert into app_private.receipts values(who,p_request,p_session,p_action,result);
  return result;
end $$;

create table public.announcement_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  announcement_id uuid not null,
  uploader uuid not null references public.people(id),
  uploader_name text not null,
  name text not null check (length(name) between 1 and 200),
  bytes bigint not null check (bytes between 1 and 10485760),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  uploaded_at timestamptz,
  status text not null default 'pending' check (status in ('pending','ready','removed','abandoned')),
  removed_at timestamptz,
  removed_by uuid references public.people(id),
  foreign key(session_id,announcement_id) references public.announcements(session_id,id),
  check (status<>'ready' or uploaded_at is not null)
);
create index announcement_images_by_parent on public.announcement_images(announcement_id,status);
create index announcement_images_by_session on public.announcement_images(session_id,status);
alter table public.announcement_images enable row level security;
revoke all on public.announcement_images from public,anon,authenticated;
grant select on public.announcement_images to authenticated,service_role;
create policy announcement_image_read on public.announcement_images for select to authenticated using (
  status='ready' and app_private.announcement_access(session_id,announcement_id)
);

create function public.begin_announcement_image(
  p_session uuid,p_announcement uuid,p_request uuid,p_name text,p_bytes bigint,p_type text,p_digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid(); who_name text; s public.sessions; a public.announcements;
  image public.announcement_images; receipt app_private.receipts; command jsonb; clean text; expired_paths jsonb;
begin
  select * into s from public.sessions where id=p_session for update;
  perform 1 from public.memberships where session_id=p_session and user_id=who for share;
  if who is null or p_request is null or not public.can_manage_announcements(p_session) then
    raise exception 'Only session admins and jury can manage announcements.';
  end if;
  if exists(select 1 from public.events where id=s.event_id and archived) then raise exception 'This event is archived.'; end if;
  select * into a from public.announcements where id=p_announcement and session_id=p_session for update;
  if a.id is null or a.removed_at is not null then raise exception 'Announcement unavailable.'; end if;
  command := jsonb_build_object('type','announcement_image','id',p_announcement,'name',p_name,
    'bytes',p_bytes,'content_type',p_type,'digest',p_digest);
  perform pg_advisory_xact_lock(hashtextextended(who::text||p_request::text,0));
  select * into receipt from app_private.receipts where actor=who and request_id=p_request;
  if found then
    if receipt.session_id<>p_session or receipt.command<>command then raise exception 'Request ID already used.'; end if;
    select * into image from public.announcement_images where id=receipt.result;
    if image.status not in ('pending','ready') or
      (image.status='pending' and image.created_at<=clock_timestamp()-interval '15 minutes') then
      raise exception 'Upload reservation expired. Select the image again.';
    end if;
    return jsonb_build_object('id',image.id,'status',image.status,'expired_paths','[]'::jsonb);
  end if;
  if p_bytes is null or p_bytes not between 1 and 10485760 then raise exception 'Choose an image of up to 10 MB.'; end if;
  if p_type is null or p_type not in ('image/jpeg','image/png','image/webp') or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Choose a JPEG, PNG, or WebP image.';
  end if;
  clean := left(replace(replace(regexp_replace(btrim(coalesce(p_name,'')),'[[:cntrl:]]','','g'),'/','-'),E'\\','-'),200);
  if clean='' then raise exception 'Choose an image with a file name.'; end if;
  with expired as (
    update public.announcement_images set status='abandoned'
    where announcement_id=a.id and status='pending' and created_at<=clock_timestamp()-interval '15 minutes'
    returning session_id,announcement_id,id
  )
  select coalesce(jsonb_agg(session_id::text||'/'||announcement_id::text||'/'||id::text),'[]'::jsonb)
  into expired_paths from expired;
  if (select count(*) from public.announcement_images where announcement_id=a.id and status in ('ready','pending'))>=4 then
    raise exception 'An announcement can have up to four images.';
  end if;
  select name into who_name from public.people where id=who;
  insert into public.announcement_images(session_id,announcement_id,uploader,uploader_name,name,bytes,content_type,digest)
  values(p_session,a.id,who,who_name,clean,p_bytes,p_type,p_digest) returning * into image;
  insert into app_private.receipts values(who,p_request,p_session,command,image.id);
  return jsonb_build_object('id',image.id,'status',image.status,'expired_paths',expired_paths);
end $$;

-- Only the authenticated image function writes objects. This caller RPC can
-- finalize only a stored object whose trusted Storage metadata matches its reservation.
create function public.complete_announcement_image(p_session uuid,p_image uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid(); s public.sessions; a public.announcements; image public.announcement_images;
  object_metadata jsonb; object_name text; who_name text;
begin
  select * into s from public.sessions where id=p_session for update;
  perform 1 from public.memberships where session_id=p_session and user_id=who for share;
  if not public.can_manage_announcements(p_session) then raise exception 'Only session admins and jury can manage announcements.'; end if;
  if exists(select 1 from public.events where id=s.event_id and archived) then raise exception 'This event is archived.'; end if;
  select * into image from public.announcement_images where id=p_image and session_id=p_session for update;
  select * into a from public.announcements where id=image.announcement_id and session_id=p_session for update;
  if image.id is null or image.uploader is distinct from who or a.removed_at is not null then raise exception 'Image unavailable.'; end if;
  if image.status='ready' then return; end if;
  if image.status<>'pending' or image.created_at<=clock_timestamp()-interval '15 minutes' then
    raise exception 'Upload reservation expired. Select the image again.';
  end if;
  object_name := p_session::text||'/'||a.id::text||'/'||image.id::text;
  select metadata into object_metadata from storage.objects where bucket_id='announcement-images' and name=object_name;
  if (object_metadata->>'size')::bigint is distinct from image.bytes
    or object_metadata->>'mimetype' is distinct from image.content_type then raise exception 'Upload the image before finishing.'; end if;
  select name into who_name from public.people where id=who;
  update public.announcement_images set status='ready',uploaded_at=clock_timestamp() where id=image.id;
  update public.announcements set edited_at=clock_timestamp(),edited_by=who,edited_name=who_name,revision=revision+1 where id=a.id;
  update public.sessions set revision=revision+1 where id=p_session;
end $$;

create function public.remove_announcement_image(p_session uuid,p_image uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid(); s public.sessions; image public.announcement_images; who_name text;
begin
  select * into s from public.sessions where id=p_session for update;
  perform 1 from public.memberships where session_id=p_session and user_id=who for share;
  if not public.can_manage_announcements(p_session) then raise exception 'Only session admins and jury can manage announcements.'; end if;
  if exists(select 1 from public.events where id=s.event_id and archived) then raise exception 'This event is archived.'; end if;
  select * into image from public.announcement_images where id=p_image and session_id=p_session for update;
  if image.id is null then raise exception 'Image unavailable.'; end if;
  if image.status='removed' then return p_session::text||'/'||image.announcement_id::text||'/'||image.id::text; end if;
  -- A pending file belongs to its uploader's request, which can still store it.
  if image.status<>'ready' then raise exception 'Image unavailable.'; end if;
  select name into who_name from public.people where id=who;
  update public.announcement_images set status='removed',removed_at=clock_timestamp(),removed_by=who where id=image.id;
  -- A removed announcement keeps its final attribution and revision.
  update public.announcements set edited_at=clock_timestamp(),edited_by=who,edited_name=who_name,revision=revision+1
    where id=image.announcement_id and removed_at is null;
  update public.sessions set revision=revision+1 where id=p_session;
  return p_session::text||'/'||image.announcement_id::text||'/'||image.id::text;
end $$;

create function app_private.read_announcement_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.announcement_images i where
    i.session_id::text||'/'||i.announcement_id::text||'/'||i.id::text=object_name
    and i.status='ready' and app_private.announcement_access(i.session_id,i.announcement_id))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('announcement-images','announcement-images',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
do $$ begin
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'Row level security must already be enabled on storage.objects.';
  end if;
end $$;
grant select on storage.objects to authenticated;
create policy announcement_object_read on storage.objects for select to authenticated
using(bucket_id='announcement-images' and app_private.read_announcement_object(name));

create function public.announcement_snapshot(p_session uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'announcements',coalesce((select jsonb_agg(a order by a.published_at desc,a.id)
      from public.announcements a where a.session_id=p_session),'[]'::jsonb),
    'images',coalesce((select jsonb_agg(i order by i.uploaded_at,i.id)
      from public.announcement_images i where i.session_id=p_session),'[]'::jsonb),
    'server_time',clock_timestamp())
$$;
revoke all on function public.can_manage_announcements(uuid),app_private.announcement_access(uuid,uuid),
  public.announcement_command(uuid,uuid,jsonb),public.begin_announcement_image(uuid,uuid,uuid,text,bigint,text,text),
  public.complete_announcement_image(uuid,uuid),public.remove_announcement_image(uuid,uuid),
  app_private.read_announcement_object(text),public.announcement_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.can_manage_announcements(uuid),app_private.announcement_access(uuid,uuid),
  public.announcement_command(uuid,uuid,jsonb),public.begin_announcement_image(uuid,uuid,uuid,text,bigint,text,text),
  public.complete_announcement_image(uuid,uuid),public.remove_announcement_image(uuid,uuid),
  app_private.read_announcement_object(text),public.announcement_snapshot(uuid) to authenticated;
