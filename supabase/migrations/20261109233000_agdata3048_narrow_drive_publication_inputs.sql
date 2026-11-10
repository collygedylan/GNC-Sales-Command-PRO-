begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- The sealed stage already derives an exact set of source keys per tuple.
-- Validate those sets once and leave live identity/override work inside the
-- publication fence. Only definer-owned temporary relations can be reused.
do $validation$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  columns_anchor text := 'from (select distinct unnest(s.field_keys) as key from pg_temp.ph_master_bulk_stage_v1 s) k';
  ownership_anchor text := 'and to_regclass(''pg_temp.ph_master_bulk_tuples_v3046'') is not null then';
  mask_anchor text := $mask$    select 1 from pg_temp.ph_master_bulk_stage_v1 s
    where exists(select 1 from unnest(s.raw_item6_fields) f(field_name)
      where not (f.field_name = any(allowed_item6)) or not (s.raw_values ? f.field_name))
       or exists(select 1 from unnest(allowed_item6) f(field_name)
      where s.raw_values ? f.field_name and not (f.field_name = any(s.raw_item6_fields)))$mask$;
begin
  if strpos(definition,columns_anchor)=0 or strpos(definition,mask_anchor)=0 or strpos(definition,ownership_anchor)=0 then
    raise exception 'ERP_DRIVE_SEALED_TUPLE_VALIDATION_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,columns_anchor,replace(columns_anchor,'ph_master_bulk_stage_v1','ph_master_bulk_tuples_v3046'));
  definition:=replace(definition,mask_anchor,$mask$    select 1 from pg_temp.ph_master_bulk_tuples_v3046 s
    where not s.raw_item6_fields <@ allowed_item6 or not s.raw_item6_fields <@ s.field_keys
      or exists(select 1 from unnest(allowed_item6) f(field_name)
        where f.field_name=any(s.field_keys) and not f.field_name=any(s.raw_item6_fields))$mask$);
  execute replace(definition,ownership_anchor,$proof$and to_regclass('pg_temp.ph_master_bulk_tuples_v3046') is not null
    and not exists(select 1 from pg_class c where c.relnamespace=pg_my_temp_schema()
      and c.relname in ('agdata_drive_publication_input_v3042','ph_master_bulk_stage_v1','ph_master_bulk_tuples_v3046')
      and pg_get_userbyid(c.relowner)<>current_user) then$proof$);
end
$validation$;

-- The canonical classifier still owns every assignment decision. Project
-- only the typed columns it consumes instead of serializing whole rows.
do $assignment$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  classifier text := pg_get_functiondef('private.ph_master_bulk_assignedto_override_v1(jsonb)'::regprocedure);
  expected text[] := array['commonname','genusname','locationcode','plantgroupcode'];
  accepted text[] := array['commonname','description','genus','genusname','location','locationcode','plantgroup','plantgroupcode'];
  actual text[];
  alias_name text;
  token text;
begin
  select array_agg(distinct lower(m[1]) order by lower(m[1])) into actual
  from regexp_matches(classifier,$key$p_row\s*->>\s*'([a-z_]+)'$key$,'gi') key(m);
  if actual is distinct from accepted or (select array_agg(attname::text order by attname)
      from pg_attribute where attrelid='public.ph_master_inventory'::regclass and attnum>0 and not attisdropped
        and lower(attname)=any(accepted)) is distinct from expected then
    raise exception 'ERP_DRIVE_ASSIGNMENT_PROJECTION_SHAPE_CHANGED';
  end if;
  foreach alias_name in array array['s','excluded','target'] loop
    token:=format('private.ph_master_bulk_assignedto_override_v1(to_jsonb(%s))',alias_name);
    if strpos(definition,token)=0 then raise exception 'ERP_DRIVE_ASSIGNMENT_PROJECTION_ANCHOR_MISSING'; end if;
    definition:=replace(definition,token,format($call$private.ph_master_bulk_assignedto_override_v1(jsonb_build_object(
      ''commonname'',%1$s.commonname,''genusname'',%1$s.genusname,''locationcode'',%1$s.locationcode,''plantgroupcode'',%1$s.plantgroupcode))$call$,alias_name));
  end loop;
  execute definition;
end
$assignment$;

-- Compute the same order/depletion witness from live rows and typed ledger
-- entries under the final transaction. The ledger writes below are untouched.
do $stock$
declare
  definition text := pg_get_functiondef('private.apply_inventory_live_overrides_bulk_v1(uuid)'::regprocedure);
  start_at integer := strpos(definition,'  with pending as (select canonical_unique_id,jsonb_object_agg');
  end_at integer := strpos(definition,'  ) select raw.*,private.erp_order_delta_v23196(');
begin
  if start_at=0 or end_at<=start_at then raise exception 'ERP_DRIVE_ORDER_LEDGER_PROJECTION_ANCHOR_MISSING'; end if;
  execute overlay(definition placing $snapshot$  with raw as (
    select s.row_number,m.unique_id,
      coalesce(m.erp_on_hand,private.inventory_location_evidence_number_v2(oh.latest_erp_value#>>'{}'),
        private.inventory_location_evidence_number_v2(m.ptronhand),0) old_oh,
      coalesce(m.erp_ptrreview,private.inventory_location_evidence_number_v2(rv.latest_erp_value#>>'{}'),
        private.inventory_location_evidence_number_v2(m.ptrreviewed),0) old_review,
      coalesce(private.inventory_location_evidence_number_v2(s.raw_values->>'ptronhand'),0) new_oh,
      coalesce(private.inventory_location_evidence_number_v2(s.raw_values->>'ptrreviewed'),0) new_review,
      case when oh.pending then greatest(0,coalesce(
        private.inventory_location_evidence_number_v2(oh.erp_baseline_value#>>'{}')-
        private.inventory_location_evidence_number_v2(oh.app_override_value#>>'{}'),0)) else 0 end pending_out,
      coalesce(m.loc_photo_match,private.inventory_location_evidence_number_v2(m.loc_match_qty),0) old_match,
      coalesce(m.photo_date,m.av_rule_photo_updated_at,m.date_completed) photo_date
    from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 map using(row_number)
    join public.ph_master_inventory m on m.unique_id=map.canonical_unique_id
    left join app_sync_private.inventory_live_overrides_v1 oh on oh.canonical_unique_id=m.unique_id and oh.field_name='ptronhand'
    left join app_sync_private.inventory_live_overrides_v1 rv on rv.canonical_unique_id=m.unique_id and rv.field_name='ptrreviewed'
    where map.candidate_count=1
$snapshot$ from start_at for end_at-start_at);
end
$stock$;

commit;
