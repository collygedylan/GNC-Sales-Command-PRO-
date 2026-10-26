begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

alter table public.ph_orders_history
  add column if not exists row_state_hash text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists first_file_id text,
  add column if not exists last_file_id text,
  add column if not exists first_file_name text,
  add column if not exists last_file_name text,
  add column if not exists seen_count integer not null default 1;

alter table public.ph_reserves_history
  add column if not exists row_state_hash text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists first_file_id text,
  add column if not exists last_file_id text,
  add column if not exists first_file_name text,
  add column if not exists last_file_name text,
  add column if not exists seen_count integer not null default 1;

alter table public.ph_drive_mode_history
  add column if not exists review numeric,
  add column if not exists available numeric,
  add column if not exists open_stock numeric,
  add column if not exists pri text,
  add column if not exists unit_list_price numeric,
  add column if not exists row_state_hash text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists first_file_id text,
  add column if not exists last_file_id text,
  add column if not exists first_file_name text,
  add column if not exists last_file_name text,
  add column if not exists seen_count integer not null default 1;

alter table public.ph_drive_around_report_rows
  add column if not exists row_state_hash text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists first_file_id text,
  add column if not exists last_file_id text,
  add column if not exists first_file_name text,
  add column if not exists last_file_name text,
  add column if not exists last_report_date date,
  add column if not exists seen_count integer not null default 1;

alter table public.ph_orders_history
  drop constraint if exists ph_orders_history_seen_count_v2366;
alter table public.ph_orders_history
  add constraint ph_orders_history_seen_count_v2366 check(seen_count>=1) not valid;
alter table public.ph_reserves_history
  drop constraint if exists ph_reserves_history_seen_count_v2366;
alter table public.ph_reserves_history
  add constraint ph_reserves_history_seen_count_v2366 check(seen_count>=1) not valid;
alter table public.ph_drive_mode_history
  drop constraint if exists ph_drive_mode_history_seen_count_v2366;
alter table public.ph_drive_mode_history
  add constraint ph_drive_mode_history_seen_count_v2366 check(seen_count>=1) not valid;
alter table public.ph_drive_around_report_rows
  drop constraint if exists ph_drive_around_report_rows_seen_count_v2366;
alter table public.ph_drive_around_report_rows
  add constraint ph_drive_around_report_rows_seen_count_v2366 check(seen_count>=1) not valid;

create or replace function private.orders_history_state_hash_v2366(p_row public.ph_orders_history)
returns text
language sql
immutable
set search_path=''
as $function$
  select md5(concat_ws('|',
    lower(btrim(coalesce(p_row.itemcode,''))),lower(btrim(coalesce(p_row.locationcode,''))),
    lower(btrim(coalesce(p_row.lotcode,''))),lower(btrim(coalesce(p_row.customer_name,''))),
    lower(btrim(coalesce(p_row.consignee_name,''))),lower(btrim(coalesce(p_row.sales_rep,''))),
    lower(btrim(coalesce(p_row.order_number,''))),lower(btrim(coalesce(p_row.tripnumber,''))),
    lower(btrim(coalesce(p_row.dock_num,''))),lower(btrim(coalesce(p_row.drop_num,''))),
    lower(btrim(coalesce(p_row.planstart,''))),coalesce(p_row.qty_ordered::text,'0'),
    coalesce(p_row.unit_list_price::text,'0'),lower(btrim(coalesce(p_row.checker,''))),
    lower(btrim(coalesce(p_row.inspector,''))),lower(btrim(coalesce(p_row.mistake,''))),
    lower(btrim(coalesce(p_row.dock_status,''))),lower(btrim(coalesce(p_row.item_check_status,''))),
    lower(btrim(coalesce(p_row.issue_status,''))),lower(btrim(coalesce(p_row.issue_note,''))),
    lower(btrim(coalesce(p_row.spec,''))),lower(btrim(coalesce(p_row.caliper,''))),
    lower(btrim(coalesce(p_row.av_note,''))),lower(btrim(coalesce(p_row.pick_note,''))),
    lower(btrim(coalesce(p_row.sales_note,''))),coalesce(p_row.photo_url,'')))
$function$;

create or replace function private.reserves_history_state_hash_v2366(p_row public.ph_reserves_history)
returns text
language sql
immutable
set search_path=''
as $function$
  select md5(concat_ws('|',
    lower(btrim(coalesce(p_row.itemcode,''))),lower(btrim(coalesce(p_row.locationcode,''))),
    lower(btrim(coalesce(p_row.lotcode,''))),lower(btrim(coalesce(p_row.customer_name,''))),
    lower(btrim(coalesce(p_row.consignee_name,''))),lower(btrim(coalesce(p_row.sales_rep,''))),
    lower(btrim(coalesce(p_row.order_number,''))),coalesce(p_row.qty_reserved::text,'0'),
    coalesce(p_row.unit_list_price::text,'0'),lower(btrim(coalesce(p_row.hold_stop_code,''))),
    lower(btrim(coalesce(p_row.hold_stop_reason,''))),lower(btrim(coalesce(p_row.spec,''))),
    lower(btrim(coalesce(p_row.caliper,''))),lower(btrim(coalesce(p_row.av_note,''))),
    lower(btrim(coalesce(p_row.pick_note,''))),lower(btrim(coalesce(p_row.sales_note,''))),
    coalesce(p_row.photo_url,'')))
$function$;

