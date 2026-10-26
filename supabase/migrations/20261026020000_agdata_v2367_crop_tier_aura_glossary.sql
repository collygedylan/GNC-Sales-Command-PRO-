begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

alter table private.inventory_consolidation_cache_v2366
  add column if not exists crop_tier text;

update private.inventory_consolidation_cache_v2366
set crop_tier=case sales_year_rule when 'current' then 'CURRENT_CROP' else 'CARRY_OVER' end
where crop_tier is null;

alter table private.inventory_consolidation_cache_v2366
  alter column crop_tier set not null,
  drop constraint if exists inventory_consolidation_cache_v2366_sales_year_rule_check,
  drop constraint if exists inventory_consolidation_cache_crop_tier_v2367;
alter table private.inventory_consolidation_cache_v2366
  add constraint inventory_consolidation_cache_v2366_sales_year_rule_check
    check(sales_year_rule in ('older','current','future')) not valid,
  add constraint inventory_consolidation_cache_crop_tier_v2367
    check(crop_tier in ('CARRY_OVER','CURRENT_CROP','FUTURE_CROP')) not valid;

create or replace function public.get_consolidation_move_candidates_v1()
returns table(
  current_sales_year integer,
  source_itemcode text,
  source_commonname text,
  source_contsize text,
  source_locationcode text,
  source_lotcodes text,
  source_sales_year integer,
  source_block text,
  source_loc_on_hand numeric,
  source_available numeric,
  source_open_stock numeric,
  source_year_on_hand numeric,
  source_rows jsonb,
  crop_tier text,
  destination_locationcode text,
  destination_lotcodes text,
  destination_sales_year integer,
  destination_block text,
  destination_loc_on_hand numeric,
  same_sales_year boolean,
  same_block boolean,
  destination_distance integer
)
language sql
stable
security definer
set search_path=''
set statement_timeout='5s'
as $function$
  with settings as (
    select private.inventory_consolidation_sales_year_v2366(
      private.season_sales_settings_v1()->>'salesYear',null) current_sales_year
  ), inventory as materialized (
    select row.unique_id,upper(btrim(row.itemcode)) itemcode,
      coalesce(nullif(btrim(row.commonname),''),btrim(row.itemcode)) commonname,
      upper(btrim(row.contsize)) contsize,upper(btrim(row.locationcode)) locationcode,
      btrim(coalesce(row.lotcode,'')) lotcode,
      private.inventory_consolidation_sales_year_v2366(row.saleyear,row.lotcode) sales_year,
      private.inventory_consolidation_block_v2366(row.blockalpha,row.locationcode) block,
      greatest(coalesce(private.location_work_numeric_v1(row.ptronhand),0),0) on_hand,
      greatest(coalesce(private.location_work_numeric_v1(row.ptravailable),0),0) available,
      greatest(coalesce(private.location_work_numeric_v1(row.s_lts),0),0) open_stock
    from public.ph_master_inventory row
    where nullif(btrim(row.itemcode),'') is not null
      and nullif(btrim(row.locationcode),'') is not null
      and upper(btrim(row.contsize))=any(array['#2','#3','#1','2DP','3DP','1GP','8DP','8 IN.','5DP','7DP','QT','2QTD','6QTD','8" P','3GP','1DP'])
  ), location_profiles as materialized (
    select inventory.itemcode,inventory.locationcode,sum(inventory.on_hand) loc_on_hand,
      sum(inventory.available) available,sum(inventory.open_stock) open_stock,
      min(inventory.sales_year) filter(where inventory.on_hand>0 and inventory.sales_year is not null) min_sales_year,
      max(inventory.sales_year) filter(where inventory.on_hand>0 and inventory.sales_year is not null) max_sales_year,
      count(*) filter(where inventory.on_hand>0 and inventory.sales_year is null) unresolved_year_rows
    from inventory
    group by inventory.itemcode,inventory.locationcode
  ), year_groups as materialized (
    select inventory.itemcode,inventory.locationcode,inventory.sales_year,max(inventory.block) block,
      max(inventory.commonname) commonname,max(inventory.contsize) contsize,
      profile.loc_on_hand,profile.available,profile.open_stock,sum(inventory.on_hand) year_on_hand,
      string_agg(distinct nullif(inventory.lotcode,''),', ' order by nullif(inventory.lotcode,'')) lotcodes,
      jsonb_agg(jsonb_build_object('uniqueId',inventory.unique_id,'itemcode',inventory.itemcode,
        'commonname',inventory.commonname,'contsize',inventory.contsize,'locationcode',inventory.locationcode,
        'lotcode',inventory.lotcode,'salesYear',inventory.sales_year,'onHand',inventory.on_hand,
        'available',inventory.available,'openStock',inventory.open_stock)
        order by inventory.lotcode,inventory.unique_id) source_rows
    from inventory
    join location_profiles profile using(itemcode,locationcode)
    where inventory.on_hand>0 and inventory.sales_year is not null
    group by inventory.itemcode,inventory.locationcode,inventory.sales_year,
      profile.loc_on_hand,profile.available,profile.open_stock
  )
  select settings.current_sales_year,source.itemcode,source.commonname,source.contsize,
    source.locationcode,coalesce(source.lotcodes,''),source.sales_year,source.block,
    source.loc_on_hand,source.available,source.open_stock,source.year_on_hand,source.source_rows,
    case when source.sales_year<settings.current_sales_year then 'CARRY_OVER'
      when source.sales_year=settings.current_sales_year then 'CURRENT_CROP'
      else 'FUTURE_CROP' end crop_tier,
    candidate.locationcode,coalesce(candidate.lotcodes,''),candidate.sales_year,candidate.block,
    destination_profile.loc_on_hand,candidate.sales_year=source.sales_year,candidate.block=source.block,
    private.inventory_consolidation_distance_v2366(source.locationcode,candidate.locationcode)
  from settings
  join year_groups source on source.loc_on_hand>0 and source.loc_on_hand<100
  join location_profiles source_profile on source_profile.itemcode=source.itemcode
    and source_profile.locationcode=source.locationcode
  join year_groups candidate on candidate.itemcode=source.itemcode
    and candidate.locationcode<>source.locationcode
  join location_profiles destination_profile on destination_profile.itemcode=candidate.itemcode
    and destination_profile.locationcode=candidate.locationcode
  where source_profile.unresolved_year_rows=0
    and destination_profile.unresolved_year_rows=0
    and (
      (source.sales_year<settings.current_sales_year
        and source_profile.max_sales_year<settings.current_sales_year
        and candidate.sales_year<settings.current_sales_year
        and destination_profile.max_sales_year<settings.current_sales_year)
      or (source.sales_year=settings.current_sales_year
        and source_profile.min_sales_year=settings.current_sales_year
        and source_profile.max_sales_year=settings.current_sales_year
        and candidate.sales_year=settings.current_sales_year
        and destination_profile.min_sales_year=settings.current_sales_year
        and destination_profile.max_sales_year=settings.current_sales_year)
      or (source.sales_year>settings.current_sales_year
        and source_profile.min_sales_year=source.sales_year
        and source_profile.max_sales_year=source.sales_year
        and candidate.sales_year=source.sales_year
        and destination_profile.min_sales_year=source.sales_year
        and destination_profile.max_sales_year=source.sales_year)
    )
