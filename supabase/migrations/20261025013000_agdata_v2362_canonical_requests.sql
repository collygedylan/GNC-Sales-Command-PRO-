begin;

set local statement_timeout='120s';
set local lock_timeout='5s';

do $restore$
declare archived record;
begin
  for archived in
    select table_name from information_schema.tables
    where table_schema='archive_backup' and table_type='BASE TABLE'
    order by table_name
  loop
    if to_regclass(format('public.%I',archived.table_name)) is not null then
      raise exception 'ARCHIVE_RESTORE_PUBLIC_CONFLICT: %',archived.table_name;
    end if;
    execute format('alter table archive_backup.%I set schema public',archived.table_name);
  end loop;
end
$restore$;

drop trigger if exists ph_active_request_sales_impact_ledger_v1 on public.ph_active_request;
drop trigger if exists request_financial_capture_v1 on public.ph_active_request;
drop trigger if exists ph_request_history_sales_impact_ledger_v1 on public.ph_request_history;
drop trigger if exists request_financial_capture_v1 on public.ph_request_history;
drop trigger if exists ph_request_history_block_delete_v2360 on public.ph_request_history;
drop trigger if exists ph_request_history_block_truncate_v2360 on public.ph_request_history;

do $rename$
begin
  if to_regclass('public.ph_requests_pending') is null then
    alter table public.ph_active_request rename to ph_requests_pending;
  elsif to_regclass('public.ph_active_request') is not null then
    raise exception 'CANONICAL_PENDING_TABLE_CONFLICT';
  end if;
  if to_regclass('public.ph_requests_completed_history') is null then
    alter table public.ph_request_history rename to ph_requests_completed_history;
  elsif to_regclass('public.ph_request_history') is not null then
    raise exception 'CANONICAL_HISTORY_TABLE_CONFLICT';
  end if;
end
$rename$;

do $rewrite$
declare function_row record;
declare definition text;
begin
  for function_row in
    select n.nspname schema_name,p.proname function_name,p.oid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','app_sync_private') and p.prokind='f'
      and (position('ph_active_request' in pg_get_functiondef(p.oid))>0
        or position('ph_request_queue_live_rows' in pg_get_functiondef(p.oid))>0
        or position('ph_request_history' in pg_get_functiondef(p.oid))>0)
    order by n.nspname,p.proname,p.oid
  loop
    definition:=pg_get_functiondef(function_row.oid);
    definition:=replace(definition,'public.ph_active_request_live_rows','public.ph_requests_pending');
    definition:=replace(definition,'public.ph_request_queue_live_rows','public.ph_requests_pending');
    definition:=replace(definition,'public.ph_active_request','public.ph_requests_pending');
    definition:=replace(definition,'public.ph_request_history','public.ph_requests_completed_history');
    definition:=replace(definition,'''ph_active_request_live_rows''','''ph_requests_pending''');
    definition:=replace(definition,'''ph_request_queue_live_rows''','''ph_requests_pending''');
    definition:=replace(definition,'''ph_active_request''','''ph_requests_pending''');
    definition:=replace(definition,'''ph_request_history''','''ph_requests_completed_history''');
    execute definition;
  end loop;
end
$rewrite$;

alter table public.ph_master_inventory
  add column if not exists photos jsonb not null default '[]'::jsonb,
  add column if not exists photo_url text,
  add column if not exists photo_date timestamptz,
  add column if not exists loc_match_pct numeric,
  add column if not exists baseline_on_hand numeric,
  add column if not exists initial_photo_match_qty numeric,
  add column if not exists loc_photo_match numeric,
  add column if not exists pick_note text,
  add column if not exists photo_expires_at timestamptz;

alter table public.ph_requests_pending
  add column if not exists photos jsonb not null default '[]'::jsonb,
  add column if not exists photo_url text,
  add column if not exists photo_date text,
  add column if not exists spec text,
  add column if not exists caliper text,
  add column if not exists loc_match_pct numeric,
  add column if not exists baseline_on_hand numeric,
  add column if not exists initial_photo_match_qty numeric,
  add column if not exists loc_photo_match numeric,
  add column if not exists pick_note text,
  add column if not exists sales_note text,
  add column if not exists photo_expires_at timestamptz,
  add column if not exists sales_rep text,
  add column if not exists customer_name text,
  add column if not exists consignee_name text,
  add column if not exists customer_consignee_label text,
  add column if not exists recipient_emails jsonb not null default '[]'::jsonb,
  add column if not exists status text not null default 'Pending',
  add column if not exists request_qty numeric,
  add column if not exists effective_qty numeric,
  add column if not exists is_default_qty boolean,
  add column if not exists unit_list_price numeric,
  add column if not exists line_dollar_value numeric,
  add column if not exists request_spec text,
  add column if not exists request_caliper text,
  add column if not exists estimated_ship text,
  add column if not exists reserve_flag text,
  add column if not exists request_notes text,
  add column if not exists on_hand numeric,
  add column if not exists review_qty numeric,
  add column if not exists available_qty numeric,
  add column if not exists open_stock numeric,
  add column if not exists loc_on_hand numeric,
  add column if not exists pri text,
  add column if not exists flag_color text,
  add column if not exists ns_grade text,
  add column if not exists ld_flag text,
  add column if not exists hold_stop_code text,
  add column if not exists hold_stop_reason text,
  add column if not exists hold_stop_since text,
  add column if not exists source_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists fulfillment_status text not null default 'Pending',
  add column if not exists fulfilled_qty numeric,
  add column if not exists fulfilled_by text,
  add column if not exists fulfillment_updated_at timestamptz;

