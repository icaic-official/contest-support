-- Emergency recovery for a lost sole-admin password. Provider credentials only.
create function public.begin_admin_recovery(p_target uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare token uuid := gen_random_uuid();
begin
  if not exists(select 1 from public.memberships m join public.sessions s on s.id=m.session_id
    join public.events e on e.id=s.event_id where m.user_id=p_target and m.is_admin and not e.archived)
    then raise exception 'Choose an existing admin of an active event.'; end if;
  insert into app_private.account_credentials(user_id,must_change,temporary_hash,sessions_after,operation)
  values(p_target,true,null,clock_timestamp(),token)
  on conflict (user_id) do update set must_change=true,temporary_hash=null,sessions_after=clock_timestamp(),operation=token
  where app_private.account_credentials.operation is null;
  if not found then raise exception 'A password reset is already in progress.'; end if;
  insert into public.admin_audit(session_id,actor,action,target)
  select session_id,p_target,'provider_admin_recovery',p_target from public.memberships where user_id=p_target and is_admin;
  return token;
end $$;
revoke all on function public.begin_admin_recovery(uuid) from public,anon,authenticated;
grant execute on function public.begin_admin_recovery(uuid) to service_role;