create or replace function private.drive_mode_history_state_hash_v2366(p_row public.ph_drive_mode_history)
returns text
language sql
immutable
set search_path=''
as $function$
  select md5(concat_ws('|',
    lower(btrim(coalesce(p_row.itemcode,''))),lower(btrim(coalesce(p_row.commonname,''))),
    lower(btrim(coalesce(p_row.contsize,''))),lower(btrim(coalesce(p_row.locationcode,''))),
    lower(btrim(coalesce(p_row.lotcode,''))),coalesce(p_row.on_hand::text,'0'),
    coalesce(p_row.review::text,'0'),coalesce(p_row.available::text,p_row.ptravailable::text,'0'),
    coalesce(p_row.open_stock::text,'0'),coalesce(p_row.loc_photo_match::text,'0'),
    lower(btrim(coalesce(p_row.pri,''))),lower(btrim(coalesce(p_row.hold_stop_code,''))),
    lower(btrim(coalesce(p_row.hold_stop_reason,''))),coalesce(p_row.unit_list_price::text,'0'),
    lower(btrim(coalesce(p_row.spec,''))),lower(btrim(coalesce(p_row.caliper,''))),
    lower(btrim(coalesce(p_row.av_note,''))),lower(btrim(coalesce(p_row.pick_note,''))),
    lower(btrim(coalesce(p_row.sales_note,''))),coalesce(p_row.photo_url,'')))
$function$;

create or replace function private.drive_around_report_state_hash_v2366(p_row public.ph_drive_around_report_rows)
returns text
language sql
immutable
set search_path=''
as $function$
  select md5(concat_ws('|',
    lower(btrim(coalesce(p_row.itemcode,''))),lower(btrim(coalesce(p_row.commonname,''))),
    lower(btrim(coalesce(p_row.contsize,''))),lower(btrim(coalesce(p_row.locationcode,''))),
    lower(btrim(coalesce(p_row.lotcode,''))),
    coalesce(private.archive_numeric_v2366(p_row.ptronhand)::text,'0'),
    coalesce(private.archive_numeric_v2366(p_row.ptrreviewed)::text,'0'),coalesce(p_row.ptravailable::text,'0'),
    coalesce(private.archive_numeric_v2366(p_row.s_lts)::text,'0'),'0',
    lower(btrim(coalesce(p_row.priority,''))),lower(btrim(coalesce(p_row.holdstopcode,''))),
    lower(btrim(coalesce(p_row.holdstopreason,''))),
    coalesce(private.archive_numeric_v2366(p_row.listprice)::text,'0'),
    lower(btrim(coalesce(p_row.itemspec,''))),'',lower(btrim(coalesce(p_row.locationnote,''))),'',
    lower(btrim(coalesce(p_row.salesnote,''))),''))
$function$;

revoke all on function private.orders_history_state_hash_v2366(public.ph_orders_history) from public,anon,authenticated,service_role;
revoke all on function private.reserves_history_state_hash_v2366(public.ph_reserves_history) from public,anon,authenticated,service_role;
revoke all on function private.drive_mode_history_state_hash_v2366(public.ph_drive_mode_history) from public,anon,authenticated,service_role;
revoke all on function private.drive_around_report_state_hash_v2366(public.ph_drive_around_report_rows) from public,anon,authenticated,service_role;

create table if not exists private.archive_state_dedup_audit_v2366 (
  run_id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null,
  orders_before bigint,
  orders_after bigint,
  reserves_before bigint,
  reserves_after bigint,
  drive_history_before bigint,
  drive_history_after bigint,
  raw_result jsonb not null default '{}'::jsonb
);

revoke all on private.archive_state_dedup_audit_v2366 from public,anon,authenticated,service_role;

create or replace function private.compact_history_states_v2366()
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='20s'
as $function$
declare
  chicago_time time:=clock_timestamp() at time zone 'America/Chicago';
  audit_id uuid;
  v_orders_before bigint;
  v_orders_after bigint;
  v_reserves_before bigint;
  v_reserves_after bigint;
  v_drive_before bigint;
  v_drive_after bigint;