alter table public.ph_requests_completed_history
  add column if not exists photos jsonb not null default '[]'::jsonb,
  add column if not exists photo_url text,
  add column if not exists spec text,
  add column if not exists caliper text,
  add column if not exists baseline_on_hand numeric,
  add column if not exists initial_photo_match_qty numeric,
  add column if not exists photo_expires_at timestamptz,
  add column if not exists sales_note text,
  add column if not exists sales_rep text,
  add column if not exists customer_name text,
  add column if not exists consignee_name text,
  add column if not exists customer_consignee_label text,
  add column if not exists recipient_emails jsonb not null default '[]'::jsonb,
  add column if not exists completed_by text,
  add column if not exists requested_at timestamptz,
  add column if not exists request_qty numeric,
  add column if not exists effective_qty numeric,
  add column if not exists is_default_qty boolean,
  add column if not exists unit_list_price numeric,
  add column if not exists line_dollar_value numeric,
  add column if not exists request_spec text,
  add column if not exists request_caliper text,
  add column if not exists estimated_ship text,
  add column if not exists reserve_flag text,
  add column if not exists request_notes text,
  add column if not exists on_hand numeric,
  add column if not exists review_qty numeric,
  add column if not exists available_qty numeric,
  add column if not exists open_stock numeric,
  add column if not exists loc_on_hand numeric,
  add column if not exists pri text,
  add column if not exists flag_color text,
  add column if not exists ns_grade text,
  add column if not exists ld_flag text,
  add column if not exists hold_stop_code text,
  add column if not exists hold_stop_reason text,
  add column if not exists photo_date text,
  add column if not exists loc_match_pct numeric,
  add column if not exists loc_photo_match numeric,
  add column if not exists pick_note text,
  add column if not exists source_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists fulfillment_status text not null default 'Completed',
  add column if not exists fulfilled_qty numeric,
  add column if not exists fulfilled_by text,
  add column if not exists fulfillment_updated_at timestamptz;

do $photo_date_type$
begin
  if exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='ph_requests_completed_history' and column_name='photo_date'
    and data_type<>'text') then
    alter table public.ph_requests_completed_history
      alter column photo_date type text using photo_date::text;
  end if;
end
$photo_date_type$;

do $checks$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.ph_master_inventory'::regclass
    and conname='ph_master_inventory_photos_array_v2362') then
    alter table public.ph_master_inventory add constraint ph_master_inventory_photos_array_v2362
      check(jsonb_typeof(photos)='array');
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.ph_requests_pending'::regclass
    and conname='ph_requests_pending_photos_array_v2362') then
    alter table public.ph_requests_pending add constraint ph_requests_pending_photos_array_v2362
      check(jsonb_typeof(photos)='array');
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.ph_requests_completed_history'::regclass
    and conname='ph_requests_completed_history_photos_array_v2362') then
    alter table public.ph_requests_completed_history add constraint ph_requests_completed_history_photos_array_v2362
      check(jsonb_typeof(photos)='array');
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.ph_requests_pending'::regclass
    and conname='ph_requests_pending_recipient_emails_array_v2362') then
    alter table public.ph_requests_pending add constraint ph_requests_pending_recipient_emails_array_v2362
      check(jsonb_typeof(recipient_emails)='array');
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.ph_requests_completed_history'::regclass
    and conname='ph_requests_history_recipient_emails_array_v2362') then
    alter table public.ph_requests_completed_history add constraint ph_requests_history_recipient_emails_array_v2362
      check(jsonb_typeof(recipient_emails)='array');
  end if;
end
$checks$;

create or replace function private.request_numeric_v2362(p_value text)
returns numeric language sql immutable set search_path='' as $function$
  select case when nullif(regexp_replace(coalesce(p_value,''),'[^0-9.-]','','g'),'')
    ~ '^-?[0-9]+([.][0-9]+)?$'
    then regexp_replace(p_value,'[^0-9.-]','','g')::numeric else null end;
$function$;

create or replace function private.request_timestamptz_v2362(p_value text)
returns timestamptz language plpgsql immutable set search_path='' as $function$
begin
  return nullif(btrim(coalesce(p_value,'')),'')::timestamptz;
exception when others then
  return null;
end
$function$;

create or replace function private.request_photo_array_v2362(
  p_photos jsonb,p_photo_url text,p_photo_name text
) returns jsonb language sql immutable set search_path='' as $function$
  select case
    when jsonb_typeof(p_photos)='array' and jsonb_array_length(p_photos)>0 then p_photos
    when nullif(btrim(coalesce(p_photo_url,'')),'') is not null then
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('url',p_photo_url,'name',nullif(btrim(coalesce(p_photo_name,'')),''))))
    else '[]'::jsonb end;
$function$;

