begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Keep the existing authenticated identity gate and add only the two SOC
-- capabilities consumed by the dedicated Aura tools.
create or replace function public.aura_voice_access_v1()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,private set statement_timeout='5s'
as $$
declare
  actor public.profiles;
  actor_id uuid:=auth.uid();
  actor_role text;
  inventory_allowed boolean;
  history_allowed boolean;
  drafts_allowed boolean;
  reserves_allowed boolean;
  docks_allowed boolean;
begin
  if actor_id is null then raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  select * into actor from public.profiles p where p.id=actor_id and p.disabled_at is null
    and not coalesce(p.must_change_password,true) and (p.locked_until is null or p.locked_until<=clock_timestamp());
  actor_role:=upper(btrim(coalesce(actor.role,'')));
  if actor.id is null or (actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','REP','SALESREP','CSR') and actor.username<>'dylan_collyge')
    or not private.app_account_active_at_v1(actor_id,actor.username,clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN';
  end if;
  inventory_allowed:=public.navigation_module_allowed_v1(actor_id,'drive') is true
    or public.navigation_module_allowed_v1(actor_id,'av') is true;
  history_allowed:=public.navigation_module_allowed_v1(actor_id,'historical-requests') is true;
  drafts_allowed:=inventory_allowed and public.navigation_module_allowed_v1(actor_id,'request') is true;
  reserves_allowed:=public.navigation_module_allowed_v1(actor_id,'reserves') is true;
  docks_allowed:=public.navigation_module_allowed_v1(actor_id,'docks') is true;
  return jsonb_build_object('ok',true,'actor',jsonb_build_object('id',actor.id,'username',actor.username,'role',actor.role),
    'capabilities',jsonb_build_object('inventory',inventory_allowed,'history',history_allowed,'drafts',drafts_allowed,
      'socReserves',reserves_allowed,'socOpenOrders',docks_allowed));
end $$;

create or replace function public.aura_voice_context_v1()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,private set statement_timeout='5s'
as $$
declare actor public.profiles; actor_id uuid:=auth.uid(); settings jsonb; revision_value bigint; season_value text; year_value integer;
begin
  if actor_id is null then raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  select * into actor from public.profiles p where p.id=actor_id and p.disabled_at is null
    and not coalesce(p.must_change_password,true) and (p.locked_until is null or p.locked_until<=clock_timestamp());
  if actor.id is null or (upper(btrim(coalesce(actor.role,''))) not in ('ADMIN','ADMINISTRATOR','MANAGER','REP','SALESREP','CSR')
      and actor.username<>'dylan_collyge')
    or not private.app_account_active_at_v1(actor_id,actor.username,clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN';
  end if;
  if public.navigation_module_allowed_v1(actor_id,'drive') is distinct from true
    and public.navigation_module_allowed_v1(actor_id,'av') is distinct from true
    and public.navigation_module_allowed_v1(actor_id,'historical-requests') is distinct from true
    and public.navigation_module_allowed_v1(actor_id,'reserves') is distinct from true
    and public.navigation_module_allowed_v1(actor_id,'docks') is distinct from true then
    raise exception using errcode='42501',message='AURA_MODULE_FORBIDDEN';
  end if;
  select s.value into settings from public.ph_app_settings s where s.key='current_season_salesyear' for share;
  settings:=coalesce(settings,'{}'::jsonb);
  season_value:=upper(btrim(coalesce(settings->>'seasonCode','')));
  year_value:=public.aura_query_salesyear_v1(settings->>'salesYear');
  if season_value not in ('F1','S1') or year_value is null then
    raise exception using errcode='55000',message='AURA_APP_CONTEXT_UNAVAILABLE';
  end if;
  if nullif(settings->>'revision','') is not null then
    if (settings->>'revision') !~ '^[0-9]{1,16}$' then raise exception using errcode='22023',message='AURA_APP_CONTEXT_INVALID'; end if;
    if (settings->>'revision')::numeric>9007199254740991 then raise exception using errcode='22023',message='AURA_APP_CONTEXT_INVALID'; end if;
  end if;
  revision_value:=coalesce(nullif(settings->>'revision','')::bigint,0);
  return jsonb_build_object('season',season_value,'salesyear',year_value,'settingRevision',revision_value);
end $$;

create or replace function public.aura_voice_soc_read_v1(
  p_kind text,p_filters jsonb,p_cursor jsonb default null,p_limit integer default 50
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,private,sales_private,app_sync_private
set statement_timeout='6s'
as $$
declare
  actor public.profiles; actor_id uuid:=auth.uid(); actor_role text; actor_name text; settings jsonb;
  kind_value text:=lower(btrim(coalesce(p_kind,''))); source_key text; module_key text;
  filters jsonb:=coalesce(p_filters,'{}'::jsonb); cursor_value integer:=0; limit_value integer;
  requested_season text; active_season text; season_value text; setting_revision bigint;
  source_revision bigint; mapping_revision bigint;
  common_name text; size_value text; filter_customer_name text; filter_consignee_name text;
  filter_customer_id text; filter_consignee_id text; variants text[]:='{}'::text[];
  choice_kind text; choices_value jsonb:='[]'::jsonb; choices_truncated boolean:=false; rows_value jsonb:='[]'::jsonb;
  row_count bigint:=0; total_value numeric:=0; unresolved_count bigint:=0; complete_value boolean:=true;
  result_count bigint:=0; more_value boolean:=false;
begin
  if actor_id is null then raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  select * into actor from public.profiles p where p.id=actor_id and p.disabled_at is null
    and not coalesce(p.must_change_password,true) and (p.locked_until is null or p.locked_until<=clock_timestamp());
  actor_role:=upper(btrim(coalesce(actor.role,''))); actor_name:=actor.username;
  if actor.id is null or (actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','REP','SALESREP','CSR') and actor_name<>'dylan_collyge')
    or not private.app_account_active_at_v1(actor_id,actor_name,clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN';
  end if;
  if kind_value='reserves' then source_key:='ph_reserves'; module_key:='reserves';
  elsif kind_value='soc_open_orders' then source_key:='ph_soc_master'; module_key:='docks';
  else raise exception using errcode='22023',message='AURA_SOC_KIND_INVALID'; end if;
  if public.navigation_module_allowed_v1(actor_id,module_key) is distinct from true then
    raise exception using errcode='42501',message='AURA_MODULE_FORBIDDEN';
  end if;
  if jsonb_typeof(filters)<>'object' or filters-'commonName'-'contSize'-'customerName'-'consigneeName'-'season'
      -'customerId'-'consigneeId'-'requestedVariants'-'expectedSettingRevision'<>'{}'::jsonb then
    raise exception using errcode='22023',message='AURA_FILTER_INVALID';
  end if;
  if not (filters ? 'commonName') or not (filters ? 'contSize') or not (filters ? 'customerName')
    or coalesce(jsonb_typeof(filters->'commonName'),'')<>'string' or coalesce(jsonb_typeof(filters->'contSize'),'')<>'string'
    or coalesce(jsonb_typeof(filters->'customerName'),'')<>'string'
    or length(btrim(filters->>'commonName')) not between 1 and 160 or length(btrim(filters->>'contSize')) not between 1 and 100
    or (filters ? 'customerName' and coalesce(jsonb_typeof(filters->'customerName'),'')<>'string')
    or (filters ? 'consigneeName' and coalesce(jsonb_typeof(filters->'consigneeName'),'')<>'string')
    or (filters ? 'customerId' and coalesce(jsonb_typeof(filters->'customerId'),'')<>'string')
    or (filters ? 'consigneeId' and coalesce(jsonb_typeof(filters->'consigneeId'),'')<>'string') then
    raise exception using errcode='22023',message='AURA_FILTER_INVALID';
  end if;
  common_name:=public.aura_inventory_v2_name_v1(filters->>'commonName');
  size_value:=public.aura_query_size_v1(filters->>'contSize');
  filter_customer_name:=nullif(regexp_replace(lower(btrim(coalesce(filters->>'customerName',''))),'\s+',' ','g'),'');
  filter_consignee_name:=nullif(regexp_replace(lower(btrim(coalesce(filters->>'consigneeName',''))),'\s+',' ','g'),'');
  filter_customer_id:=nullif(btrim(filters->>'customerId'),''); filter_consignee_id:=nullif(btrim(filters->>'consigneeId'),'');
  if length(coalesce(filter_customer_name,''))>500 or length(coalesce(filter_consignee_name,''))>500
    or length(coalesce(filter_customer_id,''))>500 or length(coalesce(filter_consignee_id,''))>500 then
    raise exception using errcode='22023',message='AURA_FILTER_INVALID';
  end if;
  if filters ? 'requestedVariants' then
    if coalesce(jsonb_typeof(filters->'requestedVariants'),'')<>'array' then
      raise exception using errcode='22023',message='AURA_VARIANT_FILTER_INVALID';
    end if;
    if jsonb_array_length(filters->'requestedVariants')>3
      or exists(select 1 from jsonb_array_elements(filters->'requestedVariants') v where coalesce(jsonb_typeof(v),'')<>'string' or lower(v#>>'{}') not in ('cone','tree','espalier')) then
      raise exception using errcode='22023',message='AURA_VARIANT_FILTER_INVALID';
    end if;
    select coalesce(array_agg(distinct lower(v#>>'{}')),'{}'::text[]) into variants from jsonb_array_elements(filters->'requestedVariants') v;
  end if;
  select s.value into settings from public.ph_app_settings s where s.key='current_season_salesyear' for share;
  settings:=coalesce(settings,'{}'::jsonb); active_season:=upper(btrim(coalesce(settings->>'seasonCode','')));
  if active_season not in ('F1','S1') or public.aura_query_salesyear_v1(settings->>'salesYear') is null then
    raise exception using errcode='55000',message='AURA_APP_CONTEXT_UNAVAILABLE';
  end if;
  if nullif(settings->>'revision','') is not null then
    if (settings->>'revision') !~ '^[0-9]{1,16}$' then raise exception using errcode='22023',message='AURA_APP_CONTEXT_INVALID'; end if;
    if (settings->>'revision')::numeric>9007199254740991 then raise exception using errcode='22023',message='AURA_APP_CONTEXT_INVALID'; end if;
  end if;
  setting_revision:=coalesce(nullif(settings->>'revision','')::bigint,0);
  if coalesce(jsonb_typeof(filters->'expectedSettingRevision'),'')<>'number'
    or coalesce(filters->>'expectedSettingRevision','') !~ '^(0|[1-9][0-9]{0,15})$' then
    raise exception using errcode='22023',message='AURA_FILTER_INVALID';
  end if;
  if (filters->>'expectedSettingRevision')::numeric<>setting_revision then
    raise exception using errcode='40001',message='AURA_APP_CONTEXT_STALE';
  end if;
  requested_season:=upper(btrim(coalesce(filters->>'season',active_season)));
  if requested_season not in ('F1','S1','U1','U2','U3','X','Y','Z') then
    raise exception using errcode='22023',message='AURA_SEASON_INVALID';
  end if;
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='22023',message='AURA_LIMIT_INVALID'; end if;
  limit_value:=p_limit;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or p_cursor-'offset'<>'{}'::jsonb or coalesce(p_cursor->>'offset','') !~ '^(0|[1-9][0-9]{0,8})$' then
      raise exception using errcode='22023',message='AURA_CURSOR_INVALID'; end if;
    cursor_value:=least(100000000,(p_cursor->>'offset')::integer);
  end if;
  perform 1 from public.app_dataset_revisions r where r.key in (source_key,'ph_customer_consignee_sales_reps') order by r.key for share;
  if (select count(*) from public.app_dataset_revisions r where r.key in (source_key,'ph_customer_consignee_sales_reps'))<>2 then
    raise exception using errcode='55000',message='AURA_SOC_SOURCE_UNAVAILABLE'; end if;
  select r.revision into source_revision from public.app_dataset_revisions r where r.key=source_key and r.state='ready';
  if source_revision is null then raise exception using errcode='55000',message='AURA_SOC_SOURCE_REFRESH_REQUIRED'; end if;
  select r.revision into mapping_revision from public.app_dataset_revisions r where r.key='ph_customer_consignee_sales_reps' and r.state='ready';
  if mapping_revision is null then raise exception using errcode='55000',message='AURA_SOC_MAPPING_REFRESH_REQUIRED'; end if;
  if exists(select 1 from app_sync_private.import_leases l join app_sync_private.import_runs run on run.id=l.run_id
      where l.key in (source_key,'ph_customer_consignee_sales_reps') and run.state='active' and run.expires_at>statement_timestamp()) then
    raise exception using errcode='55000',message='AURA_SOC_SOURCE_REFRESH_REQUIRED';
  end if;

  with source_rows as materialized (
    select r.unique_id,r.itemcode,r.commonname,r.contsize,r.season,r.locationcode,r.lotcode,
      r.customeridentityid customer_id,r.customername,r.consigneeidentityid consignee_id,r.consigneename,r.desigitem,
      public.aura_query_number_v1(r.quantityordered) ordered_qty,
      public.aura_query_number_v1(r.quantityshipped) shipped_qty,
      r.salesrepid,r.salesrepname
    from public.ph_reserves r
    where kind_value='reserves' and upper(btrim(coalesce(r.season,'')))=requested_season
      and public.aura_inventory_v2_name_v1(r.commonname)=common_name
      and public.aura_query_size_v1(r.contsize)=size_value
      and (actor_name='dylan_collyge' or sales_private.assigned_rep(to_jsonb(r))=actor_id)
    union all
    select r.unique_id,r.itemcode,r.commonname,r.contsize,r.season,r.locationcode,r.lotcode,
      r.customeridentityid customer_id,r.customername,r.consigneeidentityid consignee_id,r.consigneename,r.desigitem,
      public.aura_query_number_v1(r.quantityordered) ordered_qty,
      public.aura_query_number_v1(r.quantityshipped) shipped_qty,
      r.salesrepid,r.salesrepname
    from public.ph_soc_master r
    where kind_value='soc_open_orders' and upper(btrim(coalesce(r.season,'')))=requested_season
      and nullif(btrim(coalesce(r.invoicedate,'')),'') is null
      and public.aura_inventory_v2_name_v1(r.commonname)=common_name
      and public.aura_query_size_v1(r.contsize)=size_value
      and (actor_name='dylan_collyge' or sales_private.assigned_rep(to_jsonb(r))=actor_id)
  ), variant_rows as materialized (
    select s.*,coalesce(nullif(btrim(s.customer_id),''),'name:'||regexp_replace(lower(btrim(coalesce(s.customername,''))),'\s+',' ','g')) customer_key,
      coalesce(nullif(btrim(s.consignee_id),''),'name:'||regexp_replace(lower(btrim(coalesce(s.consigneename,''))),'\s+',' ','g')) consignee_key,
      case when kind_value='reserves' then s.ordered_qty-s.shipped_qty else s.ordered_qty end metric_qty
    from source_rows s
    where not exists (select 1 from unnest(array['cone','tree','espalier']::text[]) variant
      where (coalesce(s.commonname,'')||' '||coalesce(s.desigitem,'')) ~* ('(^|[^[:alnum:]])'||variant||'s?([^[:alnum:]]|$)')
        and not variant=any(variants))
      and (filter_customer_name is null or regexp_replace(lower(btrim(coalesce(s.customername,''))),'\s+',' ','g')=filter_customer_name)
      and (filter_consignee_name is null or regexp_replace(lower(btrim(coalesce(s.consigneename,''))),'\s+',' ','g')=filter_consignee_name)
  ), cust_candidates as materialized (
    select customer_key,customer_id,min(customername) customername,count(*) row_count
    from variant_rows
    where filter_customer_name is null or regexp_replace(lower(btrim(coalesce(customername,''))), '\s+',' ','g')=filter_customer_name
    group by customer_key,customer_id
  ), cust_count as (select count(distinct customer_key) n from cust_candidates),
  consignee_candidates as materialized (
    select v.customer_key,v.consignee_key,v.customer_id,min(v.customername) customername,v.consignee_id,min(v.consigneename) consigneename,count(*) row_count
    from variant_rows v
    where (filter_customer_id is null or v.customer_key=filter_customer_id)
      and (filter_customer_name is null or regexp_replace(lower(btrim(coalesce(v.customername,''))),'\s+',' ','g')=filter_customer_name)
      and (filter_consignee_name is null or regexp_replace(lower(btrim(coalesce(v.consigneename,''))),'\s+',' ','g')=filter_consignee_name)
    group by v.customer_key,v.consignee_key,v.customer_id,v.consignee_id
  ), consignee_count as (select count(distinct consignee_key) n from consignee_candidates),
  decision as (
    select case when filter_customer_id is null and filter_customer_name is not null and (select n from cust_count)>1 then 'customer'
      when filter_customer_id is null and filter_customer_name is not null and (select n from cust_count)=1
        and filter_consignee_id is null and filter_consignee_name is not null and (select n from consignee_count)>1 then 'consignee'
      when filter_customer_id is not null and filter_consignee_id is null and filter_consignee_name is not null and (select n from consignee_count)>1 then 'consignee'
      when filter_customer_id is null and filter_customer_name is null and (select n from cust_count)>1 then null
      when filter_customer_id is null and filter_customer_name is null and filter_consignee_name is not null and (select n from consignee_count)>1 then 'consignee'
      else null end choice_kind
  ), scoped as materialized (
    select v.* from variant_rows v cross join decision d
    where d.choice_kind is null
      and (filter_customer_id is null or v.customer_key=filter_customer_id)
      and (filter_customer_name is null or regexp_replace(lower(btrim(coalesce(v.customername,''))),'\s+',' ','g')=filter_customer_name)
      and (filter_consignee_id is null or v.consignee_key=filter_consignee_id)
      and (filter_consignee_name is null or regexp_replace(lower(btrim(coalesce(v.consigneename,''))),'\s+',' ','g')=filter_consignee_name)
  ), stats as (
    select count(*) n,count(*) filter(where ordered_qty is null or (kind_value='reserves' and shipped_qty is null) or metric_qty is null) unresolved,
      coalesce(sum(metric_qty) filter(where metric_qty is not null),0) total from scoped
  ), page_rows as (
    select jsonb_build_object('itemcode',s.itemcode,'commonname',s.commonname,'contsize',s.contsize,'season',s.season,
      'locationCode',s.locationcode,'lotCode',s.lotcode,'customerName',s.customername,'customerId',s.customer_id,
      'consigneeName',s.consigneename,'consigneeId',s.consignee_id,'quantity',s.metric_qty,
      'orderedQuantity',s.ordered_qty,'shippedQuantity',s.shipped_qty) row_json,
      s.unique_id,s.customername,s.consigneename,s.locationcode,s.lotcode
    from scoped s order by s.customername,s.consigneename,s.locationcode,s.lotcode,s.unique_id limit limit_value+1 offset cursor_value
  ), page_trim as (
    select * from page_rows order by customername,consigneename,locationcode,lotcode,unique_id limit limit_value
  )
  select d.choice_kind,(select n from stats),(select unresolved from stats),(select total from stats),
    coalesce((select jsonb_agg(row_json order by customername,consigneename,locationcode,lotcode,unique_id) from page_trim),'[]'::jsonb),
    (select count(*) from page_rows),
    case when d.choice_kind='customer' then coalesce((select jsonb_agg(q.choice order by q.customername,q.customer_key) from (
        select customer_key,customername,jsonb_build_object('customerId',customer_key,'customerName',customername,
          'label',customername||case when customer_id is null or btrim(customer_id)='' then '' else ' ('||customer_id||')' end) choice
        from cust_candidates order by customername,customer_key limit 5) q),'[]'::jsonb)
      when d.choice_kind='consignee' then coalesce((select jsonb_agg(q.choice order by q.consigneename,q.consignee_key) from (
        select customer_key,consignee_key,consigneename,jsonb_build_object('customerId',customer_key,'consigneeId',consignee_key,
          'customerName',customername,'consigneeName',consigneename,
          'label',consigneename||case when consignee_id is null or btrim(consignee_id)='' then '' else ' ('||consignee_id||')' end) choice
        from consignee_candidates order by consigneename,consignee_key limit 5) q),'[]'::jsonb)
      else '[]'::jsonb end,
    case when d.choice_kind='customer' then (select n from cust_count)>5
      when d.choice_kind='consignee' then (select n from consignee_count)>5 else false end
  into choice_kind,row_count,unresolved_count,total_value,rows_value,result_count,choices_value,choices_truncated
  from decision d;
  more_value:=result_count>limit_value;
  complete_value:=coalesce(unresolved_count,0)=0;
  if choice_kind is not null then rows_value:='[]'::jsonb; total_value:=null; row_count:=0; complete_value:=false; more_value:=false; end if;
  return jsonb_build_object('ok',true,'kind',kind_value,
    'metric',case when kind_value='reserves' then 'remaining_quantity' else 'ordered_quantity' end,
    'season',requested_season,'settingRevision',setting_revision,'datasetRevision',source_revision,'mappingRevision',mapping_revision,
    'yearCoverage','unavailable','yearFilterApplied',false,'rows',rows_value,'total',case when complete_value then total_value else null end,
    'unresolvedCount',coalesce(unresolved_count,0),'complete',complete_value,'totalRows',coalesce(row_count,0),
    'pageSize',limit_value,'hasMore',more_value,'nextCursor',case when more_value then jsonb_build_object('offset',cursor_value+limit_value) else null end,
    'candidateChoices',choices_value,'choiceKind',choice_kind,'candidateChoicesTruncated',choices_truncated);
end $$;

-- Extend the private inventory implementation in place so its existing role,
-- dataset-fence, exact-match, and row-assignment checks remain authoritative.
do $$
declare
  definition text;
  old_text text;
  new_text text;
begin
  definition:=pg_get_functiondef('private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure);
  if definition is null then raise exception 'AURA_INVENTORY_CORE_CONTRACT_MISSING'; end if;

  old_text:=$old$'openStockOnly','countMode'$old$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_FILTER_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,$new$'openStockOnly','countMode','requestedVariants','expectedSettingRevision'$new$);

  old_text:=$old$metric:=lower(coalesce(f->>'metric','ptravailable')); if metric not in ('ptravailable','ptronhand') then raise exception using errcode='22023',message='AURA_METRIC_INVALID'; end if;
  count_mode:=$old$;
  new_text:=$new$metric:=lower(coalesce(f->>'metric','ptravailable')); if metric not in ('ptravailable','ptronhand','s_lts') then raise exception using errcode='22023',message='AURA_METRIC_INVALID'; end if;
  if f ? 'requestedVariants' then
    if coalesce(jsonb_typeof(f->'requestedVariants'),'')<>'array' then raise exception using errcode='22023',message='AURA_VARIANT_FILTER_INVALID'; end if;
    if jsonb_array_length(f->'requestedVariants')>3 or exists(
      select 1 from jsonb_array_elements(f->'requestedVariants') v
      where coalesce(jsonb_typeof(v),'')<>'string' or lower(v#>>'{}') not in ('cone','tree','espalier')) then
      raise exception using errcode='22023',message='AURA_VARIANT_FILTER_INVALID';
    end if;
  end if;
  count_mode:=$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_METRIC_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$setting_revision:=coalesce(nullif(manager_settings->>'revision','')::bigint,0);$old$;
  new_text:=$new$setting_revision:=coalesce(nullif(manager_settings->>'revision','')::bigint,0);
  if f ? 'expectedSettingRevision' then
    if coalesce(jsonb_typeof(f->'expectedSettingRevision'),'')<>'number'
      or coalesce(f->>'expectedSettingRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (f->>'expectedSettingRevision')::numeric>9007199254740991 then
      raise exception using errcode='22023',message='AURA_SETTING_REVISION_INVALID';
    end if;
    if (f->>'expectedSettingRevision')::bigint<>setting_revision then
      raise exception using errcode='40001',message='AURA_APP_CONTEXT_STALE';
    end if;
  end if;$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_REVISION_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$select s.value into manager_settings from public.ph_app_settings s where s.key='current_season_salesyear';$old$;
  new_text:=$new$select s.value into manager_settings from public.ph_app_settings s where s.key='current_season_salesyear' for share;$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_SETTINGS_LOCK_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$public.aura_query_number_v1(case when metric='ptronhand' then m.ptronhand else m.ptravailable end) qty,$old$;
  new_text:=$new$public.aura_query_number_v1(case when metric='ptronhand' then m.ptronhand when metric='s_lts' then m.s_lts else m.ptravailable end) qty,$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_QUANTITY_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$and (not open_only or public.aura_query_number_v1(m.s_lts)>0 or public.aura_query_number_v1(m.s_lts) is null)$old$;
  new_text:=$new$and (metric='s_lts' or not open_only or public.aura_query_number_v1(m.s_lts)>0 or public.aura_query_number_v1(m.s_lts) is null)$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_OPEN_STOCK_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$from public.ph_master_inventory m
    where (nullif(btrim(coalesce(m.app_tab_assignment,'')),'') is null or lower(m.app_tab_assignment) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied'))$old$;
  new_text:=$new$from public.ph_master_inventory m
    where not exists(select 1 from unnest(array['cone','tree','espalier']::text[]) variant
      where (coalesce(m.commonname,'')||' '||coalesce(m.desigitem,'')) ~* ('(^|[^[:alnum:]])'||variant||'s?([^[:alnum:]]|$)')
        and not exists(select 1 from jsonb_array_elements_text(coalesce(f->'requestedVariants','[]'::jsonb)) spoken(value) where lower(value)=variant))
      and (nullif(btrim(coalesce(m.app_tab_assignment,'')),'') is null or lower(m.app_tab_assignment) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied'))$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_VARIANT_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$'ptronhand',public.aura_query_number_v1(ptronhand),'assignedTo',assignedto$old$;
  new_text:=$new$'ptronhand',public.aura_query_number_v1(ptronhand),'s_lts',public.aura_query_number_v1(s_lts),'quantity',qty,'assignedTo',assignedto$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_PROJECTION_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$coalesce((select count(distinct selection_id) filter(where product_exact)=1 from candidates),false)$old$;
  new_text:=$new$coalesce((select
    count(distinct selection_id) filter(where product_exact)=1
    or (size_filter is not null and count(*) filter(where product_exact and
      (common_name is not null or public.aura_inventory_v2_name_v1(commonname)=public.aura_inventory_v2_name_v1(needle)))>0)
    from candidates),false)$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_EXACT_MATCH_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$if unresolved_count>0 then complete_value:=false; end if;$old$;
  new_text:=$new$if unresolved_count>0 then complete_value:=false; end if;
  if row_total>0 and (needle is not null or common_name is not null) and not coalesce(exact_match_value,false) then complete_value:=false; end if;$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_INVENTORY_CORE_COMPLETENESS_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  execute definition;
end $$;

revoke all on function public.aura_voice_access_v1() from public,anon,service_role;
grant execute on function public.aura_voice_access_v1() to authenticated;
revoke all on function public.aura_voice_context_v1() from public,anon,service_role;
grant execute on function public.aura_voice_context_v1() to authenticated;
revoke all on function public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer) from public,anon,service_role;
grant execute on function public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer) to authenticated;

-- Conversation memory remains service-role-only. Expand its existing module gate
-- by one guarded predicate fragment, retaining every other authorization check.
do $$
declare
  definition text;
  old_gate text:=$old$and public.navigation_module_allowed_v1(p_actor_id,'historical-requests') is distinct from true then$old$;
  new_gate text:=$new$and public.navigation_module_allowed_v1(p_actor_id,'historical-requests') is distinct from true
    and public.navigation_module_allowed_v1(p_actor_id,'reserves') is distinct from true
    and public.navigation_module_allowed_v1(p_actor_id,'docks') is distinct from true then$new$;
begin
  definition:=pg_get_functiondef('public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)'::regprocedure);
  if definition is null or length(definition)-length(replace(definition,old_gate,''))<>length(old_gate) then
    raise exception 'AURA_CONVERSATION_GATE_CONTRACT_MISMATCH';
  end if;
  execute replace(definition,old_gate,new_gate);
end $$;

select extensions.similarity('aura','aura');
notify pgrst,'reload schema';
commit;
