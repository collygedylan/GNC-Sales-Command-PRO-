begin;

set local lock_timeout = '15s';
set local statement_timeout = '30s';

alter table public.ph_master_inventory
  add column if not exists pick text;

alter table public.ph_requests_pending
  add column if not exists submitted_by text;

alter table public.ph_requests_completed_history
  add column if not exists submitted_by text;

update public.ph_master_inventory
set pick_note = coalesce(nullif(pick_note, ''), nullif(pick, ''), nullif(picknote, '')),
    pick = coalesce(nullif(pick_note, ''), nullif(pick, ''), nullif(picknote, '')),
    picknote = coalesce(nullif(pick_note, ''), nullif(pick, ''), nullif(picknote, ''))
where pick_note is distinct from coalesce(nullif(pick_note, ''), nullif(pick, ''), nullif(picknote, ''))
   or pick is distinct from coalesce(nullif(pick_note, ''), nullif(pick, ''), nullif(picknote, ''))
   or picknote is distinct from coalesce(nullif(pick_note, ''), nullif(pick, ''), nullif(picknote, ''));

create or replace function private.sync_master_inventory_pick_v2370()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  canonical_pick text;
begin
  if tg_op = 'UPDATE' and new.pick_note is distinct from old.pick_note then
    canonical_pick := new.pick_note;
  elsif tg_op = 'UPDATE' and new.pick is distinct from old.pick then
    canonical_pick := new.pick;
  elsif tg_op = 'UPDATE' and new.picknote is distinct from old.picknote then
    canonical_pick := new.picknote;
  else
    canonical_pick := coalesce(nullif(new.pick_note, ''), nullif(new.pick, ''), nullif(new.picknote, ''));
  end if;
  new.pick_note := canonical_pick;
  new.pick := canonical_pick;
  new.picknote := canonical_pick;
  return new;
end
$function$;

revoke all on function private.sync_master_inventory_pick_v2370()
  from public, anon, authenticated, service_role;

drop trigger if exists zzzzzz_sync_master_inventory_pick_v2370 on public.ph_master_inventory;
create trigger zzzzzz_sync_master_inventory_pick_v2370
before insert or update of pick, pick_note, picknote on public.ph_master_inventory
for each row execute function private.sync_master_inventory_pick_v2370();

create or replace function private.sync_request_actor_fields_v2370()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  submitter text;
  selected_rep text;
begin
  submitter := coalesce(
    nullif(btrim(new.submitted_by), ''),
    nullif(btrim(new.request_created_by_username), ''),
    nullif(btrim(new.requested_by), '')
  );
  selected_rep := coalesce(
    nullif(btrim(new.request_selected_rep_display), ''),
    nullif(btrim(new.sales_rep), ''),
    nullif(btrim(new.request_selected_rep_username), '')
  );
  new.submitted_by := submitter;
  new.requested_by := coalesce(submitter, new.requested_by);
  new.sales_rep := selected_rep;
  return new;
end
$function$;

revoke all on function private.sync_request_actor_fields_v2370()
  from public, anon, authenticated, service_role;

drop trigger if exists zzzzzzz_request_actor_fields_v2370 on public.ph_requests_pending;
create trigger zzzzzzz_request_actor_fields_v2370
before insert or update of submitted_by, requested_by, request_created_by_username,
  request_selected_rep_display, request_selected_rep_username, sales_rep
on public.ph_requests_pending
for each row execute function private.sync_request_actor_fields_v2370();

drop trigger if exists zzzzzzz_request_actor_fields_v2370 on public.ph_requests_completed_history;
create trigger zzzzzzz_request_actor_fields_v2370
before insert or update of submitted_by, requested_by, request_created_by_username,
  request_selected_rep_display, request_selected_rep_username, sales_rep
on public.ph_requests_completed_history
for each row execute function private.sync_request_actor_fields_v2370();

update public.ph_requests_pending
set submitted_by = coalesce(nullif(request_created_by_username, ''), nullif(requested_by, '')),
    requested_by = coalesce(nullif(request_created_by_username, ''), nullif(requested_by, '')),
    sales_rep = coalesce(nullif(request_selected_rep_display, ''), nullif(sales_rep, ''), nullif(request_selected_rep_username, ''));

