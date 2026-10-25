begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.ph_requests_pending
  add column if not exists customer text,
  add column if not exists consignee text,
  add column if not exists qty numeric,
  add column if not exists measure_spec text,
  add column if not exists comments text;

alter table public.ph_requests_completed_history
  add column if not exists customer text,
  add column if not exists consignee text,
  add column if not exists qty numeric,
  add column if not exists measure_spec text,
  add column if not exists comments text,
  add column if not exists status text;

create or replace function private.sync_request_browser_compatibility_v2364()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  new.customer_name := coalesce(nullif(btrim(new.customer_name), ''), nullif(btrim(new.customer), ''),
    nullif(btrim(new.customername), ''), nullif(btrim(new.req_customer), ''), 'Unknown Customer');
  new.customer := new.customer_name;
  new.consignee_name := coalesce(nullif(btrim(new.consignee_name), ''), nullif(btrim(new.consignee), ''),
    nullif(btrim(new.consigneename), ''), 'N/A');
  new.consignee := new.consignee_name;
  new.request_qty := coalesce(new.request_qty, new.qty, private.request_numeric_v2362(new.req_qty));
  new.qty := new.request_qty;
  new.request_spec := coalesce(nullif(btrim(new.request_spec), ''), nullif(btrim(new.measure_spec), ''),
    nullif(btrim(new.req_spec), ''), nullif(btrim(new.desired_spec), ''));
  new.measure_spec := new.request_spec;
  new.request_caliper := coalesce(nullif(btrim(new.request_caliper), ''), nullif(btrim(new.desired_caliper), ''),
    nullif(btrim(new.caliper), ''), nullif(btrim(new.req_caliper), ''));
  new.caliper := coalesce(new.request_caliper, new.caliper);
  new.request_notes := coalesce(nullif(btrim(new.request_notes), ''), nullif(btrim(new.comments), ''),
    nullif(btrim(new.req_comments), ''));
  new.comments := new.request_notes;
  new.status := coalesce(nullif(btrim(new.status), ''), nullif(btrim(new.req_status), ''),
    case when new.date_completed is null then 'Pending' else 'Completed' end);
  if tg_table_name = 'ph_requests_pending' then
    new.date_completed := null;
  end if;
  return new;
end
$function$;

drop trigger if exists zzzzzz_request_browser_compatibility_v2364 on public.ph_requests_pending;
create trigger zzzzzz_request_browser_compatibility_v2364
before insert or update on public.ph_requests_pending
for each row execute function private.sync_request_browser_compatibility_v2364();
alter table public.ph_requests_pending enable always trigger zzzzzz_request_browser_compatibility_v2364;

drop trigger if exists zzzzzz_request_browser_compatibility_v2364 on public.ph_requests_completed_history;
create trigger zzzzzz_request_browser_compatibility_v2364
before insert or update on public.ph_requests_completed_history
for each row execute function private.sync_request_browser_compatibility_v2364();
alter table public.ph_requests_completed_history enable always trigger zzzzzz_request_browser_compatibility_v2364;

update public.ph_requests_pending set
  customer_name = coalesce(nullif(btrim(customer_name), ''), nullif(btrim(customer), ''),
    nullif(btrim(customername), ''), nullif(btrim(req_customer), ''), 'Unknown Customer'),
  consignee_name = coalesce(nullif(btrim(consignee_name), ''), nullif(btrim(consignee), ''),
    nullif(btrim(consigneename), ''), 'N/A'),
  request_qty = coalesce(request_qty, qty, private.request_numeric_v2362(req_qty)),
  request_spec = coalesce(nullif(btrim(request_spec), ''), nullif(btrim(measure_spec), ''),
    nullif(btrim(req_spec), ''), nullif(btrim(desired_spec), '')),
  request_caliper = coalesce(nullif(btrim(request_caliper), ''), nullif(btrim(desired_caliper), ''),
    nullif(btrim(caliper), ''), nullif(btrim(req_caliper), '')),
  request_notes = coalesce(nullif(btrim(request_notes), ''), nullif(btrim(comments), ''),
    nullif(btrim(req_comments), '')),
  status = coalesce(nullif(btrim(status), ''), nullif(btrim(req_status), ''), 'Pending'),
  date_completed = null;

update public.ph_requests_completed_history set
  customer_name = coalesce(nullif(btrim(customer_name), ''), nullif(btrim(customer), ''),
    nullif(btrim(customername), ''), nullif(btrim(req_customer), ''), 'Unknown Customer'),
  consignee_name = coalesce(nullif(btrim(consignee_name), ''), nullif(btrim(consignee), ''),
    nullif(btrim(consigneename), ''), 'N/A'),
  request_qty = coalesce(request_qty, qty, private.request_numeric_v2362(req_qty)),
  request_spec = coalesce(nullif(btrim(request_spec), ''), nullif(btrim(measure_spec), ''),
    nullif(btrim(req_spec), ''), nullif(btrim(desired_spec), '')),
  request_caliper = coalesce(nullif(btrim(request_caliper), ''), nullif(btrim(desired_caliper), ''),
    nullif(btrim(caliper), ''), nullif(btrim(req_caliper), '')),
  request_notes = coalesce(nullif(btrim(request_notes), ''), nullif(btrim(comments), ''),
    nullif(btrim(req_comments), '')),
  status = coalesce(nullif(btrim(status), ''), nullif(btrim(req_status), ''), 'Completed');

