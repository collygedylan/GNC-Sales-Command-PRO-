begin;
-- Eval2 group pages include bounded inventory previews in the same authorized read.
-- Reuse distinct-value parsing dictionaries without multiplying source joins.
do $migration$
declare definition text; patch record;
begin
  definition:=pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure);
  if position('eval2_preview_candidates as materialized' in definition)>0 then return; end if;
  for patch in select * from (values
    ($old$select value,private.manager_report_sales_year_v1(value) parsed from (select distinct saleyear::text value from public.ph_master_inventory) v$old$,$new$select coalesce(jsonb_object_agg(value,private.manager_report_sales_year_v1(value)) filter(where value is not null),'{}'::jsonb) lookup from (select distinct saleyear::text value from public.ph_master_inventory) v$new$),
    ($old$coalesce(years.parsed,0) sales_year$old$,$new$coalesce(((select lookup from parsed_years)->>m.saleyear::text)::integer,0) sales_year$new$),
    ($old$    left join parsed_years years on years.value=m.saleyear::text
$old$,$new$$new$),
    ($old$select value,private.manager_report_safe_numeric_v1(value) parsed from (select distinct s_lts::text value from public.ph_master_inventory) v$old$,$new$select coalesce(jsonb_object_agg(value,private.manager_report_safe_numeric_v1(value)) filter(where value is not null),'{}'::jsonb) lookup from (select distinct s_lts::text value from public.ph_master_inventory) v$new$),
    ($old$coalesce(stock.parsed,0) slts$old$,$new$coalesce(((select lookup from parsed_stock)->>m.s_lts::text)::numeric,0) slts$new$),
    ($old$    left join parsed_stock stock on stock.value=m.s_lts::text
$old$,$new$$new$),
    ($old$select value,private.manager_report_date_v1(value) parsed from (select holdstopbegindate::text value from public.ph_master_inventory union select locationnotedate::text from public.ph_master_inventory) v where nullif(btrim(value),'') is not null$old$,$new$select coalesce(jsonb_object_agg(value,private.manager_report_date_v1(value)),'{}'::jsonb) lookup from (select holdstopbegindate::text value from public.ph_master_inventory union select locationnotedate::text from public.ph_master_inventory) v where nullif(btrim(value),'') is not null$new$),
    ($old$holds.parsed hold_day$old$,$new$((select lookup from parsed_dates)->>m.holdstopbegindate::text)::date hold_day$new$),
    ($old$    left join parsed_dates holds on holds.value=m.holdstopbegindate::text
$old$,$new$$new$),
    ($old$notes.parsed note_day$old$,$new$((select lookup from parsed_dates)->>m.locationnotedate::text)::date note_day$new$),
    ($old$    left join parsed_dates notes on notes.value=m.locationnotedate::text
$old$,$new$$new$),
    ($old$  ), grouped as (
    select case coalesce(filters->>'groupBy','itemcode')$old$,$new$  ), eval2_preview_candidates as materialized (
    select p.*,row_number() over(partition by p.item_key order by p.assignedto,
      case p.season_key when 'F1' then 1 when 'S1' then 2 when 'U1' then 3 when 'U2' then 4 when 'U3' then 5 when 'X' then 6 when 'Y' then 7 when 'Z' then 8 else 9 end,
      (p.sales_year=0),p.sales_year,private.eval_work_natural_sort_key_v1(p.locationcode),p.unique_id) preview_ordinal
    from filtered p join page_keys k on k.group_key=p.item_key
    where surface='eval2' and operation='groups' and coalesce(filters->>'groupBy','itemcode')='itemcode'
  ), eval2_preview_rows as materialized (
    select item_key,jsonb_agg(jsonb_build_object(
      'unique_id',unique_id,'itemcode',itemcode,'commonname',commonname,'contsize',contsize,
      'locationcode',locationcode,'lotcode',lotcode,'priority',priority,'season',season,'saleyear',saleyear,
      'assignedto',assignedto,'assignedToUsers',jsonb_build_array(coalesce(nullif(assignedto,''),'(Unassigned)')),
      'ptronhand',ptronhand,'ptrreviewed',ptrreviewed,'ptravailable',ptravailable,'s_lts',s_lts,
      'holdstopcode',holdstopcode,'holdstopreason',holdstopreason,'reportIds',report_ids
    ) order by preview_ordinal) rows
    from eval2_preview_candidates where preview_ordinal<=18 group by item_key
  ), grouped as (
    select case coalesce(filters->>'groupBy','itemcode')$new$),
    ($old$      'commonNameCount',common_name_count,
      'representativeRow'$old$,$new$      'commonNameCount',common_name_count,
      'previewRows',coalesce((select rows from eval2_preview_rows preview where preview.item_key=g.item_key),'[]'::jsonb),
      'previewHasMore',surface='eval2' and coalesce(filters->>'groupBy','itemcode')='itemcode' and row_count>18,
      'representativeRow'$new$),
    ($old$      'filteredRowCount',(select count(*) from qualified),$old$,$new$      'reportMatchCount',(select count(*) from classified where cardinality(report_ids)>0),
      'filteredRowCount',(select count(*) from qualified),$new$)
  ) changes(old_text,new_text)
  loop
    if (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text)<>1 then
      raise exception 'MANAGER_EVAL2_PREVIEW_ANCHOR_INVALID: %',left(patch.old_text,100);
    end if;
    definition:=replace(definition,patch.old_text,patch.new_text);
  end loop;
  if position('manager_report_actor_required' in definition)=0
    or position('manager_report_eval2_forbidden' in definition)=0
    or position('published_snapshot_read_proof' in definition)=0
    or position('manager_report_source_revision_changed' in definition)=0 then
    raise exception 'MANAGER_EVAL2_PREVIEW_AUTH_CONTRACT_INVALID';
  end if;
  execute definition;
