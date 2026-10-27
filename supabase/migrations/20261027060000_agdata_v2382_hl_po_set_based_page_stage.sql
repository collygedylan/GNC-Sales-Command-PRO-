begin;
set local lock_timeout='1500ms';
set local statement_timeout='10s';

-- HL PDF rows are immutable page batches. Validate the complete page first,
-- then stage the rows with one INSERT while keeping final publication atomic.
create or replace function public.hl_po_pdf_stage(
  p_run_id text,p_metadata jsonb,p_page integer,p_rows jsonb,p_complete boolean default false
) returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='30s' set lock_timeout='2s' as $function$
declare imp hl_order_private.po_imports; duplicate_id uuid; pages integer; row_total integer;
begin
  if length(coalesce(p_run_id,'')) not between 1 and 200
     or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>1000
     or octet_length(p_rows::text)>4000000 or coalesce(p_metadata->>'fingerprint','') !~ '^[a-f0-9]{64}$'
     or nullif(p_metadata->>'source_file_id','') is null or nullif(p_metadata->>'parser_version','') is null
     or nullif(p_metadata->>'report_printed_at','') is null or p_complete is null then
    raise exception 'HL_PO_INVALID_PDF';
  end if;
  pages:=(p_metadata->>'page_count')::integer;
  if pages not between 1 and 1000 or (p_page is not null and p_page not between 1 and pages) then
    raise exception 'HL_PO_INVALID_PDF';
  end if;
  perform 1 from hl_order_private.state where singleton for update;
  insert into hl_order_private.po_imports(run_id,source_format,metadata)
    values(p_run_id,'pdf',p_metadata) on conflict(run_id) do nothing;
  select * into imp from hl_order_private.po_imports where run_id=p_run_id for update;
  if imp.source_format<>'pdf' or imp.metadata<>p_metadata then raise exception 'HL_PO_IMPORT_IMMUTABLE'; end if;
  if p_page is not null then
    if exists(select 1 from hl_order_private.po_pdf_pages where import_id=imp.id and page=p_page and rows<>p_rows) then
      raise exception 'HL_PO_IMPORT_IMMUTABLE';
    end if;
    if not exists(select 1 from hl_order_private.po_pdf_pages where import_id=imp.id and page=p_page) then
      if imp.status<>'staging' then raise exception 'HL_PO_IMPORT_IMMUTABLE'; end if;
      if exists(select 1 from jsonb_array_elements(p_rows) r(value)
        where nullif(btrim(r.value->>'item_code'),'') is null
          or nullif(btrim(r.value->>'size'),'') is null
          or nullif(btrim(r.value->>'lot'),'') is null
          or nullif(r.value->>'po_number','') is null
          or nullif(r.value->>'vendor','') is null
          or jsonb_typeof(r.value->'po_remain') is distinct from 'number'
          or (r.value->>'po_remain')::numeric::text in ('NaN','Infinity','-Infinity')) then
        raise exception 'HL_PO_INVALID_PDF_LINE';
      end if;
      insert into hl_order_private.po_import_rows(import_id,source_file_id,row_index,source)
      select imp.id,p_metadata->>'source_file_id',p_page*10000+r.ordinality::integer,
        r.value||jsonb_build_object('source_file_id',p_metadata->>'source_file_id',
          'source_file_name',p_metadata->>'source_file_name','report_date',p_metadata->>'report_date',
          'page',p_page,'line_index',r.ordinality)
      from jsonb_array_elements(p_rows) with ordinality r(value,ordinality);
      insert into hl_order_private.po_pdf_pages(import_id,page,rows) values(imp.id,p_page,p_rows);
    end if;
  end if;
  if p_complete and imp.status='staging' then
    if (select count(*) from hl_order_private.po_pdf_pages where import_id=imp.id)<>pages then raise exception 'HL_PO_PDF_INCOMPLETE'; end if;
    select count(*) into row_total from hl_order_private.po_import_rows where import_id=imp.id;
    if row_total=0 then raise exception 'HL_PO_EMPTY_IMPORT'; end if;
    select id into duplicate_id from hl_order_private.po_imports
      where fingerprint=p_metadata->>'fingerprint' and status in ('pending','reconciled');
    update hl_order_private.po_imports set status=case when duplicate_id is null then 'pending' else 'duplicate' end,
      duplicate_of=duplicate_id,fingerprint=p_metadata->>'fingerprint',row_count=row_total,
      completed_at=clock_timestamp(),report_date=(p_metadata->>'report_date')::date where id=imp.id returning * into imp;
    update hl_order_private.state set revision=revision+1 where singleton;
  end if;
  return jsonb_build_object('id',imp.id,'status',imp.status,'row_count',imp.row_count,
    'duplicate_of',imp.duplicate_of,'awaitingReconciliation',imp.status='pending',
    'completed_pages',coalesce((select jsonb_agg(page order by page) from hl_order_private.po_pdf_pages where import_id=imp.id),'[]'));
end
$function$;

comment on function public.hl_po_pdf_stage(text,jsonb,integer,jsonb,boolean) is
  'v2.3.82: atomically stage a validated <=1000-row PDF page with one set-based insert; final completion remains pending/duplicate publication.';
commit;
