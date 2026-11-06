do $patch$
declare definition text; changed text;
begin
  select pg_get_functiondef('public.check_erp_file_sync_needed_v1(text,text,text,text,text)'::regprocedure) into definition;
  changed:=replace(definition,'  if revision_key is null or', '  if p_dataset_key=''hl_po_parsed'' then
    select exists(select 1 from hl_order_private.po_imports
      where metadata->>''source_file_name''=btrim(p_file_name) and completed_at is not null
        and row_count>0 and status in (''pending'',''reconciled'',''duplicate'')) into up_to_date;
    return jsonb_build_object(''up_to_date'',up_to_date,''skip'',up_to_date,''file_name'',btrim(p_file_name),''dataset_key'',''hl_po_parsed'');
  end if;
  if revision_key is null or');
  if changed=definition then raise exception 'ERP_HL_SKIP_PATCH_ANCHOR_MISSING'; end if;
  execute changed;
end $patch$;