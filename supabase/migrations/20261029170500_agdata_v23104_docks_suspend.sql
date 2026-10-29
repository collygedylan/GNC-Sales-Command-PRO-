begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- SOC order rows can carry a supplier itemcode prefix ending in a dot while
-- DriveAround has the canonical code. Resolve only an unambiguous exact
-- location/lot pair, in one set-based statement, and never change row identity.
-- fast_commit_erp_stage_swap_v1 dispatches SOC/Drive imports through the
-- canonical snapshot ingesters; these statement triggers run inside that
-- transaction before the import is marked READY, without replacing its RPC.
create or replace function private.normalize_soc_itemcode_from_master_v23104()
returns trigger
language plpgsql
security definer
set search_path=''
set statement_timeout='2s'
set lock_timeout='250ms'
as $function$
begin
  if not exists(select 1 from new_inventory_rows
    where nullif(btrim(itemcode),'') is not null
      and nullif(btrim(locationcode),'') is not null
      and nullif(btrim(lotcode),'') is not null) then return null; end if;
  with impacted_prefixes as (
    select distinct rtrim(upper(btrim(soc.itemcode)),'.') as item_prefix,
      upper(btrim(soc.locationcode)) as locationcode,upper(btrim(soc.lotcode)) as lotcode
    from new_inventory_rows as changed
    join public.ph_soc_master as soc
      on upper(btrim(soc.locationcode))=upper(btrim(changed.locationcode))
     and upper(btrim(soc.lotcode))=upper(btrim(changed.lotcode))
     and right(btrim(soc.itemcode),1)='.'
     and upper(btrim(changed.itemcode))>=rtrim(upper(btrim(soc.itemcode)),'.')||'.'
     and upper(btrim(changed.itemcode))<rtrim(upper(btrim(soc.itemcode)),'.')||'/'
    where nullif(btrim(changed.itemcode),'') is not null
  ), canonical as (
    select prefix.item_prefix,prefix.locationcode,prefix.lotcode,
      min(upper(btrim(inventory.itemcode))) as itemcode
    from impacted_prefixes as prefix
    join public.ph_master_inventory as inventory
      on upper(btrim(inventory.locationcode))=prefix.locationcode
     and upper(btrim(inventory.lotcode))=prefix.lotcode
     and inventory.itemcode is not null and btrim(inventory.itemcode)<>''
     and upper(btrim(inventory.itemcode))>=prefix.item_prefix||'.'
     and upper(btrim(inventory.itemcode))<prefix.item_prefix||'/'
     and length(upper(btrim(inventory.itemcode)))>length(prefix.item_prefix)+1
    group by prefix.item_prefix,prefix.locationcode,prefix.lotcode
    having count(distinct upper(btrim(inventory.itemcode)))=1
  ), matched as (
    select soc.unique_id, min(c.itemcode) as itemcode
    from public.ph_soc_master as soc
    join canonical as c
      on c.locationcode=upper(btrim(soc.locationcode))
     and c.lotcode=upper(btrim(soc.lotcode))
     and c.item_prefix=rtrim(upper(btrim(soc.itemcode)),'.')
    where right(btrim(soc.itemcode),1)='.'
    group by soc.unique_id,upper(btrim(soc.itemcode)),upper(btrim(soc.locationcode)),upper(btrim(soc.lotcode))
    having count(distinct c.itemcode)=1
  )
  update public.ph_soc_master as soc
    set itemcode=matched.itemcode
  from matched
  where soc.unique_id=matched.unique_id
    and soc.itemcode is distinct from matched.itemcode;
  return null;
end
$function$;

revoke all on function private.normalize_soc_itemcode_from_master_v23104() from public,anon,authenticated,service_role;

create or replace function private.normalize_soc_itemcode_after_import_v23104()
returns trigger
language plpgsql
security definer
set search_path=''
set statement_timeout='2s'
set lock_timeout='250ms'
as $function$
begin
  if not exists(select 1 from new_soc_rows
    where right(btrim(itemcode),1)='.'
      and nullif(btrim(locationcode),'') is not null
      and nullif(btrim(lotcode),'') is not null) then return null; end if;
  with changed_soc as (
    select unique_id,rtrim(upper(btrim(itemcode)),'.') as item_prefix,
      upper(btrim(locationcode)) as locationcode,upper(btrim(lotcode)) as lotcode
    from new_soc_rows
    where right(btrim(itemcode),1)='.'
      and nullif(btrim(locationcode),'') is not null
      and nullif(btrim(lotcode),'') is not null
  ), canonical as (
    select changed.unique_id,changed.item_prefix,changed.locationcode,changed.lotcode,
      min(upper(btrim(inventory.itemcode))) as itemcode
    from changed_soc as changed
    join public.ph_master_inventory as inventory
      on upper(btrim(inventory.locationcode))=changed.locationcode
     and upper(btrim(inventory.lotcode))=changed.lotcode
     and inventory.itemcode is not null and btrim(inventory.itemcode)<>''
     and upper(btrim(inventory.itemcode))>=changed.item_prefix||'.'
     and upper(btrim(inventory.itemcode))<changed.item_prefix||'/'
     and length(upper(btrim(inventory.itemcode)))>length(changed.item_prefix)+1
    group by changed.unique_id,changed.item_prefix,changed.locationcode,changed.lotcode
    having count(distinct upper(btrim(inventory.itemcode)))=1
  )
  update public.ph_soc_master as soc
  set itemcode=canonical.itemcode
  from canonical
  where soc.unique_id=canonical.unique_id
    and soc.itemcode is distinct from canonical.itemcode;
  return null;
