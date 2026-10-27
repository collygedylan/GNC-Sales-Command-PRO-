begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Open Stock is a season/lot ERP metric. Reclass changes it by the physical
-- quantity moved, never by recomputing SUM(ptravailable). The statement-level
-- propagator is shared by compact, legacy and delivery Reclass entrypoints.
do $migration$
declare
  target regprocedure := 'private.propagate_inventory_season_stock_v1()'::regprocedure;
  definition text := pg_get_functiondef(target);
  patched text;
begin
  patched := replace(definition,
    'next_stock:=coalesce(baseline,0)+change.delta;',
    'next_stock:=coalesce(baseline,0)+change.oh_delta;');
  patched := replace(patched,
    's_lts=case when change.delta<>0 and private.reclass_numeric_v1(m.s_lts) is not null then (private.reclass_numeric_v1(m.s_lts)+change.delta)::text else m.s_lts end,',
    's_lts=case when change.oh_delta<>0 and private.reclass_numeric_v1(m.s_lts) is not null then (private.reclass_numeric_v1(m.s_lts)+change.oh_delta)::text else m.s_lts end,');
  patched := replace(patched,
    'and (change.delta<>0 or m.season_oh is distinct from season_total::text);',
    'and (change.oh_delta<>0 or m.season_oh is distinct from season_total::text);');
  if patched = definition
    or position('next_stock:=coalesce(baseline,0)+change.oh_delta;' in patched) = 0
    or position('private.reclass_numeric_v1(m.s_lts)+change.oh_delta' in patched) = 0 then
    raise exception 'AGDATA_V2385_RECLASS_STOCK_DELTA_ANCHOR_MISMATCH';
  end if;
  execute patched;
end
$migration$;

-- Every public Reclass caller must still terminate in the single set-based
-- implementation protected by the propagator above.
do $contracts$
begin
  perform 'public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)'::regprocedure;
  perform 'public.apply_inventory_reclass_moves_compact_v1(uuid,text,bigint,jsonb)'::regprocedure;
  perform 'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure;
  perform 'public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure;
end
$contracts$;

-- Idempotent production repair for the recorded 140-unit S1 -> F1 move.
do $repair$
declare
  v_item constant text := '004424.010.1';
begin
  perform set_config('gnc.inventory_edit_actor','system:v2.3.85',true);
  perform set_config('gnc.season_stock_sync','1',true);

  update public.ph_master_inventory
  set ptronhand='166',ptrreviewed='2',ptravailable='164',s_lts='109',season_oh='167',last_updated=clock_timestamp()
  where btrim(itemcode)=v_item and btrim(locationcode)='C.16.000' and upper(btrim(lotcode))='27.F1';
  update public.ph_master_inventory
  set ptronhand='1',ptrreviewed='0',ptravailable='1',s_lts='109',season_oh='167',last_updated=clock_timestamp()
  where btrim(itemcode)=v_item and btrim(locationcode)='H.06.000' and upper(btrim(lotcode))='27.F1';
  update public.ph_master_inventory
  set ptronhand='12',ptrreviewed='0',ptravailable='12',s_lts='2',season_oh='12',last_updated=clock_timestamp()
  where btrim(itemcode)=v_item and btrim(locationcode)='C.16.000' and upper(btrim(lotcode))='27.S1';

  update public.ph_master_inventory set s_lts='109',season_oh='167',last_updated=clock_timestamp()
  where btrim(itemcode)=v_item and private.inventory_stock_season_v1(lotcode,season)='F1';
  update public.ph_master_inventory set s_lts='2',season_oh='12',last_updated=clock_timestamp()
  where btrim(itemcode)=v_item and private.inventory_stock_season_v1(lotcode,season)='S1';

  insert into app_sync_private.inventory_season_stock_overrides_v1
    (itemcode,season,open_stock,season_oh,erp_baseline,pending,cav_acknowledged,updated_by,updated_at)
  values (v_item,'F1',109,167,-31,true,false,'system:v2.3.85',clock_timestamp()),
         (v_item,'S1',2,12,142,true,false,'system:v2.3.85',clock_timestamp())
  on conflict(itemcode,season) do update set
    open_stock=excluded.open_stock,season_oh=excluded.season_oh,erp_baseline=excluded.erp_baseline,
    pending=true,cav_acknowledged=false,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  update public.ph_cav_import
  set ptravailable=case upper(btrim(season)) when 'F1' then '109' else '2' end,
      available=case upper(btrim(season)) when 'F1' then '109' else '2' end,
      open_stock=case upper(btrim(season)) when 'F1' then '109' else '2' end,
      season_oh=case upper(btrim(season)) when 'F1' then '167' else '12' end,
      last_updated=clock_timestamp()
  where btrim(itemcode)=v_item and upper(btrim(season)) in ('F1','S1');

  perform set_config('gnc.season_stock_sync','',true);
  perform set_config('gnc.inventory_edit_actor','',true);

  if not exists(select 1 from public.ph_master_inventory where btrim(itemcode)=v_item and locationcode='C.16.000' and lotcode='27.F1' and ptronhand='166' and ptrreviewed='2' and ptravailable='164' and s_lts='109')
    or not exists(select 1 from public.ph_master_inventory where btrim(itemcode)=v_item and locationcode='H.06.000' and lotcode='27.F1' and ptronhand='1' and ptrreviewed='0' and ptravailable='1' and s_lts='109')
    or not exists(select 1 from public.ph_master_inventory where btrim(itemcode)=v_item and locationcode='C.16.000' and lotcode='27.S1' and ptronhand='12' and ptrreviewed='0' and ptravailable='12' and s_lts='2') then
    raise exception 'AGDATA_V2385_SHENANDOAH_REPAIR_UNCONFIRMED';
  end if;
end
$repair$;

notify pgrst,'reload schema';
commit;
