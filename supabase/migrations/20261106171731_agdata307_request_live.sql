BEGIN;
-- v3.0.7: creation capability applies to every selected Sales Rep; reads retain their own scope.
UPDATE public.user_access SET can_make_request='Y',request_all_reps='Y' WHERE make_request='Y';
CREATE OR REPLACE FUNCTION private.can_create_general_requests() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.user_access a WHERE a.profile_id=(private.current_active_profile()).id AND a.make_request='Y' AND a.can_make_request='Y')
$fn$;
CREATE OR REPLACE FUNCTION private.can_create_av_requests() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT private.can_create_general_requests()
$fn$;
CREATE OR REPLACE FUNCTION sales_private.request_mapping_rep_allowed_v1(p_actor_id uuid,p_salesrep_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.user_access a ON a.profile_id=p.id WHERE p.id=p_actor_id AND p.disabled_at IS NULL AND NOT coalesce(p.must_change_password,false) AND (p.locked_until IS NULL OR p.locked_until<=clock_timestamp()) AND a.make_request='Y' AND a.can_make_request='Y')
$fn$;
DO $patch$
DECLARE source text;
BEGIN
 source:=pg_get_functiondef('private.assert_request_matrix_v23119(jsonb)'::regprocedure);
 IF position('permission:=''Y''; -- make_request grants every rep' in source)=0 THEN
  source:=regexp_replace(source,'permission:=coalesce\(matrix.sales_rep_access.*?;', 'permission:=''Y''; -- make_request grants every rep');
  IF position('permission:=''Y''; -- make_request grants every rep' in source)=0 THEN RAISE EXCEPTION 'REQUEST_MATRIX_ANCHOR_MISSING'; END IF;
  EXECUTE source;
 END IF;
 source:=pg_get_functiondef('sales_private.require_active_customer_mapping_for_request_v1()'::regprocedure);
 IF position('v3.0.7 quantity and N/A' in source)=0 THEN
  source:=replace(source,E'begin\n',$before$begin
  -- v3.0.7 quantity and N/A validation; existing mapped tuples keep their guards.
  IF tg_op='INSERT' AND lower(btrim(coalesce(new.request_source,''))) IN ('general','av') THEN
   IF (CASE WHEN replace(coalesce(new.req_qty,''),',','') ~ '^[0-9]+([.][0-9]+)?$' THEN replace(new.req_qty,',','')::numeric ELSE 0 END) <= 0 THEN RAISE EXCEPTION 'REQUEST_QUANTITY_REQUIRED' USING ERRCODE='22023'; END IF;
   new.desired_spec:=coalesce(nullif(btrim(new.desired_spec),''),nullif(nullif(btrim(new.spec),''),'-'),'N/A');
  END IF;
  IF upper(btrim(coalesce(new.customername,'')))='N/A' AND upper(btrim(coalesce(new.consigneename,'')))='N/A' THEN new.customeridentityid:='N/A'; new.consigneeidentityid:='N/A'; END IF;
$before$);
  IF position('  if selected_id=''AGDATA_EXECUTIVE_ALL'' then' in source)=0 THEN RAISE EXCEPTION 'REQUEST_NA_ANCHOR_MISSING'; END IF;
  source:=replace(source,'  if selected_id=''AGDATA_EXECUTIVE_ALL'' then',$na$  if upper(btrim(new.customername))='N/A' and upper(btrim(new.consigneename))='N/A' then
    if actor.id is null or not sales_private.request_mapping_rep_allowed_v1(actor.id,selected_id) then raise exception 'MAKE_REQUEST_DISABLED' using errcode='42501'; end if;
    select c.* into owner_row from sales_private.customer_rep_catalog_v23102() c
      where c.salesrepid=selected_id and (nullif(btrim(requested_identity),'') is null or sales_private.rep_identity_key_v2394(requested_identity) in (c.salesrep_canonical_key,sales_private.rep_identity_key_v2394(c.salesrepname),sales_private.rep_identity_key_v2394(c.salesrep_username),sales_private.rep_identity_key_v2394(c.salesrepid))) limit 1;
    if owner_row.salesrepid is null then raise exception 'REQUEST_CUSTOMER_MAPPING_REQUIRED' using errcode='22023'; end if;
    selected_id:=owner_row.salesrepid; canonical_name:=owner_row.salesrepname; canonical_username:=owner_row.salesrep_username;
    select lower(btrim(u.email)) into canonical_email from auth.users u where u.id=owner_row.salesrep_profile_id and u.email_confirmed_at is not null;
  elsif selected_id='AGDATA_EXECUTIVE_ALL' then$na$);
  EXECUTE source;
 END IF;
 -- ph_active_request is a security-invoker view: mirror the canonical table revision.
 INSERT INTO app_sync_private.sources(key,modules,dylan_only,client_enabled) SELECT 'ph_active_request',modules,dylan_only,client_enabled FROM app_sync_private.sources WHERE key='ph_requests_pending' ON CONFLICT(key) DO NOTHING;
 INSERT INTO public.app_dataset_revisions(key,revision,state,changed_at) SELECT 'ph_active_request',revision,state,changed_at FROM public.app_dataset_revisions WHERE key='ph_requests_pending' ON CONFLICT(key) DO UPDATE SET revision=excluded.revision,state=excluded.state,changed_at=excluded.changed_at;
 source:=pg_get_functiondef('app_sync_private.touch_source()'::regprocedure);
 IF position('-- v3.0.7 request view revision' in source)=0 THEN
  IF position('  if reclass_context_proven then' in source)=0 THEN RAISE EXCEPTION 'REVISION_ANCHOR_MISSING'; END IF;
  source:=replace(source,'  if reclass_context_proven then',$revision$  -- v3.0.7 request view revision
  if source_key='ph_requests_pending' then
    update public.app_dataset_revisions v set revision=r.revision,state=r.state,changed_at=r.changed_at from public.app_dataset_revisions r where v.key='ph_active_request' and r.key='ph_requests_pending';
  end if;
  if reclass_context_proven then$revision$);
  EXECUTE source;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='ph_requests_pending') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.ph_requests_pending; END IF;
 IF NOT EXISTS(SELECT FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='app_dataset_revisions') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_dataset_revisions; END IF;
END $patch$;
COMMIT;