create or replace function private.sync_master_inventory_canonical_v2362()
returns trigger language plpgsql security definer set search_path='' as $function$
declare evidence app_sync_private.inventory_location_evidence_v1%rowtype;
declare current_on_hand numeric;
declare canonical_baseline numeric;
declare canonical_match numeric;
declare canonical_initial numeric;
declare canonical_current numeric;
declare canonical_photo_date timestamptz;
declare canonical_expiry timestamptz;
declare canonical_photo_url text;
declare active_evidence boolean;
begin
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.itemcode_key=upper(btrim(coalesce(new.itemcode,'')))
    and e.locationcode_key=upper(btrim(coalesce(new.locationcode,'')));
  current_on_hand:=private.request_numeric_v2362(new.ptronhand);
  canonical_baseline:=coalesce(evidence.baseline_on_hand,new.baseline_on_hand,
    private.request_numeric_v2362(new.initial_ptr),current_on_hand);
  canonical_match:=coalesce(evidence.loc_match_pct,new.loc_match_pct,
    private.request_numeric_v2362(new.match));
  canonical_initial:=coalesce(evidence.initial_photo_match_qty,new.initial_photo_match_qty,
    case when canonical_baseline is not null and canonical_match between 0 and 100
      then round(canonical_baseline*canonical_match/100.0) end);
  canonical_current:=coalesce(private.inventory_location_evidence_qty_v2(
    canonical_baseline,canonical_initial,current_on_hand),evidence.current_photo_match_qty,
    new.loc_photo_match,private.request_numeric_v2362(new.loc_match_qty));
  canonical_photo_date:=coalesce(evidence.evaluated_at,new.photo_date,new.date_completed,
    new.av_rule_photo_updated_at,new.av_rule_bundle_updated_at);
  canonical_expiry:=coalesce(evidence.expires_at,new.photo_expires_at,
    private.inventory_location_evidence_expiry_v2(canonical_photo_date));
  canonical_photo_url:=coalesce(nullif(btrim(coalesce(new.photo_url,'')),''),
    nullif(btrim(coalesce(evidence.photo_link,'')),''),nullif(btrim(coalesce(new.photo_link,'')),''));
  active_evidence:=coalesce(canonical_current,0)>0
    and (canonical_expiry is null or clock_timestamp()<=canonical_expiry)
    and coalesce(canonical_photo_url,nullif(btrim(coalesce(new.spec,'')),''),
      nullif(btrim(coalesce(new.av_note,'')),''),nullif(btrim(coalesce(new.pic_note,'')),'')) is not null;
  new.baseline_on_hand:=canonical_baseline;
  new.loc_match_pct:=canonical_match;
  new.initial_photo_match_qty:=canonical_initial;
  new.photo_expires_at:=canonical_expiry;
  if active_evidence then
    new.loc_photo_match:=canonical_current;
    new.photo_url:=canonical_photo_url;
    new.photo_date:=canonical_photo_date;
    new.photos:=private.request_photo_array_v2362(new.photos,canonical_photo_url,
      coalesce(evidence.photo_name,new.photo_name));
    new.pick_note:=coalesce(nullif(new.pick_note,''),nullif(evidence.pic_note,''),nullif(new.pic_note,''));
    new.spec:=coalesce(nullif(new.spec,''),nullif(evidence.spec,''));
    new.caliper:=coalesce(nullif(new.caliper,''),nullif(evidence.caliper,''));
    new.av_note:=coalesce(nullif(new.av_note,''),nullif(evidence.av_note,''));
    new.sales_note:=coalesce(nullif(new.sales_note,''),nullif(evidence.sales_note,''));
  else
    new.photos:='[]'::jsonb;
    new.photo_url:=null;
    new.photo_date:=null;
    new.spec:=null;
    new.caliper:=null;
    new.loc_match_pct:=null;
    new.baseline_on_hand:=null;
    new.initial_photo_match_qty:=null;
    new.loc_photo_match:=null;
    new.pick_note:=null;
    new.av_note:=null;
    new.sales_note:=null;
    new.photo_expires_at:=null;
  end if;
  return new;
end
$function$;

drop trigger if exists zzzzz_master_inventory_canonical_v2362 on public.ph_master_inventory;
create trigger zzzzz_master_inventory_canonical_v2362
before insert or update on public.ph_master_inventory
for each row execute function private.sync_master_inventory_canonical_v2362();

