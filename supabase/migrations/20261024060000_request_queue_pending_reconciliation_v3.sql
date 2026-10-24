begin;

set local lock_timeout='2s';
set local statement_timeout='120s';

create index if not exists ph_request_delivery_outbox_request_completed_recent_idx
on public.ph_request_delivery_outbox(created_at desc,event_id desc)
where event_type='request_completed';

create index if not exists ph_request_queue_removal_commands_request_uid_idx
on private.ph_request_queue_removal_commands(request_uid);

select pg_advisory_xact_lock(hashtextextended('request-created-outbox-reconciliation-v1',0));

create or replace function private.reconcile_active_requests_from_outbox_v1()
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='30s' as $fn$
declare
  candidate record;
  request_row public.ph_active_request%rowtype;
  candidate_count integer:=0;
  inserted_count integer:=0;
  repaired_count integer:=0;
  retained_count integer:=0;
  json_count integer:=0;
  html_count integer:=0;
  skipped_count integer:=0;
  next_id bigint;
  active_exists boolean;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('request-created-outbox-reconciliation-v1',0)) then
    return jsonb_build_object('ok',true,'busy',true,'examined',0,'inserted',0,'repaired',0,
      'retained',0,'json',0,'html',0,'skipped',0,'scope','all');
  end if;

  select coalesce(max(id),0)+1 into next_id from public.ph_active_request;
  for candidate in
    with created_events as materialized (
      select o.event_id,o.created_at,o.payload
      from public.ph_request_delivery_outbox o
      where o.event_type='request_created'
    ), json_created as (
      select o.event_id,o.created_at,entry.ordinality,
        entry.value||jsonb_build_object('unique_id',coalesce(
          nullif(btrim(entry.value->>'unique_id'),''),
          nullif(btrim(o.payload->'request_ids'->>((entry.ordinality-1)::integer)),''),
          'REQ-RECOVER-'||substr(md5(o.event_id::text||':json:'||entry.ordinality::text),1,20)
        )) request_payload,'json'::text source_format
      from created_events o
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(o.payload->'requests')='array' then o.payload->'requests' else '[]'::jsonb end
      ) with ordinality as entry(value,ordinality)
      where jsonb_typeof(entry.value)='object'
    ), html_events as (
      select o.event_id,o.created_at,o.payload,coalesce(
        nullif(o.payload->>'html',''),nullif(o.payload->>'html_body',''),
        nullif(o.payload->>'body_html',''),nullif(o.payload->>'message_html',''),'') html
      from created_events o
    ), html_rows as (
      select event.event_id,event.created_at,event.payload,row_match.parts[1] row_html,row_match.row_ordinal
      from html_events event
      cross join lateral regexp_matches(event.html,'<tr[^>]*>(.*?)</tr>','gis')
        with ordinality as row_match(parts,row_ordinal)
      where event.html<>''
    ), html_cells as (
      select row.event_id,row.created_at,row.payload,row.row_ordinal,
        array_agg(
          btrim(regexp_replace(
            replace(replace(replace(replace(replace(
              regexp_replace(regexp_replace(cell.parts[1],'<br[[:space:]]*/?>',' ','gi'),'<[^>]+>',' ','g'),
              '&nbsp;',' '),'&amp;','&'),'&#39;',chr(39)),'&quot;','"'),'&reg;',chr(174)),
            '[[:space:]]+',' ','g')) order by cell.cell_ordinal
        ) cells
      from html_rows row
      cross join lateral regexp_matches(row.row_html,'<t[dh][^>]*>(.*?)</t[dh]>','gis')
        with ordinality as cell(parts,cell_ordinal)
      group by row.event_id,row.created_at,row.payload,row.row_ordinal
    ), html_created as (
      select cell.event_id,cell.created_at,cell.row_ordinal ordinality,
        coalesce(history.request_payload,'{}'::jsonb)||jsonb_build_object(
          'unique_id',coalesce(
            nullif(btrim(cell.payload->'request_ids'->>((cell.row_ordinal-1)::integer)),''),
            history.unique_id,
            'REQ-RECOVER-'||substr(md5(cell.event_id::text||':html:'||cell.row_ordinal::text),1,20)
          ),
          'itemcode',cell.cells[1],'commonname',cell.cells[2],'contsize',cell.cells[3],
          'lotcode',cell.cells[4],'locationcode',cell.cells[5],
          'req_status','Pending','req_archived',false,'date_completed',null,'created_at',cell.created_at
        ) request_payload,'html'::text source_format
      from html_cells cell
      left join lateral (
        select history_row.unique_id,to_jsonb(history_row) request_payload
        from public.ph_request_history history_row
        where upper(btrim(coalesce(history_row.itemcode,'')))=upper(btrim(cell.cells[1]))
          and upper(btrim(coalesce(history_row.locationcode,'')))=upper(btrim(cell.cells[5]))
          and coalesce(history_row.req_archived,false)=false
          and history_row.date_completed is null
          and lower(btrim(coalesce(history_row.req_status,'pending'))) not in
            ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed')
        order by abs(extract(epoch from history_row.created_at-cell.created_at)),history_row.created_at desc
        limit 1
      ) history on true
      where cardinality(cell.cells)>=5
        and cell.cells[1]~'^[0-9]{6}[.][0-9]{3}[.][0-9]+$'
        and nullif(btrim(cell.cells[5]),'') is not null
    ), created as (
      select * from json_created
      union all
      select html.* from html_created html
      where not exists (
        select 1 from json_created json
        where json.event_id=html.event_id
          and upper(btrim(coalesce(json.request_payload->>'itemcode','')))=upper(btrim(coalesce(html.request_payload->>'itemcode','')))
          and upper(btrim(coalesce(json.request_payload->>'locationcode','')))=upper(btrim(coalesce(html.request_payload->>'locationcode','')))
      )
    ), latest as (
      select distinct on (created.request_payload->>'unique_id')
        created.event_id,created.created_at,created.request_payload,created.source_format
      from created
      where nullif(btrim(created.request_payload->>'unique_id'),'') is not null
      order by created.request_payload->>'unique_id',created.created_at desc,created.event_id desc
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
      and (lower(btrim(coalesce(latest.request_payload->>'request_source',''))) not in ('general','av')
        or (nullif(btrim(latest.request_payload->>'customeridentityid'),'') is not null
          and nullif(btrim(latest.request_payload->>'consigneeidentityid'),'') is not null
          and nullif(btrim(latest.request_payload->>'customername'),'') is not null
          and nullif(btrim(latest.request_payload->>'consigneename'),'') is not null))
      and not exists (select 1 from completion_ids completed where completed.unique_id=latest.request_payload->>'unique_id')
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
      )
    order by latest.created_at,latest.request_payload->>'unique_id'
  loop
    candidate_count:=candidate_count+1;
    begin
      request_row:=jsonb_populate_record(null::public.ph_active_request,candidate.request_payload);
      select exists(select 1 from public.ph_active_request active where active.unique_id=request_row.unique_id)
        into active_exists;
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
        if active_exists then
          repaired_count:=repaired_count+1;
        else
          inserted_count:=inserted_count+1;
          if candidate.source_format='html' then html_count:=html_count+1; else json_count:=json_count+1; end if;
        end if;
      else
        retained_count:=retained_count+1;
      end if;
    exception when others then
      skipped_count:=skipped_count+1;
    end;
  end loop;

  return jsonb_build_object('ok',true,'busy',false,'examined',candidate_count,'inserted',inserted_count,
    'repaired',repaired_count,'retained',retained_count,'json',json_count,'html',html_count,
    'skipped',skipped_count,'scope','all');
