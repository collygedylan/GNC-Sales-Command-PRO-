begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

-- Reconcile field overrides set-wise while the bulk importer still has its
-- verified raw Drive values and canonical row map. The wrapper disables USER
-- triggers during publication, so the row trigger cannot protect this path.
create or replace function private.apply_inventory_live_overrides_bulk_v1(p_run_id uuid)
returns void
language plpgsql security definer set search_path=''
as $function$
declare
  is_canonical boolean:=false;
  v_field_name text;
begin
  if to_regclass('pg_temp.ph_master_bulk_stage_v1') is null
    or to_regclass('pg_temp.ph_master_bulk_map_v1') is null then
    raise exception using errcode='55000',message='INVENTORY_LIVE_OVERRIDE_STAGE_REQUIRED';
  end if;
  select 'ph_master_inventory'=any(r.canonical_keys) into is_canonical
    from app_sync_private.import_runs r where r.id=p_run_id;
  if not coalesce(is_canonical,false) then return; end if;

  -- Only raw source fields can acknowledge an override. A missing row or field
  -- remains pending; its durable application value is retained on any staged
  -- physical row that still resolves to that canonical identity.
  for v_field_name in
    select distinct e.field_name from app_sync_private.inventory_live_overrides_v1 e
    where e.pending order by e.field_name
  loop
    -- Acknowledge only the exact raw ERP field for a unique canonical row.
    update app_sync_private.inventory_live_overrides_v1 e set pending=false,
      latest_erp_value=s.raw_values->e.field_name,reconciled_at=clock_timestamp(),updated_at=clock_timestamp()
    from pg_temp.ph_master_bulk_map_v1 mapped
    join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
    where mapped.canonical_unique_id=e.canonical_unique_id and mapped.candidate_count=1
      and mapped.row_number=s.row_number and e.field_name=v_field_name and e.pending
      and s.raw_values ? e.field_name
      and private.inventory_override_matches_v1(e.field_name,s.raw_values->e.field_name,e.app_override_value);

    update app_sync_private.inventory_live_overrides_v1 e set
      latest_erp_value=s.raw_values->e.field_name,updated_at=clock_timestamp()
    from pg_temp.ph_master_bulk_map_v1 mapped
    join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
    where mapped.canonical_unique_id=e.canonical_unique_id and mapped.candidate_count=1
      and mapped.row_number=s.row_number and e.field_name=v_field_name and e.pending
      and s.raw_values ? e.field_name;

    -- Preserve the app value on staged rows for mismatched or omitted fields.
    execute format(
      'update pg_temp.ph_master_bulk_stage_v1 s set %1$I=(jsonb_populate_record(s,jsonb_build_object($1,e.app_override_value))).%1$I from pg_temp.ph_master_bulk_map_v1 mapped join app_sync_private.inventory_live_overrides_v1 e on e.canonical_unique_id=mapped.canonical_unique_id where mapped.row_number=s.row_number and mapped.candidate_count=1 and e.field_name=$1 and e.pending and (not (s.raw_values ? e.field_name) or not private.inventory_override_matches_v1(e.field_name,s.raw_values->e.field_name,e.app_override_value))',
      v_field_name
    ) using v_field_name;
  end loop;

  -- Season-level stock edits also apply to newly arriving physical rows. Keep
  -- their per-row audit until exact raw Drive values match; missing live rows
  -- block acknowledgement and remain protected by the deletion fence below.
  foreach v_field_name in array array['s_lts','season_oh'] loop
    update app_sync_private.inventory_live_overrides_v1 e set pending=false,
      latest_erp_value=stage.raw_values->v_field_name,reconciled_at=clock_timestamp(),updated_at=clock_timestamp()
    from pg_temp.ph_master_bulk_stage_v1 stage
    join pg_temp.ph_master_bulk_map_v1 mapped using(row_number)
    join app_sync_private.inventory_season_stock_overrides_v1 season_stock
      on season_stock.itemcode=stage.itemcode and season_stock.pending
      and private.inventory_stock_season_v1(stage.lotcode,stage.season)=season_stock.season
    where mapped.candidate_count<=1 and e.canonical_unique_id=coalesce(mapped.canonical_unique_id,stage.unique_id)
      and e.field_name=v_field_name and e.pending and stage.raw_values ? v_field_name
      and private.inventory_override_matches_v1(v_field_name,stage.raw_values->v_field_name,
        to_jsonb(case when v_field_name='s_lts' then season_stock.open_stock::text else season_stock.season_oh::text end));

    insert into app_sync_private.inventory_live_overrides_v1 as e(
      canonical_unique_id,field_name,itemcode,locationcode,lotcode,
      erp_baseline_value,app_override_value,latest_erp_value,updated_by
    )
    select coalesce(mapped.canonical_unique_id,stage.unique_id),v_field_name,stage.itemcode,stage.locationcode,stage.lotcode,
      case when stage.raw_values ? v_field_name then stage.raw_values->v_field_name end,
      to_jsonb(case when v_field_name='s_lts' then season_stock.open_stock::text else season_stock.season_oh::text end),
      case when stage.raw_values ? v_field_name then stage.raw_values->v_field_name end,season_stock.updated_by
    from pg_temp.ph_master_bulk_stage_v1 stage
    join pg_temp.ph_master_bulk_map_v1 mapped using(row_number)
    join app_sync_private.inventory_season_stock_overrides_v1 season_stock
      on season_stock.itemcode=stage.itemcode and season_stock.pending
      and private.inventory_stock_season_v1(stage.lotcode,stage.season)=season_stock.season
    where mapped.candidate_count<=1
      and (not (stage.raw_values ? v_field_name) or not private.inventory_override_matches_v1(
        v_field_name,stage.raw_values->v_field_name,
        to_jsonb(case when v_field_name='s_lts' then season_stock.open_stock::text else season_stock.season_oh::text end)
      ))
    on conflict(canonical_unique_id,field_name) do update set
      erp_baseline_value=case when e.pending then e.erp_baseline_value else excluded.erp_baseline_value end,
      app_override_value=excluded.app_override_value,latest_erp_value=excluded.latest_erp_value,
      pending=true,reconciled_at=null,updated_by=excluded.updated_by,updated_at=clock_timestamp();

    execute format(
      'update pg_temp.ph_master_bulk_stage_v1 stage set %1$I=(jsonb_populate_record(stage,jsonb_build_object($1,case when $1=''s_lts'' then season_stock.open_stock::text else season_stock.season_oh::text end))).%1$I from pg_temp.ph_master_bulk_map_v1 mapped,app_sync_private.inventory_season_stock_overrides_v1 season_stock where mapped.row_number=stage.row_number and mapped.candidate_count<=1 and season_stock.itemcode=stage.itemcode and season_stock.pending and private.inventory_stock_season_v1(stage.lotcode,stage.season)=season_stock.season',
      v_field_name
    ) using v_field_name;
  end loop;

  update app_sync_private.inventory_season_stock_overrides_v1 season_stock set pending=false,updated_at=clock_timestamp()
  where season_stock.pending and season_stock.cav_acknowledged
    and exists(select 1 from public.ph_master_inventory live
      where live.itemcode=season_stock.itemcode
        and private.inventory_stock_season_v1(live.lotcode,live.season)=season_stock.season)
    and not exists(select 1 from public.ph_master_inventory live
      where live.itemcode=season_stock.itemcode
        and private.inventory_stock_season_v1(live.lotcode,live.season)=season_stock.season
        and not exists(select 1 from pg_temp.ph_master_bulk_map_v1 mapped
          join pg_temp.ph_master_bulk_stage_v1 stage using(row_number)
          where mapped.canonical_unique_id=live.unique_id and mapped.candidate_count=1
            and stage.raw_values ? 's_lts'
            and private.inventory_override_matches_v1('s_lts',stage.raw_values->'s_lts',to_jsonb(season_stock.open_stock::text))))
    and not exists(select 1 from app_sync_private.inventory_live_overrides_v1 e
      where e.itemcode=season_stock.itemcode and e.field_name='s_lts' and e.pending
        and private.inventory_stock_season_v1(e.lotcode,'')=season_stock.season);
