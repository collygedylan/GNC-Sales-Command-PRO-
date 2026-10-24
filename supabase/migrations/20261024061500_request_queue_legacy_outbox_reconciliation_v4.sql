begin;

set local lock_timeout='2s';
set local statement_timeout='120s';

create or replace function private.reconcile_legacy_pending_requests_from_outbox_v4()
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='30s' as $fn$
declare
  candidate record;
  request_row public.ph_active_request%rowtype;
  candidate_count integer:=0;
  inserted_count integer:=0;
  repaired_count integer:=0;
  retained_count integer:=0;
  cleared_tombstone_count integer:=0;
  skipped_count integer:=0;
  next_id bigint;
  active_exists boolean;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('request-created-outbox-reconciliation-v1',0)) then
    return jsonb_build_object('ok',true,'busy',true,'examined',0,'inserted',0,'repaired',0,
      'retained',0,'clearedLegacyTombstones',0,'skipped',0,'scope','all-json');
  end if;

  perform set_config('request.jwt.claim.role','service_role',true);

  select coalesce(max(id),0)+1 into next_id from public.ph_active_request;
  for candidate in
    with json_created as (
      select o.event_id,o.created_at,
        entry.value||jsonb_build_object('unique_id',coalesce(
          nullif(btrim(entry.value->>'unique_id'),''),
          nullif(btrim(o.payload->'request_ids'->>((entry.ordinality-1)::integer)),''),
          'REQ-RECOVER-'||substr(md5(o.event_id::text||':json:'||entry.ordinality::text),1,20)
        )) request_payload
      from public.ph_request_delivery_outbox o
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(o.payload->'requests')='array' then o.payload->'requests' else '[]'::jsonb end
      ) with ordinality as entry(value,ordinality)
      where o.event_type='request_created' and jsonb_typeof(entry.value)='object'
    ), latest as (
      select distinct on (json_created.request_payload->>'unique_id')
        json_created.event_id,json_created.created_at,json_created.request_payload
      from json_created
      where nullif(btrim(json_created.request_payload->>'unique_id'),'') is not null
      order by json_created.request_payload->>'unique_id',json_created.created_at desc,json_created.event_id desc
    ), completion_ids as materialized (
      select btrim(o.request_id) unique_id
      from public.ph_request_delivery_outbox o
      where o.event_type='request_completed' and nullif(btrim(o.request_id),'') is not null
      union
      select btrim(o.payload->>'request_id')
      from public.ph_request_delivery_outbox o
      where o.event_type='request_completed' and nullif(btrim(o.payload->>'request_id'),'') is not null
      union
      select btrim(entry.value)
      from public.ph_request_delivery_outbox o
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(o.payload->'request_ids')='array' then o.payload->'request_ids' else '[]'::jsonb end
      ) entry(value)
      where o.event_type='request_completed' and nullif(btrim(entry.value),'') is not null
      union
      select btrim(entry.value)
      from public.ph_request_delivery_outbox o
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(o.payload->'activeRequestIds')='array' then o.payload->'activeRequestIds' else '[]'::jsonb end
      ) entry(value)
      where o.event_type='request_completed' and nullif(btrim(entry.value),'') is not null
    )
    select latest.* from latest
    where coalesce(lower(nullif(btrim(latest.request_payload->>'req_status'),'')),'pending') in ('pending','open')
      and lower(coalesce(nullif(btrim(latest.request_payload->>'req_archived'),''),'false')) not in ('true','t','1','yes','y')
      and nullif(btrim(latest.request_payload->>'date_completed'),'') is null
      and not exists(select 1 from completion_ids completed where completed.unique_id=latest.request_payload->>'unique_id')
      and not exists (
        select 1 from private.ph_request_queue_removal_commands removed
        where removed.request_uid=latest.request_payload->>'unique_id'
      )
      and not exists (
        select 1 from public.ph_request_history history
        where history.unique_id=latest.request_payload->>'unique_id'
          and (coalesce(history.req_archived,false)
            or history.date_completed is not null
            or lower(btrim(coalesce(history.req_status,''))) in
              ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed')
            or lower(btrim(coalesce(history.last_event,''))) in
              ('complete','completed','archived','deleted','fulfilled','cancelled','canceled','removed'))
      )
      and not exists (
        select 1 from app_sync_private.request_lifecycle_tombstones_v1 tombstone
        where tombstone.unique_id=latest.request_payload->>'unique_id'
          and lower(btrim(tombstone.terminal_state)) in
            ('complete','completed','archived','deleted','cancelled','canceled','removed')
      )
    order by latest.created_at,latest.request_payload->>'unique_id'
  loop
    candidate_count:=candidate_count+1;
    begin
      request_row:=jsonb_populate_record(null::public.ph_active_request,
        candidate.request_payload||case
          when lower(btrim(coalesce(candidate.request_payload->>'request_source',''))) in ('general','av')
            then jsonb_build_object('request_source','outbox_recovery')
          else '{}'::jsonb
        end);
      select exists(select 1 from public.ph_active_request active where active.unique_id=request_row.unique_id)
        into active_exists;
      delete from app_sync_private.request_lifecycle_tombstones_v1 tombstone
      where tombstone.unique_id=request_row.unique_id
        and lower(btrim(tombstone.terminal_state))='legacy-explicit-removal';
      if found then cleared_tombstone_count:=cleared_tombstone_count+1; end if;
      if request_row.id is null or exists(select 1 from public.ph_active_request where id=request_row.id) then
        request_row.id:=next_id;
        next_id:=next_id+1;
      end if;
      request_row.req_qty:=nullif(btrim(request_row.req_qty),'');
      request_row.req_status:='Pending';
      request_row.req_archived:=false;
      request_row.date_completed:=null;
      request_row.row_version:=greatest(coalesce(request_row.row_version,1),1);
      request_row.created_at:=coalesce(request_row.created_at,candidate.created_at,clock_timestamp());
      request_row.updated_at:=greatest(coalesce(request_row.updated_at,request_row.created_at),request_row.created_at);
      insert into public.ph_active_request select (request_row).*
      on conflict(unique_id) do update set
        req_status='Pending',req_archived=false,date_completed=null,
        row_version=greatest(coalesce(public.ph_active_request.row_version,1),1)+1,
        updated_at=clock_timestamp()
      where public.ph_active_request.req_status is distinct from 'Pending'
        or coalesce(public.ph_active_request.req_archived,false)
        or nullif(btrim(coalesce(public.ph_active_request.date_completed,'')),'') is not null;
      if found then
        if active_exists then repaired_count:=repaired_count+1; else inserted_count:=inserted_count+1; end if;
      else
        retained_count:=retained_count+1;
      end if;
    exception when others then
      skipped_count:=skipped_count+1;
    end;
  end loop;

  return jsonb_build_object('ok',true,'busy',false,'examined',candidate_count,'inserted',inserted_count,
    'repaired',repaired_count,'retained',retained_count,'clearedLegacyTombstones',cleared_tombstone_count,
    'skipped',skipped_count,'scope','all-json');
