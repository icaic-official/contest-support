-- Correct T0005 without changing the migration already applied to development.
alter table public.attachments add column files_removed_at timestamptz;
alter table public.attachments add constraint attachment_files_removed_after_deletion
  check (files_removed_at is null or status = 'deleted');

-- Do not show a retry for an older removal whose two files are already gone.
update public.attachments a set files_removed_at = a.deleted_at
where a.status = 'deleted' and not exists (
  select 1 from storage.objects o where o.bucket_id = 'issue-attachments'
  and o.name = any(array[
    app_private.attachment_path(a.session_id, a.issue_id, a.id, 'original'),
    app_private.attachment_path(a.session_id, a.issue_id, a.id, 'thumbnail')
  ])
);

-- Failed deletion stays visible to its uploader across refresh. These rows are
-- cleanup tasks only; Storage never permits reading files marked deleted.
alter policy attachment_read on public.attachments using (
  (status = 'ready' and (
    (visibility = 'public' and app_private.issue_access(issue_id))
    or (visibility = 'internal' and app_private.staff(session_id) and app_private.issue_access(issue_id))
  )) or (
    status = 'deleted' and files_removed_at is null and deleted_by = auth.uid()
    and app_private.staff(session_id)
  )
);

create or replace function public.account_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'username', (select username from public.people where id = auth.uid()),
    'must_change', coalesce((select must_change from app_private.account_credentials where user_id = auth.uid()), false),
    'session_valid', app_private.valid_account_session(),
    'auth_session_id', auth.jwt()->>'session_id'
  )
$$;

-- Share an account lock with password setup/reset. A legacy account may have
-- no credentials row yet, so a row lock alone cannot protect against insertion.
create or replace function public.begin_password_reset(p_session uuid, p_target uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare token uuid := gen_random_uuid();
begin
  perform public.authorize_account_admin(p_session, p_target);
  if p_target = auth.uid() then raise exception 'Use Change password for your own account.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('attachment-account:' || p_target::text, 0));
  insert into app_private.account_credentials(user_id, must_change, temporary_hash, sessions_after, operation)
  values(p_target, true, null, clock_timestamp(), token)
  on conflict (user_id) do update set must_change = true, temporary_hash = null,
    sessions_after = clock_timestamp(), operation = token
  where app_private.account_credentials.operation is null;
  if not found then raise exception 'A password reset is already in progress.'; end if;
  insert into public.admin_audit(session_id, actor, action, target)
  values(p_session, auth.uid(), 'begin_password_reset', p_target);
  return token;
end $$;

create or replace function public.initialize_account(p_target uuid, p_username text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('attachment-account:' || p_target::text, 0));
  update public.people set username = p_username where id = p_target;
  insert into app_private.account_credentials(user_id, temporary_hash)
  select id, encrypted_password from auth.users where id = p_target;
end $$;

create or replace function public.begin_admin_recovery(p_target uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare token uuid := gen_random_uuid();
begin
  if not exists(select 1 from public.memberships m join public.sessions s on s.id = m.session_id
    join public.events e on e.id = s.event_id where m.user_id = p_target and m.is_admin and not e.archived) then
    raise exception 'Choose an existing admin of an active event.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('attachment-account:' || p_target::text, 0));
  insert into app_private.account_credentials(user_id, must_change, temporary_hash, sessions_after, operation)
  values(p_target, true, null, clock_timestamp(), token)
  on conflict (user_id) do update set must_change = true, temporary_hash = null,
    sessions_after = clock_timestamp(), operation = token
  where app_private.account_credentials.operation is null;
  if not found then raise exception 'A password reset is already in progress.'; end if;
  insert into public.admin_audit(session_id, actor, action, target)
  select session_id, p_target, 'provider_admin_recovery', p_target
  from public.memberships where user_id = p_target and is_admin;
  return token;
end $$;

create or replace function app_private.can_upload_attachment_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select a.uploader = auth.uid()
      and a.status = 'pending'
      and a.created_at > clock_timestamp() - interval '1 hour'
      and app_private.staff(a.session_id)
      and exists(select 1 from auth.sessions where user_id = auth.uid()
        and id = app_private.uuid_at(array[auth.jwt()->>'session_id'], 1))
      and not e.archived
      and object_name = any(array[
        app_private.attachment_path(a.session_id, a.issue_id, a.id, 'original'),
        app_private.attachment_path(a.session_id, a.issue_id, a.id, 'thumbnail')
      ])
    from public.attachments a
    join public.sessions s on s.id = a.session_id
    join public.events e on e.id = s.event_id
    where a.id = app_private.uuid_at(storage.foldername(object_name), 3)
  ), false)
