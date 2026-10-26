begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

do $operational_reads$
declare
  relation_name text;
  relation_kind "char";
begin
  foreach relation_name in array array[
    'ph_master_inventory','ph_active_drive_mode','ph_cav_import','ph_reserves','ph_active_reserves',
    'ph_soc_master','ph_active_orders','ph_active_suspend','ph_customer_consignee_sales_reps',
    'ph_requests_pending','ph_active_request','app_dataset_revisions','ph_app_settings',
    'ph_company_directory_beds','ph_company_directory_blocks','ph_company_directory_codes',
    'ph_company_directory_contacts','ph_av_notes','aura_domain_glossary','ph_aura_domain_glossary'
  ] loop
    select c.relkind into relation_kind
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=relation_name;
    if relation_kind is null then
      raise exception using errcode='55000',message='V2369_OPERATIONAL_READ_RELATION_MISSING:'||relation_name;
    elsif relation_kind in ('r','p') then
      execute format('grant select on table public.%I to anon,authenticated',relation_name);
      execute format('revoke insert,update,delete on table public.%I from anon',relation_name);
      execute format('alter table public.%I enable row level security',relation_name);
      execute format('drop policy if exists agdata_v2369_operational_read on public.%I',relation_name);
      execute format('create policy agdata_v2369_operational_read on public.%I for select to anon,authenticated using (true)',relation_name);
    elsif relation_kind='v' then
      execute format('alter view public.%I set (security_invoker=true)',relation_name);
      execute format('grant select on table public.%I to anon,authenticated',relation_name);
    elsif relation_kind='m' then
      execute format('grant select on table public.%I to anon,authenticated',relation_name);
    else
      raise exception using errcode='55000',message='V2369_OPERATIONAL_READ_RELATION_UNSUPPORTED:'||relation_name;
    end if;
  end loop;
end
$operational_reads$;

revoke all on table public.ph_app_users from anon;
revoke all on table public.user_access_control from anon;

grant select,insert,update on table public.ph_request_delivery_outbox to anon,authenticated;
revoke delete on table public.ph_request_delivery_outbox from anon,authenticated;
alter table public.ph_request_delivery_outbox enable row level security;
drop policy if exists agdata_v2369_delivery_outbox_read on public.ph_request_delivery_outbox;
create policy agdata_v2369_delivery_outbox_read on public.ph_request_delivery_outbox
  for select to anon,authenticated using (true);
drop policy if exists agdata_v2369_delivery_outbox_insert on public.ph_request_delivery_outbox;
create policy agdata_v2369_delivery_outbox_insert on public.ph_request_delivery_outbox
  for insert to anon,authenticated with check (true);
drop policy if exists agdata_v2369_delivery_outbox_update on public.ph_request_delivery_outbox;
create policy agdata_v2369_delivery_outbox_update on public.ph_request_delivery_outbox
  for update to anon,authenticated using (true) with check (true);

alter view public.ph_delivery_outbox set (security_invoker=true);
grant select,insert,update on table public.ph_delivery_outbox to anon,authenticated;
alter view public.ph_request_delivery_status set (security_invoker=true);
grant select on table public.ph_request_delivery_status to anon,authenticated;

grant select,insert,update on table public.ph_request_delivery_worker_state to anon,authenticated;
revoke delete on table public.ph_request_delivery_worker_state from anon,authenticated;
alter table public.ph_request_delivery_worker_state enable row level security;
drop policy if exists agdata_v2369_delivery_worker_read on public.ph_request_delivery_worker_state;
create policy agdata_v2369_delivery_worker_read on public.ph_request_delivery_worker_state
  for select to anon,authenticated using (true);
drop policy if exists agdata_v2369_delivery_worker_insert on public.ph_request_delivery_worker_state;
create policy agdata_v2369_delivery_worker_insert on public.ph_request_delivery_worker_state
  for insert to anon,authenticated with check (true);
