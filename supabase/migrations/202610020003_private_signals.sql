-- Internal notes must not disclose their existence through public revision counts
-- or contestant Realtime signals. Staff receive a separate RLS-protected signal.
create table public.staff_changes (
  session_id uuid primary key references public.sessions(id),
  revision bigint not null default 0
);
alter table public.staff_changes enable row level security;
revoke all on public.staff_changes from anon,authenticated;
grant select on public.staff_changes to authenticated;
create policy staff_change_read on public.staff_changes for select to authenticated using (app_private.staff(session_id));
alter publication supabase_realtime add table public.staff_changes;

create or replace function public.workflow(p_session uuid,p_request uuid,p_action jsonb) returns uuid
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
    if vis='public' then update public.issues set revision=revision+1 where id=i.id; end if;
  end if;
  insert into public.history(session_id,issue_id,at,actor,actor_name,text,visibility)
  values(p_session,result,stamp,who,who_name,txt,vis);
  if vis='public' then
    insert into public.changes(session_id,team_id,revision) values(p_session,affected,1)
    on conflict (session_id,team_id) do update set revision=public.changes.revision+1;
  else
    insert into public.staff_changes(session_id,revision) values(p_session,1)
    on conflict (session_id) do update set revision=public.staff_changes.revision+1;
  end if;
  insert into app_private.receipts values(who,p_request,p_session,p_action,result);
  return result;
end $$;