$function$;

comment on function public.get_consolidation_move_candidates_v1() is
  'Internal strict crop-tier candidate relation: Carry Over stays below current year, Current Crop stays pure-current, and Future Crop stays exact-year.';
revoke all on function public.get_consolidation_move_candidates_v1() from public,anon,authenticated,service_role;

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
         or source_sales_year is null or destination_sales_year is null then
        raise exception using errcode='40001',message='location_work_source_refresh_required';
      end if;
      perform row.unique_id from public.ph_master_inventory row
      where lower(btrim(row.itemcode))=lower(btrim(source_row.itemcode))
        and lower(btrim(row.locationcode)) in (lower(btrim(source_row.locationcode)),lower(btrim(destination_value)))
      order by row.unique_id for update;
      select coalesce(sum(greatest(private.location_work_numeric_v1(row.ptronhand),0)),0)
      into source_location_on_hand from public.ph_master_inventory row
      where lower(btrim(row.itemcode))=lower(btrim(source_row.itemcode))
        and lower(btrim(row.locationcode))=lower(btrim(source_row.locationcode));
      if source_location_on_hand<=0 or source_location_on_hand>=100
         or destination_value is null
         or not exists(select 1 from public.get_consolidation_move_candidates_v1() candidate
           where candidate.source_itemcode=upper(btrim(source_row.itemcode))
             and candidate.source_locationcode=upper(btrim(source_row.locationcode))
             and candidate.source_sales_year=source_sales_year
             and candidate.destination_locationcode=upper(btrim(destination_value))
             and candidate.destination_sales_year=destination_sales_year) then
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
  'Dylan-only idempotent Location Work creation with strict server-validated Inventory Consolidation crop tiers.';
revoke all on function public.create_location_work_job_v1(jsonb) from public,anon,authenticated;
grant execute on function public.create_location_work_job_v1(jsonb) to service_role;