drop policy if exists agdata_v2369_delivery_worker_update on public.ph_request_delivery_worker_state;
create policy agdata_v2369_delivery_worker_update on public.ph_request_delivery_worker_state
  for update to anon,authenticated using (true) with check (true);

grant select,insert,update on table public.ph_request_email_threads to anon,authenticated;
revoke delete on table public.ph_request_email_threads from anon,authenticated;
alter table public.ph_request_email_threads enable row level security;
drop policy if exists agdata_v2369_request_email_threads_read on public.ph_request_email_threads;
create policy agdata_v2369_request_email_threads_read on public.ph_request_email_threads
  for select to anon,authenticated using (true);
drop policy if exists agdata_v2369_request_email_threads_insert on public.ph_request_email_threads;
create policy agdata_v2369_request_email_threads_insert on public.ph_request_email_threads
  for insert to anon,authenticated with check (true);
drop policy if exists agdata_v2369_request_email_threads_update on public.ph_request_email_threads;
create policy agdata_v2369_request_email_threads_update on public.ph_request_email_threads
  for update to anon,authenticated using (true) with check (true);

grant select on table public.ph_requests_completed_history to anon,authenticated;
grant update(delivery_state) on table public.ph_requests_completed_history to anon,authenticated;
alter table public.ph_requests_completed_history enable row level security;
drop policy if exists agdata_v2369_completed_history_read on public.ph_requests_completed_history;
create policy agdata_v2369_completed_history_read on public.ph_requests_completed_history
  for select to anon,authenticated using (true);
drop policy if exists agdata_v2369_completed_history_delivery_update on public.ph_requests_completed_history;
create policy agdata_v2369_completed_history_delivery_update on public.ph_requests_completed_history
  for update to anon,authenticated using (true) with check (true);

alter view public.ph_active_request set (security_invoker=true);
alter view public.ph_request_history set (security_invoker=true);
grant select on table public.ph_active_request,public.ph_request_history to anon,authenticated;

grant execute on function public.claim_request_delivery_events(integer,text) to anon,authenticated;
grant execute on function public.complete_request_delivery_event(uuid,uuid,jsonb) to anon,authenticated;
grant execute on function public.fail_request_delivery_event(uuid,uuid,text) to anon,authenticated;
grant execute on function public.heartbeat_request_delivery_worker(text,integer,integer,integer,boolean,text) to anon,authenticated;
grant execute on function public.record_request_delivery_channel_result(uuid,uuid,jsonb) to anon,authenticated;
grant execute on function public.requeue_request_delivery(uuid) to anon,authenticated;
grant execute on function public.get_request_delivery_recovery_queue() to anon,authenticated;

drop trigger if exists ph_drive_evidence_archive_v2366 on public.ph_master_inventory;
create trigger ph_drive_evidence_archive_v2366
before update of photo_url,spec,av_note,pick_note,sales_note,ptronhand on public.ph_master_inventory
for each row when (
  old.photo_url is distinct from new.photo_url
  or old.spec is distinct from new.spec
  or old.av_note is distinct from new.av_note
  or old.pick_note is distinct from new.pick_note
  or old.sales_note is distinct from new.sales_note
  or old.ptronhand is distinct from new.ptronhand
) execute function private.archive_drive_evidence_trigger_v2366();

drop trigger if exists ph_soc_master_archive_v2366 on public.ph_soc_master;
drop trigger if exists ph_soc_master_archive_v2366_update on public.ph_soc_master;
create trigger ph_soc_master_archive_v2366 after insert on public.ph_soc_master
for each row execute function private.archive_soc_order_trigger_v2366();
create trigger ph_soc_master_archive_v2366_update after update on public.ph_soc_master
for each row when (old is distinct from new) execute function private.archive_soc_order_trigger_v2366();

