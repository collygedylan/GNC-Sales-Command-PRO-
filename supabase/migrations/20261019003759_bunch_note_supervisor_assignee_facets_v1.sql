begin;

-- Resolve supervisors from the service-authenticated profile row. The caller cannot
-- elevate access by supplying a username in the request payload.
create or replace function bunch_note_private.workflow_can_review(p_actor public.profiles)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(
   lower(btrim(coalesce(p_actor.username,''))) in ('dylan_collyge','dylan_college','sharon_combs')
   or upper(regexp_replace(coalesce(private.normalized_profile_role(p_actor.role),p_actor.role,''),'[^A-Za-z0-9]','','g')) in
     ('ADMIN','ADMINISTRATOR','SUPERVISOR','DATAENTRYSUPERVISOR','SENIORINVENTORYMANAGER')
   or exists(select 1 from public.core_employees e where e.profile_id=p_actor.id and e.active
     and e.department='Kiers & Counters' and (lower(coalesce(e.role,'')) like '%supervisor%'
       or lower(coalesce(e.role,'')) like '%manager%' or lower(coalesce(e.role,'')) like '%admin%')),
   false)
$$;
revoke all on function bunch_note_private.workflow_can_review(public.profiles) from public,anon,authenticated,service_role;

-- Patch the current workflow definition in place to preserve its established RPC,
-- transaction, and idempotency behavior while fixing nullable permissions/facets.
do $migration$
declare
  definition text;
  changed text;