create or replace function private.refresh_inventory_consolidation_cache_v2366()
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='5s'
as $function$
declare
  active_sales_year integer;
  refreshed_at_value timestamptz:=clock_timestamp();
  refreshed_rows integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('inventory-consolidation-cache-v2366',0)) then
    return jsonb_build_object('status','refresh_in_progress');
  end if;

  create temporary table inventory_consolidation_refresh_v2367 on commit drop as
  with candidates as materialized (
    select * from public.get_consolidation_move_candidates_v1()
  )
  select source_itemcode||'|'||source_locationcode||'|'||source_sales_year::text suggestion_key,
    current_sales_year,source_itemcode itemcode,source_commonname commonname,source_contsize contsize,
    source_locationcode,source_lotcodes,source_sales_year,source_block,source_loc_on_hand loc_on_hand,
    source_available available,source_open_stock open_stock,source_year_on_hand,
    case crop_tier when 'CARRY_OVER' then 'older' when 'CURRENT_CROP' then 'current' else 'future' end sales_year_rule,
    crop_tier,source_rows,
    jsonb_agg(jsonb_build_object('locationcode',destination_locationcode,'lotcode',destination_lotcodes,
      'salesYear',destination_sales_year,'locOnHand',destination_loc_on_hand,
      'combinedLocOnHand',source_loc_on_hand+destination_loc_on_hand,'sameSalesYear',same_sales_year,
      'sameBlock',same_block,'distance',destination_distance,'cropTier',crop_tier,
      'cropTierLabel',replace(crop_tier,'_',' '))
      order by same_sales_year desc,same_block desc,destination_loc_on_hand desc,
        destination_distance,destination_locationcode,destination_sales_year) destinations,
    lower(source_commonname||' '||source_itemcode||' '||source_locationcode||' '||replace(crop_tier,'_',' ')) search_text,
    refreshed_at_value refreshed_at
  from candidates
  group by current_sales_year,source_itemcode,source_commonname,source_contsize,source_locationcode,
    source_lotcodes,source_sales_year,source_block,source_loc_on_hand,source_available,source_open_stock,
    source_year_on_hand,crop_tier,source_rows;

  select max(current_sales_year) into active_sales_year from pg_temp.inventory_consolidation_refresh_v2367;
  if active_sales_year is null then
    active_sales_year:=private.inventory_consolidation_sales_year_v2366(
      private.season_sales_settings_v1()->>'salesYear',null);
  end if;

  insert into private.inventory_consolidation_cache_v2366 as target(
    suggestion_key,current_sales_year,itemcode,commonname,contsize,source_locationcode,source_lotcodes,
    source_sales_year,source_block,loc_on_hand,available,open_stock,source_year_on_hand,sales_year_rule,
    crop_tier,source_rows,destinations,search_text,refreshed_at)
  select suggestion_key,current_sales_year,itemcode,commonname,contsize,source_locationcode,source_lotcodes,
    source_sales_year,source_block,loc_on_hand,available,open_stock,source_year_on_hand,sales_year_rule,
    crop_tier,source_rows,destinations,search_text,refreshed_at
  from pg_temp.inventory_consolidation_refresh_v2367
  on conflict(suggestion_key) do update set
    current_sales_year=excluded.current_sales_year,itemcode=excluded.itemcode,commonname=excluded.commonname,
    contsize=excluded.contsize,source_locationcode=excluded.source_locationcode,
    source_lotcodes=excluded.source_lotcodes,source_sales_year=excluded.source_sales_year,
    source_block=excluded.source_block,loc_on_hand=excluded.loc_on_hand,available=excluded.available,
    open_stock=excluded.open_stock,source_year_on_hand=excluded.source_year_on_hand,
    sales_year_rule=excluded.sales_year_rule,crop_tier=excluded.crop_tier,source_rows=excluded.source_rows,
    destinations=excluded.destinations,search_text=excluded.search_text,refreshed_at=excluded.refreshed_at;

  delete from private.inventory_consolidation_cache_v2366 cache
  where not exists(select 1 from pg_temp.inventory_consolidation_refresh_v2367 fresh
    where fresh.suggestion_key=cache.suggestion_key);
  select count(*) into refreshed_rows from pg_temp.inventory_consolidation_refresh_v2367;
  return jsonb_build_object('status','complete','currentSalesYear',active_sales_year,
    'rows',refreshed_rows,'refreshedAt',refreshed_at_value);
end
$function$;

revoke all on function private.refresh_inventory_consolidation_cache_v2366() from public,anon,authenticated,service_role;

select private.refresh_inventory_consolidation_cache_v2366();

