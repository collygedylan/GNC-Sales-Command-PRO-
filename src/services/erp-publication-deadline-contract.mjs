export const erpDrivePublicationDeadlineMigration = '20261112023500_agdata3078_drive_publication_deadline.sql';

export function erpDrivePublicationDeadlineContract() {
  return `select exists(select 1 from pg_proc p
    where p.oid=to_regprocedure('private.schedule_erp_stage_publication_v3057(uuid)')
      and (position('when stage.dataset_key=''drive_around'' then ''8s'' else ''120s'' end' in p.prosrc)>0
        or (position('when stage.dataset_key=''drive_around'' then ''240s'' else ''120s'' end' in p.prosrc)>0
          and to_regprocedure('private.seal_drive_preparation_v3078(uuid)') is not null))
      and position('when stage.dataset_key=''drive_around'' then ''750ms'' else ''15s'' end' in p.prosrc)>0
      and position('set local statement_timeout = %L; set local lock_timeout = %L; select private.run_erp_stage_publication_v3042(%L::uuid); commit' in p.prosrc)>0
      and position('where stage.stage_id=p_stage_id' in p.prosrc)>0 and not p.prosecdef
      and not has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')) as installed`;
}

export const erpDriveDeadlineContracts = [[erpDrivePublicationDeadlineMigration, erpDrivePublicationDeadlineContract]];
