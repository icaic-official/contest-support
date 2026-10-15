-- T0005. Issue images stay in a private bucket. Postgres records and policies
-- decide who can upload, preview, download or remove them.
alter table public.sessions
  add column max_image_bytes bigint not null default 10485760,
  add column max_images_per_issue integer not null default 12,
  add column max_image_bytes_per_issue bigint not null default 125829120;
alter table public.sessions
  add constraint session_image_file_size check (max_image_bytes between 1048576 and 52428800),
  add constraint session_image_count check (max_images_per_issue between 1 and 24),
  add constraint session_image_total check (max_image_bytes_per_issue between 1048576 and 125829120),
  add constraint session_image_file_within_total check (max_image_bytes <= max_image_bytes_per_issue);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  issue_id uuid not null,
  uploader uuid not null references public.people(id),
  uploader_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  uploaded_at timestamptz,
  visibility text not null check (visibility in ('public','internal')),
  declared_bytes bigint not null check (declared_bytes > 0),
  byte_size bigint,
  content_type text,
  original_name text not null check (length(original_name) between 1 and 200),
  status text not null default 'pending' check (status in ('pending','ready','deleted','expired')),
  deleted_at timestamptz,
  deleted_by uuid references public.people(id),
  foreign key (session_id, issue_id) references public.issues(session_id, id),
  check (
    (status = 'pending' and uploaded_at is null and byte_size is null and content_type is null and deleted_at is null and deleted_by is null)
    or (status = 'ready' and uploaded_at is not null and byte_size is not null and content_type is not null and deleted_at is null and deleted_by is null)
    or (status = 'deleted' and deleted_at is not null and deleted_by is not null)
    or (status = 'expired' and deleted_at is null and deleted_by is null)
  )
);
create index attachments_by_issue on public.attachments(issue_id, status);
alter table public.attachments enable row level security;
revoke all on public.attachments from public, anon, authenticated;
grant select on public.attachments to authenticated, service_role;
create policy attachment_read on public.attachments for select to authenticated using (
  status = 'ready' and (
    (visibility = 'public' and app_private.issue_access(issue_id))
    or (visibility = 'internal' and app_private.staff(session_id) and app_private.issue_access(issue_id))
  )
);

create function app_private.image_kind(header bytea) returns text
language sql immutable set search_path = '' as $$
  select case
    when header is null then null
    when octet_length(header) >= 3 and substring(header from 1 for 3) = '\xffd8ff'::bytea then 'image/jpeg'
    when octet_length(header) >= 8 and substring(header from 1 for 8) = '\x89504e470d0a1a0a'::bytea then 'image/png'
    when octet_length(header) >= 12
      and substring(header from 1 for 4) = convert_to('RIFF', 'UTF8')
      and substring(header from 9 for 4) = convert_to('WEBP', 'UTF8') then 'image/webp'
    else null
  end
$$;
create function app_private.uuid_at(parts text[], idx integer) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if parts is null or idx < 1 or idx > cardinality(parts) or parts[idx] is null then return null; end if;
  return parts[idx]::uuid;
exception when invalid_text_representation then return null;
end $$;
create function app_private.attachment_path(p_session uuid, p_issue uuid, p_attachment uuid, p_kind text) returns text
language sql immutable set search_path = '' as $$
  select p_session::text || '/' || p_issue::text || '/' || p_attachment::text || '/' || p_kind
$$;
create function app_private.record_image_activity(
  p_session uuid, p_issue uuid, p_team uuid, p_actor uuid, p_actor_name text, p_text text, p_visibility text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.history(session_id,issue_id,at,actor,actor_name,text,visibility)
  values(p_session,p_issue,clock_timestamp(),p_actor,p_actor_name,p_text,p_visibility);
  if p_visibility = 'public' then
    insert into public.changes(session_id,team_id,revision) values(p_session,p_team,1)
    on conflict (session_id,team_id) do update set revision = public.changes.revision + 1;
  else
    insert into public.staff_changes(session_id,revision) values(p_session,1)
    on conflict (session_id) do update set revision = public.staff_changes.revision + 1;
  end if;
end $$;

-- Storage policies call these as the signed-in user. Security definer lets the
-- check see a pending row that ordinary selects cannot return.
create function app_private.can_upload_attachment_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select a.uploader = auth.uid()
      and a.status = 'pending'
      and a.created_at > clock_timestamp() - interval '1 hour'
      and app_private.account_ready()
      and storage.filename(object_name) in ('original', 'thumbnail')
    from public.attachments a
    where a.id = app_private.uuid_at(storage.foldername(object_name), 3)
      and a.session_id = app_private.uuid_at(storage.foldername(object_name), 1)
      and a.issue_id = app_private.uuid_at(storage.foldername(object_name), 2)
  ), false)