create or replace function public.inventory_consolidation_suggestions_v1(p_query jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
set statement_timeout='500ms'
as $function$
declare
  actor_id uuid:=auth.uid();
  configured_sales_year integer;
  active_sales_year integer;
  block_filter text:=upper(btrim(coalesce(p_query->>'block','')));
  size_filter text:=upper(btrim(coalesce(p_query->>'containerSize','')));
  tier_filter text:=upper(btrim(coalesce(p_query->>'cropTier','')));
  rule_filter text:=lower(btrim(coalesce(p_query->>'salesYearRule','')));
  search_filter text:=lower(btrim(coalesce(p_query->>'query','')));
  eligible_sizes constant text[]:=array['#2','#3','#1','2DP','3DP','1GP','8DP','8 IN.','5DP','7DP','QT','2QTD','6QTD','8" P','3GP','1DP'];
  rows_value jsonb:='[]'::jsonb;
  total_value bigint:=0;
  generated_at_value timestamptz;
begin
  if actor_id is null then raise exception using errcode='42501',message='INVENTORY_CONSOLIDATION_AUTH_REQUIRED'; end if;
  perform sales_private.actor(actor_id);
  if not private.navigation_module_allowed_v1(actor_id,'sales-inventory') then
    raise exception using errcode='42501',message='INVENTORY_CONSOLIDATION_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_query,'{}'::jsonb))<>'object'
     or exists(select 1 from jsonb_object_keys(coalesce(p_query,'{}'::jsonb)) key
       where key not in ('block','containerSize','cropTier','salesYearRule','query'))
     or length(block_filter)>20 or length(size_filter)>20 or length(search_filter)>100
     or tier_filter not in ('','CARRY_OVER','CURRENT_CROP','FUTURE_CROP')
     or rule_filter not in ('','older','current','future')
     or (size_filter<>'' and not size_filter=any(eligible_sizes)) then
    raise exception using errcode='22023',message='INVENTORY_CONSOLIDATION_QUERY_INVALID';
  end if;
  configured_sales_year:=private.inventory_consolidation_sales_year_v2366(
    private.season_sales_settings_v1()->>'salesYear',null);
  select coalesce(max(cache.current_sales_year),configured_sales_year),max(cache.refreshed_at)
  into active_sales_year,generated_at_value from private.inventory_consolidation_cache_v2366 cache;

  with filtered as materialized (
    select cache.* from private.inventory_consolidation_cache_v2366 cache
    where cache.current_sales_year=active_sales_year
      and (block_filter='' or cache.source_block=block_filter)
      and (size_filter='' or cache.contsize=size_filter)
      and (tier_filter='' or cache.crop_tier=tier_filter)
      and (rule_filter='' or cache.sales_year_rule=rule_filter)
      and (search_filter='' or cache.search_text like '%'||search_filter||'%')
  )
  select (select count(*) from filtered),coalesce((select jsonb_agg(jsonb_build_object(
      'suggestionKey',suggestion_key,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,
      'fromLocationcode',source_locationcode,'fromLotcode',source_lotcodes,'salesYear',source_sales_year,
      'block',source_block,'locOnHand',loc_on_hand,'available',available,'openStock',open_stock,
      'sourceYearOnHand',source_year_on_hand,'salesYearRule',sales_year_rule,'cropTier',crop_tier,
      'cropTierLabel',replace(crop_tier,'_',' '),'sourceRows',source_rows,'destinations',destinations)
      order by loc_on_hand,lower(commonname),itemcode,source_locationcode,source_sales_year)
    from (select * from filtered order by loc_on_hand,lower(commonname),itemcode,source_locationcode,source_sales_year limit 1000) page),'[]'::jsonb)
  into total_value,rows_value;
  return jsonb_build_object('currentSalesYear',active_sales_year,'eligibleContainerSizes',to_jsonb(eligible_sizes),
    'cropTiers',jsonb_build_array('CARRY_OVER','CURRENT_CROP','FUTURE_CROP'),
    'total',total_value,'truncated',total_value>1000,'rows',rows_value,'generatedAt',generated_at_value);
end
$function$;

comment on function public.inventory_consolidation_suggestions_v1(jsonb) is
  'Authenticated cached Inventory Consolidation suggestions with strict Carry Over, Current Crop, and exact-year Future Crop destinations.';
revoke all on function public.inventory_consolidation_suggestions_v1(jsonb) from public,anon,service_role;
grant execute on function public.inventory_consolidation_suggestions_v1(jsonb) to authenticated;

alter table public.aura_domain_glossary
  add column if not exists definition text,
  add column if not exists synonyms text[] not null default '{}'::text[];

alter table public.aura_domain_glossary
  drop constraint if exists aura_domain_glossary_canonical_entity_check,
  drop constraint if exists aura_glossary_filter_check,
  drop constraint if exists aura_glossary_definition_v2367,
  drop constraint if exists aura_glossary_synonyms_v2367;
alter table public.aura_domain_glossary
  add constraint aura_domain_glossary_canonical_entity_check check(canonical_entity in (
    'container_size','growth_stage','metric_type','crop_tier','app_feature','inventory_metric','analytics','history','queue_work')) not valid,
  add constraint aura_glossary_filter_check check(coalesce(
    (canonical_entity='container_size' and jsonb_typeof(target_filter->'size')='string' and target_filter->>'size' ~ '^[A-Za-z0-9#& .-]{1,40}$')
    or (canonical_entity='metric_type' and target_filter->>'metric' in ('open_stock','loc_on_hand','allocated','held'))
    or (canonical_entity='crop_tier' and target_filter->>'cropTier' in ('CARRY_OVER','CURRENT_CROP','FUTURE_CROP'))
    or (canonical_entity in ('app_feature','inventory_metric','analytics','history','queue_work') and jsonb_typeof(target_filter->'view')='string')
    or canonical_entity='growth_stage',false)) not valid,
  add constraint aura_glossary_definition_v2367 check(definition is null or length(definition)<=4000) not valid,
  add constraint aura_glossary_synonyms_v2367 check(cardinality(synonyms)<=20) not valid;

insert into public.aura_domain_glossary(term,canonical_entity,target_filter,notes,definition,synonyms) values
  ('carry over','crop_tier','{"cropTier":"CARRY_OVER","view":"inv-consolidation"}',
    'Inventory below the current sales year; consolidation stays in pure Carry Over destinations.',
    'Inventory where SalesYear is less than the current SalesYear. In Inv Consolidation it can move only to another Carry Over location for the same ItemCode, never into Current Crop or Future Crop.',
    array['carryover','carry-over','older sales year']),
  ('current crop','crop_tier','{"cropTier":"CURRENT_CROP","view":"inv-consolidation"}',
    'Inventory in the current sales year; consolidation stays in pure Current Crop destinations.',
    'Inventory where SalesYear equals the current SalesYear. It can consolidate only with other pure Current Crop locations for the same ItemCode.',
    array['current sales year','sy 2027','27 crop','this sales year','active sales year']),
  ('future crop','crop_tier','{"cropTier":"FUTURE_CROP","view":"inv-consolidation"}',
    'Inventory above the current sales year; consolidation requires the exact same future year.',
    'Inventory where SalesYear is greater than the current SalesYear. It can consolidate only into a destination with the exact same Future Crop SalesYear.',
    array['future sales year','sy 2028','later sales year','next year crop']),
  ('inv consolidation','app_feature','{"view":"inv-consolidation","action":"inventory_consolidation","maxLocOnHandExclusive":100}',
    'Manual Inventory Suggestion view for eligible locations below 100 Loc On Hand.',
    'Home to Inventory to Inventory Suggestion to Inv Consolidation shows eligible locations with Loc On Hand below 100 across the sixteen supported container sizes, separated by Carry Over, Current Crop, and Future Crop.',
    array['inventory consolidation','inventory suggestion','consolidate locations','under 100 loc on hand']),
  ('loc photo match','inventory_metric','{"view":"drive","metric":"loc_photo_match"}',
    'Photo-matched location quantity with the ten-day expiration rule.',
    'The rounded quantity On Hand times Loc Match percent, depleted unit-for-unit as On Hand ships and cleared from Drive Mode and AV at 11:59 PM on Day 10 or when it reaches zero while remaining forever in ph_request_history and ph_drive_mode_history.',
    array['photo match','photo match qty','10 day photo rule']),
  ('request sales impact','analytics','{"view":"request-sales-impact","report":"request_sales_impact"}',
    'Current-price request valuation by Sales Rep and Customer to Consignee.',
    'Executive analytics where every unique Sales Rep request line is valued as request quantity, defaulting to 25 when absent or zero, times unit list price.',
    array['request dollar value','sales impact','default 25 qty']),
  ('mistake guy','history','{"view":"historical-requests","archiveTab":"orders"}',
    'Dock checker, inspector, and mistake accountability in Historical SOC Open Orders.',
    'Dock accountability fields Checker, Inspector, and Mistake recorded by Trip, Dock, Drop, and PlanStart and permanently searchable in Historical SOC Open Orders.',
    array['dock mistake','checker','inspector','dock accountability']),
  ('historical orders','history','{"view":"historical-requests","archiveTab":"orders"}',
    'Permanent Historical SOC Open Orders archive.',
    'The Historical SOC Open Orders tab organized by Customer, Consignee, Trip, Dock, Drop, and PlanStart with accountability, order rows, and row photos.',
    array['historical soc open orders','past orders','ph_orders_history']),
  ('historical reserves','history','{"view":"historical-requests","archiveTab":"reserves"}',
    'Permanent Historical SOC Reserves archive.',
    'The Historical SOC Reserves tab organized by Sales Rep, Customer, and Consignee.',
    array['historical soc reserves','past reserves','ph_reserves_history']),
  ('historical drive around','history','{"view":"historical-requests","archiveTab":"drive"}',
    'Permanent Drive Around and expired evaluation archive.',
    'The Historical Drive Around tab containing past DriveAround snapshots and expired evaluations deduplicated across daily imports by row state hash.',
    array['historical drive mode','past drive around','ph_drive_mode_history']),
  ('location moves','queue_work','{"view":"moves","queueTab":"location-moves"}',
    'Physical plant movement queue, separate from Sales Rep requests.',
    'Operational Queue work for physical moves from one nursery location to another with Picked Up Qty and TA, separate from Sales Rep plant requests.',
    array['que location moves','ph_active_location_moves','ph_location_moves_history']),
  ('suspend tag','queue_work','{"view":"request","queueCategory":"suspend-tag"}',
    'Suspended SOC order tags sorted by nursery location.',
    'Que SUSPEND contains suspended SOC order tags and keeps one physical spreadsheet row per card sorted by location code.',
    array['que suspend','ph_active_suspend','ph_suspend_history']),
  ('recount','queue_work','{"view":"request","queueCategory":"recount"}',
    'Physical inventory recount queue.',
    'Que RECOUNT contains physical location recounts deduplicated to one card per ItemCode and LocationCode.',
    array['que recount','item inquiry recount','ph_active_recount','ph_recount_history']),
  ('bunch notes','queue_work','{"view":"request","queueCategory":"bunch-notes"}',
    'Overwintering and field bunching instruction queue.',
    'Que BUNCH NOTES contains overwintering and field bunching instructions.',
    array['que bunch notes','overwintering bunch notes','ph_active_bunch_notes','ph_bunch_notes_history']),
  ('eval work','queue_work','{"view":"tasks","taskView":"eval-work"}',
    'Operational plant evaluation work queue.',
    'Que Eval Work contains assigned plant evaluation work and retains its active and historical task records.',
    array['evaluation work','ph_active_eval_work','ph_eval_work_history']),
  ('shear list','queue_work','{"view":"shear-list","taskView":"shear-list"}',
    'Operational plant shearing work queue.',
    'Que Shear List contains assigned plant shearing work and retains its active and historical task records.',
    array['shearing work','ph_active_shear_list','ph_shear_list_history'])
on conflict(term) do update set canonical_entity=excluded.canonical_entity,target_filter=excluded.target_filter,
  notes=excluded.notes,definition=excluded.definition,synonyms=excluded.synonyms;

create or replace view public.ph_aura_domain_glossary with (security_invoker=true) as
select id,term,canonical_entity,target_filter,notes,definition,synonyms
from public.aura_domain_glossary;

create or replace function public.aura_domain_context_v1()
returns jsonb
language plpgsql
stable
security invoker
set search_path=pg_catalog,public
set statement_timeout='5s'
as $function$
declare glossary jsonb;
begin
  perform public.aura_voice_access_v1();
  select coalesce(jsonb_agg(jsonb_build_object('term',term,'canonical_entity',canonical_entity,
    'target_filter',target_filter,'definition',definition,'synonyms',to_jsonb(synonyms)) order by term),'[]'::jsonb)
  into glossary from public.aura_domain_glossary;
  return jsonb_build_object('glossary',glossary,'revision',md5(glossary::text));
end
$function$;
revoke all on function public.aura_domain_context_v1() from public,anon,service_role;
grant execute on function public.aura_domain_context_v1() to authenticated;

create or replace function public.aura_inventory_crop_tier_v1(
  p_crop_tier text,
  p_query text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
set statement_timeout='500ms'
as $function$
declare
  tier text:=upper(btrim(coalesce(p_crop_tier,'')));
  search_value text:=lower(btrim(coalesce(p_query,'')));
  current_year integer;
  settings jsonb;
  rows_value jsonb:='[]'::jsonb;
  total_value bigint:=0;
begin
  if coalesce(auth.role(),'')='authenticated' then
    perform public.aura_voice_access_v1();
  elsif coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='AURA_FORBIDDEN';
  end if;
  if tier not in ('CARRY_OVER','CURRENT_CROP','FUTURE_CROP')
     or p_limit<1 or p_limit>50 or length(search_value)>160 then
    raise exception using errcode='22023',message='AURA_CROP_TIER_INVALID';
  end if;
  settings:=private.season_sales_settings_v1();
  current_year:=private.inventory_consolidation_sales_year_v2366(settings->>'salesYear',null);
  if current_year is null then raise exception using errcode='55000',message='AURA_SEASON_SETTINGS_UNAVAILABLE'; end if;

  with inventory as materialized (
    select row.unique_id,row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
      private.inventory_consolidation_sales_year_v2366(row.saleyear,row.lotcode) sales_year,
      greatest(coalesce(private.location_work_numeric_v1(row.ptronhand),0),0) on_hand,
      greatest(coalesce(private.location_work_numeric_v1(row.ptravailable),0),0) available,
      greatest(coalesce(private.location_work_numeric_v1(row.s_lts),0),0) open_stock
    from public.ph_master_inventory row
    where greatest(coalesce(private.location_work_numeric_v1(row.ptronhand),0),0)>0
      and (search_value='' or position(search_value in lower(coalesce(row.commonname,'')||' '||coalesce(row.itemcode,'')||' '||coalesce(row.locationcode,'')))>0)
  ), filtered as materialized (
    select inventory.* from inventory
    where inventory.sales_year is not null and case tier
      when 'CARRY_OVER' then inventory.sales_year<current_year
      when 'CURRENT_CROP' then inventory.sales_year=current_year
      else inventory.sales_year>current_year end
  ), page as (
    select * from filtered order by lower(commonname),itemcode,locationcode,lotcode,unique_id limit p_limit
  )
  select (select count(*) from filtered),coalesce((select jsonb_agg(jsonb_build_object(
    'unique_id',unique_id,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,
    'locationcode',locationcode,'lotcode',lotcode,'ptronhand',on_hand,'ptravailable',available,
    's_lts',open_stock,'salesYear',sales_year,'cropTier',tier,'cropTierLabel',replace(tier,'_',' '))
    order by lower(commonname),itemcode,locationcode,lotcode,unique_id) from page),'[]'::jsonb)
  into total_value,rows_value;

  return jsonb_build_object('ok',true,'complete',true,'rows',rows_value,'total',total_value,
    'hasMore',total_value>p_limit,'nextCursor',null,'candidateChoices','[]'::jsonb,'unresolvedCount',0,
    'cropTier',tier,'currentSalesYear',current_year,'salesYear',current_year,
    'season',upper(coalesce(settings->>'seasonCode',settings->>'season','')),
    'settingRevision',case when coalesce(settings->>'revision','') ~ '^[0-9]+$' then (settings->>'revision')::integer else 0 end,
    'datasetRevision',md5(current_year::text||':'||tier||':'||total_value::text),'metric','crop_tier');
end
$function$;

comment on function public.aura_inventory_crop_tier_v1(text,text,integer) is
  'Bounded AURA inventory reader for Carry Over, Current Crop, and Future Crop using the live current sales year.';
revoke all on function public.aura_inventory_crop_tier_v1(text,text,integer) from public,anon;
grant execute on function public.aura_inventory_crop_tier_v1(text,text,integer) to authenticated,service_role;

create or replace function private.historical_drive_file_page_v2367(
  p_file_id text,
  p_page integer,
  p_page_size integer
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $function$
  with prepared as materialized (
    select row.unique_id,row.updated_at,row.report_date,
      lower(btrim(coalesce(row.itemcode,''))) item_key_v2367,
      coalesce(row.row_state_hash,md5(concat_ws('|',
        lower(btrim(coalesce(row.itemcode,''))),lower(btrim(coalesce(row.commonname,''))),
        lower(btrim(coalesce(row.contsize,''))),lower(btrim(coalesce(row.locationcode,''))),
        lower(btrim(coalesce(row.lotcode,''))),
        coalesce((case when regexp_replace(coalesce(row.ptronhand::text,''),'[^0-9.+-]','','g') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
          then regexp_replace(coalesce(row.ptronhand::text,''),'[^0-9.+-]','','g')::numeric end)::text,'0'),
        coalesce((case when regexp_replace(coalesce(row.ptrreviewed::text,''),'[^0-9.+-]','','g') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
          then regexp_replace(coalesce(row.ptrreviewed::text,''),'[^0-9.+-]','','g')::numeric end)::text,'0'),
        coalesce(row.ptravailable::text,'0'),
        coalesce((case when regexp_replace(coalesce(row.s_lts::text,''),'[^0-9.+-]','','g') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
          then regexp_replace(coalesce(row.s_lts::text,''),'[^0-9.+-]','','g')::numeric end)::text,'0'),'0',
        lower(btrim(coalesce(row.priority,''))),lower(btrim(coalesce(row.holdstopcode,''))),
        lower(btrim(coalesce(row.holdstopreason,''))),
        coalesce((case when regexp_replace(coalesce(row.listprice::text,''),'[^0-9.+-]','','g') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
          then regexp_replace(coalesce(row.listprice::text,''),'[^0-9.+-]','','g')::numeric end)::text,'0'),
        lower(btrim(coalesce(row.itemspec,''))),'',lower(btrim(coalesce(row.locationnote,''))),'',
        lower(btrim(coalesce(row.salesnote,''))),''))) state_hash_v2367
    from public.ph_drive_around_report_rows row
    where row.file_id=p_file_id
  ), distinct_rows as materialized (
    select distinct on (item_key_v2367,state_hash_v2367) prepared.unique_id,prepared.report_date from prepared
    order by item_key_v2367,state_hash_v2367,updated_at desc,unique_id desc
  ), paged as materialized (
    select distinct_rows.*,count(*) over() full_count from distinct_rows
    order by report_date desc nulls last,unique_id
    offset p_page*p_page_size limit p_page_size
  ), records as (
    select paged.full_count,row.report_date::timestamptz occurred_at,row.unique_id id,
      jsonb_build_object('kind','record','id',row.unique_id,
        'title',coalesce(nullif(row.commonname,''),row.itemcode),'subtitle',row.file_name,
        'status',coalesce(nullif(row.holdstopcode,''),'Archived'),'occurredAt',row.report_date,
        'itemcode',coalesce(row.itemcode,''),'commonname',coalesce(row.commonname,''),
        'contsize',coalesce(row.contsize,''),'locationcode',coalesce(row.locationcode,''),
        'lotcode',coalesce(row.lotcode,''),'quantity',row.ptravailable,
        'unitListPrice',null,'lineDollarValue',null,'photoLinks',coalesce(photo.links,'[]'::jsonb),
        'facts',jsonb_build_object('File',row.file_name,'Report Date',row.report_date,'Season',row.season,
          'Available',row.ptravailable,'On Hand',row.ptronhand,'Review',row.ptrreviewed,'Open Stock',row.s_lts,
          'Hold',row.holdstopcode,'Hold Reason',row.holdstopreason,'Spec',row.itemspec,'Seen',row.seen_count),
        'notes',to_jsonb(array_remove(array[row.locationnote,row.salesnote,row.inventorynote],null))) record
    from paged join public.ph_drive_around_report_rows row on row.unique_id=paged.unique_id
    left join lateral (
      select jsonb_agg('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||asset.bucket||'/'||asset.path order by asset.photo_at desc) links
      from (select photo.* from public.ph_photo_history_assets photo where photo.itemcode=row.itemcode
        and (photo.locationcode is null or photo.locationcode=row.locationcode) order by photo.photo_at desc limit 5) asset
    ) photo on true
  )
  select jsonb_build_object(
    'rows',coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb),
    'total',coalesce(max(full_count),0)
  ) from records
$function$;
revoke all on function private.historical_drive_file_page_v2367(text,integer,integer) from public,anon,authenticated,service_role;

do $patch_drive_archive$
declare
  function_definition text:=pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure);
  old_fragment constant text:=$old$
begin
  base_result:=public.historical_archive_read_v1(p_query);
$old$;
  new_fragment constant text:=$new$
begin
  if record_kind='drive' and operation='archive-records' then
    if jsonb_typeof(coalesce(p_query,'{}'::jsonb))<>'object'
      or exists(select 1 from jsonb_object_keys(coalesce(p_query,'{}'::jsonb)) key
        where key not in ('operation','recordKind','path','page','pageSize','view'))
      or (p_query ? 'view' and (jsonb_typeof(p_query->'view')<>'string'
        or p_query->>'view' not in ('historical-requests','request-history')))
      or jsonb_typeof(p_query->'path')<>'array' or jsonb_array_length(p_query->'path')<>3
      or exists(select 1 from jsonb_array_elements(p_query->'path') entry
        where jsonb_typeof(entry)<>'string' or length(entry#>>'{}') not between 1 and 500)
      or path_value->>0 !~ '^[0-9]{4}$'
      or path_value->>1 !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      or left(path_value->>1,4)<>path_value->>0
      or (p_query ? 'page' and (jsonb_typeof(p_query->'page')<>'number'
        or coalesce(p_query->>'page','') !~ '^(0|[1-9][0-9]{0,4})$'))
      or (p_query ? 'pageSize' and (jsonb_typeof(p_query->'pageSize')<>'number'
        or coalesce(p_query->>'pageSize','') !~ '^[1-9][0-9]?$|^100$')) then
      raise exception using errcode='22023',message='HISTORICAL_ARCHIVE_QUERY_INVALID';
    end if;
    base_result:=public.historical_archive_read_v1(jsonb_build_object(
      'operation','archive-folders','recordKind','drive','path','[]'::jsonb,'page',0,'pageSize',1)
      || case when p_query ? 'view' then jsonb_build_object('view',p_query->'view') else '{}'::jsonb end);
    with page as materialized (
      select private.historical_drive_file_page_v2367(path_value->>2,page_value,page_size_value) result
    )
    select result->'rows',(result->>'total')::bigint into rows_value,row_total from page;
    return base_result||jsonb_build_object('operation',operation,'recordKind',record_kind,
      'path',path_value,'depth',jsonb_array_length(path_value),'maxDepth',3,
      'page',page_value,'pageSize',page_size_value,'total',row_total,'rows',rows_value);
  end if;
  base_result:=public.historical_archive_read_v1(p_query);
$new$;
begin
  if position('historical_drive_file_page_v2367(path_value->>2' in function_definition)>0 then return; end if;
  if position(old_fragment in function_definition)=0 then
    raise exception using errcode='55000',message='HISTORICAL_DRIVE_FAST_READ_SOURCE_MISMATCH';
  end if;
  execute replace(function_definition,old_fragment,new_fragment);
end
$patch_drive_archive$;

do $archive_assertions$
begin
  if to_regprocedure('private.historical_drive_file_page_v2367(text,integer,integer)') is null
    or position('historical_drive_file_page_v2367(path_value->>2' in
      pg_get_functiondef('public.historical_archive_read_v2(jsonb)'::regprocedure))=0
    or has_function_privilege('authenticated','private.historical_drive_file_page_v2367(text,integer,integer)','execute')
    or not has_function_privilege('authenticated','public.historical_archive_read_v2(jsonb)','execute') then
    raise exception using errcode='55000',message='HISTORICAL_DRIVE_FAST_READ_FAILED';
  end if;
end
$archive_assertions$;

commit;
