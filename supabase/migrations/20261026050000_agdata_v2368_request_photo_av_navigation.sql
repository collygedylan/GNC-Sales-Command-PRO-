begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create temp table v2368_protected_counts on commit drop as
select
  (select count(*) from public.ph_requests_pending) request_rows,
  (select count(*) from public.ph_soc_master) soc_rows,
  (select count(*) from public.ph_reclass_recount_jobs) recount_rows,
  (select count(*) from bunch_note_private.bunch_notes) bunch_note_rows;

create or replace function public.safe_parse_timestamptz(
  p_val text,
  p_default timestamptz default null
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $function$
declare
  value text := nullif(btrim(p_val), '');
  parts text[];
  year_value integer;
begin
  if value is null then return p_default; end if;
  if value ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}$' then
    parts := regexp_split_to_array(value, '/');
    year_value := parts[3]::integer;
    if year_value < 100 then year_value := year_value + 2000; end if;
    return make_timestamptz(year_value, parts[1]::integer, parts[2]::integer, 12, 0, 0, 'America/Chicago');
  end if;
  return value::timestamptz;
exception when others then
  return p_default;
end
$function$;
revoke all on function public.safe_parse_timestamptz(text,timestamptz) from public,anon;
grant execute on function public.safe_parse_timestamptz(text,timestamptz) to authenticated,service_role;

create or replace function private.persist_completed_request_history_v1(
  p_request_id text,
  p_event text default 'completed',
  p_delivery_state text default 'pending',
  p_recovered boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  request_row public.ph_active_request%rowtype;
  master_row public.ph_master_inventory%rowtype;
  quantity numeric;
  unit_price numeric;
  photo_at timestamptz;
  photo_date_label text;
  completed_at timestamptz;
  match_pct numeric;
  photo_match numeric;
begin
  select * into request_row from public.ph_active_request where unique_id=p_request_id for update;
  if request_row.unique_id is null then
    raise exception using errcode='P0002',message='REQUEST_NOT_FOUND';
  end if;
  select * into master_row from public.ph_master_inventory where unique_id=request_row.master_id;
  perform private.upsert_request_history(p_request_id,p_event,p_delivery_state,p_recovered);

  quantity:=private.historical_requests_number_v1(request_row.req_qty);
  if quantity is null or quantity<=0 then quantity:=25; end if;
  unit_price:=greatest(coalesce(private.historical_requests_number_v1(master_row.listprice),0),0);
  completed_at:=public.safe_parse_timestamptz(request_row.date_completed,clock_timestamp());
  photo_at:=coalesce(master_row.av_rule_photo_updated_at,master_row.photo_date,master_row.date_completed,
    master_row.av_rule_bundle_updated_at,public.safe_parse_timestamptz(request_row.photo_date,null),completed_at);
  photo_date_label:=case when photo_at is null then null
    else to_char(photo_at at time zone 'America/Chicago','MM/DD/YY') end;
  match_pct:=coalesce(request_row.req_match,private.historical_requests_number_v1(master_row.match));
  photo_match:=private.historical_requests_number_v1(master_row.loc_match_qty);

  update public.ph_request_history history set
    req_status='Complete',
    req_archived=false,
    date_completed=coalesce(public.safe_parse_timestamptz(request_row.date_completed,null),history.date_completed,clock_timestamp()),
    req_photo_link=coalesce(nullif(request_row.req_photo_link,''),nullif(master_row.photo_link,''),history.req_photo_link),
    req_photo_name=coalesce(nullif(request_row.req_photo_name,''),nullif(master_row.photo_name,''),history.req_photo_name),
    photo_link=coalesce(nullif(request_row.req_photo_link,''),nullif(master_row.photo_link,''),history.photo_link),
    photo_name=coalesce(nullif(request_row.req_photo_name,''),nullif(master_row.photo_name,''),history.photo_name),
    req_spec=coalesce(nullif(request_row.req_spec,''),nullif(master_row.spec,''),history.req_spec),
    req_match=coalesce(request_row.req_match::text,nullif(master_row.match,''),history.req_match),
    req_caliper=coalesce(nullif(request_row.req_caliper,''),nullif(master_row.caliper,''),history.req_caliper),
    req_pic_note=coalesce(nullif(request_row.req_pic_note,''),nullif(master_row.pic_note,''),history.req_pic_note),
    req_sales_note=coalesce(nullif(request_row.req_sales_note,''),nullif(master_row.sales_note,''),history.req_sales_note),
    req_comments=coalesce(nullif(request_row.req_comments,''),nullif(master_row.sales_note,''),history.req_comments),
    av_note=coalesce(nullif(request_row.av_note,''),nullif(master_row.av_note,''),history.av_note),
    pick_note=coalesce(nullif(request_row.req_pic_note,''),nullif(master_row.pic_note,''),history.pick_note),
    comments=coalesce(nullif(request_row.req_comments,''),nullif(master_row.sales_note,''),history.comments),
    effective_qty=quantity,
    listprice=unit_price,
    line_dollar_value=round(quantity*unit_price,2),
    photo_date=coalesce(photo_date_label,nullif(history.photo_date,'')),
    loc_match_pct=coalesce(match_pct,history.loc_match_pct),
    loc_photo_match=coalesce(photo_match,history.loc_photo_match),
    customeridentityid=coalesce(nullif(request_row.customeridentityid,''),history.customeridentityid),
    customername=coalesce(nullif(request_row.customername,''),history.customername),
    consigneeidentityid=coalesce(nullif(request_row.consigneeidentityid,''),history.consigneeidentityid),
    consigneename=coalesce(nullif(request_row.consigneename,''),history.consigneename),
    snapshot=coalesce(history.snapshot,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
      'unique_id',request_row.unique_id,'master_id',request_row.master_id,
      'commonname',coalesce(master_row.commonname,request_row.commonname),
      'contsize',coalesce(master_row.contsize,request_row.contsize),
      'locationcode',coalesce(master_row.locationcode,request_row.locationcode),
      'lotcode',coalesce(master_row.lotcode,request_row.lotcode),
      'itemcode',coalesce(master_row.itemcode,request_row.itemcode),
      'req_status','Complete','date_completed',completed_at,
      'req_photo_link',coalesce(nullif(request_row.req_photo_link,''),nullif(master_row.photo_link,'')),
      'req_photo_name',coalesce(nullif(request_row.req_photo_name,''),nullif(master_row.photo_name,'')),
      'photo_date',photo_date_label,'req_spec',coalesce(nullif(request_row.req_spec,''),nullif(master_row.spec,'')),
      'loc_match_pct',match_pct,'loc_photo_match',photo_match,
      'av_note',coalesce(nullif(request_row.av_note,''),nullif(master_row.av_note,'')),
      'pick_note',coalesce(nullif(request_row.req_pic_note,''),nullif(master_row.pic_note,'')),
      'comments',coalesce(nullif(request_row.req_comments,''),nullif(master_row.sales_note,'')),
      'effective_qty',quantity,'listprice',unit_price,'line_dollar_value',round(quantity*unit_price,2),
      'request_selected_salesrep_id',request_row.request_selected_salesrep_id,
      'customeridentityid',request_row.customeridentityid,'customername',request_row.customername,
      'consigneeidentityid',request_row.consigneeidentityid,'consigneename',request_row.consigneename
    )),
    last_event=p_event,
    delivery_state=p_delivery_state,
    updated_at=clock_timestamp()
  where history.unique_id=p_request_id;

  return (select coalesce(history.snapshot,'{}'::jsonb)
    ||jsonb_strip_nulls(to_jsonb(history))
    ||jsonb_build_object(
      'unique_id',history.unique_id,'req_status','Complete','date_completed',history.date_completed,
      'lifecycle_state','completed_history','active',false,'request_history',true
    )
    from public.ph_request_history history where history.unique_id=p_request_id);
