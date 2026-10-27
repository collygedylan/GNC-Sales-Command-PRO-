begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Reclass writes are durable per physical row. Keep the inventory import path
-- generic: an ERP stage must pass through the existing pending override ledger
-- for every item/UID and must never contain a Juncus-specific reset.
do $durability_contract$
declare
  commit_definition text := pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure);
  ingest_definition text := pg_get_functiondef('public.fast_ingest_drive_around_v1(jsonb,jsonb)'::regprocedure);
  override_definition text := pg_get_functiondef('private.reconcile_inventory_live_overrides_v1()'::regprocedure);
begin
  if position('fast_ingest_drive_around_v1' in commit_definition)=0
    or position('004103.010.1' in commit_definition)>0
    or position('004103.010.1' in ingest_definition)>0 then
    raise exception 'AGDATA_V2390_DRIVE_IMPORT_MUST_REMAIN_GENERIC';
  end if;
  if position('canonical_unique_id' in override_definition)=0
    or position('s_lts' in override_definition)=0
    or position('season_oh' in override_definition)=0
    or position('return null' in override_definition)=0
    or not exists(select 1 from pg_trigger where tgrelid='public.ph_master_inventory'::regclass
      and tgname='zz_inventory_live_overrides' and tgenabled='O') then
    raise exception 'AGDATA_V2390_PENDING_RECLASS_LEDGER_GUARD_MISSING';
  end if;
end
$durability_contract$;

-- Reconcile the previously approved 253-plant move by exact item/size/location/
-- lot. The live state is already at these values; this guarded repair is safe
-- to retry and refuses to overwrite any unrelated inventory state. Derived
-- location on-hand is computed from physical rows and is not a table column.
do $repair$
declare
  expected record;
  matched integer;
  before_revision bigint;
  after_revision bigint;
  did_update boolean := false;
