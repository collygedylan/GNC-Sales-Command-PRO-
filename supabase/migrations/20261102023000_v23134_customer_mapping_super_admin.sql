BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
-- Keep existing active-profile, revision, idempotency and service-role boundaries.
DO $patch$
DECLARE target regprocedure; definition text; previous_guard text := $old$coalesce(upper(btrim(actor.role)),'') not in ('ADMIN','ADMINISTRATOR','MANAGER')$old$; next_guard text := $new$regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in ('ADMIN','ADMINISTRATOR','MANAGER','SUPERADMIN')$new$;
BEGIN
 FOREACH target IN ARRAY ARRAY['public.customer_rep_mapping_manage_v23102_base(uuid,text,jsonb)'::regprocedure,'public.customer_rep_mapping_manage_v2397_base(uuid,text,jsonb)'::regprocedure] LOOP
  SELECT pg_get_functiondef(target) INTO definition;
  IF position(previous_guard in definition)>0 THEN EXECUTE replace(definition,previous_guard,next_guard);
  ELSIF position(next_guard in definition)=0 THEN RAISE EXCEPTION 'CUSTOMER_MAPPING_ROLE_GUARD_NOT_FOUND'; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.customer_rep_mapping_manage_v1(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'CUSTOMER_MAPPING_SERVICE_BOUNDARY_CHANGED'; END IF;
END $patch$;
COMMIT;
