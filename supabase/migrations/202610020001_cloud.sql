-- T0003. No accounts, fictional fixtures or automatic admin promotion in migrations.
create schema if not exists app_private;
revoke all on schema app_private from public;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contest_type text not null default 'group' check (contest_type = 'group'),
  archived boolean not null default false
);
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  name text not null,
  intake_open boolean not null default false,
  categories text[] not null default array['Problem statement','Devices','Backend','Other'],
  revision bigint not null default 0
);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  name text not null,
  location text not null,
  unique (session_id,id), unique (session_id,name)
);
create table public.people (
  id uuid primary key references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 200)
);
create function app_private.new_person() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.people(id,name) values (new.id,coalesce(nullif(left(btrim(new.raw_user_meta_data->>'name'),200),''),'New account'));
  return new;
end $$;
create trigger new_person after insert on auth.users for each row execute function app_private.new_person();
-- Existing provisioned accounts are people only, without permissions.
insert into public.people(id,name)
select id,coalesce(nullif(left(btrim(raw_user_meta_data->>'name'),200),''),'New account') from auth.users on conflict do nothing;

create table public.memberships (
  session_id uuid not null references public.sessions(id),
  user_id uuid not null references public.people(id),
  team_id uuid,
  roles text[] not null default '{}',
  is_admin boolean not null default false,
  primary key (session_id,user_id),
  foreign key (session_id,team_id) references public.teams(session_id,id),
  check (roles <@ array['volunteer','specialist','jury']),
  check ((team_id is not null and cardinality(roles)=0 and not is_admin)
      or (team_id is null and (cardinality(roles)>0 or is_admin)))
);
create table public.issues (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  session_id uuid not null references public.sessions(id),
  team_id uuid not null,
  reporter uuid not null references public.people(id),
  reporter_name text not null,
  category text not null,
  description text not null check (length(btrim(description)) between 1 and 2000),
  status text not null default 'open' check (status in ('open','claimed','escalated','resolved')),
  created_at timestamptz not null default clock_timestamp(),
  first_assigned_at timestamptz,
  owner uuid references public.people(id),
  owner_name text,
  resolved_at timestamptz,
  revision bigint not null default 0,
  unique (session_id,id),
  foreign key (session_id,team_id) references public.teams(session_id,id),
  check ((status='open' and owner is null and first_assigned_at is null) or
    (status<>'open' and owner is not null and first_assigned_at is not null)),
  check ((status='resolved') = (resolved_at is not null)),
  check (first_assigned_at >= created_at), check (resolved_at >= first_assigned_at)
);
create table public.resolutions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  issue_id uuid not null,
  actor uuid not null references public.people(id),
  actor_name text not null,
  at timestamptz not null,
  summary text not null check (length(btrim(summary)) between 1 and 2000),
  reopened_at timestamptz,
  reopened_by uuid references public.people(id),
  reopened_name text,
  reason text,
  unique (session_id,issue_id,id),
  foreign key (session_id,issue_id) references public.issues(session_id,id),
  check (reopened_at >= at),
  check ((reopened_at is null and reopened_by is null and reason is null) or
    (reopened_at is not null and reopened_by is not null and length(btrim(reason)) between 1 and 2000))
);
create unique index one_current_resolution on public.resolutions(issue_id) where reopened_at is null;
create table public.history (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  issue_id uuid not null,
  at timestamptz not null,
  actor uuid not null references public.people(id),
  actor_name text not null,
  text text not null,
  visibility text not null check (visibility in ('public','internal')),
  foreign key (session_id,issue_id) references public.issues(session_id,id)
);
create table public.awards (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  issue_id uuid not null unique,
  resolution_id uuid not null,
  minutes integer not null check (minutes >= 0),
  explanation text not null check (length(btrim(explanation)) between 1 and 2000),
  actor uuid not null references public.people(id),
  actor_name text not null,
  at timestamptz not null,
  applied_at timestamptz,
  applied_by uuid references public.people(id),
  applied_name text,
  foreign key (session_id,issue_id,resolution_id) references public.resolutions(session_id,issue_id,id),
  check ((applied_at is null) = (applied_by is null)), check (applied_at >= at)
);
create table public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  actor uuid not null references public.people(id),
  at timestamptz not null default clock_timestamp(),
  action text not null,
  target uuid references public.people(id),
  detail jsonb not null default '{}'
);
create table app_private.receipts (
  actor uuid not null, request_id uuid not null, session_id uuid not null,
  command jsonb not null, result uuid not null,
  primary key (actor,request_id)
);
-- Only opaque team-scoped invalidations reach Realtime. Private note text never does.
create table public.changes (
  session_id uuid not null,
  team_id uuid not null,
  revision bigint not null default 0,
  primary key (session_id,team_id),
  foreign key (session_id,team_id) references public.teams(session_id,id)
);