begin
  if not (chicago_time>=time '23:30' or chicago_time<time '06:15') then
    return jsonb_build_object('status','paused_outside_historical_window','chicagoTime',chicago_time);
  end if;
  if not exists(select 1 from public.ph_orders_history where row_state_hash is null)
     and not exists(select 1 from public.ph_reserves_history where row_state_hash is null)
     and not exists(select 1 from public.ph_drive_mode_history where row_state_hash is null) then
    return jsonb_build_object('status','up_to_date');
  end if;

  insert into private.archive_state_dedup_audit_v2366(status)
  values('running') returning run_id into audit_id;
  select count(*) into v_orders_before from public.ph_orders_history;
  select count(*) into v_reserves_before from public.ph_reserves_history;
  select count(*) into v_drive_before from public.ph_drive_mode_history;
  perform set_config('agdata.archive_dedup','on',true);

  update public.ph_orders_history set row_state_hash=null where row_state_hash is not null;
  create temporary table orders_state_work_v2366 on commit drop as
  select lower(btrim(itemcode)) itemcode_key,private.orders_history_state_hash_v2366(row_value) row_state_hash,
    (array_agg(order_line_key order by coalesce(first_seen_at,archived_at),order_line_key))[1] canonical_key,
    min(coalesce(first_seen_at,archived_at)) first_seen_at,max(coalesce(last_seen_at,updated_at,archived_at)) last_seen_at,
    (array_agg(coalesce(first_file_id,source_file_id) order by coalesce(first_seen_at,archived_at),order_line_key))[1] first_file_id,
    (array_agg(coalesce(last_file_id,source_file_id) order by coalesce(last_seen_at,updated_at,archived_at) desc,order_line_key desc))[1] last_file_id,
    (array_agg(coalesce(first_file_name,source_file_name) order by coalesce(first_seen_at,archived_at),order_line_key))[1] first_file_name,
    (array_agg(coalesce(last_file_name,source_file_name) order by coalesce(last_seen_at,updated_at,archived_at) desc,order_line_key desc))[1] last_file_name,
    sum(greatest(seen_count,1))::integer seen_count
  from public.ph_orders_history row_value group by lower(btrim(itemcode)),private.orders_history_state_hash_v2366(row_value);
  delete from public.ph_orders_history target using orders_state_work_v2366 work
  where lower(btrim(target.itemcode))=work.itemcode_key
    and private.orders_history_state_hash_v2366(target)=work.row_state_hash
    and target.order_line_key<>work.canonical_key;
  update public.ph_orders_history target set row_state_hash=work.row_state_hash,first_seen_at=work.first_seen_at,
    last_seen_at=work.last_seen_at,first_file_id=work.first_file_id,last_file_id=work.last_file_id,
    first_file_name=work.first_file_name,last_file_name=work.last_file_name,seen_count=work.seen_count,
    updated_at=greatest(target.updated_at,work.last_seen_at)
  from orders_state_work_v2366 work where target.order_line_key=work.canonical_key;

  update public.ph_reserves_history set row_state_hash=null where row_state_hash is not null;
  create temporary table reserves_state_work_v2366 on commit drop as
  select lower(btrim(itemcode)) itemcode_key,private.reserves_history_state_hash_v2366(row_value) row_state_hash,
    (array_agg(reserve_history_key order by coalesce(first_seen_at,archived_at),reserve_history_key))[1] canonical_key,
    min(coalesce(first_seen_at,archived_at)) first_seen_at,max(coalesce(last_seen_at,updated_at,archived_at)) last_seen_at,
    (array_agg(coalesce(first_file_id,source_file_id) order by coalesce(first_seen_at,archived_at),reserve_history_key))[1] first_file_id,
    (array_agg(coalesce(last_file_id,source_file_id) order by coalesce(last_seen_at,updated_at,archived_at) desc,reserve_history_key desc))[1] last_file_id,
    (array_agg(coalesce(first_file_name,source_file_name) order by coalesce(first_seen_at,archived_at),reserve_history_key))[1] first_file_name,
    (array_agg(coalesce(last_file_name,source_file_name) order by coalesce(last_seen_at,updated_at,archived_at) desc,reserve_history_key desc))[1] last_file_name,
    sum(greatest(seen_count,1))::integer seen_count
  from public.ph_reserves_history row_value group by lower(btrim(itemcode)),private.reserves_history_state_hash_v2366(row_value);
  delete from public.ph_reserves_history target using reserves_state_work_v2366 work
  where lower(btrim(target.itemcode))=work.itemcode_key
    and private.reserves_history_state_hash_v2366(target)=work.row_state_hash
    and target.reserve_history_key<>work.canonical_key;
  update public.ph_reserves_history target set row_state_hash=work.row_state_hash,first_seen_at=work.first_seen_at,
    last_seen_at=work.last_seen_at,first_file_id=work.first_file_id,last_file_id=work.last_file_id,
    first_file_name=work.first_file_name,last_file_name=work.last_file_name,seen_count=work.seen_count,
    updated_at=greatest(target.updated_at,work.last_seen_at)
  from reserves_state_work_v2366 work where target.reserve_history_key=work.canonical_key;

  update public.ph_drive_mode_history set row_state_hash=null where row_state_hash is not null;
  create temporary table drive_history_state_work_v2366 on commit drop as
  select lower(btrim(coalesce(itemcode,''))) itemcode_key,private.drive_mode_history_state_hash_v2366(row_value) row_state_hash,
    (array_agg(history_key order by coalesce(first_seen_at,archived_at),history_key))[1] canonical_key,
    min(coalesce(first_seen_at,archived_at)) first_seen_at,max(coalesce(last_seen_at,updated_at,archived_at)) last_seen_at,
    (array_agg(coalesce(first_file_id,source_file_id) order by coalesce(first_seen_at,archived_at),history_key))[1] first_file_id,
    (array_agg(coalesce(last_file_id,source_file_id) order by coalesce(last_seen_at,updated_at,archived_at) desc,history_key desc))[1] last_file_id,
    (array_agg(coalesce(first_file_name,source_file_name) order by coalesce(first_seen_at,archived_at),history_key))[1] first_file_name,
    (array_agg(coalesce(last_file_name,source_file_name) order by coalesce(last_seen_at,updated_at,archived_at) desc,history_key desc))[1] last_file_name,
    sum(greatest(seen_count,1))::integer seen_count
  from public.ph_drive_mode_history row_value group by lower(btrim(coalesce(itemcode,''))),private.drive_mode_history_state_hash_v2366(row_value);
  delete from public.ph_drive_mode_history target using drive_history_state_work_v2366 work
  where lower(btrim(coalesce(target.itemcode,'')))=work.itemcode_key
    and private.drive_mode_history_state_hash_v2366(target)=work.row_state_hash
    and target.history_key<>work.canonical_key;
  update public.ph_drive_mode_history target set row_state_hash=work.row_state_hash,first_seen_at=work.first_seen_at,
    last_seen_at=work.last_seen_at,first_file_id=work.first_file_id,last_file_id=work.last_file_id,
    first_file_name=work.first_file_name,last_file_name=work.last_file_name,seen_count=work.seen_count,
    available=coalesce(target.available,target.ptravailable),updated_at=greatest(target.updated_at,work.last_seen_at)
  from drive_history_state_work_v2366 work where target.history_key=work.canonical_key;

  select count(*) into v_orders_after from public.ph_orders_history;
  select count(*) into v_reserves_after from public.ph_reserves_history;
  select count(*) into v_drive_after from public.ph_drive_mode_history;
  update private.archive_state_dedup_audit_v2366 set completed_at=clock_timestamp(),status='complete',
    orders_before=v_orders_before,orders_after=v_orders_after,
    reserves_before=v_reserves_before,reserves_after=v_reserves_after,
    drive_history_before=v_drive_before,drive_history_after=v_drive_after
  where run_id=audit_id;
  return jsonb_build_object('status','complete','ordersBefore',v_orders_before,'ordersAfter',v_orders_after,
    'reservesBefore',v_reserves_before,'reservesAfter',v_reserves_after,'driveHistoryBefore',v_drive_before,
    'driveHistoryAfter',v_drive_after,'duplicateRowsAfter',0);