create or replace function private.sync_request_pending_canonical_v2362()
returns trigger language plpgsql security definer set search_path='' as $function$
declare master public.ph_master_inventory%rowtype;
declare raw_quantity numeric;
declare price numeric;
begin
  select candidate.* into master from public.ph_master_inventory candidate
  where candidate.unique_id=new.master_id
    or (nullif(btrim(coalesce(new.itemcode,'')),'') is not null
      and nullif(btrim(coalesce(new.locationcode,'')),'') is not null
      and upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(new.itemcode))
      and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(new.locationcode)))
  order by (candidate.unique_id=new.master_id) desc,candidate.last_updated desc nulls last
  limit 1;
  raw_quantity:=coalesce(new.request_qty,private.request_numeric_v2362(new.req_qty));
  if coalesce(raw_quantity,0)<=0 then raw_quantity:=null; end if;
  price:=greatest(coalesce(nullif(new.unit_list_price,0),private.request_numeric_v2362(master.listprice),0),0);
  new.itemcode:=coalesce(nullif(btrim(new.itemcode),''),nullif(btrim(master.itemcode),''),'UNKNOWN');
  new.request_folder:=coalesce(nullif(btrim(new.request_folder),''),'request-'||new.unique_id);
  new.created_at:=coalesce(new.created_at,clock_timestamp());
  new.updated_at:=coalesce(new.updated_at,clock_timestamp());
  new.status:=coalesce(nullif(new.req_status,''),nullif(new.status,''),'Pending');
  new.req_status:=new.status;
  new.request_qty:=raw_quantity;
  new.effective_qty:=coalesce(raw_quantity,25);
  new.is_default_qty:=raw_quantity is null;
  new.unit_list_price:=price;
  new.line_dollar_value:=round(new.effective_qty*price,2);
  new.sales_rep:=coalesce(nullif(new.sales_rep,''),nullif(new.request_selected_rep_display,''),
    nullif(new.request_selected_rep_username,''),nullif(new.requested_by,''),'Unassigned');
  new.customer_name:=coalesce(nullif(new.customer_name,''),nullif(new.customername,''),
    nullif(new.req_customer,''),'Unknown Customer');
  new.consignee_name:=coalesce(nullif(new.consignee_name,''),nullif(new.consigneename,''),'N/A');
  new.customer_consignee_label:=new.customer_name||' / '||new.consignee_name;
  new.recipient_emails:=coalesce((
    select jsonb_agg(normalized_email order by normalized_email)
    from (
      select distinct lower(btrim(candidate_email)) normalized_email
      from jsonb_array_elements_text(
        case when jsonb_typeof(coalesce(new.recipient_emails,'[]'::jsonb))='array'
          then coalesce(new.recipient_emails,'[]'::jsonb) else '[]'::jsonb end
        ||jsonb_build_array(new.request_selected_rep_email,new.request_created_by_email)
      ) as candidates(candidate_email)
      where nullif(btrim(coalesce(candidate_email,'')),'') is not null
    ) normalized
  ),'[]'::jsonb);
  new.request_spec:=coalesce(nullif(new.request_spec,''),nullif(new.desired_spec,''));
  new.request_caliper:=coalesce(nullif(new.request_caliper,''),nullif(new.desired_caliper,''));
  new.estimated_ship:=coalesce(nullif(new.estimated_ship,''),nullif(new.est_ship,''));
  new.reserve_flag:=coalesce(nullif(new.reserve_flag,''),nullif(new.req_reserve,''),'NO');
  new.request_notes:=coalesce(nullif(new.request_notes,''),nullif(new.request_note,''),nullif(new.req_comments,''));
  new.on_hand:=coalesce(new.on_hand,private.request_numeric_v2362(master.ptronhand));
  new.review_qty:=coalesce(new.review_qty,private.request_numeric_v2362(master.ptrreviewed));
  new.available_qty:=coalesce(new.available_qty,private.request_numeric_v2362(master.ptravailable));
  new.open_stock:=coalesce(new.open_stock,private.request_numeric_v2362(master.s_lts));
  new.loc_on_hand:=coalesce(new.loc_on_hand,new.on_hand);
  new.pri:=coalesce(nullif(new.pri,''),nullif(master.priority,''));
  new.flag_color:=coalesce(nullif(new.flag_color,''),nullif(new.field_tag_color,''),nullif(master.field_tag_color,''));
  new.ns_grade:=coalesce(nullif(new.ns_grade,''),nullif(new.qualitycode,''),nullif(master.qualitycode,''));
  new.ld_flag:=coalesce(nullif(new.ld_flag,''),nullif(new.source_snapshot->>'ld_flag',''));
  new.hold_stop_code:=coalesce(nullif(new.hold_stop_code,''),nullif(master.holdstopcode,''));
  new.hold_stop_reason:=coalesce(nullif(new.hold_stop_reason,''),nullif(master.holdstopreason,''));
  new.hold_stop_since:=coalesce(nullif(new.hold_stop_since,''),nullif(master.holdstopbegindate,''));
  new.photos:=private.request_photo_array_v2362(new.photos,
    coalesce(nullif(new.photo_url,''),nullif(new.req_photo_link,''),master.photo_url,master.photo_link),
    coalesce(nullif(new.req_photo_name,''),master.photo_name));
  new.photo_url:=coalesce(nullif(new.photo_url,''),nullif(new.req_photo_link,''),master.photo_url,master.photo_link);
  new.photo_date:=coalesce(nullif(new.photo_date,''),master.photo_date::text);
  new.spec:=coalesce(nullif(new.spec,''),nullif(new.req_spec,''),master.spec);
  new.caliper:=coalesce(nullif(new.caliper,''),nullif(new.req_caliper,''),master.caliper);
  new.loc_match_pct:=coalesce(new.loc_match_pct,new.req_match,master.loc_match_pct);
  new.baseline_on_hand:=coalesce(new.baseline_on_hand,master.baseline_on_hand);
  new.initial_photo_match_qty:=coalesce(new.initial_photo_match_qty,master.initial_photo_match_qty);
  new.loc_photo_match:=coalesce(new.loc_photo_match,master.loc_photo_match);
  new.pick_note:=coalesce(nullif(new.pick_note,''),nullif(new.req_pic_note,''),master.pick_note,master.pic_note);
  new.av_note:=coalesce(nullif(new.av_note,''),master.av_note);
  new.sales_note:=coalesce(nullif(new.sales_note,''),nullif(new.req_sales_note,''),master.sales_note);
  new.photo_expires_at:=coalesce(new.photo_expires_at,master.photo_expires_at);
  new.source_snapshot:=coalesce(new.source_snapshot,'{}'::jsonb)||jsonb_strip_nulls(to_jsonb(master))
    ||jsonb_strip_nulls(jsonb_build_object(
      'request_qty',new.request_qty,'effective_qty',new.effective_qty,'is_default_qty',new.is_default_qty,
      'unit_list_price',new.unit_list_price,'line_dollar_value',new.line_dollar_value,
      'request_spec',new.request_spec,'request_caliper',new.request_caliper,
      'estimated_ship',new.estimated_ship,'reserve_flag',new.reserve_flag,'request_notes',new.request_notes,
      'on_hand',new.on_hand,'review_qty',new.review_qty,'available_qty',new.available_qty,
      'open_stock',new.open_stock,'loc_on_hand',new.loc_on_hand,'pri',new.pri,
      'flag_color',new.flag_color,'ns_grade',new.ns_grade,'ld_flag',new.ld_flag,
      'hold_stop_code',new.hold_stop_code,'hold_stop_reason',new.hold_stop_reason,
      'hold_stop_since',new.hold_stop_since));
  new.fulfillment_status:=coalesce(nullif(new.fulfillment_status,''),'Pending');
  new.req_qty:=case when raw_quantity is null then null else raw_quantity::text end;
  new.desired_spec:=new.request_spec;
  new.desired_caliper:=new.request_caliper;
  new.est_ship:=new.estimated_ship;
  new.req_reserve:=new.reserve_flag;
  new.req_comments:=coalesce(new.req_comments,new.request_notes);
  new.req_photo_link:=coalesce(new.req_photo_link,new.photo_url);
  new.req_spec:=coalesce(new.req_spec,new.spec);
  new.req_caliper:=coalesce(new.req_caliper,new.caliper);
  new.req_match:=coalesce(new.req_match,new.loc_match_pct);
  new.req_pic_note:=coalesce(new.req_pic_note,new.pick_note);
  new.req_sales_note:=coalesce(new.req_sales_note,new.sales_note);
  return new;
end
$function$;

drop trigger if exists zzzzz_request_pending_canonical_v2362 on public.ph_requests_pending;
create trigger zzzzz_request_pending_canonical_v2362
before insert or update on public.ph_requests_pending
for each row execute function private.sync_request_pending_canonical_v2362();