end
$fn$;

revoke all on function private.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
create or replace function public.reconcile_active_requests_from_outbox_v1()
returns jsonb language sql security definer set search_path='' as $fn$
  select private.reconcile_active_requests_from_outbox_v1();
$fn$;
revoke all on function public.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
grant execute on function public.reconcile_active_requests_from_outbox_v1() to service_role;

create temporary table request_queue_terminal_v3 on commit drop as
with completion_ids as materialized (
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
select active.unique_id,
  case when coalesce(active.req_archived,false) then 'archived' else 'completed' end history_event
from public.ph_active_request active
where coalesce(active.req_archived,false)
  or nullif(btrim(coalesce(active.date_completed,'')),'') is not null
  or lower(btrim(coalesce(active.req_status,''))) in
    ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed')
  or exists(select 1 from completion_ids completed where completed.unique_id=active.unique_id);

create unique index request_queue_terminal_v3_uid_idx on request_queue_terminal_v3(unique_id);

do $preserve$
declare
  terminal_row record;
begin
  for terminal_row in
    select terminal.* from request_queue_terminal_v3 terminal
    where not exists (
      select 1 from public.ph_request_history history where history.unique_id=terminal.unique_id
    )
    order by terminal.unique_id
  loop
    perform private.upsert_request_history(terminal_row.unique_id,terminal_row.history_event,'not_queued',true);
  end loop;
  if exists (
    select 1 from request_queue_terminal_v3 terminal
    where not exists(select 1 from public.ph_request_history history where history.unique_id=terminal.unique_id)
  ) then
    raise exception 'REQUEST_TERMINAL_HISTORY_PRESERVATION_INCOMPLETE';
  end if;
end
$preserve$;

delete from public.ph_active_request active
using request_queue_terminal_v3 terminal
where active.unique_id=terminal.unique_id;

create temporary table request_queue_expected_pending_v3 on commit drop as
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
  and (lower(btrim(coalesce(latest.request_payload->>'request_source',''))) not in ('general','av')
    or (nullif(btrim(latest.request_payload->>'customeridentityid'),'') is not null
      and nullif(btrim(latest.request_payload->>'consigneeidentityid'),'') is not null
      and nullif(btrim(latest.request_payload->>'customername'),'') is not null
      and nullif(btrim(latest.request_payload->>'consigneename'),'') is not null))
  and not exists(select 1 from completion_ids completed where completed.unique_id=latest.request_payload->>'unique_id')
  and not exists(select 1 from private.ph_request_queue_removal_commands removed where removed.request_uid=latest.request_payload->>'unique_id')
  and not exists(select 1 from app_sync_private.request_lifecycle_tombstones_v1 tombstone where tombstone.unique_id=latest.request_payload->>'unique_id')
  and not exists (
    select 1 from public.ph_request_history history
    where history.unique_id=latest.request_payload->>'unique_id'
      and (coalesce(history.req_archived,false) or history.date_completed is not null
        or lower(btrim(coalesce(history.req_status,''))) in
          ('complete','completed','done','closed','archived','fulfilled','cancelled','canceled','removed')
        or lower(btrim(coalesce(history.last_event,''))) in
          ('complete','completed','archived','deleted','fulfilled','cancelled','canceled','removed'))
  );

create unique index request_queue_expected_pending_v3_uid_idx on request_queue_expected_pending_v3(unique_id);

do $reconcile$
declare
  reconciliation jsonb;
begin
  reconciliation:=private.reconcile_active_requests_from_outbox_v1();
  if not coalesce((reconciliation->>'ok')::boolean,false)
    or coalesce((reconciliation->>'busy')::boolean,false)
    or coalesce((reconciliation->>'skipped')::integer,0)<>0 then
    raise exception 'REQUEST_OUTBOX_RECONCILIATION_INCOMPLETE: %',reconciliation;
  end if;
end
$reconcile$;

insert into public.app_dataset_revisions(key,revision,state,changed_at)
values('ph_active_request',1,'ready',clock_timestamp())
on conflict(key) do update set revision=public.app_dataset_revisions.revision+1,changed_at=clock_timestamp();

do $verify$
declare
  missing text;
  reconciliation_definition text:=lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure));