end
$function$;
revoke all on function private.persist_completed_request_history_v1(text,text,text,boolean)
  from public,anon,authenticated,service_role;

create or replace function private.stamp_request_batch_creator(p_requests jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  profile public.profiles%rowtype;
  actor_email text;
  stamped jsonb;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'REQUEST_PROFILE_REQUIRED';
  end if;
  if jsonb_typeof(p_requests) <> 'array' then return p_requests; end if;
  select lower(btrim(auth_user.email)) into actor_email from auth.users auth_user where auth_user.id=profile.id;
  select coalesce(jsonb_agg(item.value || jsonb_build_object(
    'requested_by',profile.username,
    'request_created_by_username',profile.username,
    'request_created_by_display',coalesce(nullif(btrim(profile.display_name),''),profile.username),
    'request_created_by_email',actor_email
  ) order by item.ordinality),'[]'::jsonb)
  into stamped
  from jsonb_array_elements(p_requests) with ordinality as item(value, ordinality);
  return stamped;
end
$function$;
revoke all on function private.stamp_request_batch_creator(jsonb) from public,anon,authenticated,service_role;

create or replace function sales_private.request_mapping_rep_allowed_v1(p_actor_id uuid,p_salesrep_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists(
    select 1 from public.profiles actor
    where actor.id=p_actor_id and actor.disabled_at is null and not coalesce(actor.must_change_password,false)
      and (actor.locked_until is null or actor.locked_until<=clock_timestamp())
  )
$function$;
revoke all on function sales_private.request_mapping_rep_allowed_v1(uuid,text) from public,anon,authenticated;
grant execute on function sales_private.request_mapping_rep_allowed_v1(uuid,text) to service_role;

create or replace function sales_private.require_active_customer_mapping_for_request_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  matches integer;
  selected_id text;
  canonical_name text;
  canonical_username text;
  canonical_email text;
  requested_identity text;
  selected_profile public.profiles%rowtype;
  caller_id uuid:=auth.uid();
begin
  if tg_op='UPDATE' and
    (old.customeridentityid,old.customername,old.consigneeidentityid,old.consigneename,
      old.requested_by,old.request_selected_rep_username,old.request_selected_rep_display,old.request_source,old.request_selected_salesrep_id)
    is not distinct from
    (new.customeridentityid,new.customername,new.consigneeidentityid,new.consigneename,
      new.requested_by,new.request_selected_rep_username,new.request_selected_rep_display,new.request_source,new.request_selected_salesrep_id) then
    return new;
  elsif tg_op='INSERT' and exists(select 1 from public.ph_active_request existing where existing.unique_id=new.unique_id) then
    return new;
  end if;
  if lower(btrim(coalesce(new.request_source,''))) not in ('general','av') then
    if coalesce(auth.role(),'')='service_role' then return new; end if;
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
  end if;
  if nullif(btrim(new.customeridentityid),'') is null or nullif(btrim(new.consigneeidentityid),'') is null
    or nullif(btrim(new.customername),'') is null or nullif(btrim(new.consigneename),'') is null then
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
  end if;
  selected_id:=nullif(btrim(new.request_selected_salesrep_id),'');
  if selected_id is not null then
    select count(distinct btrim(mapping.salesrepid)) into matches
    from public.ph_customer_consignee_sales_reps mapping
    where btrim(mapping.customeridentityid)=btrim(new.customeridentityid)
      and btrim(mapping.consigneeid)=btrim(new.consigneeidentityid)
      and lower(btrim(mapping.customername))=lower(btrim(new.customername))
      and lower(btrim(mapping.consigneename))=lower(btrim(new.consigneename))
      and btrim(mapping.salesrepid)=selected_id
      and upper(btrim(mapping.customerstatus))='A' and upper(btrim(mapping.consigneestatus))='A'
      and (caller_id is null or sales_private.request_mapping_rep_allowed_v1(caller_id,mapping.salesrepid));
    if matches<>1 then raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED'; end if;

    select btrim(mapping.salesrepname),rep.username,lower(btrim(auth_user.email))
    into canonical_name,canonical_username,canonical_email
    from public.ph_customer_consignee_sales_reps mapping
    left join sales_private.rep_identities identity on identity.kind='external_id'
      and identity.identity_key=sales_private.key(mapping.salesrepid)
    left join public.profiles rep on rep.id=identity.profile_id and rep.disabled_at is null
      and not coalesce(rep.must_change_password,false) and (rep.locked_until is null or rep.locked_until<=clock_timestamp())
    left join auth.users auth_user on auth_user.id=rep.id and auth_user.email_confirmed_at is not null
    where btrim(mapping.customeridentityid)=btrim(new.customeridentityid)
      and btrim(mapping.consigneeid)=btrim(new.consigneeidentityid)
      and btrim(mapping.salesrepid)=selected_id
      and upper(btrim(mapping.customerstatus))='A' and upper(btrim(mapping.consigneestatus))='A'
    order by rep.username nulls last
    limit 1;
  else
    select count(*) into matches from public.ph_customer_consignee_sales_reps mapping
    where btrim(mapping.customeridentityid)=btrim(new.customeridentityid)
      and btrim(mapping.consigneeid)=btrim(new.consigneeidentityid)
      and lower(btrim(mapping.customername))=lower(btrim(new.customername))
      and lower(btrim(mapping.consigneename))=lower(btrim(new.consigneename))
      and upper(btrim(mapping.customerstatus))='A' and upper(btrim(mapping.consigneestatus))='A';
    if matches<1 then raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED'; end if;
    requested_identity:=coalesce(nullif(btrim(new.request_selected_rep_username),''),
      nullif(btrim(new.request_selected_rep_display),''),nullif(btrim(new.sales_rep),''));
    select profile.* into selected_profile from public.profiles profile
    where profile.disabled_at is null and not coalesce(profile.must_change_password,false)
      and (profile.locked_until is null or profile.locked_until<=clock_timestamp())
      and (lower(btrim(profile.username))=lower(btrim(requested_identity))
        or sales_private.rep_name_key(coalesce(nullif(btrim(profile.display_name),''),profile.username))
          =sales_private.rep_name_key(requested_identity))
    order by (lower(btrim(profile.username))=lower(btrim(requested_identity))) desc,profile.username
    limit 1;
    if selected_profile.id is null then raise exception using errcode='22023',message='REQUEST_SELECTED_USER_REQUIRED'; end if;
    canonical_name:=coalesce(nullif(btrim(selected_profile.display_name),''),selected_profile.username);
    canonical_username:=selected_profile.username;
    select lower(btrim(auth_user.email)) into canonical_email from auth.users auth_user
      where auth_user.id=selected_profile.id and auth_user.email_confirmed_at is not null;
  end if;
  new.request_selected_salesrep_id:=selected_id;
  new.request_selected_rep_display:=canonical_name;
  new.request_selected_rep_username:=canonical_username;
  new.request_selected_rep_email:=canonical_email;
  new.sales_rep:=canonical_name;
  return new;
end
$function$;
revoke all on function sales_private.require_active_customer_mapping_for_request_v1() from public,anon,authenticated;

create or replace function public.verify_request_batch_submission_v2368(client_batch_id uuid,requests jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles%rowtype;
  receipt jsonb;
  canary_proof jsonb;
  receipt_text text;
begin
  actor:=private.current_active_profile();
  if lower(btrim(coalesce(actor.username,'')))<>'dylan_collyge' then
    raise exception using errcode='42501',message='REQUEST_CANARY_DYLAN_ONLY';
  end if;
  begin
    receipt:=private.insert_request_batch(client_batch_id,private.stamp_request_batch_creator(requests),'general');
    select jsonb_build_object(
      'requested_by',min(requested_by),
      'request_created_by_username',min(request_created_by_username),
      'request_created_by_email',min(request_created_by_email),
      'request_selected_rep_username',min(request_selected_rep_username),
      'request_selected_rep_display',min(request_selected_rep_display),
      'request_selected_rep_email',min(request_selected_rep_email),
      'request_folder',min(request_folder)
    ) into canary_proof
    from public.ph_active_request where client_batch_id=verify_request_batch_submission_v2368.client_batch_id;
    raise exception using errcode='P2368',message='REQUEST_CANARY_ROLLBACK',
      detail=(receipt||jsonb_build_object('canary_proof',canary_proof))::text;
  exception when sqlstate 'P2368' then
    get stacked diagnostics receipt_text=PG_EXCEPTION_DETAIL;
  end;
  return receipt_text::jsonb || jsonb_build_object('ok',true,'canary_rolled_back',true);
end
$function$;
revoke all on function public.verify_request_batch_submission_v2368(uuid,jsonb) from public,anon;
grant execute on function public.verify_request_batch_submission_v2368(uuid,jsonb) to authenticated;

create or replace function public.sanitize_av_note_without_spec_caliper(p_raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select nullif(string_agg(clean_segment,' / ' order by ordinal),'')
  from (
    select btrim(segment) clean_segment,ordinal
    from regexp_split_to_table(regexp_replace(coalesce(p_raw,''),$regex$\mN[[:space:]]*/[[:space:]]*A\M$regex$,'','gi'),$regex$[[:space:]]*/[[:space:]]*$regex$)
      with ordinality as parts(segment,ordinal)
    where nullif(btrim(segment),'') is not null
      and btrim(segment) !~* $regex$(^|[^a-z])(spec|caliper|cal)([^a-z]|$)$regex$
      and btrim(segment) !~* $regex$^[[:space:]]*[0-9]+([.][0-9]+)?([[:space:]]*-[[:space:]]*[0-9]+([.][0-9]+)?)?[[:space:]]*['"]?[[:space:]]*(h[[:space:]]*x[[:space:]]*w|h|w)?[[:space:]]*$$regex$
  ) sanitized
$function$;
revoke all on function public.sanitize_av_note_without_spec_caliper(text) from public,anon;
grant execute on function public.sanitize_av_note_without_spec_caliper(text) to authenticated,service_role;

create or replace function public.get_itemcode_av_note_options_v1(p_itemcode text,p_commonname text default null)
returns table(note text)
language sql
stable
security definer
set search_path = ''
as $function$
  with params as (
    select upper(btrim(coalesce(p_itemcode,''))) itemcode,
      left(regexp_replace(upper(btrim(coalesce(p_itemcode,''))),'[^A-Z0-9]','','g'),6) plant_prefix,
      upper(btrim(coalesce(p_commonname,''))) commonname
  ), scope_names as (
    select commonname from params where commonname<>''
    union
    select upper(btrim(inventory.commonname)) from public.ph_master_inventory inventory,params
    where upper(btrim(inventory.itemcode))=params.itemcode
      or left(regexp_replace(upper(btrim(inventory.itemcode)),'[^A-Z0-9]','','g'),6)=params.plant_prefix
    union
    select upper(btrim(history.commonname)) from public.ph_requests_completed_history history,params
    where upper(btrim(history.itemcode))=params.itemcode
      or left(regexp_replace(upper(btrim(history.itemcode)),'[^A-Z0-9]','','g'),6)=params.plant_prefix
  ), raw_notes as (
    select notes.salesnote raw_note from public.ph_av_notes notes
    where upper(btrim(notes.commonname)) in (select commonname from scope_names)
    union all
    select values.raw_note from public.ph_master_inventory inventory,params
    cross join lateral (values(inventory.av_note),(inventory.sales_note),(inventory.salesnote)) values(raw_note)
    where upper(btrim(inventory.itemcode))=params.itemcode
      or left(regexp_replace(upper(btrim(inventory.itemcode)),'[^A-Z0-9]','','g'),6)=params.plant_prefix
      or upper(btrim(inventory.commonname)) in (select commonname from scope_names)
    union all
    select values.raw_note from public.ph_requests_completed_history history,params
    cross join lateral (values(history.av_note),(history.sales_note),(history.req_sales_note)) values(raw_note)
    where upper(btrim(history.itemcode))=params.itemcode
      or left(regexp_replace(upper(btrim(history.itemcode)),'[^A-Z0-9]','','g'),6)=params.plant_prefix
      or upper(btrim(history.commonname)) in (select commonname from scope_names)
    union all
    select values.raw_note from public.ph_season_sales_office_state state,params
    cross join lateral (values(state.retained_av_note),(state.current_evidence_snapshot->>'av_note'),
      (state.completed_evidence_snapshot->>'av_note'),(state.current_evidence_snapshot->>'sales_note'),
      (state.completed_evidence_snapshot->>'sales_note')) values(raw_note)
    where upper(btrim(state.itemcode_normalized))=params.itemcode
      or left(regexp_replace(upper(btrim(state.itemcode_normalized)),'[^A-Z0-9]','','g'),6)=params.plant_prefix
  ), cleaned as (
    select public.sanitize_av_note_without_spec_caliper(raw_note) note from raw_notes
  )
  select cleaned.note from cleaned where cleaned.note is not null
  group by cleaned.note order by cleaned.note limit 120
$function$;
revoke all on function public.get_itemcode_av_note_options_v1(text,text) from public,anon,authenticated;
grant execute on function public.get_itemcode_av_note_options_v1(text,text) to service_role;

create index if not exists ph_photo_history_assets_item_date_v2368
  on public.ph_photo_history_assets(upper(btrim(itemcode)),photo_at desc);

create or replace function private.resolve_photo_taken_at_v2368(
  p_itemcode text,p_commonname text,p_contsize text,p_locationcode text,p_lotcode text,p_fallback text
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select max(asset.photo_at) from public.ph_photo_history_assets asset
    where nullif(btrim(p_itemcode),'') is not null
      and upper(btrim(asset.itemcode))=upper(btrim(p_itemcode))
      and (nullif(btrim(p_locationcode),'') is null or nullif(btrim(asset.locationcode),'') is null
        or upper(btrim(asset.locationcode))=upper(btrim(p_locationcode)))
      and (nullif(btrim(p_lotcode),'') is null or nullif(btrim(asset.lotcode),'') is null
        or upper(btrim(asset.lotcode))=upper(btrim(p_lotcode)))
  ),public.safe_parse_timestamptz(p_fallback,null))
$function$;
revoke all on function private.resolve_photo_taken_at_v2368(text,text,text,text,text,text) from public,anon,authenticated,service_role;

alter table public.ph_sales_office add column if not exists photo_date text;
alter table public.ph_flyer_folder_rows add column if not exists photo_date text;
alter table public.ph_flyer_folder_history add column if not exists photo_date text;
alter table public.ph_dock_issue_status add column if not exists photo_date text;

update public.ph_master_inventory row set photo_date=coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    coalesce(row.av_rule_photo_updated_at,row.date_completed,row.last_updated)::text),row.last_updated)
where row.photo_date is null and nullif(btrim(coalesce(row.photo_link,row.dock_photo_link,row.flyer_photo_link,'')),'') is not null;

update public.ph_requests_pending row set photo_date=to_char(coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    coalesce(nullif(row.date_completed,''),row.updated_at::text)),row.updated_at) at time zone 'America/Chicago','MM/DD/YY')
where nullif(btrim(coalesce(row.photo_date,'')),'') is null
  and nullif(btrim(coalesce(row.photo_url,row.req_photo_link,'')),'') is not null;

