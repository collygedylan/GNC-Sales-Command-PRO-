begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- Most ERP values are already normalized. Keep the existing escape repair
-- for rows that contain it, without rebuilding every other JSON object.
create or replace function private.fast_erp_clean_row_v2369(p_row jsonb)
returns jsonb language sql immutable set search_path='' as $clean$
  select case when jsonb_typeof(p_row)='object'
    and strpos(p_row::text,chr(92)||chr(92)||chr(39))=0 then p_row
    else coalesce((select jsonb_object_agg(entry.key,
      case when jsonb_typeof(entry.value)='string'
        then to_jsonb(replace(entry.value#>>'{}',chr(92)||chr(39),chr(39)))
        else entry.value end)
      from jsonb_each(p_row) entry),'{}'::jsonb) end
$clean$;

do $pipeline$
declare
  fn regprocedure := 'public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(fn);
  start_text text := 'select jsonb_agg(case when row_value ? ''values'' then';
  end_text text := 'end order by ordinality)';
  runner regprocedure := 'private.run_erp_stage_publication_v3042(uuid)'::regprocedure;
  commit_text text := '    receipt := public.fast_commit_erp_stage_swap_v1(p_stage_id);';
begin
  if strpos(definition,start_text)=0 or strpos(definition,end_text)=0 then
    raise exception 'ERP_DRIVE_PAYLOAD_AGGREGATE_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,start_text,$open$select ('['||string_agg((case when row_value ? 'values' then$open$);
  execute replace(definition,end_text,$close$end)::text,',' order by ordinality)||']')::jsonb$close$);

  -- Scheduled maintenance yields to ERP. The reconciliation inside the
  -- canonical publisher is part of ERP and must still run to completion.
  definition:=pg_get_functiondef(runner);
  if strpos(definition,commit_text)=0 then raise exception 'ERP_NATIVE_PUBLISH_ANCHOR_MISSING'; end if;
  execute replace(definition,commit_text,$name$    perform set_config('application_name','agdata_erp_publication',true);
$name$||commit_text);
end
$pipeline$;

-- Exact matches are already assigned by the map below this query. Limit alias
-- work to unmatched source and target identities before inspecting lineage.
do $ordinals$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  start_at integer := strpos(definition,'  with unresolved as materialized (');
  end_at integer := strpos(definition,'  select distinct s.row_number, c.canonical_unique_id,');
begin
  if start_at=0 or end_at<=start_at or strpos(definition,'private.ph_master_inventory_lineage_key_v1(to_jsonb(m))')=0 then
    raise exception 'ERP_MASTER_ORDINAL_EDGE_ANCHOR_MISSING';
  end if;
  execute overlay(definition placing $edges$  with unresolved as materialized (
    select s.row_number,s.lineage_key,private.ph_master_inventory_stable_identity_v7(s.raw_values) as stable_key
    from pg_temp.ph_master_bulk_stage_v1 s
    where not exists(select 1 from public.ph_master_inventory m where m.unique_id=s.unique_id)
  ), eligible_live as materialized (
    select unique_id from public.ph_master_inventory
    except select unique_id from pg_temp.ph_master_bulk_stage_v1
  ), stable_aliases as materialized (
    select s.row_number,s.lineage_key,e.unique_id as canonical_unique_id
    from unresolved s
    join app_sync_private.ph_master_inventory_item6_source_v7 i on i.stable_identity_key=s.stable_key
    join eligible_live e on e.unique_id=i.canonical_unique_id
  ), candidates as materialized (
    select s.row_number,e.unique_id as canonical_unique_id
    from unresolved s
    join app_sync_private.ph_master_inventory_source_baselines b on b.lineage_key=s.lineage_key
    join eligible_live e on e.unique_id=b.canonical_unique_id
    union all
    select s.row_number,s.canonical_unique_id
    from stable_aliases s
    join public.ph_master_inventory m on m.unique_id=s.canonical_unique_id
    where exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 edit
      where edit.canonical_unique_id=s.canonical_unique_id and edit.pending
        and edit.field_name in ('desigitem','desigcust','desigloc'))
      or private.ph_master_inventory_lineage_key_v1(m)=s.lineage_key
  )
$edges$ from start_at for end_at-start_at);
end
$ordinals$;

commit;
