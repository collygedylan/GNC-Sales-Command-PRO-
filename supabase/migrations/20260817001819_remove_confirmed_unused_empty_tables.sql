-- V2026.08.16.11 backend cleanup (production migration 20260817001819)
--
-- Removes only exact-empty, dependency-audited legacy objects.  RESTRICT is
-- intentional: the migration aborts instead of cascading into an unknown
-- dependency.  The three farm-prefixed table sets were created as empty
-- future placeholders and are not referenced by the live application.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $audit$
declare
  candidate record;
  candidate_count integer;
  candidate_has_rows boolean;
  candidate_comment text;
begin
  select count(*)::integer
    into candidate_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname ~ '^(hl|nc|tx)_';

  if candidate_count <> 102 then
    raise exception
      'Expected 102 audited future-farm tables, found %; refusing cleanup',
      candidate_count;
  end if;

  for candidate in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname ~ '^(hl|nc|tx)_'
    order by c.relname
  loop
    candidate_comment := obj_description(candidate.oid, 'pg_class');
    if candidate_comment is null
       or candidate_comment not like 'Future farm table cloned empty from public.%' then
      raise exception
        'Table public.% is not an audited future-farm placeholder; refusing cleanup',
        candidate.relname;
    end if;

    execute format(
      'select exists (select 1 from public.%I limit 1)',
      candidate.relname
    ) into candidate_has_rows;

    if candidate_has_rows then
      raise exception
        'Table public.% now contains data; refusing cleanup',
        candidate.relname;
    end if;
  end loop;
end
$audit$;

-- These compatibility views have no downstream view or function references.
drop view if exists public.v2_employee_time_cards restrict;
drop view if exists public.v2_eval_assignment_rules_import restrict;
drop view if exists public.v2_outlook_accounts restrict;
drop view if exists public.v2_security_audit_events restrict;
drop view if exists public.v2_walkie_voice_messages restrict;

-- These legacy tables were exact-empty and have no application, function,
-- foreign-key, publication, or remaining view dependencies.
drop table if exists public.ph_employee_time_cards restrict;
drop table if exists public.ph_eval_assignment_rules_import restrict;
drop table if exists public.ph_outlook_accounts restrict;
drop table if exists public.ph_security_audit_events restrict;
drop table if exists public.ph_walkie_voice_messages restrict;

-- Drop the 102 verified future-farm placeholders.  Any unexpected dependency
-- causes RESTRICT to abort the entire transactional migration.
do $cleanup$
declare
  candidate record;
begin
  for candidate in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname ~ '^(hl|nc|tx)_'
    order by c.relname
  loop
    execute format('drop table public.%I restrict', candidate.relname);
  end loop;
end
$cleanup$;