end
$fn$;

revoke all on function private.reconcile_legacy_pending_requests_from_outbox_v4() from public,anon,authenticated;

create or replace function public.reconcile_active_requests_from_outbox_v1()
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='30s' as $fn$
declare
  primary_result jsonb;
  legacy_result jsonb;
begin
  primary_result:=private.reconcile_active_requests_from_outbox_v1();
  if coalesce((primary_result->>'busy')::boolean,false) then return primary_result; end if;
  legacy_result:=private.reconcile_legacy_pending_requests_from_outbox_v4();
  return jsonb_build_object(
    'ok',coalesce((primary_result->>'ok')::boolean,false) and coalesce((legacy_result->>'ok')::boolean,false),
    'busy',coalesce((legacy_result->>'busy')::boolean,false),
    'examined',greatest(coalesce((primary_result->>'examined')::integer,0),coalesce((legacy_result->>'examined')::integer,0)),
    'inserted',coalesce((primary_result->>'inserted')::integer,0)+coalesce((legacy_result->>'inserted')::integer,0),
    'repaired',coalesce((primary_result->>'repaired')::integer,0)+coalesce((legacy_result->>'repaired')::integer,0),
    'retained',coalesce((legacy_result->>'retained')::integer,0),
    'clearedLegacyTombstones',coalesce((legacy_result->>'clearedLegacyTombstones')::integer,0),
    'skipped',coalesce((primary_result->>'skipped')::integer,0)+coalesce((legacy_result->>'skipped')::integer,0),
    'scope','all','primary',primary_result,'legacy',legacy_result
  );
