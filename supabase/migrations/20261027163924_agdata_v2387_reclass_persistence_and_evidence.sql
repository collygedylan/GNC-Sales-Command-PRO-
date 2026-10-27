begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- New physical destination rows must copy the source row's durable evidence.
-- Quantity and season stock fields remain zeroed and are then incremented by
-- the atomic move; no CAV or source-season stock is a valid new-row baseline.
do $migration$
declare
  target regprocedure := 'public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(target);
  patched text;
begin
  patched := replace(definition,
    $$'printedcontainercode'
  ];$$,
    $$'printedcontainercode','photo_url','photo_link','photo_name','photos','photo_date','photo_expires_at',
    'date_completed','spec','caliper','loc_match_pct','loc_match_qty','loc_photo_match','match',
    'initial_photo_match_qty','pic_note','av_note','sales_note'
  ];$$);
  if patched = definition
    or position('''loc_photo_match''' in patched) = 0
    or position('''photo_link''' in patched) = 0 then
    raise exception 'AGDATA_V2387_RECLASS_EVIDENCE_ANCHOR_MISMATCH';
  end if;
  execute patched;
end
$migration$;

-- Idempotent repair from the durable source-row override ledger. This restores
-- only the recorded Orange Glow move and does not enqueue delivery or email.
do $repair$
declare
  v_item constant text := '010585.031.1';
  v_location constant text := 'D.21.000';
  v_source_uid constant text := '010585_031_1-3DP-D_21_000-27_S1-LD----';
  v_destination_uid text;
  v_photo_link text;
  v_photo_name text;
  v_spec text;
  v_caliper text;
  v_match text;
  v_match_qty text;
  v_completed timestamptz;
begin
  select unique_id into strict v_destination_uid
  from public.ph_master_inventory
  where btrim(itemcode)=v_item and btrim(locationcode)=v_location and upper(btrim(lotcode))='27.F1';

  select max(app_override_value#>>'{}') filter(where field_name='photo_link'),
         max(app_override_value#>>'{}') filter(where field_name='photo_name'),
         max(app_override_value#>>'{}') filter(where field_name='spec'),
         max(app_override_value#>>'{}') filter(where field_name='caliper'),
         max(app_override_value#>>'{}') filter(where field_name='match'),
         max(app_override_value#>>'{}') filter(where field_name='loc_match_qty')
  into v_photo_link,v_photo_name,v_spec,v_caliper,v_match,v_match_qty
  from app_sync_private.inventory_live_overrides_v1
  where canonical_unique_id=v_source_uid and pending;

  select evaluated_at into v_completed
  from app_sync_private.inventory_location_evidence_v1
  where itemcode_key=upper(v_item) and locationcode_key=upper(v_location);

  if nullif(v_photo_link,'') is null or nullif(v_photo_name,'') is null
    or nullif(v_spec,'') is null or v_match is distinct from '15'
    or v_match_qty is distinct from '325' then
    raise exception 'AGDATA_V2387_ORANGE_EVIDENCE_MISSING';
  end if;

  perform set_config('gnc.inventory_edit_actor','system:v2.3.87',true);
  perform set_config('gnc.season_stock_sync','1',true);
  perform set_config('gnc.inventory_location_evidence_apply','on',true);

  update public.ph_master_inventory
  set ptronhand='1843',ptrreviewed='0',ptravailable='1843',s_lts='998',season_oh='1843',last_updated=clock_timestamp()
  where unique_id=v_source_uid;
  update public.ph_master_inventory
  set ptronhand='325',ptrreviewed='0',ptravailable='325',s_lts='325',season_oh='325',last_updated=clock_timestamp()
  where unique_id=v_destination_uid;

  update app_sync_private.inventory_location_evidence_v1
  set source_unique_id=v_destination_uid,source_lotcode='27.F1',spec=v_spec,caliper=v_caliper,
      match=v_match,loc_match_qty=v_match_qty,photo_link=v_photo_link,photo_name=v_photo_name,
      date_completed=v_completed,evaluated_at=v_completed,cleared_at=null,clear_reason=null,
      updated_by='system:v2.3.87',updated_at=clock_timestamp()
  where itemcode_key=upper(v_item) and locationcode_key=upper(v_location);
  update app_sync_private.inventory_location_evidence_v1
  set source_unique_id=v_destination_uid,source_lotcode='27.F1',baseline_on_hand=325,
      loc_match_pct=15,initial_photo_match_qty=325,current_photo_match_qty=325,
      loc_match_qty='325',cleared_at=null,clear_reason=null,
      updated_by='system:v2.3.87',updated_at=clock_timestamp()
  where itemcode_key=upper(v_item) and locationcode_key=upper(v_location);

  update public.ph_master_inventory
  set photo_link=v_photo_link,photo_name=v_photo_name,photo_url=split_part(v_photo_link,',',1),
      photos=to_jsonb(string_to_array(v_photo_link,',')),photo_date=v_completed,
      date_completed=v_completed,spec=v_spec,itemspec=v_spec,caliper=v_caliper,
      match=v_match,loc_match_pct=v_match::numeric,loc_match_qty=v_match_qty,
      loc_photo_match=v_match_qty::numeric,initial_photo_match_qty=v_match_qty::numeric,
      last_updated=clock_timestamp()
  where unique_id in (v_source_uid,v_destination_uid);

  insert into app_sync_private.inventory_season_stock_overrides_v1
    (itemcode,season,open_stock,season_oh,erp_baseline,pending,cav_acknowledged,updated_by,updated_at)
  values (v_item,'S1',998,1843,1323,true,false,'system:v2.3.87',clock_timestamp()),
         (v_item,'F1',325,325,null,true,false,'system:v2.3.87',clock_timestamp())
  on conflict(itemcode,season) do update set
    open_stock=excluded.open_stock,season_oh=excluded.season_oh,erp_baseline=excluded.erp_baseline,
    pending=true,cav_acknowledged=false,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  update public.ph_cav_import
  set ptravailable=case upper(btrim(season)) when 'F1' then '325' else '998' end,
      available=case upper(btrim(season)) when 'F1' then '325' else '998' end,
      open_stock=case upper(btrim(season)) when 'F1' then '325' else '998' end,
      season_oh=case upper(btrim(season)) when 'F1' then '325' else '1843' end,
      last_updated=clock_timestamp()
  where btrim(itemcode)=v_item and upper(btrim(season)) in ('F1','S1');

  perform set_config('gnc.season_stock_sync','',true);
  perform set_config('gnc.inventory_location_evidence_apply','',true);
  perform set_config('gnc.inventory_edit_actor','',true);

  if not exists(select 1 from public.ph_master_inventory where unique_id=v_source_uid
      and ptronhand='1843' and ptravailable='1843' and s_lts='998' and loc_photo_match='325' and loc_match_pct='15'
      and photo_link=v_photo_link and spec=v_spec)
    or not exists(select 1 from public.ph_master_inventory where unique_id=v_destination_uid
      and ptronhand='325' and ptravailable='325' and s_lts='325' and loc_photo_match='325' and loc_match_pct='15'
      and photo_link=v_photo_link and spec=v_spec) then
    raise exception 'AGDATA_V2387_ORANGE_REPAIR_UNCONFIRMED';
  end if;
end
$repair$;

do $contracts$
begin
  perform 'public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)'::regprocedure;
  perform 'public.apply_inventory_reclass_moves_compact_v1(uuid,text,bigint,jsonb)'::regprocedure;
  perform 'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure;
  perform 'public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure;
end
$contracts$;

notify pgrst,'reload schema';
commit;