end
$migration$;
-- Preserve JSON shape and recursion while avoiding per-scalar calls and quadratic array concatenation.
do $enrichment$
declare
  sample jsonb := '{"rows":[{"itemcode":"001","locationcode":"A.01","note":"preserved","n":null,"flag":false,"quantity":0,"children":[{"itemcode":"002","locationcode":"B.02","data":[]}]},{"itemcode":"001","locationcode":"A.01","representativeRow":{"itemcode":"001","locationcode":"A.01"}},{"itemcode":"MISSING","locationcode":"C.03"}],"empty":[],"scalar":9}'::jsonb;
  totals jsonb := '[{"itemcodeKey":"001","locationKey":"A.01","loc_on_hand":12},{"itemcodeKey":"002","locationKey":"B.02","loc_on_hand":0}]'::jsonb;
  expected jsonb;
begin
  expected:=private.manager_report_enrich_location_on_hand_json_v1(sample,totals,'fixture-revision');
  execute $definition$CREATE OR REPLACE FUNCTION private.manager_report_enrich_location_on_hand_json_v1(p_value jsonb, p_totals jsonb, p_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  entry record;
  amount jsonb;
  item_key text;
  location_key text;
begin
  if jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(private.manager_report_enrich_location_on_hand_json_v1(value,p_totals,p_revision) order by ordinal),'[]'::jsonb)
      into result from jsonb_array_elements(p_value) with ordinality e(value,ordinal);
    return result;
  elsif jsonb_typeof(p_value)='object' then
    result:=p_value;
    for entry in select key,value from jsonb_each(p_value) where jsonb_typeof(value) in ('array','object') loop
      result:=result||jsonb_build_object(entry.key,
        private.manager_report_enrich_location_on_hand_json_v1(entry.value,p_totals,p_revision));
    end loop;
    item_key:=upper(btrim(coalesce(p_value->>'itemcode','')));
    location_key:=upper(btrim(coalesce(p_value->>'locationcode','')));
    if item_key<>'' and location_key<>'' and not (p_value ? 'representativeRow') then
      select value->'loc_on_hand' into amount from jsonb_array_elements(coalesce(p_totals,'[]'::jsonb)) x(value)
        where value->>'itemcodeKey'=item_key and value->>'locationKey'=location_key limit 1;
      result:=result||jsonb_build_object('loc_on_hand',amount,'loc_on_hand_revision',p_revision);
    end if;
    return result;
  end if;
  return p_value;
end
$function$
$definition$;
  if private.manager_report_enrich_location_on_hand_json_v1(sample,totals,'fixture-revision') is distinct from expected then
    raise exception 'MANAGER_EVAL2_PREVIEW_JSON_PARITY_INVALID';
  end if;
end
$enrichment$;
revoke all on function public.manager_report_read_v2(jsonb) from public,anon,authenticated;
grant execute on function public.manager_report_read_v2(jsonb) to service_role;
commit;

