begin;

alter database postgres refresh collation version;

do $block$
declare
  view_row record;
begin
  for view_row in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view %I.%I set (security_invoker = true)', view_row.nspname, view_row.relname);
  end loop;
end
$block$;

do $migration$
declare
  definition text;
  old_gate text := $$  if revision_state is distinct from 'ready'
     and not coalesce((lkg_proof->>'publishedReadable')::boolean,false) then
    raise exception using errcode='55000',message='MASTER_IDENTITY_SOURCE_NOT_READY';
  end if;
  if nullif(p_expected_revision,'') is not null
     and p_expected_revision<>revision_text
     and p_expected_revision is distinct from lkg_proof->>'publishedRevision' then
    raise exception using errcode='55000',message='MASTER_IDENTITY_REVISION_CHANGED';
  end if;$$;
  new_gate text := $$  if revision_state is distinct from 'ready'
     and not coalesce((lkg_proof->>'publishedReadable')::boolean,false) then
    return jsonb_build_object('inventoryRevision',revision_text,'rows','[]'::jsonb,
      'retained',true,'retryable',true,'sourceNotReady',true);
  end if;
  if nullif(p_expected_revision,'') is not null
     and p_expected_revision<>revision_text
     and p_expected_revision is distinct from lkg_proof->>'publishedRevision' then
    return jsonb_build_object('inventoryRevision',revision_text,'rows','[]'::jsonb,
      'retained',true,'retryable',true,'revisionChanged',true);
  end if;$$;
begin
  definition := pg_get_functiondef('public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)'::regprocedure);
  if position(new_gate in definition)=0 then
    if (length(definition)-length(replace(definition,old_gate,''))) / length(old_gate) <> 1 then
      raise exception 'MASTER_IDENTITY_STRUCTURED_RETRY_ANCHOR_INVALID';
    end if;
    execute replace(definition,old_gate,new_gate);
  end if;
end
$migration$;

do $migration$
declare
  definition text;
  old_gate text := $$  if revision_state is distinct from 'ready'
     and not coalesce((lkg_proof->>'publishedReadable')::boolean,false) then
    raise exception using errcode='PT409',message='LOC_ON_HAND_SOURCE_NOT_READY';
  end if;
  if nullif(p_expected_revision,'') is not null and p_expected_revision<>revision_text
     and p_expected_revision is distinct from lkg_proof->>'publishedRevision' then
    raise exception using errcode='PT409',message='LOC_ON_HAND_REVISION_CHANGED';
  end if;$$;
  new_gate text := $$  if revision_state is distinct from 'ready'
     and not coalesce((lkg_proof->>'publishedReadable')::boolean,false) then
    return jsonb_build_object('inventoryRevision',revision_text,'rows','[]'::jsonb,
      'retained',true,'retryable',true,'sourceNotReady',true);
  end if;
  if nullif(p_expected_revision,'') is not null and p_expected_revision<>revision_text
     and p_expected_revision is distinct from lkg_proof->>'publishedRevision' then
    return jsonb_build_object('inventoryRevision',revision_text,'rows','[]'::jsonb,
      'retained',true,'retryable',true,'revisionChanged',true);
  end if;$$;
begin
  definition := pg_get_functiondef('public.inventory_location_on_hand_read_v1(uuid,jsonb,text)'::regprocedure);
  if position(new_gate in definition)=0 then
    if (length(definition)-length(replace(definition,old_gate,''))) / length(old_gate) <> 1 then
      raise exception 'LOC_ON_HAND_STRUCTURED_RETRY_ANCHOR_INVALID';
    end if;
    execute replace(definition,old_gate,new_gate);
  end if;
end
$migration$;

