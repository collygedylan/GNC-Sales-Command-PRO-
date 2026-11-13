export const requestPhotoIntentMigration = '20261113060000_request_photo_completion_intents.sql';

export const requestPhotoIntentMigrationContract = `select
  exists(select 1 from pg_class where oid=to_regclass('private.request_photo_intents_v3079') and relrowsecurity)
  and not has_table_privilege('authenticated','private.request_photo_intents_v3079','insert')
  and not has_function_privilege('anon','public.append_request_photo_intent_v3079(text,text,text,text)','execute')
  and has_function_privilege('authenticated','public.append_request_photo_intent_v3079(text,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.complete_request_with_photo_intents_v3079(uuid,uuid,text,bigint,jsonb,text[])','execute')
  and not has_function_privilege('authenticated','public.authorize_request_photo_intent_v3079(uuid,text,uuid,jsonb,text,text)','execute')
  and has_function_privilege('service_role','public.authorize_request_photo_intent_v3079(uuid,text,uuid,jsonb,text,text)','execute')
  and position('complete_request_with_photo_intents_v3079' in pg_get_functiondef(
    'public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)'::regprocedure))>0
  and exists(select 1 from pg_trigger where tgrelid='public.ph_request_delivery_outbox'::regclass
    and tgname='defer_request_photo_delivery_v3079' and tgenabled='O') as installed`;