end
$fn$;
revoke all on function public.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
grant execute on function public.reconcile_active_requests_from_outbox_v1() to service_role;

create temporary table request_queue_expected_legacy_pending_v4 on commit drop as
with json_created as (
  select o.event_id,o.created_at,
    entry.value||jsonb_build_object('unique_id',coalesce(
      nullif(btrim(entry.value->>'unique_id'),''),
      nullif(btrim(o.payload->'request_ids'->>((entry.ordinality-1)::integer)),''),
      'REQ-RECOVER-'||substr(md5(o.event_id::text||':json:'||entry.ordinality::text),1,20)
    )) request_payload
  from public.ph_request_delivery_outbox o
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(o.payload->'requests')='array' then o.payload->'requests' else '[]'::jsonb end
  ) with ordinality as entry(value,ordinality)
  where o.event_type='request_created' and jsonb_typeof(entry.value)='object'
), latest as (
  select distinct on (request_payload->>'unique_id') event_id,created_at,request_payload
  from json_created where nullif(btrim(request_payload->>'unique_id'),'') is not null
  order by request_payload->>'unique_id',created_at desc,event_id desc
), completion_ids as materialized (
  select btrim(o.request_id) unique_id from public.ph_request_delivery_outbox o
  where o.event_type='request_completed' and nullif(btrim(o.request_id),'') is not null
  union select btrim(o.payload->>'request_id') from public.ph_request_delivery_outbox o
  where o.event_type='request_completed' and nullif(btrim(o.payload->>'request_id'),'') is not null
  union select btrim(entry.value) from public.ph_request_delivery_outbox o
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(o.payload->'request_ids')='array' then o.payload->'request_ids' else '[]'::jsonb end
  ) entry(value) where o.event_type='request_completed' and nullif(btrim(entry.value),'') is not null
  union select btrim(entry.value) from public.ph_request_delivery_outbox o
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(o.payload->'activeRequestIds')='array' then o.payload->'activeRequestIds' else '[]'::jsonb end
  ) entry(value) where o.event_type='request_completed' and nullif(btrim(entry.value),'') is not null
)
select latest.request_payload->>'unique_id' unique_id
from latest
where coalesce(lower(nullif(btrim(latest.request_payload->>'req_status'),'')),'pending') in ('pending','open')
  and lower(coalesce(nullif(btrim(latest.request_payload->>'req_archived'),''),'false')) not in ('true','t','1','yes','y')
  and nullif(btrim(latest.request_payload->>'date_completed'),'') is null
  and not exists(select 1 from completion_ids completed where completed.unique_id=latest.request_payload->>'unique_id')
  and not exists(select 1 from private.ph_request_queue_removal_commands removed where removed.request_uid=latest.request_payload->>'unique_id')
  and not exists (
    select 1 from public.ph_request_history history
    where history.unique_id=latest.request_payload->>'unique_id'
      and (coalesce(history.req_archived,false) or history.date_completed is not null
        or lower(btrim(coalesce(history.req_status,''))) in
          ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed')
        or lower(btrim(coalesce(history.last_event,''))) in
          ('complete','completed','archived','deleted','fulfilled','cancelled','canceled','removed'))
  )
  and not exists (
    select 1 from app_sync_private.request_lifecycle_tombstones_v1 tombstone
    where tombstone.unique_id=latest.request_payload->>'unique_id'
      and lower(btrim(tombstone.terminal_state)) in
        ('complete','completed','archived','deleted','cancelled','canceled','removed')
  );

create unique index request_queue_expected_legacy_pending_v4_uid_idx
on request_queue_expected_legacy_pending_v4(unique_id);

do $reconcile$
declare
  reconciliation jsonb;
begin
  reconciliation:=public.reconcile_active_requests_from_outbox_v1();
  if not coalesce((reconciliation->>'ok')::boolean,false)
    or coalesce((reconciliation->>'busy')::boolean,false)
    or coalesce((reconciliation->>'skipped')::integer,0)<>0 then
    raise exception 'REQUEST_LEGACY_OUTBOX_RECONCILIATION_INCOMPLETE: %',reconciliation;
  end if;
