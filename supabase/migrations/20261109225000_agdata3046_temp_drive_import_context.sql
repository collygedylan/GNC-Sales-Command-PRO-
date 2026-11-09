begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- The direct publisher already owns an indexed typed stage. Freeze the
-- pre-write identity map, and project raw values from their original source
-- ordinal without another heap/TOAST/WAL copy or a shared-table ANALYZE.
create function private.open_master_bulk_temp_context_v3046(p_run uuid,p_request uuid)
returns void language plpgsql set search_path='' as $open$
declare
  backend integer := pg_backend_pid();
  transaction_id bigint := txid_current();
begin
  drop view if exists pg_temp.ph_master_bulk_context_v3046;
  drop table if exists pg_temp.ph_master_bulk_context_keys_v3046;
  create temp table ph_master_bulk_context_keys_v3046 on commit drop as
  select row_number,source_unique_id,canonical_unique_id from pg_temp.ph_master_bulk_map_v1;
  create unique index on pg_temp.ph_master_bulk_context_keys_v3046(source_unique_id);
  create unique index on pg_temp.ph_master_bulk_context_keys_v3046(canonical_unique_id);
  analyze pg_temp.ph_master_bulk_context_keys_v3046 (source_unique_id,canonical_unique_id,row_number);
  execute format($view$create temp view ph_master_bulk_context_v3046 as
    select %L::uuid as run_id,%L::uuid as request_id,%L::integer as backend_pid,%L::bigint as transaction_id,
      k.source_unique_id,k.canonical_unique_id,s.raw_values,s.raw_item6_fields,s.source_hash,false as new_insert_verified
    from pg_temp.ph_master_bulk_context_keys_v3046 k
    join pg_temp.ph_master_bulk_stage_v1 s using(row_number)$view$,p_run,p_request,backend,transaction_id);
  perform set_config('agdata.erp.master_bulk_context_v3046',
    concat_ws(':',p_run,p_request,backend,transaction_id),true);
end
$open$;

-- A connection's temp schema and custom settings alone confer no authority.
-- Only the canonical definer's view in the exact run/backend/xid can be used.
create function private.master_bulk_temp_context_active_v3046(p_run uuid,p_request uuid default null)
returns boolean language plpgsql stable set search_path='' as $active$
declare marker text := current_setting('agdata.erp.master_bulk_context_v3046',true);
begin
  if p_run is null or split_part(coalesce(marker,''),':',1)<>p_run::text
    or (p_request is not null and split_part(marker,':',2)<>p_request::text)
    or split_part(marker,':',3)<>pg_backend_pid()::text
    or split_part(marker,':',4)<>txid_current()::text then return false; end if;
  return exists(
    select 1 from pg_class v
    join pg_class owner on owner.oid='app_sync_private.ph_master_bulk_import_context_v1'::regclass
    where v.relnamespace=pg_my_temp_schema() and v.relname='ph_master_bulk_context_v3046'
      and v.relkind='v' and v.relpersistence='t' and v.relowner=owner.relowner
  );
end
$active$;

-- Both the per-row deferral check and the eventual Crop Roll write share this
-- same run/request witness. The legacy staged finalizer keeps its old witness.
create function private.has_master_bulk_context_v3046(p_run uuid,p_request uuid)
returns boolean language plpgsql stable set search_path='' as $has$
begin
  if private.master_bulk_temp_context_active_v3046(p_run,p_request) then
    return exists(select 1 from pg_temp.ph_master_bulk_context_v3046 c
      where c.run_id=p_run and c.request_id=p_request);
  end if;
  return exists(select 1 from app_sync_private.ph_master_bulk_import_context_v1 c
    where c.run_id=p_run and c.request_id=p_request and c.backend_pid=pg_backend_pid()
      and c.transaction_id=txid_current());
end
$has$;

do $lookup$
declare
  definition text := pg_get_functiondef('private.ph_master_bulk_context_v1(uuid,text)'::regprocedure);
  header text := 'FUNCTION private.ph_master_bulk_context_v1(';
  body_at text := 'begin'||chr(10)||'  select c.* into matched';
  permanent_read text := 'app_sync_private.ph_master_bulk_import_context_v1 c';
