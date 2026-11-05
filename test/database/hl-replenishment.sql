BEGIN;
SET LOCAL statement_timeout='30s';
ALTER TABLE public.test_ph_hl_staging ADD COLUMN IF NOT EXISTS po_source text, ADD COLUMN IF NOT EXISTS po_row_id text, ADD COLUMN IF NOT EXISTS requested_location text;
CREATE OR REPLACE FUNCTION test_private.ops_hl_po(source_name text,row_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$ DECLARE result jsonb; BEGIN
 IF source_name='ph_27f1_hl_po' THEN SELECT to_jsonb(t) INTO result FROM public.test_ph_27f1_hl_po t WHERE id::text=row_id;
 ELSIF source_name='ph_27s1_hl_po' THEN SELECT to_jsonb(t) INTO result FROM public.test_ph_27s1_hl_po t WHERE id::text=row_id;
 ELSIF source_name='ph_hl_po' THEN SELECT to_jsonb(t) INTO result FROM public.test_ph_hl_po t WHERE id::text=row_id;
 ELSE RAISE EXCEPTION 'HL_PURCHASE_ORDER_SOURCE_REQUIRED'; END IF; IF result IS NULL THEN RAISE EXCEPTION 'HL_PURCHASE_ORDER_NOT_FOUND'; END IF; RETURN result; END $$;
CREATE OR REPLACE FUNCTION public.test_ops_hl_overview(search_text text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,test_private AS $$
DECLARE result jsonb; BEGIN
 IF (test_private.current_profile()).id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 WITH po AS (
  SELECT 'ph_27f1_hl_po' source,id::text row_id,item_code itemcode,common_name commonname,size contsize,lot lotcode,coalesce(po_remain,0)::numeric remaining,''::text requested_location FROM public.test_ph_27f1_hl_po WHERE run_id=(SELECT run_id FROM public.test_ph_27f1_hl_po ORDER BY report_date DESC NULLS LAST,imported_at DESC LIMIT 1)
  UNION ALL SELECT 'ph_27s1_hl_po',id::text,item_code,common_name,size,lot,coalesce(po_remain,0)::numeric,'' FROM public.test_ph_27s1_hl_po WHERE run_id=(SELECT run_id FROM public.test_ph_27s1_hl_po ORDER BY report_date DESC NULLS LAST,imported_at DESC LIMIT 1)
  UNION ALL SELECT 'ph_hl_po',id::text,itemcode,commonname,contsize,lotcode,test_private.ops_read_qty(total_quantity_ordered::text)::numeric,locationcode FROM public.test_ph_hl_po WHERE run_id=(SELECT run_id FROM public.test_ph_hl_po ORDER BY report_date DESC NULLS LAST,created_at DESC LIMIT 1)
 ), selected AS (SELECT * FROM po WHERE remaining>0 AND (search_text='' OR itemcode ILIKE '%'||search_text||'%' OR commonname ILIKE '%'||search_text||'%') ORDER BY itemcode,row_id LIMIT 200),
 inventory AS (SELECT public.test_fn_normalize_itemcode(itemcode) code,sum(test_private.ops_read_qty(ptravailable)) available FROM public.test_ph_master_inventory WHERE public.test_fn_normalize_itemcode(itemcode) IN(SELECT public.test_fn_normalize_itemcode(itemcode) FROM selected) GROUP BY 1),
 soc AS (SELECT public.test_fn_normalize_itemcode(itemcode) code,sum(greatest(ordered_qty-shipped_qty,0)) ordered FROM public.test_ph_soc_master WHERE line_status NOT IN('SUPERSEDED','SHIPPED') GROUP BY 1),
 reserves AS (SELECT public.test_fn_normalize_itemcode(itemcode) code,sum(greatest(test_private.ops_read_qty(quantityordered)-test_private.ops_read_qty(quantityshipped),0)) reserved FROM public.test_ph_customer_reserves GROUP BY 1)
 SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('inventory_available',coalesce(i.available,0),'soc_open',coalesce(o.ordered,0),'customer_reserved',coalesce(r.reserved,0)) ORDER BY s.itemcode,s.row_id),'[]') INTO result FROM selected s LEFT JOIN inventory i ON i.code=public.test_fn_normalize_itemcode(s.itemcode) LEFT JOIN soc o ON o.code=public.test_fn_normalize_itemcode(s.itemcode) LEFT JOIN reserves r ON r.code=public.test_fn_normalize_itemcode(s.itemcode);
 RETURN jsonb_build_object('orders',result,'limit',200,'captured_at',now());
END $$;
REVOKE ALL ON FUNCTION public.test_ops_hl_overview(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.test_ops_hl_overview(text) TO authenticated;
COMMIT;