update public.ph_requests_completed_history row set photo_date=to_char(coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    coalesce(row.date_completed::text,row.requested_at::text,row.updated_at::text)),row.date_completed,row.requested_at,row.updated_at)
    at time zone 'America/Chicago','MM/DD/YY')
where nullif(btrim(coalesce(row.photo_date,'')),'') is null
  and nullif(btrim(coalesce(row.photo_url,row.req_photo_link,row.photo_link,'')),'') is not null;

update public.ph_orders_history row set photo_date=to_char(coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    coalesce(row.order_date::text,row.archived_at::text)),public.safe_parse_timestamptz(row.order_date::text,row.archived_at),row.archived_at)
    at time zone 'America/Chicago','MM/DD/YY')
where nullif(btrim(coalesce(row.photo_date,'')),'') is null
  and (nullif(btrim(coalesce(row.photo_url,'')),'') is not null
    or (jsonb_typeof(row.photos)='array' and jsonb_array_length(row.photos)>0));

update public.ph_reserves_history row set photo_date=to_char(coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    row.archived_at::text),row.archived_at) at time zone 'America/Chicago','MM/DD/YY')
where nullif(btrim(coalesce(row.photo_date,'')),'') is null
  and (nullif(btrim(coalesce(row.photo_url,'')),'') is not null
    or (jsonb_typeof(row.photos)='array' and jsonb_array_length(row.photos)>0));

