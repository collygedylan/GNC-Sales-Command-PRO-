ALTER TABLE public.ph_master_inventory ADD COLUMN IF NOT EXISTS erp_on_hand numeric,ADD COLUMN IF NOT EXISTS erp_ptrreview numeric,ADD COLUMN IF NOT EXISTS erp_available numeric;
CREATE TABLE IF NOT EXISTS private.inventory_order_reconciliation_v23196(run_id uuid,canonical_unique_id text,old_erp_on_hand numeric,new_erp_on_hand numeric,old_erp_ptrreview numeric,new_erp_ptrreview numeric,pending_reclass_out_qty numeric,order_delta numeric,old_loc_photo_match numeric,new_loc_photo_match numeric,photo_expired boolean,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(run_id,canonical_unique_id));
REVOKE ALL ON private.inventory_order_reconciliation_v23196 FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.inventory_order_reconciliation_v23196 TO service_role;
CREATE OR REPLACE FUNCTION private.erp_order_delta_v23196(old_oh numeric,old_review numeric,new_oh numeric,new_review numeric,pending_out numeric) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT greatest(0,new_review-old_review)+greatest(0,(old_oh-greatest(0,pending_out))-new_oh) $$;
REVOKE ALL ON FUNCTION private.erp_order_delta_v23196(numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.apply_inventory_live_overrides_bulk_v1(p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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


  drop table if exists pg_temp.erp_order_delta_v23196;
  create temp table erp_order_delta_v23196 on commit drop as
  with pending as (select canonical_unique_id,jsonb_object_agg(field_name,to_jsonb(e)) fields from app_sync_private.inventory_live_overrides_v1 e where field_name in ('ptronhand','ptrreviewed','ptravailable') group by 1), raw as (
    select s.row_number,m.unique_id, to_jsonb(m) old_row,
    coalesce(m.erp_on_hand,private.inventory_location_evidence_number_v2(p.fields->'ptronhand'->>'latest_erp_value'),private.inventory_location_evidence_number_v2(m.ptronhand),0) old_oh,
    coalesce(m.erp_ptrreview,private.inventory_location_evidence_number_v2(p.fields->'ptrreviewed'->>'latest_erp_value'),private.inventory_location_evidence_number_v2(m.ptrreviewed),0) old_review,
    coalesce(private.inventory_location_evidence_number_v2(s.raw_values->>'ptronhand'),0) new_oh,
    coalesce(private.inventory_location_evidence_number_v2(s.raw_values->>'ptrreviewed'),0) new_review,
    coalesce(private.inventory_location_evidence_number_v2(s.raw_values->>'ptravailable'),0) new_available,
    case when p.fields->'ptronhand'->>'pending'='true' then greatest(0,coalesce(private.inventory_location_evidence_number_v2(p.fields->'ptronhand'->>'erp_baseline_value')-private.inventory_location_evidence_number_v2(p.fields->'ptronhand'->>'app_override_value'),0)) else 0 end pending_out,
    coalesce(m.loc_photo_match,private.inventory_location_evidence_number_v2(m.loc_match_qty),0) old_match,
    coalesce(m.photo_date,m.av_rule_photo_updated_at,m.date_completed) photo_date,p.fields
    from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 map using(row_number)
    join public.ph_master_inventory m on m.unique_id=map.canonical_unique_id
    left join pending p on p.canonical_unique_id=m.unique_id where map.candidate_count=1
  ) select raw.*,private.erp_order_delta_v23196(old_oh,old_review,new_oh,new_review,pending_out) order_delta from raw;

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

  -- Reapply numeric edits as deltas; fresh ERP order/review changes remain visible.
  foreach v_field_name in array array['ptronhand','ptrreviewed','ptravailable'] loop
    execute format('update pg_temp.ph_master_bulk_stage_v1 s set %1$I=(greatest(0,private.inventory_location_evidence_number_v2(s.raw_values->>$1)+private.inventory_location_evidence_number_v2(e.app_override_value#>>''{}'')-private.inventory_location_evidence_number_v2(e.erp_baseline_value#>>''{}'')))::text from pg_temp.ph_master_bulk_map_v1 map join app_sync_private.inventory_live_overrides_v1 e on e.canonical_unique_id=map.canonical_unique_id where map.row_number=s.row_number and map.candidate_count=1 and e.field_name=$1 and e.pending and s.raw_values ? $1 and e.erp_baseline_value is not null',v_field_name) using v_field_name;
    execute format('update app_sync_private.inventory_live_overrides_v1 e set erp_baseline_value=s.raw_values->$1,app_override_value=to_jsonb(s.%1$I),latest_erp_value=s.raw_values->$1 from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 map using(row_number) where map.canonical_unique_id=e.canonical_unique_id and map.candidate_count=1 and e.field_name=$1 and e.pending and s.raw_values ? $1 and e.erp_baseline_value is not null',v_field_name) using v_field_name;
  end loop;

end
$function$;
CREATE OR REPLACE FUNCTION private.apply_inventory_reclass_import_overlay_v1(p_run_id uuid, p_import_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  movement_request record;
  movement record;
  source_stage record;
  target_stage record;
  source_rows integer;
  source_matches boolean;
  all_pre boolean;
  all_post boolean;
  target_count integer;
  target_pre boolean;
  target_post boolean;
  desired_status text;
  conflict_reason_value text;
begin
  for movement_request in
    select c.request_id, c.operation_order, min(m.source_unique_id) source_uid,
      (array_agg(m.source_before order by m.line_index))[1] source_before,
      (array_agg(m.source_after order by m.line_index))[1] source_after
    from private.ph_inventory_reclass_commands_v1 c
    join private.ph_inventory_reclass_movements_v1 m using(request_id)
    where m.status in ('pending','conflict')
    group by c.request_id,c.operation_order
    order by c.operation_order
  loop
    all_pre := true;
    all_post := true;
    conflict_reason_value := null;
    select count(*) into source_rows
    from pg_temp.ph_master_bulk_map_v1 mapped
    where mapped.canonical_unique_id=movement_request.source_uid;
    if source_rows <> 1 then
      all_pre := false; all_post := false; conflict_reason_value := case when source_rows=0 then 'source_absent' else 'source_duplicate' end;
      if source_rows > 1 then
        perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
          movement_request.request_id,movement_request.source_uid,null,'source_duplicate',
          coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where mapped.canonical_unique_id=movement_request.source_uid),'[]'::jsonb));
        delete from pg_temp.ph_master_bulk_map_v1 mapped where mapped.canonical_unique_id=movement_request.source_uid;
      end if;
    else
      select s.* into source_stage
      from pg_temp.ph_master_bulk_stage_v1 s
      join pg_temp.ph_master_bulk_map_v1 mapped using(row_number)
      where mapped.canonical_unique_id=movement_request.source_uid;
      source_matches := source_stage.itemcode is not distinct from movement_request.source_before->>'itemcode'
        and source_stage.contsize is not distinct from movement_request.source_before->>'contsize'
        and source_stage.locationcode is not distinct from movement_request.source_before->>'locationcode'
        and source_stage.lotcode is not distinct from movement_request.source_before->>'lotcode'
        and source_stage.source is not distinct from movement_request.source_before->>'source';
      all_pre := source_matches
        and source_stage.ptronhand is not distinct from movement_request.source_before->>'ptronhand';
      all_post := source_matches
        and (source_stage.ptronhand is not distinct from movement_request.source_after->>'ptronhand'
          or exists(select 1 from private.ph_inventory_reclass_movements_v1 later
            join private.ph_inventory_reclass_commands_v1 later_command using(request_id)
            where (later.source_unique_id=movement_request.source_uid
                and source_stage.ptronhand is not distinct from later.source_after->>'ptronhand'
              or later.destination_unique_id=movement_request.source_uid
                and source_stage.ptronhand is not distinct from later.destination_after->>'ptronhand')
              and later_command.operation_order>movement_request.operation_order));
      if not source_matches then
        conflict_reason_value := 'source_identity_changed';
        perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
          movement_request.request_id,movement_request.source_uid,null,'source_identity_changed',
          coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where mapped.canonical_unique_id=movement_request.source_uid),'[]'::jsonb));
        delete from pg_temp.ph_master_bulk_map_v1 mapped where mapped.canonical_unique_id=movement_request.source_uid;
      end if;
    end if;

    for movement in select * from private.ph_inventory_reclass_movements_v1 m where m.request_id=movement_request.request_id order by m.destination_unique_id loop
      select count(*) into target_count
      from pg_temp.ph_master_bulk_stage_v1 s
      where s.lineage_key=movement.destination_lineage_key;
      if target_count=1 then
        update pg_temp.ph_master_bulk_map_v1 mapped set canonical_unique_id=alias.canonical_unique_id,candidate_count=1
        from pg_temp.ph_master_bulk_stage_v1 s
        join private.ph_inventory_reclass_import_aliases_v1 alias on alias.lineage_key=s.lineage_key
        where mapped.row_number=s.row_number and s.lineage_key=movement.destination_lineage_key
          and alias.canonical_unique_id=movement.destination_unique_id
          and (mapped.canonical_unique_id is null or mapped.canonical_unique_id=alias.canonical_unique_id);
      elsif target_count>1 then
        all_pre := false; all_post := false; conflict_reason_value := coalesce(conflict_reason_value,'target_duplicate');
        perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
          movement.request_id,null,movement.destination_lineage_key,'target_duplicate',
          coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where s.lineage_key=movement.destination_lineage_key),'[]'::jsonb));
        update private.ph_inventory_reclass_movements_v1 set status='conflict',conflict_reason='target_duplicate',updated_at=clock_timestamp()
        where request_id=movement.request_id and destination_lineage_key=movement.destination_lineage_key;
        delete from pg_temp.ph_master_bulk_map_v1 mapped
        using pg_temp.ph_master_bulk_stage_v1 s
        where mapped.row_number=s.row_number and s.lineage_key=movement.destination_lineage_key;
        continue;
      end if;
      if target_count=0 then
        target_pre := movement.destination_before is null or exists(
          select 1 from private.ph_inventory_reclass_movements_v1 prior
          join private.ph_inventory_reclass_commands_v1 prior_command using(request_id)
          where prior.destination_lineage_key=movement.destination_lineage_key
            and prior.destination_unique_id=movement.destination_unique_id
            and prior.status in ('pending','acknowledged')
            and prior_command.operation_order < movement_request.operation_order
            and prior.destination_after->>'ptronhand'=movement.destination_before->>'ptronhand'
            and prior.destination_after->>'ptravailable'=movement.destination_before->>'ptravailable'
          );
        target_post := false;
      else
        if exists(select 1 from pg_temp.ph_master_bulk_stage_v1 s
          join pg_temp.ph_master_bulk_map_v1 mapped using(row_number)
          where s.lineage_key=movement.destination_lineage_key
            and mapped.canonical_unique_id is distinct from movement.destination_unique_id) then
          all_pre:=false; all_post:=false; conflict_reason_value:=coalesce(conflict_reason_value,'target_alias_conflict');
          target_pre:=false; target_post:=false;
          perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
            movement.request_id,null,movement.destination_lineage_key,'target_alias_conflict',
            coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where s.lineage_key=movement.destination_lineage_key),'[]'::jsonb));
          delete from pg_temp.ph_master_bulk_map_v1 mapped using pg_temp.ph_master_bulk_stage_v1 s
            where mapped.row_number=s.row_number and s.lineage_key=movement.destination_lineage_key;
          continue;
        end if;
        select s.* into target_stage
        from pg_temp.ph_master_bulk_stage_v1 s where s.lineage_key=movement.destination_lineage_key limit 1;
        if target_stage.itemcode is distinct from movement.destination_identity->>'itemcode'
          or target_stage.contsize is distinct from movement.destination_identity->>'contsize'
          or target_stage.locationcode is distinct from movement.destination_identity->>'locationcode'
          or target_stage.source is distinct from movement.destination_identity->>'source'
          or coalesce(target_stage.warehouseid,target_stage.warehousei) is distinct from movement.destination_identity->>'warehouseid'
          or target_stage.season is distinct from movement.destination_identity->>'season'
          or target_stage.desigitem is distinct from movement.destination_identity->>'desigitem'
          or target_stage.desigcust is distinct from movement.destination_identity->>'desigcust'
          or target_stage.desigloc is distinct from movement.destination_identity->>'desigloc' then
          all_pre:=false; all_post:=false; conflict_reason_value:=coalesce(conflict_reason_value,'target_identity_changed');
          perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
            movement.request_id,null,movement.destination_lineage_key,'target_identity_changed',
            coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where s.lineage_key=movement.destination_lineage_key),'[]'::jsonb));
        end if;
        target_pre := movement.destination_before is not null
          and target_stage.ptronhand is not distinct from movement.destination_before->>'ptronhand'
          and target_stage.lotcode is not distinct from movement.destination_identity->>'lotcode';
        target_post := target_stage.lotcode is not distinct from movement.destination_identity->>'lotcode'
          and (target_stage.ptronhand is not distinct from movement.destination_after->>'ptronhand'
            or exists(select 1 from private.ph_inventory_reclass_movements_v1 later
              join private.ph_inventory_reclass_commands_v1 later_command using(request_id)
              where (later.destination_unique_id=movement.destination_unique_id
                  and target_stage.ptronhand is not distinct from later.destination_after->>'ptronhand'
                or later.source_unique_id=movement.destination_unique_id
                  and target_stage.ptronhand is not distinct from later.source_after->>'ptronhand')
                and later_command.operation_order>movement_request.operation_order));
      end if;
      all_pre := all_pre and target_pre;
      all_post := all_post and target_post;
      if not target_pre and not target_post then
        conflict_reason_value := coalesce(conflict_reason_value,'target_quantity_changed');
        perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
          movement.request_id,null,movement.destination_lineage_key,'target_quantity_changed',
          coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where s.lineage_key=movement.destination_lineage_key),'[]'::jsonb));
      end if;
    end loop;

    desired_status := case when all_post then 'acknowledged' when all_pre then 'pending' else 'conflict' end;
    if desired_status='pending' then
      update pg_temp.ph_master_bulk_stage_v1 s set
        ptronhand=movement_request.source_after->>'ptronhand',ptravailable=movement_request.source_after->>'ptravailable'
      from pg_temp.ph_master_bulk_map_v1 mapped
      where mapped.row_number=s.row_number and mapped.canonical_unique_id=movement_request.source_uid;
      for movement in select * from private.ph_inventory_reclass_movements_v1 m where m.request_id=movement_request.request_id loop
        update pg_temp.ph_master_bulk_stage_v1 s set
          ptronhand=movement.destination_after->>'ptronhand',ptravailable=movement.destination_after->>'ptravailable'
        from pg_temp.ph_master_bulk_map_v1 mapped
        where mapped.row_number=s.row_number and mapped.canonical_unique_id=movement.destination_unique_id;
      end loop;
    elsif desired_status='conflict' then
      perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
        movement_request.request_id,movement_request.source_uid,null,coalesce(conflict_reason_value,'incoming_state_ambiguous'),
        coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where mapped.canonical_unique_id=movement_request.source_uid),'[]'::jsonb));
      update pg_temp.ph_master_bulk_stage_v1 s set ptronhand=live.ptronhand,ptravailable=live.ptravailable
      from pg_temp.ph_master_bulk_map_v1 mapped,public.ph_master_inventory live
      where mapped.row_number=s.row_number and live.unique_id=mapped.canonical_unique_id
        and (mapped.canonical_unique_id=movement_request.source_uid or exists(
          select 1 from private.ph_inventory_reclass_movements_v1 m where m.request_id=movement_request.request_id
            and m.destination_unique_id=mapped.canonical_unique_id));
    end if;
    update private.ph_inventory_reclass_movements_v1 set status=desired_status,
      conflict_reason=case when desired_status='conflict' then coalesce(conflict_reason_value,'incoming_state_ambiguous') else null end,
      updated_at=clock_timestamp()
    where request_id=movement_request.request_id;
  end loop;
