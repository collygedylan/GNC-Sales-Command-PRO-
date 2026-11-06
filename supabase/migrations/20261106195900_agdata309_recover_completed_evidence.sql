BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='20s';
-- Recover only verified completed requests from 2026-11-06. Never infer completion
-- for the still-pending Pink/Peach rows or change a new request's lifecycle.
CREATE TEMP TABLE agdata309_recovery ON COMMIT DROP AS
WITH latest AS (
 SELECT DISTINCT ON(master_id) * FROM public.ph_requests_completed_history
 WHERE date_completed>='2026-11-06T00:00:00-06:00' AND date_completed<'2026-11-07T00:00:00-06:00'
  AND nullif(master_id,'') IS NOT NULL
 ORDER BY master_id,date_completed DESC,updated_at DESC
)
SELECT h.unique_id request_uid,m.unique_id master_uid,m.itemcode,m.locationcode,m.lotcode,
 coalesce(nullif(nullif(btrim(h.req_spec),''),'-'),nullif(h.spec,''),m.spec,'N/A') restore_spec,
 coalesce(nullif(h.req_caliper,''),nullif(h.caliper,''),m.caliper) restore_caliper,
 coalesce(nullif(h.av_note,''),m.av_note) restore_av,
 coalesce(nullif(h.req_pic_note,''),nullif(h.pick_note,''),m.pick_note,m.pic_note) restore_pick,
 coalesce(nullif(h.req_comments,''),nullif(h.comments,''),nullif(h.req_sales_note,''),nullif(h.sales_note,''),m.sales_note) restore_comments,
 h.date_completed,coalesce(h.completed_by_username,h.completed_by,'') completed_by,
 p.links,p.images,p.names,p.photo_at,p.photo_at+interval '10 days' expires_at,
 n.pct,n.oh,n.available,CASE WHEN nullif(e.photo_link,'') IS NOT NULL AND e.expires_at>clock_timestamp() AND e.current_photo_match_qty IS NOT NULL THEN least(round(n.pct*n.oh/100),greatest(e.current_photo_match_qty,0)) ELSE round(n.pct*n.oh/100) END match_qty
FROM latest h JOIN public.ph_master_inventory m ON m.unique_id=h.master_id
 AND upper(btrim(m.itemcode))=upper(btrim(h.itemcode)) AND upper(btrim(m.locationcode))=upper(btrim(h.locationcode))
 AND upper(replace(btrim(m.lotcode),'_','.'))=upper(replace(btrim(h.lotcode),'_','.'))
LEFT JOIN app_sync_private.inventory_location_evidence_v1 e ON e.source_unique_id=m.unique_id
CROSS JOIN LATERAL (
 SELECT string_agg(u.url,',' ORDER BY u.ord) links,jsonb_agg(u.url ORDER BY u.ord) images,
  string_agg(regexp_replace(s.name,'^.*/',''),',' ORDER BY u.ord) names,min(s.created_at) photo_at
 FROM (SELECT url,min(ord) ord FROM unnest(string_to_array(concat_ws(',',coalesce(nullif(h.req_photo_link,''),h.photo_link),m.photo_link,e.photo_link),',')) WITH ORDINALITY all_urls(url,ord) GROUP BY url) u
 JOIN storage.objects s ON s.bucket_id||'/'||s.name=split_part(u.url,'/storage/v1/object/public/',2)
 WHERE s.name NOT LIKE '%/_thumbs/%'
) p
CROSS JOIN LATERAL (
 SELECT coalesce(CASE WHEN h.req_match ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN h.req_match::numeric END,h.loc_match_pct,m.loc_match_pct) pct,
 CASE WHEN replace(coalesce(m.ptronhand,''),',','') ~ '^[0-9]+(\.[0-9]+)?$' THEN replace(m.ptronhand,',','')::numeric ELSE coalesce(h.on_hand,h.baseline_on_hand,0) END oh,
 CASE WHEN replace(coalesce(m.ptravailable,''),',','') ~ '^[0-9]+(\.[0-9]+)?$' THEN replace(m.ptravailable,',','')::numeric ELSE 0 END available
) n
WHERE p.links IS NOT NULL AND p.photo_at>clock_timestamp()-interval '10 days'
 AND e.cleared_at IS NULL AND nullif(e.clear_reason,'') IS NULL
 -- Leave an intact, deliberately depleted evaluation unchanged.
 AND NOT (nullif(e.photo_link,'') IS NOT NULL AND e.current_photo_match_qty<round(n.pct*n.oh/100))
 AND (m.photo_date IS NULL OR m.photo_date<=h.date_completed+interval '1 minute');

