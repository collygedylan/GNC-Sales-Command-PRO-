begin;

create index if not exists ph_request_delivery_outbox_request_created_recent_idx
on public.ph_request_delivery_outbox(created_at desc,event_id desc)
where event_type='request_created';

create or replace function private.reconcile_active_requests_from_outbox_v1()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  candidate record;
  request_row public.ph_active_request%rowtype;
  candidate_count integer:=0;
  inserted_count integer:=0;
  json_count integer:=0;
  html_count integer:=0;
  skipped_count integer:=0;
  next_id bigint;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('request-created-outbox-reconciliation-v1',0)) then
    return jsonb_build_object('ok',true,'busy',true,'examined',0,'inserted',0,'json',0,'html',0,'skipped',0);
  end if;

  select coalesce(max(id),0)+1 into next_id from public.ph_active_request;
  for candidate in
    with recent as materialized (
      select o.event_id,o.created_at,o.payload
      from public.ph_request_delivery_outbox o
      where o.event_type='request_created'
      order by o.created_at desc,o.event_id desc
      limit 100
    ), json_created as (
      select o.event_id,o.created_at,entry.ordinality,
        entry.value||jsonb_build_object('unique_id',coalesce(
          nullif(btrim(entry.value->>'unique_id'),''),
          nullif(btrim(o.payload->'request_ids'->>((entry.ordinality-1)::integer)),''),
          'REQ-RECOVER-'||substr(md5(o.event_id::text||':json:'||entry.ordinality::text),1,20)
        )) request_payload,'json'::text source_format
      from recent o
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(o.payload->'requests')='array' then o.payload->'requests' else '[]'::jsonb end
      ) with ordinality as entry(value,ordinality)
      where jsonb_typeof(entry.value)='object'
    ), html_events as (
      select o.event_id,o.created_at,o.payload,coalesce(
        nullif(o.payload->>'html',''),nullif(o.payload->>'html_body',''),
        nullif(o.payload->>'body_html',''),nullif(o.payload->>'message_html',''),'') html
      from recent o
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
            ('complete','completed','done','closed','archived','cancelled','canceled','removed')
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
      and not exists (
        select 1 from public.ph_active_request active
        where active.unique_id=latest.request_payload->>'unique_id'
      )
      and not exists (
        select 1 from public.ph_request_history history
        where history.unique_id=latest.request_payload->>'unique_id'
          and (coalesce(history.req_archived,false)
            or history.date_completed is not null
            or lower(btrim(coalesce(history.req_status,''))) in
              ('complete','completed','done','closed','archived','cancelled','canceled','removed')
            or lower(btrim(coalesce(history.last_event,''))) in
              ('complete','completed','archived','deleted','cancelled','canceled','removed'))
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
      request_row:=jsonb_populate_record(null::public.ph_active_request,candidate.request_payload);
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
      on conflict(unique_id) do nothing;
      if found then
        inserted_count:=inserted_count+1;
        if candidate.source_format='html' then html_count:=html_count+1; else json_count:=json_count+1; end if;
      end if;
    exception when others then
      skipped_count:=skipped_count+1;
    end;
  end loop;

  return jsonb_build_object('ok',true,'busy',false,'examined',candidate_count,'inserted',inserted_count,
    'json',json_count,'html',html_count,'skipped',skipped_count,'limit',100);
end
$fn$;

revoke all on function private.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
create or replace function public.reconcile_active_requests_from_outbox_v1()
returns jsonb language sql security definer set search_path='' as $fn$
  select private.reconcile_active_requests_from_outbox_v1();
$fn$;
revoke all on function public.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
grant execute on function public.reconcile_active_requests_from_outbox_v1() to service_role;

do $contract$
declare
  reconciliation_definition text:=lower(pg_get_functiondef('private.reconcile_active_requests_from_outbox_v1()'::regprocedure));
  submission_definition text:=lower(pg_get_functiondef('private.insert_request_batch(uuid,jsonb,text)'::regprocedure));
begin
  if position('limit 100' in reconciliation_definition)=0
    or position('order by o.created_at desc,o.event_id desc' in reconciliation_definition)=0
    or position('jsonb_array_elements' in reconciliation_definition)=0
    or position('regexp_matches' in reconciliation_definition)=0 then
    raise exception 'BOUNDED_REQUEST_RECONCILIATION_CONTRACT_INVALID';
  end if;
  if position('insert into public.ph_active_request' in submission_definition)=0
    or position('insert into public.ph_request_delivery_outbox' in submission_definition)=0
    or position('insert into public.ph_active_request' in submission_definition)
      > position('insert into public.ph_request_delivery_outbox' in submission_definition) then
    raise exception 'ATOMIC_REQUEST_SUBMISSION_CONTRACT_INVALID';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.ph_active_request'::regclass
      and tgname='app_dataset_revision_inserted' and tgenabled='O'
  ) then
    raise exception 'ACTIVE_REQUEST_REVISION_TRIGGER_MISSING';
  end if;
end
$contract$;

select private.reconcile_active_requests_from_outbox_v1();

with recent as materialized (
  select event_id,created_at,payload
  from public.ph_request_delivery_outbox
  where event_type='request_created'
  order by created_at desc,event_id desc
  limit 100
), sunburst as (
  select request_entry.request_payload->>'unique_id' unique_id
  from recent
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(payload->'requests')='array' then payload->'requests' else '[]'::jsonb end
  ) as request_entry(request_payload)
  where request_entry.request_payload->>'itemcode'='008280.150.1'
    and upper(btrim(coalesce(request_entry.request_payload->>'locationcode','')))=upper('C.05.000')
  order by created_at desc
  limit 1
)
update public.ph_active_request active set
  req_qty='4',req_status='Pending',req_archived=false,date_completed=null,
  row_version=coalesce(active.row_version,0)+1,updated_at=clock_timestamp()
