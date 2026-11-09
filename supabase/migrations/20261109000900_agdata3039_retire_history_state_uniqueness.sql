begin;
set local lock_timeout='3s';
set local statement_timeout='15s';

-- The next migration retains independently keyed observations, including a
-- return to the same state. Remove only the three superseded state constraints.
do $retire_state_indexes$
declare
  relation_name text;
  index_name text;
  index_oid regclass;
  expected text;
begin
  if exists(select 1 from cron.job where jobid=56
    and jobname='agdata_historical_state_dedup_v2366'
    and command='select private.run_historical_state_dedup_v2366();' and active) then
    perform cron.alter_job(56,active:=false);
  end if;
  foreach relation_name in array array['ph_orders_history','ph_reserves_history','ph_drive_mode_history'] loop
    index_name:=relation_name||'_item_state_v2366';
    index_oid:=to_regclass(format('public.%I',index_name));
    if index_oid is null then continue; end if;
    expected:=format('CREATE UNIQUE INDEX %I ON public.%I USING btree (itemcode, row_state_hash) WHERE (row_state_hash IS NOT NULL)',
      index_name,relation_name);
    if pg_get_indexdef(index_oid) is distinct from expected
      or exists(select 1 from pg_constraint where conindid=index_oid) then
      raise exception 'AGDATA3039_HISTORY_STATE_INDEX_CONTRACT_CHANGED: %',index_oid;
    end if;
    execute format('drop index public.%I',index_name);
  end loop;
end
$retire_state_indexes$;

commit;
