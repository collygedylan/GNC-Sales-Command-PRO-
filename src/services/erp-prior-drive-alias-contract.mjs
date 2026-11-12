export const erpPriorDriveAliasMigration = '20261112053500_agdata3078_index_prior_drive_aliases.sql';

export function erpPriorDriveAliasContract() {
  return `select exists(select 1 from pg_index i
      where i.indexrelid=to_regclass('app_sync_private.ph_master_bulk_prior_alias_v3078_idx')
        and i.indrelid=to_regclass('app_sync_private.ph_master_bulk_import_source_v1')
        and i.indisvalid and i.indisready and not i.indisunique and i.indnkeyatts=2
        and pg_get_indexdef(i.indexrelid,1,true)='source_unique_id'
        and pg_get_indexdef(i.indexrelid,2,true)='canonical_unique_id'
        and pg_get_expr(i.indpred,i.indrelid)='(source_unique_id <> canonical_unique_id)')
    and exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prior_drive_source_aliases_v3046()')
      and not p.prosecdef and p.provolatile='s' and 'enable_nestloop=on'=any(p.proconfig)
      and strpos(p.prosrc,'order by p.source_unique_id,p.canonical_unique_id limit 65')>0
      and strpos(p.prosrc,'if sampled=0 then return; end if;')>0
      and strpos(p.prosrc,'set_config(''enable_nestloop'',''off'',true)')>0
      and strpos(p.prosrc,'candidates where matches=1')>0
      and strpos(p.prosrc,'b.lineage_key=s.lineage_key')>0
      and strpos(p.prosrc,'not exists(select 1 from live_ids own where own.unique_id=a.source_unique_id)')>0
      and strpos(p.prosrc,'not exists(select 1 from stage_keys own where own.unique_id=a.canonical_unique_id)')>0
      and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('service_role',p.oid,'EXECUTE')) as installed`;
}