create function app_private.member(s uuid) returns public.memberships language sql stable security definer set search_path = '' as $$
  select m from public.memberships m where m.session_id=s and m.user_id=auth.uid()
$$;
create function public.is_session_admin(p_session uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((app_private.member(p_session)).is_admin,false)
$$;
create function app_private.staff(s uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((app_private.member(s)).team_id is null and
    ((app_private.member(s)).is_admin or cardinality((app_private.member(s)).roles)>0),false)
$$;
create function app_private.team_access(s uuid,t uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.staff(s) or coalesce((app_private.member(s)).team_id=t,false)
$$;
create function app_private.issue_access(i uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.issues x where x.id=i and app_private.team_access(x.session_id,x.team_id))
$$;

alter table public.events enable row level security;
alter table public.sessions enable row level security;
alter table public.teams enable row level security;
alter table public.people enable row level security;
alter table public.memberships enable row level security;
alter table public.issues enable row level security;
alter table public.resolutions enable row level security;
alter table public.history enable row level security;
alter table public.awards enable row level security;
alter table public.admin_audit enable row level security;
alter table public.changes enable row level security;
create policy event_read on public.events for select to authenticated using
  (exists(select 1 from public.sessions s where s.event_id=events.id));
create policy session_read on public.sessions for select to authenticated using
  ((app_private.member(id)).user_id is not null);
create policy team_read on public.teams for select to authenticated using (app_private.team_access(session_id,id));
create policy person_read on public.people for select to authenticated using
  (id=auth.uid() or exists(select 1 from public.memberships m where m.user_id=people.id and public.is_session_admin(m.session_id)));
create policy membership_read on public.memberships for select to authenticated using
  (user_id=auth.uid() or public.is_session_admin(session_id));
create policy issue_read on public.issues for select to authenticated using (app_private.team_access(session_id,team_id));
create policy resolution_read on public.resolutions for select to authenticated using (app_private.issue_access(issue_id));
create policy history_read on public.history for select to authenticated using
  (app_private.issue_access(issue_id) and (visibility='public' or app_private.staff(session_id)));
create policy award_read on public.awards for select to authenticated using (app_private.issue_access(issue_id));
create policy audit_read on public.admin_audit for select to authenticated using (public.is_session_admin(session_id));
create policy change_read on public.changes for select to authenticated using (app_private.team_access(session_id,team_id));
-- Supabase default grants vary by project. Explicitly remove direct writes.
revoke all on public.events,public.sessions,public.teams,public.people,public.memberships,
  public.issues,public.resolutions,public.history,public.awards,public.admin_audit,public.changes from anon,authenticated;
grant select on public.events,public.sessions,public.teams,public.people,public.memberships,
  public.issues,public.resolutions,public.history,public.awards,public.admin_audit,public.changes to authenticated;
grant usage on schema app_private to authenticated;
revoke all on all functions in schema app_private from public;
grant execute on function app_private.member(uuid),app_private.staff(uuid),app_private.team_access(uuid,uuid),app_private.issue_access(uuid) to authenticated;

create function public.workflow(p_session uuid,p_request uuid,p_action jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships; s public.sessions; i public.issues; r public.resolutions;
  receipt app_private.receipts; a public.awards;
  who uuid := auth.uid(); who_name text; support boolean;
  kind text := p_action->>'type'; txt text; vis text := 'public';
  affected uuid; result uuid; stamp timestamptz;
begin
  if who is null or p_request is null then raise exception 'Sign in first.'; end if;
  -- Lock order is session -> membership -> issue, also used by administration.
  select * into s from public.sessions where id=p_session for share;
  select * into m from public.memberships where session_id=p_session and user_id=who for share;
  if m.user_id is null then raise exception 'No access to this session.'; end if;
  if exists(select 1 from public.events where id=s.event_id and archived) then raise exception 'This event is archived.'; end if;
  select name into who_name from public.people where id=who;
  support := m.roles && array['volunteer','specialist'];
  perform pg_advisory_xact_lock(hashtextextended(who::text||p_request::text,0));
  select * into receipt from app_private.receipts where actor=who and request_id=p_request;
  if found then
    if receipt.session_id<>p_session or receipt.command<>p_action then raise exception 'Request ID already used.'; end if;
    return receipt.result;
  end if;
  if kind='submit' then
    if m.team_id is null and not support then raise exception 'Support or contestant membership required.'; end if;
    if m.team_id is not null and not s.intake_open then raise exception 'Contestant intake is closed.'; end if;
    affected := coalesce(m.team_id,(p_action->>'team_id')::uuid);
    if not exists(select 1 from public.teams where id=affected and session_id=p_session) then raise exception 'Choose a roster team.'; end if;
    if not coalesce((p_action->>'category')=any(s.categories),false) then raise exception 'Choose a configured category.'; end if;
    txt := btrim(p_action->>'description');
    if txt is null or length(txt) not between 1 and 2000 then raise exception 'Enter between 1 and 2,000 characters.'; end if;
    stamp := clock_timestamp();
    insert into public.issues(session_id,team_id,reporter,reporter_name,category,description,created_at)
    values(p_session,affected,who,who_name,p_action->>'category',txt,stamp) returning id into result;
    txt := 'Issue submitted: '||txt;
  else
    select * into i from public.issues where id=(p_action->>'issue_id')::uuid and session_id=p_session for update;
    if i.id is null or not app_private.team_access(p_session,i.team_id) then raise exception 'Issue unavailable.'; end if;
    if (p_action->>'revision') is null or (p_action->>'revision')::bigint<>i.revision then raise exception 'Issue changed. Refresh and try again.'; end if;
    result := i.id; affected := i.team_id; stamp := clock_timestamp();
    if kind in ('message','resolve','reopen','award') then
      txt := btrim(case kind when 'message' then p_action->>'text' when 'resolve' then p_action->>'summary'
        when 'reopen' then p_action->>'reason' else p_action->>'explanation' end);
      if txt is null or length(txt) not between 1 and 2000 then raise exception 'Enter between 1 and 2,000 characters.'; end if;
    end if;
    case kind
    when 'claim' then
      if not support or i.status<>'open' then raise exception 'Only support can claim an open issue.'; end if;
      update public.issues set owner=who,owner_name=who_name,status='claimed',first_assigned_at=stamp where id=i.id;
      txt := 'Issue claimed.';
    when 'escalate' then
      if not support or i.owner<>who or i.status<>'claimed' then raise exception 'Only the active owner can escalate.'; end if;
      update public.issues set status='escalated' where id=i.id;
      txt := 'Specialist handoff requested. Current owner retained.';
    when 'accept' then
      if not ('specialist'=any(m.roles)) or i.status<>'escalated' or i.owner=who then raise exception 'Another specialist must accept the handoff.'; end if;
      update public.issues set owner=who,owner_name=who_name,status='claimed' where id=i.id;
      txt := 'Specialist accepted ownership.';
    when 'message' then
      vis := coalesce(p_action->>'visibility','public');
      if i.status='resolved' or (m.team_id is null and not support and not ('jury'=any(m.roles))) then raise exception 'Conversation unavailable.'; end if;
      if vis not in ('public','internal') or (vis='internal' and not app_private.staff(p_session)) then raise exception 'Private notes are staff only.'; end if;
    when 'resolve' then
      if not support or i.owner is distinct from who or i.status not in ('claimed','escalated') then raise exception 'Only the active owner can resolve.'; end if;
      insert into public.resolutions(session_id,issue_id,actor,actor_name,at,summary) values(p_session,i.id,who,who_name,stamp,txt);
      update public.issues set status='resolved',resolved_at=stamp where id=i.id;
      txt := 'Resolved: '||txt;
    when 'reopen' then
      if i.status<>'resolved' or not (support or coalesce(m.team_id=i.team_id,false)) then raise exception 'Only support or the affected team can reopen.'; end if;
      update public.resolutions set reopened_at=stamp,reopened_by=who,reopened_name=who_name,reason=txt where issue_id=i.id and reopened_at is null;
      update public.issues set status='claimed',resolved_at=null where id=i.id;
      txt := 'Reopened: '||txt;
    when 'award' then
      if not ('jury'=any(m.roles)) or i.status<>'resolved' then raise exception 'Only jury can award a resolved issue.'; end if;
      select * into r from public.resolutions where issue_id=i.id and reopened_at is null;
      if (p_action->>'minutes') is null or (p_action->>'minutes') !~ '^[0-9]+$' then raise exception 'Enter non-negative whole minutes.'; end if;
      insert into public.awards(session_id,issue_id,resolution_id,minutes,explanation,actor,actor_name,at)
      values(p_session,i.id,r.id,(p_action->>'minutes')::integer,txt,who,who_name,stamp);
      txt := (p_action->>'minutes')||' minutes awarded: '||txt;
    when 'apply' then
      if not (support or 'jury'=any(m.roles)) then raise exception 'Staff confirmation required.'; end if;
      select * into a from public.awards where issue_id=i.id for update;
      if a.id is null or a.applied_at is not null then raise exception 'No pending award.'; end if;
      update public.awards set applied_at=stamp,applied_by=who,applied_name=who_name where id=a.id;
      txt := 'External application confirmed. No contest clock was changed by Minsky.';
    else raise exception 'Unknown action.';
    end case;
    update public.issues set revision=revision+1 where id=i.id;
  end if;
  insert into public.history(session_id,issue_id,at,actor,actor_name,text,visibility)
  values(p_session,result,stamp,who,who_name,txt,vis);
  insert into public.changes(session_id,team_id,revision) values(p_session,affected,1)
  on conflict (session_id,team_id) do update set revision=public.changes.revision+1;
  insert into app_private.receipts values(who,p_request,p_session,p_action,result);
  return result;
end $$;

create function public.manage_member(p_session uuid,p_user uuid,p_team uuid default null,p_roles text[] default '{}',p_admin boolean default false,p_remove boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sessions where id=p_session for update;
  if not public.is_session_admin(p_session) then raise exception 'Admin membership required.'; end if;
  if exists(select 1 from public.sessions s join public.events e on e.id=s.event_id where s.id=p_session and e.archived) then raise exception 'This event is archived.'; end if;
  if exists(select 1 from public.memberships where session_id=p_session and user_id=p_user and is_admin)
    and (p_remove or not p_admin) and (select count(*) from public.memberships where session_id=p_session and is_admin)=1
    then raise exception 'Cannot remove the last admin.'; end if;
  if p_remove then delete from public.memberships where session_id=p_session and user_id=p_user;
  else
    insert into public.memberships values(p_session,p_user,p_team,p_roles,p_admin)
    on conflict (session_id,user_id) do update set team_id=excluded.team_id,roles=excluded.roles,is_admin=excluded.is_admin;
  end if;
  insert into public.admin_audit(session_id,actor,action,target,detail) values(p_session,auth.uid(),
    case when p_remove then 'revoke_membership' else 'assign_membership' end,p_user,
    jsonb_build_object('team',p_team,'roles',p_roles,'admin',p_admin));
  update public.sessions set revision=revision+1 where id=p_session;
end $$;
create function public.set_intake(p_session uuid,p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sessions where id=p_session for update;
  if not public.is_session_admin(p_session) then raise exception 'Admin membership required.'; end if;
  if exists(select 1 from public.sessions s join public.events e on e.id=s.event_id where s.id=p_session and e.archived) then raise exception 'This event is archived.'; end if;
  if p_open is null then raise exception 'Choose intake state.'; end if;
  update public.sessions set intake_open=p_open,revision=revision+1 where id=p_session;
  insert into public.admin_audit(session_id,actor,action,detail) values(p_session,auth.uid(),'set_intake',jsonb_build_object('open',p_open));
end $$;
create function public.record_account_action(p_session uuid,p_target uuid,p_action text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sessions where id=p_session for share;
  if not public.is_session_admin(p_session) then raise exception 'Admin membership required.'; end if;
  if p_action not in ('invite','resend_invitation','recovery') then raise exception 'Invalid account action.'; end if;
  insert into public.admin_audit(session_id,actor,action,target) values(p_session,auth.uid(),p_action,p_target);
end $$;
-- Default PUBLIC execute grants must not expose mutators to anonymous callers.
revoke all on function public.workflow(uuid,uuid,jsonb),public.manage_member(uuid,uuid,uuid,text[],boolean,boolean),
  public.set_intake(uuid,boolean),public.record_account_action(uuid,uuid,text),public.is_session_admin(uuid) from public,anon;
grant execute on function public.workflow(uuid,uuid,jsonb),public.manage_member(uuid,uuid,uuid,text[],boolean,boolean),
  public.set_intake(uuid,boolean),public.record_account_action(uuid,uuid,text),public.is_session_admin(uuid) to authenticated;
-- Full replica rows on changes contain no issue content. RLS applies to each subscriber.
alter publication supabase_realtime add table public.changes,public.sessions;
-- One SQL statement gives the UI a consistent, RLS-filtered snapshot.
create function public.session_snapshot(p_session uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'session', (select to_jsonb(s) from public.sessions s where s.id=p_session),
  'event', (select to_jsonb(e) from public.events e join public.sessions s on s.event_id=e.id where s.id=p_session),
  'membership', (select to_jsonb(m) from public.memberships m where m.session_id=p_session and m.user_id=auth.uid()),
  'teams', coalesce((select jsonb_agg(t order by t.name) from public.teams t where t.session_id=p_session),'[]'),
  'issues', coalesce((select jsonb_agg(i order by i.number desc) from public.issues i where i.session_id=p_session),'[]'),
  'resolutions', coalesce((select jsonb_agg(r order by r.at,r.id) from public.resolutions r where r.session_id=p_session),'[]'),
  'history', coalesce((select jsonb_agg(h order by h.at,h.id) from public.history h where h.session_id=p_session),'[]'),
  'awards', coalesce((select jsonb_agg(a order by a.at) from public.awards a where a.session_id=p_session),'[]'),
  'members', coalesce((select jsonb_agg(jsonb_build_object('membership',to_jsonb(m),'person',to_jsonb(p)))
    from public.memberships m join public.people p on p.id=m.user_id where m.session_id=p_session and public.is_session_admin(p_session)),'[]'),
  'audit', coalesce((select jsonb_agg(a order by a.at desc) from (select * from public.admin_audit where session_id=p_session order by at desc limit 50) a),'[]'),
  'server_time', clock_timestamp()
)
$$;
revoke all on function public.session_snapshot(uuid) from public,anon;
grant execute on function public.session_snapshot(uuid) to authenticated;
