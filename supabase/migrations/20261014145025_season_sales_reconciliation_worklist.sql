begin;

-- A fenced importer can reconcile bounded subsets of the existing complete
-- scope. Include stale state/mirror keys selected by the original planner so
-- retirement is not lost when it batches work across API transactions.
do $migration$
declare
  definition text;
  before_text text := E'''scopeCount'', (select count(*) from season_sales_target_items_v1));';
  after_text text := E'''scopeCount'', (select count(*) from season_sales_target_items_v1),\n      ''scopeHash'', scope_hash,\n      ''itemcodes'', (select coalesce(jsonb_agg(target.itemcode_normalized order by target.itemcode_normalized), ''[]''::jsonb)\n        from season_sales_target_items_v1 target));';
begin
  definition := replace(pg_get_functiondef(
    'public.reconcile_season_sales_office_v1(text[],boolean,text,text)'::regprocedure
  ), E'\r\n', E'\n');
  if position(after_text in definition) > 0 then return; end if;
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_WORKLIST_GUARD_MISMATCH';
  end if;
  execute replace(definition, before_text, after_text);
end
$migration$;

commit;
