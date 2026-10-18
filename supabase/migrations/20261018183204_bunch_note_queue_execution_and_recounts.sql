begin;

create table bunch_note_private.workflow_commands (
 command_id uuid primary key,
 actor_id uuid not null references public.profiles(id),
 request jsonb not null check(jsonb_typeof(request)='object'),
 response jsonb not null check(jsonb_typeof(response)='object'),
 created_at timestamptz not null default now()
);
alter table bunch_note_private.workflow_commands enable row level security;
revoke all on bunch_note_private.workflow_commands from public,anon,authenticated,service_role;

create table bunch_note_private.card_completions (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references bunch_note_private.jobs(id),
 bunch_note_id uuid not null,
 card_id uuid not null,
 actor_id uuid not null references public.profiles(id),
 command_id uuid not null unique references bunch_note_private.workflow_commands(command_id) deferrable initially deferred,
 actual_qty_by_row jsonb not null check(jsonb_typeof(actual_qty_by_row)='object'),
 ptravailable_by_row jsonb not null check(jsonb_typeof(ptravailable_by_row)='object'),
 actual_qty numeric,
 ptravailable numeric,
 variance numeric,
 master_revision bigint not null,
 card_revision bigint not null,
 job_revision bigint not null,
 completed_at timestamptz not null default now(),
 unique(job_id,card_id),
 foreign key(bunch_note_id,card_id) references bunch_note_private.bunch_note_work_cards(bunch_note_id,card_id)
);
create index card_completions_job_time on bunch_note_private.card_completions(job_id,completed_at desc);
alter table bunch_note_private.card_completions enable row level security;
revoke all on bunch_note_private.card_completions from public,anon,authenticated,service_role;

create table bunch_note_private.count_reviews (
 id uuid primary key default gen_random_uuid(),
 completion_id uuid not null unique references bunch_note_private.card_completions(id),
 job_id uuid not null references bunch_note_private.jobs(id),
 bunch_note_id uuid not null,
 card_id uuid not null,
 status text not null default 'needs_recount' check(status in ('needs_recount','assigned','resolved')),
 assigned_counter_id uuid references public.profiles(id),
 assigned_counter_username text check(assigned_counter_username is null or (length(assigned_counter_username)<=64 and assigned_counter_username ~ '^[a-z0-9][a-z0-9._-]{0,63}$')),
 recount_qty_by_row jsonb check(recount_qty_by_row is null or jsonb_typeof(recount_qty_by_row)='object'),
 recount_qty numeric,
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 resolved_at timestamptz,
 foreign key(bunch_note_id,card_id) references bunch_note_private.bunch_note_work_cards(bunch_note_id,card_id)
);
create index count_reviews_status_time on bunch_note_private.count_reviews(status,created_at desc);
create index count_reviews_counter on bunch_note_private.count_reviews(assigned_counter_id,status,created_at desc);
alter table bunch_note_private.count_reviews enable row level security;
revoke all on bunch_note_private.count_reviews from public,anon,authenticated,service_role;

create function bunch_note_private.workflow_can_review(p_actor public.profiles)
returns boolean language sql stable security definer set search_path='' as $$
 select p_actor.username='sharon_combs'
  or upper(private.normalized_profile_role(p_actor.role)) in ('ADMIN','ADMINISTRATOR')
  or exists(select 1 from public.core_employees e where e.profile_id=p_actor.id and e.active
    and e.department='Kiers & Counters' and (lower(coalesce(e.role,'')) like '%supervisor%'
      or lower(coalesce(e.role,'')) like '%manager%' or lower(coalesce(e.role,'')) like '%admin%'
      or upper(private.normalized_profile_role(p_actor.role)) like '%SUPERVISOR%'
      or upper(private.normalized_profile_role(p_actor.role))='MANAGER'))
$$;
revoke all on function bunch_note_private.workflow_can_review(public.profiles) from public,anon,authenticated,service_role;

create function bunch_note_private.workflow_counters()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,
   'display_name',coalesce(nullif(btrim(p.display_name),''),p.username))
   order by case lower(p.username) when 'sharon_combs' then 0 when 'dylan_collyge' then 1 else 2 end,lower(p.username)),'[]'::jsonb)
 from public.profiles p
 where p.disabled_at is null and not p.must_change_password
  and (p.locked_until is null or p.locked_until<=now())
  and not sales_private.is_rep(p.role)
