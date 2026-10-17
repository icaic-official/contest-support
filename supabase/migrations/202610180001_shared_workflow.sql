-- T0019. The active public.workflow remains available during replacement checks.
-- This server-only path persists decisions made by the shared application service.
create table app_private.workflow_versions (
  issue_id uuid primary key references public.issues(id) on delete cascade,
  version bigint not null default 1
);
revoke all on app_private.workflow_versions from public,anon,authenticated;
insert into app_private.workflow_versions(issue_id) select id from public.issues;

-- Private notes must invalidate server decisions without changing public revisions.
-- Include legacy writers while both execution paths exist.
create function app_private.advance_workflow_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if tg_table_name='issues' then
    target := case when tg_op='DELETE' then old.id else new.id end;
  else
    target := case when tg_op='DELETE' then old.issue_id else new.issue_id end;
  end if;
  if exists(select 1 from public.issues where id=target) then
    insert into app_private.workflow_versions(issue_id,version) values(target,1)
    on conflict(issue_id) do update set version=app_private.workflow_versions.version+1;
  end if;
  return null;
end $$;
create trigger workflow_issue_version after insert or update on public.issues
for each row execute function app_private.advance_workflow_version();
create trigger workflow_history_version after insert or update or delete on public.history
for each row execute function app_private.advance_workflow_version();
create trigger workflow_resolution_version after insert or update or delete on public.resolutions
for each row execute function app_private.advance_workflow_version();
create trigger workflow_award_version after insert or update or delete on public.awards
for each row execute function app_private.advance_workflow_version();

-- Called with transaction-local claims established by the service-only RPCs.
-- One SQL statement captures each decision's inputs and its commit dependencies.
create function app_private.read_workflow(p_actor uuid,p_login uuid,p_session uuid,p_request uuid,p_action jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
with inputs as (
  select s,e,m,p,
    (select to_jsonb(c)-'temporary_hash' from app_private.account_credentials c where c.user_id=p_actor) credentials,
    (select to_jsonb(l) from auth.sessions l where l.id=p_login and l.user_id=p_actor) login,
    (select jsonb_build_object('banned_until',to_jsonb(u)->'banned_until','deleted_at',to_jsonb(u)->'deleted_at')
      from auth.users u where u.id=p_actor) account,
    coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.teams t where t.session_id=p_session),'[]'::jsonb) teams
  from public.sessions s join public.events e on e.id=s.event_id
  join public.memberships m on m.session_id=s.id and m.user_id=p_actor
  join public.people p on p.id=p_actor
  where s.id=p_session and app_private.account_ready()
    and exists(select 1 from auth.sessions l where l.id=p_login and l.user_id=p_actor
      and coalesce((to_jsonb(l)->>'not_after')::timestamptz > statement_timestamp(),true))
    and exists(select 1 from auth.users u where u.id=p_actor and to_jsonb(u)->>'deleted_at' is null
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz <= statement_timestamp(),true))
), target as (
  select i from public.issues i
  where i.session_id=p_session and i.id=nullif(p_action->>'issue_id','')::uuid
    and app_private.team_access(p_session,i.team_id)
), records as (
  select x.*, (select to_jsonb(i) from target) issue,
    (select to_jsonb(r) from public.resolutions r where r.issue_id=(select (i).id from target) and r.reopened_at is null) resolution,
    (select to_jsonb(a) from public.awards a where a.issue_id=(select (i).id from target)) award,
    (select version from app_private.workflow_versions where issue_id=(select (i).id from target)) version
  from inputs x
)
select jsonb_build_object(
  'state',jsonb_build_object(
    'actor',jsonb_build_object('id',(p).id,'name',(p).name),
    'membership',jsonb_build_object('team_id',(m).team_id,'roles',(m).roles,'is_admin',(m).is_admin),
    'session',jsonb_build_object('id',(s).id,'intake_open',(s).intake_open,'categories',(s).categories),
    'archived',(e).archived,
    'teams',coalesce((select jsonb_agg(t->>'id') from jsonb_array_elements(teams) t),'[]'::jsonb),
    'issue',case when issue is null then null else jsonb_build_object('id',issue->'id','team_id',issue->'team_id',
      'status',issue->'status','owner',issue->'owner','revision',issue->'revision') end,
    'resolution',case when resolution is null then null else jsonb_build_object('id',resolution->'id') end,
    'award',case when award is null then null else jsonb_build_object('id',award->'id','applied_at',award->'applied_at') end),
  'dependency',jsonb_build_object('session',to_jsonb(s),'event',to_jsonb(e),'membership',to_jsonb(m),'person',to_jsonb(p),
    'credentials',credentials,'login',login,'account',account,'teams',teams,'issue',issue,'resolution',resolution,'award',award,'version',version),
  'receipt',(select jsonb_build_object('sessionId',session_id,'command',command,'issueId',result)
    from app_private.receipts where actor=p_actor and request_id=p_request)
) from records
$$;