exception when others then
  if audit_id is not null then
    update private.archive_state_dedup_audit_v2366 set completed_at=clock_timestamp(),status='failed',
      raw_result=jsonb_build_object('sqlstate',sqlstate) where run_id=audit_id;
  end if;
  raise;
end
$function$;

revoke all on function private.compact_history_states_v2366() from public,anon,authenticated,service_role;

create unique index if not exists ph_orders_history_item_state_v2366
  on public.ph_orders_history(itemcode,row_state_hash) where row_state_hash is not null;
create unique index if not exists ph_reserves_history_item_state_v2366
  on public.ph_reserves_history(itemcode,row_state_hash) where row_state_hash is not null;
create unique index if not exists ph_drive_mode_history_item_state_v2366
  on public.ph_drive_mode_history(itemcode,row_state_hash) where row_state_hash is not null;

create or replace function private.merge_compact_history_state_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  existing_key text;
  incoming_file_id text;
  incoming_file_name text;
  incoming_seen_at timestamptz;
begin
  if current_setting('agdata.archive_dedup',true)='on' then return new; end if;
  incoming_file_id:=coalesce(new.source_file_id,new.source_unique_id);
  incoming_file_name:=coalesce(new.source_file_name,incoming_file_id);
  incoming_seen_at:=coalesce(new.archived_at,new.updated_at,clock_timestamp());
  new.first_seen_at:=coalesce(new.first_seen_at,incoming_seen_at);
  new.last_seen_at:=greatest(coalesce(new.last_seen_at,incoming_seen_at),incoming_seen_at);
  new.first_file_id:=coalesce(new.first_file_id,incoming_file_id);
  new.last_file_id:=coalesce(incoming_file_id,new.last_file_id);
  new.first_file_name:=coalesce(new.first_file_name,incoming_file_name);
  new.last_file_name:=coalesce(incoming_file_name,new.last_file_name);
  new.seen_count:=greatest(coalesce(new.seen_count,1),1);

  if tg_table_name='ph_orders_history' then
    new.row_state_hash:=private.orders_history_state_hash_v2366(new);
    select row.order_line_key into existing_key from public.ph_orders_history row
    where row.itemcode=new.itemcode and row.row_state_hash=new.row_state_hash
      and row.order_line_key<>new.order_line_key order by row.first_seen_at,row.order_line_key limit 1;
    if existing_key is not null then
      update public.ph_orders_history row set last_seen_at=greatest(row.last_seen_at,new.last_seen_at),
        last_file_id=coalesce(new.last_file_id,row.last_file_id),last_file_name=coalesce(new.last_file_name,row.last_file_name),
        seen_count=row.seen_count+case when coalesce(row.last_file_id,row.last_file_name,'')
          is distinct from coalesce(new.last_file_id,new.last_file_name,'') then new.seen_count else 0 end,
        updated_at=greatest(row.updated_at,new.updated_at) where row.order_line_key=existing_key;
    end if;
  elsif tg_table_name='ph_reserves_history' then
    new.row_state_hash:=private.reserves_history_state_hash_v2366(new);
    select row.reserve_history_key into existing_key from public.ph_reserves_history row
    where row.itemcode=new.itemcode and row.row_state_hash=new.row_state_hash
      and row.reserve_history_key<>new.reserve_history_key order by row.first_seen_at,row.reserve_history_key limit 1;
    if existing_key is not null then
      update public.ph_reserves_history row set last_seen_at=greatest(row.last_seen_at,new.last_seen_at),
        last_file_id=coalesce(new.last_file_id,row.last_file_id),last_file_name=coalesce(new.last_file_name,row.last_file_name),
        seen_count=row.seen_count+case when coalesce(row.last_file_id,row.last_file_name,'')
          is distinct from coalesce(new.last_file_id,new.last_file_name,'') then new.seen_count else 0 end,
        updated_at=greatest(row.updated_at,new.updated_at) where row.reserve_history_key=existing_key;
    end if;
  else
    new.available:=coalesce(new.available,new.ptravailable);
    new.row_state_hash:=private.drive_mode_history_state_hash_v2366(new);
    select row.history_key into existing_key from public.ph_drive_mode_history row
    where row.itemcode is not distinct from new.itemcode and row.row_state_hash=new.row_state_hash
      and row.history_key<>new.history_key order by row.first_seen_at,row.history_key limit 1;
    if existing_key is not null then
      update public.ph_drive_mode_history row set last_seen_at=greatest(row.last_seen_at,new.last_seen_at),
        last_file_id=coalesce(new.last_file_id,row.last_file_id),last_file_name=coalesce(new.last_file_name,row.last_file_name),
        seen_count=row.seen_count+case when coalesce(row.last_file_id,row.last_file_name,'')
          is distinct from coalesce(new.last_file_id,new.last_file_name,'') then new.seen_count else 0 end,
        updated_at=greatest(row.updated_at,new.updated_at) where row.history_key=existing_key;
    end if;
  end if;
  if existing_key is null then return new; end if;
  if tg_op='UPDATE' then return old; end if;
  return null;
