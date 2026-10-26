begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

alter table public.ph_location_work_lines
  add column if not exists destination_salesyear text,
  add column if not exists work_source text not null default 'manual';

alter table public.ph_location_work_lines
  drop constraint if exists ph_location_work_lines_work_source_v2366;
alter table public.ph_location_work_lines
  add constraint ph_location_work_lines_work_source_v2366
  check(work_source in ('manual','inventory_consolidation')) not valid;

create or replace function private.inventory_consolidation_sales_year_v2366(p_salesyear text,p_lotcode text)
returns integer
language sql
immutable
set search_path=''
as $function$
  with candidate as (
    select coalesce(
      (regexp_match(btrim(coalesce(p_salesyear,'')),'^([0-9]{4}|[0-9]{2})(?:[^0-9]|$)'))[1],
      (regexp_match(btrim(coalesce(p_lotcode,'')),'^([0-9]{2})(?:[^0-9]|$)'))[1]
    ) value
  )
  select case when length(value)=2 then 2000+value::integer
    when length(value)=4 then value::integer else null end from candidate
$function$;

create or replace function private.inventory_consolidation_block_v2366(p_block text,p_location text)
returns text
language sql
immutable
set search_path=''
as $function$
  select upper(coalesce(nullif(btrim(p_block),''),
    nullif((regexp_match(upper(btrim(coalesce(p_location,''))),'^([A-Z]+)'))[1],''),'OTHER'))
$function$;

create or replace function private.inventory_consolidation_distance_v2366(p_source text,p_destination text)
returns integer
language sql
immutable
set search_path=''
as $function$
  with source_parts as (
    select coalesce(((regexp_match(coalesce(p_source,''),'([0-9]+)'))[1])::integer,9999) first_number,
      coalesce(((regexp_match(coalesce(p_source,''),'[0-9]+[^0-9]+([0-9]+)'))[1])::integer,9999) second_number
  ), destination_parts as (
    select coalesce(((regexp_match(coalesce(p_destination,''),'([0-9]+)'))[1])::integer,9999) first_number,
      coalesce(((regexp_match(coalesce(p_destination,''),'[0-9]+[^0-9]+([0-9]+)'))[1])::integer,9999) second_number
  )
  select abs(source_parts.first_number-destination_parts.first_number)*1000+
    abs(source_parts.second_number-destination_parts.second_number)
  from source_parts,destination_parts
$function$;

revoke all on function private.inventory_consolidation_sales_year_v2366(text,text) from public,anon,authenticated,service_role;
revoke all on function private.inventory_consolidation_block_v2366(text,text) from public,anon,authenticated,service_role;
revoke all on function private.inventory_consolidation_distance_v2366(text,text) from public,anon,authenticated,service_role;

