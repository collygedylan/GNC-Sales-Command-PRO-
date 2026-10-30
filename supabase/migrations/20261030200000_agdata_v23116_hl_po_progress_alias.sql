begin;
do $fix$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('public.get_my_erp_sync_progress_v23116()'::regprocedure);
  if position('(''hl_po'',''ph_hl_po_parsed'')' in definition)>0 then
    execute replace(definition,'(''hl_po'',''ph_hl_po_parsed'')','(''hl_po'',''hl_po_parsed'')');
  elsif position('(''hl_po'',''hl_po_parsed'')' in definition)=0 then
    raise exception 'ERP_SYNC_PROGRESS_SOURCE_CONTRACT_MISMATCH';
  end if;
end;
$fix$;
commit;
