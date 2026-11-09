begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- A previous source UID is authoritative for this fast path only when its
-- current canonical row still owns the exact lineage and no staged exact UID
-- already owns that row. Ambiguity stays in the existing ordinal resolver.
create function private.prior_drive_source_aliases_v3046()
returns table(row_number bigint,canonical_unique_id text)
language plpgsql stable set search_path='' as $alias$
begin
  return query
  with candidates as (
    select s.row_number,p.canonical_unique_id,count(*) over(partition by s.row_number) as matches
    from pg_temp.ph_master_bulk_stage_v1 s
    join app_sync_private.ph_master_bulk_import_source_v1 p on p.source_unique_id=s.unique_id
    join app_sync_private.ph_master_inventory_source_baselines b
      on b.canonical_unique_id=p.canonical_unique_id and b.lineage_key=s.lineage_key
    join public.ph_master_inventory m on m.unique_id=p.canonical_unique_id
    where p.canonical_unique_id<>s.unique_id
      and not exists(select 1 from public.ph_master_inventory own where own.unique_id=s.unique_id)
      and not exists(select 1 from pg_temp.ph_master_bulk_stage_v1 own where own.unique_id=p.canonical_unique_id)
  )
  select candidates.row_number,candidates.canonical_unique_id from candidates where matches=1;
end
$alias$;

create function private.drive_raw_source_proof_matches_v3046(p_uid text,p_raw jsonb,p_item6 text[])
returns boolean language sql stable set search_path='' as $proof$
  select exists (
    select 1 from app_sync_private.ph_master_inventory_source_baselines b where b.canonical_unique_id=p_uid
      and (not (p_raw?'priority') or nullif(p_raw->>'priority','') is not distinct from b.priority)
      and (not (p_raw?'holdstopcode') or nullif(p_raw->>'holdstopcode','') is not distinct from b.holdstopcode)
      and (not (p_raw?'holdstopreason') or nullif(p_raw->>'holdstopreason','') is not distinct from b.holdstopreason)
  ) and exists (
    select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b where b.canonical_unique_id=p_uid
      and not exists(select 1 from unnest(p_item6) f
        where p_raw?f and nullif(p_raw->>f,'') is distinct from nullif(b.field_values->>f,''))
  )
$proof$;

create function private.drive_master_delta_predicate_v3046(p_fields text[],p_app_owned text[])
returns text language sql immutable set search_path='' as $delta$
  select coalesce(string_agg(case when field=any(p_app_owned) then
    format('(not private.ph_master_bulk_has_value_v1(target.%1$I::text) and target.%1$I is distinct from s.%1$I)',field)
    else format('target.%1$I is distinct from s.%1$I',field) end,' or '),'false')
  from unnest(p_fields) field where field not in ('last_updated','filename','concat')
$delta$;
revoke all on function private.prior_drive_source_aliases_v3046(),
  private.drive_raw_source_proof_matches_v3046(text,jsonb,text[]),private.drive_master_delta_predicate_v3046(text[],text[])
  from public,anon,authenticated,service_role;

do $write_plan$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  map_at text := '  drop table if exists pg_temp.ph_master_bulk_map_v1;';
  unresolved text := '    where not exists(select 1 from public.ph_master_inventory m where m.unique_id=s.unique_id)';
  eligible text := '    except select unique_id from pg_temp.ph_master_bulk_stage_v1';
  map_select text := $map$  select s.row_number,s.unique_id as source_unique_id,m.unique_id as canonical_unique_id,
    case when m.unique_id is null then 0 else 1 end as candidate_count
  from pg_temp.ph_master_bulk_stage_v1 s left join public.ph_master_inventory m on m.unique_id=s.unique_id;$map$;
  direct_set text := '    direct_set_values := replace(set_values, ''excluded'', ''s'');';
  direct_key text := '         where mapped.canonical_unique_id = s.unique_id and target.unique_id = s.unique_id';
  direct_where text := '           ) or private.ph_master_bulk_pending_ack_v1(target.unique_id, s.raw_values))';
  alias_where text := '           ) or private.ph_master_bulk_pending_ack_v1(mapped.canonical_unique_id, s.raw_values))';
  alias_join text := '         select %s from pg_temp.ph_master_bulk_stage_v1 s'||chr(10)||
    '         join pg_temp.ph_master_bulk_map_v1 mapped using (row_number)';
begin
  if strpos(definition,map_at)=0 or strpos(definition,unresolved)=0 or strpos(definition,eligible)=0
    or strpos(definition,map_select)=0 or strpos(definition,direct_set)=0 or strpos(definition,direct_key)=0 or strpos(definition,direct_where)=0
    or strpos(definition,alias_where)=0 or strpos(definition,alias_join)=0 then
    raise exception 'ERP_DRIVE_DELTA_PLAN_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,map_at,$prior$  drop table if exists pg_temp.ph_master_bulk_prior_alias_v3046;
  create temp table ph_master_bulk_prior_alias_v3046 on commit drop as
    select * from private.prior_drive_source_aliases_v3046();
  create unique index on pg_temp.ph_master_bulk_prior_alias_v3046(row_number);
  create unique index on pg_temp.ph_master_bulk_prior_alias_v3046(canonical_unique_id);