end
$function$;

revoke all on function private.merge_compact_history_state_v2366() from public,anon,authenticated,service_role;

drop trigger if exists ph_orders_history_state_merge_v2366 on public.ph_orders_history;
create trigger ph_orders_history_state_merge_v2366 before insert or update on public.ph_orders_history
for each row execute function private.merge_compact_history_state_v2366();
drop trigger if exists ph_reserves_history_state_merge_v2366 on public.ph_reserves_history;
create trigger ph_reserves_history_state_merge_v2366 before insert or update on public.ph_reserves_history
for each row execute function private.merge_compact_history_state_v2366();
drop trigger if exists ph_drive_mode_history_state_merge_v2366 on public.ph_drive_mode_history;
create trigger ph_drive_mode_history_state_merge_v2366 before insert or update on public.ph_drive_mode_history
for each row execute function private.merge_compact_history_state_v2366();

create table if not exists private.ph_drive_around_row_states_v2366 (
  itemcode_key text not null,
  row_state_hash text not null,
  canonical_unique_id text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  first_file_id text,
  last_file_id text,
  first_file_name text,
  last_file_name text,
  first_report_date date,
  last_report_date date,
  seen_count bigint not null default 1 check(seen_count>=1),
  primary key(itemcode_key,row_state_hash)
);

revoke all on private.ph_drive_around_row_states_v2366 from public,anon,authenticated,service_role;

create or replace function private.merge_drive_around_report_state_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  item_key text:=lower(btrim(coalesce(new.itemcode,'')));
  canonical_id text;
  inserted_id text;
begin
  new.row_state_hash:=private.drive_around_report_state_hash_v2366(new);
  new.first_seen_at:=coalesce(new.first_seen_at,new.created_at,clock_timestamp());
  new.last_seen_at:=greatest(coalesce(new.last_seen_at,new.updated_at,new.created_at,clock_timestamp()),coalesce(new.updated_at,new.created_at,clock_timestamp()));
  new.first_file_id:=coalesce(new.first_file_id,new.file_id);
  new.last_file_id:=coalesce(new.file_id,new.last_file_id);
  new.first_file_name:=coalesce(new.first_file_name,new.file_name);
  new.last_file_name:=coalesce(new.file_name,new.last_file_name);
  new.last_report_date:=coalesce(new.last_report_date,new.report_date);
  new.seen_count:=greatest(coalesce(new.seen_count,1),1);
  perform pg_advisory_xact_lock(hashtextextended('drive-state:'||item_key||':'||new.row_state_hash,0));
  insert into private.ph_drive_around_row_states_v2366(itemcode_key,row_state_hash,canonical_unique_id,
    first_seen_at,last_seen_at,first_file_id,last_file_id,first_file_name,last_file_name,first_report_date,last_report_date,seen_count)
  values(item_key,new.row_state_hash,new.unique_id,new.first_seen_at,new.last_seen_at,new.first_file_id,new.last_file_id,
    new.first_file_name,new.last_file_name,new.report_date,new.last_report_date,new.seen_count)
  on conflict do nothing returning canonical_unique_id into inserted_id;
  if inserted_id is not null then return new; end if;

  update private.ph_drive_around_row_states_v2366 state set
    last_seen_at=greatest(state.last_seen_at,new.last_seen_at),last_file_id=new.last_file_id,last_file_name=new.last_file_name,
    last_report_date=greatest(state.last_report_date,new.last_report_date),
    seen_count=state.seen_count+case when coalesce(state.last_file_id,state.last_file_name,'')
      is distinct from coalesce(new.last_file_id,new.last_file_name,'') then new.seen_count else 0 end
  where state.itemcode_key=item_key and state.row_state_hash=new.row_state_hash
  returning state.canonical_unique_id into canonical_id;
  if canonical_id=new.unique_id then return new; end if;
  if not exists(select 1 from public.ph_drive_around_report_rows row where row.unique_id=canonical_id) then
    update private.ph_drive_around_row_states_v2366 set canonical_unique_id=new.unique_id
    where itemcode_key=item_key and row_state_hash=new.row_state_hash;
    return new;
  end if;
  update public.ph_drive_around_report_rows row set
    last_seen_at=state.last_seen_at,last_file_id=state.last_file_id,last_file_name=state.last_file_name,
    last_report_date=state.last_report_date,seen_count=state.seen_count,updated_at=greatest(row.updated_at,new.updated_at)
  from private.ph_drive_around_row_states_v2366 state
  where row.unique_id=canonical_id and state.itemcode_key=item_key and state.row_state_hash=new.row_state_hash;
  return null;
end
$function$;

revoke all on function private.merge_drive_around_report_state_v2366() from public,anon,authenticated,service_role;
drop trigger if exists ph_drive_around_report_state_merge_v2366 on public.ph_drive_around_report_rows;
create trigger ph_drive_around_report_state_merge_v2366 before insert on public.ph_drive_around_report_rows
for each row execute function private.merge_drive_around_report_state_v2366();

create or replace function private.reject_historical_archive_delete_v2366()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if current_setting('agdata.archive_dedup',true)='on' and session_user in ('postgres','supabase_admin') then
    return old;
  end if;
  raise exception using errcode='42501',message='HISTORICAL_ARCHIVE_RETENTION_PROTECTED';
end
$function$;

revoke all on function private.reject_historical_archive_delete_v2366() from public,anon,authenticated,service_role;