drop trigger if exists ph_reserves_archive_v2366 on public.ph_reserves;
drop trigger if exists ph_reserves_archive_v2366_update on public.ph_reserves;
create trigger ph_reserves_archive_v2366 after insert on public.ph_reserves
for each row execute function private.archive_reserve_trigger_v2366();
create trigger ph_reserves_archive_v2366_update after update on public.ph_reserves
for each row when (old is distinct from new) execute function private.archive_reserve_trigger_v2366();

drop trigger if exists trg_v2_master_inventory_crop_roll_drive_rows on public.ph_master_inventory;
drop trigger if exists trg_v2_master_inventory_crop_roll_drive_rows_insert on public.ph_master_inventory;
drop trigger if exists trg_v2_master_inventory_crop_roll_drive_rows_delete on public.ph_master_inventory;
create trigger trg_v2_master_inventory_crop_roll_drive_rows after update on public.ph_master_inventory
for each row when (old is distinct from new) execute function public.upsert_v2_crop_roll_drive_row_from_master();
create trigger trg_v2_master_inventory_crop_roll_drive_rows_insert after insert on public.ph_master_inventory
for each row execute function public.upsert_v2_crop_roll_drive_row_from_master();
create trigger trg_v2_master_inventory_crop_roll_drive_rows_delete after delete on public.ph_master_inventory
for each row execute function public.upsert_v2_crop_roll_drive_row_from_master();

do $timestamp_contract$
declare
  persistence_definition text;
begin
  if to_regprocedure('public.safe_parse_timestamptz(text,timestamptz)') is null
     or to_regprocedure('private.persist_completed_request_history_v1(text,text,text,boolean)') is null then
    raise exception using errcode='55000',message='V2369_TIMESTAMP_COALESCE_REPAIR_MISSING';
  end if;
  persistence_definition:=lower(pg_get_functiondef(
    'private.persist_completed_request_history_v1(text,text,text,boolean)'::regprocedure));
  if position('safe_parse_timestamptz' in persistence_definition)=0 then
    raise exception using errcode='42804',message='V2369_TIMESTAMP_COALESCE_REPAIR_FAILED';
  end if;
end
$timestamp_contract$;

update public.ph_request_delivery_outbox
set status='pending',attempt_count=0,next_attempt_at=clock_timestamp(),sanitized_error_code=null,
  lease_token=null,lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp()
where created_at>=clock_timestamp()-interval '48 hours'
  and delivered_at is null
  and event_type<>'delivery_canary'
  and (
    status in ('failed','error','retry')
    or status='pending'
    or (status in ('leased','processing') and (lease_expires_at is null or lease_expires_at<=clock_timestamp()))
  );

do $final_contract$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'ph_master_inventory','ph_cav_import','ph_reserves','ph_soc_master','ph_customer_consignee_sales_reps',
    'ph_requests_pending','app_dataset_revisions','ph_app_settings','ph_av_notes','aura_domain_glossary'
  ] loop
    if not has_table_privilege('anon','public.'||relation_name,'select')
       or not has_table_privilege('authenticated','public.'||relation_name,'select') then
      raise exception using errcode='42501',message='V2369_OPERATIONAL_READ_GRANT_MISSING:'||relation_name;
    end if;
  end loop;
  if has_table_privilege('anon','public.ph_app_users','select')
     or has_table_privilege('anon','public.user_access_control','select') then
    raise exception using errcode='42501',message='V2369_PRIVATE_IDENTITY_RELATION_EXPOSED';
  end if;
  if exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v'
      and c.relname=any(array['ph_active_drive_mode','ph_active_reserves','ph_active_orders','ph_active_suspend',
        'ph_active_request','ph_request_history','ph_delivery_outbox','ph_request_delivery_status','ph_aura_domain_glossary'])
      and not coalesce(c.reloptions,'{}'::text[])@>array['security_invoker=true']
  ) then
    raise exception using errcode='55000',message='V2369_SECURITY_INVOKER_CONTRACT_FAILED';
  end if;
end
$final_contract$;

commit;