$$;
revoke all on function bunch_note_private.workflow_counters() from public,anon,authenticated,service_role;

-- Card completion emits its own, user-scoped report. Suppress the older
-- whole-job completion report for that same transition so the last card does
-- not generate a duplicate email.
do $migration$
declare source text; changed text;
begin
 select pg_get_functiondef('bunch_note_private.queue_completed_work_delivery()'::regprocedure) into source;
 changed:=replace(source,
  $q$  if old.status is not distinct from new.status or new.status <> 'complete' then$q$,
  $q$  if coalesce(current_setting('bunch_note.workflow_card_completion',true),'')='on' then return new; end if;
  if old.status is not distinct from new.status or new.status <> 'complete' then$q$);
 if changed=source then raise exception 'BUNCH_NOTE_COMPLETION_TRIGGER_PATCH_MISSING'; end if;
 execute changed;
end
$migration$;

create function public.bunch_note_workflow_command_v1(
 p_actor_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb,
 p_command_id uuid default null,p_expected_revision bigint default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor public.profiles;
 job bunch_note_private.jobs;
 card bunch_note_private.bunch_note_work_cards;
 note_id uuid;
 request_value jsonb;
 prior bunch_note_private.workflow_commands;
 result jsonb;
 review_row bunch_note_private.count_reviews;
 completion bunch_note_private.card_completions;
 review_allowed boolean;
 filter_value text;
 limit_value integer;
 offset_value integer;
 source_ids text[];
 actual_map jsonb;
 ptr_map jsonb;
 row_value record;
 actual_total numeric:=0;
 ptr_total numeric:=0;
 all_ptr_known boolean:=true;
 discrepant boolean:=false;
 row_count integer:=0;
 master_revision bigint;
 completion_id uuid;
 preview bunch_note_private.previews;
 report jsonb;
 report_card jsonb;
 event_id_value uuid;
 report_preview_id uuid;
 next_card_revision bigint;
 next_job_revision bigint;
 assigned_to uuid;
 assigned_username text;
 requested_username text;
 prior_card_command_setting text;
 prior_completion_setting text;
 matched_profile public.profiles;
 recount_map jsonb;
 recount_total numeric:=0;
 expected_rows integer;
 actual_rows integer;
 card_json jsonb;
 cards_json jsonb;
 total_value bigint;
 active_value bigint;
 review_count_value bigint;
begin
 if not private.is_service_role_request() then raise exception 'BUNCH_NOTE_FORBIDDEN' using errcode='42501'; end if;
 actor:=bunch_note_private.actor(p_actor_id);
 if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) is distinct from 'object'
  or octet_length(coalesce(p_payload,'{}'::jsonb)::text)>200000 then raise exception 'BUNCH_NOTE_WORKFLOW_PAYLOAD_INVALID'; end if;
 review_allowed:=bunch_note_private.workflow_can_review(actor);

 if p_operation='queue' then
  filter_value:=coalesce(p_payload->>'filter','mine');
  if filter_value not in ('mine','all','completed') then raise exception 'BUNCH_NOTE_WORKFLOW_FILTER_INVALID'; end if;
  limit_value:=greatest(1,least(100,coalesce((p_payload->>'limit')::integer,50)));
  offset_value:=greatest(0,coalesce((p_payload->>'offset')::integer,0));
  with accessible as materialized (
   select wc.*,j.id as jid,j.status as job_status,j.revision as job_revision,j.note_number,j.block,j.location as job_location,
    j.body as job_body,j.updated_at as job_updated,n.batch_id,j.created_by as note_author
   from bunch_note_private.bunch_note_work_cards wc
   join bunch_note_private.bunch_notes n on n.id=wc.bunch_note_id
   join bunch_note_private.jobs j on j.id=n.job_id
   where wc.kind='inventory' and (
     wc.owner_id=actor.id
     or j.created_by=actor.id
     or actor.username='dylan_collyge'
     or review_allowed
     or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca
       where ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id and ca.user_id=actor.id))
  ), display_rows as materialized (
   select * from accessible where filter_value='all'
    or (filter_value='mine' and (owner_id=actor.id or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca
      where ca.bunch_note_id=accessible.bunch_note_id and ca.card_id=accessible.card_id and ca.user_id=actor.id)))
    or (filter_value='completed' and status='complete')
  ), counts as (
   select (select count(*)::bigint from display_rows) total,
    (select count(*)::bigint from accessible where status='open' and active and job_status='open') active_count
  ), review_counts as (
   select count(*)::bigint review_count from bunch_note_private.count_reviews r
   where r.status<>'resolved' and (review_allowed or r.assigned_counter_id=actor.id)
  ), page_keys as materialized (
   select * from display_rows order by job_updated desc,card_id limit limit_value offset offset_value
  ), selected as (
   select k.*,
    coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',coalesce(nullif(btrim(p.display_name),''),p.username)) order by lower(p.username))
      from public.profiles p where (p.id=k.owner_id or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca
        where ca.bunch_note_id=k.bunch_note_id and ca.card_id=k.card_id and ca.user_id=p.id))
        and p.disabled_at is null and not p.must_change_password),'[]'::jsonb) as assignee_json,
    (select c.id from bunch_note_private.card_completions c where c.job_id=k.jid and c.card_id=k.card_id) as completion_id
   from page_keys k
  ), measured as (
   select a.*, src.rows_json,src.total_ptr,src.all_known,src.lots
   from selected a
   cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('row_id',rid.value,'location',coalesce(m.locationcode,a.location_code),
      'lot',coalesce(m.lotcode,''),'ptravailable',case when m.ptravailable is not null and btrim(m.ptravailable) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(m.ptravailable)::numeric else null end,
      'actual_qty',case when a.completion_id is not null then (select c.actual_qty_by_row->rid.value from bunch_note_private.card_completions c where c.id=a.completion_id) else null end)
      order by rid.value),'[]'::jsonb) as rows_json,
     coalesce(sum(case when m.ptravailable is not null and btrim(m.ptravailable) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(m.ptravailable)::numeric end),0) as total_ptr,
     bool_and(m.unique_id is not null and m.ptravailable is not null and btrim(m.ptravailable) ~ '^-?[0-9]+(\.[0-9]+)?$') as all_known,
     string_agg(distinct coalesce(m.lotcode,''),', ' order by coalesce(m.lotcode,'')) as lots
    from jsonb_array_elements_text(a.row_ids) rid(value)
    left join public.ph_master_inventory m on m.unique_id=rid.value
   ) src
  ), prepared as (
   select m.*,
    (select count(*) from bunch_note_private.card_completions c where c.job_id=m.jid and c.card_id=m.card_id) as completed_count,
    (select jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'job_id',r.job_id,'card_id',r.card_id,
      'itemcode',m.itemcode,'variety',m.commonname,'contsize',m.contsize,'source_location',m.location_code,'destination',m.destination_location,
      'completed_by',coalesce(p.username,''),'completed_by_display',coalesce(p.display_name,p.username,''),
       'actual_qty',c.actual_qty,'ptravailable',c.ptravailable,'variance',c.variance,'assigned_counter_id',r.assigned_counter_id,
       'assigned_counter_username',r.assigned_counter_username,
      'recount_qty',r.recount_qty,'can_assign',review_allowed,'can_complete',r.assigned_counter_id=actor.id or review_allowed)
     from bunch_note_private.count_reviews r join bunch_note_private.card_completions c on c.id=r.completion_id
     join public.profiles p on p.id=c.actor_id where r.job_id=m.jid and r.card_id=m.card_id and r.status<>'resolved' limit 1) as review_json
   from measured m
  ), card_rows as (
   select p.*,jsonb_build_object('stablecard_id',p.jid::text||':'||p.card_id::text,'job_id',p.jid,'card_id',p.card_id,'revision',p.revision,'job_revision',p.job_revision,
    'status',case when not p.active or p.status='retired' or p.job_status='cancelled' then 'cancelled' when p.status='complete' then 'complete' else 'open' end,
    'can_complete',p.active and p.status='open' and p.job_status='open' and (p.owner_id=actor.id or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=p.bunch_note_id and ca.card_id=p.card_id and ca.user_id=actor.id))
      and coalesce((select revision.state='ready' from public.app_dataset_revisions revision where revision.key='ph_master_inventory'),false),
    'itemcode',p.itemcode,'variety',p.commonname,'contsize',p.contsize,'source_location',p.location_code,'lot',p.lots,
    'ptravailable',case when p.all_known then p.total_ptr else null end,'action',p.workflow_action,'destination',case when p.workflow_action='move' then p.destination_location when p.workflow_action='bunch' then p.destination_house else '' end,
    'notes',p.notes,'assignees',p.assignee_json,'sources',p.rows_json,'review',p.review_json) as value
   from prepared p
  ), page as (
   select value,job_updated,card_id from card_rows
  )
  select coalesce((select jsonb_agg(value order by job_updated desc,card_id) from page),'[]'::jsonb),counts.total,counts.active_count,review_counts.review_count
   into cards_json,total_value,active_value,review_count_value from counts cross join review_counts;
  return jsonb_build_object('cards',cards_json,'total',coalesce(total_value,0),'active_count',coalesce(active_value,0),
   'review_count',coalesce(review_count_value,0),'can_review',review_allowed,'counters',case when review_allowed then bunch_note_private.workflow_counters() else '[]'::jsonb end);
 elsif p_operation='list_discrepancies' then
  limit_value:=greatest(1,least(100,coalesce((p_payload->>'limit')::integer,50)));
  offset_value:=greatest(0,coalesce((p_payload->>'offset')::integer,0));
  with visible as materialized (
   select r.*,c.actor_id,c.actual_qty,c.ptravailable,c.variance,c.actual_qty_by_row,c.ptravailable_by_row,j.note_number,j.location,j.block,
    wc.itemcode,wc.commonname,wc.contsize,wc.location_code,wc.destination_location,wc.destination_house,wc.workflow_action,wc.notes,
    p.username as completed_username,coalesce(p.display_name,p.username) as completed_display,wc.row_ids
   from bunch_note_private.count_reviews r join bunch_note_private.card_completions c on c.id=r.completion_id
   join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=r.bunch_note_id and wc.card_id=r.card_id
   join bunch_note_private.jobs j on j.id=r.job_id join public.profiles p on p.id=c.actor_id
   where r.status<>'resolved' and (review_allowed or r.assigned_counter_id=actor.id)
  ), counts as (
   select count(*)::bigint total from visible
  ), page_keys as materialized (
   select * from visible order by created_at desc,id limit limit_value offset offset_value
  ), results as (
   select v.created_at,v.id,jsonb_build_object('id',v.id,'revision',v.revision,'status',v.status,'job_id',v.job_id,'card_id',v.card_id,
    'itemcode',v.itemcode,'variety',v.commonname,'contsize',v.contsize,'source_location',v.location_code,
    'destination',case when v.workflow_action='move' then v.destination_location when v.workflow_action='bunch' then v.destination_house else '' end,
    'completed_by',v.completed_username,'completed_by_display',v.completed_display,'actual_qty',v.actual_qty,'ptravailable',v.ptravailable,
     'variance',v.variance,'assigned_counter_id',v.assigned_counter_id,'assigned_counter_username',v.assigned_counter_username,
     'recount_qty',v.recount_qty,'sources',
    coalesce((select jsonb_agg(jsonb_build_object('row_id',rid.value,'location',coalesce(m.locationcode,v.location_code),'lot',coalesce(m.lotcode,''),
      'actual_qty',v.actual_qty_by_row->rid.value,'ptravailable',v.ptravailable_by_row->rid.value) order by rid.value)
      from jsonb_array_elements_text(v.row_ids) rid(value) left join public.ph_master_inventory m on m.unique_id=rid.value),'[]'::jsonb),
    'can_assign',review_allowed,'can_complete',v.assigned_counter_id=actor.id or review_allowed) as value
   from page_keys v
  )
  select coalesce((select jsonb_agg(value order by created_at desc,id) from results),'[]'::jsonb),counts.total
   into cards_json,total_value from counts;
  return jsonb_build_object('reviews',coalesce(cards_json,'[]'::jsonb),'total',coalesce(total_value,0),'review_count',coalesce(total_value,0),
   'can_review',review_allowed,'counters',case when review_allowed then bunch_note_private.workflow_counters() else '[]'::jsonb end);
 end if;

 if p_operation not in ('complete_card','assign_counter','complete_recount') then raise exception 'BUNCH_NOTE_WORKFLOW_OPERATION_INVALID'; end if;
 if p_command_id is null then raise exception 'BUNCH_NOTE_COMMAND_REQUIRED'; end if;
 request_value:=jsonb_build_object('operation',p_operation,'payload',p_payload,'revision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
 select * into prior from bunch_note_private.workflow_commands where command_id=p_command_id;
 if found then
  if prior.actor_id<>actor.id or prior.request<>request_value then raise exception 'BUNCH_NOTE_COMMAND_CONFLICT'; end if;
  return prior.response;
 end if;

 if p_operation='complete_card' then
  begin select (p_payload->>'job_id')::uuid,(p_payload->>'card_id')::uuid into note_id,assigned_to; exception when others then raise exception 'BUNCH_NOTE_CARD_REQUIRED'; end;
  select * into job from bunch_note_private.jobs where id=note_id for update;
  if not found or coalesce((job.body->>'format_version')::integer,0)<5 then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=job.id;
  select * into card from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.card_id=assigned_to and wc.active for update;
  if not found or card.status<>'open' or job.status<>'open' then raise exception 'BUNCH_NOTE_CARD_COMPLETE'; end if;
   if card.kind<>'inventory' then raise exception 'BUNCH_NOTE_CARD_NOT_INVENTORY'; end if;
  if card.revision is distinct from p_expected_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  if card.owner_id is distinct from actor.id and not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=card.bunch_note_id and ca.card_id=card.card_id and ca.user_id=actor.id) then
   raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501';
  end if;
  actual_map:=p_payload->'actual_qty_by_row';
  if jsonb_typeof(actual_map) is distinct from 'object' then raise exception 'BUNCH_NOTE_ACTUAL_QTY_REQUIRED'; end if;
  select array_agg(value order by value),count(*) into source_ids,row_count from jsonb_array_elements_text(card.row_ids);
  select count(*) into expected_rows from jsonb_object_keys(actual_map);
  if expected_rows<>row_count or exists(select 1 from jsonb_object_keys(actual_map) k(key) where not (card.row_ids ? k.key)) then raise exception 'BUNCH_NOTE_ACTUAL_ROWS_INVALID'; end if;
  if exists(select 1 from jsonb_each(actual_map) e where jsonb_typeof(e.value) not in ('number','string') or nullif(btrim(e.value#>>'{}'),'') is null or btrim(e.value#>>'{}') !~ '^[0-9]+(\.[0-9]{1,3})?$') then raise exception 'BUNCH_NOTE_ACTUAL_QTY_INVALID'; end if;
  select revision,state into master_revision,filter_value from public.app_dataset_revisions where key='ph_master_inventory' for share;
  if not found or filter_value<>'ready' then raise exception 'BUNCH_NOTE_SOURCE_NOT_READY'; end if;
  ptr_map:='{}';
  for row_value in
   select m.unique_id,m.ptravailable,m.locationcode,m.lotcode from public.ph_master_inventory m where m.unique_id=any(source_ids) order by m.unique_id for share
  loop
   if row_value.ptravailable is not null and btrim(row_value.ptravailable) ~ '^-?[0-9]+(\.[0-9]+)?$' then
    ptr_map:=ptr_map||jsonb_build_object(row_value.unique_id,btrim(row_value.ptravailable)::numeric);
    ptr_total:=ptr_total+btrim(row_value.ptravailable)::numeric;
    actual_total:=actual_total+(actual_map->>row_value.unique_id)::numeric;
    if (actual_map->>row_value.unique_id)::numeric<>btrim(row_value.ptravailable)::numeric then discrepant:=true; end if;
   else
    ptr_map:=ptr_map||jsonb_build_object(row_value.unique_id,null);
    all_ptr_known:=false;
    actual_total:=actual_total+(actual_map->>row_value.unique_id)::numeric;
    discrepant:=true;
   end if;
   row_count:=row_count-1;
  end loop;
  if row_count<>0 then raise exception 'BUNCH_NOTE_SOURCE_CHANGED'; end if;
  if not all_ptr_known then ptr_total:=null; end if;
  next_card_revision:=card.revision+1;
  next_job_revision:=job.revision+1;
  prior_card_command_setting:=current_setting('bunch_note.card_command',true);
  prior_completion_setting:=current_setting('bunch_note.workflow_card_completion',true);
  perform set_config('bunch_note.card_command','on',true);
  perform set_config('bunch_note.workflow_card_completion','on',true);
  insert into bunch_note_private.card_completions(job_id,bunch_note_id,card_id,actor_id,command_id,actual_qty_by_row,ptravailable_by_row,
    actual_qty,ptravailable,variance,master_revision,card_revision,job_revision)
   values(job.id,note_id,card.card_id,actor.id,p_command_id,actual_map,ptr_map,actual_total,ptr_total,
    case when ptr_total is null then null else actual_total-ptr_total end,master_revision,next_card_revision,next_job_revision)
   returning id into completion_id;
  update bunch_note_private.bunch_note_work_cards set status='complete',revision=next_card_revision,updated_at=now()
   where bunch_note_id=note_id and card_id=card.card_id;
  update bunch_note_private.jobs set status=case when not exists(select 1 from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.active and wc.card_id<>card.card_id and wc.status<>'complete')
    and not exists(select 1 from jsonb_array_elements(bunch_note_private.card_actions(job)) a
      where nullif(a->>'card_id','') is null and not(job.progress ? (a->>'id')))
    then 'complete' else status end,
   revision=revision+1,updated_at=now() where id=job.id returning * into job;
  select * into card from bunch_note_private.bunch_note_work_cards where bunch_note_id=note_id and card_id=card.card_id;
  if discrepant then
   insert into bunch_note_private.count_reviews(completion_id,job_id,bunch_note_id,card_id) values(completion_id,job.id,note_id,card.card_id) returning * into review_row;
  end if;
  -- A completed-work event has its own immutable report and deterministic
  -- outbox identity; the delivery worker renders/freezes that report before send.
  select p.* into preview from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id
   where v.job_id=job.id and p.published and p.report_kind='instructions' order by v.instruction_revision desc limit 1;
  if preview.id is null then raise exception 'BUNCH_NOTE_INSTRUCTION_PREVIEW_REQUIRED'; end if;
  if preview.id is not null then
   select value into report from jsonb_array_elements(preview.reports) where value->>'job_id'=job.id::text limit 1;
   report_card:=coalesce((select value from jsonb_array_elements(coalesce(report->'cards','[]'::jsonb)) where value->>'id'=card.card_id::text limit 1),'{}'::jsonb)
    || jsonb_build_object('id',card.card_id,'kind','inventory','itemcode',card.itemcode,'commonname',card.commonname,'contsize',card.contsize,
      'location_code',card.location_code,'row_ids',card.row_ids,'owner_id',card.owner_id,
       'owner_ids',(select coalesce(jsonb_agg(to_jsonb(owners.user_id) order by owners.user_id),'[]'::jsonb) from (
          select card.owner_id as user_id union
          select ca.user_id from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=card.bunch_note_id and ca.card_id=card.card_id
        ) owners),
       'workflow_instructions',concat_ws(E'\n',nullif(card.workflow_instructions,''),
        'Completed By: '||actor.username||' ('||coalesce(nullif(actor.display_name,''),actor.username)||')',
        'Completed: '||to_char(now() at time zone 'America/Chicago','MM/DD/YYYY HH12:MI AM')||' America/Chicago',
        'Source: '||card.location_code,
        'Item: '||card.itemcode||' · '||card.contsize||' · '||card.commonname,
        'Action: '||case when card.workflow_action='move' then 'Move to '||card.destination_location
          when card.workflow_action='bunch' then 'Bunch to '||card.destination_house when card.workflow_action='ta' then 'TA'
          else card.workflow_action end,
        'Actual Qty reported: '||actual_total::text,
        'Drive Mode PTRAVAILABLE: '||coalesce(ptr_total::text,'Unknown'),
        case when ptr_total is null then 'Count discrepancy: PTRAVAILABLE unavailable; review required'
          when discrepant then 'Count discrepancy: '||(actual_total-ptr_total)::text||' (needs recount review)'
          else 'Count discrepancy: none' end),
       'execution',jsonb_build_object('completed_by',actor.username,'completed_by_display',coalesce(nullif(actor.display_name,''),actor.username),
       'completed_at',now(),'action',card.workflow_action,'destination',case when card.workflow_action='move' then card.destination_location when card.workflow_action='bunch' then card.destination_house else '' end,
       'actual_qty_by_row',actual_map,'actual_qty',actual_total,'ptravailable_by_row',ptr_map,'ptravailable',ptr_total,
       'variance',case when ptr_total is null then null else actual_total-ptr_total end,'discrepancy',discrepant));
   report:=coalesce(report,'{}'::jsonb)||jsonb_build_object('job_id',job.id,'report_kind','completed_work','work_revision',next_job_revision,
   'cards',jsonb_build_array(report_card),'completion',report_card->'execution','recorded_at',now());
   report:=jsonb_set(report,'{actions}',coalesce((select jsonb_agg(action) from jsonb_array_elements(coalesce(report->'actions','[]'::jsonb)) action
     where action->>'card_id'=card.card_id::text),'[]'::jsonb),true);
   report:=jsonb_set(report,'{source}',coalesce((select jsonb_agg(source_row) from jsonb_array_elements(coalesce(report->'source','[]'::jsonb)) source_row
     where card.row_ids ? coalesce(source_row->>'unique_id',source_row->>'uniqueId')),'[]'::jsonb),true);
   insert into bunch_note_private.previews(id,batch_id,created_by,batch_revision,reports,recipients,pdfs,report_kind,job_id,job_revision,expires_at,published,delivery_status)
    values(gen_random_uuid(),preview.batch_id,actor.id,preview.batch_revision,jsonb_build_array(report),
     bunch_note_private.recipients_for_reports(jsonb_build_array(to_jsonb(actor.id)) || case when discrepant then coalesce((
       select jsonb_agg(to_jsonb(p.id)) from public.profiles p where p.username='sharon_combs' and p.disabled_at is null
        and not p.must_change_password and (p.locked_until is null or p.locked_until<=now())), '[]'::jsonb) else '[]'::jsonb end,
       jsonb_build_array(report)),null,
     'completed_work',job.id,job.revision,'infinity'::timestamptz,true,'queued') returning id into report_preview_id;
   insert into public.ph_request_delivery_outbox(event_key,event_type,payload,delivery_mode)
    values('bunch-note-card-completion:'||job.id::text||':'||card.card_id::text||':'||card.revision::text,
     'bunch_note_submission',jsonb_build_object('preview_id',report_preview_id,'report_kind','completed_work','automatic_completion',true,'card_completion',true),'email')
    returning event_id into event_id_value;
   update bunch_note_private.previews set event_id=event_id_value where id=report_preview_id;
  end if;
  result:=jsonb_build_object('job',bunch_note_private.card_safe_job(job,actor.id),'completion',jsonb_build_object('id',completion_id,'card_id',card.card_id,'actor_id',actor.id,
   'completed_by',actor.username,'completed_by_display',coalesce(nullif(actor.display_name,''),actor.username),'actual_qty_by_row',actual_map,'ptravailable_by_row',ptr_map,
   'actual_qty',actual_total,'ptravailable',ptr_total,'variance',case when ptr_total is null then null else actual_total-ptr_total end,'master_revision',master_revision,'completed_at',now()),
   'discrepancy',case when discrepant then jsonb_build_object('review_id',review_row.id,'status',review_row.status,'revision',review_row.revision,'routed_to','sharon_combs') else null end,
   'delivery_queued',event_id_value is not null,'event_id',event_id_value);
  perform set_config('bunch_note.card_command',coalesce(prior_card_command_setting,''),true);
  perform set_config('bunch_note.workflow_card_completion',coalesce(prior_completion_setting,''),true);
 elsif p_operation='assign_counter' then
  if not review_allowed then raise exception 'BUNCH_NOTE_REVIEW_FORBIDDEN' using errcode='42501'; end if;
  select * into review_row from bunch_note_private.count_reviews where id=(p_payload->>'review_id')::uuid for update;
  if not found or review_row.status='resolved' then raise exception 'BUNCH_NOTE_REVIEW_NOT_FOUND'; end if;
  if review_row.revision is distinct from p_expected_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
   assigned_to:=nullif(p_payload->>'counter_id','')::uuid;
   requested_username:=lower(btrim(coalesce(nullif(p_payload->>'counter_username',''),
     (select p.username from public.profiles p where p.id=assigned_to))));
   if requested_username is null or length(requested_username)>64 or requested_username !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
    raise exception 'BUNCH_NOTE_COUNTER_INVALID';
   end if;
   select p.* into matched_profile from public.profiles p where lower(p.username)=requested_username limit 1 for update;
   if found then
    if matched_profile.disabled_at is not null or matched_profile.must_change_password
      or (matched_profile.locked_until is not null and matched_profile.locked_until>now())
      or coalesce(sales_private.is_rep(matched_profile.role),false) or (assigned_to is not null and assigned_to<>matched_profile.id) then
     raise exception 'BUNCH_NOTE_COUNTER_INVALID';
    end if;
    assigned_to:=matched_profile.id;
    assigned_username:=lower(matched_profile.username);
   else
    if assigned_to is not null then raise exception 'BUNCH_NOTE_COUNTER_INVALID'; end if;
    assigned_to:=null;
    assigned_username:=requested_username;
   end if;
   update bunch_note_private.count_reviews set status='assigned',assigned_counter_id=assigned_to,
    assigned_counter_username=assigned_username,revision=revision+1,updated_at=now()
   where id=review_row.id returning * into review_row;
  update bunch_note_private.jobs set updated_at=now() where id=review_row.job_id;
   result:=jsonb_build_object('review',jsonb_build_object('id',review_row.id,'revision',review_row.revision,'status',review_row.status,'job_id',review_row.job_id,'card_id',review_row.card_id,'assigned_counter_id',review_row.assigned_counter_id,'assigned_counter_username',review_row.assigned_counter_username,'can_assign',true,'can_complete',true));
 elsif p_operation='complete_recount' then
  select * into review_row from bunch_note_private.count_reviews where id=(p_payload->>'review_id')::uuid for update;
  if not found or review_row.status='resolved' then raise exception 'BUNCH_NOTE_REVIEW_NOT_FOUND'; end if;
  if review_row.revision is distinct from p_expected_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  if review_row.assigned_counter_id is distinct from actor.id and not review_allowed then raise exception 'BUNCH_NOTE_REVIEW_FORBIDDEN' using errcode='42501'; end if;
  recount_map:=p_payload->'recount_qty_by_row';
  if jsonb_typeof(recount_map) is distinct from 'object' then raise exception 'BUNCH_NOTE_RECOUNT_REQUIRED'; end if;
  select count(*) into expected_rows from jsonb_object_keys(recount_map);
   select jsonb_array_length(work_card.row_ids) into actual_rows from bunch_note_private.bunch_note_work_cards work_card
    where work_card.bunch_note_id=review_row.bunch_note_id and work_card.card_id=review_row.card_id;
   select * into card from bunch_note_private.bunch_note_work_cards work_card
    where work_card.bunch_note_id=review_row.bunch_note_id and work_card.card_id=review_row.card_id;
  if expected_rows<>actual_rows or exists(select 1 from jsonb_object_keys(recount_map) k(key) where not (card.row_ids ? k.key))
   or exists(select 1 from jsonb_each(recount_map) e where jsonb_typeof(e.value) not in ('number','string') or nullif(btrim(e.value#>>'{}'),'') is null or btrim(e.value#>>'{}') !~ '^[0-9]+(\.[0-9]{1,3})?$') then raise exception 'BUNCH_NOTE_RECOUNT_INVALID'; end if;
  select coalesce(sum((value#>>'{}')::numeric),0) into recount_total from jsonb_each(recount_map);
  update bunch_note_private.count_reviews set status='resolved',recount_qty_by_row=recount_map,recount_qty=recount_total,
   revision=revision+1,updated_at=now(),resolved_at=now() where id=review_row.id returning * into review_row;
  update bunch_note_private.jobs set updated_at=now() where id=review_row.job_id;
  result:=jsonb_build_object('review',jsonb_build_object('id',review_row.id,'revision',review_row.revision,'status',review_row.status,
    'job_id',review_row.job_id,'card_id',review_row.card_id,'assigned_counter_id',review_row.assigned_counter_id,
    'assigned_counter_username',review_row.assigned_counter_username,'recount_qty',review_row.recount_qty,
   'can_assign',review_allowed,'can_complete',true));
 end if;
 insert into bunch_note_private.workflow_commands(command_id,actor_id,request,response) values(p_command_id,actor.id,request_value,result);
 return result;
end $$;

revoke all on function public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.bunch_note_workflow_command_v1(uuid,text,jsonb,uuid,bigint) to service_role;
notify pgrst,'reload schema';
commit;
