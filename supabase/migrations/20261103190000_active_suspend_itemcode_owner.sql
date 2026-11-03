begin;
set local lock_timeout = '1500ms';
set local statement_timeout = '15s';

-- Extend the installed line-level projection without changing its physical
-- identity, evidence fields, terminal-cycle predicates or existing grants.
do $migration$
declare
  prior text := rtrim(pg_get_viewdef('public.ph_active_suspend'::regclass, true), E';\n ');
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.ph_active_suspend'::regclass
                 and attname = 'suspend_eval_owner' and not attisdropped) then
    execute format($view$
      create or replace view public.ph_active_suspend with (security_invoker=true) as
      with owners as materialized (
        select itemcode_normalized as code, lower(trim(assignedto)) as owner
        from public.ph_itemcode_default_owners
        where nullif(trim(assignedto),'') is not null
      ), families as (
        select distinct on (family) family, owner
        from (
          select split_part(code,'.',1) as family, owner, count(*) as votes
          from owners where split_part(code,'.',1) ~ '^[0-9]{6}$'
          group by 1,2
        ) ranked order by family, votes desc, owner collate "C"
      )
      select tag.*, coalesce(exact.owner, families.owner) as suspend_eval_owner
      from (%s) tag
      left join owners exact on exact.code = upper(trim(tag.itemcode))
      left join families on families.family = split_part(upper(trim(tag.itemcode)),'.',1)
    $view$, prior);
  end if;
  if exists (
    with expected as (
      select unique_id from public.ph_soc_master
      where upper(trim(suspend)) = 'SUSPEND' and date_completed is null
        and lower(trim(coalesce(suspend_candidate_state,''))) not in ('complete','completed','approved','rejected')
    ), actual as (select unique_id from public.ph_active_suspend)
    (select * from expected except all select * from actual)
    union all
    (select * from actual except all select * from expected)
  ) then raise exception 'Active Suspend physical line mismatch'; end if;
end $migration$;
notify pgrst, 'reload schema';
commit;