create or replace function public.deduplicate_drive_around_report_rows_batch_v1(p_max_files integer default 25)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='4500ms'
as $function$
declare
  chicago_time time:=clock_timestamp() at time zone 'America/Chicago';
  started_at timestamptz:=clock_timestamp();
  selected_files integer:=0;
  rows_before bigint:=0;
  rows_after bigint:=0;
  states_merged bigint:=0;
  result_value jsonb;
begin
  if p_max_files is null or p_max_files<1 or p_max_files>25 then
    raise exception using errcode='22023',message='DRIVE_HISTORY_DEDUP_BATCH_INVALID';
  end if;
  if not (chicago_time>=time '23:30' or chicago_time<time '06:15') then
    return jsonb_build_object('status','paused_outside_historical_window','processedFiles',0,'durationMs',0);
  end if;
  create temporary table selected_drive_files_v2366(file_id text primary key) on commit drop;
  insert into selected_drive_files_v2366(file_id)
  with candidates as (
    select file.file_id,greatest(coalesce(file.row_count,1),1) row_count,
      row_number() over(order by file.report_date desc nulls last,file.file_id) ordinal
    from public.ph_drive_mode_history_files file
    where exists(select 1 from public.ph_drive_around_report_rows row
      where row.file_id=file.file_id and row.row_state_hash is null limit 1)
    order by file.report_date desc nulls last,file.file_id limit p_max_files
  ), bounded as (
    select *,sum(row_count) over(order by ordinal) running_rows from candidates
  )
  select file_id from bounded where running_rows<=50000 or ordinal=1;
  get diagnostics selected_files=row_count;
  if selected_files=0 then return jsonb_build_object('status','up_to_date','processedFiles',0,'durationMs',0); end if;

  select count(*) into rows_before from public.ph_drive_around_report_rows row
  join selected_drive_files_v2366 file on file.file_id=row.file_id;
  update public.ph_drive_around_report_rows row set
    row_state_hash=private.drive_around_report_state_hash_v2366(row),
    first_seen_at=coalesce(row.created_at,row.updated_at,clock_timestamp()),
    last_seen_at=coalesce(row.updated_at,row.created_at,clock_timestamp()),
    first_file_id=row.file_id,last_file_id=row.file_id,first_file_name=row.file_name,last_file_name=row.file_name,
    last_report_date=row.report_date,seen_count=1
  from selected_drive_files_v2366 file where file.file_id=row.file_id and row.row_state_hash is null;

  create temporary table drive_state_work_v2366 on commit drop as
  select lower(btrim(coalesce(row.itemcode,''))) itemcode_key,row.row_state_hash,
    (array_agg(row.unique_id order by row.report_date,row.row_number,row.unique_id))[1] canonical_unique_id,
    min(row.first_seen_at) first_seen_at,max(row.last_seen_at) last_seen_at,
    (array_agg(row.file_id order by row.report_date,row.row_number,row.unique_id))[1] first_file_id,
    (array_agg(row.file_id order by row.report_date desc,row.row_number desc,row.unique_id desc))[1] last_file_id,
    (array_agg(row.file_name order by row.report_date,row.row_number,row.unique_id))[1] first_file_name,
    (array_agg(row.file_name order by row.report_date desc,row.row_number desc,row.unique_id desc))[1] last_file_name,
    min(row.report_date) first_report_date,max(row.report_date) last_report_date,count(*)::bigint seen_count
  from public.ph_drive_around_report_rows row join selected_drive_files_v2366 file on file.file_id=row.file_id
  group by lower(btrim(coalesce(row.itemcode,''))),row.row_state_hash;

  insert into private.ph_drive_around_row_states_v2366(itemcode_key,row_state_hash,canonical_unique_id,
    first_seen_at,last_seen_at,first_file_id,last_file_id,first_file_name,last_file_name,first_report_date,last_report_date,seen_count)
  select itemcode_key,row_state_hash,canonical_unique_id,first_seen_at,last_seen_at,first_file_id,last_file_id,
    first_file_name,last_file_name,first_report_date,last_report_date,seen_count from drive_state_work_v2366
  on conflict(itemcode_key,row_state_hash) do update set
    first_seen_at=least(private.ph_drive_around_row_states_v2366.first_seen_at,excluded.first_seen_at),
    last_seen_at=greatest(private.ph_drive_around_row_states_v2366.last_seen_at,excluded.last_seen_at),
    first_file_id=case when excluded.first_seen_at<private.ph_drive_around_row_states_v2366.first_seen_at then excluded.first_file_id else private.ph_drive_around_row_states_v2366.first_file_id end,
    last_file_id=case when excluded.last_seen_at>=private.ph_drive_around_row_states_v2366.last_seen_at then excluded.last_file_id else private.ph_drive_around_row_states_v2366.last_file_id end,
    first_file_name=case when excluded.first_seen_at<private.ph_drive_around_row_states_v2366.first_seen_at then excluded.first_file_name else private.ph_drive_around_row_states_v2366.first_file_name end,
    last_file_name=case when excluded.last_seen_at>=private.ph_drive_around_row_states_v2366.last_seen_at then excluded.last_file_name else private.ph_drive_around_row_states_v2366.last_file_name end,
    first_report_date=least(private.ph_drive_around_row_states_v2366.first_report_date,excluded.first_report_date),
    last_report_date=greatest(private.ph_drive_around_row_states_v2366.last_report_date,excluded.last_report_date),
    seen_count=private.ph_drive_around_row_states_v2366.seen_count+excluded.seen_count;
  get diagnostics states_merged=row_count;

  update public.ph_drive_around_report_rows row set row_state_hash=state.row_state_hash,
    first_seen_at=state.first_seen_at,last_seen_at=state.last_seen_at,first_file_id=state.first_file_id,
    last_file_id=state.last_file_id,first_file_name=state.first_file_name,last_file_name=state.last_file_name,
    last_report_date=state.last_report_date,seen_count=state.seen_count::integer,updated_at=greatest(row.updated_at,state.last_seen_at)
  from private.ph_drive_around_row_states_v2366 state
  where row.unique_id=state.canonical_unique_id
    and exists(select 1 from drive_state_work_v2366 work where work.itemcode_key=state.itemcode_key and work.row_state_hash=state.row_state_hash);
  perform set_config('agdata.archive_dedup','on',true);
  delete from public.ph_drive_around_report_rows row using drive_state_work_v2366 work,
    private.ph_drive_around_row_states_v2366 state
  where lower(btrim(coalesce(row.itemcode,'')))=work.itemcode_key and row.row_state_hash=work.row_state_hash
    and state.itemcode_key=work.itemcode_key and state.row_state_hash=work.row_state_hash
    and row.unique_id<>state.canonical_unique_id
    and exists(select 1 from selected_drive_files_v2366 file where file.file_id=row.file_id);
  select count(*) into rows_after from public.ph_drive_around_report_rows row
  join selected_drive_files_v2366 file on file.file_id=row.file_id;
  result_value:=jsonb_build_object('status','complete','processedFiles',selected_files,'rowsBefore',rows_before,
    'rowsAfter',rows_after,'removedRows',rows_before-rows_after,'statesMerged',states_merged,
    'durationMs',floor(extract(epoch from clock_timestamp()-started_at)*1000));
  insert into private.archive_state_dedup_audit_v2366(status,completed_at,raw_result)
  values('raw_batch_complete',clock_timestamp(),result_value);
  return result_value;