from sunburst
where active.unique_id=sunburst.unique_id
  and not exists (
    select 1 from public.ph_request_history history
    where history.unique_id=active.unique_id
      and (coalesce(history.req_archived,false) or history.date_completed is not null
        or lower(btrim(coalesce(history.req_status,''))) in
          ('complete','completed','done','closed','archived','cancelled','canceled','removed'))
  )
  and (active.req_qty is distinct from '4' or active.req_status is distinct from 'Pending'
    or coalesce(active.req_archived,false) or active.date_completed is not null);

do $verify$
declare
  missing text;
begin
  with required(itemcode,locationcode,expected_qty) as (values
    ('009199.013.1','D.09.013',null::text),('009501.013.1','D.09.044',null::text),
    ('001711.030.1','D.26.000',null::text),('001711.070.1','F.05.000',null::text),
    ('001884.011.1','E.10.000',null::text),('003139.250.1','A.08.000','10'::text),
    ('008280.150.1','C.05.000','4'::text)
  ), recent as materialized (
    select event_id,created_at,payload
    from public.ph_request_delivery_outbox
    where event_type='request_created'
    order by created_at desc,event_id desc
    limit 100
  ), expected as (
    select distinct on (required.itemcode,required.locationcode)
      required.itemcode,required.locationcode,required.expected_qty,request_entry.request_payload->>'unique_id' unique_id
    from required
    join recent on true
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(recent.payload->'requests')='array' then recent.payload->'requests' else '[]'::jsonb end
    ) as request_entry(request_payload)
    where request_entry.request_payload->>'itemcode'=required.itemcode
      and upper(btrim(coalesce(request_entry.request_payload->>'locationcode','')))=upper(required.locationcode)
    order by required.itemcode,required.locationcode,recent.created_at desc,recent.event_id desc
  )
  select string_agg(required.itemcode||'@'||required.locationcode,', ' order by required.itemcode)
  into missing
  from required
  left join expected on expected.itemcode=required.itemcode and expected.locationcode=required.locationcode
  left join public.ph_active_request active on active.unique_id=expected.unique_id
    and coalesce(active.req_archived,false)=false and active.date_completed is null
    and lower(btrim(coalesce(active.req_status,'pending'))) in ('pending','open')
    and (expected.expected_qty is null or active.req_qty=expected.expected_qty)
  where expected.unique_id is null
    or (active.unique_id is null and not exists (
      select 1 from public.ph_request_history history
      where history.unique_id=expected.unique_id
        and (coalesce(history.req_archived,false) or history.date_completed is not null
          or lower(btrim(coalesce(history.req_status,''))) in
            ('complete','completed','done','closed','archived','cancelled','canceled','removed'))
    ));
  if missing is not null then raise exception 'PENDING_REQUEST_RECOVERY_INCOMPLETE: %',missing; end if;
end
$verify$;

comment on function private.reconcile_active_requests_from_outbox_v1() is
  'Best-effort recovery from only the 100 newest request-created events, with JSON and HTML row support.';

commit;