create or replace function public.dataset_revisions_for_actor_v1(p_actor_id uuid,p_dataset_keys text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $function$
declare
  result jsonb;
  actor_scope jsonb;
  permission_version text;
  permissions jsonb;
  allowed_modules text[];
  access_control_allowed boolean := false;
begin
  select jsonb_build_object('id',p.id,'username',p.username,'role',p.role,'division',p.division)
  into actor_scope from public.profiles p
  where p.id=p_actor_id and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password;
  if actor_scope is null then raise exception using errcode='42501',message='DATASET_ACTOR_FORBIDDEN'; end if;
  if p_dataset_keys is null or (select count(distinct k) from unnest(p_dataset_keys) k)>64 or exists (
    select 1 from unnest(p_dataset_keys) k where k is null or not exists (
      select 1 from app_sync_private.sources s where s.key=k)) then
    raise exception using errcode='22023',message='DATASET_KEYS_INVALID';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.permission_key),'[]'::jsonb),
    coalesce(array_agg(p.module_key) filter(where p.allowed and p.permission_kind='module'),'{}'::text[])
  into permissions,allowed_modules
  from private.get_effective_app_permissions_v1(p_actor_id,private.resolve_app_access_policy_id_v1(false)) p;
  permission_version := md5(actor_scope::text||permissions::text);
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',k.key,'revision',case when allowed and r.key is not null then r.revision::text else null end,
    'state',case when not allowed or r.key is null then 'unavailable'
      when r.state='importing' and not exists (
        select 1 from app_sync_private.import_leases l join app_sync_private.import_runs run on run.id=l.run_id
        where l.key=k.key and run.state='active' and run.expires_at>statement_timestamp()) then 'interrupted'
      else r.state end,
    'changedAt',case when allowed then r.changed_at else null end,
    'publishedReadable',coalesce((proof.value->>'publishedReadable')::boolean,false),
    'publishedRevision',proof.value->>'publishedRevision','publishedAt',proof.value->>'publishedAt'
  ) order by k.key),'[]'::jsonb) into result
  from (select distinct unnest(p_dataset_keys) as key) k
  join app_sync_private.sources source on source.key=k.key
  cross join lateral (select source.client_enabled and
    (not source.dylan_only or actor_scope->>'username'='dylan_collyge') and
    case when source.key like 'private.app_access\_%' escape '\' then access_control_allowed
      when source.key like 'private.codex_ops\_%' escape '\' or source.key='ph_runtime_feature_flags'
        then actor_scope->>'username'='dylan_collyge'
      else source.modules && allowed_modules end as allowed) access
  left join public.app_dataset_revisions r on r.key=k.key
  left join lateral (
    select case when access.allowed and r.key is not null and r.state <> 'ready'
      then app_sync_private.published_snapshot_read_proof(k.key,r.revision) else null end as value
  ) proof on true;
  return jsonb_build_object('contractVersion',1,'serverTime',statement_timestamp(),
    'permissionVersion',permission_version,'sources',result);
end
$function$;
revoke all on function public.dataset_revisions_for_actor_v1(uuid,text[]) from public,anon,authenticated;
grant execute on function public.dataset_revisions_for_actor_v1(uuid,text[]) to service_role;

create table if not exists public.ph_reclass_recount_jobs (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null references public.ph_request_delivery_outbox(event_id) on delete restrict,
  itemcode text not null,
  commonname text not null default '',
  contsize text not null default '',
  locationcode text not null,
  requested_by_username text not null,
  requested_at timestamptz not null,
  system_on_hand numeric not null default 0,
  status text not null default 'pending' check (status in ('pending','completed')),
  counted_total numeric,
  variance numeric,
  completed_by_username text,
  completed_at timestamptz,
  completion_command_id uuid,
  delivery_event_id uuid references public.ph_request_delivery_outbox(event_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_event_id, itemcode, locationcode)
);

create table if not exists public.ph_reclass_recount_lines (
  job_id uuid not null references public.ph_reclass_recount_jobs(id) on delete cascade,
  source_unique_id text not null,
  itemcode text not null,
  locationcode text not null,
  lotcode text not null default '',
  season text not null default '',
  on_hand numeric not null default 0,
  available numeric not null default 0,
  review numeric not null default 0,
  primary key(job_id, source_unique_id)
);

create index if not exists ph_reclass_recount_jobs_pending_location_idx
  on public.ph_reclass_recount_jobs(status, locationcode, itemcode, requested_at);
create index if not exists ph_reclass_recount_lines_job_idx
  on public.ph_reclass_recount_lines(job_id, lotcode, season);

alter table public.ph_reclass_recount_jobs enable row level security;
alter table public.ph_reclass_recount_jobs force row level security;
alter table public.ph_reclass_recount_lines enable row level security;
alter table public.ph_reclass_recount_lines force row level security;
revoke all on public.ph_reclass_recount_jobs from public, anon, authenticated;
revoke all on public.ph_reclass_recount_lines from public, anon, authenticated;
grant select, insert, update, delete on public.ph_reclass_recount_jobs to service_role;
grant select, insert, update, delete on public.ph_reclass_recount_lines to service_role;