update public.ph_requests_completed_history
set submitted_by = coalesce(nullif(request_created_by_username, ''), nullif(requested_by, '')),
    requested_by = coalesce(nullif(request_created_by_username, ''), nullif(requested_by, '')),
    sales_rep = coalesce(nullif(request_selected_rep_display, ''), nullif(sales_rep, ''), nullif(request_selected_rep_username, ''));

create or replace view public.ph_active_request
with (security_invoker = true)
as
select pending.*
from public.ph_requests_pending pending
where pending.unique_id like 'REQ-%';

create or replace view public.ph_active_request_live_rows
with (security_invoker = true)
as
select pending.*
from public.ph_requests_pending pending
where pending.unique_id like 'REQ-%'
  and pending.date_completed is null;

create or replace view public.ph_request_queue_live_rows
with (security_invoker = true)
as
select pending.*
from public.ph_requests_pending pending
where pending.unique_id like 'REQ-%'
  and pending.date_completed is null;

do $repair_request_work$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure);
  definition := replace(definition, '      pick=coalesce(', '      pick_note=coalesce(');
  if position('      pick=coalesce(' in definition) > 0 then
    raise exception 'REQUEST_WORK_PICK_REPAIR_INCOMPLETE';
  end if;
  execute definition;
end
$repair_request_work$;

do $repair_consolidation_access$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure);
  definition := replace(definition,
    E'  if not private.navigation_module_allowed_v1(actor_id,''sales-inventory'') then\n    raise exception using errcode=''42501'',message=''INVENTORY_CONSOLIDATION_FORBIDDEN'';\n  end if;\n',
    '');
  execute definition;
end
$repair_consolidation_access$;

alter function public.inventory_consolidation_suggestions_v1(jsonb)
  set statement_timeout to '2s';

create or replace function public.inventory_consolidation_suggestions_v2370(
  p_actor_id uuid,
  p_query jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '3s'
as $function$
begin
  perform sales_private.actor(p_actor_id);
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_actor_id, 'role', 'authenticated'
  )::text, true);
  return public.inventory_consolidation_suggestions_v1(coalesce(p_query, '{}'::jsonb));
end
$function$;

revoke all on function public.inventory_consolidation_suggestions_v2370(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.inventory_consolidation_suggestions_v2370(uuid,jsonb)
  to service_role;

create or replace function public.historical_requests_read_v2370(
  p_actor_id uuid,
  p_query jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '12s'
as $function$
begin
  perform sales_private.actor(p_actor_id);
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_actor_id, 'role', 'authenticated'
  )::text, true);
  return public.historical_requests_read_v2368(p_query);
end
$function$;

revoke all on function public.historical_requests_read_v2370(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.historical_requests_read_v2370(uuid,jsonb)
  to service_role;

create or replace function public.historical_archive_read_v2370(
  p_actor_id uuid,
  p_query jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '12s'
as $function$
begin
  perform sales_private.actor(p_actor_id);
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_actor_id, 'role', 'authenticated'
  )::text, true);
  return public.historical_archive_read_v2368(p_query);
end
$function$;

revoke all on function public.historical_archive_read_v2370(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.historical_archive_read_v2370(uuid,jsonb)
  to service_role;

alter function public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)
  set lock_timeout to '15s';
alter function public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)
  set statement_timeout to '30s';
alter function public.request_work_command_v1_pre_state_machine_v2359(uuid,uuid,text,text,bigint,jsonb,boolean)
  set lock_timeout to '15s';
alter function public.request_work_command_v1_pre_state_machine_v2359(uuid,uuid,text,text,bigint,jsonb,boolean)
  set statement_timeout to '30s';
alter function public.save_request_work(text,bigint,jsonb,boolean)
  set lock_timeout to '15s';
alter function public.save_request_work(text,bigint,jsonb,boolean)
  set statement_timeout to '30s';
alter function public.save_request_work_v1(text,bigint,jsonb,boolean)
  set lock_timeout to '15s';
alter function public.save_request_work_v1(text,bigint,jsonb,boolean)
  set statement_timeout to '30s';
alter function private.persist_completed_request_history_v1(text,text,text,boolean)
  set lock_timeout to '15s';
alter function private.persist_completed_request_history_v1(text,text,text,boolean)
  set statement_timeout to '30s';

