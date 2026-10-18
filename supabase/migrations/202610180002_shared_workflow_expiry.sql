-- A commit can wait on locks past the login's expiry. Check the wall clock
-- after those waits, rather than the outer statement's earlier start time.
-- Keep the installed T0019 migration intact and replace only its read helper.
create or replace function app_private.read_workflow(p_actor uuid,p_login uuid,p_session uuid,p_request uuid,p_action jsonb)
returns jsonb language sql volatile security definer set search_path = '' as $$
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
      and coalesce((to_jsonb(l)->>'not_after')::timestamptz > clock_timestamp(),true))
    and exists(select 1 from auth.users u where u.id=p_actor and to_jsonb(u)->>'deleted_at' is null
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz <= clock_timestamp(),true))
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

-- CREATE OR REPLACE preserves the service-only RPCs and this helper's grants.
revoke all on function app_private.read_workflow(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