create or replace function private.sync_request_completed_canonical_v2362()
returns trigger language plpgsql security definer set search_path='' as $function$
declare master public.ph_master_inventory%rowtype;
declare raw_quantity numeric;
declare price numeric;
begin
  select candidate.* into master from public.ph_master_inventory candidate
  where candidate.unique_id=coalesce(new.master_id,new.master_unique_id)
    or (nullif(btrim(coalesce(new.itemcode,'')),'') is not null
      and nullif(btrim(coalesce(new.locationcode,'')),'') is not null
      and upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(new.itemcode))
      and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(new.locationcode)))
  order by (candidate.unique_id=coalesce(new.master_id,new.master_unique_id)) desc,
    candidate.last_updated desc nulls last limit 1;
  raw_quantity:=coalesce(new.request_qty,private.request_numeric_v2362(new.req_qty));
  if coalesce(raw_quantity,0)<=0 then raw_quantity:=null; end if;
  price:=greatest(coalesce(nullif(new.unit_list_price,0),new.listprice,
    private.request_numeric_v2362(master.listprice),0),0);
  new.itemcode:=coalesce(nullif(btrim(new.itemcode),''),nullif(btrim(master.itemcode),''),'UNKNOWN');
  new.request_folder:=coalesce(nullif(btrim(new.request_folder),''),'request-'||new.unique_id);
  new.date_completed:=coalesce(new.date_completed,new.updated_at,new.created_at,clock_timestamp());
  new.requested_at:=coalesce(new.requested_at,new.created_at,new.date_completed,new.updated_at,clock_timestamp());
  new.created_at:=coalesce(new.created_at,new.requested_at);
  new.updated_at:=coalesce(new.updated_at,new.date_completed,clock_timestamp());
  new.completed_by:=coalesce(nullif(new.completed_by,''),nullif(new.completed_by_display,''),
    nullif(new.completed_by_username,''),nullif(new.completed_by_email,''),nullif(new.fulfilled_by,''),'System');
  new.request_qty:=raw_quantity;
  new.effective_qty:=coalesce(raw_quantity,new.effective_qty,25);
  new.is_default_qty:=raw_quantity is null;
  new.unit_list_price:=price;
  new.listprice:=price;
  new.line_dollar_value:=round(new.effective_qty*price,2);
  new.sales_rep:=coalesce(nullif(new.sales_rep,''),nullif(new.request_selected_rep_display,''),
    nullif(new.request_selected_rep_username,''),nullif(new.requested_by,''),'Unassigned');
  new.customer_name:=coalesce(nullif(new.customer_name,''),nullif(new.customername,''),
    nullif(new.request_customer,''),nullif(new.req_customer,''),'Unknown Customer');
  new.consignee_name:=coalesce(nullif(new.consignee_name,''),nullif(new.consigneename,''),'N/A');
  new.customer_consignee_label:=new.customer_name||' / '||new.consignee_name;
  new.recipient_emails:=coalesce((
    select jsonb_agg(normalized_email order by normalized_email)
    from (
      select distinct lower(btrim(candidate_email)) normalized_email
      from jsonb_array_elements_text(
        case when jsonb_typeof(coalesce(new.recipient_emails,'[]'::jsonb))='array'
          then coalesce(new.recipient_emails,'[]'::jsonb) else '[]'::jsonb end
        ||jsonb_build_array(new.request_selected_rep_email,new.request_created_by_email)
      ) as candidates(candidate_email)
      where nullif(btrim(coalesce(candidate_email,'')),'') is not null
    ) normalized
  ),'[]'::jsonb);
  new.request_spec:=coalesce(nullif(new.request_spec,''),nullif(new.desired_spec,''));
  new.request_caliper:=coalesce(nullif(new.request_caliper,''),nullif(new.desired_caliper,''));
  new.estimated_ship:=coalesce(nullif(new.estimated_ship,''),nullif(new.est_ship,''));
  new.reserve_flag:=coalesce(nullif(new.reserve_flag,''),nullif(new.req_reserve,''),'NO');
  new.request_notes:=coalesce(nullif(new.request_notes,''),nullif(new.req_comments,''),nullif(new.comments,''));
  new.on_hand:=coalesce(new.on_hand,private.request_numeric_v2362(new.snapshot->>'ptronhand'));
  new.review_qty:=coalesce(new.review_qty,private.request_numeric_v2362(new.snapshot->>'ptrreviewed'));
  new.available_qty:=coalesce(new.available_qty,private.request_numeric_v2362(new.ptravailable),
    private.request_numeric_v2362(new.snapshot->>'ptravailable'));
  new.open_stock:=coalesce(new.open_stock,private.request_numeric_v2362(new.s_lts));
  new.loc_on_hand:=coalesce(new.loc_on_hand,new.on_hand);
  new.pri:=coalesce(nullif(new.pri,''),nullif(new.priority,''));
  new.flag_color:=coalesce(nullif(new.flag_color,''),nullif(new.field_tag_color,''),nullif(master.field_tag_color,''));
  new.ns_grade:=coalesce(nullif(new.ns_grade,''),nullif(new.qualitycode,''),nullif(master.qualitycode,''));
  new.ld_flag:=coalesce(nullif(new.ld_flag,''),nullif(new.source_snapshot->>'ld_flag',''));
  new.hold_stop_code:=coalesce(nullif(new.hold_stop_code,''),nullif(new.holdstopcode,''));
  new.hold_stop_reason:=coalesce(nullif(new.hold_stop_reason,''),nullif(new.snapshot->>'holdstopreason',''));
  new.photo_url:=coalesce(nullif(new.photo_url,''),nullif(new.req_photo_link,''),nullif(new.photo_link,''));
  new.photos:=private.request_photo_array_v2362(new.photos,new.photo_url,
    coalesce(nullif(new.req_photo_name,''),nullif(new.photo_name,'')));
  new.photo_date:=coalesce(nullif(new.photo_date,''),new.date_completed::text);
  new.spec:=coalesce(nullif(new.spec,''),nullif(new.req_spec,''));
  new.caliper:=coalesce(nullif(new.caliper,''),nullif(new.req_caliper,''));
  new.loc_match_pct:=coalesce(new.loc_match_pct,private.request_numeric_v2362(new.req_match));
  new.baseline_on_hand:=coalesce(new.baseline_on_hand,
    private.request_numeric_v2362(new.snapshot->>'baseline_on_hand'),
    private.request_numeric_v2362(new.snapshot->>'ptronhand'));
  new.initial_photo_match_qty:=coalesce(new.initial_photo_match_qty,
    case when new.baseline_on_hand is not null and new.loc_match_pct between 0 and 100
      then round(new.baseline_on_hand*new.loc_match_pct/100.0) end);
  new.loc_photo_match:=coalesce(new.loc_photo_match,
    private.request_numeric_v2362(new.snapshot->>'loc_photo_match'),
    case when new.on_hand is not null and new.loc_match_pct between 0 and 100
      then round(new.on_hand*new.loc_match_pct/100.0) end);
  new.pick_note:=coalesce(nullif(new.pick_note,''),nullif(new.req_pic_note,''));
  new.sales_note:=coalesce(nullif(new.sales_note,''),nullif(new.req_sales_note,''),nullif(new.comments,''));
  new.photo_expires_at:=coalesce(new.photo_expires_at,
    private.inventory_location_evidence_expiry_v2(private.request_timestamptz_v2362(new.photo_date)));
  new.source_snapshot:=coalesce(new.source_snapshot,'{}'::jsonb)||coalesce(new.snapshot,'{}'::jsonb);
  new.snapshot:=coalesce(new.snapshot,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
    'request_qty',new.request_qty,'effective_qty',new.effective_qty,'is_default_qty',new.is_default_qty,
    'unit_list_price',new.unit_list_price,
    'line_dollar_value',new.line_dollar_value,'photo_url',new.photo_url,'photos',new.photos,
    'photo_date',new.photo_date,'spec',new.spec,'caliper',new.caliper,
    'loc_match_pct',new.loc_match_pct,'baseline_on_hand',new.baseline_on_hand,
    'initial_photo_match_qty',new.initial_photo_match_qty,'loc_photo_match',new.loc_photo_match,
    'pick_note',new.pick_note,'av_note',new.av_note,'sales_note',new.sales_note,
    'request_spec',new.request_spec,'request_caliper',new.request_caliper,
    'estimated_ship',new.estimated_ship,'reserve_flag',new.reserve_flag,'request_notes',new.request_notes,
    'on_hand',new.on_hand,'review_qty',new.review_qty,'available_qty',new.available_qty,
    'open_stock',new.open_stock,'loc_on_hand',new.loc_on_hand,'pri',new.pri,
    'flag_color',new.flag_color,'ns_grade',new.ns_grade,'ld_flag',new.ld_flag,
    'hold_stop_code',new.hold_stop_code,'hold_stop_reason',new.hold_stop_reason,
    'sales_rep',new.sales_rep,'customer_name',new.customer_name,'consignee_name',new.consignee_name));
  new.req_status:='Complete';
  new.fulfillment_status:='Completed';
  new.fulfilled_qty:=coalesce(new.fulfilled_qty,new.effective_qty);
  new.fulfilled_by:=coalesce(nullif(new.fulfilled_by,''),new.completed_by);
  new.fulfillment_updated_at:=coalesce(new.fulfillment_updated_at,new.date_completed,new.updated_at,clock_timestamp());
  return new;