end
$function$
;
CREATE OR REPLACE FUNCTION public.bulk_import_master_snapshot_v1(p_run_id uuid, p_request_id uuid, p_rows jsonb, p_source_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '180s'
 SET lock_timeout TO '60s'
AS $function$
declare result_value jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='BULK_MASTER_IMPORT_FORBIDDEN'; end if;
  perform set_config('agdata.bulk_import.ph_master_inventory','on',true);
  begin
    result_value:=public.bulk_import_master_snapshot_v2374_base(p_run_id,p_request_id,p_rows,p_source_digest);

    if to_regclass('pg_temp.erp_order_delta_v23196') is not null then
      insert into private.inventory_order_reconciliation_v23196(run_id,canonical_unique_id,old_erp_on_hand,new_erp_on_hand,old_erp_ptrreview,new_erp_ptrreview,pending_reclass_out_qty,order_delta,old_loc_photo_match,new_loc_photo_match,photo_expired)
      select p_run_id,d.unique_id,d.old_oh,d.new_oh,d.old_review,d.new_review,d.pending_out,d.order_delta,d.old_match,greatest(0,d.old_match-d.order_delta),
        (d.old_match>0 and greatest(0,d.old_match-d.order_delta)=0) or d.photo_date<=clock_timestamp()-interval '10 days'
      from pg_temp.erp_order_delta_v23196 d on conflict do nothing;
      update app_sync_private.inventory_location_evidence_v1 e set current_photo_match_qty=a.new_loc_photo_match,
        loc_match_qty=a.new_loc_photo_match::text,initial_loc_photo_match=a.new_loc_photo_match,eval_baseline_available=private.inventory_location_evidence_number_v2(m.ptravailable),
        cleared_at=case when a.photo_expired then coalesce(e.cleared_at,clock_timestamp()) else e.cleared_at end,
        clear_reason=case when a.photo_expired then 'ERP_ORDER_OR_TEN_DAY_EXPIRY' else e.clear_reason end
      from private.inventory_order_reconciliation_v23196 a join public.ph_master_inventory m on m.unique_id=a.canonical_unique_id
      where a.run_id=p_run_id and e.source_unique_id=a.canonical_unique_id and e.cleared_at is null;
      update public.ph_master_inventory m set erp_on_hand=private.inventory_location_evidence_number_v2(s.raw_values->>'ptronhand'),erp_ptrreview=private.inventory_location_evidence_number_v2(s.raw_values->>'ptrreviewed'),erp_available=private.inventory_location_evidence_number_v2(s.raw_values->>'ptravailable')
      from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 map using(row_number) where m.unique_id=map.canonical_unique_id;
      update public.ph_master_inventory m set loc_photo_match=a.new_loc_photo_match,loc_match_qty=a.new_loc_photo_match::text,
        initial_loc_photo_match=a.new_loc_photo_match,eval_baseline_available=private.inventory_location_evidence_number_v2(m.ptravailable),
        photo_link=case when a.photo_expired then null else m.photo_link end,photo_name=case when a.photo_expired then null else m.photo_name end,
        photo_url=case when a.photo_expired then null else m.photo_url end,photos=case when a.photo_expired then '[]'::jsonb else m.photos end,
        date_completed=case when a.photo_expired then null else m.date_completed end,
        eval_task_completed_at=case when a.photo_expired then null else m.eval_task_completed_at end
      from private.inventory_order_reconciliation_v23196 a where a.run_id=p_run_id and a.canonical_unique_id=m.unique_id
        and (a.old_loc_photo_match>0 or a.photo_expired);
    end if;


  exception when others then
    perform set_config('agdata.bulk_import.ph_master_inventory','off',true);
    raise;
  end;
  perform set_config('agdata.bulk_import.ph_master_inventory','off',true);
  perform private.normalize_soc_itemcode_from_pairs_v23104(p_rows);
  return result_value;
end
$function$
;
CREATE OR REPLACE VIEW public.ph_reclass_history WITH (security_invoker=true) AS
SELECT c.request_id,c.created_at,m.id movement_id,coalesce(m.direction,c.request->'lines'->0->>'direction','field_update') reclass_type,
coalesce(m.source_unique_id,c.request->>'sourceUid') source_row_uid,m.destination_unique_id dest_row_uid,coalesce(m.quantity,0) qty_delta,
c.request->'lines' field_deltas,private.inventory_location_evidence_number_v2(m.source_before->>'ptronhand') pre_erp_on_hand,
private.inventory_location_evidence_number_v2(m.source_before->>'ptrreviewed') pre_erp_ptrreview,
coalesce(m.status='acknowledged',not exists(select 1 from app_sync_private.inventory_live_overrides_v1 e where e.canonical_unique_id=c.request->>'sourceUid' and e.pending)) absorbed_by_erp
FROM private.ph_inventory_reclass_commands_v1 c LEFT JOIN private.ph_inventory_reclass_movements_v1 m USING(request_id);
REVOKE ALL ON public.ph_reclass_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ph_reclass_history TO service_role;