begin
  select revision into strict before_revision from public.app_dataset_revisions
    where key='ph_master_inventory' and state='ready' for update;

  if (select count(*) from public.ph_master_inventory m
      where btrim(m.itemcode)='004103.010.1' and btrim(m.contsize)='#1'
        and (m.locationcode,m.lotcode) in (
          ('C.15.000','27.F1'),('F.16.000','27.F1'),('H.06.000','27.F1'),
          ('C.15.000','27.S1'),('F.16.000','27.S1'),('I.03.000','27.S1'))) <> 6
    or (select count(distinct m.locationcode||'|'||m.lotcode) from public.ph_master_inventory m
      where btrim(m.itemcode)='004103.010.1' and btrim(m.contsize)='#1'
        and (m.locationcode,m.lotcode) in (
          ('C.15.000','27.F1'),('F.16.000','27.F1'),('H.06.000','27.F1'),
          ('C.15.000','27.S1'),('F.16.000','27.S1'),('I.03.000','27.S1'))) <> 6 then
    raise exception 'AGDATA_V2390_JUNCUS_PHYSICAL_ROWS_MISSING_OR_AMBIGUOUS';
  end if;

  if exists(
    select 1 from public.ph_master_inventory m
    join (values
      ('C.15.000','27.F1',529,276,253,643),
      ('F.16.000','27.F1',113,113,253,643),
      ('H.06.000','27.F1',1,1,253,643),
      ('C.15.000','27.S1',279,532,0,2050),
      ('F.16.000','27.S1',175,175,0,2050),
      ('I.03.000','27.S1',1596,1596,0,2050)
    ) as target(locationcode,lotcode,onhand,legacy_onhand,open_stock,season_oh)
      on m.locationcode=target.locationcode and m.lotcode=target.lotcode
    where btrim(m.itemcode)='004103.010.1' and btrim(m.contsize)='#1'
      and (private.reclass_numeric_v1(m.ptronhand) not in (target.onhand,target.legacy_onhand)
        or private.reclass_numeric_v1(m.ptrreviewed) not in (0)
        or private.reclass_numeric_v1(m.ptravailable) not in (target.onhand,target.legacy_onhand)
        or private.reclass_numeric_v1(m.s_lts) not in (target.open_stock,case when target.open_stock=253 then 0 else 253 end)
        or private.reclass_numeric_v1(m.season_oh) not in (target.season_oh,
          case when target.season_oh=643 then 390 else 2303 end))
  ) then
    raise exception 'AGDATA_V2390_JUNCUS_SOURCE_CHANGED';
  end if;

  perform set_config('gnc.inventory_edit_actor','system:v2.3.90',true);
  update public.ph_master_inventory m set
    ptronhand=target.onhand::text, ptrreviewed='0', ptravailable=target.onhand::text,
    s_lts=target.open_stock::text, season_oh=target.season_oh::text,
    last_updated=clock_timestamp()
  from (values
    ('C.15.000','27.F1',529,253,643),
    ('F.16.000','27.F1',113,253,643),
    ('H.06.000','27.F1',1,253,643),
    ('C.15.000','27.S1',279,0,2050),
    ('F.16.000','27.S1',175,0,2050),
    ('I.03.000','27.S1',1596,0,2050)
  ) as target(locationcode,lotcode,onhand,open_stock,season_oh)
  where btrim(m.itemcode)='004103.010.1' and btrim(m.contsize)='#1'
    and m.locationcode=target.locationcode and m.lotcode=target.lotcode
    and (m.ptronhand is distinct from target.onhand::text or m.ptrreviewed is distinct from '0'
      or m.ptravailable is distinct from target.onhand::text or m.s_lts is distinct from target.open_stock::text
      or m.season_oh is distinct from target.season_oh::text);
  get diagnostics matched = row_count;
  did_update := matched > 0;

  insert into app_sync_private.inventory_season_stock_overrides_v1
    (itemcode,season,open_stock,season_oh,pending,cav_acknowledged,updated_by,updated_at)
  values ('004103.010.1','F1',253,643,true,false,'system:v2.3.90',clock_timestamp()),
         ('004103.010.1','S1',0,2050,true,false,'system:v2.3.90',clock_timestamp())
  on conflict(itemcode,season) do update set open_stock=excluded.open_stock,
    season_oh=excluded.season_oh,pending=true,cav_acknowledged=false,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at
  where app_sync_private.inventory_season_stock_overrides_v1.open_stock is distinct from excluded.open_stock
    or app_sync_private.inventory_season_stock_overrides_v1.season_oh is distinct from excluded.season_oh
    or app_sync_private.inventory_season_stock_overrides_v1.pending is distinct from true;

  if did_update then
    select revision into after_revision from public.app_dataset_revisions where key='ph_master_inventory';
    if after_revision=before_revision then
      update public.app_dataset_revisions set revision=revision+1,state='ready',changed_at=clock_timestamp()
        where key='ph_master_inventory';
    end if;
  end if;
  perform set_config('gnc.inventory_edit_actor','',true);

  select count(*) into matched from public.ph_master_inventory m
  join (values
    ('C.15.000','27.F1',529,253,643),('F.16.000','27.F1',113,253,643),('H.06.000','27.F1',1,253,643),
    ('C.15.000','27.S1',279,0,2050),('F.16.000','27.S1',175,0,2050),('I.03.000','27.S1',1596,0,2050)
  ) target(locationcode,lotcode,onhand,open_stock,season_oh)
    on m.locationcode=target.locationcode and m.lotcode=target.lotcode
  where btrim(m.itemcode)='004103.010.1' and btrim(m.contsize)='#1'
    and m.ptronhand=target.onhand::text and m.ptrreviewed='0' and m.ptravailable=target.onhand::text
    and m.s_lts=target.open_stock::text and m.season_oh=target.season_oh::text;
  if matched<>6 then raise exception 'AGDATA_V2390_JUNCUS_CORRECTION_UNCONFIRMED'; end if;
end
$repair$;

notify pgrst,'reload schema';
commit;
