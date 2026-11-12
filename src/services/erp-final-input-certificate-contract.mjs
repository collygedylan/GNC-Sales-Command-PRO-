export const erpFinalInputCertificateMigration = '20261112050000_agdata3078_certified_drive_final_input.sql';

export function certifiedInputProofPredicate() {
  return `exists(select 1 from pg_proc v join pg_trigger t on t.tgfoid=v.oid
    where v.oid=to_regprocedure('private.verify_drive_certificate_transition_v3078()')
      and t.tgrelid=to_regclass('private.erp_drive_final_certificates_v3078') and t.tgenabled='A'
      and strpos(v.prosrc,'perform private.assert_drive_typed_checkpoint_v3077(new.stage_id)')>0
      and strpos(v.prosrc,'private.drive_checkpoint_signature_v3078(new.stage_id)')>0
      and strpos(v.prosrc,'count(*),min(row_number),max(row_number)')>0)`;
}

export function erpFinalInputCertificateContract() {
  return `select ${certifiedInputProofPredicate()}
    and exists(select 1 from pg_class c where c.oid=to_regclass('private.erp_drive_final_certificates_v3078')
      and c.relpersistence='u' and c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT')
      and not has_table_privilege('authenticated',c.oid,'SELECT') and not has_table_privilege('service_role',c.oid,'UPDATE'))
    and (select count(*)=22 and bool_and(tgenabled='A') from pg_trigger
      where tgfoid=to_regprocedure('private.observe_drive_input_changes_v3078()'))
    and (select count(*)=6 and bool_and(tgenabled='A') from pg_trigger where tgfoid=to_regprocedure('private.mark_drive_work_dirty_v3078()'))
    and (select count(*)=2 and bool_and(tgoldtable='old_input' and tgnewtable='changed') from pg_trigger
      where tgname='mark_dirty_update' and tgfoid=to_regprocedure('private.mark_drive_work_dirty_v3078()'))
    and exists(select 1 from pg_proc where oid=to_regprocedure('private.advance_drive_input_epoch_v3078(uuid[])')
      and strpos(prosrc,'order by stage_id for update nowait')>0 and strpos(prosrc,'set drive_input_epoch_v3078=gen_random_uuid()')>0)
    and exists(select 1 from pg_proc where oid=to_regprocedure('private.lock_drive_final_input_v3078(uuid)')
      and strpos(prosrc,'private.fast_erp_stage_runs_v1 where stage_id=p_stage for update nowait')>0)
    and exists(select 1 from pg_proc where oid=to_regprocedure('private.prepare_drive_work_v3078(uuid)')
      and strpos(prosrc,'return private.certify_drive_final_input_v3078(p_stage)')>0)
    and exists(select 1 from pg_proc where oid=to_regprocedure('private.load_drive_work_v3078(uuid)')
      and strpos(prosrc,'private.match_drive_final_certificate_v3078(private.lock_drive_final_input_v3078(p_stage))')>0
      and strpos(prosrc,'assert_drive_typed_checkpoint_v3077')=0 and strpos(prosrc,'count(*)')=0)
    and (select count(*)=3 and bool_and(not prosecdef and not has_function_privilege('service_role',oid,'EXECUTE')
      and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE'))
      from pg_proc where oid in(to_regprocedure('private.certify_drive_final_input_v3078(uuid)'),
        to_regprocedure('private.lock_drive_final_input_v3078(uuid)'),
        to_regprocedure('private.match_drive_final_certificate_v3078(private.fast_erp_stage_runs_v1)'))) as installed`;
}
