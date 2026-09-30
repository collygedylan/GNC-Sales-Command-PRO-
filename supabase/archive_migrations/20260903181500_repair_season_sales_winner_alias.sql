begin;

-- Correct the already-installed reconciler without duplicating its full body.
-- Fresh databases receive the same correction in the original migration.
do $repair$
declare
  original_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.reconcile_season_sales_office_v1(text[],boolean,text,text)'::regprocedure
  ) into original_definition;

  if position('case when winner.unique_id = m.unique_id' in original_definition) = 0
     and position('case when winner_key.unique_id = m.unique_id' in original_definition) > 0 then
    return;
  end if;

  patched_definition := replace(
    original_definition,
    'left join season_sales_winners_v1 winner using (itemcode_normalized)',
    'left join season_sales_winners_v1 winner_key using (itemcode_normalized)'
  );
  patched_definition := replace(
    patched_definition,
    'case when winner.unique_id = m.unique_id',
    'case when winner_key.unique_id = m.unique_id'
  );

  if patched_definition = original_definition
     or position('case when winner.unique_id = m.unique_id' in patched_definition) > 0 then
    raise exception 'SEASON_SALES_WINNER_ALIAS_PATCH_FAILED';
  end if;
  execute patched_definition;
end
$repair$;

commit;
