-- Materialize the protected HL response once; do not repeat its SOC/PO joins
-- while adding draft purpose labels. Existing locks and RPC signatures remain.
begin;
create or replace function hl_order_private.state_json() returns jsonb
language sql stable security definer set search_path='' as $$
 with base as materialized (select hl_order_private.state_json_before_restock() s)
 select s||jsonb_build_object('draft',coalesce((select jsonb_agg(d||jsonb_build_object('source_kind',coalesce(d->'source'->>'source_kind','soc')))
   from jsonb_array_elements(s->'draft') d),'[]'),'po_report',(
   select jsonb_build_object('id',i.id,'source_format',i.source_format,'name',coalesce(nullif(i.metadata->>'source_file_name',''),'Legacy PO report'),
     'report_date',i.report_date,'receipt_cutoff',c.receipt_cutoff,'pending_pdf',(
       select jsonb_build_object('id',p.id,'name',p.metadata->>'source_file_name','report_date',p.report_date)
       from hl_order_private.po_imports p where p.source_format='pdf' and p.status='pending'
       order by (p.metadata->>'report_printed_at')::timestamptz desc,p.created_at desc,p.id desc limit 1))
   from hl_order_private.po_control c left join hl_order_private.po_imports i on i.id=c.active_import_id))
 from base
$$;

create or replace function hl_order_private.restock_items_v2(p_lot text) returns setof jsonb
language sql stable security definer set search_path='' as $$
  with balances as materialized (select * from hl_order_private.po_balances_v2() where lot=p_lot),
  po as materialized (select b.itemcode,b.size,b.commonname,b.po_ordered,b.remaining,b.status balance_status,t.target,t.id target_id,t.basis_quantity,t.basis_import_id,t.id is not null target_initialized,p_lot lot from balances b left join hl_order_private.restock_targets t on t.itemcode=b.itemcode and t.size=b.size and t.lot=b.lot where b.lot=p_lot
  ), master_ids as materialized (
    select upper(btrim(m.itemcode)) itemcode,upper(btrim(m.contsize)) size,m.unique_id,
      case when nullif(btrim(m.unique_id),'') is not null and count(distinct hl_order_private.quantity(m.ptravailable::text))=1
        and bool_and(hl_order_private.quantity(m.ptravailable::text) is not null) then min(hl_order_private.quantity(m.ptravailable::text)) end available
    from public.ph_master_inventory m join po p on p.itemcode=upper(btrim(m.itemcode)) and p.size=upper(btrim(m.contsize))
    where upper(btrim(m.lotcode))=p_lot and lower(btrim(coalesce(m.app_tab_assignment,''))) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
      and (not exists(select 1 from public.profiles p where p.id=auth.uid() and upper(p.role) like '%FOREMAN%')
        or upper(btrim(coalesce(m.priority,''))) not in ('','-','--','---','N/A','NA','NULL','NONE'))
    group by 1,2,m.unique_id
  ), master as (
    select itemcode,size,case when bool_and(available is not null) then sum(available) end available from master_ids group by 1,2
  ), saved as (
    select i.itemcode,i.size,sum(d.quantity) quantity,min(d.source_id) source_id from hl_order_private.drafts d
    join hl_order_private.restock_intents i using(source_id) join hl_order_private.dispositions x using(source_id)
    where x.status='draft' and i.lot=p_lot group by 1,2
  ), incoming as (
    select i.itemcode,i.size,sum(l.quantity-l.received_quantity-l.cancelled_quantity) quantity
    from hl_order_private.order_lines l join hl_order_private.restock_intents i using(source_id) where i.lot=p_lot group by 1,2
  ), receipt_review as (
    select i.itemcode,i.size,jsonb_agg(jsonb_build_object('id',r.id,'order_number',o.order_number,
      'received_quantity',r.received_quantity,'previous_quantity',r.previous_quantity,'quantity_delta',r.quantity_delta,'created_at',r.created_at)
      order by r.created_at,r.id) receipts
    from hl_order_private.receipts r join hl_order_private.order_lines l on l.id=r.line_id
    join hl_order_private.restock_intents i on i.source_id=l.source_id join hl_order_private.orders o on o.id=r.order_id
    left join hl_order_private.restock_inventory_gates g on g.itemcode=i.itemcode and g.size=i.size and g.lot=i.lot
    where i.lot=p_lot and (g.confirmed_at is null or r.created_at>g.confirmed_at) group by i.itemcode,i.size
  ), amounts as (
    select p.*,case when m.itemcode is null then 0 else m.available end available,coalesce(s.quantity,0) saved_quantity,s.source_id,
      coalesce(n.quantity,0) incoming_quantity,coalesce(g.receipt_watermark,0) receipt_watermark,
      coalesce(rr.receipts,'[]'::jsonb) receipts,snap->>'changed_at' inventory_updated_at,
      case when snap->>'state' is distinct from 'ready' then 'inventory_verifying'
        when p.balance_status<>'ready' or p.remaining is null or p.remaining<0 then 'po_unknown' when p.target is null then 'target_needed' when m.itemcode is not null and m.available is null then 'inventory_unknown'
        when g.receipt_watermark>g.confirmed_watermark then 'receipt_pending' else 'ready' end status,
      coalesce(g.receipt_watermark>g.confirmed_watermark and (snap->>'master_revision')::bigint>g.receipt_revision
        and (snap->>'changed_at')::timestamptz>g.receipt_at and snap->>'state'='ready' and (m.itemcode is null or m.available is not null),false) can_confirm_inventory
    from po p left join master m using(itemcode,size) left join saved s using(itemcode,size)
    left join incoming n using(itemcode,size) left join hl_order_private.restock_inventory_gates g on g.itemcode=p.itemcode and g.size=p.size and g.lot=p_lot
    left join receipt_review rr on rr.itemcode=p.itemcode and rr.size=p.size
    cross join lateral(select hl_order_private.restock_snapshot() snap) snapshot
  ) select to_jsonb(a)||jsonb_build_object('suggested_quantity',case when a.status='ready' then greatest(0,ceil(target-available-saved_quantity-incoming_quantity)) end,
    'po_balance',to_jsonb(b)||jsonb_build_object('lot',p_lot)) from amounts a left join balances b using(itemcode,size) order by itemcode,size
$$;

commit;
