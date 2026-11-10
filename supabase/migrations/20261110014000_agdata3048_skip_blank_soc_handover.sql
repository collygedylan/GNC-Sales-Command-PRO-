begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- An unassigned SOC row cannot be transformed by the scheduled handover.
do $guard$
declare fields text[];
begin
  select array_agg(distinct field order by field) into fields
  from private.handover_assignment_targets_v1() t cross join lateral unnest(t.field_names) fields(field)
  where t.table_name='ph_soc_master';
  if fields is distinct from array['assignedto','flyer_assigned']::text[]
    or private.handover_replace_identity_v1(null::text) is not null
    or not exists(select 1 from pg_trigger t where t.tgrelid='public.ph_soc_master'::regclass
      and t.tgname='scheduled_handover_normalize_assignment' and t.tgtype=23 and t.tgenabled='O' and t.tgqual is null
      and t.tgfoid='private.handover_normalize_assignment_v1()'::regprocedure
      and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
        where a.attrelid=t.tgrelid and a.attnum=any(t.tgattr::smallint[]))=fields) then
    raise exception 'ERP_SOC_HANDOVER_SCOPE_CHANGED';
  end if;
end
$guard$;

create or replace trigger scheduled_handover_normalize_assignment
before insert or update of assignedto,flyer_assigned on public.ph_soc_master
for each row when (new.assignedto is not null or new.flyer_assigned is not null)
execute function private.handover_normalize_assignment_v1();

commit;