update public.ph_requests_pending
set commonname = replace(replace(commonname, 'Ã‚Â®', '®'), 'Â®', '®')
where commonname like '%Â®%' or commonname like '%Ã‚Â®%';
update public.ph_requests_completed_history
set commonname = replace(replace(commonname, 'Ã‚Â®', '®'), 'Â®', '®')
where commonname like '%Â®%' or commonname like '%Ã‚Â®%';
update public.ph_master_inventory
set commonname = replace(replace(commonname, 'Ã‚Â®', '®'), 'Â®', '®')
where commonname like '%Â®%' or commonname like '%Ã‚Â®%';

create or replace function private.inventory_location_evidence_qty_v2(
  p_baseline_on_hand numeric,
  p_initial_photo_match_qty numeric,
  p_current_on_hand numeric
) returns numeric language sql immutable set search_path = '' as $function$
  select case
    when p_baseline_on_hand is null or p_initial_photo_match_qty is null or p_current_on_hand is null then null
    else least(
      greatest(0, p_current_on_hand),
      greatest(0, p_initial_photo_match_qty - greatest(0, p_baseline_on_hand - p_current_on_hand))
    )
  end;
$function$;
revoke all on function private.inventory_location_evidence_qty_v2(numeric,numeric,numeric) from public,anon,authenticated;

select public.reconcile_inventory_location_evidence_v1();

create or replace view public.ph_active_request with (security_invoker = false) as
select * from public.ph_requests_pending
where unique_id like 'REQ-%'
with local check option;
alter view public.ph_active_request owner to postgres;

create or replace view public.ph_active_request_live_rows with (security_invoker = false) as
select * from public.ph_requests_pending
where unique_id like 'REQ-%' and date_completed is null
with local check option;
alter view public.ph_active_request_live_rows owner to postgres;

create or replace view public.ph_request_queue_live_rows with (security_invoker = false) as
select * from public.ph_requests_pending
where unique_id like 'REQ-%' and date_completed is null
with local check option;
alter view public.ph_request_queue_live_rows owner to postgres;

create or replace view public.ph_request_history with (security_invoker = false) as
select * from public.ph_requests_completed_history
where unique_id not like 'move_req_%' and unique_id not like 'EVAL-%'
with local check option;
alter view public.ph_request_history owner to postgres;

grant usage on schema public to anon, authenticated, service_role;
grant select on public.ph_requests_pending, public.ph_active_request,
  public.ph_active_request_live_rows, public.ph_request_queue_live_rows,
  public.ph_requests_completed_history, public.ph_request_history
  to anon, authenticated, service_role;

drop policy if exists ph_requests_pending_anon_select on public.ph_requests_pending;
create policy ph_requests_pending_anon_select on public.ph_requests_pending
for select to anon, authenticated using (true);
drop policy if exists ph_requests_completed_history_anon_select on public.ph_requests_completed_history;
create policy ph_requests_completed_history_anon_select on public.ph_requests_completed_history
for select to anon, authenticated using (true);

grant execute on function public.guard_active_app_session_v1() to anon, authenticated, service_role;

do $verify$
declare relation_name text;
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'ph_requests_pending'
        and column_name in ('customer','customer_name','consignee','consignee_name','qty','request_qty',
          'measure_spec','request_spec','caliper','request_caliper','comments','request_notes','date_completed','status')) <> 14 then
    raise exception 'REQUEST_BROWSER_COMPATIBILITY_COLUMNS_MISSING';
  end if;
  if not has_table_privilege('anon', 'public.ph_requests_pending', 'select')
      or not has_table_privilege('anon', 'public.ph_active_request', 'select')
      or not has_function_privilege('anon', 'public.guard_active_app_session_v1()', 'execute') then
    raise exception 'REQUEST_BROWSER_ANON_ACCESS_MISSING';
  end if;
  foreach relation_name in array array['ph_active_request','ph_active_request_live_rows','ph_request_queue_live_rows','ph_request_history'] loop
    if exists (
      select 1 from pg_class relation
      where relation.oid = format('public.%I', relation_name)::regclass
        and coalesce((select option_value from pg_options_to_table(relation.reloptions)
          where option_name = 'security_invoker'), 'false') <> 'false'
    ) then
      raise exception 'REQUEST_BROWSER_VIEW_SECURITY_INVALID:%', relation_name;
    end if;
  end loop;
  if (select count(*) from public.ph_active_request) < 6 then
    raise exception 'REQUEST_BROWSER_ACTIVE_ROWS_MISSING';
  end if;
  if exists (select 1 from public.ph_requests_pending where date_completed is not null) then
    raise exception 'REQUEST_BROWSER_PENDING_COMPLETION_INVALID';
  end if;
  if exists (
    select 1 from public.ph_master_inventory
    where loc_photo_match > greatest(0, coalesce(private.inventory_location_evidence_number_v2(ptronhand), 0))
  ) then
    raise exception 'INVENTORY_LOCATION_EVIDENCE_EXCEEDS_ON_HAND';
  end if;
  if exists (
    select 1 from public.ph_requests_pending where commonname like '%Â®%' or commonname like '%Ã‚Â®%'
    union all
    select 1 from public.ph_requests_completed_history where commonname like '%Â®%' or commonname like '%Ã‚Â®%'
    union all
    select 1 from public.ph_master_inventory where commonname like '%Â®%' or commonname like '%Ã‚Â®%'
  ) then
    raise exception 'REQUEST_BROWSER_MOJIBAKE_REMAINED';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
commit;