create function public.shared_workflow_read(p_actor uuid,p_login uuid,p_session uuid,p_request uuid,p_action jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'session_id',p_login,'role','authenticated')::text,true);
  return app_private.read_workflow(p_actor,p_login,p_session,p_request,p_action);
end $$;

create function public.shared_workflow_commit(p_actor uuid,p_login uuid,p_session uuid,p_request uuid,p_action jsonb,
  p_dependency jsonb,p_decision jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  current_read jsonb; receipt app_private.receipts; result uuid; affected uuid;
  person_name text; stamp timestamptz; kind text := p_decision->>'type'; vis text := p_decision->'history'->>'visibility';
begin
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'session_id',p_login,'role','authenticated')::text,true);
  -- Administration locks the session first. Lock parent rows as well as present
  -- dependencies so inserts, deletes, and permission updates cannot pass a check.
  perform 1 from public.sessions where id=p_session for share;
  perform 1 from public.events where id=(select event_id from public.sessions where id=p_session) for share;
  perform 1 from auth.users where id=p_actor for update;
  perform 1 from app_private.account_credentials where user_id=p_actor for share;
  perform 1 from auth.sessions where id=p_login and user_id=p_actor for share;
  perform 1 from public.memberships where session_id=p_session and user_id=p_actor for share;
  perform 1 from public.people where id=p_actor for share;
  perform 1 from public.teams where session_id=p_session order by id for share;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,0));
  if p_action->>'issue_id' is not null then
    perform 1 from public.issues where id=(p_action->>'issue_id')::uuid and session_id=p_session for update;
    perform 1 from public.resolutions where issue_id=(p_action->>'issue_id')::uuid order by id for update;
    perform 1 from public.awards where issue_id=(p_action->>'issue_id')::uuid for update;
    perform 1 from app_private.workflow_versions where issue_id=(p_action->>'issue_id')::uuid for update;
  end if;
  current_read := app_private.read_workflow(p_actor,p_login,p_session,p_request,p_action);
  if current_read is null or (current_read->'state'->>'archived')::boolean then
    return jsonb_build_object('outcome','rejected','reason','access');
  end if;
  select * into receipt from app_private.receipts where actor=p_actor and request_id=p_request;
  if found then
    if receipt.session_id<>p_session or receipt.command<>p_action then
      return jsonb_build_object('outcome','rejected','reason','request_id');
    end if;
    return jsonb_build_object('outcome','committed','issueId',receipt.result);
  end if;
  if current_read->'dependency' is distinct from p_dependency then return jsonb_build_object('outcome','retry'); end if;
  if p_request is null or kind is distinct from p_action->>'type' or vis not in ('public','internal') then
    return jsonb_build_object('outcome','rejected','reason','input');
  end if;
  person_name := current_read->'state'->'actor'->>'name';
  affected := (p_decision->>'teamId')::uuid;
  if not app_private.team_access(p_session,affected) or not exists(select 1 from public.teams where id=affected and session_id=p_session) then
    return jsonb_build_object('outcome','rejected','reason','access');
  end if;
  if kind<>'submit' then
    result := (p_decision->>'issueId')::uuid;
    if result is distinct from (p_action->>'issue_id')::uuid or current_read->'state'->'issue'='null'::jsonb
      or affected is distinct from (current_read->'state'->'issue'->>'team_id')::uuid then
      return jsonb_build_object('outcome','rejected','reason','state');
    end if;
  end if;
  stamp := clock_timestamp();
  if kind='submit' then
    insert into public.issues(session_id,team_id,reporter,reporter_name,category,description,created_at)
    values(p_session,affected,p_actor,person_name,p_decision->'submission'->>'category',p_decision->'submission'->>'description',stamp)
    returning id into result;
  else
    -- These are persistence instructions. Workflow permission and transition
    -- choices are made once, by the shared service, before this guarded commit.
    if p_decision ? 'issue' then
      update public.issues set
        status=coalesce(p_decision->'issue'->>'status',status),
        owner=case when p_decision->'issue' ? 'owner' then (p_decision->'issue'->>'owner')::uuid else owner end,
        owner_name=case when p_decision->'issue' ? 'owner' then person_name else owner_name end,
        first_assigned_at=case when kind='claim' then stamp else first_assigned_at end,
        resolved_at=case when p_decision ? 'resolution' then stamp when p_decision ? 'reopen' then null else resolved_at end
      where id=result;
    end if;
    if p_decision ? 'resolution' then
      insert into public.resolutions(session_id,issue_id,actor,actor_name,at,summary)
      values(p_session,result,p_actor,person_name,stamp,p_decision->'resolution'->>'summary');
    end if;
    if p_decision ? 'reopen' then
      update public.resolutions set reopened_at=stamp,reopened_by=p_actor,reopened_name=person_name,reason=p_decision->'reopen'->>'reason'
      where issue_id=result and reopened_at is null;
    end if;
    if p_decision ? 'award' then
      insert into public.awards(session_id,issue_id,resolution_id,minutes,explanation,actor,actor_name,at)
      values(p_session,result,(p_decision->'award'->>'resolutionId')::uuid,(p_decision->'award'->>'minutes')::integer,
        p_decision->'award'->>'explanation',p_actor,person_name,stamp);
    end if;
    if p_decision ? 'apply' then
      update public.awards set applied_at=stamp,applied_by=p_actor,applied_name=person_name
      where id=(p_decision->'apply'->>'awardId')::uuid and issue_id=result;
    end if;
    if vis='public' then update public.issues set revision=revision+1 where id=result; end if;
  end if;
  insert into public.history(session_id,issue_id,at,actor,actor_name,text,visibility)
  values(p_session,result,stamp,p_actor,person_name,p_decision->'history'->>'text',vis);
  if vis='public' then
    insert into public.changes(session_id,team_id,revision) values(p_session,affected,1)
    on conflict(session_id,team_id) do update set revision=public.changes.revision+1;
  else
    insert into public.staff_changes(session_id,revision) values(p_session,1)
    on conflict(session_id) do update set revision=public.staff_changes.revision+1;
  end if;
  insert into app_private.receipts values(p_actor,p_request,p_session,p_action,result);
  return jsonb_build_object('outcome','committed','issueId',result);
end $$;

-- Browsers cannot submit mutation plans, read dependencies, or forge identities.
revoke all on function app_private.advance_workflow_version(),app_private.read_workflow(uuid,uuid,uuid,uuid,jsonb),
  public.shared_workflow_read(uuid,uuid,uuid,uuid,jsonb),
  public.shared_workflow_commit(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.shared_workflow_read(uuid,uuid,uuid,uuid,jsonb),
  public.shared_workflow_commit(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