end
$function$;
revoke all on function private.apply_inventory_live_overrides_bulk_v1(uuid) from public,anon,authenticated,service_role;

do $patch_master_bulk_import$
declare
  definition text:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  overlay_hook text:='  perform private.apply_inventory_reclass_import_overlay_v1(p_run_id,p_request_id);';
  overlay_replacement text:=overlay_hook||E'\n  perform private.apply_inventory_live_overrides_bulk_v1(p_run_id);';
  delete_hook text:=E'      and not exists (\n      select 1 from pg_temp.ph_master_bulk_map_v1 m where m.canonical_unique_id = live.unique_id\n    ) returning unique_id';
  delete_replacement text:=E'      and not exists (select 1 from app_sync_private.inventory_live_overrides_v1 held where held.canonical_unique_id=live.unique_id and held.pending)\n      and not exists (select 1 from app_sync_private.inventory_season_stock_overrides_v1 held where held.itemcode=live.itemcode and held.season=private.inventory_stock_season_v1(live.lotcode,live.season) and held.pending)\n      and not exists (\n      select 1 from pg_temp.ph_master_bulk_map_v1 m where m.canonical_unique_id = live.unique_id\n    ) returning unique_id';
begin
  if definition is null then raise exception 'V2397_BULK_MASTER_IMPORT_BASE_MISSING'; end if;
  if position('apply_inventory_live_overrides_bulk_v1(p_run_id)' in definition)=0 then
    if length(definition)-length(replace(definition,overlay_hook,''))<>length(overlay_hook) then
      raise exception 'V2397_BULK_OVERRIDE_OVERLAY_ANCHOR_MISMATCH';
    end if;
    definition:=replace(definition,overlay_hook,overlay_replacement);
  end if;
  if position('inventory_live_overrides_v1 held where held.canonical_unique_id=live.unique_id and held.pending' in definition)=0 then
    if length(definition)-length(replace(definition,delete_hook,''))<>length(delete_hook) then
      raise exception 'V2397_BULK_OVERRIDE_DELETE_ANCHOR_MISMATCH';
    end if;
    definition:=replace(definition,delete_hook,delete_replacement);
  end if;
  execute definition;
