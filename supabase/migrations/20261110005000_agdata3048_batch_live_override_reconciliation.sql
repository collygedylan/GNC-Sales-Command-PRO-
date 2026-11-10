begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Match raw source evidence once across the exact mapped rows. Then apply
-- still-pending staged fields as a single typed patch per physical row.
do $overrides$
declare
  target regprocedure := 'private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure;
  definition text := pg_get_functiondef(target);
  start_at integer := strpos(definition,'  -- Only raw source fields can acknowledge an override.');
  end_at integer := strpos(definition,'  -- Season-level stock edits also apply to newly arriving physical rows.');
  declaration text := '  v_field_name text;';
begin
  if start_at=0 or end_at<=start_at or strpos(definition,declaration)=0
    or regexp_count(substring(definition from start_at for end_at-start_at),'update app_sync_private.inventory_live_overrides_v1')<>2 then
    raise exception 'ERP_DRIVE_LIVE_OVERRIDE_BATCH_ANCHOR_MISSING';
  end if;
  definition:=overlay(definition placing $batch$  -- Only an exact raw field can acknowledge an app override. Match against
  -- the UPDATE target so a concurrent writer's newer override is evaluated.
  update app_sync_private.inventory_live_overrides_v1 e set
    pending=not private.inventory_override_matches_v1(e.field_name,s.raw_values->e.field_name,e.app_override_value),
    latest_erp_value=s.raw_values->e.field_name,
    reconciled_at=case when private.inventory_override_matches_v1(e.field_name,s.raw_values->e.field_name,e.app_override_value)
      then clock_timestamp() else e.reconciled_at end,
    updated_at=clock_timestamp()
  from pg_temp.ph_master_bulk_map_v1 mapped
  join pg_temp.ph_master_bulk_stage_v1 s using(row_number),pg_catalog.pg_attribute field
  where mapped.canonical_unique_id=e.canonical_unique_id and mapped.candidate_count=1 and e.pending
    and field.attrelid='pg_temp.ph_master_bulk_stage_v1'::regclass
    and field.attnum>0 and not field.attisdropped and field.attname=e.field_name
    and s.raw_values ? e.field_name;

  select string_agg(format('%I',field.attname),',' order by field.attnum),
    string_agg(format('patched.%I',field.attname),',' order by field.attnum)
  into override_columns,override_projection
  from pg_catalog.pg_attribute field
  where field.attrelid='pg_temp.ph_master_bulk_stage_v1'::regclass
    and field.attnum>0 and not field.attisdropped and exists (
      select 1 from app_sync_private.inventory_live_overrides_v1 e where e.pending and e.field_name=field.attname);

  if override_columns is not null then
    execute format($patch$
      with pending_patches as materialized (
        select s.row_number,jsonb_object_agg(e.field_name,e.app_override_value) fields
        from pg_temp.ph_master_bulk_map_v1 mapped
        join pg_temp.ph_master_bulk_stage_v1 s using(row_number)
        join app_sync_private.inventory_live_overrides_v1 e using(canonical_unique_id)
        join pg_catalog.pg_attribute field on field.attrelid='pg_temp.ph_master_bulk_stage_v1'::regclass
          and field.attnum>0 and not field.attisdropped and field.attname=e.field_name
        where mapped.candidate_count=1 and e.pending and (not (s.raw_values ? e.field_name)
          or not private.inventory_override_matches_v1(e.field_name,s.raw_values->e.field_name,e.app_override_value))
        group by s.row_number
      )
      update pg_temp.ph_master_bulk_stage_v1 s set (%1$s)=(
        select %2$s from jsonb_populate_record(s,p.fields) patched
      ) from pending_patches p where p.row_number=s.row_number
    $patch$,override_columns,override_projection);
  end if;

$batch$ from start_at for end_at-start_at);
  execute replace(definition,declaration,declaration||E'\n  override_columns text;\n  override_projection text;');
end
$overrides$;

commit;
