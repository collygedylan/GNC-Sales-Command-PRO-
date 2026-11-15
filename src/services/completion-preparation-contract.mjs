export const completionPreparationMigration='20261115211803_canonical_completion_preparation.sql';
export function completionPreparationContract() {
    return `select position('from private.request_folder_members_v3065(event_row.request_folder)' in
      pg_get_functiondef('public.prepare_request_folder_completion_v2(uuid,uuid)'::regprocedure))>0
      and position('array_to_string(current_ids, chr(10))' in
        pg_get_functiondef('public.prepare_request_folder_completion_v2(uuid,uuid)'::regprocedure))>0
      and not has_function_privilege('authenticated','public.prepare_request_folder_completion_v2(uuid,uuid)','execute')
      and not has_function_privilege('anon','public.prepare_request_folder_completion_v2(uuid,uuid)','execute')
      and has_function_privilege('service_role','public.prepare_request_folder_completion_v2(uuid,uuid)','execute')
      as installed`;
}
