begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

-- Resolve incoming synthetic Drive UIDs against any unique existing Item6
-- identity, and write mapped aliases to the canonical master row. Keep the
-- source UID in import context/alias provenance; only the physical row key is
-- canonicalized.
do $patch_master_identity_alias$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  anchor text;
  replacement text;
begin
  if position('master-identity-alias-repair-v2397' in definition) > 0 then return; end if;

  anchor := $anchor$and exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 edit
        where edit.canonical_unique_id = item6.canonical_unique_id and edit.pending
          and edit.field_name in ('desigitem','desigcust','desigloc'))$anchor$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
    raise exception 'V2397_MASTER_STABLE_IDENTITY_ANCHOR_MISMATCH';
  end if;
  replacement := E'and (\n'
    ||'        exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 edit'
    ||E'\n        where edit.canonical_unique_id = item6.canonical_unique_id and edit.pending'
    ||E'\n          and edit.field_name in (''desigitem'',''desigcust'',''desigloc''))'
    ||E'\n        or private.ph_master_inventory_lineage_key_v1(to_jsonb(m)) = s.lineage_key'
    ||E'\n      ) /* master-identity-alias-repair-v2397: stable matches require full lineage unless designation edit is pending. */';
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$  select_values text;$anchor$;
  replacement := anchor || E'\n  alias_select_values text;';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
    raise exception 'V2397_MASTER_ALIAS_SELECT_DECLARATION_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$    sql_text := format(
      'with affected as (
         insert into public.ph_master_inventory as target (%s)$anchor$;
  replacement := E'    alias_select_values := replace(select_values, ''s.unique_id'', ''coalesce(mapped.canonical_unique_id,s.unique_id)'');\n'
    || anchor;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
    raise exception 'V2397_MASTER_ALIAS_INSERT_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := '      column_names, select_values, set_values, changed_predicate';
  replacement := '      column_names, alias_select_values, set_values, changed_predicate';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 then
    raise exception 'V2397_MASTER_ALIAS_SELECT_VALUE_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition,anchor,replacement);

  if position('coalesce(mapped.canonical_unique_id,s.unique_id)' in definition)=0
    or position('master-identity-alias-repair-v2397' in definition)=0
    or position('private.ph_master_inventory_lineage_key_v1(to_jsonb(m)) = s.lineage_key' in definition)=0 then
    raise exception 'V2397_MASTER_IDENTITY_ALIAS_PATCH_INCOMPLETE';
  end if;
  execute definition;
end
$patch_master_identity_alias$;

do $installed$
declare definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
begin
  if position('master-identity-alias-repair-v2397' in definition)=0
    or position('coalesce(mapped.canonical_unique_id,s.unique_id)' in definition)=0
    or position('private.ph_master_inventory_lineage_key_v1(to_jsonb(m)) = s.lineage_key' in definition)=0 then
    raise exception 'V2397_MASTER_IDENTITY_ALIAS_CONTRACT_INVALID';
  end if;
end
$installed$;

commit;