create or replace function public.inventory_consolidation_suggestions_v1(p_query jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
set statement_timeout='2s'
as $function$
declare
  actor_id uuid:=auth.uid();
  current_sales_year integer;
  block_filter text:=upper(btrim(coalesce(p_query->>'block','')));
  size_filter text:=upper(btrim(coalesce(p_query->>'containerSize','')));
  rule_filter text:=lower(btrim(coalesce(p_query->>'salesYearRule','')));
  search_filter text:=lower(btrim(coalesce(p_query->>'query','')));
  eligible_sizes constant text[]:=array['#2','#3','#1','2DP','3DP','1GP','8DP','8 IN.','5DP','7DP','QT','2QTD','6QTD','8" P','3GP','1DP'];
  rows_value jsonb:='[]'::jsonb;
  total_value bigint:=0;
begin
  if actor_id is null then raise exception using errcode='42501',message='INVENTORY_CONSOLIDATION_AUTH_REQUIRED'; end if;
  perform sales_private.actor(actor_id);
  if not private.navigation_module_allowed_v1(actor_id,'sales-inventory') then
    raise exception using errcode='42501',message='INVENTORY_CONSOLIDATION_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_query,'{}'::jsonb))<>'object'
     or exists(select 1 from jsonb_object_keys(coalesce(p_query,'{}'::jsonb)) key
       where key not in ('block','containerSize','salesYearRule','query'))
     or length(block_filter)>20 or length(size_filter)>20 or length(search_filter)>100
     or rule_filter not in ('','current','older')
     or (size_filter<>'' and not size_filter=any(eligible_sizes)) then
    raise exception using errcode='22023',message='INVENTORY_CONSOLIDATION_QUERY_INVALID';
  end if;
  current_sales_year:=private.season_sales_year_v1(private.season_sales_settings_v1()->>'salesYear');
  if current_sales_year is null then
    select max(private.inventory_consolidation_sales_year_v2366(row.saleyear,row.lotcode))
    into current_sales_year from public.ph_master_inventory row;
  end if;

  with inventory as materialized (
    select row.unique_id,upper(btrim(row.itemcode)) itemcode,coalesce(nullif(btrim(row.commonname),''),btrim(row.itemcode)) commonname,
      upper(btrim(row.contsize)) contsize,upper(btrim(row.locationcode)) locationcode,btrim(coalesce(row.lotcode,'')) lotcode,
      private.inventory_consolidation_sales_year_v2366(row.saleyear,row.lotcode) sales_year,
      private.inventory_consolidation_block_v2366(row.blockalpha,row.locationcode) block,
      greatest(coalesce(private.location_work_numeric_v1(row.ptronhand),0),0) on_hand,
      greatest(coalesce(private.location_work_numeric_v1(row.ptravailable),0),0) available,
      greatest(coalesce(private.location_work_numeric_v1(row.s_lts),0),0) open_stock
    from public.ph_master_inventory row
    where nullif(btrim(row.itemcode),'') is not null and nullif(btrim(row.locationcode),'') is not null
      and upper(btrim(row.contsize))=any(eligible_sizes)
  ), location_totals as materialized (
    select itemcode,locationcode,sum(on_hand) loc_on_hand,sum(available) available,sum(open_stock) open_stock
    from inventory group by itemcode,locationcode
  ), source_groups as materialized (
    select inventory.itemcode,inventory.locationcode,inventory.sales_year,inventory.block,
      max(inventory.commonname) commonname,max(inventory.contsize) contsize,
      totals.loc_on_hand,totals.available,totals.open_stock,sum(inventory.on_hand) source_year_on_hand,
      string_agg(distinct nullif(inventory.lotcode,''),', ' order by nullif(inventory.lotcode,'')) lotcodes,
      jsonb_agg(jsonb_build_object('uniqueId',inventory.unique_id,'itemcode',inventory.itemcode,
        'commonname',inventory.commonname,'contsize',inventory.contsize,'locationcode',inventory.locationcode,
        'lotcode',inventory.lotcode,'salesYear',inventory.sales_year,'onHand',inventory.on_hand,
        'available',inventory.available,'openStock',inventory.open_stock)
        order by inventory.lotcode,inventory.unique_id) source_rows
    from inventory join location_totals totals using(itemcode,locationcode)
    where inventory.on_hand>0 and inventory.sales_year is not null and inventory.sales_year<=current_sales_year
    group by inventory.itemcode,inventory.locationcode,inventory.sales_year,inventory.block,
      totals.loc_on_hand,totals.available,totals.open_stock
  ), destination_groups as materialized (
    select inventory.itemcode,inventory.locationcode,inventory.sales_year,inventory.block,
      sum(inventory.on_hand) loc_on_hand,
      string_agg(distinct nullif(inventory.lotcode,''),', ' order by nullif(inventory.lotcode,'')) lotcodes
    from inventory where inventory.on_hand>0 and inventory.sales_year is not null
    group by inventory.itemcode,inventory.locationcode,inventory.sales_year,inventory.block
  ), eligible as materialized (
    select source.itemcode||'|'||source.locationcode||'|'||source.sales_year::text suggestion_key,
      source.itemcode,source.commonname,source.contsize,source.locationcode,source.lotcodes,source.sales_year,
      source.block,source.loc_on_hand,source.available,source.open_stock,source.source_year_on_hand,source.source_rows,
      case when source.sales_year=current_sales_year then 'current' else 'older' end sales_year_rule,
      destination.options
    from source_groups source cross join lateral (
      select jsonb_agg(jsonb_build_object('locationcode',candidate.locationcode,'lotcode',candidate.lotcodes,
        'salesYear',candidate.sales_year,'locOnHand',candidate.loc_on_hand,
        'combinedLocOnHand',source.loc_on_hand+candidate.loc_on_hand,'sameSalesYear',candidate.sales_year=source.sales_year,
        'sameBlock',candidate.block=source.block,'distance',private.inventory_consolidation_distance_v2366(source.locationcode,candidate.locationcode))
        order by (candidate.sales_year=source.sales_year) desc,(candidate.block=source.block) desc,
          private.inventory_consolidation_distance_v2366(source.locationcode,candidate.locationcode),
          candidate.loc_on_hand desc,candidate.locationcode,candidate.sales_year) options
      from destination_groups candidate
      where candidate.itemcode=source.itemcode and candidate.locationcode<>source.locationcode
        and (source.sales_year<current_sales_year or candidate.sales_year=source.sales_year)
    ) destination
    where source.loc_on_hand>0 and source.loc_on_hand<100 and jsonb_array_length(coalesce(destination.options,'[]'::jsonb))>0
      and (block_filter='' or source.block=block_filter)
      and (size_filter='' or source.contsize=size_filter)
      and (rule_filter='' or (rule_filter='current' and source.sales_year=current_sales_year)
        or (rule_filter='older' and source.sales_year<current_sales_year))
      and (search_filter='' or lower(source.commonname||' '||source.itemcode||' '||source.locationcode) like '%'||search_filter||'%')
  )
  select (select count(*) from eligible),coalesce((select jsonb_agg(jsonb_build_object(
      'suggestionKey',suggestion_key,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,
      'fromLocationcode',locationcode,'fromLotcode',coalesce(lotcodes,''),'salesYear',sales_year,'block',block,
      'locOnHand',loc_on_hand,'available',available,'openStock',open_stock,'sourceYearOnHand',source_year_on_hand,
      'salesYearRule',sales_year_rule,'sourceRows',source_rows,'destinations',options)
      order by loc_on_hand,lower(commonname),itemcode,locationcode,sales_year)
    from (select * from eligible order by loc_on_hand,lower(commonname),itemcode,locationcode,sales_year limit 1000) page),'[]'::jsonb)
  into total_value,rows_value;

  return jsonb_build_object('currentSalesYear',current_sales_year,'eligibleContainerSizes',to_jsonb(eligible_sizes),
    'total',total_value,'truncated',total_value>1000,'rows',rows_value,'generatedAt',clock_timestamp());
end
$function$;

comment on function public.inventory_consolidation_suggestions_v1(jsonb) is
  'Authenticated, read-only on-demand consolidation suggestions for the 16 approved container sizes and current/older sales-year rules.';
revoke all on function public.inventory_consolidation_suggestions_v1(jsonb) from public,anon,service_role;
grant execute on function public.inventory_consolidation_suggestions_v1(jsonb) to authenticated;

create or replace function public.create_location_work_job_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  actor public.profiles;
  job public.ph_location_work_jobs;
  source_row public.ph_master_inventory;
  recipient_record record;
  line_record record;
  delivery public.ph_request_delivery_outbox;
  lines jsonb:=coalesce(p_payload->'lines','[]'::jsonb);
  recipients jsonb:=coalesce(p_payload->'recipients','[]'::jsonb);
  completion_recipient jsonb:=coalesce(p_payload->'completionRecipient','{}'::jsonb);
  idempotency_value text:=btrim(coalesce(p_payload->>'idempotencyKey',''));
  title_value text:=btrim(coalesce(p_payload->>'title',''));
  instructions_value text:=btrim(coalesce(p_payload->>'generalInstructions',''));
  assigned_usernames text[]:='{}'::text[];
  recipient_emails text[]:='{}'::text[];
  eligible_sizes constant text[]:=array['#2','#3','#1','2DP','3DP','1GP','8DP','8 IN.','5DP','7DP','QT','2QTD','6QTD','8" P','3GP','1DP'];
  current_sales_year integer;
  source_sales_year integer;
  destination_sales_year integer;
  source_location_on_hand numeric;
  action_value text;
  qty_value integer;
  source_on_hand integer;
  destination_value text;
  destination_count integer;
  destination_on_hand numeric;
  consolidation_line boolean;
  line_ordinal integer:=0;
  consolidation_line_count integer:=0;
  event_payload jsonb;
begin
  actor:=private.location_work_active_actor_v1(p_payload->>'actorUsername');
  if actor.username<>'dylan_collyge' then
    raise exception using errcode='42501',message='location_work_create_forbidden';
  end if;
  if length(idempotency_value)<16 or length(idempotency_value)>240
     or length(title_value)<1 or length(title_value)>240
     or length(instructions_value)<1 or length(instructions_value)>8000
     or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines)<1 or jsonb_array_length(lines)>500
     or jsonb_typeof(recipients)<>'array' or jsonb_array_length(recipients)<1 or jsonb_array_length(recipients)>50 then
    raise exception using errcode='22023',message='location_work_payload_invalid';
  end if;
  if lower(btrim(coalesce(completion_recipient->>'username','')))<>'dylan_collyge'
     or lower(btrim(coalesce(completion_recipient->>'email',''))) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode='22023',message='location_work_completion_recipient_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('location-work:'||idempotency_value,0));
  select * into job from public.ph_location_work_jobs where idempotency_key=idempotency_value;
  if job.id is not null then
    if job.created_by_username<>actor.username then
      raise exception using errcode='42501',message='location_work_idempotency_forbidden';
    end if;
    return jsonb_build_object('idempotentReplay',true,'jobId',job.id,'status',job.status,
      'revision',job.revision,'lineCount',job.line_count,'assignmentEventId',job.assignment_event_id);
  end if;
  if exists(select 1 from jsonb_array_elements(lines) value
    group by btrim(value->>'sourceUniqueId') having count(*)>1) then
    raise exception using errcode='22023',message='location_work_duplicate_source';
  end if;

  for recipient_record in select value recipient from jsonb_array_elements(recipients)
  loop
    if not exists(select 1 from public.profiles profile
      where profile.id=nullif(recipient_record.recipient->>'profileId','')::uuid
        and profile.username=lower(btrim(recipient_record.recipient->>'username')) and profile.disabled_at is null
        and (profile.locked_until is null or profile.locked_until<=now()) and not coalesce(profile.must_change_password,false))
      or lower(btrim(coalesce(recipient_record.recipient->>'email',''))) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception using errcode='22023',message='location_work_recipient_invalid';
    end if;
    if lower(btrim(recipient_record.recipient->>'username'))=any(assigned_usernames) then
      raise exception using errcode='22023',message='location_work_recipient_duplicate';
    end if;
    assigned_usernames:=array_append(assigned_usernames,lower(btrim(recipient_record.recipient->>'username')));
    recipient_emails:=array_append(recipient_emails,lower(btrim(recipient_record.recipient->>'email')));
  end loop;

  insert into public.ph_location_work_jobs(idempotency_key,title,general_instructions,assigned_usernames,
    completion_recipient,created_by_profile_id,created_by_username,created_by_display)
  values(idempotency_value,title_value,instructions_value,assigned_usernames,completion_recipient,
    actor.id,actor.username,coalesce(nullif(actor.display_name,''),actor.username)) returning * into job;
  for recipient_record in select value recipient from jsonb_array_elements(recipients)
  loop
    insert into public.ph_location_work_assignments(job_id,profile_id,username,display_name,email)
    values(job.id,(recipient_record.recipient->>'profileId')::uuid,
      lower(btrim(recipient_record.recipient->>'username')),
      left(btrim(coalesce(recipient_record.recipient->>'display',recipient_record.recipient->>'username')),200),
      lower(btrim(recipient_record.recipient->>'email')));
  end loop;

  current_sales_year:=private.season_sales_year_v1(private.season_sales_settings_v1()->>'salesYear');
  if current_sales_year is null then
    select max(private.inventory_consolidation_sales_year_v2366(row.saleyear,row.lotcode))
    into current_sales_year from public.ph_master_inventory row;
  end if;
  for line_record in select value line from jsonb_array_elements(lines)
  loop
    line_ordinal:=line_ordinal+1;
    select * into source_row from public.ph_master_inventory row
      where row.unique_id=btrim(line_record.line->>'sourceUniqueId') for update;
    if source_row.unique_id is null or btrim(coalesce(source_row.itemcode,''))=''
       or btrim(coalesce(source_row.locationcode,''))='' then
      raise exception using errcode='40001',message='location_work_source_refresh_required';
    end if;
    action_value:=lower(btrim(coalesce(line_record.line->>'actionType','')));
    consolidation_line:=coalesce((line_record.line->>'inventoryConsolidation')::boolean,false);
    if action_value not in ('ta','move','grade','save')
       or coalesce(line_record.line->>'plannedQty','') !~ '^[0-9]+$'
       or length(coalesce(line_record.line->>'instructions',''))>4000
       or (consolidation_line and action_value<>'move') then
      raise exception using errcode='22023',message='location_work_line_invalid';
    end if;
    qty_value:=(line_record.line->>'plannedQty')::integer;
    source_on_hand:=floor(greatest(private.location_work_numeric_v1(source_row.ptronhand),0))::integer;
    if qty_value<1 or qty_value>source_on_hand then
      raise exception using errcode='22023',message='location_work_quantity_invalid';
    end if;
    destination_value:=nullif(btrim(coalesce(line_record.line->>'destinationLocationcode','')),'');
    if (action_value='move' and destination_value is null) or (action_value='ta' and destination_value is not null) then
      raise exception using errcode='22023',message='location_work_destination_invalid';
    end if;
    source_sales_year:=private.inventory_consolidation_sales_year_v2366(source_row.saleyear,source_row.lotcode);
    destination_sales_year:=private.inventory_consolidation_sales_year_v2366(line_record.line->>'destinationSalesYear',null);
    if not consolidation_line then destination_sales_year:=source_sales_year; end if;
    if consolidation_line then
      consolidation_line_count:=consolidation_line_count+1;
      if not (upper(btrim(coalesce(source_row.contsize,'')))=any(eligible_sizes))
         or source_sales_year is null or source_sales_year>current_sales_year or destination_sales_year is null then
        raise exception using errcode='40001',message='location_work_source_refresh_required';
      end if;
      select coalesce(sum(greatest(private.location_work_numeric_v1(row.ptronhand),0)),0)
      into source_location_on_hand from public.ph_master_inventory row
      where lower(btrim(row.itemcode))=lower(btrim(source_row.itemcode))
        and lower(btrim(row.locationcode))=lower(btrim(source_row.locationcode));
      if source_location_on_hand<=0 or source_location_on_hand>=100
         or (source_sales_year=current_sales_year and destination_sales_year<>source_sales_year) then
        raise exception using errcode='40001',message='location_work_source_refresh_required';
      end if;
    end if;

    destination_count:=0;
    destination_on_hand:=0;
    if destination_value is not null then
      perform row.unique_id from public.ph_master_inventory row
      where lower(btrim(row.itemcode))=lower(btrim(source_row.itemcode))
        and lower(btrim(row.locationcode))=lower(btrim(destination_value))
        and lower(btrim(row.locationcode))<>lower(btrim(source_row.locationcode))
        and ((not consolidation_line and lower(btrim(row.saleyear))=lower(btrim(source_row.saleyear)))
          or (consolidation_line and private.inventory_consolidation_sales_year_v2366(row.saleyear,row.lotcode)=destination_sales_year))
      order by row.unique_id for update;
      select count(*),coalesce(sum(greatest(private.location_work_numeric_v1(row.ptronhand),0)),0)
      into destination_count,destination_on_hand from public.ph_master_inventory row
      where lower(btrim(row.itemcode))=lower(btrim(source_row.itemcode))
        and lower(btrim(row.locationcode))=lower(btrim(destination_value))
        and lower(btrim(row.locationcode))<>lower(btrim(source_row.locationcode))
        and ((not consolidation_line and lower(btrim(row.saleyear))=lower(btrim(source_row.saleyear)))
          or (consolidation_line and private.inventory_consolidation_sales_year_v2366(row.saleyear,row.lotcode)=destination_sales_year));
      if destination_count<1 or destination_on_hand<=0 then
        raise exception using errcode='40001',message='location_work_destination_refresh_required';
      end if;
    end if;

    insert into public.ph_location_work_lines(job_id,source_unique_id,itemcode,commonname,contsize,salesyear,
      source_locationcode,snapshotted_on_hand,action_type,planned_qty,destination_locationcode,
      destination_salesyear,destination_matching_rows,destination_on_hand,instructions,ordinal,work_source)
    values(job.id,source_row.unique_id,source_row.itemcode,coalesce(source_row.commonname,''),coalesce(source_row.contsize,''),
      source_row.saleyear,source_row.locationcode,source_on_hand,action_value,qty_value,destination_value,
      destination_sales_year::text,destination_count,destination_on_hand,
      btrim(coalesce(line_record.line->>'instructions','')),line_ordinal,
      case when consolidation_line then 'inventory_consolidation' else 'manual' end);
  end loop;

  update public.ph_location_work_jobs set line_count=line_ordinal,updated_at=now()
  where id=job.id returning * into job;
  event_payload:=private.location_work_event_payload_v1(job.id,'assignment',recipient_emails);
  insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,status,next_attempt_at)
  values('location-work:'||job.id::text||':assignment:r'||job.revision::text,'location_work_assignment',
    job.id::text,job.title,event_payload,'pending',now()) returning * into delivery;
  insert into public.ph_location_work_delivery_events(job_id,delivery_kind,job_revision,outbox_event_id)
  values(job.id,'assignment',job.revision,delivery.event_id);
  update public.ph_location_work_jobs set assignment_event_id=delivery.event_id,updated_at=now()
  where id=job.id returning * into job;
  insert into public.ph_location_work_audit(job_id,event_type,actor_username,job_revision,metadata)
  values(job.id,'created',actor.username,job.revision,jsonb_build_object('lineCount',job.line_count,
    'assigneeCount',cardinality(job.assigned_usernames),'inventoryConsolidationLines',consolidation_line_count));
  return jsonb_build_object('idempotentReplay',false,'jobId',job.id,'status',job.status,
    'revision',job.revision,'lineCount',job.line_count,'assignmentEventId',job.assignment_event_id);
end
$function$;

comment on function public.create_location_work_job_v1(jsonb) is
  'Dylan-only idempotent Location Work creation with server-validated manual Inventory Consolidation sales-year rules.';
revoke all on function public.create_location_work_job_v1(jsonb) from public,anon,authenticated;
grant execute on function public.create_location_work_job_v1(jsonb) to service_role;

commit;
