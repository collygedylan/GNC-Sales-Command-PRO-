set local lock_timeout='15s';
do $patch$
declare definition text; changed text;
begin
 select pg_get_functiondef('private.operational_erp_status_v23120(jsonb,timestamptz,timestamptz)'::regprocedure) into definition;
 changed:=replace(definition,
  '(array[''drive'',''cav'',''reserves'',''soc'',''hl_po_parsed'']||case when p_status->''sourceProgress'' ? ''prod_schedule'' then array[''prod_schedule''] else array[]::text[] end)',
  'array[''drive'',''cav'',''reserves'',''soc'',''hl_po_parsed'']');
 changed:=replace(changed,'(case when p_status->''sourceProgress'' ? ''prod_schedule'' then 6 else 5 end)','5');
 if changed=definition then raise exception 'ERP_FIVE_SOURCE_PATCH_ANCHOR_MISSING'; end if;
 execute changed;
 select pg_get_functiondef('public.check_erp_file_sync_needed_v1(text,text,text,text,text)'::regprocedure) into definition;
 changed:=replace(definition,
 'if current_revision.key is not null and current_revision.source_file_name=btrim(p_file_name) then',
 'if current_revision.key is not null and current_revision.source_file_name=btrim(p_file_name) then
    execute format(''select exists(select 1 from public.%I where filename=$1)'',revision_key) into up_to_date using btrim(p_file_name);
    if not up_to_date then return jsonb_build_object(''skip'',false,''up_to_date'',false,''file_name'',btrim(p_file_name),''dataset_key'',revision_key); end if;');
 if changed=definition then raise exception 'ERP_ROW_PROOF_PATCH_ANCHOR_MISSING'; end if;
 execute changed;
end $patch$;
