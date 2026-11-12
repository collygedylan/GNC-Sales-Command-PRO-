begin;
set local lock_timeout='1500ms';
set local statement_timeout='30s';

-- Identity mappings cannot be aliases. Include both IDs in the index so a
-- publication can establish an empty historical alias set without opening
-- the wide working stage, master rows or lineage baselines.
create index ph_master_bulk_prior_alias_v3078_idx on app_sync_private.ph_master_bulk_import_source_v1
  (source_unique_id,canonical_unique_id) where source_unique_id<>canonical_unique_id;

create or replace function private.prior_drive_source_aliases_v3046()
returns table(row_number bigint,canonical_unique_id text)
language plpgsql stable set search_path='' set enable_nestloop=on as $alias$
declare sampled integer; stage_keys text; live_keys text;
begin
  select count(*) into sampled from (
    select p.source_unique_id from app_sync_private.ph_master_bulk_import_source_v1 p
    where p.source_unique_id<>p.canonical_unique_id order by p.source_unique_id,p.canonical_unique_id limit 65
  ) probe;
  if sampled=0 then return; end if;
  if sampled=65 then
    -- One narrow scan per relation when historical aliases are common. Keep
    -- the planner setting local to this function and its single read.
    perform set_config('enable_nestloop','off',true);
    stage_keys:='select s.unique_id,s.row_number,s.lineage_key from pg_temp.ph_master_bulk_stage_v1 s';
    live_keys:='select m.unique_id from public.ph_master_inventory m';
  else
    -- For a small historical set, acquire only the implicated physical UIDs.
    stage_keys:='select s.* from alias_keys k cross join lateral (
      select x.unique_id,x.row_number,x.lineage_key from pg_temp.ph_master_bulk_stage_v1 x where x.unique_id=k.uid offset 0) s';
    live_keys:='select m.* from alias_keys k cross join lateral (
      select x.unique_id from public.ph_master_inventory x where x.unique_id=k.uid offset 0) m';
  end if;
  -- Only the two fixed retrieval fragments differ. One relational predicate
  -- decides ownership, exact lineage, canonical/live exclusions and ambiguity.
  return query execute format($match$
    with historical_aliases as materialized (
      select p.source_unique_id,p.canonical_unique_id from app_sync_private.ph_master_bulk_import_source_v1 p
      where p.source_unique_id<>p.canonical_unique_id
    ), alias_keys as materialized (
      select source_unique_id uid from historical_aliases union select a.canonical_unique_id from historical_aliases a
    ), stage_keys as materialized (%s), live_ids as materialized (%s), candidates as (
      select s.row_number,a.canonical_unique_id,count(*) over(partition by s.row_number) as matches
      from historical_aliases a join stage_keys s on s.unique_id=a.source_unique_id
      join app_sync_private.ph_master_inventory_source_baselines b
        on b.canonical_unique_id=a.canonical_unique_id and b.lineage_key=s.lineage_key
      join live_ids m on m.unique_id=a.canonical_unique_id
      where not exists(select 1 from live_ids own where own.unique_id=a.source_unique_id)
        and not exists(select 1 from stage_keys own where own.unique_id=a.canonical_unique_id)
    )
    select candidates.row_number,candidates.canonical_unique_id from candidates where matches=1
  $match$,stage_keys,live_keys);
end
$alias$;
commit;