end
$function$;

comment on function public.deduplicate_drive_around_report_rows_batch_v1(integer) is
  'Overnight-only, 25-file/50,000-row bounded state compaction for DriveAround history; every call is capped below five seconds.';
revoke all on function public.deduplicate_drive_around_report_rows_batch_v1(integer) from public,anon,authenticated,service_role;

create or replace function private.run_historical_state_dedup_v2366()
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare compact_result jsonb; raw_result jsonb;
begin
  compact_result:=private.compact_history_states_v2366();
  raw_result:=public.deduplicate_drive_around_report_rows_batch_v1(25);
  return jsonb_build_object('compact',compact_result,'raw',raw_result);
end
$function$;

revoke all on function private.run_historical_state_dedup_v2366() from public,anon,authenticated,service_role;

do $initial_batch$
declare result_value jsonb;
begin
  result_value:=private.run_historical_state_dedup_v2366();
  raise notice 'AGDATA_V2366_HISTORICAL_DEDUP_INITIAL %',result_value;
end
$initial_batch$;

do $schedule$
declare existing_job bigint;
begin
  if to_regclass('cron.job') is not null and to_regprocedure('cron.schedule(text,text,text)') is not null then
    select jobid into existing_job from cron.job where jobname='agdata_historical_state_dedup_v2366' limit 1;
    if existing_job is not null then perform cron.unschedule(existing_job); end if;
    perform cron.schedule('agdata_historical_state_dedup_v2366','*/15 * * * *',
      'select private.run_historical_state_dedup_v2366();');
  end if;
end
$schedule$;