update public.ph_drive_mode_history row set photo_date=to_char(coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    coalesce(row.report_date::text,row.updated_at::text)),row.updated_at) at time zone 'America/Chicago','MM/DD/YY')
where nullif(btrim(coalesce(row.photo_date,'')),'') is null
  and (nullif(btrim(coalesce(row.photo_url,'')),'') is not null
    or (jsonb_typeof(row.photos)='array' and jsonb_array_length(row.photos)>0));

update public.ph_sales_office row set photo_date=to_char(coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    coalesce(row.completed_at::text,row.updated_at::text)),row.completed_at,row.updated_at) at time zone 'America/Chicago','MM/DD/YY')
where nullif(btrim(coalesce(row.photo_date,'')),'') is null and nullif(btrim(coalesce(row.photo_link,'')),'') is not null;

update public.ph_flyer_folder_rows row set photo_date=to_char(coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    coalesce(row.flyer_completed::text,row.date_completed::text,row.updated_at::text)),row.flyer_completed,row.date_completed,row.updated_at) at time zone 'America/Chicago','MM/DD/YY')
where nullif(btrim(coalesce(row.photo_date,'')),'') is null and nullif(btrim(coalesce(row.flyer_photo_link,'')),'') is not null;

update public.ph_flyer_folder_history row set photo_date=to_char(coalesce(
  private.resolve_photo_taken_at_v2368(row.itemcode,row.commonname,row.contsize,row.locationcode,row.lotcode,
    coalesce(row.flyer_completed::text,row.date_completed::text,row.updated_at::text)),row.flyer_completed,row.date_completed,row.updated_at) at time zone 'America/Chicago','MM/DD/YY')
