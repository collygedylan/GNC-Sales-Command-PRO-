begin;
set local statement_timeout = '120s';
create or replace function private.soc_operational_source_row_v23191(row_value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare plan text:=btrim(coalesce(nullif(row_value->>'planstart',''),row_value->>'plan_start','')); yr integer:=0; dock text;
begin
  dock:=regexp_replace(btrim(coalesce(nullif(row_value->>'dock',''),row_value->>'dock_num','')),'^dock\s*','','i');
  if dock !~ '^[0-9]+$' or dock::numeric<=0 then return false; end if;
  if plan ~ '^[0-9]{5}([.][0-9]+)?$' then yr:=extract(year from date '1899-12-30'+floor(plan::numeric)::integer);
  elsif plan ~ '^[0-9]{4}[-/]' then yr:=substring(plan,1,4)::integer;
  elsif plan ~ '^[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4}' then yr:=(regexp_match(plan,'^[0-9]{1,2}[/-][0-9]{1,2}[/-]([0-9]{4})'))[1]::integer;
  end if;
  return yr>=2026;
end $$;
revoke all on function private.soc_operational_source_row_v23191(jsonb) from public,anon,authenticated;
grant execute on function private.soc_operational_source_row_v23191(jsonb) to service_role;
CREATE OR REPLACE FUNCTION public.claim_erp_sync_job_v2(p_command_id text, p_actor text, p_force_restart boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare job private.erp_sync_jobs%rowtype; stamp timestamptz := clock_timestamp();
begin
  if p_command_id is null or p_command_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or nullif(btrim(p_actor),'') is null or length(p_actor)>200 then
    raise exception 'ERP_SYNC_COMMAND_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agdata:manual-erp-sync',0));
  select * into job from private.erp_sync_jobs where command_id=p_command_id for update;
  if found then
    if job.requested_by <> btrim(p_actor) then raise exception 'ERP_SYNC_COMMAND_ACTOR_MISMATCH'; end if;
    return job.status || jsonb_build_object('claimed',false);
  end if;
  select * into job from private.erp_sync_jobs where active for update;
  if found then
    if not coalesce(p_force_restart,false) then
      return job.status || jsonb_build_object('claimed',false,'status','busy');
    end if;
    -- A distinct explicit start owns a fresh scan; the old cursor/receipts remain auditable.
    update private.erp_sync_jobs set active=false, worker_id=null, request_lease_until=null,
      finished_at=stamp, updated_at=stamp,
      status=status || jsonb_build_object('active',false,'status','failed','currentStage','idle',
        'finishedAt',stamp,'updatedAt',stamp,'errorCode','ERP_SYNC_SUPERSEDED',
        'error','The abandoned worker was replaced; published data is retained.')
      where run_id=job.run_id;
  end if;
  return public.claim_erp_sync_job_v1(p_command_id,p_actor);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fast_ingest_soc_orders_v1(p_file_meta jsonb, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '60s'
 SET statement_timeout TO '180s'
AS $function$
declare result jsonb; operational_rows jsonb; pruned integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN'; end if;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into operational_rows
  from jsonb_array_elements(p_rows) where private.soc_operational_source_row_v23191(value);
  if jsonb_array_length(operational_rows)=0 then
    raise exception using errcode='22023',message='SOC_OPERATIONAL_SOURCE_EMPTY';
  end if;
  result:=private.fast_finish_live_ingest_v2369('soc',p_file_meta,operational_rows,array[
    'assignedto','date_completed','dock_photo_link','dock_photo_name','dock_spec','dock_caliper','dock_note',
    'spec','caliper','pic_note','av_note','photo_link','photo_name','initial_ptr','loc_match_qty','app_tab_assignment',
    'match','sales_note','suspend_candidate_group','state','order_quantity','origin_uid'],true);
  if coalesce((result->>'ok')::boolean,false) and coalesce(result->>'status','')<>'UP_TO_DATE' then
    perform private.fold_soc_average_orders_v23120(p_file_meta,p_rows);
  end if;
  delete from public.ph_soc_master s where not private.soc_operational_source_row_v23191(to_jsonb(s));
  get diagnostics pruned=row_count;
  return result||jsonb_build_object('excluded_source_rows',jsonb_array_length(p_rows)-jsonb_array_length(operational_rows),'pruned_nonoperational_rows',pruned);
end $function$;
delete from public.ph_soc_master s where not private.soc_operational_source_row_v23191(to_jsonb(s));
CREATE OR REPLACE FUNCTION public.check_erp_file_sync_needed_v1(p_dataset_key text, p_file_id text, p_file_name text, p_modified_at text, p_content_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '200ms'
 SET lock_timeout TO '50ms'
AS $function$
declare
  started_at timestamptz:=clock_timestamp();
  revision_key text:=private.fast_erp_dataset_key_v2369(p_dataset_key);
  modified_at timestamptz;
  content_hash text:=lower(nullif(btrim(coalesce(p_content_hash,'')),''));
  current_revision public.app_dataset_revisions%rowtype;
  up_to_date boolean:=false;
  incoming_parts text[]; active_parts text[]; incoming_order text; active_order text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='FAST_ERP_SYNC_CHECK_FORBIDDEN';
  end if;
  if revision_key is null or nullif(btrim(coalesce(p_file_id,'')),'') is null
     or nullif(btrim(coalesce(p_file_name,'')),'') is null
     or (content_hash is not null and content_hash !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='FAST_ERP_SYNC_CHECK_INVALID';
  end if;
  if btrim(p_file_name) like '~$%' or upper(btrim(p_file_name)) like 'TEMP\_%' escape '\' then
    return jsonb_build_object('up_to_date',true,'skip',true,'ignored',true,
      'file_name',btrim(p_file_name),'dataset_key',revision_key,
      'target_ms',50,
      'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
  end if;
  modified_at:=private.fast_erp_timestamptz_v2369(p_modified_at);
  select * into current_revision from public.app_dataset_revisions
  where key=revision_key and state='ready';
  -- ERP filename clocks precede the date; compare YYYYMMDD + the first HHMMSS.
  incoming_parts:=regexp_match(p_file_name,'([0-9]{6})(20[0-9]{6})([0-9]{6})');
  active_parts:=regexp_match(current_revision.source_file_name,'([0-9]{6})(20[0-9]{6})([0-9]{6})');
  incoming_order:=coalesce(incoming_parts[2]||incoming_parts[3],to_char(modified_at at time zone 'UTC','YYYYMMDDHH24MISS'));
  active_order:=coalesce(active_parts[2]||active_parts[3],to_char(current_revision.source_modified_at at time zone 'UTC','YYYYMMDDHH24MISS'));
  if incoming_order < active_order then
    return jsonb_build_object('up_to_date',true,'skip',true,'ignored',true,'superseded',true,
      'file_name',btrim(p_file_name),'dataset_key',revision_key,'target_ms',50,
      'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
  end if;
  if current_revision.key is not null and current_revision.source_file_id=btrim(p_file_id) then
    up_to_date:=case
      when content_hash is not null and current_revision.source_content_hash is not null
        then current_revision.source_content_hash=content_hash
      when modified_at is not null and current_revision.source_modified_at is not null
        then current_revision.source_modified_at=modified_at
      when modified_at is not null then coalesce(current_revision.source_imported_at,current_revision.changed_at)>=modified_at
      else current_revision.source_file_name=btrim(p_file_name)
    end;
    if up_to_date and (current_revision.source_modified_at is null or
        (content_hash is not null and current_revision.source_content_hash is null)) then
      update public.app_dataset_revisions set
        source_modified_at=coalesce(source_modified_at,modified_at),
        source_content_hash=coalesce(source_content_hash,content_hash)
      where key=revision_key and state='ready' and source_file_id=btrim(p_file_id);
    end if;
  end if;
  return jsonb_build_object('up_to_date',up_to_date,'skip',up_to_date,'ignored',false,
    'file_name',btrim(p_file_name),'dataset_key',revision_key,
    'target_ms',50,
    'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
end
$function$
;
CREATE OR REPLACE FUNCTION private.refresh_soc_order_history_v2366(p_unique_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  affected integer:=0;
  step_count integer;
  history_row record;
begin
  -- The compact-history trigger may merge another existing key; each conflict statement must own one input row.
  for history_row in with history_input(order_line_key,source_unique_id,source_kind,source_file_id,source_file_name,report_date,
    sales_rep_profile_id,sales_rep,customer_name,consignee_name,customer_consignee_label,order_folder_key,
    order_number,tripnumber,dock_num,drop_num,planstart,order_date,checker,inspector,mistake,dock_status,
    item_check_status,issue_status,issue_note,issue_photos,itemcode,commonname,contsize,locationcode,lotcode,
    qty_ordered,unit_list_price,line_dollar_value,photos,photo_url,photo_date,spec,caliper,loc_match_pct,
    loc_photo_match,pick_note,av_note,sales_note,archived_at,updated_at) as (
select
    md5(concat_ws('|','soc',coalesce(nullif(btrim(source.filename),''),source.last_updated::text,'current'),source.unique_id)),
    source.unique_id,'soc',nullif(btrim(source.filename),''),nullif(btrim(source.filename),''),source.last_updated::date::text,
    private.archive_rep_profile_id_v2366(coalesce(nullif(btrim(source.salesrepname),''),mapping.salesrepname)),
    coalesce(nullif(btrim(source.salesrepname),''),nullif(btrim(mapping.salesrepname),''),'Unassigned'),
    coalesce(nullif(btrim(source.customername),''),nullif(btrim(mapping.customername),''),'Unassigned'),
    coalesce(nullif(btrim(source.consigneename),''),nullif(btrim(mapping.consigneename),''),'Unassigned'),
    concat_ws(' | ',coalesce(nullif(btrim(source.customername),''),nullif(btrim(mapping.customername),''),'Unassigned'),
      coalesce(nullif(btrim(source.consigneename),''),nullif(btrim(mapping.consigneename),''),'Unassigned')),
    concat_ws(' • ','Trip '||coalesce(nullif(btrim(source.tripnumber),''),'—'),
      'Dock '||coalesce(nullif(btrim(coalesce(source.dock_num,source.dock)),''),'—'),
      'Drop '||coalesce(nullif(btrim(source.stopnumber),''),'—'),
      'PlanStart '||coalesce(nullif(btrim(source.planstart),''),'—')),
    coalesce(nullif(btrim(source.transactionnumber),''),nullif(btrim(source.purchaseordernumber),'')),
    nullif(btrim(source.tripnumber),''),nullif(btrim(coalesce(source.dock_num,source.dock)),''),
    nullif(btrim(source.stopnumber),''),nullif(btrim(source.planstart),''),
    coalesce(private.archive_timestamptz_v2366(source.requestdate),private.archive_timestamptz_v2366(source.invoicedate),source.last_updated),
    coalesce(nullif(btrim(trip.checker),''),nullif(btrim(team.checker),'')),
    coalesce(nullif(btrim(trip.inspector),''),nullif(btrim(team.inspector),'')),
    coalesce(nullif(btrim(trip.mistake),''),nullif(btrim(team.mistake),'')),
    coalesce(nullif(btrim(trip.status),''),nullif(btrim(team.status),'')),
    case when item.checker_done and item.inspector_done then 'Checked + Inspected'
      when item.checker_done then 'Checked' when item.inspector_done then 'Inspected' else null end,
    issue.issue_state,issue.issue_note,
    private.archive_photo_array_v2366(null,array[issue.issue_photo_link,issue.source_photo_link]),
    coalesce(nullif(btrim(source.itemcode),''),'__SOC_ROW__'),nullif(btrim(source.commonname),''),nullif(btrim(source.contsize),''),
    nullif(btrim(source.locationcode),''),nullif(btrim(source.lotcode),''),
    coalesce(private.archive_numeric_v2366(source.quantityordered),private.archive_numeric_v2366(source.quantityshipped)),
    coalesce(private.archive_numeric_v2366(source.listprice),private.archive_numeric_v2366(source.unitprice),0),
    round(coalesce(private.archive_numeric_v2366(source.quantityordered),private.archive_numeric_v2366(source.quantityshipped),0)
      *coalesce(private.archive_numeric_v2366(source.listprice),private.archive_numeric_v2366(source.unitprice),0),2),
    private.archive_photo_array_v2366(coalesce(master.photos,request.photos,asset.photos),
      array[source.photo_link,source.dock_photo_link,master.photo_url,master.photo_link,request.photo_url,request.req_photo_link]),
    coalesce(nullif(btrim(source.photo_link),''),nullif(btrim(source.dock_photo_link),''),master.photo_url,master.photo_link,request.photo_url,request.req_photo_link),
    coalesce(master.photo_date::text,request.photo_date,source.last_updated::text),
    coalesce(nullif(btrim(source.spec),''),nullif(btrim(source.dock_spec),''),nullif(btrim(master.spec),''),nullif(btrim(request.spec),''),nullif(btrim(request.req_spec),'')),
    coalesce(nullif(btrim(source.caliper),''),nullif(btrim(source.dock_caliper),''),nullif(btrim(master.caliper),''),nullif(btrim(request.caliper),''),nullif(btrim(request.req_caliper),'')),
    coalesce(master.loc_match_pct,request.loc_match_pct),coalesce(master.loc_photo_match,request.loc_photo_match),
    coalesce(nullif(btrim(source.picknote),''),nullif(btrim(master.pick_note),''),nullif(btrim(master.picknote),''),nullif(btrim(request.pick_note),'')),
    coalesce(nullif(btrim(source.av_note),''),nullif(btrim(master.av_note),''),nullif(btrim(request.av_note),'')),
    coalesce(nullif(btrim(source.sales_note),''),nullif(btrim(source.salesnote),''),nullif(btrim(master.sales_note),''),nullif(btrim(master.salesnote),''),nullif(btrim(request.sales_note),'')),
    coalesce(source.last_updated,clock_timestamp()),clock_timestamp()
  from public.ph_soc_master source
  -- v23191: exactly one normalized status witness per physical source line.
  left join lateral (select trip_row.* from public.ph_dock_trip_status trip_row
    where lower(btrim(trip_row.tripnumber))=lower(btrim(source.tripnumber))
      and (nullif(btrim(trip_row.dock_num),'') is null or lower(btrim(trip_row.dock_num))=lower(btrim(coalesce(source.dock_num,source.dock))))
    order by (nullif(btrim(trip_row.dock_num),'') is not null) desc, trip_row.updated_at desc nulls last, trip_row.tripnumber limit 1) trip on true
  left join lateral (select team_row.* from public.ph_dock_team_status team_row
    where lower(btrim(team_row.dock_num))=lower(btrim(coalesce(source.dock_num,source.dock)))
    order by team_row.updated_at desc nulls last, team_row.dock_num limit 1) team on true
  left join public.ph_dock_item_status item on item.unique_id=source.unique_id
  left join lateral (select issue_row.* from public.ph_dock_issue_status issue_row
    where issue_row.source_master_unique_id=source.unique_id or issue_row.issue_source_unique_id=source.unique_id
      or issue_row.source_match_key=source.unique_id order by issue_row.updated_at desc nulls last limit 1) issue on true
  left join lateral (select mapping_row.* from public.ph_customer_consignee_sales_reps mapping_row
    where mapping_row.customeridentityid=source.customeridentityid
      and mapping_row.consigneeid=source.consigneeidentityid order by mapping_row.updated_at desc nulls last limit 1) mapping on true
  left join lateral (select master_row.* from public.ph_master_inventory master_row
    where master_row.itemcode=source.itemcode and master_row.locationcode=source.locationcode
      and coalesce(master_row.lotcode,'')=coalesce(source.lotcode,'') order by master_row.last_updated desc nulls last limit 1) master on true
  left join lateral (select request_row.* from public.ph_requests_completed_history request_row
    where request_row.itemcode=source.itemcode and request_row.locationcode=source.locationcode
      and coalesce(request_row.lotcode,'')=coalesce(source.lotcode,'') order by request_row.updated_at desc nulls last limit 1) request on true
  left join lateral (select jsonb_agg('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||photo.bucket||'/'||photo.path order by photo.photo_at desc) photos
    from (select photo_row.* from public.ph_photo_history_assets photo_row where photo_row.itemcode=source.itemcode
      and (nullif(source.locationcode,'') is null or photo_row.locationcode=source.locationcode)
      order by photo_row.photo_at desc limit 5) photo) asset on true
  where p_unique_id is null or source.unique_id=p_unique_id
  ) select * from history_input loop
    insert into public.ph_orders_history(order_line_key,source_unique_id,source_kind,source_file_id,source_file_name,report_date,
    sales_rep_profile_id,sales_rep,customer_name,consignee_name,customer_consignee_label,order_folder_key,
    order_number,tripnumber,dock_num,drop_num,planstart,order_date,checker,inspector,mistake,dock_status,
    item_check_status,issue_status,issue_note,issue_photos,itemcode,commonname,contsize,locationcode,lotcode,
    qty_ordered,unit_list_price,line_dollar_value,photos,photo_url,photo_date,spec,caliper,loc_match_pct,
    loc_photo_match,pick_note,av_note,sales_note,archived_at,updated_at)
    values (history_row.order_line_key,history_row.source_unique_id,history_row.source_kind,history_row.source_file_id,history_row.source_file_name,history_row.report_date,history_row.sales_rep_profile_id,history_row.sales_rep,history_row.customer_name,history_row.consignee_name,history_row.customer_consignee_label,history_row.order_folder_key,history_row.order_number,history_row.tripnumber,history_row.dock_num,history_row.drop_num,history_row.planstart,history_row.order_date,history_row.checker,history_row.inspector,history_row.mistake,history_row.dock_status,history_row.item_check_status,history_row.issue_status,history_row.issue_note,history_row.issue_photos,history_row.itemcode,history_row.commonname,history_row.contsize,history_row.locationcode,history_row.lotcode,history_row.qty_ordered,history_row.unit_list_price,history_row.line_dollar_value,history_row.photos,history_row.photo_url,history_row.photo_date,history_row.spec,history_row.caliper,history_row.loc_match_pct,history_row.loc_photo_match,history_row.pick_note,history_row.av_note,history_row.sales_note,history_row.archived_at,history_row.updated_at)
  on conflict(order_line_key) do update set
    sales_rep_profile_id=excluded.sales_rep_profile_id,sales_rep=excluded.sales_rep,customer_name=excluded.customer_name,
    consignee_name=excluded.consignee_name,customer_consignee_label=excluded.customer_consignee_label,
    order_folder_key=excluded.order_folder_key,order_number=excluded.order_number,tripnumber=excluded.tripnumber,
    dock_num=excluded.dock_num,drop_num=excluded.drop_num,planstart=excluded.planstart,order_date=excluded.order_date,
    checker=excluded.checker,inspector=excluded.inspector,mistake=excluded.mistake,dock_status=excluded.dock_status,
    item_check_status=excluded.item_check_status,issue_status=excluded.issue_status,issue_note=excluded.issue_note,
    issue_photos=excluded.issue_photos,itemcode=excluded.itemcode,commonname=excluded.commonname,contsize=excluded.contsize,
    locationcode=excluded.locationcode,lotcode=excluded.lotcode,qty_ordered=excluded.qty_ordered,
    unit_list_price=excluded.unit_list_price,line_dollar_value=excluded.line_dollar_value,photos=excluded.photos,
    photo_url=excluded.photo_url,photo_date=excluded.photo_date,spec=excluded.spec,caliper=excluded.caliper,
    loc_match_pct=excluded.loc_match_pct,loc_photo_match=excluded.loc_photo_match,pick_note=excluded.pick_note,
    av_note=excluded.av_note,sales_note=excluded.sales_note,updated_at=clock_timestamp();
    get diagnostics step_count=row_count;
    affected:=affected+step_count;
  end loop;
  return affected;
end
$function$;
commit;