$$;
create function app_private.can_read_attachment_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (
      a.status = 'ready' and (
        (a.visibility = 'public' and app_private.team_access(a.session_id, i.team_id))
        or (a.visibility = 'internal' and app_private.staff(a.session_id))
      )
    ) or (
      a.uploader = auth.uid() and a.status = 'pending'
      and a.created_at > clock_timestamp() - interval '1 hour'
      and app_private.account_ready()
    )
    from public.attachments a
    join public.issues i on i.id = a.issue_id and i.session_id = a.session_id
    where a.id = app_private.uuid_at(storage.foldername(object_name), 3)
      and a.session_id = app_private.uuid_at(storage.foldername(object_name), 1)
      and a.issue_id = app_private.uuid_at(storage.foldername(object_name), 2)
  ), false)
$$;

create function public.begin_attachment(
  p_session uuid, p_request uuid, p_issue uuid, p_visibility text, p_name text, p_bytes bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  m public.memberships; s public.sessions; i public.issues; receipt app_private.receipts;
  who_name text; clean text; command jsonb; result uuid; image_count bigint; image_bytes bigint;
  expired_paths jsonb := '[]'::jsonb; expired public.attachments;
begin
  if who is null or p_request is null then raise exception 'Sign in first.'; end if;
  if not app_private.account_ready() then raise exception 'Change your temporary password or sign in again.'; end if;
  select * into s from public.sessions where id = p_session for share;
  select * into m from public.memberships where session_id = p_session and user_id = who for share;
  if m.user_id is null then raise exception 'No access to this session.'; end if;
  if not app_private.staff(p_session) then raise exception 'You do not have permission to add images to this issue.'; end if;
  if exists(select 1 from public.events where id = s.event_id and archived) then
    raise exception 'This event is archived. Images cannot be added.';
  end if;
  command := jsonb_build_object(
    'type','begin_attachment','issue_id',p_issue,'visibility',p_visibility,'name',p_name,'bytes',p_bytes
  );
  perform pg_advisory_xact_lock(hashtextextended(who::text || p_request::text, 0));
  select * into receipt from app_private.receipts where actor = who and request_id = p_request;
  if found then
    if receipt.session_id <> p_session or receipt.command <> command then raise exception 'Request ID already used.'; end if;
    return jsonb_build_object(
      'id', receipt.result,
      'original_path', app_private.attachment_path(p_session, p_issue, receipt.result, 'original'),
      'thumbnail_path', app_private.attachment_path(p_session, p_issue, receipt.result, 'thumbnail'),
      'expired_paths', '[]'::jsonb
    );
  end if;
  select * into i from public.issues where id = p_issue and session_id = p_session for update;
  if i.id is null or not app_private.team_access(p_session, i.team_id) then raise exception 'Issue unavailable.'; end if;
  if p_visibility is null or p_visibility not in ('public','internal') then raise exception 'Choose who can see this image.'; end if;
  clean := regexp_replace(btrim(coalesce(p_name, '')), '[[:cntrl:]]', '', 'g');
  clean := replace(replace(clean, '/', '-'), E'\\', '-');
  clean := left(clean, 200);
  if length(btrim(clean)) < 1 then raise exception 'Choose a JPEG, PNG, or WebP image.'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > s.max_image_bytes then
    raise exception 'This image is larger than % MB.', s.max_image_bytes / 1048576;
  end if;
  for expired in
    update public.attachments set status = 'expired'
    where issue_id = i.id and status = 'pending' and created_at <= clock_timestamp() - interval '1 hour'
    returning *
  loop
    expired_paths := expired_paths || jsonb_build_array(
      app_private.attachment_path(expired.session_id, expired.issue_id, expired.id, 'original'),
      app_private.attachment_path(expired.session_id, expired.issue_id, expired.id, 'thumbnail')
    );
  end loop;
  select count(*), coalesce(sum(case when status = 'ready' then byte_size else declared_bytes end), 0)
  into image_count, image_bytes
  from public.attachments
  where issue_id = i.id and (status = 'ready' or (status = 'pending' and created_at > clock_timestamp() - interval '1 hour'));
  if image_count >= s.max_images_per_issue then
    raise exception 'This issue already has % images.', s.max_images_per_issue;
  end if;
  if image_bytes + p_bytes > s.max_image_bytes_per_issue then
    raise exception 'These images would exceed this issue''s % MB limit.', s.max_image_bytes_per_issue / 1048576;
  end if;
  select name into who_name from public.people where id = who;
  insert into public.attachments(
    session_id, issue_id, uploader, uploader_name, visibility, declared_bytes, original_name
  ) values (p_session, i.id, who, who_name, p_visibility, p_bytes, clean)
  returning id into result;
  insert into app_private.receipts values (who, p_request, p_session, command, result);
  return jsonb_build_object(
    'id', result,
    'original_path', app_private.attachment_path(p_session, i.id, result, 'original'),
    'thumbnail_path', app_private.attachment_path(p_session, i.id, result, 'thumbnail'),
    'expired_paths', expired_paths
  );
end $$;

-- Only the attachment function reads stored bytes and may mark an upload ready.
create function public.finish_attachment(
  p_uploader uuid, p_attachment uuid, p_size bigint, p_header text, p_thumb_size bigint, p_thumb_header text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.attachments; s public.sessions; i public.issues; kind text; thumb_kind text;
  located_session uuid; located_issue uuid;
  original_size bigint; thumb_size bigint; image_bytes bigint; original_path text; thumb_path text;
begin
  if p_uploader is null or p_attachment is null then raise exception 'Sign in first.'; end if;
  select session_id, issue_id into located_session, located_issue from public.attachments where id = p_attachment;
  if located_session is null then raise exception 'Upload the image before finishing.'; end if;
  select * into s from public.sessions where id = located_session for share;
  select * into i from public.issues where id = located_issue and session_id = located_session for update;
  select * into a from public.attachments where id = p_attachment for update;
  if a.status = 'ready' and a.uploader = p_uploader then return; end if;
  if a.uploader <> p_uploader or a.status <> 'pending' or a.created_at <= clock_timestamp() - interval '1 hour' then
    raise exception 'Upload the image before finishing.';
  end if;
  if exists(select 1 from public.events where id = s.event_id and archived) then
    raise exception 'This event is archived. Images cannot be added.';
  end if;
  if p_header is null or p_header !~ '^[0-9a-fA-F]{6,64}$' or p_thumb_header is null or p_thumb_header !~ '^[0-9a-fA-F]{6,64}$' then
    raise exception 'Choose a JPEG, PNG, or WebP image.';
  end if;
  kind := app_private.image_kind(decode(p_header, 'hex'));
  thumb_kind := app_private.image_kind(decode(p_thumb_header, 'hex'));
  if kind is null or thumb_kind is null or p_thumb_size is null or p_thumb_size < 1 or p_thumb_size > 524288 then
    raise exception 'Choose a JPEG, PNG, or WebP image.';
  end if;
  if p_size is null or p_size < 1 or p_size > a.declared_bytes or p_size > s.max_image_bytes then
    raise exception 'This image is larger than % MB.', s.max_image_bytes / 1048576;
  end if;
  original_path := app_private.attachment_path(a.session_id, a.issue_id, a.id, 'original');
  thumb_path := app_private.attachment_path(a.session_id, a.issue_id, a.id, 'thumbnail');
  select (metadata->>'size')::bigint into original_size from storage.objects
  where bucket_id = 'issue-attachments' and name = original_path;
  select (metadata->>'size')::bigint into thumb_size from storage.objects
  where bucket_id = 'issue-attachments' and name = thumb_path;
  if original_size is distinct from p_size or thumb_size is distinct from p_thumb_size then
    raise exception 'Upload the image before finishing.';
  end if;
  select coalesce(sum(case
    when status = 'ready' then byte_size
    when status = 'pending' and id <> a.id and created_at > clock_timestamp() - interval '1 hour' then declared_bytes
    else 0 end), 0)
  into image_bytes from public.attachments where issue_id = a.issue_id;
  if image_bytes + p_size > s.max_image_bytes_per_issue then
    raise exception 'These images would exceed this issue''s % MB limit.', s.max_image_bytes_per_issue / 1048576;
  end if;
  update public.attachments
  set status = 'ready', uploaded_at = clock_timestamp(), byte_size = p_size, content_type = kind
  where id = a.id;
  perform app_private.record_image_activity(
    a.session_id, a.issue_id, i.team_id, a.uploader, a.uploader_name, 'Image added.', a.visibility
  );
end $$;

create function public.delete_attachment(p_session uuid, p_attachment uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  m public.memberships; a public.attachments; i public.issues;
  paths text[];
begin
  if who is null then raise exception 'Sign in first.'; end if;
  if not app_private.account_ready() then raise exception 'Change your temporary password or sign in again.'; end if;
  perform 1 from public.sessions where id = p_session for share;
  select * into m from public.memberships where session_id = p_session and user_id = who for share;
  if m.user_id is null then raise exception 'No access to this session.'; end if;
  select * into a from public.attachments where id = p_attachment and session_id = p_session;
  if a.id is null then raise exception 'Image unavailable.'; end if;
  paths := array[
    app_private.attachment_path(a.session_id, a.issue_id, a.id, 'original'),
    app_private.attachment_path(a.session_id, a.issue_id, a.id, 'thumbnail')
  ];
  if a.status = 'deleted' and a.deleted_by = who then return paths; end if;
  select * into i from public.issues where id = a.issue_id and session_id = p_session for update;
  select * into a from public.attachments where id = p_attachment for update;
  if exists(select 1 from public.events e join public.sessions s on s.event_id = e.id where s.id = p_session and e.archived) then
    raise exception 'This event is archived. Images cannot be removed.';
  end if;
  if a.uploader <> who then raise exception 'Only the person who added this image can remove it.'; end if;
  if a.status <> 'ready' then raise exception 'Image unavailable.'; end if;
  update public.attachments set status = 'deleted', deleted_at = clock_timestamp(), deleted_by = who where id = a.id;
  perform app_private.record_image_activity(
    a.session_id, a.issue_id, i.team_id, who, a.uploader_name, 'Image removed.', a.visibility
  );
  return paths;
end $$;

create function public.abandon_attachment(p_session uuid, p_attachment uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  a public.attachments;
begin
  if who is null then raise exception 'Sign in first.'; end if;
  if not app_private.account_ready() then raise exception 'Change your temporary password or sign in again.'; end if;
  if not exists(select 1 from public.memberships where session_id = p_session and user_id = who) then
    raise exception 'No access to this session.';
  end if;
  select * into a from public.attachments where id = p_attachment and session_id = p_session for update;
  if a.id is null or a.uploader <> who or a.status not in ('pending','expired') then
    raise exception 'Image unavailable.';
  end if;
  if a.status = 'pending' then
    update public.attachments set status = 'expired' where id = a.id;
  end if;
  return array[
    app_private.attachment_path(a.session_id, a.issue_id, a.id, 'original'),
    app_private.attachment_path(a.session_id, a.issue_id, a.id, 'thumbnail')
  ];
end $$;

create function public.set_image_limits(p_session uuid, p_file_mb integer, p_count integer, p_total_mb integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sessions where id = p_session for share;
  if not public.is_session_admin(p_session) then raise exception 'Admin membership required.'; end if;
  if exists(select 1 from public.sessions s join public.events e on e.id = s.event_id where s.id = p_session and e.archived) then
    raise exception 'This event is archived.';
  end if;
  if p_file_mb is null or p_file_mb < 1 or p_file_mb > 50 then raise exception 'Choose a maximum image size from 1 to 50 MB.'; end if;
  if p_count is null or p_count < 1 or p_count > 24 then raise exception 'Choose a maximum of 1 to 24 images per issue.'; end if;
  if p_total_mb is null or p_total_mb < 1 or p_total_mb > 120 then raise exception 'Choose a maximum issue total from 1 to 120 MB.'; end if;
  if p_file_mb > p_total_mb then raise exception 'The issue total must be at least the maximum size of one image.'; end if;
  update public.sessions set
    max_image_bytes = p_file_mb::bigint * 1048576,
    max_images_per_issue = p_count,
    max_image_bytes_per_issue = p_total_mb::bigint * 1048576,
    revision = revision + 1
  where id = p_session;
  insert into public.admin_audit(session_id,actor,action,detail)
  values(p_session, auth.uid(), 'set_image_limits', jsonb_build_object('file_mb', p_file_mb, 'count', p_count, 'total_mb', p_total_mb));
end $$;

revoke all on function
  app_private.image_kind(bytea), app_private.uuid_at(text[], integer),
  app_private.attachment_path(uuid, uuid, uuid, text),
  app_private.record_image_activity(uuid, uuid, uuid, uuid, text, text, text),
  app_private.can_upload_attachment_object(text), app_private.can_read_attachment_object(text),
  public.begin_attachment(uuid, uuid, uuid, text, text, bigint),
  public.finish_attachment(uuid, uuid, bigint, text, bigint, text),
  public.delete_attachment(uuid, uuid), public.abandon_attachment(uuid, uuid),
  public.set_image_limits(uuid, integer, integer, integer)
from public, anon, authenticated;
grant execute on function
  app_private.can_upload_attachment_object(text), app_private.can_read_attachment_object(text),
  public.begin_attachment(uuid, uuid, uuid, text, text, bigint),
  public.delete_attachment(uuid, uuid), public.abandon_attachment(uuid, uuid),
  public.set_image_limits(uuid, integer, integer, integer)
to authenticated;
grant execute on function public.finish_attachment(uuid, uuid, bigint, text, bigint, text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-attachments', 'issue-attachments', false, 52428800, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
-- Supabase owns this table and enables RLS. The migration role cannot alter it.
-- Refuse to install policies if the managed security prerequisite is missing.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'Row level security must already be enabled on storage.objects.';
  end if;
end $$;
grant select, insert, update on storage.objects to authenticated;
create policy attachment_object_select on storage.objects for select to authenticated
using (bucket_id = 'issue-attachments' and app_private.can_read_attachment_object(name));
create policy attachment_object_insert on storage.objects for insert to authenticated
with check (bucket_id = 'issue-attachments' and app_private.can_upload_attachment_object(name));
create policy attachment_object_update on storage.objects for update to authenticated
using (bucket_id = 'issue-attachments' and app_private.can_upload_attachment_object(name))
with check (bucket_id = 'issue-attachments' and app_private.can_upload_attachment_object(name));

create or replace function public.session_snapshot(p_session uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'session', (select to_jsonb(s) from public.sessions s where s.id = p_session),
  'event', (select to_jsonb(e) from public.events e join public.sessions s on s.event_id = e.id where s.id = p_session),
  'membership', (select to_jsonb(m) from public.memberships m where m.session_id = p_session and m.user_id = auth.uid()),
  'teams', coalesce((select jsonb_agg(t order by t.name) from public.teams t where t.session_id = p_session), '[]'),
  'issues', coalesce((select jsonb_agg(i order by i.number desc) from public.issues i where i.session_id = p_session), '[]'),
  'resolutions', coalesce((select jsonb_agg(r order by r.at, r.id) from public.resolutions r where r.session_id = p_session), '[]'),
  'history', coalesce((select jsonb_agg(h order by h.at, h.id) from public.history h where h.session_id = p_session), '[]'),
  'awards', coalesce((select jsonb_agg(a order by a.at) from public.awards a where a.session_id = p_session), '[]'),
  'attachments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'issue_id', a.issue_id, 'uploader', a.uploader, 'uploader_name', a.uploader_name,
      'uploaded_at', a.uploaded_at, 'visibility', a.visibility, 'byte_size', a.byte_size,
      'content_type', a.content_type, 'original_name', a.original_name
    ) order by a.uploaded_at, a.id)
    from public.attachments a where a.session_id = p_session and a.status = 'ready'), '[]'),
  'members', coalesce((select jsonb_agg(jsonb_build_object('membership', to_jsonb(m), 'person', to_jsonb(p)))
    from public.memberships m join public.people p on p.id = m.user_id
    where m.session_id = p_session and public.is_session_admin(p_session)), '[]'),
  'audit', coalesce((select jsonb_agg(a order by a.at desc) from (
    select * from public.admin_audit where session_id = p_session order by at desc limit 50) a), '[]'),
  'server_time', clock_timestamp()
)
$$;