begin
  if strpos(definition,header)=0 or strpos(definition,body_at)=0 or strpos(definition,permanent_read)=0 then
    raise exception 'ERP_MASTER_TEMP_CONTEXT_LOOKUP_ANCHOR_MISSING';
  end if;
  -- Compile the installed four-way source/canonical/priority/item6 lookup
  -- against the temp view too, keeping the return type and precedence exact.
  execute replace(replace(definition,header,'FUNCTION private.ph_master_bulk_temp_context_v3046('),
    permanent_read,'pg_temp.ph_master_bulk_context_v3046 c');
  execute replace(definition,body_at,$route$begin
  if private.master_bulk_temp_context_active_v3046(p_run_id) then
    return private.ph_master_bulk_temp_context_v3046(p_run_id,p_unique_id);
  end if;
  select c.* into matched$route$);
end
$lookup$;

do $crop$
declare
  definition text := pg_get_functiondef('private.ph_master_bulk_crop_roll_defer_active_v1()'::regprocedure);
  prior_defer text := $proof$exists(
        select 1 from app_sync_private.ph_master_bulk_import_context_v1 c
        where c.run_id=v_run_id and c.request_id=v_request_id and c.backend_pid=pg_backend_pid()
          and c.transaction_id=txid_current())$proof$;
  prior_sync text := $proof$exists(select 1 from app_sync_private.ph_master_bulk_import_context_v1 c
        where c.run_id=p_run_id and c.request_id=p_request_id and c.backend_pid=pg_backend_pid()
          and c.transaction_id=txid_current())$proof$;
begin
  if strpos(definition,prior_defer)=0 then raise exception 'ERP_MASTER_TEMP_CONTEXT_CROP_DEFER_ANCHOR_MISSING'; end if;
  execute replace(definition,prior_defer,'private.has_master_bulk_context_v3046(v_run_id,v_request_id)');
  definition:=pg_get_functiondef('private.sync_ph_master_bulk_crop_roll_v1(uuid,uuid,text[])'::regprocedure);
  if strpos(definition,prior_sync)=0 then raise exception 'ERP_MASTER_TEMP_CONTEXT_CROP_SYNC_ANCHOR_MISSING'; end if;
  execute replace(definition,prior_sync,'private.has_master_bulk_context_v3046(p_run_id,p_request_id)');
end
$crop$;

do $publish$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  begin_at integer := strpos(definition,'  insert into app_sync_private.ph_master_bulk_import_context_v1(');
  end_at integer := strpos(definition,'  previous_crop_roll_marker :=');
  prior_delete text := $delete$  delete from app_sync_private.ph_master_bulk_import_context_v1
  where run_id = p_run_id and request_id = p_request_id
    and backend_pid = pg_backend_pid() and transaction_id = txid_current();$delete$;
  prior_read text := 'from app_sync_private.ph_master_bulk_import_context_v1 c';
begin
  if begin_at=0 or end_at<=begin_at or strpos(definition,prior_delete)=0
    or length(definition)-length(replace(definition,prior_read,''))<>2*length(prior_read) then
    raise exception 'ERP_MASTER_TEMP_CONTEXT_PUBLISH_ANCHOR_MISSING';
  end if;
  definition:=overlay(definition placing
    '  perform private.open_master_bulk_temp_context_v3046(p_run_id,p_request_id);'||chr(10)
    from begin_at for end_at-begin_at);
  definition:=replace(definition,prior_read,'from pg_temp.ph_master_bulk_context_v3046 c');
  execute replace(definition,prior_delete,$close$  perform set_config('agdata.erp.master_bulk_context_v3046','',true);
  drop view pg_temp.ph_master_bulk_context_v3046;
  drop table pg_temp.ph_master_bulk_context_keys_v3046;$close$);
end
$publish$;

revoke all on function private.open_master_bulk_temp_context_v3046(uuid,uuid),
  private.master_bulk_temp_context_active_v3046(uuid,uuid),private.has_master_bulk_context_v3046(uuid,uuid),
  private.ph_master_bulk_temp_context_v3046(uuid,text) from public,anon,authenticated,service_role;
commit;
