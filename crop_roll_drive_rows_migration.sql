-- Fast Crop Roll read model for the Drive Mode Crop Roll tab.
-- Run once in Supabase SQL Editor as project owner/postgres.

create table if not exists public.v2_crop_roll_drive_rows (
  unique_id text primary key,
  master_unique_id text not null,
  source_table text not null default 'v2_master_inventory',
  crop_roll_view text not null default 'carryover',
  warehouseid text,
  plantgroupcode text,
  itemcode text,
  qualitycode text,
  contsize text,
  commonname text,
  genus text,
  genusname text,
  botanicalname text,
  lotcode text,
  locationcode text,
  source text,
  desigitem text,
  desigcust text,
  desigloc text,
  priority text,
  ptravailable text,
  ptronhand text,
  ptrreviewed text,
  s_lts text,
  season_supply text,
  saleyear text,
  itemspec text,
  locationnote text,
  locationnotedate text,
  locationptn1 text,
  fieldtagcolor text,
  holdstopcode text,
  holdstopreason text,
  holdstopbegindate text,
  season text,
  blockalpha text,
  blocknumber text,
  app_tab_assignment text,
  assignedto text,
  date_completed text,
  av_note text,
  sales_note text,
  salesnote text,
  match text,
  loc_match_qty text,
  initial_ptr text,
  spec text,
  caliper text,
  photo_link text,
  photo_name text,
  dock_photo_link text,
  dock_photo_name text,
  flyer_photo_link text,
  flyer_photo_name text,
  flyer_completed text,
  flyer_av_note text,
  flyer_match text,
  flyer_loc_match_qty text,
  flyer_spec text,
  flyer_caliper text,
  flyer_pick text,
  flyer_initial_ptr text,
  search_text text,
  master_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.get_v2_crop_roll_drive_view(row_data jsonb)
returns text
language sql
immutable
as $$
  select case
    when coalesce(row_data->>'saleyear', row_data->>'salesyear', row_data->>'sale_year', row_data->>'sales_year', '') like '%27%'
      then 'sy27'
    when coalesce(row_data->>'saleyear', row_data->>'salesyear', row_data->>'sale_year', row_data->>'sales_year', '') like '%26%'
      and coalesce(row_data->>'desigitem', row_data->>'desig_item', '') like '%=%'
      then 'sy27'
    else 'carryover'
  end
$$;

create or replace function public.get_v2_crop_roll_completion_view(row_data jsonb)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(
      row_data #>> '{metadata,completion_source_view}',
      row_data #>> '{metadata,crop_roll_source_view}',
      row_data->>'completion_source_view',
      row_data->>'crop_roll_source_view',
      ''
    )) in ('carryover', 'carry-over', 'co')
      then 'carryover'
    when lower(coalesce(
      row_data #>> '{metadata,completion_source_view}',
      row_data #>> '{metadata,crop_roll_source_view}',
      row_data->>'completion_source_view',
      row_data->>'crop_roll_source_view',
      ''
    )) in ('sy27', 'sy-27', 'sy 27')
      then 'sy27'
    else public.get_v2_crop_roll_drive_view(row_data)
  end
$$;