$$;

create or replace function app_private.can_read_attachment_object(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select object_name = any(array[
      app_private.attachment_path(a.session_id, a.issue_id, a.id, 'original'),
      app_private.attachment_path(a.session_id, a.issue_id, a.id, 'thumbnail')
    ]) and (
      (a.status = 'ready' and (
        (a.visibility = 'public' and app_private.team_access(a.session_id, i.team_id))
        or (a.visibility = 'internal' and app_private.staff(a.session_id))
      )) or (
        a.status = 'pending' and a.uploader = auth.uid()
        and a.created_at > clock_timestamp() - interval '1 hour'
        and app_private.staff(a.session_id)
        and exists(select 1 from auth.sessions where user_id = auth.uid()
          and id = app_private.uuid_at(array[auth.jwt()->>'session_id'], 1))
      )
    )
    from public.attachments a
    join public.issues i on i.id = a.issue_id and i.session_id = a.session_id
    where a.id = app_private.uuid_at(storage.foldername(object_name), 3)
  ), false)
$$;

-- The Edge function obtains this login-session ID from the caller's authenticated
-- account_status RPC. Never retain the old service-only completion entrypoint.
drop function public.finish_attachment(uuid, uuid, bigint, text, bigint, text);
create function public.finish_attachment(
  p_uploader uuid, p_auth_session uuid, p_attachment uuid,
  p_size bigint, p_header text, p_thumb_size bigint, p_thumb_header text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.attachments; s public.sessions; i public.issues; m public.memberships;
  credentials app_private.account_credentials; login auth.sessions;
  kind text; thumb_kind text; located_session uuid; located_issue uuid;
  original_size bigint; thumb_size bigint; image_bytes bigint; image_count bigint;
  original_path text; thumb_path text; archived boolean;
begin
  if p_uploader is null or p_auth_session is null or p_attachment is null then
    raise exception 'Change your temporary password or sign in again.';
  end if;
  select session_id, issue_id into located_session, located_issue from public.attachments where id = p_attachment;
  if located_session is null then raise exception 'Upload the image before finishing.'; end if;
  -- Session -> event -> membership -> account lock -> login/credentials -> issue -> attachment.
  -- The session/membership locks serialize role changes. Account/login locks
  -- serialize password resets and deletion of a login while completion runs.
  select * into s from public.sessions where id = located_session for share;
  select e.archived into archived from public.events e where e.id = s.event_id for share;
  select * into m from public.memberships where session_id = located_session and user_id = p_uploader for share;
  if m.user_id is null then raise exception 'No access to this session.'; end if;
  if m.team_id is not null or not (m.is_admin or cardinality(m.roles) > 0) then
    raise exception 'You do not have permission to add images to this issue.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('attachment-account:' || p_uploader::text, 0));
  select * into login from auth.sessions where id = p_auth_session and user_id = p_uploader for share;
  select * into credentials from app_private.account_credentials where user_id = p_uploader for share;
  if login.id is null or coalesce(credentials.must_change, false)
    or credentials.operation is not null
    or (credentials.sessions_after is not null and
      (login.created_at is null or login.created_at < credentials.sessions_after)) then
    raise exception 'Change your temporary password or sign in again.';
  end if;
  if archived then raise exception 'This event is archived. Images cannot be added.'; end if;
  select * into i from public.issues where id = located_issue and session_id = located_session for update;
  select * into a from public.attachments where id = p_attachment for update;
  if a.uploader <> p_uploader then raise exception 'Upload the image before finishing.'; end if;
  if a.status = 'ready' then return; end if;
  if a.status <> 'pending' or a.created_at <= clock_timestamp() - interval '1 hour' then
    raise exception 'Upload the image before finishing.';
  end if;
  if p_header is null or p_header !~ '^[0-9a-fA-F]{6,64}$'
    or p_thumb_header is null or p_thumb_header !~ '^[0-9a-fA-F]{6,64}$' then
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
  select count(*) into image_count from public.attachments where issue_id = a.issue_id and status = 'ready';
  if image_count >= s.max_images_per_issue then
    raise exception 'This issue already has % images.', s.max_images_per_issue;
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
revoke all on function public.finish_attachment(uuid, uuid, uuid, bigint, text, bigint, text) from public, anon, authenticated;
grant execute on function public.finish_attachment(uuid, uuid, uuid, bigint, text, bigint, text) to service_role;

-- Expiration cleanup must remain discoverable after a failed Storage request.
-- Only files from expired uploads on this authorized issue are returned.
create function public.attachment_cleanup_paths(p_session uuid, p_issue uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare paths text[];
begin
  if not app_private.staff(p_session) then raise exception 'No access to this session.'; end if;
  if not exists(select 1 from public.issues where id = p_issue and session_id = p_session) then
    raise exception 'Issue unavailable.';
  end if;
  if exists(select 1 from public.events e join public.sessions s on s.event_id = e.id where s.id = p_session and e.archived) then
    raise exception 'This event is archived. Images cannot be added.';
  end if;
  select coalesce(array_agg(distinct o.name), '{}'::text[]) into paths
  from public.attachments a join storage.objects o on o.bucket_id = 'issue-attachments'
    and o.name = any(array[
      app_private.attachment_path(a.session_id, a.issue_id, a.id, 'original'),
      app_private.attachment_path(a.session_id, a.issue_id, a.id, 'thumbnail')
    ])
  where a.session_id = p_session and a.issue_id = p_issue and a.status = 'expired';
  return paths;
end $$;
revoke all on function public.attachment_cleanup_paths(uuid, uuid) from public, anon;
grant execute on function public.attachment_cleanup_paths(uuid, uuid) to authenticated;

-- Call only after Storage confirms deletion of both files. The uploader's
-- delete_attachment RPC already records and authorizes the removal request.
create function public.finish_attachment_removal(p_uploader uuid, p_attachment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.attachments set files_removed_at = coalesce(files_removed_at, clock_timestamp())
  where id = p_attachment and status = 'deleted' and deleted_by = p_uploader;
  if not found then raise exception 'Image unavailable.'; end if;
end $$;
revoke all on function public.finish_attachment_removal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_attachment_removal(uuid, uuid) to service_role;

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
  'pending_removals', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'issue_id', a.issue_id, 'original_name', a.original_name
    ) order by a.deleted_at, a.id)
    from public.attachments a where a.session_id = p_session and a.status = 'deleted'
      and a.files_removed_at is null and a.deleted_by = auth.uid()), '[]'),
  'members', coalesce((select jsonb_agg(jsonb_build_object('membership', to_jsonb(m), 'person', to_jsonb(p)))
    from public.memberships m join public.people p on p.id = m.user_id
    where m.session_id = p_session and public.is_session_admin(p_session)), '[]'),
  'audit', coalesce((select jsonb_agg(a order by a.at desc) from (
    select * from public.admin_audit where session_id = p_session order by at desc limit 50) a), '[]'),
  'server_time', clock_timestamp()
)
$$;
