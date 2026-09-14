begin;

-- Compute each active PO balance once for the complete response, not once per
-- saved line. Keep the existing source reconciliation and command transactions.
create or replace function hl_order_private.state_json_before_restock()
returns jsonb language sql stable security definer set search_path='' as $function$
  with base as materialized (select hl_order_private.state_json_before_po() s),
  balances as materialized (select * from hl_order_private.po_balances()),
  membership as materialized (
    select distinct nullif(upper(btrim(p.item_code)),'') itemcode
    from public.ph_27f1_hl_po p join hl_order_private.po_control c
      on coalesce(nullif(p.run_id,''),p.source_file_id)=c.active_scope
  ), adjustments as materialized (
    select a.itemcode,a.size,sum(a.quantity_delta) quantity
    from hl_order_private.po_receipt_adjustments a cross join hl_order_private.po_control c
    where a.created_at>c.receipt_cutoff group by a.itemcode,a.size
  ), entries as materialized (
    select 'actionable' kind,0::bigint parent,e.ordinality pos,e.value value,e.value source
      from base cross join lateral jsonb_array_elements(s->'actionable_rows') with ordinality e
    union all
    select 'draft',0::bigint,e.ordinality,e.value,e.value->'source'
      from base cross join lateral jsonb_array_elements(s->'draft') with ordinality e
    union all
    select 'line',o.ordinality,e.ordinality,e.value,e.value->'source'
      from base cross join lateral jsonb_array_elements(s->'orders') with ordinality o
      cross join lateral jsonb_array_elements(o.value->'lines') with ordinality e
  ), enriched as materialized (
    select e.kind,e.parent,e.pos,e.value||jsonb_build_object(
      'po_match',case when e.kind='actionable' then true else m.itemcode is not null end,
      'po_balance',case when b.itemcode is not null then to_jsonb(b)||jsonb_build_object('lot','27.F1')
        else jsonb_build_object('itemcode',upper(btrim(e.source->>'itemcode')),
          'size',upper(btrim(e.source->>'contsize')),'lot','27.F1','status','missing',
          'remaining',null,'imported',null,'receipt_adjustment',coalesce(a.quantity,0)) end) value
    from entries e left join balances b on b.itemcode=upper(btrim(e.source->>'itemcode')) and b.size=upper(btrim(e.source->>'contsize'))
    left join membership m on m.itemcode=nullif(upper(btrim(e.source->>'itemcode')),'')
    left join adjustments a on a.itemcode=upper(btrim(e.source->>'itemcode')) and a.size=upper(btrim(e.source->>'contsize'))
  )
  select s||jsonb_build_object(
    'actionable_rows',coalesce((select jsonb_agg(value order by pos) from enriched where kind='actionable'),'[]'::jsonb),
    'draft',coalesce((select jsonb_agg(value order by pos) from enriched where kind='draft'),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(o.value||jsonb_build_object('lines',coalesce(
      (select jsonb_agg(e.value order by e.pos) from enriched e where e.kind='line' and e.parent=o.ordinality),'[]'::jsonb)) order by o.ordinality)
      from jsonb_array_elements(s->'orders') with ordinality o),'[]'::jsonb),
    'po_receipt_cutoff',(select receipt_cutoff from hl_order_private.po_control),
    'po_imports',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'created_at',i.created_at,
      'report_date',i.report_date,'row_count',i.row_count) order by i.created_at desc,i.id desc)
      from hl_order_private.po_imports i where status='pending' and i.id=(select id from hl_order_private.po_imports
        where status in ('pending','reconciled') order by created_at desc,id desc limit 1)),'[]'::jsonb))
  from base;
$function$;

-- CREATE OR REPLACE preserves the existing private ownership and grants.
commit;
