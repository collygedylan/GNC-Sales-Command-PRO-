export const requestEvidenceMigrationName = '20261111021002_request_folder_completion_and_exact_photos.sql';
export const consolidatedRequestPayloadMigrationName = '20261111025523_request_completion_consolidated_payload.sql';

export const requestEvidenceMigrationContracts = Object.freeze({
  [requestEvidenceMigrationName]: `select
    to_regprocedure('public.request_completion_dispatch_rows_v3065(uuid)') is not null
    and not has_function_privilege('authenticated','public.request_completion_dispatch_rows_v3065(uuid)','execute')
    and not has_function_privilege('anon','public.request_completion_dispatch_rows_v3065(uuid)','execute')
    and has_function_privilege('service_role','public.request_completion_dispatch_rows_v3065(uuid)','execute')
    and position('queue_request_folder_v3065' in pg_get_functiondef('private.reconcile_request_folder_completion_v2(text)'::regprocedure))>0
    and position('reconcile_request_folder_completion_v2' in pg_get_functiondef('private.enqueue_completed_request_email_v316(text,jsonb)'::regprocedure))>0
    and position('OR NOT EXISTS(SELECT 1 FROM candidates' in pg_get_functiondef('private.collect_item_detail_photo_links_v308(text,text,text,jsonb)'::regprocedure))=0
    as installed`,
  [consolidatedRequestPayloadMigrationName]: `select
    position($payload$'requests', (select coalesce(jsonb_agg(to_jsonb(h) order by h.unique_id)$payload$
      in pg_get_functiondef('private.queue_request_folder_v3065(text,text[],private.ph_request_folder_delivery_state)'::regprocedure))>0
    and position($count$'itemsCount', cardinality(request_ids)$count$
      in pg_get_functiondef('private.queue_request_folder_v3065(text,text[],private.ph_request_folder_delivery_state)'::regprocedure))>0
    as installed`
});