create or replace function public.historical_archive_read_v2(p_query jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
set statement_timeout='2s'
as $function$
declare
  base_result jsonb;
  operation text:=coalesce(p_query->>'operation','');
  record_kind text:=coalesce(p_query->>'recordKind','');
  path_value jsonb:=coalesce(p_query->'path','[]'::jsonb);
  file_id_value text;
  search_value text;
  page_value integer:=coalesce((p_query->>'page')::integer,0);
  page_size_value integer:=coalesce((p_query->>'pageSize')::integer,25);
  rows_value jsonb:='[]'::jsonb;
  row_total bigint:=0;
begin
  base_result:=public.historical_archive_read_v1(p_query);
  if record_kind<>'drive' or operation not in ('archive-records','archive-search') then return base_result; end if;
  if operation='archive-records' then
    file_id_value:=path_value->>2;
    with distinct_rows as materialized (
      select distinct on (lower(btrim(coalesce(row.itemcode,''))),
        coalesce(row.row_state_hash,private.drive_around_report_state_hash_v2366(row))) row.*
      from public.ph_drive_around_report_rows row where row.file_id=file_id_value
      order by lower(btrim(coalesce(row.itemcode,''))),
        coalesce(row.row_state_hash,private.drive_around_report_state_hash_v2366(row)),
        row.updated_at desc,row.unique_id desc
    )
    select count(*) into row_total from distinct_rows;
    with distinct_rows as materialized (
      select distinct on (lower(btrim(coalesce(row.itemcode,''))),
        coalesce(row.row_state_hash,private.drive_around_report_state_hash_v2366(row))) row.*
      from public.ph_drive_around_report_rows row where row.file_id=file_id_value
      order by lower(btrim(coalesce(row.itemcode,''))),
        coalesce(row.row_state_hash,private.drive_around_report_state_hash_v2366(row)),
        row.updated_at desc,row.unique_id desc
    ), paged as (
      select * from distinct_rows order by report_date desc nulls last,unique_id
      offset page_value*page_size_value limit page_size_value
    )
    select coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb) into rows_value from (
      select row.report_date::timestamptz occurred_at,row.unique_id id,jsonb_build_object('kind','record','id',row.unique_id,
        'title',coalesce(nullif(row.commonname,''),row.itemcode),'subtitle',row.file_name,
        'status',coalesce(nullif(row.holdstopcode,''),'Archived'),'occurredAt',row.report_date,
        'itemcode',coalesce(row.itemcode,''),'commonname',coalesce(row.commonname,''),'contsize',coalesce(row.contsize,''),
        'locationcode',coalesce(row.locationcode,''),'lotcode',coalesce(row.lotcode,''),'quantity',row.ptravailable,
        'unitListPrice',null,'lineDollarValue',null,'photoLinks',coalesce(photo.links,'[]'::jsonb),
        'facts',jsonb_build_object('File',row.file_name,'Report Date',row.report_date,'Season',row.season,
          'Available',row.ptravailable,'On Hand',row.ptronhand,'Review',row.ptrreviewed,'Open Stock',row.s_lts,
          'Hold',row.holdstopcode,'Hold Reason',row.holdstopreason,'Spec',row.itemspec,'Seen',row.seen_count),
        'notes',to_jsonb(array_remove(array[row.locationnote,row.salesnote,row.inventorynote],null))) record
      from paged row left join lateral (
        select jsonb_agg('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/'||asset.bucket||'/'||asset.path order by asset.photo_at desc) links
        from (select photo.* from public.ph_photo_history_assets photo where photo.itemcode=row.itemcode
          and (photo.locationcode is null or photo.locationcode=row.locationcode) order by photo.photo_at desc limit 5) asset
      ) photo on true
    ) records;
  else
    search_value:=lower(btrim(p_query->>'query'));
    with dimensions as materialized (
      select distinct dimension.itemcode from public.ph_historical_inventory_dimensions dimension
      where dimension.commonname_key like '%'||search_value||'%' or lower(dimension.itemcode) like search_value||'%'
      order by dimension.itemcode limit 20
    ), report_matches as (
      select row.report_date::timestamptz occurred_at,row.unique_id id,jsonb_build_object('kind','record','id',row.unique_id,
        'title',coalesce(nullif(row.commonname,''),row.itemcode),'subtitle',row.file_name,
        'status',coalesce(nullif(row.holdstopcode,''),'Archived'),'occurredAt',row.report_date,
        'itemcode',coalesce(row.itemcode,''),'commonname',coalesce(row.commonname,''),'contsize',coalesce(row.contsize,''),
        'locationcode',coalesce(row.locationcode,''),'lotcode',coalesce(row.lotcode,''),'quantity',row.ptravailable,
        'unitListPrice',null,'lineDollarValue',null,'photoLinks','[]'::jsonb,
        'facts',jsonb_build_object('File',row.file_name,'Report Date',row.report_date,'Season',row.season,
          'Available',row.ptravailable,'On Hand',row.ptronhand,'Review',row.ptrreviewed,'Open Stock',row.s_lts,
          'Hold',row.holdstopcode,'Hold Reason',row.holdstopreason,'Seen',row.seen_count),
        'notes',to_jsonb(array_remove(array[row.locationnote,row.salesnote],null))) record
      from dimensions dimension cross join lateral (
        select distinct on (coalesce(source.row_state_hash,private.drive_around_report_state_hash_v2366(source))) source.*
        from public.ph_drive_around_report_rows source where source.itemcode=dimension.itemcode
        order by coalesce(source.row_state_hash,private.drive_around_report_state_hash_v2366(source)),
          source.report_date desc nulls last,source.unique_id desc limit 5
      ) row
    ), evidence_matches as (
      select history.archived_at occurred_at,history.history_key id,jsonb_build_object('kind','record','id',history.history_key,
        'title',coalesce(nullif(history.commonname,''),history.itemcode,'Historical Evidence'),
        'subtitle',coalesce(history.source_file_name,history.archive_reason),'status',history.archive_reason,
        'occurredAt',history.archived_at,'itemcode',coalesce(history.itemcode,''),'commonname',coalesce(history.commonname,''),
        'contsize',coalesce(history.contsize,''),'locationcode',coalesce(history.locationcode,''),'lotcode',coalesce(history.lotcode,''),
        'quantity',coalesce(history.available,history.ptravailable,history.on_hand),'unitListPrice',null,'lineDollarValue',null,
        'photoLinks',private.archive_photo_array_v2366(history.photos,array[history.photo_url]),
        'facts',jsonb_build_object('Report Date',history.report_date,'Season',history.season,'Spec',history.spec,
          'Caliper',history.caliper,'Loc Match %',history.loc_match_pct,'Loc Photo Match',history.loc_photo_match,
          'Hold',history.hold_stop_code,'Seen',history.seen_count),
        'notes',to_jsonb(array_remove(array[history.pick_note,history.av_note,history.sales_note,history.hold_stop_reason],null))) record
      from public.ph_drive_mode_history history where history.search_text like '%'||search_value||'%'
      order by history.archived_at desc limit page_size_value
    )
    select coalesce(jsonb_agg(record order by occurred_at desc nulls last,id),'[]'::jsonb) into rows_value
    from (select * from report_matches union all select * from evidence_matches
      order by occurred_at desc nulls last limit page_size_value) matches;
    row_total:=jsonb_array_length(rows_value);
  end if;
  return jsonb_set(jsonb_set(base_result,'{rows}',rows_value,true),'{total}',to_jsonb(row_total),true);
end
$function$;

comment on function public.historical_archive_read_v2(jsonb) is
  'Authenticated archive reader with exact DriveAround business-state deduplication for file and search results.';
revoke all on function public.historical_archive_read_v2(jsonb) from public,anon,service_role;
grant execute on function public.historical_archive_read_v2(jsonb) to authenticated;

commit;
