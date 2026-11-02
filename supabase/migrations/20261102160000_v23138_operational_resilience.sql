begin;
-- v2.3.138: preserve worker-only writes, exact identities and pending lifecycle.
set local lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.fast_begin_erp_stage_v1(p_dataset_key text, p_file_meta jsonb, p_expected_rows integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '120s'
 SET lock_timeout TO '250ms'
AS $function$
declare v_dataset text:=lower(btrim(coalesce(p_dataset_key,'')));
  meta jsonb; fingerprint text; check_result jsonb; stage private.fast_erp_stage_runs_v1%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='FAST_ERP_STAGE_FORBIDDEN'; end if;
  if v_dataset not in ('drive_around','soc','reserves','cav') or p_expected_rows is null
     or p_expected_rows<1 or p_expected_rows>100000 then
    raise exception using errcode='22023',message='FAST_ERP_STAGE_INPUT_INVALID';
  end if;
  meta:=private.fast_erp_file_meta_v2369(p_file_meta);
       if p_file_meta->>'expected_rows_pending' = 'true' then
         if p_expected_rows<>(case when p_dataset_key='soc' then 100000 else 50000 end) then raise exception 'FAST_ERP_STAGE_CAPACITY_INVALID'; end if;
         meta:=meta||jsonb_build_object('expected_rows_pending',true);
       end if;
  fingerprint:=encode(extensions.digest(convert_to(v_dataset||'|'||(meta->>'file_id')||'|'||(meta->>'file_name')||'|'||(meta->>'modified_at')||'|'||coalesce(meta->>'content_hash','')||'|'||p_expected_rows::text,'UTF8'),'sha256'),'hex');
  check_result:=public.check_erp_file_sync_needed_v1(v_dataset,meta->>'file_id',meta->>'file_name',meta->>'modified_at',meta->>'content_hash');
  if coalesce((check_result->>'skip')::boolean,false) then
    return check_result||jsonb_build_object('ok',true,'skipped',true,'status','UP_TO_DATE');
  end if;
  -- Retention is maintenance work: never cascade old stage rows during a new import.
  perform pg_advisory_xact_lock(hashtextextended('fast-erp-stage:'||fingerprint,0));
  select * into stage from private.fast_erp_stage_runs_v1 r
    where r.dataset_key=v_dataset and r.source_fingerprint=fingerprint for update;
  if stage.stage_id is null then
    insert into private.fast_erp_stage_runs_v1(dataset_key,file_meta,source_fingerprint,expected_rows)
      values(v_dataset,meta,fingerprint,p_expected_rows) returning * into stage;
  elsif (stage.expected_rows<>p_expected_rows and coalesce(meta->>'expected_rows_pending','false')<>'true') or stage.file_meta is distinct from meta then
    raise exception using errcode='22023',message='FAST_ERP_STAGE_SOURCE_CONFLICT';
  end if;
  if stage.expires_at <= clock_timestamp() and stage.stage_state = 'staging' then
    update private.fast_erp_stage_runs_v1 set expires_at=clock_timestamp()+interval '24 hours' where stage_id=stage.stage_id;
  end if;
  return jsonb_build_object('ok',true,'skipped',false,'stage_id',stage.stage_id,
    'dataset_key',v_dataset,'expected_rows',stage.expected_rows,'staged_rows',stage.staged_rows,'status',stage.stage_state);
end
$function$;

CREATE OR REPLACE FUNCTION public.get_request_capabilities()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  profile public.profiles%rowtype;
  username_key text;
  role_key text;
  global_access boolean;
  save_access boolean;
  general_create_access boolean;
  av_create_access boolean;
  request_scope text;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'REQUEST_PROFILE_REQUIRED';
  end if;

  username_key := lower(btrim(coalesce(profile.username, '')));
  if username_key in ('nally_aguilar','nelly_aguliar') then username_key := 'nelly_aguilar'; end if;
  role_key := private.normalized_profile_role(profile.role);
  global_access := private.can_manage_requests();
  save_access := private.can_save_request_work();
  general_create_access := private.can_create_general_requests();
  av_create_access := private.can_create_av_requests();

  request_scope := case
    when global_access or role_key in ('SUPERADMIN','SUPER_ADMIN','SUPER-ADMIN','MANAGER','EVAL','CSR','OFFICE','SALESOFFICE','SALES OFFICE')
      or username_key in ('nelly_aguilar','morgan_anderson','megan_kelly','jd_jones','kayla_knapp','kayla_knepp','mitch_kaiser','melissa_dowty') then 'global'
    when username_key in ('ben_brown', 'chance_alldredge') then 'own'
    when private.is_sales_request_role() then 'rep'
    when role_key = 'CSR' then 'created'
    when role_key like 'EVAL%' then 'eval'
    else 'role'
  end;

  return jsonb_build_object(
    'contract_version', 2,
    'username', username_key,
    'scope', request_scope,
    'can_create_general', general_create_access,
    'can_create_av', av_create_access,
    'can_view_queue', true,
    'can_take_photo', save_access,
    'can_edit', save_access,
    'can_complete', save_access,
    'can_archive', global_access
  );
end;
$function$;

update public.user_access set make_request='Y',can_make_request='Y',request_all_reps='Y',edit_any_row='Y',can_edit_all_rows='Y',flyer_folder_access='Y',can_manage_flyers='Y',view_permissions=view_permissions||'{"view_que_request":"Y","view_que_suspend":"Y"}'::jsonb,revision=revision+1,updated_at=clock_timestamp() where username='nelly_aguilar' and (make_request,can_make_request,request_all_reps,edit_any_row,can_edit_all_rows,flyer_folder_access,can_manage_flyers) is distinct from ('Y','Y','Y','Y','Y','Y','Y');
notify pgrst,'reload schema';
commit;
