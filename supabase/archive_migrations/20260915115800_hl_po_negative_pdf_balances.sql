-- Preserve negative printed balances as source evidence; review them before restocking.
begin;
create or replace function public.hl_po_pdf_stage(p_run_id text,p_metadata jsonb,p_page integer,p_rows jsonb,p_complete boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare imp hl_order_private.po_imports; r jsonb; idx integer; duplicate_id uuid; pages integer; n integer;
begin
 if length(coalesce(p_run_id,'')) not between 1 and 200 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>1000
 or octet_length(p_rows::text)>4000000 or coalesce(p_metadata->>'fingerprint','') !~ '^[a-f0-9]{64}$'
 or nullif(p_metadata->>'source_file_id','') is null or nullif(p_metadata->>'parser_version','') is null
 or nullif(p_metadata->>'report_printed_at','') is null or p_complete is null then raise exception 'HL_PO_INVALID_PDF'; end if;
 pages:=(p_metadata->>'page_count')::integer;
 if pages not between 1 and 1000 or (p_page is not null and p_page not between 1 and pages) then raise exception 'HL_PO_INVALID_PDF'; end if;
 perform 1 from hl_order_private.state where singleton for update;
 insert into hl_order_private.po_imports(run_id,source_format,metadata) values(p_run_id,'pdf',p_metadata) on conflict(run_id) do nothing;
 select * into imp from hl_order_private.po_imports where run_id=p_run_id for update;
 if imp.source_format<>'pdf' or imp.metadata<>p_metadata then raise exception 'HL_PO_IMPORT_IMMUTABLE'; end if;
 if p_page is not null then
  if exists(select 1 from hl_order_private.po_pdf_pages where import_id=imp.id and page=p_page and rows<>p_rows) then raise exception 'HL_PO_IMPORT_IMMUTABLE'; end if;
  if not exists(select 1 from hl_order_private.po_pdf_pages where import_id=imp.id and page=p_page) then
   if imp.status<>'staging' then raise exception 'HL_PO_IMPORT_IMMUTABLE'; end if;
   idx:=0;
   for r in select value from jsonb_array_elements(p_rows) loop
    idx:=idx+1;
    if nullif(btrim(r->>'item_code'),'') is null or nullif(btrim(r->>'size'),'') is null or nullif(btrim(r->>'lot'),'') is null
      or nullif(r->>'po_number','') is null or nullif(r->>'vendor','') is null
      or jsonb_typeof(r->'po_remain') is distinct from 'number'
      or (r->>'po_remain')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'HL_PO_INVALID_PDF_LINE'; end if;
    insert into hl_order_private.po_import_rows(import_id,source_file_id,row_index,source) values(imp.id,p_metadata->>'source_file_id',p_page*10000+idx,
     r||jsonb_build_object('source_file_id',p_metadata->>'source_file_id','source_file_name',p_metadata->>'source_file_name','report_date',p_metadata->>'report_date','page',p_page,'line_index',idx));
   end loop;
   insert into hl_order_private.po_pdf_pages values(imp.id,p_page,p_rows);
  end if;
 end if;
 if p_complete and imp.status='staging' then
  if (select count(*) from hl_order_private.po_pdf_pages where import_id=imp.id)<>pages then raise exception 'HL_PO_PDF_INCOMPLETE'; end if;
  select count(*) into n from hl_order_private.po_import_rows where import_id=imp.id;
  if n=0 then raise exception 'HL_PO_EMPTY_IMPORT'; end if;
  select id into duplicate_id from hl_order_private.po_imports where fingerprint=p_metadata->>'fingerprint' and status in ('pending','reconciled');
  update hl_order_private.po_imports set status=case when duplicate_id is null then 'pending' else 'duplicate' end,duplicate_of=duplicate_id,
   fingerprint=p_metadata->>'fingerprint',row_count=n,completed_at=clock_timestamp(),report_date=(p_metadata->>'report_date')::date where id=imp.id returning * into imp;
  update hl_order_private.state set revision=revision+1 where singleton;
 end if;
 return jsonb_build_object('id',imp.id,'status',imp.status,'row_count',imp.row_count,'duplicate_of',imp.duplicate_of,'awaitingReconciliation',imp.status='pending',
 'completed_pages',coalesce((select jsonb_agg(page order by page) from hl_order_private.po_pdf_pages where import_id=imp.id),'[]'));
end $$;

create or replace function hl_order_private.po_balances_v2(p_import_id uuid default null,p_cutoff timestamptz default null)
returns table(itemcode text,size text,lot text,status text,imported numeric,receipt_adjustment numeric,remaining numeric,po_ordered numeric,commonname text)
language sql stable security definer set search_path='' as $$
 with active as materialized(select coalesce(p_import_id,c.active_import_id) id,coalesce(p_cutoff,c.receipt_cutoff) cutoff from hl_order_private.po_control c),
 grouped as materialized(select upper(btrim(r.source->>'item_code')) itemcode,upper(btrim(r.source->>'size')) size,upper(btrim(r.source->>'lot')) lot,
 sum((r.source->>'po_remain')::numeric) imported,sum((r.source->>'po_ordered')::numeric) po_ordered,min(r.source->>'common_name') commonname,bool_or((r.source->>'po_remain')::numeric<0) needs_review
 from hl_order_private.po_import_rows r join active a on a.id=r.import_id join hl_order_private.po_imports i on i.id=r.import_id and i.source_format='pdf'
 where upper(btrim(r.source->>'lot')) in ('27.F1','27.S1') group by 1,2,3),
 adjustments as materialized(select a.itemcode,a.size,a.lot,sum(a.quantity_delta) quantity from hl_order_private.po_receipt_adjustments a cross join active c where a.created_at>c.cutoff group by 1,2,3)
 select g.itemcode,g.size,g.lot,case when g.needs_review then 'review' else 'ready' end,g.imported,coalesce(a.quantity,0),g.imported-coalesce(a.quantity,0),g.po_ordered,g.commonname
 from grouped g left join adjustments a using(itemcode,size,lot)
 union all select b.itemcode,b.size,'27.F1',b.status,b.imported,b.receipt_adjustment,b.remaining,null,null
 from hl_order_private.po_balances_legacy(p_import_id,p_cutoff) b
 where not exists(select 1 from active a join hl_order_private.po_imports i on i.id=a.id and i.source_format='pdf')
$$;

commit;