end
$function$;

revoke all on function private.normalize_soc_itemcode_after_import_v23104() from public,anon,authenticated,service_role;

create or replace function private.normalize_soc_itemcode_from_current_master_v23104()
returns integer
language plpgsql
security definer
set search_path=''
set statement_timeout='30s'
set lock_timeout='5s'
as $function$
declare normalized_rows integer:=0; previous_defer text:=current_setting('agdata.fast_erp_defer_history',true);
begin
  perform set_config('agdata.fast_erp_defer_history','on',true);
  with matched as (
    select soc.unique_id,min(upper(btrim(inventory.itemcode))) as itemcode
    from public.ph_soc_master as soc
    join public.ph_master_inventory as inventory
      on upper(btrim(inventory.locationcode))=upper(btrim(soc.locationcode))
     and upper(btrim(inventory.lotcode))=upper(btrim(soc.lotcode))
     and inventory.itemcode is not null and btrim(inventory.itemcode)<>''
     and upper(btrim(inventory.itemcode))>=rtrim(upper(btrim(soc.itemcode)),'.')||'.'
     and upper(btrim(inventory.itemcode))<rtrim(upper(btrim(soc.itemcode)),'.')||'/'
     and length(upper(btrim(inventory.itemcode)))>length(rtrim(upper(btrim(soc.itemcode)),'.'))+1
    where right(btrim(soc.itemcode),1)='.'
      and nullif(btrim(soc.locationcode),'') is not null
      and nullif(btrim(soc.lotcode),'') is not null
    group by soc.unique_id,upper(btrim(soc.itemcode)),upper(btrim(soc.locationcode)),upper(btrim(soc.lotcode))
    having count(distinct upper(btrim(inventory.itemcode)))=1
  )
  update public.ph_soc_master as soc
  set itemcode=matched.itemcode
  from matched
  where soc.unique_id=matched.unique_id and soc.itemcode is distinct from matched.itemcode;
  get diagnostics normalized_rows=row_count;
  perform set_config('agdata.fast_erp_defer_history',coalesce(previous_defer,'off'),true);
  if normalized_rows>0 then perform private.refresh_soc_order_history_v2366(null); end if;
  return normalized_rows;
end
$function$;
revoke all on function private.normalize_soc_itemcode_from_current_master_v23104() from public,anon,authenticated,service_role;

create or replace function private.normalize_soc_itemcode_from_pairs_v23104(p_pairs jsonb)
returns integer
language plpgsql
security definer
set search_path=''
set statement_timeout='30s'
set lock_timeout='2s'
as $function$
declare normalized_rows integer:=0; previous_defer text:=current_setting('agdata.fast_erp_defer_history',true);
begin
  if coalesce(jsonb_typeof(p_pairs),'')<>'array' then return 0; end if;
  if jsonb_array_length(p_pairs)=0 then return 0; end if;
  perform set_config('agdata.fast_erp_defer_history','on',true);
  with changed_pairs as (
    select distinct upper(btrim(coalesce(row_value->'values',row_value)->>'itemcode')) as itemcode,
      upper(btrim(coalesce(row_value->'values',row_value)->>'locationcode')) as locationcode,
      upper(btrim(coalesce(row_value->'values',row_value)->>'lotcode')) as lotcode
    from jsonb_array_elements(p_pairs) as source(row_value)
    where nullif(btrim(coalesce(row_value->'values',row_value)->>'itemcode'),'') is not null
      and nullif(btrim(coalesce(row_value->'values',row_value)->>'locationcode'),'') is not null
      and nullif(btrim(coalesce(row_value->'values',row_value)->>'lotcode'),'') is not null
  ), impacted_prefixes as (
    select distinct rtrim(upper(btrim(soc.itemcode)),'.') as item_prefix,
      changed.locationcode,changed.lotcode
    from changed_pairs as changed
    join public.ph_soc_master as soc
      on upper(btrim(soc.locationcode))=changed.locationcode
     and upper(btrim(soc.lotcode))=changed.lotcode
     and right(btrim(soc.itemcode),1)='.'
     and changed.itemcode>=rtrim(upper(btrim(soc.itemcode)),'.')||'.'
     and changed.itemcode<rtrim(upper(btrim(soc.itemcode)),'.')||'/'
  ), matched as (
    select soc.unique_id,min(upper(btrim(inventory.itemcode))) as itemcode
    from impacted_prefixes as prefix
    join public.ph_soc_master as soc
      on right(btrim(soc.itemcode),1)='.'
     and rtrim(upper(btrim(soc.itemcode)),'.')=prefix.item_prefix
     and upper(btrim(soc.locationcode))=prefix.locationcode
     and upper(btrim(soc.lotcode))=prefix.lotcode
    join public.ph_master_inventory as inventory
      on upper(btrim(inventory.locationcode))=prefix.locationcode
     and upper(btrim(inventory.lotcode))=prefix.lotcode
     and inventory.itemcode is not null and btrim(inventory.itemcode)<>''
     and upper(btrim(inventory.itemcode))>=prefix.item_prefix||'.'
     and upper(btrim(inventory.itemcode))<prefix.item_prefix||'/'
     and length(upper(btrim(inventory.itemcode)))>length(prefix.item_prefix)+1
    group by soc.unique_id
    having count(distinct upper(btrim(inventory.itemcode)))=1
  )
  update public.ph_soc_master as soc
  set itemcode=matched.itemcode
  from matched
  where soc.unique_id=matched.unique_id and soc.itemcode is distinct from matched.itemcode;
  get diagnostics normalized_rows=row_count;
  perform set_config('agdata.fast_erp_defer_history',coalesce(previous_defer,'off'),true);
  if normalized_rows>0 then perform private.refresh_soc_order_history_v2366(null); end if;
  return normalized_rows;