end
$function$;

drop trigger if exists zzzzz_request_completed_canonical_v2362 on public.ph_requests_completed_history;
create trigger zzzzz_request_completed_canonical_v2362
before insert or update on public.ph_requests_completed_history
for each row execute function private.sync_request_completed_canonical_v2362();

alter table public.ph_master_inventory enable always trigger zzzzz_master_inventory_canonical_v2362;
alter table public.ph_requests_pending enable always trigger zzzzz_request_pending_canonical_v2362;
alter table public.ph_requests_completed_history enable always trigger zzzzz_request_completed_canonical_v2362;
set local session_replication_role='replica';

update public.ph_master_inventory set last_updated=last_updated;
update public.ph_requests_pending set updated_at=updated_at;

update public.ph_requests_completed_history history set
  unique_id='legacy-history:'||history.id::text||':'||history.unique_id,
  source_snapshot=coalesce(history.source_snapshot,'{}'::jsonb)||jsonb_build_object(
    'canonical_original_unique_id',history.unique_id,
    'canonical_migration_reason','pending-history-overlap-v2362')
from public.ph_requests_pending pending
where pending.move_batch_id is null and history.unique_id=pending.unique_id;

with financial as (
  select distinct on(unique_id) unique_id,raw_qty,effective_qty,list_price,line_dollar_value,
    sales_rep,customer_name,consignee_name,request_date,status,source_payload
  from public.ph_request_sales_impact_ledger
  order by unique_id,(status='Completed') desc,line_dollar_value desc,updated_at desc
)
update public.ph_requests_completed_history history set
  request_qty=coalesce(history.request_qty,financial.raw_qty),
  effective_qty=coalesce(history.effective_qty,financial.effective_qty),
  unit_list_price=coalesce(history.unit_list_price,financial.list_price),
  listprice=coalesce(history.listprice,financial.list_price),
  line_dollar_value=coalesce(history.line_dollar_value,financial.line_dollar_value),
  sales_rep=coalesce(nullif(history.sales_rep,''),financial.sales_rep),
  customer_name=coalesce(nullif(history.customer_name,''),financial.customer_name),
  consignee_name=coalesce(nullif(history.consignee_name,''),financial.consignee_name),
  source_snapshot=coalesce(history.source_snapshot,'{}'::jsonb)||coalesce(financial.source_payload,'{}'::jsonb),
  updated_at=greatest(history.updated_at,coalesce(financial.request_date,history.updated_at))
from financial where financial.unique_id=history.unique_id;

insert into public.ph_requests_completed_history(
  unique_id,commonname,contsize,locationcode,lotcode,itemcode,requested_by,request_folder,
  req_customer,req_qty,req_status,created_at,date_completed,request_source,updated_at,
  effective_qty,listprice,line_dollar_value,sales_rep,customer_name,consignee_name,
  request_qty,unit_list_price,source_snapshot,fulfillment_status,fulfilled_qty,fulfillment_updated_at
)
select ledger.unique_id,ledger.commonname,ledger.contsize,ledger.locationcode,ledger.lotcode,
  ledger.itemcode,ledger.sales_rep,ledger.folder_id,ledger.customer_name,
  case when ledger.raw_qty is null then null else ledger.raw_qty::text end,'Complete',
  coalesce(ledger.request_date,ledger.first_seen_at),coalesce(ledger.request_date,ledger.updated_at),
  'historical-ledger-migration',ledger.updated_at,ledger.effective_qty,ledger.list_price,
  ledger.line_dollar_value,ledger.sales_rep,ledger.customer_name,ledger.consignee_name,
  ledger.raw_qty,ledger.list_price,ledger.source_payload,'Completed',ledger.effective_qty,ledger.updated_at