$prior$||map_at);
  definition:=replace(definition,unresolved,unresolved||chr(10)||
    '      and not exists(select 1 from pg_temp.ph_master_bulk_prior_alias_v3046 p where p.row_number=s.row_number)');
  definition:=replace(definition,eligible,eligible||chr(10)||
    '    except select canonical_unique_id from pg_temp.ph_master_bulk_prior_alias_v3046');
  definition:=replace(definition,map_select,$map$  select s.row_number,s.unique_id as source_unique_id,
    coalesce(m.unique_id,p.canonical_unique_id) as canonical_unique_id,
    case when coalesce(m.unique_id,p.canonical_unique_id) is null then 0 else 1 end as candidate_count
  from pg_temp.ph_master_bulk_stage_v1 s
  left join public.ph_master_inventory m on m.unique_id=s.unique_id
  left join pg_temp.ph_master_bulk_prior_alias_v3046 p using(row_number);$map$);
  definition:=replace(definition,'  direct_set_values text;','  direct_set_values text; '||chr(10)||'  delta_predicate text;');
  definition:=replace(definition,direct_set,direct_set||$delta$
    delta_predicate := private.drive_master_delta_predicate_v3046(update_fields,app_owned)
      || ' or not private.drive_raw_source_proof_matches_v3046(target.unique_id,s.raw_values,s.raw_item6_fields)'
      || ' or target.assignedto is distinct from coalesce(private.ph_master_bulk_assignedto_override_v1(to_jsonb(s)),'
      || 'private.ph_master_bulk_assignedto_override_v1(to_jsonb(target)),target.assignedto)';$delta$);
  definition:=replace(definition,'           and (not exists (','           and ((not exists (');
  definition:=replace(definition,direct_key,$key$         left join pg_temp.ph_master_bulk_prior_alias_v3046 prior_alias using (row_number)
         where target.unique_id=mapped.canonical_unique_id
           and (mapped.canonical_unique_id=s.unique_id or prior_alias.canonical_unique_id=mapped.canonical_unique_id)$key$);
  definition:=replace(definition,direct_where,
    '           ) and (%s)) or private.ph_master_bulk_pending_ack_v1(target.unique_id, s.raw_values))');
  definition:=replace(definition,'      direct_set_values'||chr(10),'      direct_set_values, delta_predicate'||chr(10));
  definition:=replace(definition,alias_join,alias_join||chr(10)||
    '         left join public.ph_master_inventory existing on existing.unique_id=mapped.canonical_unique_id');
  definition:=replace(definition,'           and (mapped.canonical_unique_id is null or not exists(',
    $key$           and (existing.unique_id is null or not exists (
             select 1 from pg_temp.ph_master_bulk_prior_alias_v3046 prior_alias
             where prior_alias.row_number=s.row_number and prior_alias.canonical_unique_id=mapped.canonical_unique_id
           ))
           and (mapped.canonical_unique_id is null or existing.unique_id is null or (not exists($key$);
  definition:=replace(definition,alias_where,
    '           ) and (%s)) or private.ph_master_bulk_pending_ack_v1(mapped.canonical_unique_id, s.raw_values))');
  execute replace(definition,'      column_names, alias_select_values, set_values, changed_predicate',
    '      column_names, alias_select_values, replace(replace(delta_predicate,''target.'',''existing.''),''to_jsonb(target)'',''to_jsonb(existing)''), set_values, changed_predicate');
end
$write_plan$;

-- Only ph_master_inventory currently uses this evidence function. Its bulk
-- guard already returns the record unchanged, so evaluate it before the
-- editor-only guard and use the physical UID directly.
do $guard$
declare
  definition text := pg_get_functiondef('private.apply_inventory_location_evidence_v1()'::regprocedure);
  edit_at integer := strpos(definition,'  IF current_setting(''app.eval_publication_v309'',true)');
  bulk_at integer := strpos(definition,'  if tg_table_schema=''public'' and tg_table_name in');
  bulk_end integer := strpos(definition,'  if nullif(btrim(coalesce(new.itemcode');
begin
  if edit_at=0 or bulk_at<=edit_at or bulk_end<=bulk_at then raise exception 'ERP_EVIDENCE_BULK_FAST_GUARD_ANCHOR_MISSING'; end if;
  execute overlay(definition placing substring(definition from bulk_at for bulk_end-bulk_at)
    || replace(substring(definition from edit_at for bulk_at-edit_at),
      'coalesce(to_jsonb(new)->>''source_unique_id'',to_jsonb(new)->>''unique_id'')','new.unique_id')
    from edit_at for bulk_end-edit_at);
end
$guard$;
commit;