begin
  definition := replace(pg_get_functiondef('public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint)'::regprocedure),E'\r\n',E'\n');
  changed := definition;
  changed := replace(changed,
    $old$if filter_value not in ('mine','all','completed') then raise exception 'BUNCH_NOTE_WORKFLOW_FILTER_INVALID'; end if;$old$,
    $new$if filter_value not in ('mine','all','completed','unassigned') and filter_value not like 'assignee:%' then raise exception 'BUNCH_NOTE_WORKFLOW_FILTER_INVALID'; end if;
  if filter_value like 'assignee:%' then begin assigned_to:=substring(filter_value from 10)::uuid; exception when others then raise exception 'BUNCH_NOTE_WORKFLOW_FILTER_INVALID'; end; end if;$new$);
  if changed = definition then raise exception 'v232 migration could not patch workflow filter validation'; end if;

  -- Job bodies can contain large card snapshots; queue rendering never consumes
  -- job_body, so keep them out of the materialized all-card authorization set.
  changed := replace(changed,
    $old$j.body as job_body,j.updated_at as job_updated$old$,
    $new$j.updated_at as job_updated$new$);
  if position('j.body as job_body' in definition)=0
    or position('j.body as job_body' in changed)>0 then
    raise exception 'v232 migration could not narrow materialized queue rows';
  end if;

  changed := replace(changed,
    $old$select * from accessible where filter_value='all'
    or (filter_value='mine' and (owner_id=actor.id or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca
      where ca.bunch_note_id=accessible.bunch_note_id and ca.card_id=accessible.card_id and ca.user_id=actor.id)))
    or (filter_value='completed' and status='complete')$old$,
    $new$select * from accessible where ((filter_value='all' or filter_value='mine') and active and status='open' and job_status='open'
      and (filter_value='all' or owner_id=actor.id or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=accessible.bunch_note_id and ca.card_id=accessible.card_id and ca.user_id=actor.id)))
    or (filter_value='completed' and status='complete')
    or (filter_value='unassigned' and active and status='open' and job_status='open' and owner_id is null and not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=accessible.bunch_note_id and ca.card_id=accessible.card_id))
    or (filter_value like 'assignee:%' and active and status='open' and job_status='open' and (owner_id=assigned_to or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=accessible.bunch_note_id and ca.card_id=accessible.card_id and ca.user_id=assigned_to)))$new$);
  if changed = definition then raise exception 'v232 migration could not patch workflow queue filters'; end if;

  changed := replace(changed,
    $old$  ), review_counts as (
   select count(*)::bigint review_count from bunch_note_private.count_reviews r$old$,
    $new$  ), facet_people as (
   select a.jid,a.card_id,p.id,p.username,coalesce(nullif(btrim(p.display_name),''),p.username) display_name from accessible a join public.profiles p on p.id=a.owner_id
   where a.active and a.status='open' and a.job_status='open'
   union all
   select a.jid,a.card_id,p.id,p.username,coalesce(nullif(btrim(p.display_name),''),p.username) from accessible a
   join bunch_note_private.bunch_note_card_assignees ca on ca.bunch_note_id=a.bunch_note_id and ca.card_id=a.card_id
   join public.profiles p on p.id=ca.user_id where a.active and a.status='open' and a.job_status='open' and ca.user_id is distinct from a.owner_id
  ), facet_counts as (select id,username,display_name,count(*) card_count from facet_people group by id,username,display_name),
  facets as (select coalesce((select jsonb_agg(jsonb_build_object('id',id,'username',username,'display_name',display_name,'count',card_count) order by lower(username),id) from facet_counts),'[]'::jsonb) assignee_options,
    (select count(*)::bigint from accessible a where a.active and a.status='open' and a.job_status='open' and a.owner_id is null and not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=a.bunch_note_id and ca.card_id=a.card_id)) unassigned_count
  ), review_counts as (
   select count(*)::bigint review_count from bunch_note_private.count_reviews r$new$);
  if changed = definition then raise exception 'v232 migration could not add global queue facets'; end if;
  if position('select distinct a.jid,a.card_id,p.id,p.username' in changed)>0
    or position('count(distinct (jid,card_id)) card_count' in changed)>0
    or position('union all' in changed)=0
    or position('ca.user_id is distinct from a.owner_id' in changed)=0
    or position('count(*) card_count from facet_people' in changed)=0 then
    raise exception 'v232 migration could not optimize deduplicated global queue facets';
  end if;

  changed := replace(changed,
    $old$review_counts.review_count
   into cards_json,total_value,active_value,review_count_value from counts cross join review_counts;$old$,
    $new$review_counts.review_count,facets.assignee_options,facets.unassigned_count
   into cards_json,total_value,active_value,review_count_value,assignee_options_value,unassigned_count_value from counts cross join review_counts cross join facets;$new$);
  changed := replace(changed,
    $old$total_value bigint;
 active_value bigint;
 review_count_value bigint;$old$,
    $new$total_value bigint;
 active_value bigint;
 review_count_value bigint;
 assignee_options_value jsonb;
 unassigned_count_value bigint;$new$);
  changed := replace(changed,
    $old$'review_count',coalesce(review_count_value,0),'can_review',review_allowed,'counters',case when review_allowed then bunch_note_private.workflow_counters() else '[]'::jsonb end);$old$,
    $new$'review_count',coalesce(review_count_value,0),'can_review',coalesce(review_allowed,false),'counters',case when review_allowed then bunch_note_private.workflow_counters() else '[]'::jsonb end,
   'assignee_options',coalesce(assignee_options_value,'[]'::jsonb),'unassigned_count',coalesce(unassigned_count_value,0));$new$);
  changed := replace(changed,
    $old$and p.disabled_at is null and not p.must_change_password),'[]'::jsonb) as assignee_json$old$,
    $new$),'[]'::jsonb) as assignee_json$new$);

  changed := replace(changed,
    $old$'can_complete',p.active and p.status='open' and p.job_status='open' and (p.owner_id=actor.id or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=p.bunch_note_id and ca.card_id=p.card_id and ca.user_id=actor.id))
      and coalesce((select revision.state='ready' from public.app_dataset_revisions revision where revision.key='ph_master_inventory'),false),$old$,
    $new$'can_complete',coalesce(p.active and p.status='open' and p.job_status='open' and (p.owner_id=actor.id or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=p.bunch_note_id and ca.card_id=p.card_id and ca.user_id=actor.id) or review_allowed)
      and coalesce((select revision.state='ready' from public.app_dataset_revisions revision where revision.key='ph_master_inventory'),false),false),$new$);
  changed := replace(changed,$old$'can_complete',r.assigned_counter_id=actor.id or review_allowed)$old$,$new$'can_complete',coalesce(r.assigned_counter_id=actor.id or review_allowed,false))$new$);
  changed := replace(changed,$old$'can_complete',v.assigned_counter_id=actor.id or review_allowed)$old$,$new$'can_complete',coalesce(v.assigned_counter_id=actor.id or review_allowed,false))$new$);
  changed := replace(changed,
    $old$if card.owner_id is distinct from actor.id and not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=card.bunch_note_id and ca.card_id=card.card_id and ca.user_id=actor.id) then$old$,
    $new$if not coalesce(card.owner_id=actor.id or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=card.bunch_note_id and ca.card_id=card.card_id and ca.user_id=actor.id) or review_allowed,false) then$new$);
  changed := replace(changed,$old$'can_review',review_allowed$old$,$new$'can_review',coalesce(review_allowed,false)$new$);
  if changed = definition
    or position('assignee_options' in changed)=0
    or position('unassigned_count' in changed)=0
    or position('assignee_options_value jsonb;' in changed)=0
    or position('unassigned_count_value bigint;' in changed)=0
    or position('facet_people as (' in changed)=0
    or position('cross join facets' in changed)=0
    or position('review_counts.review_count,facets.assignee_options,facets.unassigned_count' in changed)=0
    or position('filter_value like ''assignee:%''' in changed)=0
    or position('coalesce(p.active and p.status=''open''' in changed)=0
    or position('if not coalesce(card.owner_id=actor.id' in changed)=0
    or position($old$and p.disabled_at is null and not p.must_change_password),'[]'::jsonb) as assignee_json$old$ in changed)>0
    or position('''assignee_options'',coalesce(assignee_options_value' in changed)=0
    or position('''can_review'',coalesce(review_allowed,false)' in changed)=0
    or position('''can_complete'',coalesce(p.active' in changed)=0
    or position('''can_complete'',p.active and p.status=' in changed)>0
    or position('''can_complete'',r.assigned_counter_id=actor.id or review_allowed' in changed)>0
    or position('''can_complete'',v.assigned_counter_id=actor.id or review_allowed' in changed)>0
    or position('filter_value not in (''mine'',''all'',''completed'')' in changed)>0 then
    raise exception 'v232 migration did not apply all expected workflow changes';
  end if;

  execute changed;
end;
$migration$;

revoke all on function public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint) to service_role;
commit;