end
$patch_master_bulk_import$;

-- A stale SOC UID may be recovered for Add Candidates only when the current
-- eligible row is the unique exact physical order line. A present but replaced
-- source row is never revived by identity fallback.
do $patch_suspend_add_candidates_identity$
declare
  definition text:=pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
  old_recovery text:='if s.unique_id is null and jsonb_typeof(p_payload->''sourceIdentity'')=''object'' then';
  new_recovery text:='if s.unique_id is null and p_operation=''close'' and jsonb_typeof(p_payload->''sourceIdentity'')=''object'' then';
  old_missing text:=' if s.unique_id is null then raise exception ''SUSPEND_TAG_SOURCE_MISSING'' using errcode=''P0002''; end if;';
  new_missing text:=E' if s.unique_id is null and p_operation=''add_candidates'' and jsonb_typeof(p_payload->''sourceIdentity'')=''object'' then\n'
    ||E'   select min(candidate.unique_id) into candidate_uid from public.ph_soc_master candidate\n'
    ||E'   where suspend_tag_private.eligible(candidate.suspend,candidate.suspend_to)\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''transactionnumber''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''tagcode''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''dock''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''stopnumber''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''itemcode''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''locationcode''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''lotcode''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''quantityshipped''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''customer''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''consignee''),'''') is not null\n'
    ||E'     and nullif(btrim(p_payload->''sourceIdentity''->>''salesrep''),'''') is not null\n'
    ||E'     and upper(btrim(candidate.transactionnumber))=upper(btrim(p_payload->''sourceIdentity''->>''transactionnumber''))\n'
    ||E'     and upper(btrim(candidate.tagcode))=upper(btrim(p_payload->''sourceIdentity''->>''tagcode''))\n'
    ||E'     and upper(btrim(candidate.dock))=upper(btrim(p_payload->''sourceIdentity''->>''dock''))\n'
    ||E'     and upper(btrim(candidate.stopnumber))=upper(btrim(p_payload->''sourceIdentity''->>''stopnumber''))\n'
    ||E'     and upper(btrim(candidate.itemcode))=upper(btrim(p_payload->''sourceIdentity''->>''itemcode''))\n'
    ||E'     and upper(btrim(candidate.locationcode))=upper(btrim(p_payload->''sourceIdentity''->>''locationcode''))\n'
    ||E'     and upper(btrim(coalesce(candidate.lotcode,'''')))=upper(btrim(coalesce(p_payload->''sourceIdentity''->>''lotcode'','''')))\n'
    ||E'     and coalesce(nullif(regexp_replace(candidate.quantityshipped,''[^0-9.-]'','''',''g''),''''),''0'')::numeric\n'
    ||E'       =coalesce(nullif(regexp_replace(p_payload->''sourceIdentity''->>''quantityshipped'',''[^0-9.-]'','''',''g''),''''),''0'')::numeric\n'
    ||E'     and upper(btrim(coalesce(candidate.customeridentityid,candidate.customername,'''')))=upper(btrim(p_payload->''sourceIdentity''->>''customer''))\n'
    ||E'     and upper(btrim(coalesce(candidate.consigneeidentityid,candidate.consigneename,'''')))=upper(btrim(p_payload->''sourceIdentity''->>''consignee''))\n'
    ||E'     and upper(btrim(coalesce(candidate.salesrepid,candidate.salesrepname,'''')))=upper(btrim(p_payload->''sourceIdentity''->>''salesrep''))\n'
    ||E'   having count(*)=1;\n'
    ||E'   if candidate_uid is not null then\n'
    ||E'     select * into s from public.ph_soc_master candidate where candidate.unique_id=candidate_uid for update;\n'
    ||E'     uid:=candidate_uid;\n'
    ||E'     p_payload:=jsonb_set(p_payload,''{expectedLastUpdated}'',to_jsonb(s.last_updated::text),true);\n'
    ||E'   end if;\n'
    ||E' end if;\n'
    ||old_missing;
begin
  if position('suspend-add-candidates-physical-identity-v2397' in definition)>0 then return; end if;
  if (length(definition)-length(replace(definition,old_recovery,'')))/length(old_recovery)<>1
    or (length(definition)-length(replace(definition,old_missing,'')))/length(old_missing)<>1 then
    raise exception 'V2397_SUSPEND_SOURCE_IDENTITY_ANCHOR_MISMATCH';
  end if;
  definition:=replace(definition,old_recovery,new_recovery);
  definition:=replace(definition,old_missing,' -- suspend-add-candidates-physical-identity-v2397: exact one-row recovery only.'||E'\n'||new_missing);
  execute definition;
end
$patch_suspend_add_candidates_identity$;

-- Compatibility name exposes the existing canonical movement ledger to the
-- service role only; it does not create a second source of truth.
grant select on private.ph_inventory_reclass_movements_v1 to service_role;
create or replace view public.ph_inventory_reclass_moves with (security_invoker=true) as
select id,request_id,line_index,direction,destination_season,quantity,source_unique_id,destination_unique_id,
  source_lineage_key,destination_lineage_key,source_identity,destination_identity,source_before,source_after,
  destination_before,destination_after,status,conflict_reason,updated_at
from private.ph_inventory_reclass_movements_v1;
revoke all on public.ph_inventory_reclass_moves from public,anon,authenticated;
grant select on public.ph_inventory_reclass_moves to service_role;

do $installed$
declare definition text:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
begin
  if position('apply_inventory_reclass_import_overlay_v1(p_run_id,p_request_id)' in definition)=0
    or position('apply_inventory_live_overrides_bulk_v1(p_run_id)' in definition)=0
    or position('inventory_season_stock_overrides_v1 held' in definition)=0
    or not exists(select 1 from pg_proc p where p.oid='private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure
      and p.prosecdef and p.proconfig @> array['search_path=""']::text[])
    or exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
      where p.oid='public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure
        and (r.rolname<>'postgres' or not p.prosecdef)) then
    raise exception 'V2397_BULK_OVERRIDE_IMPORT_CONTRACT_INVALID';
  end if;
end
$installed$;

notify pgrst,'reload schema';
commit;
