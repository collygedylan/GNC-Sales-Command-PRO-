begin;

-- Field observations are separate from physical inventory. Only the fixed,
-- authenticated app-api operation can execute these commands.
create table workflow_private.field_count_commands (
 id uuid primary key, actor_id uuid not null references public.profiles(id),
 request jsonb not null, response jsonb not null, created_at timestamptz not null default now()
);
create table workflow_private.field_count_reports (
 id uuid primary key references workflow_private.field_count_commands(id) deferrable initially deferred,
 actor_id uuid not null references public.profiles(id), report jsonb not null,
 recipients jsonb not null, event_id uuid unique references public.ph_request_delivery_outbox(event_id),
 pdf jsonb, receipt jsonb, created_at timestamptz not null default now()
);
alter table workflow_private.field_count_commands enable row level security;
alter table workflow_private.field_count_reports enable row level security;
revoke all on workflow_private.field_count_commands, workflow_private.field_count_reports from public, anon, authenticated;

create function public.field_count_command_v1(p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare
 actor public.profiles; role_key text; kind text; block_code text; location_code text; page_number integer;
 master_revision text; count_revision text; source_state text; total_rows bigint; result jsonb;
 options jsonb; rows_json jsonb; counts_json jsonb; item jsonb; source_row record;
 existing_at timestamptz; expected_at timestamptz; prior workflow_private.field_count_commands;
 request_value jsonb; entries jsonb; direction_value text; count_value numeric; note_value text;
 saved_ids jsonb := '[]'::jsonb; report_rows jsonb := '[]'::jsonb; recipient_rows jsonb; event uuid;
begin
 if not private.is_service_role_request() then raise exception 'FIELD_COUNT_FORBIDDEN' using errcode='42501'; end if;
 actor := bunch_note_private.actor(p_actor_id);
 role_key := regexp_replace(upper(coalesce(actor.role,'')),'\s+','','g');
 -- Match the established app-api count-table access. No new recipient or
 -- inventory permission is granted by opening this screen.
 if actor.username not in ('dylan_collyge','megan_kelly','jd_jones')
   and role_key not like '%ADMIN%' and role_key not like '%MANAGER%'
   and (role_key in ('REP','SALES') or role_key like '%SALESREP%' or role_key like '%CSR%'
     or role_key like 'QC%' or role_key like '%QCSUP%'
     or regexp_replace(role_key,'[^A-Z0-9]','','g')='SALESMARKETING') then
  raise exception 'FIELD_COUNT_FORBIDDEN' using errcode='42501';
 end if;
 if p_operation not in ('read','save','complete') or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'FIELD_COUNT_PAYLOAD_INVALID';
 end if;
 kind := p_payload->>'countType';
 if kind not in ('bunch','spread') or kind is null then raise exception 'FIELD_COUNT_TYPE_INVALID'; end if;
 block_code := btrim(coalesce(p_payload->>'block',p_payload#>>'{scope,block}',''));
 location_code := btrim(coalesce(p_payload->>'location',p_payload#>>'{scope,location}',''));
 if length(block_code)>100 or length(location_code)>100 then raise exception 'FIELD_COUNT_SCOPE_INVALID'; end if;
 if p_operation<>'read' then
  if p_command_id is null then raise exception 'FIELD_COUNT_PAYLOAD_INVALID'; end if;
 request_value:=jsonb_build_object('operation',p_operation,'payload',p_payload);
 perform pg_advisory_xact_lock(hashtextextended('field-count-command:'||p_command_id,0));
 select * into prior from workflow_private.field_count_commands where id=p_command_id;
 if found then
  if prior.actor_id<>actor.id or prior.request<>request_value then raise exception 'FIELD_COUNT_COMMAND_CONFLICT' using errcode='40001'; end if;
  return prior.response;
 end if;
 end if;
 select revision::text,state into master_revision,source_state from public.app_dataset_revisions where key='ph_master_inventory' for share;
 if master_revision is null or source_state<>'ready' then raise exception 'FIELD_COUNT_INVENTORY_UPDATING' using errcode='55000'; end if;
 select revision::text into count_revision from public.app_dataset_revisions where key=case kind when 'bunch' then 'ph_bunch_counts' else 'ph_spread_counts' end;
 count_revision:=coalesce(count_revision,'0');
 if p_operation='read' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('countType','block','location','page'))
    or coalesce(p_payload->>'page','0') !~ '^\d{1,6}$' then raise exception 'FIELD_COUNT_PAYLOAD_INVALID'; end if;
  page_number := coalesce((p_payload->>'page')::integer,0);
  if location_code<>'' and block_code='' then raise exception 'FIELD_COUNT_SCOPE_INVALID'; end if;
  if location_code='' then
   with grouped as (
    select case when block_code='' then btrim(m.blockalpha) else btrim(m.locationcode) end value,count(*) row_count
    from public.ph_master_inventory m where nullif(btrim(m.blockalpha),'') is not null and nullif(btrim(m.locationcode),'') is not null
     and (block_code='' or btrim(m.blockalpha)=block_code)
    group by 1
   ), numbered as (select value,row_count from grouped order by value limit 100 offset page_number*100)
   select (select coalesce(jsonb_agg(jsonb_build_object('value',value,'label',value,'rowCount',row_count) order by value),'[]') from numbered),
    (select count(*) from grouped) into options,total_rows;
   return jsonb_build_object('datasetRevision',count_revision,'masterRevision',master_revision,'options',options,
    'rows','[]'::jsonb,'counts','[]'::jsonb,'page',page_number,'total',total_rows,'complete',(page_number+1)*100>=total_rows);
  end if;
  select count(*) into total_rows from public.ph_master_inventory m where btrim(m.blockalpha)=block_code and btrim(m.locationcode)=location_code;
  with physical as (
   select m.unique_id,m.blockalpha,m.locationcode,m.itemcode,m.commonname,m.contsize,m.lotcode,m.season,m.ptronhand
   from public.ph_master_inventory m where btrim(m.blockalpha)=block_code and btrim(m.locationcode)=location_code
   order by m.commonname nulls last,m.itemcode nulls last,m.lotcode nulls last,m.unique_id limit 100 offset page_number*100
  ), observations as (
   select c.source_unique_id,c.counted_qty,c.direction,c.row_order,c.snapshot,c.updated_at,c.counted_by_display,c.counted_by_username
    from public.ph_bunch_counts c where kind='bunch' and c.source_unique_id in(select unique_id from physical)
   union all
   select c.source_unique_id,c.counted_qty,c.direction,c.row_order,c.snapshot,c.updated_at,c.counted_by_display,c.counted_by_username
    from public.ph_spread_counts c where kind='spread' and c.source_unique_id in(select unique_id from physical)
  ) select
   (select coalesce(jsonb_agg(jsonb_build_object('sourceUid',unique_id,'block',blockalpha,'location',locationcode,'itemcode',coalesce(itemcode,''),
    'commonname',coalesce(commonname,''),'contsize',coalesce(contsize,''),'lotcode',coalesce(lotcode,''),'season',coalesce(season,''),'onHand',ptronhand)
    order by commonname nulls last,itemcode nulls last,lotcode nulls last,unique_id),'[]') from physical),
   (select coalesce(jsonb_agg(jsonb_build_object('sourceUid',source_unique_id,'countedQty',counted_qty,'direction',direction,'rowOrder',row_order,
    'note',coalesce(snapshot->>'field_note',''),'updatedAt',updated_at,'actor',coalesce(counted_by_display,counted_by_username,'')) order by source_unique_id),'[]') from observations)
   into rows_json,counts_json;
  return jsonb_build_object('datasetRevision',count_revision,'masterRevision',master_revision,'options','[]'::jsonb,
   'rows',rows_json,'counts',counts_json,'page',page_number,'total',total_rows,'complete',(page_number+1)*100>=total_rows);
 end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('countType','scope','direction','entries'))
  or jsonb_typeof(p_payload->'scope') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_payload->'scope') k where k not in ('block','location'))
  or block_code='' or location_code='' or p_command_id is null then raise exception 'FIELD_COUNT_PAYLOAD_INVALID'; end if;
 entries:=p_payload->'entries'; direction_value:=p_payload->>'direction';
 if direction_value is null or direction_value not in ('north_south','south_north','east_west','west_east')
  or jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 100 then raise exception 'FIELD_COUNT_ENTRIES_INVALID'; end if;
 if (select count(distinct e->>'sourceUid') from jsonb_array_elements(entries) e)<>jsonb_array_length(entries) then raise exception 'FIELD_COUNT_DUPLICATE_ROW'; end if;
 perform pg_advisory_xact_lock(hashtextextended('field-count-scope:'||kind||':'||block_code||':'||location_code,0));
 for item in select e from jsonb_array_elements(entries) e order by e->>'sourceUid' loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('sourceUid','countedQty','note','expectedUpdatedAt','rowOrder'))
    or jsonb_typeof(item->'countedQty') is distinct from 'number'
    or jsonb_typeof(item->'rowOrder') is distinct from 'number'
    or coalesce(item->>'countedQty','') !~ '^\d{1,9}$' or coalesce(item->>'rowOrder','') !~ '^\d{1,6}$'
    or (item->>'rowOrder')::integer<1 or length(coalesce(item->>'note',''))>2000
    or not(item ? 'expectedUpdatedAt') then raise exception 'FIELD_COUNT_ENTRY_INVALID'; end if;
  count_value:=(item->>'countedQty')::numeric; note_value:=coalesce(item->>'note','');
  select m.unique_id,m.itemcode,m.commonname,m.genusname as genus,m.contsize,m.locationcode,m.lotcode,m.season,m.blockalpha,m.ptronhand
   into source_row from public.ph_master_inventory m where m.unique_id=item->>'sourceUid'
    and btrim(m.blockalpha)=block_code and btrim(m.locationcode)=location_code for share;
  if not found then raise exception 'FIELD_COUNT_SOURCE_CHANGED' using errcode='40001'; end if;
  existing_at:=null;
  if kind='bunch' then select updated_at into existing_at from public.ph_bunch_counts where source_unique_id=source_row.unique_id for update;
  else select updated_at into existing_at from public.ph_spread_counts where source_unique_id=source_row.unique_id for update; end if;
  expected_at:=nullif(item->>'expectedUpdatedAt','')::timestamptz;
  if existing_at is distinct from expected_at then raise exception 'FIELD_COUNT_REVISION_CONFLICT' using errcode='40001'; end if;
  if kind='bunch' then
   insert into public.ph_bunch_counts(unique_id,source_unique_id,itemcode,commonname,genus,contsize,locationcode,lotcode,season,blockalpha,direction,row_order,counted_qty,
    counted_by_username,counted_by_display,counted_at,updated_by_username,updated_by_display,snapshot)
   values('bunch-count-'||source_row.unique_id,source_row.unique_id,source_row.itemcode,source_row.commonname,source_row.genus,source_row.contsize,
    source_row.locationcode,source_row.lotcode,source_row.season,source_row.blockalpha,direction_value,(item->>'rowOrder')::integer,count_value,
    actor.username,coalesce(actor.display_name,actor.username),clock_timestamp(),actor.username,coalesce(actor.display_name,actor.username),to_jsonb(source_row)||jsonb_build_object('field_note',note_value))
   on conflict(source_unique_id) do update set itemcode=excluded.itemcode,commonname=excluded.commonname,genus=excluded.genus,contsize=excluded.contsize,
    locationcode=excluded.locationcode,lotcode=excluded.lotcode,season=excluded.season,blockalpha=excluded.blockalpha,counted_qty=excluded.counted_qty,direction=excluded.direction,row_order=excluded.row_order,
    counted_by_username=excluded.counted_by_username,counted_by_display=excluded.counted_by_display,counted_at=excluded.counted_at,
    updated_by_username=excluded.updated_by_username,updated_by_display=excluded.updated_by_display,snapshot=excluded.snapshot
   returning updated_at into existing_at;
  else
   insert into public.ph_spread_counts(unique_id,source_unique_id,itemcode,commonname,genus,contsize,locationcode,lotcode,season,blockalpha,direction,row_order,counted_qty,
    counted_by_username,counted_by_display,counted_at,updated_by_username,updated_by_display,snapshot)
   values('spread-count-'||source_row.unique_id,source_row.unique_id,source_row.itemcode,source_row.commonname,source_row.genus,source_row.contsize,
    source_row.locationcode,source_row.lotcode,source_row.season,source_row.blockalpha,direction_value,(item->>'rowOrder')::integer,count_value,
    actor.username,coalesce(actor.display_name,actor.username),clock_timestamp(),actor.username,coalesce(actor.display_name,actor.username),to_jsonb(source_row)||jsonb_build_object('field_note',note_value))
   on conflict(source_unique_id) do update set itemcode=excluded.itemcode,commonname=excluded.commonname,genus=excluded.genus,contsize=excluded.contsize,
    locationcode=excluded.locationcode,lotcode=excluded.lotcode,season=excluded.season,blockalpha=excluded.blockalpha,counted_qty=excluded.counted_qty,direction=excluded.direction,row_order=excluded.row_order,
    counted_by_username=excluded.counted_by_username,counted_by_display=excluded.counted_by_display,counted_at=excluded.counted_at,
    updated_by_username=excluded.updated_by_username,updated_by_display=excluded.updated_by_display,snapshot=excluded.snapshot
   returning updated_at into existing_at;
  end if;
  saved_ids:=saved_ids||jsonb_build_array(source_row.unique_id);
  report_rows:=report_rows||jsonb_build_array(jsonb_build_object('sourceUid',source_row.unique_id,'itemcode',source_row.itemcode,'commonname',source_row.commonname,
   'contsize',source_row.contsize,'lotcode',source_row.lotcode,'season',source_row.season,'onHand',source_row.ptronhand,'countedQty',count_value,
   'direction',direction_value,'rowOrder',(item->>'rowOrder')::integer,'note',note_value));
 end loop;
 select revision::text into count_revision from public.app_dataset_revisions where key=case kind when 'bunch' then 'ph_bunch_counts' else 'ph_spread_counts' end;
 result:=jsonb_build_object('revision',coalesce(count_revision,'0'),'savedSourceUids',saved_ids);
 if p_operation='complete' then
  recipient_rows:=bunch_note_private.recipients(case when exists(select 1 from auth.users where id=actor.id and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then jsonb_build_array(actor.id) else '[]'::jsonb end);
  insert into public.ph_request_delivery_outbox(event_key,event_type,payload,delivery_mode)
   values('field-count:'||p_command_id,'field_count_completion',jsonb_build_object('report_id',p_command_id),'email') returning event_id into event;
  insert into workflow_private.field_count_reports(id,actor_id,report,recipients,event_id)
   values(p_command_id,actor.id,jsonb_build_object('id',p_command_id,'countType',kind,'block',block_code,'location',location_code,
    'completedAt',clock_timestamp(),'actor',coalesce(actor.display_name,actor.username),'rows',report_rows),recipient_rows,event);
  result:=result||jsonb_build_object('reportId',p_command_id,'deliveryStatus','queued');
 end if;
 insert into workflow_private.field_count_commands(id,actor_id,request,response) values(p_command_id,actor.id,request_value,result);
 return result;
end $$;
revoke all on function public.field_count_command_v1(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.field_count_command_v1(uuid,text,jsonb,uuid) to service_role;

create function public.field_count_delivery_lookup_v1(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r workflow_private.field_count_reports; e public.ph_request_delivery_outbox;
begin
 if not private.is_service_role_request() then raise exception 'FIELD_COUNT_FORBIDDEN' using errcode='42501'; end if;
 select * into e from public.ph_request_delivery_outbox where event_id=p_event_id and event_type='field_count_completion';
 select * into r from workflow_private.field_count_reports where event_id=p_event_id;
 if r.id is null or e.event_id is null then raise exception 'FIELD_COUNT_REPORT_NOT_FOUND'; end if;
 return jsonb_build_object('event_id',e.event_id,'event_key',e.event_key,'event_type',e.event_type,'report',r.report,
  'recipients',r.recipients,'pdf',r.pdf,'receipt',r.receipt,'delivery_status',coalesce(e.channel_results#>>'{email,status}','pending'));
end $$;
create function public.field_count_freeze_pdf_v1(p_event_id uuid,p_pdf jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r workflow_private.field_count_reports;
begin
 if not private.is_service_role_request() then raise exception 'FIELD_COUNT_FORBIDDEN' using errcode='42501'; end if;
 select * into r from workflow_private.field_count_reports where event_id=p_event_id for update;
 if not found then raise exception 'FIELD_COUNT_REPORT_NOT_FOUND'; end if;
 if r.pdf is not null then return jsonb_build_object('pdf',r.pdf); end if;
 if jsonb_typeof(p_pdf) is distinct from 'object' or p_pdf->>'filename' is distinct from 'Field_Count_'||r.id||'.pdf'
  or coalesce(p_pdf->>'base64','') !~ '^JVBERi0[A-Za-z0-9+/=\r\n]+$' or length(p_pdf->>'base64')>20000000 then raise exception 'FIELD_COUNT_PDF_INVALID'; end if;
 update workflow_private.field_count_reports set pdf=p_pdf where id=r.id;
 return jsonb_build_object('pdf',p_pdf);
end $$;
create function public.field_count_delivery_record_v1(p_event_id uuid,p_lease_token uuid,p_status text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ph_request_delivery_outbox; prior text; email jsonb;
begin
 if not private.is_service_role_request() then raise exception 'FIELD_COUNT_FORBIDDEN' using errcode='42501'; end if;
 select * into e from public.ph_request_delivery_outbox where event_id=p_event_id and event_type='field_count_completion' for update;
 if not found or e.status<>'processing' or e.lease_token is distinct from p_lease_token or p_lease_token is null or e.lease_expires_at is null or e.lease_expires_at<=now() then raise exception 'FIELD_COUNT_DELIVERY_LEASE_LOST'; end if;
 if p_status is null or p_status not in ('sending','sent','failed','unknown') or jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>32000 then raise exception 'FIELD_COUNT_DELIVERY_INVALID'; end if;
 if p_status='sent' and nullif(p_result->>'gmail_message_id','') is null then raise exception 'FIELD_COUNT_DELIVERY_RECEIPT_REQUIRED'; end if;
 email:=coalesce(e.channel_results->'email','{}'); prior:=coalesce(email->>'status','pending');
 if prior='sent' or (p_status='sending' and (prior in ('sending','unknown') or (prior='failed' and email->'safe_to_retry' is distinct from 'true'::jsonb))) then
  return jsonb_build_object('allow_send',false,'reconciliation_only',true,'status',prior);
 end if;
 if p_status='failed' and (prior in ('sending','unknown') or p_result->'safe_to_retry' is distinct from 'true'::jsonb) then raise exception 'FIELD_COUNT_RECONCILIATION_REQUIRED'; end if;
 email:=email||p_result||jsonb_build_object('status',p_status,'updated_at',now());
 if p_status in ('sending','unknown','sent') then email:=email||jsonb_build_object('safe_to_retry',false); end if;
 if p_status='sent' then email:=email||jsonb_build_object('delivered_at',now()); end if;
 perform public.record_request_delivery_channel_result(p_event_id,p_lease_token,jsonb_build_object('email',email));
 if p_status='sent' then update workflow_private.field_count_reports set receipt=p_result where event_id=p_event_id; end if;
 return jsonb_build_object('ok',true,'allow_send',p_status='sending');
end $$;
revoke all on function public.field_count_delivery_lookup_v1(uuid), public.field_count_freeze_pdf_v1(uuid,jsonb), public.field_count_delivery_record_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.field_count_delivery_lookup_v1(uuid), public.field_count_freeze_pdf_v1(uuid,jsonb), public.field_count_delivery_record_v1(uuid,uuid,text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
