-- Permanent helper map used across the split rename migrations.
create table if not exists public.__rename_v2_ph_relation_map_20260802 (
  old_name text primary key,
  new_name text not null,
  relkind "char" not null
);

insert into public.__rename_v2_ph_relation_map_20260802 (old_name, new_name, relkind)
select
  c.relname,
  regexp_replace(c.relname, '^v2_', 'ph_'),
  c.relkind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname like 'v2\_%' escape '\'
  and c.relkind in ('r', 'p', 'v', 'm', 'S')
on conflict (old_name) do update
set new_name = excluded.new_name,
    relkind = excluded.relkind;