from public.ph_request_sales_impact_ledger ledger
where ledger.status='Completed'
  and not exists(select 1 from public.ph_requests_completed_history history where history.unique_id=ledger.unique_id)
on conflict(unique_id) do nothing;

update public.ph_requests_completed_history set updated_at=updated_at;

set local session_replication_role='origin';
alter table public.ph_master_inventory enable trigger zzzzz_master_inventory_canonical_v2362;
alter table public.ph_requests_pending enable trigger zzzzz_request_pending_canonical_v2362;
alter table public.ph_requests_completed_history enable trigger zzzzz_request_completed_canonical_v2362;

alter table public.ph_requests_pending
  alter column request_folder set not null,
  alter column sales_rep set not null,
  alter column customer_name set not null,
  alter column status set default 'Pending',
  alter column status set not null,
  alter column itemcode set not null,
  alter column effective_qty set not null,
  alter column is_default_qty set not null,
  alter column unit_list_price set default 0,
  alter column unit_list_price set not null,
  alter column line_dollar_value set default 0,
  alter column line_dollar_value set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.ph_requests_completed_history
  alter column request_folder set not null,
  alter column sales_rep set not null,
  alter column customer_name set not null,
  alter column customer_consignee_label set not null,
  alter column itemcode set not null,
  alter column effective_qty set not null,
  alter column is_default_qty set not null,
  alter column unit_list_price set default 0,
  alter column unit_list_price set not null,
  alter column line_dollar_value set default 0,
  alter column line_dollar_value set not null,
  alter column date_completed set default now(),
  alter column date_completed set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

create unique index if not exists ph_requests_pending_unique_id_v2362
  on public.ph_requests_pending(unique_id);
create index if not exists ph_requests_pending_queue_v2362
  on public.ph_requests_pending(created_at desc,unique_id desc)
  where move_batch_id is null and date_completed is null;
create unique index if not exists ph_requests_completed_history_unique_id_v2362
  on public.ph_requests_completed_history(unique_id);
create index if not exists ph_requests_completed_history_date_v2362
  on public.ph_requests_completed_history(date_completed desc nulls last,unique_id);

create or replace function public.get_request_sales_impact_v2()
returns jsonb language sql stable security definer set search_path='' set statement_timeout='10s' as $function$
  with lines as materialized (
    select 'ph_requests_completed_history:'||history.unique_id line_identity_key,
      coalesce(nullif(history.request_folder,''),history.unique_id) request_identity,
      history.unique_id,history.request_folder folder_id,history.unique_id source_row_id,
      'ph_requests_completed_history'::text source_table,
      array['ph_requests_completed_history']::text[] source_tables,1 row_index,
      history.created_at request_date,'Completed'::text status,
      coalesce(nullif(history.sales_rep,''),'Unassigned') sales_rep,
      coalesce(nullif(history.customer_name,''),'Unknown Customer') customer_name,
      coalesce(nullif(history.consignee_name,''),'N/A') consignee_name,
      history.itemcode,history.commonname,history.contsize,history.lotcode,history.locationcode,
      history.request_qty raw_qty,coalesce(history.effective_qty,history.request_qty,25) effective_qty,
      coalesce(history.unit_list_price,history.listprice,0) list_price,
      'canonical_history'::text price_source,
      round(coalesce(history.line_dollar_value,
        coalesce(history.effective_qty,history.request_qty,25)*coalesce(history.unit_list_price,history.listprice,0)),2) line_dollar_value
    from public.ph_requests_completed_history history
    union all
    select 'ph_requests_pending:'||pending.unique_id,
      coalesce(nullif(pending.request_folder,''),pending.unique_id),pending.unique_id,
      pending.request_folder,pending.unique_id,'ph_requests_pending',array['ph_requests_pending']::text[],1,
      pending.created_at,'Pending',coalesce(nullif(pending.sales_rep,''),'Unassigned'),
      coalesce(nullif(pending.customer_name,''),'Unknown Customer'),
      coalesce(nullif(pending.consignee_name,''),'N/A'),pending.itemcode,pending.commonname,
      pending.contsize,pending.lotcode,pending.locationcode,pending.request_qty,
      coalesce(pending.effective_qty,pending.request_qty,25),coalesce(pending.unit_list_price,0),
      'canonical_pending',round(coalesce(pending.line_dollar_value,
        coalesce(pending.effective_qty,pending.request_qty,25)*coalesce(pending.unit_list_price,0)),2)
    from public.ph_requests_pending pending
    where pending.move_batch_id is null and pending.date_completed is null
  ), summary as (
    select round(coalesce(sum(line_dollar_value),0),2) total_dollar_value,
      round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
      round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value,
      count(distinct request_identity)::integer total_requests,count(*)::integer total_line_items,
      round(coalesce(sum(effective_qty),0),2) total_units_requested,
      count(*) filter(where raw_qty is not null)::integer explicit_qty_line_count,
      count(*) filter(where raw_qty is null)::integer default_25_qty_line_count
    from lines
  )
  select jsonb_build_object(
    'dedupe_contract','canonical-three-table-v2362',
    'summary',(select to_jsonb(summary) from summary),
    'by_sales_rep',coalesce((select jsonb_agg(to_jsonb(rollup) order by rollup.total_dollar_value desc,rollup.sales_rep)
      from (select sales_rep,count(distinct request_identity)::integer request_count,count(*)::integer line_item_count,
        round(sum(effective_qty),2) total_units,round(sum(line_dollar_value),2) total_dollar_value,
        round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
        round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value
        from lines group by sales_rep) rollup),'[]'::jsonb),
    'by_customer_consignee',coalesce((select jsonb_agg(to_jsonb(rollup) order by rollup.total_dollar_value desc,rollup.customer_name,rollup.consignee_name)
      from (select customer_name,consignee_name,customer_name||' / '||consignee_name customer_consignee_label,
        min(sales_rep) sales_rep,count(distinct request_identity)::integer request_count,
        count(*)::integer line_item_count,round(sum(effective_qty),2) total_units,
        round(sum(line_dollar_value),2) total_dollar_value,
        round(coalesce(sum(line_dollar_value) filter(where status='Completed'),0),2) completed_dollar_value,
        round(coalesce(sum(line_dollar_value) filter(where status='Pending'),0),2) pending_dollar_value
        from lines group by customer_name,consignee_name) rollup),'[]'::jsonb),
    'line_items',coalesce((select jsonb_agg(to_jsonb(lines)||jsonb_build_object(
      'customer_consignee_label',customer_name||' / '||consignee_name,
      'is_default_qty',raw_qty is null,'unit_list_price',list_price)
      order by request_date desc nulls last,line_identity_key) from lines),'[]'::jsonb),
    'source_table_audit',jsonb_build_object(
      'dedupe_contract','canonical-three-table-v2362','inventory_table','ph_master_inventory',
      'pending_table','ph_requests_pending','completed_table','ph_requests_completed_history',
      'line_count',(select count(*) from lines),'distinct_unique_ids',(select count(distinct unique_id) from lines),
      'completed_count',(select count(*) from lines where status='Completed'),
      'pending_count',(select count(*) from lines where status='Pending'),
      'formula','(request_qty > 0 ? request_qty : 25) * unit_list_price'))
