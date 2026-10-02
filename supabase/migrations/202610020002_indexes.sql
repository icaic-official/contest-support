-- Support session filters and RLS lookups; keep test/provisioned account receipts
-- tied to the person lifecycle without exposing this private table to browsers.
alter table app_private.receipts add constraint receipts_actor_fkey foreign key(actor) references public.people(id) on delete cascade;
create index memberships_user on public.memberships(user_id,session_id);
create index sessions_event on public.sessions(event_id);
create index issues_session_number on public.issues(session_id,number desc);
create index resolutions_issue_time on public.resolutions(issue_id,at);
create index history_issue_time on public.history(issue_id,at);
create index awards_session on public.awards(session_id);
create index admin_audit_session_time on public.admin_audit(session_id,at desc);
