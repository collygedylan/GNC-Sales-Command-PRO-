begin;

-- Bring legacy Season mirror rows into the bounded reconciliation scope and
-- remove only mirror records that are not an active lifecycle winner.
do $repair$
declare
  original_definition text;
  patched_definition text;
  scoped_old text := $old$        or exists (
          select 1
          from public.ph_season_sales_office_state state
          where state.season_code = current_season
            and state.sales_year = current_sales_year
            and state.itemcode_normalized = upper(btrim(requested.value))
        )
      );$old$;
  scoped_new text := $new$        or exists (
          select 1
          from public.ph_season_sales_office_state state
          where state.season_code = current_season
            and state.sales_year = current_sales_year
            and state.itemcode_normalized = upper(btrim(requested.value))
        )
        or exists (
          select 1
          from public.ph_sales_office sales
          where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
            and upper(btrim(coalesce(sales.itemcode, ''))) = upper(btrim(requested.value))
        )
      );$new$;
  global_old text := $old$    where state.season_code = current_season and state.sales_year = current_sales_year;
  end if;$old$;
  global_new text := $new$    where state.season_code = current_season and state.sales_year = current_sales_year
    union
    select distinct upper(btrim(sales.itemcode))
    from public.ph_sales_office sales
    where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
      and btrim(coalesce(sales.itemcode, '')) <> '';
  end if;$new$;
  response_marker text := $marker$  response_value := jsonb_build_object('ok', true, 'status', 'completed',$marker$;
  cleanup_block text := $cleanup$  -- ph_sales_office is the open-work mirror only. Remove legacy Season rows
  -- that are no longer the current open lifecycle winner.
  delete from public.ph_sales_office sales
  using season_sales_target_items_v1 target
  where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
    and target.itemcode_normalized = upper(btrim(coalesce(sales.itemcode, '')))
    and not exists (
      select 1
      from public.ph_season_sales_office_state state
      where state.season_code = current_season
        and state.sales_year = current_sales_year
        and state.status = 'open'
        and state.winner_unique_id = coalesce(sales.master_id, sales.unique_id)
    );

  response_value := jsonb_build_object('ok', true, 'status', 'completed',$cleanup$;
begin
  select pg_get_functiondef(
    'public.reconcile_season_sales_office_v1(text[],boolean,text,text)'::regprocedure
  ) into original_definition;

  if position(scoped_new in original_definition) > 0
     and position(global_new in original_definition) > 0
     and position('using season_sales_target_items_v1 target' in original_definition) > 0 then
    return;
  end if;

  patched_definition := replace(original_definition, scoped_old, scoped_new);
  patched_definition := replace(patched_definition, global_old, global_new);
  patched_definition := replace(patched_definition, response_marker, cleanup_block);

  if patched_definition = original_definition
     or position(scoped_new in patched_definition) = 0
     or position(global_new in patched_definition) = 0
     or position(cleanup_block in patched_definition) = 0 then
    raise exception 'SEASON_SALES_LEGACY_MIRROR_PATCH_FAILED';
  end if;
  execute patched_definition;
end
$repair$;

commit;
