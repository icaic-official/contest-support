-- Organizer-provisioned usernames. Passwords and password hashes stay in Auth.
alter table public.people add column username text unique
  check (username ~ '^[a-z0-9][a-z0-9_-]{2,31}$');
create table app_private.account_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  must_change boolean not null default true,
  temporary_hash text,
  sessions_after timestamptz,
  operation uuid
);
revoke all on app_private.account_credentials from public,anon,authenticated;

create function app_private.valid_account_session() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not exists (
    select 1 from app_private.account_credentials c where c.user_id=auth.uid()
    and c.sessions_after is not null and not exists (
      select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid
      and s.user_id=c.user_id and s.created_at >= c.sessions_after
    )
  )
$$;
create function app_private.account_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.valid_account_session() and not exists (
    select 1 from app_private.account_credentials where user_id=auth.uid() and must_change
  )
$$;
create function public.account_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'username',(select username from public.people where id=auth.uid()),
    'must_change',coalesce((select must_change from app_private.account_credentials where user_id=auth.uid()),false),
    'session_valid',app_private.valid_account_session()
  )
$$;
create function public.complete_password_change() returns void
language plpgsql security definer set search_path = '' as $$
declare c app_private.account_credentials;
begin
  if not app_private.valid_account_session() then raise exception 'Sign in again.'; end if;
  select * into c from app_private.account_credentials where user_id=auth.uid() for update;
  if not found or not c.must_change then return; end if;
  if c.operation is not null or c.temporary_hash is null or not exists (
    select 1 from auth.users where id=auth.uid() and encrypted_password<>c.temporary_hash
  ) then raise exception 'Change your temporary password first.'; end if;
  update app_private.account_credentials set must_change=false,temporary_hash=null where user_id=auth.uid();
end $$;

-- Every read policy and existing admin RPC uses this current membership helper.
create or replace function app_private.member(s uuid) returns public.memberships
language sql stable security definer set search_path = '' as $$
  select m from public.memberships m where m.session_id=s and m.user_id=auth.uid()
  and app_private.account_ready()
$$;
alter policy membership_read on public.memberships using
  (app_private.account_ready() and (user_id=auth.uid() or public.is_session_admin(session_id)));
alter policy person_read on public.people using
  (app_private.account_ready() and (id=auth.uid() or exists(select 1 from public.memberships m where m.user_id=people.id and public.is_session_admin(m.session_id))));
-- Preserve the versioned workflow implementation and guard its direct membership lookup.
alter function public.workflow(uuid,uuid,jsonb) rename to workflow_before_usernames;
alter function public.workflow_before_usernames(uuid,uuid,jsonb) set schema app_private;
revoke all on function app_private.workflow_before_usernames(uuid,uuid,jsonb) from public,anon,authenticated;
create function public.workflow(p_session uuid,p_request uuid,p_action jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.account_ready() then raise exception 'Change your temporary password or sign in again.'; end if;
  return app_private.workflow_before_usernames(p_session,p_request,p_action);
end $$;

-- Account-wide changes require admin access to every session of that identity.
create function public.authorize_account_admin(p_session uuid,p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_session_admin(p_session) then raise exception 'Admin membership required.'; end if;
  if exists(select 1 from public.sessions s join public.events e on e.id=s.event_id where s.id=p_session and e.archived)
    then raise exception 'This event is archived.'; end if;
  if not exists(select 1 from public.memberships where session_id=p_session and user_id=p_target)
    then raise exception 'Account is not in this session.'; end if;
  if exists(select 1 from public.memberships m join public.sessions s on s.id=m.session_id
    join public.events e on e.id=s.event_id where m.user_id=p_target
    and (not public.is_session_admin(m.session_id) or e.archived))
    then raise exception 'Account changes require admin access to all its active sessions; archived accounts cannot be changed.'; end if;
end $$;
create function public.register_username(p_session uuid,p_target uuid,p_username text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.authorize_account_admin(p_session,p_target);
  if p_username is null or p_username !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then raise exception 'Use 3–32 lowercase letters, digits, underscores or hyphens.'; end if;
  if exists(select 1 from public.people where id=p_target and username is not null and username<>p_username)
    then raise exception 'This account already has a username.'; end if;
  update public.people set username=p_username where id=p_target;
end $$;
create function public.begin_password_reset(p_session uuid,p_target uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare token uuid := gen_random_uuid();
begin
  perform public.authorize_account_admin(p_session,p_target);
  if p_target=auth.uid() then raise exception 'Use Change password for your own account.'; end if;
  insert into app_private.account_credentials(user_id,must_change,temporary_hash,sessions_after,operation)
  values(p_target,true,null,clock_timestamp(),token)
  on conflict (user_id) do update set must_change=true,temporary_hash=null,sessions_after=clock_timestamp(),operation=token
  where app_private.account_credentials.operation is null;
  if not found then raise exception 'A password reset is already in progress.'; end if;
  insert into public.admin_audit(session_id,actor,action,target) values(p_session,auth.uid(),'begin_password_reset',p_target);
  return token;
end $$;

-- Only the verified Edge Function can initialize/finalize a temporary password.
create function public.initialize_account(p_target uuid,p_username text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.people set username=p_username where id=p_target;
  insert into app_private.account_credentials(user_id,temporary_hash)
  select id,encrypted_password from auth.users where id=p_target;
end $$;
create function public.finish_password_reset(p_target uuid,p_operation uuid,p_success boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update app_private.account_credentials c set operation=null,
    temporary_hash=case when p_success then (select encrypted_password from auth.users where id=p_target) else null end
  where c.user_id=p_target and c.operation=p_operation;
  if not found then raise exception 'Password reset operation unavailable.'; end if;
end $$;
create or replace function public.record_account_action(p_session uuid,p_target uuid,p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sessions where id=p_session for share;
  if not public.is_session_admin(p_session) then raise exception 'Admin membership required.'; end if;
  if exists(select 1 from public.sessions s join public.events e on e.id=s.event_id where s.id=p_session and e.archived)
    then raise exception 'This event is archived.'; end if;
  if p_action not in ('create_account','set_username','reset_password') then raise exception 'Invalid account action.'; end if;
  insert into public.admin_audit(session_id,actor,action,target) values(p_session,auth.uid(),p_action,p_target);
end $$;

revoke all on function app_private.valid_account_session(),app_private.account_ready(),
  public.account_status(),public.complete_password_change(),public.workflow(uuid,uuid,jsonb),
  public.authorize_account_admin(uuid,uuid),public.register_username(uuid,uuid,text),public.begin_password_reset(uuid,uuid),
  public.initialize_account(uuid,text),public.finish_password_reset(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.account_ready(),public.account_status(),public.complete_password_change(),public.workflow(uuid,uuid,jsonb),
  public.authorize_account_admin(uuid,uuid),public.register_username(uuid,uuid,text),public.begin_password_reset(uuid,uuid) to authenticated;
grant execute on function public.initialize_account(uuid,text),public.finish_password_reset(uuid,uuid,boolean) to service_role;
