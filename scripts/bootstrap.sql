-- Run through a trusted Postgres connection or Supabase SQL Editor.
-- Replace the UUID, event/session names and roster BEFORE execution.
-- Auth account must already exist. No password or service key belongs in this file.
begin;
do $$
declare
  admin_user uuid := 'REPLACE_WITH_EXISTING_AUTH_USER_UUID';
  event_id uuid;
  session_id uuid;
begin
  if not exists(select 1 from auth.users where id=admin_user) then raise exception 'Provision the admin Auth account first.'; end if;
  if exists(select 1 from public.memberships where is_admin) then raise exception 'Already bootstrapped. Use the admin UI.'; end if;
  insert into public.events(name) values('Minsky development event') returning id into event_id;
  insert into public.sessions(event_id,name) values(event_id,'Development session') returning id into session_id;
  insert into public.teams(session_id,name,location) values
    (session_id,'Team Aurora','Hall A · Desk 12'),
    (session_id,'Team Cedar','Hall A · Desk 18'),
    (session_id,'Team Orbit','Hall B · Desk 04');
  update public.people set name='Development organizer' where id=admin_user;
  insert into public.memberships(session_id,user_id,is_admin) values(session_id,admin_user,true);
  insert into public.admin_audit(session_id,actor,action,target) values(session_id,admin_user,'trusted_bootstrap',admin_user);
end $$;
commit;
