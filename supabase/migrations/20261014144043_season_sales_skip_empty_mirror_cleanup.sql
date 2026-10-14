begin;

-- An empty DELETE still invokes statement-level revision and live-event
-- triggers. Keep cleanup for obsolete winners, but avoid it for a valid mirror.
do $migration$
declare
  definition text;
  old_cleanup text := E'delete from public.ph_sales_office sales\n  where lower(btrim(coalesce(sales.so_source, ''season''))) = ''season''\n    and upper(btrim(coalesce(sales.itemcode, ''''))) = p_state.itemcode_normalized\n    and coalesce(sales.master_id, sales.unique_id) <> p_winner.unique_id;';
  new_cleanup text;
begin
  new_cleanup := E'if exists (\n    select 1 from public.ph_sales_office sales\n    where lower(btrim(coalesce(sales.so_source, ''season''))) = ''season''\n      and upper(btrim(coalesce(sales.itemcode, ''''))) = p_state.itemcode_normalized\n      and coalesce(sales.master_id, sales.unique_id) <> p_winner.unique_id\n  ) then\n    ' || old_cleanup || E'\n  end if;';
  definition := replace(pg_get_functiondef(
    'private.season_sales_mirror_winner_v1(public.ph_master_inventory,public.ph_season_sales_office_state)'::regprocedure
  ), E'\r\n', E'\n');
  if position(new_cleanup in definition) > 0 then return; end if;
  if (length(definition) - length(replace(definition, old_cleanup, ''))) / length(old_cleanup) <> 1 then
    raise exception 'SEASON_SALES_EMPTY_CLEANUP_GUARD_MISMATCH';
  end if;
  execute replace(definition, old_cleanup, new_cleanup);
end
$migration$;

commit;