-- Repair the canonical ledger first: the master formatter consumes this source.
UPDATE app_sync_private.inventory_location_evidence_v1 e SET
 spec=r.restore_spec,caliper=r.restore_caliper,match=r.pct::text,loc_match_qty=r.match_qty::text,initial_ptr=r.available::text,
 av_note=r.restore_av,pic_note=r.restore_pick,sales_note=r.restore_comments,photo_link=r.links,photo_name=r.names,
 date_completed=r.date_completed,baseline_on_hand=r.oh,loc_match_pct=r.pct,initial_photo_match_qty=r.match_qty,
 current_photo_match_qty=r.match_qty,evaluated_at=r.photo_at,expires_at=r.expires_at,cleared_at=NULL,clear_reason=NULL,
 eval_baseline_available=r.available,initial_loc_photo_match=r.match_qty,updated_at=clock_timestamp(),updated_by='agdata309_recovery'
FROM agdata309_recovery r WHERE e.source_unique_id=r.master_uid;

UPDATE public.ph_master_inventory m SET
 spec=r.restore_spec,caliper=r.restore_caliper,match=r.pct::text,loc_match_pct=r.pct,loc_match_qty=r.match_qty::text,
 loc_photo_match=r.match_qty,initial_photo_match_qty=r.match_qty,initial_loc_photo_match=r.match_qty,
 baseline_on_hand=r.oh,eval_baseline_available=r.available,initial_ptr=r.available::text,
 av_note=r.restore_av,pic_note=r.restore_pick,pick_note=r.restore_pick,sales_note=r.restore_comments,
 photo_link=r.links,photo_name=r.names,photos=r.images,photo_url=split_part(r.links,',',1),photo_date=r.photo_at,
 photo_expires_at=r.expires_at,date_completed=coalesce(greatest(m.date_completed,r.date_completed),r.date_completed)
FROM agdata309_recovery r WHERE m.unique_id=r.master_uid;

DO $sync$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM agdata309_recovery LOOP
  PERFORM private.sync_item_detail_photos_v308(r.master_uid,r.links);
 END LOOP;
END $sync$;
UPDATE public.ph_location_sales_notes n SET completed_at=r.date_completed,
 eval_baseline_available=r.available,initial_loc_photo_match=r.match_qty
FROM agdata309_recovery r WHERE n.unique_id=r.master_uid;

UPDATE public.ph_requests_pending p SET
 req_photo_link=r.links,req_photo_name=r.names,photos=r.images,photo_url=split_part(r.links,',',1),photo_date=r.photo_at::text,photo_expires_at=r.expires_at,
 req_spec=coalesce(nullif(nullif(p.req_spec,''),'-'),r.restore_spec),spec=r.restore_spec,
 req_caliper=coalesce(nullif(p.req_caliper,''),r.restore_caliper),caliper=coalesce(nullif(p.caliper,''),r.restore_caliper),
 req_match=coalesce(p.req_match,r.pct),loc_match_pct=r.pct,loc_photo_match=r.match_qty,baseline_on_hand=r.oh,initial_photo_match_qty=r.match_qty,
 av_note=coalesce(nullif(p.av_note,''),r.restore_av),req_pic_note=coalesce(nullif(p.req_pic_note,''),r.restore_pick),pick_note=coalesce(nullif(p.pick_note,''),r.restore_pick),
 req_comments=coalesce(nullif(p.req_comments,''),r.restore_comments),comments=coalesce(nullif(p.comments,''),r.restore_comments),sales_note=coalesce(nullif(p.sales_note,''),r.restore_comments)
FROM agdata309_recovery r WHERE p.master_id=r.master_uid;

DO $verify$ BEGIN
 IF EXISTS(SELECT 1 FROM agdata309_recovery r JOIN public.ph_master_inventory m ON m.unique_id=r.master_uid WHERE jsonb_array_length(coalesce(m.photos,'[]'::jsonb))<jsonb_array_length(r.images) OR m.loc_photo_match IS DISTINCT FROM r.match_qty) THEN
  RAISE EXCEPTION 'AGDATA309_RECOVERY_NOT_PUBLISHED';
 END IF;
END $verify$;
COMMIT;
