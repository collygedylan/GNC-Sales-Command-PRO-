begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Preserve each authenticated/server grant before removing PUBLIC inheritance.
-- RLS policies, signed service-role imports, row identities and data stay intact.
do $lockdown$
declare relation record; routine record; col record; privilege text; grantee text;
begin
  for relation in select c.oid,n.nspname,c.relname,c.relkind,c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f')
  loop
    if relation.relkind in ('r','p') and not relation.relrowsecurity then
      execute format('alter table %I.%I enable row level security',relation.nspname,relation.relname);
    end if;
    foreach privilege in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      foreach grantee in array array['authenticated','service_role'] loop
        if has_table_privilege(grantee,relation.oid,privilege) then
          execute format('grant %s on table %I.%I to %I',privilege,relation.nspname,relation.relname,grantee);
        end if;
      end loop;
      execute format('revoke %s on table %I.%I from public,anon',privilege,relation.nspname,relation.relname);
    end loop;
    -- Column-level grants survive a table REVOKE, so remove those as well.
    for col in select attname,attnum from pg_attribute where attrelid=relation.oid
      and attnum>0 and not attisdropped and attacl is not null
    loop
      foreach privilege in array array['INSERT','UPDATE','REFERENCES'] loop
        foreach grantee in array array['authenticated','service_role'] loop
          if has_column_privilege(grantee,relation.oid,col.attnum,privilege) then
            execute format('grant %s (%I) on table %I.%I to %I',privilege,col.attname,relation.nspname,relation.relname,grantee);
          end if;
        end loop;
        execute format('revoke %s (%I) on table %I.%I from public,anon',privilege,col.attname,relation.nspname,relation.relname);
      end loop;
    end loop;
  end loop;

  -- Volatile routines may mutate; definer routines must never provide an anon
  -- alternative to the verified app-api actor. Existing Auth RPC grants survive.
  for routine in select p.oid,p.oid::regprocedure::text identity
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind in ('f','p')
      and (p.provolatile='v' or p.prosecdef)
  loop
    foreach grantee in array array['authenticated','service_role'] loop
      if has_function_privilege(grantee,routine.oid,'EXECUTE') then
        execute format('grant execute on routine %s to %I',routine.identity,grantee);
      end if;
    end loop;
    execute format('revoke execute on routine %s from public,anon',routine.identity);
  end loop;
end
$lockdown$;

alter default privileges in schema public revoke insert,update,delete,truncate,references,trigger on tables from public,anon;
alter default privileges in schema public revoke execute on functions from public,anon;

do $assert_lockdown$
begin
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity) then
    raise exception 'ZERO_TRUST_RLS_DISABLED';
  end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f')
      and (has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE')
        or has_table_privilege('anon',c.oid,'DELETE') or has_table_privilege('anon',c.oid,'TRUNCATE')
        or has_any_column_privilege('anon',c.oid,'INSERT') or has_any_column_privilege('anon',c.oid,'UPDATE'))) then
    raise exception 'ZERO_TRUST_ANON_MUTATION_GRANT';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind in ('f','p') and (p.provolatile='v' or p.prosecdef)
      and has_function_privilege('anon',p.oid,'EXECUTE')) then
    raise exception 'ZERO_TRUST_ANON_MUTATION_RPC';
  end if;
end
$assert_lockdown$;
commit;