create or replace function private.capture_reclass_recount_event_v1(
  p_event_id uuid,
  p_payload jsonb,
  p_requested_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  inquiry jsonb := coalesce(p_payload->'reclassPayload', '{}'::jsonb);
  actor_username text := lower(btrim(coalesce(inquiry#>>'{actor,username}', '')));
begin
  if p_event_id is null or actor_username = ''
     or jsonb_typeof(inquiry#>'{transaction,requestActions}') is distinct from 'array'
     or not (inquiry#>'{transaction,requestActions}' ? 'recount')
     or jsonb_typeof(inquiry->'rowOverlays') is distinct from 'array' then
    return;
  end if;

  with overlay_rows as materialized (
    select value as overlay
    from jsonb_array_elements(inquiry->'rowOverlays')
    where btrim(coalesce(value->>'unique_id', '')) <> ''
  ), source_rows as materialized (
    select
      btrim(coalesce(m.itemcode, overlay#>>'{expected,itemcode}', inquiry#>>'{source,itemcode}', '')) itemcode,
      btrim(coalesce(m.commonname, inquiry#>>'{source,commonname}', '')) commonname,
      btrim(coalesce(m.contsize, inquiry#>>'{source,contsize}', '')) contsize,
      btrim(coalesce(m.locationcode, overlay#>>'{expected,locationcode}', '')) locationcode,
      coalesce(private.reclass_numeric_v1(m.ptronhand), private.reclass_numeric_v1(overlay#>>'{expected,ptronhand}'), 0) on_hand
    from overlay_rows o
    left join public.ph_master_inventory m on m.unique_id = o.overlay->>'unique_id'
  )
  insert into public.ph_reclass_recount_jobs(
    source_event_id, itemcode, commonname, contsize, locationcode,
    requested_by_username, requested_at, system_on_hand
  )
  select p_event_id, itemcode, max(commonname), max(contsize), locationcode,
    actor_username, coalesce(p_requested_at, now()), sum(on_hand)
  from source_rows
  where itemcode <> '' and locationcode <> ''
  group by itemcode, locationcode
  on conflict(source_event_id, itemcode, locationcode) do nothing;

  with overlay_rows as materialized (
    select value as overlay
    from jsonb_array_elements(inquiry->'rowOverlays')
    where btrim(coalesce(value->>'unique_id', '')) <> ''
  )
  insert into public.ph_reclass_recount_lines(
    job_id, source_unique_id, itemcode, locationcode, lotcode, season, on_hand, available, review
  )
  select j.id, o.overlay->>'unique_id', j.itemcode, j.locationcode,
    btrim(coalesce(m.lotcode, o.overlay#>>'{expected,lotcode}', '')),
    btrim(coalesce(m.season, '')),
    coalesce(private.reclass_numeric_v1(m.ptronhand), private.reclass_numeric_v1(o.overlay#>>'{expected,ptronhand}'), 0),
    coalesce(private.reclass_numeric_v1(m.ptravailable), 0),
    coalesce(private.reclass_numeric_v1(m.ptrreviewed), 0)
  from overlay_rows o
  left join public.ph_master_inventory m on m.unique_id = o.overlay->>'unique_id'
  join public.ph_reclass_recount_jobs j
    on j.source_event_id = p_event_id
   and j.itemcode = btrim(coalesce(m.itemcode, o.overlay#>>'{expected,itemcode}', inquiry#>>'{source,itemcode}', ''))
   and j.locationcode = btrim(coalesce(m.locationcode, o.overlay#>>'{expected,locationcode}', ''))
  on conflict(job_id, source_unique_id) do update set
    lotcode = excluded.lotcode,
    season = excluded.season,
    on_hand = excluded.on_hand,
    available = excluded.available,
    review = excluded.review;

  update public.ph_reclass_recount_jobs j
  set system_on_hand = totals.system_on_hand, updated_at = now()
  from (
    select l.job_id, sum(l.on_hand) system_on_hand
    from public.ph_reclass_recount_lines l
    where l.job_id in (select id from public.ph_reclass_recount_jobs where source_event_id = p_event_id)
    group by l.job_id
  ) totals
  where j.id = totals.job_id and j.status = 'pending';
end
$function$;
revoke all on function private.capture_reclass_recount_event_v1(uuid,jsonb,timestamptz) from public, anon, authenticated, service_role;

create or replace function private.capture_reclass_recount_outbox_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.event_type = 'reclass_inquiry' then
    perform private.capture_reclass_recount_event_v1(new.event_id, new.payload, new.created_at);
  end if;
  return new;
end
$function$;
revoke all on function private.capture_reclass_recount_outbox_v1() from public, anon, authenticated, service_role;

drop trigger if exists capture_reclass_recount_outbox_v1 on public.ph_request_delivery_outbox;
create trigger capture_reclass_recount_outbox_v1
after insert or update of payload, event_type on public.ph_request_delivery_outbox
for each row execute function private.capture_reclass_recount_outbox_v1();

do $block$
declare
  event_row record;
begin
  for event_row in
    select event_id, payload, created_at
    from public.ph_request_delivery_outbox
    where event_type = 'reclass_inquiry'
      and payload#>'{reclassPayload,transaction,requestActions}' ? 'recount'
  loop
    perform private.capture_reclass_recount_event_v1(event_row.event_id, event_row.payload, event_row.created_at);
  end loop;
end
$block$;

create or replace function public.complete_reclass_recount_v1(
  p_actor_id uuid,
  p_job_id uuid,
  p_counted_total numeric,
  p_idempotency_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $function$
declare
  actor public.profiles%rowtype;
  job public.ph_reclass_recount_jobs%rowtype;
  event_row public.ph_request_delivery_outbox%rowtype;
  recipients text[];
  lots jsonb;
  event_key_value text;
  payload_value jsonb;
begin
  if not private.is_service_role_request() then
    raise exception using errcode='42501', message='RECLASS_RECOUNT_FORBIDDEN';
  end if;
  if p_actor_id is null or p_job_id is null or p_idempotency_token is null
     or p_counted_total is null or p_counted_total < 0 or p_counted_total > 1000000000
     or trunc(p_counted_total) <> p_counted_total then
    raise exception using errcode='22023', message='RECLASS_RECOUNT_INPUT_INVALID';
  end if;
  select * into actor from public.profiles p
  where p.id = p_actor_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password;
  if actor.id is null or not private.user_access_has_permission_v1(actor.id, 'can_access_que') then
    raise exception using errcode='42501', message='RECLASS_RECOUNT_PROFILE_FORBIDDEN';
  end if;
  select * into job from public.ph_reclass_recount_jobs j where j.id = p_job_id for update;
  if job.id is null then raise exception using errcode='P0002', message='RECLASS_RECOUNT_JOB_MISSING'; end if;
  if job.status = 'completed' then
    if job.counted_total is distinct from p_counted_total then
      raise exception using errcode='PT409', message='RECLASS_RECOUNT_ALREADY_COMPLETED';
    end if;
    return jsonb_build_object('ok',true,'duplicate',true,'jobId',job.id,'status',job.status,
      'countedTotal',job.counted_total,'systemOnHand',job.system_on_hand,'variance',job.variance,
      'deliveryEventId',job.delivery_event_id);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceUniqueId', l.source_unique_id, 'lotcode', l.lotcode, 'season', l.season,
    'onHand', l.on_hand, 'available', l.available, 'review', l.review
  ) order by l.lotcode, l.season, l.source_unique_id), '[]'::jsonb)
  into lots from public.ph_reclass_recount_lines l where l.job_id = job.id;
  if jsonb_array_length(lots) < 1 then
    raise exception using errcode='P0001', message='RECLASS_RECOUNT_LINES_MISSING';
  end if;

  select array_agg(distinct lower(btrim(u.email)) order by lower(btrim(u.email))) into recipients
  from public.profiles p join auth.users u on u.id = p.id
  where lower(btrim(p.username)) = any(array[
      'dylan_collyge', 'megan_kelly', lower(btrim(job.requested_by_username)), lower(btrim(actor.username))
    ])
    and p.disabled_at is null and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password
    and u.email_confirmed_at is not null
    and btrim(coalesce(u.email, '')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
  if coalesce(cardinality(recipients), 0) < 2 or cardinality(recipients) > 4 then
    raise exception using errcode='P0001', message='RECLASS_RECOUNT_RECIPIENTS_UNAVAILABLE';
  end if;

  event_key_value := 'reclass-recount-completed:' || job.id::text;
  payload_value := jsonb_build_object(
    'contractVersion','reclass-recount-completed-v1','jobId',job.id,
    'itemcode',job.itemcode,'commonname',job.commonname,'contsize',job.contsize,
    'locationcode',job.locationcode,'systemOnHandTotal',job.system_on_hand,
    'countedTotal',p_counted_total,'variance',p_counted_total-job.system_on_hand,
    'requestedByUsername',job.requested_by_username,'submittedByUsername',lower(btrim(actor.username)),
    'submittedByDisplayName',coalesce(nullif(btrim(actor.display_name),''),actor.username),
    'deliveryRecipients',to_jsonb(recipients),'lots',lots
  );
  insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,payload,status,next_attempt_at)
  values(event_key_value,'reclass_recount_completed',job.id::text,payload_value,'pending',now())
  on conflict(event_key) do nothing;
  select * into event_row from public.ph_request_delivery_outbox where event_key = event_key_value;
  if event_row.event_id is null then raise exception using errcode='P0001', message='RECLASS_RECOUNT_OUTBOX_MISSING'; end if;

  update public.ph_reclass_recount_jobs set
    status='completed', counted_total=p_counted_total, variance=p_counted_total-system_on_hand,
    completed_by_username=lower(btrim(actor.username)), completed_at=now(),
    completion_command_id=p_idempotency_token, delivery_event_id=event_row.event_id, updated_at=now()
  where id=job.id;
  return jsonb_build_object('ok',true,'duplicate',false,'jobId',job.id,'status','completed',
    'countedTotal',p_counted_total,'systemOnHand',job.system_on_hand,
    'variance',p_counted_total-job.system_on_hand,'deliveryEventId',event_row.event_id);
end
$function$;
revoke all on function public.complete_reclass_recount_v1(uuid,uuid,numeric,uuid) from public, anon, authenticated;
grant execute on function public.complete_reclass_recount_v1(uuid,uuid,numeric,uuid) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