end
$function$;
revoke all on function private.normalize_soc_itemcode_from_pairs_v23104(jsonb) from public,anon,authenticated,service_role;

-- The master snapshot wrappers intentionally disable user triggers while they
-- swap rows. Carry only the imported physical location/lot/itemcode keys into
-- the indexed resolver; do not rescan all master rows during an import.
create or replace function public.bulk_import_master_snapshot_v1(
  p_run_id uuid,p_request_id uuid,p_rows jsonb,p_source_digest text
)
returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='120s' set lock_timeout='5s' as $function$
declare result_value jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='BULK_MASTER_IMPORT_FORBIDDEN'; end if;
  execute 'alter table public.ph_master_inventory disable trigger user';
  begin
    result_value:=public.bulk_import_master_snapshot_v2374_base(p_run_id,p_request_id,p_rows,p_source_digest);
    update public.ph_master_inventory
    set av_note=public.sanitize_av_note_without_spec_caliper(av_note)
    where av_note is distinct from public.sanitize_av_note_without_spec_caliper(av_note);
  exception when others then
    execute 'alter table public.ph_master_inventory enable trigger user';
    raise;
  end;
  execute 'alter table public.ph_master_inventory enable trigger user';
  perform private.normalize_soc_itemcode_from_pairs_v23104(p_rows);
  return result_value;
end
$function$;

create or replace function public.finalize_master_snapshot_stage_v1(
  p_run_id uuid,p_request_id uuid,p_source_digest text
)
returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='330s' set lock_timeout='5s' as $function$
declare result_value jsonb; normalization_pairs jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='MASTER_SNAPSHOT_STAGE_FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('itemcode',itemcode,'locationcode',locationcode,'lotcode',lotcode)),'[]'::jsonb)
    into normalization_pairs
  from app_sync_private.ph_master_snapshot_stage_rows_v1
  where request_id=p_request_id;
  execute 'alter table public.ph_master_inventory disable trigger user';
  begin
    result_value:=public.finalize_master_snapshot_stage_v2374_base(p_run_id,p_request_id,p_source_digest);
  exception when others then
    execute 'alter table public.ph_master_inventory enable trigger user';
    raise;
  end;
  execute 'alter table public.ph_master_inventory enable trigger user';
  perform private.normalize_soc_itemcode_from_pairs_v23104(normalization_pairs);
  return result_value;
end
$function$;

drop trigger if exists ph_master_normalize_soc_itemcode_insert_v23104 on public.ph_master_inventory;
create trigger ph_master_normalize_soc_itemcode_insert_v23104
after insert on public.ph_master_inventory
referencing new table as new_inventory_rows
for each statement execute function private.normalize_soc_itemcode_from_master_v23104();
drop trigger if exists ph_master_normalize_soc_itemcode_update_v23104 on public.ph_master_inventory;
create trigger ph_master_normalize_soc_itemcode_update_v23104
after update on public.ph_master_inventory
referencing new table as new_inventory_rows
for each statement execute function private.normalize_soc_itemcode_from_master_v23104();
drop trigger if exists ph_soc_normalize_itemcode_insert_v23104 on public.ph_soc_master;
create trigger ph_soc_normalize_itemcode_insert_v23104
after insert on public.ph_soc_master
referencing new table as new_soc_rows
for each statement execute function private.normalize_soc_itemcode_after_import_v23104();
drop trigger if exists ph_soc_normalize_itemcode_update_v23104 on public.ph_soc_master;
create trigger ph_soc_normalize_itemcode_update_v23104
after update on public.ph_soc_master
referencing new table as new_soc_rows
for each statement execute function private.normalize_soc_itemcode_after_import_v23104();

-- Backfill currently imported SOC rows with the same exact-pair, unique-code
-- rule used by the import-time statement triggers above.
select private.normalize_soc_itemcode_from_current_master_v23104();

notify pgrst,'reload schema';
commit;
