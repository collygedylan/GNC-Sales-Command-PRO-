begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

create index if not exists ph_crop_roll_drive_rows_master_uid_v3048_idx
  on public.ph_crop_roll_drive_rows(master_unique_id);

-- Crop Roll is part of the operational snapshot. Join the exact touched UIDs
-- as a relation, and keep a matching projection's timestamp and indexes intact.
do $crop$
declare
  definition text := pg_get_functiondef('private.sync_ph_master_bulk_crop_roll_v1(uuid,uuid,text[])'::regprocedure);
  delete_anchor text := '  where crop.master_unique_id=any(p_touched_ids) and not exists(';
  upsert_anchor text := $join$  insert into public.ph_crop_roll_drive_rows
  select mapped.* from public.ph_master_inventory master
  cross join lateral private.ph_master_crop_roll_from_master_v1(master) mapped
  where master.unique_id=any(p_touched_ids) and mapped.unique_id is not null$join$;
  stamp text := ',updated_at=now();';
  set_at integer := strpos(definition,'on conflict(unique_id) do update set');
  stamp_at integer := strpos(definition,stamp);
  assignments text;
  current_values text;
  projected_values text;
  field_count integer;
begin
  if strpos(definition,delete_anchor)=0 or strpos(definition,upsert_anchor)=0 or set_at=0 or stamp_at<=set_at then
    raise exception 'ERP_CROP_ROLL_TOUCHED_JOIN_ANCHOR_MISSING';
  end if;
  set_at:=set_at+length('on conflict(unique_id) do update set');
  assignments:=substring(definition from set_at for stamp_at-set_at);
  select string_agg(format('crop.%I',parts[1]),',' order by ord),
    string_agg(format('excluded.%I',parts[1]),',' order by ord),count(*)
  into current_values,projected_values,field_count
  from regexp_matches(assignments,$field$(?:^|,)\s*([a-z_][a-z_0-9]*)\s*=\s*excluded\.\1\s*(?=,|$)$field$,'g')
    with ordinality fields(parts,ord);
  if field_count<1 or field_count<>cardinality(string_to_array(assignments,',')) then
    raise exception 'ERP_CROP_ROLL_UPDATE_PROJECTION_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,delete_anchor,$join$  using (select distinct id from unnest(p_touched_ids) touched(id) where id is not null) ids
  where crop.master_unique_id=ids.id and not exists($join$);
  definition:=replace(definition,upsert_anchor,$join$  insert into public.ph_crop_roll_drive_rows as crop
  select mapped.* from (select distinct id from unnest(p_touched_ids) touched(id) where id is not null) ids
  join public.ph_master_inventory master on master.unique_id=ids.id
  cross join lateral private.ph_master_crop_roll_from_master_v1(master) mapped
  where mapped.unique_id is not null$join$);
  execute replace(definition,stamp,format(',updated_at=now()'||chr(10)||
    '  where row(%s) is distinct from row(%s);',current_values,projected_values));
end
$crop$;

commit;