where nullif(btrim(coalesce(row.photo_date,'')),'') is null and nullif(btrim(coalesce(row.flyer_photo_link,'')),'') is not null;

update public.ph_dock_issue_status row set photo_date=to_char(coalesce(
  private.resolve_photo_taken_at_v2368(row.source_itemcode,row.source_commonname,row.source_contsize,row.source_locationcode,row.source_lotcode,
    coalesce(row.flagged_at::text,row.updated_at::text)),row.flagged_at,row.updated_at) at time zone 'America/Chicago','MM/DD/YY')
where nullif(btrim(coalesce(row.photo_date,'')),'') is null
  and nullif(btrim(coalesce(row.issue_photo_link,row.source_photo_link,'')),'') is not null;

create or replace function private.historical_photo_date_for_record_v2368(p_kind text,p_row jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  date_value text;
  taken_at timestamptz;
begin
  if coalesce(jsonb_typeof(p_row->'photoLinks'),'')<>'array' or jsonb_array_length(p_row->'photoLinks')=0 then return null; end if;
  if p_kind='requests' then
    select history.photo_date into date_value from public.ph_requests_completed_history history
    where history.unique_id=p_row->>'id' limit 1;
  elsif p_kind='orders' then
    select history.photo_date into date_value from public.ph_orders_history history
    where history.order_line_key=p_row->>'id' limit 1;
  elsif p_kind='reserves' then
    select history.photo_date into date_value from public.ph_reserves_history history
    where history.reserve_history_key=p_row->>'id' limit 1;
  elsif p_kind='drive' then
    select history.photo_date into date_value from public.ph_drive_mode_history history
    where history.unique_id=p_row->>'id' order by history.updated_at desc nulls last limit 1;
    if nullif(btrim(coalesce(date_value,'')),'') is null then
      select max(asset.photo_at) into taken_at from public.ph_photo_history_assets asset
      where upper(btrim(asset.itemcode))=upper(btrim(p_row->>'itemcode'))
        and (nullif(btrim(p_row->>'locationcode'),'') is null or nullif(btrim(asset.locationcode),'') is null
          or upper(btrim(asset.locationcode))=upper(btrim(p_row->>'locationcode')));
    end if;
  end if;
  taken_at:=coalesce(public.safe_parse_timestamptz(date_value,null),taken_at);
  return case when taken_at is null then null else to_char(taken_at at time zone 'America/Chicago','MM/DD/YY') end;
end
$function$;
revoke all on function private.historical_photo_date_for_record_v2368(text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.historical_requests_read_v2368(p_query jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb:=public.historical_requests_read_v1(p_query);
  rows_value jsonb;
begin
  select coalesce(jsonb_agg(case when date_value is null then row_value
      else row_value||jsonb_build_object('photoDate',date_value) end order by ordinal),'[]'::jsonb)
  into rows_value
  from jsonb_array_elements(coalesce(result->'rows','[]'::jsonb)) with ordinality rows(row_value,ordinal)
  left join lateral (select private.historical_photo_date_for_record_v2368('requests',row_value) date_value) photo on true;
  return jsonb_set(result,'{rows}',rows_value,true);
end
$function$;
revoke all on function public.historical_requests_read_v2368(jsonb) from public,anon,service_role;
grant execute on function public.historical_requests_read_v2368(jsonb) to authenticated;

create or replace function public.historical_archive_read_v2368(p_query jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  record_kind text:=lower(btrim(coalesce(p_query->>'recordKind','')));
  result jsonb:=public.historical_archive_read_v2(p_query);
  rows_value jsonb;
begin
  if record_kind not in ('requests','orders','reserves','drive') then return result; end if;
  select coalesce(jsonb_agg(case when date_value is null then row_value
      else row_value||jsonb_build_object('photoDate',date_value) end order by ordinal),'[]'::jsonb)
  into rows_value
  from jsonb_array_elements(coalesce(result->'rows','[]'::jsonb)) with ordinality rows(row_value,ordinal)
  left join lateral (select private.historical_photo_date_for_record_v2368(record_kind,row_value) date_value) photo on true;
  return jsonb_set(result,'{rows}',rows_value,true);
end
$function$;
revoke all on function public.historical_archive_read_v2368(jsonb) from public,anon,service_role;
grant execute on function public.historical_archive_read_v2368(jsonb) to authenticated;

insert into private.navigation_view_catalog(view_key,label,parent_key,protected_reason,selectable) values
  ('smart-moves','Smart Moves',null,null,true),
  ('inventory-suggestion','Inventory Suggestion','sales-inventory',null,true),
  ('inv-consolidation','Inv Consolidation','sales-inventory',null,true),
  ('eval_reports_2','Eval Reports #2','managers','Requires Eval Reports #2 access.',true),
  ('manager-eval-reports','Eval Reports','managers',null,true),
  ('manager-approval','Approval','managers',null,true),
  ('manager-crop-roll','Crop Roll','managers',null,true),
  ('manager-moves','Move','managers',null,true),
  ('manager-season-settings','Season Settings','managers',null,true),
  ('manager-season-priority','Season Priority','managers',null,true),
  ('manager-production-schedule','Production Schedule','managers',null,true),
  ('manager-hr-command','HR & Labor','managers',null,true),
  ('manager-company-directory','Company Directory','managers',null,true),
  ('manager-av-note-users','AV Note Users','managers',null,true),
  ('manager-inquiry-coverage','Inquiry Coverage','managers',null,true),
  ('manager-transactions','Inventory Transaction History','managers',null,true),
  ('manager-transactions-keyed','Transactions Keyed','managers',null,true),
  ('manager-orders','Orders','managers',null,true),
  ('manager-assigned-items','Assigned Items','managers',null,true),
  ('manager-customer-assignments','Customer Assignments','managers',null,true),
  ('manager-historical-report','Historical Report','managers',null,true),
  ('manager-shortage-cancel','Shortage / Cancel','managers',null,true),
  ('manager-block-clearing','Block Clearing','managers',null,true),
  ('manager-access-control','User & Role Access','managers','Manager access required.',true),
  ('manager-codex-operations','Codex Operations','managers',null,true),
  ('manager-delivery-recovery','Delivery Recovery','managers',null,true),
  ('manager-hours','Labor Hours','managers',null,true),
  ('queue-pending','Que · Request','request',null,true),
  ('queue-suspend','Que · Suspend','request',null,true),
  ('queue-moves','Que · Location Moves','request',null,true),
  ('queue-recount','Que · Recount','request',null,true),
  ('queue-eval-work','Que · Eval Work','request',null,true),
  ('queue-shear-list','Que · Shear List','request',null,true),
  ('queue-bunch-notes','Que · Bunch Notes','request',null,true),
  ('queue-bunch-count-review','Que · Bunch Count Review','request',null,true),
  ('archive-requests','Historical Requests','historical-requests',null,true),
  ('archive-orders','Historical SOC Open Orders','historical-requests',null,true),
  ('archive-reserves','Historical SOC Reserves','historical-requests',null,true),
  ('archive-drive','Historical Drive Around','historical-requests',null,true),
  ('sales-office-season','Sales Office · Season','sales-office',null,true),
  ('sales-office-orders','Sales Office · Orders','sales-office',null,true),
  ('qc-docks','QC · Docks','qc',null,true),
  ('qc-eval-work','QC · Eval Work','qc',null,true),
  ('qc-approvals','QC · Approvals','qc',null,true),
  ('office-orders','Office · Orders','office',null,true),
  ('office-reserves','Office · Reserves','office',null,true),
  ('office-assigned-items','Office · Assigned Items','office',null,true),
  ('sales-drive','Sales · Drive Mode','sales',null,true),
  ('sales-av','Sales · AV','sales',null,true),
  ('sales-docks','Sales · Docks','sales',null,true),
  ('sales-communication','Sales · Communication','sales',null,true),
  ('sales-request','Sales · Que','sales',null,true),
  ('sales-sales-office','Sales · Sales Office','sales',null,true),
  ('sales-advertisement','Sales · Advertisement','sales',null,true),
  ('sales-tasks','Sales · Task','sales',null,true),
  ('sales-weather-hold','Sales · Weather & Hold Risk','sales',null,true)
on conflict(view_key) do update set label=excluded.label,parent_key=excluded.parent_key,
  protected_reason=excluded.protected_reason,selectable=true;

update private.navigation_view_catalog set selectable=true where selectable is distinct from true;

create or replace function private.navigation_module_allowed_v1(p_actor_id uuid,p_view text)
returns boolean
language plpgsql
stable
set search_path=''
as $function$
declare
  p public.profiles;
  override_value boolean;
  parent_view text;
begin
  select * into p from public.profiles where id=p_actor_id;
  if p.id is null or p.disabled_at is not null or coalesce(p.must_change_password,false)
    or (p.locked_until is not null and p.locked_until>now()) then return false; end if;
  select parent_key into parent_view from private.navigation_view_catalog where view_key=p_view;
  if not found then return false; end if;
  if p_view in ('bunch-note','hl-order','disease-pest','pest-management') and lower(btrim(p.username))<>'dylan_collyge' then return false; end if;
  if p_view='managers' and lower(btrim(p.username))='brandt_emerson' then return false; end if;
  if p_view in ('access-control','manager-access-control') then return private.navigation_is_manager_v1(p_actor_id); end if;
  if p_view='home' then return true; end if;
  if p_view='request-sales-impact' then
    select allowed into override_value from private.navigation_view_overrides where profile_id=p.id and view_key=p_view;
    if found then return override_value; end if;
    return lower(btrim(p.username))='dylan_collyge';
  end if;
  if p_view='historical-requests' then
    select allowed into override_value from private.navigation_view_overrides where profile_id=p.id and view_key=p_view;
    if found and not override_value then return false; end if;
    return p.username='dylan_collyge'
      or upper(regexp_replace(coalesce(p.role,''),'^[[:space:]]+|[[:space:]]+$','','g')) in ('REP','SALESREP','ADMIN','ADMINISTRATOR');
  end if;
  select allowed into override_value from private.navigation_view_overrides where profile_id=p.id and view_key=p_view;
  if found then return override_value; end if;
  if p_view='eval_reports_2' then
    return private.navigation_module_allowed_v1(p.id,'managers')
      and private.user_access_has_permission_v1(p.id,'can_access_eval_reports_2');
  end if;
  if parent_view is not null and parent_view<>p_view then return private.navigation_module_allowed_v1(p.id,parent_view); end if;
  if p_view='reports' then return private.navigation_is_manager_v1(p_actor_id)
    or exists(select 1 from private.navigation_reports_legacy where profile_id=p.id); end if;
  if p_view like 'production:%' then return private.navigation_module_allowed_v1(p.id,'production-workflow'); end if;
  if p_view in ('request-history','sales-credit','credit-request') then
    return private.navigation_module_allowed_v1(p.id,'sales')
      or lower(btrim(p.username)) in ('dylan_collyge','jd_jones','megan_kelly');
  end if;
  if p_view='request' then return true; end if;
  return private.navigation_legacy_allowed_v1(p.id,p_view);
end
$function$;

insert into public."00_app_view_table_map"(view_key,view_label,parent_key,source_tables)
select catalog.view_key,catalog.label,catalog.parent_key,array['public.app_dataset_revisions']::text[]
from private.navigation_view_catalog catalog
on conflict(view_key) do update set view_label=excluded.view_label,parent_key=excluded.parent_key,
  updated_at=clock_timestamp();

do $assert_v2368$
declare
  protected v2368_protected_counts%rowtype;
begin
  select * into protected from v2368_protected_counts;
  if protected.request_rows<>(select count(*) from public.ph_requests_pending)
    or protected.soc_rows<>(select count(*) from public.ph_soc_master)
    or protected.recount_rows<>(select count(*) from public.ph_reclass_recount_jobs)
    or protected.bunch_note_rows<>(select count(*) from bunch_note_private.bunch_notes) then
    raise exception 'V2368_PROTECTED_QUEUE_ROW_COUNT_CHANGED';
  end if;
  if public.sanitize_av_note_without_spec_caliper('HEAVY BUD / SPEC - 3.5-4''H')<>'HEAVY BUD'
    or public.sanitize_av_note_without_spec_caliper('SCATTERED BLOOMS / SPEC - 12-14"')<>'SCATTERED BLOOMS'
    or public.sanitize_av_note_without_spec_caliper('SPEC - 16-18" HXW') is not null
    or public.sanitize_av_note_without_spec_caliper('N/A / SPEC - 20-22"H') is not null then
    raise exception 'V2368_AV_NOTE_SANITIZER_CONTRACT_FAILED';
  end if;
  if position('photo_date=coalesce(photo_at,history.photo_date)' in
      replace(pg_get_functiondef('private.persist_completed_request_history_v1(text,text,text,boolean)'::regprocedure),' ',''))>0 then
    raise exception 'V2368_TIMESTAMP_COALESCE_REPAIR_FAILED';
  end if;
end
$assert_v2368$;

commit;