end
$reconcile$;

do $verify$
declare
  missing text;
  supplemental_definition text:=lower(pg_get_functiondef('private.reconcile_legacy_pending_requests_from_outbox_v4()'::regprocedure));
  public_definition text:=lower(pg_get_functiondef('public.reconcile_active_requests_from_outbox_v1()'::regprocedure));
begin
  if position('legacy-explicit-removal' in supplemental_definition)=0
    or position('customeridentityid' in supplemental_definition)>0
    or position('outbox_recovery' in supplemental_definition)=0
    or position('request_completed' in supplemental_definition)=0
    or position('ph_request_queue_removal_commands' in supplemental_definition)=0 then
    raise exception 'REQUEST_LEGACY_RECONCILIATION_CONTRACT_INVALID';
  end if;
  if position('reconcile_legacy_pending_requests_from_outbox_v4' in public_definition)=0 then
    raise exception 'REQUEST_PUBLIC_RECONCILIATION_DELEGATION_MISSING';
  end if;
  if exists (
    select 1 from request_queue_expected_legacy_pending_v4 expected
    left join public.ph_active_request active on active.unique_id=expected.unique_id
      and lower(btrim(coalesce(active.req_status,'')))='pending'
      and coalesce(active.req_archived,false)=false
      and nullif(btrim(coalesce(active.date_completed,'')),'') is null
    where active.unique_id is null
  ) then
    raise exception 'REQUEST_LEGACY_PENDING_ROWS_MISSING';
  end if;
  if exists (
    select 1 from request_queue_expected_legacy_pending_v4 expected
    join app_sync_private.request_lifecycle_tombstones_v1 tombstone using(unique_id)
    where lower(btrim(tombstone.terminal_state))='legacy-explicit-removal'
  ) then
    raise exception 'REQUEST_FALSE_LEGACY_TOMBSTONES_REMAIN';
  end if;
  with required(unique_id,itemcode,locationcode,expected_qty) as (values
    ('REQ-mvlgbfl7p8r8zxrj97j','009199.013.1','D.09.013','1'::text),
    ('REQ-mvlg4t85vlzf7053pv','009501.013.1','D.09.044','1'::text),
    ('REQ-mvlfib5eqwa3typzcqq','001711.030.1','D.26.000','1'::text),
    ('REQ-mvlfib5evawvlvvx09','001711.070.1','F.05.000','1'::text),
    ('REQ-mvlex5bay7ngnehzi7','001884.011.1','E.10.000','1'::text),
    ('REQ-mvlbp5hkkk58akaubms','003139.250.1','A.08.000','10'::text),
    ('REQ-mvk1xgv2ty9fttuqj2','008280.150.1','C.05.000','4'::text)
  )
  select string_agg(required.itemcode||'@'||required.locationcode,', ' order by required.itemcode)
  into missing
  from required
  left join public.ph_active_request active on active.unique_id=required.unique_id
    and active.itemcode=required.itemcode and upper(btrim(active.locationcode))=upper(required.locationcode)
    and active.req_qty=required.expected_qty and lower(btrim(coalesce(active.req_status,'')))='pending'
    and coalesce(active.req_archived,false)=false and nullif(btrim(coalesce(active.date_completed,'')),'') is null
  where active.unique_id is null;
  if missing is not null then raise exception 'NAMED_PENDING_REQUESTS_MISSING_V4: %',missing; end if;
  if not has_function_privilege('service_role','public.reconcile_active_requests_from_outbox_v1()','execute')
    or has_function_privilege('authenticated','public.reconcile_active_requests_from_outbox_v1()','execute') then
    raise exception 'REQUEST_RECONCILIATION_PRIVILEGES_INVALID_V4';
  end if;
end
$verify$;

comment on function private.reconcile_legacy_pending_requests_from_outbox_v4() is
  'Recovers every uncompleted JSON request-created row without requiring later customer identity enrichment and clears only inferred legacy-removal tombstones.';
comment on function public.reconcile_active_requests_from_outbox_v1() is
  'Service-only all-event Request recovery combining HTML/current recovery with legacy JSON request-created reconciliation.';

commit;