begin
  if position('limit 100' in reconciliation_definition)>0
    or position('request_completed' in reconciliation_definition)=0
    or position('ph_request_queue_removal_commands' in reconciliation_definition)=0
    or position('request_lifecycle_tombstones_v1' in reconciliation_definition)=0
    or position('jsonb_array_elements' in reconciliation_definition)=0
    or position('regexp_matches' in reconciliation_definition)=0 then
    raise exception 'ALL_EVENT_REQUEST_RECONCILIATION_CONTRACT_INVALID';
  end if;
  if exists (
    select 1 from request_queue_expected_pending_v3 expected
    left join public.ph_active_request active on active.unique_id=expected.unique_id
      and lower(btrim(coalesce(active.req_status,'')))='pending'
      and coalesce(active.req_archived,false)=false
      and nullif(btrim(coalesce(active.date_completed,'')),'') is null
    where active.unique_id is null
  ) then
    raise exception 'REQUEST_CREATED_RECONCILIATION_INCOMPLETE';
  end if;
  if exists (
    select 1 from public.ph_active_request active
    where coalesce(active.req_archived,false)
      or nullif(btrim(coalesce(active.date_completed,'')),'') is not null
      or lower(btrim(coalesce(active.req_status,'')))<>'pending'
  ) then
    raise exception 'ACTIVE_REQUEST_TERMINAL_ROWS_REMAIN';
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
    and active.itemcode=required.itemcode
    and upper(btrim(active.locationcode))=upper(required.locationcode)
    and active.req_qty=required.expected_qty
    and lower(btrim(coalesce(active.req_status,'')))='pending'
    and coalesce(active.req_archived,false)=false
    and nullif(btrim(coalesce(active.date_completed,'')),'') is null
  where active.unique_id is null;
  if missing is not null then raise exception 'NAMED_PENDING_REQUESTS_MISSING: %',missing; end if;
  if not exists(select 1 from public.app_dataset_revisions where key='ph_active_request') then
    raise exception 'ACTIVE_REQUEST_REVISION_MISSING';
  end if;
  if not has_function_privilege('service_role','public.reconcile_active_requests_from_outbox_v1()','execute')
    or has_function_privilege('authenticated','public.reconcile_active_requests_from_outbox_v1()','execute') then
    raise exception 'REQUEST_RECONCILIATION_PRIVILEGES_INVALID';
  end if;
end
$verify$;

comment on function private.reconcile_active_requests_from_outbox_v1() is
  'Idempotent all-event recovery of uncompleted request-created rows, excluding completion, removal, history-terminal, and lifecycle-tombstone identities.';

commit;