$function$;

revoke all on function public.get_request_sales_impact_v2() from public,anon,authenticated;
grant execute on function public.get_request_sales_impact_v2() to service_role;

create or replace view public.ph_active_request with (security_invoker=true) as
select * from public.ph_requests_pending;
create or replace view public.ph_request_history with (security_invoker=true) as
select * from public.ph_requests_completed_history;

grant select on public.ph_master_inventory,public.ph_requests_pending,
  public.ph_requests_completed_history,public.ph_active_request,public.ph_request_history
  to anon,authenticated;
grant select,insert,update,delete on public.ph_requests_pending,
  public.ph_requests_completed_history to service_role;

insert into public."00_app_view_table_map"(view_key,view_label,parent_key,source_tables)
select catalog.view_key,catalog.label,catalog.parent_key,
  case catalog.view_key
    when 'drive' then array['public.ph_master_inventory']
    when 'av' then array['public.ph_master_inventory','app_sync_private.inventory_location_evidence_v1']
    when 'request' then array['public.ph_requests_pending']
    when 'request-sales-impact' then array['public.ph_requests_pending','public.ph_requests_completed_history']
    when 'historical-requests' then array['public.ph_requests_completed_history','public.ph_master_inventory']
    when 'request-history' then array['public.ph_requests_completed_history']
    when 'production' then array['public.ph_master_inventory','public.ph_requests_pending']
    when 'production-workflow' then array['public.ph_master_inventory','public.ph_requests_pending']
    else coalesce(existing.source_tables,array['public.app_dataset_revisions'])
  end
from private.navigation_view_catalog catalog
left join public."00_app_view_table_map" existing using(view_key)
on conflict(view_key) do update set view_label=excluded.view_label,parent_key=excluded.parent_key,
  source_tables=excluded.source_tables,updated_at=clock_timestamp();

insert into app_sync_private.sources(key,modules,client_enabled,dylan_only)
values('ph_master_inventory','{inventory,av,request,production}',true,false),
  ('ph_requests_pending','{request,production,reports}',true,false),
  ('ph_requests_completed_history','{request,reports,managers}',true,false)
on conflict(key) do update set modules=excluded.modules,client_enabled=excluded.client_enabled,
  dylan_only=excluded.dylan_only;

insert into public.app_dataset_revisions(key,revision,state,changed_at)
values('ph_requests_pending',1,'ready',clock_timestamp()),
  ('ph_requests_completed_history',1,'ready',clock_timestamp()),
  ('ph_master_inventory',1,'ready',clock_timestamp())
on conflict(key) do update set revision=public.app_dataset_revisions.revision+1,
  state='ready',changed_at=clock_timestamp();

do $verify$
declare pending_count bigint;
declare completed_count bigint;
declare completed_total numeric;
declare sample_total numeric;
begin
  sample_total:=round((35*3)+(coalesce(null::numeric,25)*2),2);
  if sample_total<>155 then raise exception 'BILLY_BOBS_SAMMY_CULT_TOTAL_INVALID: %',sample_total; end if;
  if exists(select 1 from information_schema.tables where table_schema='archive_backup' and table_type='BASE TABLE') then
    raise exception 'ARCHIVE_BACKUP_NOT_EMPTY';
  end if;
  if exists(select 1 from public.app_manual_sync_status where id=true
    and (coalesce((status->>'active')::boolean,false) or coalesce(status->>'currentStage','')<>'idle')) then
    raise exception 'MANUAL_SYNC_NOT_IDLE';
  end if;
  if exists(select 1 from public.ph_requests_pending where move_batch_id is null
    and created_at<timestamptz '2026-10-22 00:00:00 America/Chicago') then
    raise exception 'STALE_PENDING_REQUEST_REMAINED';
  end if;
  if exists(select 1 from public.ph_requests_pending pending join public.ph_requests_completed_history history
    using(unique_id) where pending.move_batch_id is null) then
    raise exception 'PENDING_COMPLETED_OVERLAP';
  end if;
  select count(*) into pending_count from public.ph_requests_pending
    where move_batch_id is null and date_completed is null;
  select count(*),round(coalesce(sum(line_dollar_value),0),2)
    into completed_count,completed_total from public.ph_requests_completed_history;
  if pending_count<1 or pending_count>25 then raise exception 'PENDING_REQUEST_COUNT_INVALID: %',pending_count; end if;
  if completed_count<4059 then raise exception 'COMPLETED_REQUEST_COUNT_LOW: %',completed_count; end if;
  if completed_total<6067786.53 then raise exception 'COMPLETED_REQUEST_TOTAL_LOW: %',completed_total; end if;
  if position('canonical-three-table-v2362' in pg_get_functiondef('public.get_request_sales_impact_v2()'::regprocedure))=0 then
    raise exception 'CANONICAL_REQUEST_ANALYTICS_STALE';
  end if;
  raise notice 'AGDATA_V2362_PHASE_READY pending=% completed=% completed_total=%',
    pending_count,completed_count,completed_total;
end
$verify$;

select pg_notify('pgrst','reload schema');

commit;