update public.ph_requests_pending
set sales_rep = 'Troy Lee',
    submitted_by = 'dylan_collyge',
    requested_by = 'dylan_collyge',
    request_created_by_username = 'dylan_collyge',
    request_created_by_display = 'dylan_collyge',
    request_selected_rep_username = 'troy_lee',
    request_selected_rep_display = 'Troy Lee',
    req_qty = case locationcode when 'C.15.000' then '25' else '250' end,
    request_qty = case locationcode when 'C.15.000' then 25 else 250 end,
    qty = case locationcode when 'C.15.000' then 25 else 250 end
where itemcode = '004103.010.1'
  and lotcode = '27.S1'
  and locationcode in ('C.15.000', 'F.16.000');

update public.ph_requests_pending
set sales_rep = 'Annette Hancock',
    submitted_by = 'nelly_aguilar',
    requested_by = 'nelly_aguilar',
    request_created_by_username = 'nelly_aguilar',
    request_created_by_display = 'nelly_aguilar',
    request_selected_rep_username = 'annette_hancock',
    request_selected_rep_display = 'Annette Hancock'
where itemcode = '001777.030.1'
  and locationcode = 'D.22.000';

update public.app_runtime_watchdog_events
set status = 'resolved'
where status is distinct from 'resolved';

do $verify$
begin
  if not exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ph_master_inventory' and column_name = 'pick')
    or exists(select 1 from public.ph_master_inventory where pick is distinct from pick_note) then
    raise exception 'MASTER_PICK_COMPATIBILITY_INVALID';
  end if;
  if position('      pick=coalesce(' in pg_get_functiondef(
    'public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure)) > 0 then
    raise exception 'REQUEST_WORK_PICK_REFERENCE_REMAINS';
  end if;
  if not exists(select 1 from pg_proc where oid =
      'public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)'::regprocedure
      and proconfig @> array['lock_timeout=15s','statement_timeout=30s']) then
    raise exception 'REQUEST_WORK_TIMEOUTS_INVALID';
  end if;
  if position('navigation_module_allowed_v1' in pg_get_functiondef(
      'public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure)) > 0
    or not has_function_privilege('service_role',
      'public.inventory_consolidation_suggestions_v2370(uuid,jsonb)','execute')
    or has_function_privilege('authenticated',
      'public.inventory_consolidation_suggestions_v2370(uuid,jsonb)','execute')
    or not has_function_privilege('service_role',
      'public.historical_requests_read_v2370(uuid,jsonb)','execute')
    or has_function_privilege('authenticated',
      'public.historical_requests_read_v2370(uuid,jsonb)','execute') then
    raise exception 'FAIL_OPEN_READ_WRAPPERS_INVALID';
  end if;
  if (select count(distinct unique_id) from public.ph_requests_pending
      where itemcode = '004103.010.1' and lotcode = '27.S1'
        and locationcode in ('C.15.000', 'F.16.000')) <> 2
    or not exists(select 1 from public.ph_requests_pending
      where itemcode = '004103.010.1' and locationcode = 'C.15.000' and lotcode = '27.S1'
        and request_qty = 25 and qty = 25 and sales_rep = 'Troy Lee'
        and submitted_by = 'dylan_collyge' and requested_by = 'dylan_collyge')
    or not exists(select 1 from public.ph_requests_pending
      where itemcode = '004103.010.1' and locationcode = 'F.16.000' and lotcode = '27.S1'
        and request_qty = 250 and qty = 250 and sales_rep = 'Troy Lee'
        and submitted_by = 'dylan_collyge' and requested_by = 'dylan_collyge')
    or not exists(select 1 from public.ph_requests_pending
      where itemcode = '001777.030.1' and locationcode = 'D.22.000'
        and sales_rep = 'Annette Hancock' and submitted_by = 'nelly_aguilar'
        and requested_by = 'nelly_aguilar') then
    raise exception 'REQUEST_IDENTITY_REPAIR_INVALID';
  end if;
  if exists(select 1 from public.app_runtime_watchdog_events where status is distinct from 'resolved') then
    raise exception 'WATCHDOG_EVENTS_REMAIN_OPEN';
  end if;
  if (select count(*) from pg_class where oid in (
      'public.ph_active_request'::regclass,
      'public.ph_active_request_live_rows'::regclass,
      'public.ph_request_queue_live_rows'::regclass
    ) and reloptions @> array['security_invoker=true']) <> 3 then
    raise exception 'REQUEST_VIEW_SECURITY_INVOKER_INVALID';
  end if;
end
$verify$;

notify pgrst, 'reload schema';

commit;
