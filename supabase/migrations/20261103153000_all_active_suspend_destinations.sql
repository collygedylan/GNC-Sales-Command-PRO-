begin;
set local lock_timeout = '1500ms';
set local statement_timeout = '15s';

-- Preserve the installed invoker view's column order, joins, and grants. Only
-- the obsolete destination predicate changes. Both dependent reads stay live.
do $migration$
declare
  prior text := pg_get_viewdef('public.ph_active_suspend'::regclass, true);
  dc_clause constant text := $pattern$ AND lower\(btrim\(COALESCE\([[:alnum:]_]+\.suspend_to, ''::text\)\)\) = 'dc'::text$pattern$;
  revised text := regexp_replace(prior, dc_clause, '', 'g');
begin
  if prior <> revised then
    if regexp_count(prior, dc_clause) <> 1 then
      raise exception 'Ambiguous active Suspend destination predicate';
    end if;
    execute 'create or replace view public.ph_active_suspend with (security_invoker=true) as ' || revised;
  end if;

  if not exists (select 1 from pg_class where oid='public.ph_active_suspend'::regclass
      and reloptions @> array['security_invoker=true']) then
    raise exception 'Active Suspend must use caller permissions';
  end if;
  if exists (
    with expected as (
      select unique_id from public.ph_soc_master
      where upper(btrim(suspend)) = 'SUSPEND' and date_completed is null
        and lower(btrim(coalesce(suspend_candidate_state,''))) not in ('complete','completed','approved','rejected')
    ), actual as (select unique_id from public.ph_active_suspend)
    (select * from expected except all select * from actual)
    union all
    (select * from actual except all select * from expected)
  ) then
    raise exception 'Active Suspend must include every eligible physical SOC line exactly once';
  end if;
end
$migration$;
notify pgrst, 'reload schema';
commit;