create or replace function public.get_v2_crop_roll_completion_master_ids(row_data jsonb)
returns text[]
language sql
immutable
as $$
  with candidates(raw_id) as (
    values
      (row_data->>'master_unique_id'),
      (row_data->>'MASTER_UNIQUE_ID'),
      (row_data->>'unique_id'),
      (row_data->>'UNIQUE_ID'),
      (row_data->>'source_unique_id'),
      (row_data->>'SOURCE_UNIQUE_ID'),
      (row_data #>> '{metadata,master_unique_id}'),
      (row_data #>> '{metadata,MASTER_UNIQUE_ID}'),
      (row_data #>> '{metadata,unique_id}'),
      (row_data #>> '{metadata,UNIQUE_ID}'),
      (row_data #>> '{metadata,source_unique_id}'),
      (row_data #>> '{metadata,SOURCE_UNIQUE_ID}'),
      (row_data #>> '{metadata,crop_roll_form_values,master_unique_id}'),
      (row_data #>> '{metadata,crop_roll_form_values,MASTER_UNIQUE_ID}'),
      (row_data #>> '{metadata,crop_roll_form_values,unique_id}'),
      (row_data #>> '{metadata,crop_roll_form_values,UNIQUE_ID}'),
      (row_data #>> '{snapshot,master_unique_id}'),
      (row_data #>> '{snapshot,MASTER_UNIQUE_ID}'),
      (row_data #>> '{snapshot,unique_id}'),
      (row_data #>> '{snapshot,UNIQUE_ID}'),
      (case
        when btrim(coalesce(row_data->>'row_id', '')) like '%:%'
          then regexp_replace(btrim(row_data->>'row_id'), '^[^:]+:', '')
        else row_data->>'row_id'
      end)
  )
  select coalesce(array_agg(distinct cleaned), array[]::text[])
  from (
    select nullif(btrim(coalesce(raw_id, '')), '') as cleaned
    from candidates
  ) normalized
  where cleaned is not null
$$;

create or replace function public.v2_crop_roll_drive_row_from_json(row_data jsonb)
returns public.v2_crop_roll_drive_rows
language plpgsql
stable
as $$
declare
  result public.v2_crop_roll_drive_rows;
  uid text := btrim(coalesce(row_data->>'unique_id', row_data->>'UNIQUE_ID', row_data->>'id', row_data->>'ID', ''));
  loc text := btrim(coalesce(row_data->>'locationcode', row_data->>'LOCATIONCODE', row_data->>'location', row_data->>'LOCATION', ''));
  item text := btrim(coalesce(row_data->>'itemcode', row_data->>'ITEMCODE', ''));
  master_updated_text text := btrim(coalesce(row_data->>'updated_at', row_data->>'UPDATED_AT', row_data->>'last_updated', row_data->>'LAST_UPDATED', ''));
begin
  if uid = '' or loc = '' or item = '' then
    return null;
  end if;

  result.unique_id := uid;
  result.master_unique_id := uid;
  result.source_table := 'v2_master_inventory';
  result.crop_roll_view := public.get_v2_crop_roll_drive_view(row_data);
  result.warehouseid := nullif(btrim(coalesce(row_data->>'warehouseid', row_data->>'WAREHOUSEID', '')), '');
  result.plantgroupcode := upper(nullif(btrim(coalesce(row_data->>'plantgroupcode', row_data->>'PLANTGROUPCODE', row_data->>'plantgroup', row_data->>'PLANTGROUP', '')), ''));
  result.itemcode := item;
  result.qualitycode := nullif(btrim(coalesce(row_data->>'qualitycode', row_data->>'QUALITYCODE', '')), '');
  result.contsize := nullif(btrim(coalesce(row_data->>'contsize', row_data->>'CONTSIZE', row_data->>'itemspec', row_data->>'ITEMSPEC', '')), '');
  result.commonname := nullif(btrim(coalesce(row_data->>'commonname', row_data->>'COMMONNAME', row_data->>'description', row_data->>'DESCRIPTION', row_data->>'plant_name', row_data->>'PLANT_NAME', '')), '');
  result.genus := nullif(btrim(coalesce(row_data->>'genus', row_data->>'GENUS', row_data->>'genusname', row_data->>'GENUSNAME', '')), '');
  result.genusname := nullif(btrim(coalesce(row_data->>'genusname', row_data->>'GENUSNAME', row_data->>'genus_name', row_data->>'GENUS_NAME', row_data->>'genus', row_data->>'GENUS', '')), '');
  result.botanicalname := nullif(btrim(coalesce(row_data->>'botanicalname', row_data->>'BOTANICALNAME', row_data->>'botanical_name', row_data->>'BOTANICAL_NAME', '')), '');
  result.lotcode := nullif(btrim(coalesce(row_data->>'lotcode', row_data->>'LOTCODE', row_data->>'lot', row_data->>'LOT', '')), '');
  result.locationcode := loc;
  result.source := nullif(btrim(coalesce(row_data->>'source', row_data->>'SOURCE', '')), '');
  result.desigitem := nullif(btrim(coalesce(row_data->>'desigitem', row_data->>'DESIGITEM', row_data->>'desig_item', row_data->>'DESIG_ITEM', '')), '');
  result.desigcust := nullif(btrim(coalesce(row_data->>'desigcust', row_data->>'DESIGCUST', row_data->>'desig_cust', row_data->>'DESIG_CUST', '')), '');
  result.desigloc := nullif(btrim(coalesce(row_data->>'desigloc', row_data->>'DESIGLOC', row_data->>'desig_loc', row_data->>'DESIG_LOC', '')), '');
  result.priority := nullif(btrim(coalesce(row_data->>'priority', row_data->>'PRIORITY', '')), '');
  result.ptravailable := nullif(btrim(coalesce(row_data->>'ptravailable', row_data->>'PTRAVAILABLE', '')), '');
  result.ptronhand := nullif(btrim(coalesce(row_data->>'ptronhand', row_data->>'PTRONHAND', '')), '');
  result.ptrreviewed := nullif(btrim(coalesce(row_data->>'ptrreviewed', row_data->>'PTRREVIEWED', '')), '');
  result.s_lts := nullif(btrim(coalesce(row_data->>'s_lts', row_data->>'S_LTS', '')), '');
  result.season_supply := nullif(btrim(coalesce(row_data->>'season_supply', row_data->>'SEASON_SUPPLY', row_data->>'seasonsupply', row_data->>'SEASONSUPPLY', '')), '');
  result.saleyear := nullif(btrim(coalesce(row_data->>'saleyear', row_data->>'SALEYEAR', row_data->>'salesyear', row_data->>'SALESYEAR', '')), '');
  result.itemspec := nullif(btrim(coalesce(row_data->>'itemspec', row_data->>'ITEMSPEC', '')), '');
  result.locationnote := nullif(btrim(coalesce(row_data->>'locationnote', row_data->>'LOCATIONNOTE', '')), '');
  result.locationnotedate := nullif(btrim(coalesce(row_data->>'locationnotedate', row_data->>'LOCATIONNOTEDATE', '')), '');
  result.locationptn1 := nullif(btrim(coalesce(row_data->>'locationptn1', row_data->>'LOCATIONPTN1', '')), '');
  result.fieldtagcolor := nullif(btrim(coalesce(row_data->>'fieldtagcolor', row_data->>'FIELDTAGCOLOR', row_data->>'field_tag_color', row_data->>'FIELD_TAG_COLOR', '')), '');
  result.holdstopcode := nullif(btrim(coalesce(row_data->>'holdstopcode', row_data->>'HOLDSTOPCODE', '')), '');
  result.holdstopreason := nullif(btrim(coalesce(row_data->>'holdstopreason', row_data->>'HOLDSTOPREASON', '')), '');
  result.holdstopbegindate := nullif(btrim(coalesce(row_data->>'holdstopbegindate', row_data->>'HOLDSTOPBEGINDATE', '')), '');
  result.season := nullif(btrim(coalesce(row_data->>'season', row_data->>'SEASON', '')), '');
  result.blockalpha := upper(nullif(btrim(coalesce(row_data->>'blockalpha', row_data->>'BLOCKALPHA', split_part(loc, '.', 1), '')), ''));
  result.blocknumber := nullif(btrim(coalesce(row_data->>'blocknumber', row_data->>'BLOCKNUMBER', '')), '');
  result.app_tab_assignment := nullif(btrim(coalesce(row_data->>'app_tab_assignment', row_data->>'APP_TAB_ASSIGNMENT', '')), '');
  result.assignedto := nullif(btrim(coalesce(row_data->>'assignedto', row_data->>'ASSIGNEDTO', '')), '');
  result.date_completed := nullif(btrim(coalesce(row_data->>'date_completed', row_data->>'DATE_COMPLETED', '')), '');
  result.av_note := nullif(btrim(coalesce(row_data->>'av_note', row_data->>'AV_NOTE', '')), '');
  result.sales_note := nullif(btrim(coalesce(row_data->>'sales_note', row_data->>'SALES_NOTE', '')), '');
  result.salesnote := nullif(btrim(coalesce(row_data->>'salesnote', row_data->>'SALESNOTE', '')), '');
  result.match := nullif(btrim(coalesce(row_data->>'match', row_data->>'MATCH', '')), '');
  result.loc_match_qty := nullif(btrim(coalesce(row_data->>'loc_match_qty', row_data->>'LOC_MATCH_QTY', '')), '');
  result.initial_ptr := nullif(btrim(coalesce(row_data->>'initial_ptr', row_data->>'INITIAL_PTR', '')), '');
  result.spec := nullif(btrim(coalesce(row_data->>'spec', row_data->>'SPEC', '')), '');
  result.caliper := nullif(btrim(coalesce(row_data->>'caliper', row_data->>'CALIPER', '')), '');
  result.photo_link := nullif(btrim(coalesce(row_data->>'photo_link', row_data->>'PHOTO_LINK', '')), '');
  result.photo_name := nullif(btrim(coalesce(row_data->>'photo_name', row_data->>'PHOTO_NAME', '')), '');
  result.dock_photo_link := nullif(btrim(coalesce(row_data->>'dock_photo_link', row_data->>'DOCK_PHOTO_LINK', '')), '');
  result.dock_photo_name := nullif(btrim(coalesce(row_data->>'dock_photo_name', row_data->>'DOCK_PHOTO_NAME', '')), '');
  result.flyer_photo_link := nullif(btrim(coalesce(row_data->>'flyer_photo_link', row_data->>'FLYER_PHOTO_LINK', '')), '');
  result.flyer_photo_name := nullif(btrim(coalesce(row_data->>'flyer_photo_name', row_data->>'FLYER_PHOTO_NAME', '')), '');
  result.flyer_completed := nullif(btrim(coalesce(row_data->>'flyer_completed', row_data->>'FLYER_COMPLETED', '')), '');
  result.flyer_av_note := nullif(btrim(coalesce(row_data->>'flyer_av_note', row_data->>'FLYER_AV_NOTE', '')), '');
  result.flyer_match := nullif(btrim(coalesce(row_data->>'flyer_match', row_data->>'FLYER_MATCH', '')), '');
  result.flyer_loc_match_qty := nullif(btrim(coalesce(row_data->>'flyer_loc_match_qty', row_data->>'FLYER_LOC_MATCH_QTY', '')), '');
  result.flyer_spec := nullif(btrim(coalesce(row_data->>'flyer_spec', row_data->>'FLYER_SPEC', '')), '');
  result.flyer_caliper := nullif(btrim(coalesce(row_data->>'flyer_caliper', row_data->>'FLYER_CALIPER', '')), '');
  result.flyer_pick := nullif(btrim(coalesce(row_data->>'flyer_pick', row_data->>'FLYER_PICK', '')), '');
  result.flyer_initial_ptr := nullif(btrim(coalesce(row_data->>'flyer_initial_ptr', row_data->>'FLYER_INITIAL_PTR', '')), '');
  result.search_text := lower(concat_ws(' ', result.commonname, result.itemcode, result.contsize, result.locationcode, result.lotcode, result.plantgroupcode, result.genusname, result.assignedto));
  begin
    result.master_updated_at := nullif(master_updated_text, '')::timestamptz;
  exception
    when others then
      result.master_updated_at := null;
  end;
  result.created_at := now();
  result.updated_at := now();
  return result;
end;
$$;

create or replace function public.upsert_v2_crop_roll_drive_row_from_master()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mapped public.v2_crop_roll_drive_rows;
  old_uid text;
begin
  if tg_op = 'DELETE' then
    old_uid := btrim(coalesce(to_jsonb(old)->>'unique_id', to_jsonb(old)->>'UNIQUE_ID', ''));
    if old_uid <> '' then
      delete from public.v2_crop_roll_drive_rows where master_unique_id = old_uid;
    end if;
    return old;
  end if;

  mapped := public.v2_crop_roll_drive_row_from_json(to_jsonb(new));
  if mapped.unique_id is null then
    old_uid := btrim(coalesce(to_jsonb(new)->>'unique_id', to_jsonb(new)->>'UNIQUE_ID', ''));
    if old_uid <> '' then
      delete from public.v2_crop_roll_drive_rows where master_unique_id = old_uid;
    end if;
    return new;
  end if;

  insert into public.v2_crop_roll_drive_rows
  select mapped.*
  on conflict (unique_id) do update set
    master_unique_id = excluded.master_unique_id,
    source_table = excluded.source_table,
    crop_roll_view = excluded.crop_roll_view,
    warehouseid = excluded.warehouseid,
    plantgroupcode = excluded.plantgroupcode,
    itemcode = excluded.itemcode,
    qualitycode = excluded.qualitycode,
    contsize = excluded.contsize,
    commonname = excluded.commonname,
    genus = excluded.genus,
    genusname = excluded.genusname,
    botanicalname = excluded.botanicalname,
    lotcode = excluded.lotcode,
    locationcode = excluded.locationcode,
    source = excluded.source,
    desigitem = excluded.desigitem,
    desigcust = excluded.desigcust,
    desigloc = excluded.desigloc,
    priority = excluded.priority,
    ptravailable = excluded.ptravailable,
    ptronhand = excluded.ptronhand,
    ptrreviewed = excluded.ptrreviewed,
    s_lts = excluded.s_lts,
    season_supply = excluded.season_supply,
    saleyear = excluded.saleyear,
    itemspec = excluded.itemspec,
    locationnote = excluded.locationnote,
    locationnotedate = excluded.locationnotedate,
    locationptn1 = excluded.locationptn1,
    fieldtagcolor = excluded.fieldtagcolor,
    holdstopcode = excluded.holdstopcode,
    holdstopreason = excluded.holdstopreason,
    holdstopbegindate = excluded.holdstopbegindate,
    season = excluded.season,
    blockalpha = excluded.blockalpha,
    blocknumber = excluded.blocknumber,
    app_tab_assignment = excluded.app_tab_assignment,
    assignedto = excluded.assignedto,
    date_completed = excluded.date_completed,
    av_note = excluded.av_note,
    sales_note = excluded.sales_note,
    salesnote = excluded.salesnote,
    match = excluded.match,
    loc_match_qty = excluded.loc_match_qty,
    initial_ptr = excluded.initial_ptr,
    spec = excluded.spec,
    caliper = excluded.caliper,
    photo_link = excluded.photo_link,
    photo_name = excluded.photo_name,
    dock_photo_link = excluded.dock_photo_link,
    dock_photo_name = excluded.dock_photo_name,
    flyer_photo_link = excluded.flyer_photo_link,
    flyer_photo_name = excluded.flyer_photo_name,
    flyer_completed = excluded.flyer_completed,
    flyer_av_note = excluded.flyer_av_note,
    flyer_match = excluded.flyer_match,
    flyer_loc_match_qty = excluded.flyer_loc_match_qty,
    flyer_spec = excluded.flyer_spec,
    flyer_caliper = excluded.flyer_caliper,
    flyer_pick = excluded.flyer_pick,
    flyer_initial_ptr = excluded.flyer_initial_ptr,
    search_text = excluded.search_text,
    master_updated_at = excluded.master_updated_at,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_v2_master_inventory_crop_roll_drive_rows on public.v2_master_inventory;
create trigger trg_v2_master_inventory_crop_roll_drive_rows
after insert or update or delete on public.v2_master_inventory
for each row
execute function public.upsert_v2_crop_roll_drive_row_from_master();

insert into public.v2_crop_roll_drive_rows
select mapped.*
from public.v2_master_inventory m
cross join lateral public.v2_crop_roll_drive_row_from_json(to_jsonb(m)) mapped
where mapped.unique_id is not null
on conflict (unique_id) do update set
  master_unique_id = excluded.master_unique_id,
  source_table = excluded.source_table,
  crop_roll_view = excluded.crop_roll_view,
  warehouseid = excluded.warehouseid,
  plantgroupcode = excluded.plantgroupcode,
  itemcode = excluded.itemcode,
  qualitycode = excluded.qualitycode,
  contsize = excluded.contsize,
  commonname = excluded.commonname,
  genus = excluded.genus,
  genusname = excluded.genusname,
  botanicalname = excluded.botanicalname,
  lotcode = excluded.lotcode,
  locationcode = excluded.locationcode,
  source = excluded.source,
  desigitem = excluded.desigitem,
  desigcust = excluded.desigcust,
  desigloc = excluded.desigloc,
  priority = excluded.priority,
  ptravailable = excluded.ptravailable,
  ptronhand = excluded.ptronhand,
  ptrreviewed = excluded.ptrreviewed,
  s_lts = excluded.s_lts,
  season_supply = excluded.season_supply,
  saleyear = excluded.saleyear,
  itemspec = excluded.itemspec,
  locationnote = excluded.locationnote,
  locationnotedate = excluded.locationnotedate,
  locationptn1 = excluded.locationptn1,
  fieldtagcolor = excluded.fieldtagcolor,
  holdstopcode = excluded.holdstopcode,
  holdstopreason = excluded.holdstopreason,
  holdstopbegindate = excluded.holdstopbegindate,
  season = excluded.season,
  blockalpha = excluded.blockalpha,
  blocknumber = excluded.blocknumber,
  app_tab_assignment = excluded.app_tab_assignment,
  assignedto = excluded.assignedto,
  date_completed = excluded.date_completed,
  av_note = excluded.av_note,
  sales_note = excluded.sales_note,
  salesnote = excluded.salesnote,
  match = excluded.match,
  loc_match_qty = excluded.loc_match_qty,
  initial_ptr = excluded.initial_ptr,
  spec = excluded.spec,
  caliper = excluded.caliper,
  photo_link = excluded.photo_link,
  photo_name = excluded.photo_name,
  dock_photo_link = excluded.dock_photo_link,
  dock_photo_name = excluded.dock_photo_name,
  flyer_photo_link = excluded.flyer_photo_link,
  flyer_photo_name = excluded.flyer_photo_name,
  flyer_completed = excluded.flyer_completed,
  flyer_av_note = excluded.flyer_av_note,
  flyer_match = excluded.flyer_match,
  flyer_loc_match_qty = excluded.flyer_loc_match_qty,
  flyer_spec = excluded.flyer_spec,
  flyer_caliper = excluded.flyer_caliper,
  flyer_pick = excluded.flyer_pick,
  flyer_initial_ptr = excluded.flyer_initial_ptr,
  search_text = excluded.search_text,
  master_updated_at = excluded.master_updated_at,
  updated_at = now();

create index if not exists idx_v2_crop_roll_drive_rows_view_block_loc
  on public.v2_crop_roll_drive_rows (crop_roll_view, blockalpha, locationcode);

create index if not exists idx_v2_crop_roll_drive_rows_view_item_loc
  on public.v2_crop_roll_drive_rows (crop_roll_view, itemcode, locationcode);

create index if not exists idx_v2_crop_roll_drive_rows_view_size
  on public.v2_crop_roll_drive_rows (crop_roll_view, contsize);

create index if not exists idx_v2_crop_roll_drive_rows_eval_user
  on public.v2_crop_roll_drive_rows (assignedto);

create index if not exists idx_v2_crop_roll_drive_rows_plant_group
  on public.v2_crop_roll_drive_rows (plantgroupcode);

create index if not exists idx_v2_crop_roll_drive_rows_genus
  on public.v2_crop_roll_drive_rows (genusname);

create index if not exists idx_v2_crop_roll_drive_rows_updated
  on public.v2_crop_roll_drive_rows (updated_at desc);

create index if not exists idx_v2_crop_roll_rows_live_completion_master
  on public.v2_crop_roll_rows (run_id, row_status, master_unique_id);

create index if not exists idx_v2_crop_roll_rows_live_completion_row_id
  on public.v2_crop_roll_rows (run_id, row_status, row_id);

create or replace view public.v2_crop_roll_open_rows as
select d.*
from public.v2_crop_roll_drive_rows d
where not exists (
  select 1
  from public.v2_crop_roll_rows c
  where c.run_id = 'CR-LIVE-COMPLETIONS'
    and lower(coalesce(c.row_status, '')) = 'complete'
    and d.master_unique_id = any(public.get_v2_crop_roll_completion_master_ids(to_jsonb(c)))
);

alter table public.v2_crop_roll_drive_rows enable row level security;

drop policy if exists "Allow Crop Roll drive row reads" on public.v2_crop_roll_drive_rows;
create policy "Allow Crop Roll drive row reads"
  on public.v2_crop_roll_drive_rows
  for select
  using (true);

drop policy if exists "Allow Crop Roll drive row service writes" on public.v2_crop_roll_drive_rows;
create policy "Allow Crop Roll drive row service writes"
  on public.v2_crop_roll_drive_rows
  for all
  using (true)
  with check (true);
