begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Every evaluation belongs to one physical inventory UID, including across imports.
alter table app_sync_private.inventory_location_evidence_v1 drop constraint if exists inventory_location_evidence_v1_pkey;
alter table app_sync_private.inventory_location_evidence_v1 add primary key(source_unique_id);
alter table public.ph_location_sales_notes add column if not exists unique_id text;
alter table public.ph_location_sales_notes add column if not exists source text not null default '';
update public.ph_location_sales_notes n set unique_id=coalesce((select min(m.unique_id) from public.ph_master_inventory m where m.itemcode=n.itemcode and m.locationcode=n.locationcode and m.lotcode=n.lotcode having count(*)=1),'legacy-unresolved-'||md5(n.itemcode||'|'||n.locationcode||'|'||n.lotcode)) where n.unique_id is null;
update public.ph_location_sales_notes n set source=coalesce(m.source,'') from public.ph_master_inventory m where m.unique_id=n.unique_id and n.source='';
alter table public.ph_location_sales_notes drop constraint if exists ph_location_sales_notes_pkey;
alter table public.ph_location_sales_notes add primary key(unique_id);
CREATE OR REPLACE FUNCTION public.get_request_drive_evidence_health_snapshot_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  mismatch_count bigint := 0;
  checked_count bigint := 0;
  mismatch_request_ids jsonb := '[]'::jsonb;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'REQUEST_DRIVE_HEALTH_FORBIDDEN';
  end if;

  with latest_completion as (
    select distinct on (history.master_id)
      history.unique_id,
      history.master_id,
      history.req_spec,
      history.req_caliper,
      history.req_match,
      history.req_pic_note,
      history.av_note,
      history.req_photo_link,
      history.req_photo_name,
      coalesce(history.date_completed, history.updated_at) as completed_at,
      master.spec as master_spec,
      master.caliper as master_caliper,
      master.match as master_match,
      master.pic_note as master_pic_note,
      master.av_note as master_av_note,
      master.photo_link as master_photo_link,
      master.photo_name as master_photo_name,
      master.av_rule_last_cleared_at,
      master.av_rule_last_clear_reason,
      master.av_rule_bundle_updated_at,
      master.av_rule_av_note_updated_at,
      master.av_rule_spec_updated_at,
      master.av_rule_match_updated_at,
      master.av_rule_caliper_updated_at,
      master.av_rule_photo_updated_at,
      evidence.itemcode_key is not null as location_evidence_present,
      evidence.updated_at as location_evidence_updated_at,
      evidence.cleared_at as location_evidence_cleared_at,
      evidence.expires_at as location_evidence_expires_at,
      evidence.baseline_on_hand as location_evidence_baseline_on_hand,
      evidence.initial_photo_match_qty as location_evidence_initial_photo_match_qty,
      evidence.current_photo_match_qty as location_evidence_current_photo_match_qty,
      private.inventory_location_evidence_number_v2(master.ptronhand) as master_current_on_hand
    from public.ph_request_history history
    join public.ph_master_inventory master on master.unique_id = history.master_id
    left join app_sync_private.inventory_location_evidence_v1 evidence
      on evidence.source_unique_id = master.unique_id
    where history.date_completed >= now() - interval '48 hours'
      and lower(btrim(coalesce(history.req_status, ''))) in ('complete','completed','done')
    order by history.master_id, history.date_completed desc nulls last, history.updated_at desc nulls last
  ), evaluated as (
    select completion.*,
      (
        (
          nullif(btrim(completion.req_spec), '') is not null
          and coalesce(btrim(completion.req_spec), '') is distinct from coalesce(btrim(completion.master_spec), '')
          and (completion.av_rule_spec_updated_at is null or completion.av_rule_spec_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_caliper), '') is not null
          and coalesce(btrim(completion.req_caliper), '') is distinct from coalesce(btrim(completion.master_caliper), '')
          and (completion.av_rule_caliper_updated_at is null or completion.av_rule_caliper_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_match), '') is not null
          and coalesce(btrim(completion.req_match), '') is distinct from coalesce(btrim(completion.master_match), '')
          and (completion.av_rule_match_updated_at is null or completion.av_rule_match_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_pic_note), '') is not null
          and coalesce(btrim(completion.req_pic_note), '') is distinct from coalesce(btrim(completion.master_pic_note), '')
        )
        or (
          nullif(btrim(completion.av_note), '') is not null
          and coalesce(btrim(completion.av_note), '') is distinct from coalesce(btrim(completion.master_av_note), '')
          and (completion.av_rule_av_note_updated_at is null or completion.av_rule_av_note_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_photo_link), '') is not null
          and coalesce(btrim(completion.req_photo_link), '') is distinct from coalesce(btrim(completion.master_photo_link), '')
          and (completion.av_rule_photo_updated_at is null or completion.av_rule_photo_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_photo_name), '') is not null
          and coalesce(btrim(completion.req_photo_name), '') is distinct from coalesce(btrim(completion.master_photo_name), '')
          and (completion.av_rule_photo_updated_at is null or completion.av_rule_photo_updated_at <= completion.completed_at)
        )
      )
      and (
        completion.av_rule_bundle_updated_at is null
        or completion.av_rule_bundle_updated_at <= completion.completed_at
      )
      and (completion.av_rule_last_cleared_at is null
           or completion.av_rule_last_cleared_at < completion.completed_at)
      and not (
        completion.location_evidence_present
        and (
          completion.location_evidence_updated_at >= completion.completed_at
          or completion.location_evidence_cleared_at is not null
          or (completion.location_evidence_expires_at is not null
              and clock_timestamp() > completion.location_evidence_expires_at)
          or coalesce(private.inventory_location_evidence_qty_v2(
            completion.location_evidence_baseline_on_hand,
            completion.location_evidence_initial_photo_match_qty,
            completion.master_current_on_hand
          ), completion.location_evidence_current_photo_match_qty, 0) <= 0
        )
      ) as has_repairable_mismatch
    from latest_completion completion
  )
  select
    count(*),
    count(*) filter (where evaluated.has_repairable_mismatch),
    coalesce(
      jsonb_agg(to_jsonb(evaluated.unique_id) order by evaluated.completed_at, evaluated.unique_id)
        filter (where evaluated.has_repairable_mismatch and evaluated.unique_id is not null),
      '[]'::jsonb
    )
  into checked_count, mismatch_count, mismatch_request_ids
  from evaluated;

  return jsonb_build_object(
    'contract_version', 'request-drive-evidence-health-v1',
    'recent_completed_count', checked_count,
    'evidence_mismatch_count', mismatch_count,
    'mismatch_request_ids', mismatch_request_ids
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.save_drive_evidence_v3(p_master_uid text, p_expected_itemcode text, p_expected_locationcode text, p_expected_lotcode text, p_expected_signature text, p_baseline jsonb, p_evidence jsonb, p_complete boolean, p_workflow text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles%rowtype;
  current_row public.ph_master_inventory%rowtype;
  saved_row public.ph_master_inventory%rowtype;
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
  prior private.drive_evidence_idempotency%rowtype;
  payload jsonb:=coalesce(p_evidence,'{}'::jsonb);
  unexpected text[];
  stable_item text:=upper(btrim(coalesce(p_expected_itemcode,'')));
  stable_location text:=upper(btrim(coalesce(p_expected_locationcode,'')));
  workflow text:=lower(btrim(coalesce(p_workflow,'')));
  saved_at timestamptz:=clock_timestamp();
  request_hash text;
  storage_key text:='location-v3-'||md5(coalesce(p_idempotency_key,''));
  response jsonb;
  request_rows jsonb:='[]'::jsonb;
  location_rows jsonb:='[]'::jsonb;
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
begin
  actor:=private.require_drive_live_change_profile_v2392(p_master_uid,p_expected_itemcode,p_expected_locationcode,p_expected_lotcode);
  if stable_item='' or stable_location='' then raise exception using errcode='22023',message='INVALID_MASTER_IDENTITY'; end if;
  if char_length(btrim(coalesce(p_idempotency_key,''))) not between 12 and 180 then raise exception using errcode='22023',message='INVALID_IDEMPOTENCY_KEY'; end if;
  if workflow not in ('season','location','notes') then raise exception using errcode='22023',message='INVALID_DRIVE_WORKFLOW'; end if;
  if jsonb_typeof(payload)<>'object' or jsonb_typeof(coalesce(p_baseline,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='INVALID_EVIDENCE_PAYLOAD'; end if;
  select array_agg(key order by key) into unexpected from jsonb_object_keys(payload) keys(key)
  where key not in ('spec','caliper','match','loc_match_qty','initial_ptr','av_note','pick_note','comments','photo_link','photo_name');
  if coalesce(cardinality(unexpected),0)>0 then raise exception using errcode='22023',message='UNSUPPORTED_DRIVE_EVIDENCE_FIELD'; end if;
  if octet_length(payload::text)>65536 or octet_length(coalesce(p_baseline,'{}'::jsonb)::text)>65536 then raise exception using errcode='22023',message='DRIVE_EVIDENCE_PAYLOAD_TOO_LARGE'; end if;
  if payload?'match' and nullif(btrim(payload->>'match'),'') is not null
    and payload->>'match' !~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then raise exception using errcode='22023',message='INVALID_LOC_MATCH_PERCENT'; end if;
  if payload?'photo_link' and octet_length(coalesce(payload->>'photo_link',''))>16000 then raise exception using errcode='22023',message='PHOTO_REFERENCE_TOO_LARGE'; end if;
  request_hash:=md5(concat_ws('|',stable_item,stable_location,payload::text,coalesce(p_complete,false)::text,workflow));
  select * into prior from private.drive_evidence_idempotency
  where profile_id=actor.id and idempotency_key=storage_key;
  if found then
    if prior.request_hash<>request_hash then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT','canonicalConfirmed',false,'retryBlocked',true); end if;
    return jsonb_set(prior.response_payload,'{recovered}','true'::jsonb,true);
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('drive-location-idempotency:'||actor.id::text||':'||storage_key,0))
    or not pg_try_advisory_xact_lock(hashtextextended('drive-row:'||p_master_uid,0)) then
    return jsonb_build_object('ok',false,'code','DRIVE_SAVE_BUSY','canonicalConfirmed',false,'retryAfterMs',250,'retryBlocked',false);
  end if;
  select * into current_row from public.ph_master_inventory m
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location
  order by (m.unique_id=btrim(coalesce(p_master_uid,''))) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  if not found then return jsonb_build_object('ok',false,'code','DRIVE_ROW_NOT_FOUND','canonicalConfirmed',true,'retryBlocked',false); end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=btrim(p_master_uid);
  if not found then
    evidence.itemcode_key:=stable_item;evidence.locationcode_key:=stable_location;
    evidence.itemcode:=current_row.itemcode;evidence.locationcode:=current_row.locationcode;
    evidence.spec:=current_row.spec;evidence.caliper:=current_row.caliper;evidence.match:=current_row.match;
    evidence.loc_match_qty:=current_row.loc_match_qty;evidence.initial_ptr:=current_row.initial_ptr;
    evidence.av_note:=current_row.av_note;evidence.pic_note:=current_row.pic_note;evidence.sales_note:=current_row.sales_note;
    evidence.photo_link:=current_row.photo_link;evidence.photo_name:=current_row.photo_name;
    evidence.date_completed:=current_row.date_completed;evidence.app_tab_assignment:=current_row.app_tab_assignment;
  end if;
  if payload?'spec' then evidence.spec:=nullif(btrim(payload->>'spec'),''); end if;
  if payload?'caliper' then evidence.caliper:=nullif(btrim(payload->>'caliper'),''); end if;
  if payload?'match' then evidence.match:=nullif(btrim(payload->>'match'),''); end if;
  if payload?'loc_match_qty' then evidence.loc_match_qty:=nullif(btrim(payload->>'loc_match_qty'),''); end if;
  if payload?'initial_ptr' then evidence.initial_ptr:=nullif(btrim(payload->>'initial_ptr'),''); end if;
  if payload?'av_note' then evidence.av_note:=nullif(btrim(payload->>'av_note'),''); end if;
  if payload?'pick_note' then evidence.pic_note:=nullif(btrim(payload->>'pick_note'),''); end if;
  if payload?'comments' then evidence.sales_note:=nullif(payload->>'comments',''); end if;
  if payload?'photo_link' then evidence.photo_link:=nullif(btrim(payload->>'photo_link'),''); end if;
  if payload?'photo_name' then evidence.photo_name:=nullif(btrim(payload->>'photo_name'),''); end if;
  if coalesce(p_complete,false) then evidence.date_completed:=saved_at;evidence.app_tab_assignment:=workflow; end if;
  evidence.source_unique_id:=current_row.unique_id;evidence.updated_at:=saved_at;evidence.updated_by:=lower(btrim(actor.username));
  insert into app_sync_private.inventory_location_evidence_v1 select (evidence).*
  on conflict(source_unique_id) do update set
    itemcode=excluded.itemcode,locationcode=excluded.locationcode,source_unique_id=excluded.source_unique_id,
    spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,loc_match_qty=excluded.loc_match_qty,
    initial_ptr=excluded.initial_ptr,av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,
    photo_link=excluded.photo_link,photo_name=excluded.photo_name,date_completed=excluded.date_completed,
    app_tab_assignment=excluded.app_tab_assignment,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  perform set_config('gnc.inventory_edit_actor',lower(btrim(actor.username)),true);
  update public.ph_master_inventory m set
    spec=evidence.spec,caliper=evidence.caliper,match=evidence.match,
    loc_match_qty=private.inventory_location_match_qty_v1(m.ptronhand,evidence.match,evidence.loc_match_qty),
    initial_ptr=evidence.initial_ptr,av_note=evidence.av_note,pic_note=evidence.pic_note,sales_note=evidence.sales_note,
    photo_link=evidence.photo_link,photo_name=evidence.photo_name,date_completed=evidence.date_completed,
    app_tab_assignment=evidence.app_tab_assignment,
    av_rule_spec_updated_at=case when payload?'spec' then saved_at else m.av_rule_spec_updated_at end,
    av_rule_caliper_updated_at=case when payload?'caliper' then saved_at else m.av_rule_caliper_updated_at end,
    av_rule_match_updated_at=case when payload?'match' then saved_at else m.av_rule_match_updated_at end,
    av_rule_av_note_updated_at=case when payload?'av_note' then saved_at else m.av_rule_av_note_updated_at end,
    av_rule_photo_updated_at=case when payload?'photo_link' or payload?'photo_name' then saved_at else m.av_rule_photo_updated_at end,
    av_rule_bundle_updated_at=case when payload<>'{}'::jsonb then saved_at else m.av_rule_bundle_updated_at end,
    last_updated=saved_at
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  select * into saved_row from public.ph_master_inventory m
  where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location
  order by (m.unique_id=btrim(coalesce(p_master_uid,''))) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  select coalesce(jsonb_agg(to_jsonb(m) order by private.eval_work_natural_sort_key_v1(m.locationcode),private.eval_work_natural_sort_key_v1(m.lotcode),m.unique_id),'[]'::jsonb)
    into location_rows from public.ph_master_inventory m
    where m.unique_id=btrim(p_master_uid) and upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location;

  insert into public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,photo_link,photo_name,spec,caliper,loc_match_pct,av_note,pick_note,sales_note,updated_by,updated_at)
  values(saved_row.unique_id,coalesce(saved_row.source,''),saved_row.itemcode,saved_row.locationcode,coalesce(saved_row.lotcode,''),saved_row.photo_link,saved_row.photo_name,saved_row.spec,saved_row.caliper,saved_row.loc_match_pct,saved_row.av_note,saved_row.pick_note,saved_row.sales_note,actor.id,clock_timestamp())
  on conflict(unique_id) do update set source=excluded.source,itemcode=excluded.itemcode,locationcode=excluded.locationcode,lotcode=excluded.lotcode,photo_link=excluded.photo_link,photo_name=excluded.photo_name,spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,av_note=excluded.av_note,pick_note=excluded.pick_note,sales_note=excluded.sales_note,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  with changed as (
    update public.ph_requests_pending request set
      req_spec=evidence.spec,req_caliper=evidence.caliper,
      req_match=case when evidence.match ~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then evidence.match::numeric else null end,
      req_pic_note=evidence.pic_note,req_sales_note=evidence.sales_note,req_comments=evidence.sales_note,
      av_note=evidence.av_note,req_photo_link=evidence.photo_link,req_photo_name=evidence.photo_name,
      req_status=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then 'Complete' else request.req_status end,
      date_completed=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then saved_at::text else request.date_completed end,
      completed_by_username=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then lower(btrim(actor.username)) else request.completed_by_username end,
      completed_by_display=case when coalesce(p_complete,false) and (request.master_id=saved_row.unique_id
        or upper(btrim(coalesce(request.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) then coalesce(nullif(btrim(actor.display_name),''),actor.username) else request.completed_by_display end,
      app_tab_assignment=evidence.app_tab_assignment,master_app_tab_assignment=evidence.app_tab_assignment,
      row_version=coalesce(request.row_version,0)+1,updated_at=saved_at
    where upper(btrim(coalesce(request.itemcode,'')))=stable_item
      and upper(btrim(coalesce(request.locationcode,'')))=stable_location
      and request.master_id=saved_row.unique_id
      and coalesce(request.req_archived,false)=false
      and lower(btrim(coalesce(request.req_status,'pending'))) not in ('complete','completed','done','archived','cancelled','canceled')
    returning request.*
  ) select coalesce(jsonb_agg(to_jsonb(changed) order by changed.unique_id),'[]'::jsonb) into request_rows from changed;
  response:=jsonb_build_object('ok',true,'code','SAVED','contractVersion','save-drive-evidence-v3-row-isolation',
    'row',to_jsonb(saved_row),'locationRows',location_rows,'requestRows',request_rows,'completed',coalesce(p_complete,false),
    'canonicalConfirmed',true,'mergedUnrelatedChanges',true,'retryBlocked',false,'recovered',false);
  insert into private.drive_evidence_idempotency(profile_id,idempotency_key,request_hash,response_payload,outcome_code)
  values(actor.id,storage_key,request_hash,response,'SAVED');
  return response;
end
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_inventory_location_evidence_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '500ms'
 SET statement_timeout TO '5s'
AS $function$
declare
  affected integer:=0;
  evidence_updated integer:=0;
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
begin
  with resolved as (
    select e.itemcode_key,e.locationcode_key,e.source_unique_id,m.lotcode source_lotcode,
      private.inventory_location_evidence_number_v2(m.ptronhand) current_on_hand
    from app_sync_private.inventory_location_evidence_v1 e
    left join lateral (
      select m.* from public.ph_master_inventory m
      where m.unique_id=e.source_unique_id
      order by (m.unique_id=e.source_unique_id) desc,
        (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(e.source_lotcode,'')))) desc,
        m.last_updated desc nulls last,m.unique_id limit 1
    ) m on true
  ), calculated as (
    select e.itemcode_key,e.locationcode_key,r.source_unique_id,r.source_lotcode,
      coalesce(private.inventory_location_evidence_qty_v2(
        e.baseline_on_hand,e.initial_photo_match_qty,r.current_on_hand
      ),e.current_photo_match_qty) current_photo_match_qty,
      e.cleared_at is not null
        or (e.initial_photo_match_qty>0 and coalesce(private.inventory_location_evidence_qty_v2(
          e.baseline_on_hand,e.initial_photo_match_qty,r.current_on_hand
        ),e.current_photo_match_qty,0)<=0)
        or (e.expires_at is not null and clock_timestamp()>e.expires_at) must_clear,
      case when e.clear_reason is not null then e.clear_reason
        when e.expires_at is not null and clock_timestamp()>e.expires_at then 'expired'
        when e.initial_photo_match_qty>0 and coalesce(private.inventory_location_evidence_qty_v2(
          e.baseline_on_hand,e.initial_photo_match_qty,r.current_on_hand
        ),e.current_photo_match_qty,0)<=0 then 'depleted' end clear_reason
    from app_sync_private.inventory_location_evidence_v1 e
    join resolved r using(source_unique_id)
  )
  update app_sync_private.inventory_location_evidence_v1 e set
    source_unique_id=coalesce(c.source_unique_id,e.source_unique_id),
    source_lotcode=coalesce(c.source_lotcode,e.source_lotcode),
    current_photo_match_qty=c.current_photo_match_qty,
    loc_match_qty=case when c.must_clear then null else c.current_photo_match_qty::text end,
    spec=case when c.must_clear then null else e.spec end,
    match=case when c.must_clear then null else e.match end,
    av_note=case when c.must_clear then null else e.av_note end,
    pic_note=case when c.must_clear then null else e.pic_note end,
    sales_note=case when c.must_clear then null else e.sales_note end,
    photo_link=case when c.must_clear then null else e.photo_link end,
    photo_name=case when c.must_clear then null else e.photo_name end,
    date_completed=case when c.must_clear then null else e.date_completed end,
    cleared_at=case when c.must_clear then coalesce(e.cleared_at,clock_timestamp()) else null end,
    clear_reason=case when c.must_clear then c.clear_reason else null end,
    updated_at=clock_timestamp()
  from calculated c
  where e.source_unique_id=c.source_unique_id
    and (e.source_unique_id,e.source_lotcode,e.current_photo_match_qty,e.loc_match_qty,e.spec,e.match,
      e.av_note,e.pic_note,e.sales_note,e.photo_link,e.photo_name,e.date_completed,e.cleared_at,e.clear_reason)
      is distinct from
      (coalesce(c.source_unique_id,e.source_unique_id),coalesce(c.source_lotcode,e.source_lotcode),
      c.current_photo_match_qty,case when c.must_clear then null else c.current_photo_match_qty::text end,
      case when c.must_clear then null else e.spec end,case when c.must_clear then null else e.match end,
      case when c.must_clear then null else e.av_note end,case when c.must_clear then null else e.pic_note end,
      case when c.must_clear then null else e.sales_note end,case when c.must_clear then null else e.photo_link end,
      case when c.must_clear then null else e.photo_name end,case when c.must_clear then null else e.date_completed end,
      case when c.must_clear then coalesce(e.cleared_at,clock_timestamp()) else null end,
      case when c.must_clear then c.clear_reason else null end);
  get diagnostics evidence_updated=row_count;
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  with desired as (
    select m.unique_id,e.spec,e.caliper,e.match,e.initial_ptr,e.av_note,e.pic_note,e.sales_note,
      e.photo_link,e.photo_name,e.date_completed,e.app_tab_assignment,e.updated_at,
      case when e.cleared_at is not null then null
        when m.unique_id=e.source_unique_id
          or upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(e.source_lotcode,'')))
          then e.current_photo_match_qty::text
        else private.inventory_location_match_qty_v1(m.ptronhand,e.match,e.loc_match_qty) end loc_match_qty
    from public.ph_master_inventory m
    join app_sync_private.inventory_location_evidence_v1 e
      on e.source_unique_id=m.unique_id
  )
  update public.ph_master_inventory m set
    spec=d.spec,caliper=d.caliper,match=d.match,loc_match_qty=d.loc_match_qty,
    initial_ptr=d.initial_ptr,av_note=d.av_note,pic_note=d.pic_note,sales_note=d.sales_note,
    photo_link=d.photo_link,photo_name=d.photo_name,date_completed=d.date_completed,
    app_tab_assignment=d.app_tab_assignment,last_updated=greatest(m.last_updated,d.updated_at)
  from desired d
  where m.unique_id=d.unique_id
    and (m.spec,m.caliper,m.match,m.loc_match_qty,m.initial_ptr,m.av_note,m.pic_note,m.sales_note,
      m.photo_link,m.photo_name,m.date_completed,m.app_tab_assignment) is distinct from
      (d.spec,d.caliper,d.match,d.loc_match_qty,d.initial_ptr,d.av_note,d.pic_note,d.sales_note,
      d.photo_link,d.photo_name,d.date_completed,d.app_tab_assignment);
  get diagnostics affected=row_count;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  return jsonb_build_object('ok',true,'affected',affected,'evidenceUpdated',evidence_updated,
    'cleared',(select count(*) from app_sync_private.inventory_location_evidence_v1 where cleared_at is not null));
end
$function$;

CREATE OR REPLACE FUNCTION private.normalize_inventory_location_evidence_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  source_row public.ph_master_inventory%rowtype;
  current_on_hand numeric;
  evaluation_event boolean:=false;
  has_evidence boolean:=false;
begin
  has_evidence:=coalesce(new.spec,new.match,new.loc_match_qty,new.av_note,new.pic_note,
    new.sales_note,new.photo_link,new.photo_name,new.date_completed::text) is not null;
  select * into source_row from public.ph_master_inventory m
  where m.unique_id=new.source_unique_id
  order by (m.unique_id=new.source_unique_id) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(new.source_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  if found then
    new.source_unique_id:=source_row.unique_id;
    new.source_lotcode:=source_row.lotcode;
    current_on_hand:=private.inventory_location_evidence_number_v2(source_row.ptronhand);
  end if;
  if tg_op='INSERT' then
    evaluation_event:=has_evidence;
  else
    evaluation_event:=has_evidence and (
      new.date_completed is distinct from old.date_completed
      or new.photo_link is distinct from old.photo_link
      or new.photo_name is distinct from old.photo_name
      or new.spec is distinct from old.spec
      or new.match is distinct from old.match
      or old.evaluated_at is null
    );
  end if;
  if evaluation_event then
    new.evaluated_at:=case
      when tg_op='UPDATE' and new.date_completed is distinct from old.date_completed
        and new.date_completed is not null then new.date_completed
      when tg_op='INSERT' and new.date_completed is not null then new.date_completed
      else clock_timestamp()
    end;
    new.date_completed:=new.evaluated_at;
    new.baseline_on_hand:=current_on_hand;
    new.loc_match_pct:=private.inventory_location_evidence_number_v2(new.match);
    new.initial_photo_match_qty:=case
      when new.baseline_on_hand is not null and new.loc_match_pct between 0 and 100
        then round(new.baseline_on_hand*new.loc_match_pct/100)
      else null
    end;
    new.current_photo_match_qty:=private.inventory_location_evidence_qty_v2(
      new.baseline_on_hand,new.initial_photo_match_qty,current_on_hand
    );
    new.loc_match_qty:=new.current_photo_match_qty::text;
    new.initial_ptr:=coalesce(new.baseline_on_hand::text,new.initial_ptr);
    new.expires_at:=private.inventory_location_evidence_expiry_v2(new.evaluated_at);
    new.cleared_at:=null;
    new.clear_reason:=null;
  elsif new.evaluated_at is not null then
    new.current_photo_match_qty:=coalesce(
      private.inventory_location_evidence_qty_v2(
        new.baseline_on_hand,new.initial_photo_match_qty,current_on_hand
      ),new.current_photo_match_qty
    );
    new.loc_match_qty:=new.current_photo_match_qty::text;
  end if;
  if new.cleared_at is not null
    or (new.initial_photo_match_qty>0 and coalesce(new.current_photo_match_qty,0)<=0)
    or (new.expires_at is not null and clock_timestamp()>new.expires_at) then
    new.spec:=null;new.match:=null;new.loc_match_qty:=null;new.av_note:=null;
    new.pic_note:=null;new.sales_note:=null;new.photo_link:=null;new.photo_name:=null;
    new.date_completed:=null;
    if new.cleared_at is null then new.cleared_at:=clock_timestamp(); end if;
    if new.clear_reason is null then
      new.clear_reason:=case when new.expires_at is not null and clock_timestamp()>new.expires_at
        then 'expired' else 'depleted' end;
    end if;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION private.capture_inventory_location_evidence_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
  actor text:=coalesce(nullif(current_setting('gnc.inventory_edit_actor',true),''),auth.uid()::text,'system');
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
begin
  if private.ph_master_inventory_import_run_v1() is not null or previous_guard='on' then return new; end if;
  if (new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
    is not distinct from
    (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment) then return new; end if;
  insert into app_sync_private.inventory_location_evidence_v1 as stored(
    itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,
    spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,
    photo_link,photo_name,date_completed,app_tab_assignment,updated_at,updated_by
  ) values(
    upper(btrim(new.itemcode)),upper(btrim(new.locationcode)),new.itemcode,new.locationcode,new.unique_id,
    new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,new.pic_note,new.sales_note,
    new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment,clock_timestamp(),actor
  ) on conflict(source_unique_id) do update set
    itemcode=excluded.itemcode,locationcode=excluded.locationcode,source_unique_id=excluded.source_unique_id,
    spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,loc_match_qty=excluded.loc_match_qty,
    initial_ptr=excluded.initial_ptr,av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,
    photo_link=excluded.photo_link,photo_name=excluded.photo_name,date_completed=excluded.date_completed,
    app_tab_assignment=excluded.app_tab_assignment,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=new.unique_id;
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  update public.ph_master_inventory m set
    spec=evidence.spec,caliper=evidence.caliper,match=evidence.match,
    loc_match_qty=case when evidence.cleared_at is not null then null
      when m.unique_id=evidence.source_unique_id
        or upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(evidence.source_lotcode,'')))
        then evidence.current_photo_match_qty::text
      else private.inventory_location_match_qty_v1(m.ptronhand,evidence.match,evidence.loc_match_qty) end,
    initial_ptr=evidence.initial_ptr,av_note=evidence.av_note,pic_note=evidence.pic_note,
    sales_note=evidence.sales_note,photo_link=evidence.photo_link,photo_name=evidence.photo_name,
    date_completed=evidence.date_completed,app_tab_assignment=evidence.app_tab_assignment,
    last_updated=greatest(m.last_updated,new.last_updated,evidence.updated_at)
  where m.unique_id=new.unique_id;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);

  insert into public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,photo_link,photo_name,spec,caliper,loc_match_pct,av_note,pick_note,sales_note,updated_by,updated_at)
  values(new.unique_id,coalesce(new.source,''),new.itemcode,new.locationcode,coalesce(new.lotcode,''),new.photo_link,new.photo_name,new.spec,new.caliper,new.loc_match_pct,new.av_note,new.pick_note,new.sales_note,auth.uid(),clock_timestamp())
  on conflict(unique_id) do update set source=excluded.source,itemcode=excluded.itemcode,locationcode=excluded.locationcode,lotcode=excluded.lotcode,photo_link=excluded.photo_link,photo_name=excluded.photo_name,spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,av_note=excluded.av_note,pick_note=excluded.pick_note,sales_note=excluded.sales_note,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION private.apply_inventory_location_evidence_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
  evidence_changed boolean:=false;
  source_row boolean:=false;
  current_qty numeric;
  active_evidence boolean:=false;
  guard_enabled boolean:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'')='on';
begin
  if nullif(btrim(coalesce(new.itemcode,'')),'') is null
    or nullif(btrim(coalesce(new.locationcode,'')),'') is null then return new; end if;
  if tg_op='UPDATE' and not guard_enabled then
    evidence_changed:=(new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
      is distinct from
      (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment);
    if private.ph_master_inventory_import_run_v1() is null and evidence_changed then return new; end if;
  end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=new.unique_id;
  if not found then return new; end if;
  source_row:=new.unique_id=evidence.source_unique_id;
  current_qty:=evidence.current_photo_match_qty;
  if source_row then
    current_qty:=coalesce(private.inventory_location_evidence_qty_v2(
      evidence.baseline_on_hand,evidence.initial_photo_match_qty,
      private.inventory_location_evidence_number_v2(new.ptronhand)
    ),current_qty);
  end if;
  active_evidence:=evidence.cleared_at is null
    and (evidence.expires_at is null or clock_timestamp()<=evidence.expires_at)
    and (evidence.initial_photo_match_qty is null or evidence.initial_photo_match_qty<=0 or coalesce(current_qty,0)>0);
  new.spec:=case when active_evidence then evidence.spec else null end;
  new.caliper:=evidence.caliper;
  new.match:=case when active_evidence then evidence.match else null end;
  new.loc_match_qty:=case when not active_evidence then null when source_row then current_qty::text
    else private.inventory_location_match_qty_v1(new.ptronhand,evidence.match,evidence.loc_match_qty) end;
  new.initial_ptr:=evidence.initial_ptr;
  new.av_note:=case when active_evidence then evidence.av_note else null end;
  new.pic_note:=case when active_evidence then evidence.pic_note else null end;
  new.sales_note:=case when active_evidence then evidence.sales_note else null end;
  new.photo_link:=case when active_evidence then evidence.photo_link else null end;
  new.photo_name:=case when active_evidence then evidence.photo_name else null end;
  new.date_completed:=case when active_evidence then evidence.date_completed else null end;
  new.app_tab_assignment:=evidence.app_tab_assignment;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION private.sync_master_inventory_canonical_v2362()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare evidence app_sync_private.inventory_location_evidence_v1%rowtype;
declare current_on_hand numeric;
declare canonical_baseline numeric;
declare canonical_match numeric;
declare canonical_initial numeric;
declare canonical_current numeric;
declare canonical_photo_date timestamptz;
declare canonical_expiry timestamptz;
declare canonical_photo_url text;
declare active_evidence boolean;
declare evidence_changed boolean:=false;
declare guard_enabled boolean:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'')='on';
begin
  if tg_op='UPDATE' and not guard_enabled
      and private.ph_master_inventory_import_run_v1() is null then
    evidence_changed:=(new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
      is distinct from
      (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment);
    if evidence_changed then return new; end if;
  end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.source_unique_id=new.unique_id;
  current_on_hand:=private.request_numeric_v2362(new.ptronhand);
  canonical_baseline:=coalesce(evidence.baseline_on_hand,new.baseline_on_hand,
    private.request_numeric_v2362(new.initial_ptr),current_on_hand);
  canonical_match:=coalesce(evidence.loc_match_pct,new.loc_match_pct,
    private.request_numeric_v2362(new.match));
  canonical_initial:=coalesce(evidence.initial_photo_match_qty,new.initial_photo_match_qty,
    case when canonical_baseline is not null and canonical_match between 0 and 100
      then round(canonical_baseline*canonical_match/100.0) end);
  canonical_current:=case
    when new.unique_id=evidence.source_unique_id
      or upper(btrim(coalesce(new.lotcode,'')))=upper(btrim(coalesce(evidence.source_lotcode,'')))
      then coalesce(private.inventory_location_evidence_qty_v2(
        canonical_baseline,canonical_initial,current_on_hand),evidence.current_photo_match_qty,
        new.loc_photo_match,private.request_numeric_v2362(new.loc_match_qty))
    else coalesce(evidence.current_photo_match_qty,new.loc_photo_match,
        private.request_numeric_v2362(new.loc_match_qty),
        private.inventory_location_evidence_qty_v2(canonical_baseline,canonical_initial,current_on_hand))
  end;
  -- v2379_non_source_evidence_qty
  canonical_photo_date:=coalesce(evidence.evaluated_at,new.photo_date,new.date_completed,
    new.av_rule_photo_updated_at,new.av_rule_bundle_updated_at);
  canonical_expiry:=coalesce(evidence.expires_at,new.photo_expires_at,
    private.inventory_location_evidence_expiry_v2(canonical_photo_date));
  canonical_photo_url:=coalesce(nullif(btrim(coalesce(new.photo_url,'')),''),
    nullif(btrim(coalesce(evidence.photo_link,'')),''),nullif(btrim(coalesce(new.photo_link,'')),''));
  active_evidence:=evidence.cleared_at is null
    and coalesce(canonical_current,0)>0
    and (canonical_expiry is null or clock_timestamp()<=canonical_expiry)
    and coalesce(canonical_photo_url,nullif(btrim(coalesce(new.spec,'')),''),
      nullif(btrim(coalesce(evidence.spec,'')),''),nullif(btrim(coalesce(new.caliper,'')),''),
      nullif(btrim(coalesce(evidence.caliper,'')),''),nullif(btrim(coalesce(new.match,'')),''),
      nullif(btrim(coalesce(evidence.match,'')),''),nullif(btrim(coalesce(new.av_note,'')),''),
      nullif(btrim(coalesce(evidence.av_note,'')),''),nullif(btrim(coalesce(new.pic_note,'')),''),
      nullif(btrim(coalesce(evidence.pic_note,'')),''),nullif(btrim(coalesce(new.sales_note,'')),''),
      nullif(btrim(coalesce(evidence.sales_note,'')),'')) is not null;
  new.baseline_on_hand:=canonical_baseline;
  new.loc_match_pct:=canonical_match;
  new.initial_photo_match_qty:=canonical_initial;
  new.photo_expires_at:=canonical_expiry;
  if active_evidence then
    new.loc_photo_match:=canonical_current;
    new.photo_url:=canonical_photo_url;
    new.photo_date:=canonical_photo_date;
    new.photos:=private.request_photo_array_v2362(new.photos,canonical_photo_url,
      coalesce(evidence.photo_name,new.photo_name));
    new.pick_note:=coalesce(nullif(new.pick_note,''),nullif(evidence.pic_note,''),nullif(new.pic_note,''));
    new.spec:=coalesce(nullif(new.spec,''),nullif(evidence.spec,''));
    new.caliper:=coalesce(nullif(new.caliper,''),nullif(evidence.caliper,''));
    new.av_note:=coalesce(nullif(new.av_note,''),nullif(evidence.av_note,''));
    new.sales_note:=coalesce(nullif(new.sales_note,''),nullif(evidence.sales_note,''));
  else
    new.photos:='[]'::jsonb;
    new.photo_url:=null;
    new.photo_date:=case
      when nullif(btrim(concat_ws(',',new.photo_link,new.dock_photo_link,new.flyer_photo_link)),'') is not null
      then coalesce(canonical_photo_date,new.date_completed,new.last_updated)
      else null
    end;
    new.spec:=null;
    new.caliper:=null;
    new.loc_match_pct:=null;
    new.baseline_on_hand:=null;
    new.initial_photo_match_qty:=null;
    new.loc_photo_match:=null;
    new.pick_note:=null;
    new.av_note:=null;
    new.sales_note:=null;
    new.photo_expires_at:=null;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION suspend_tag_private.command(p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles; s public.ph_soc_master; edited public.ph_soc_master; w suspend_tag_private.workflows;
  a suspend_tag_private.approvals; receipt suspend_tag_private.commands; input jsonb; result jsonb; patch jsonb;
  uid text; was_denied boolean; event_id uuid; approval_id uuid; decision text;
begin
  actor:=suspend_tag_private.actor(p_actor_id);
  if p_operation='approval' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion')) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','canDecide',(a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)) and a.status='pending'
      and exists(select 1 from suspend_tag_private.workflows x join public.ph_soc_master r on r.unique_id=x.source_uid
        where x.current_approval_id=a.id and x.status='awaiting_rep' and r.last_updated is not distinct from a.source_revision and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') and regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in ('ADMIN','ADMINISTRATOR','MANAGER','EVALUATOR','INVENTORY','INVENTORYMANAGER') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
  if p_operation='rows' then
    return jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]') from public.ph_soc_master r
      where r.unique_id in (select jsonb_array_elements_text(p_payload->'ids')) and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_command_id is null then raise exception 'SUSPEND_TAG_COMMAND_REQUIRED' using errcode='22023'; end if;
  input:=jsonb_build_object('operation',p_operation,'payload',p_payload,'version',p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended('suspend-tag-v2:'||actor.id||':'||p_command_id,0));
  select * into receipt from suspend_tag_private.commands where actor_id=actor.id and command_id=p_command_id;
  if found then
    if receipt.request<>input then raise exception 'SUSPEND_TAG_TOKEN_CONFLICT' using errcode='22023'; end if;
    return receipt.response;
  end if;
  uid:=case when p_operation in ('save','complete') then suspend_tag_private.resolve_edit_source_v23107(p_payload) else p_payload->>'sourceUid' end;
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    uid:=a.source_uid;
  end if;
  if p_operation in ('save','complete') then
    perform pg_advisory_xact_lock(hashtextextended('suspend-tag-review-item:'||r.itemcode,0))
      from public.ph_soc_master r where r.unique_id=uid;
  end if;
  select * into s from public.ph_soc_master where unique_id=uid for update;
  if not found or not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
  insert into suspend_tag_private.workflows(source_uid,source_revision) values(uid,s.last_updated) on conflict do nothing;
  select * into w from suspend_tag_private.workflows where source_uid=uid for update;
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=a.id for update;
    decision:=p_payload->>'decision';
    if decision not in ('approve','deny') or decision is null then raise exception 'SUSPEND_TAG_DECISION_INVALID' using errcode='22023'; end if;
    if a.source_revision is distinct from s.last_updated or w.current_approval_id is distinct from a.id then raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='PT409'; end if;
    if a.status<>'pending' then
      if a.status<>(case when decision='approve' then 'approved' else 'denied' end) then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='PT409'; end if;
    else
      update suspend_tag_private.approvals set status=case when decision='approve' then 'approved' else 'denied' end,decided_at=now(),decided_by=actor.id where id=a.id returning * into a;
      update suspend_tag_private.workflows set status=a.status,version=version+1,updated_at=now() where source_uid=uid;
      if decision='deny' then update public.ph_soc_master set date_completed=null where unique_id=uid; end if;
      insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
        values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),now()) returning public.ph_request_delivery_outbox.event_id into event_id;
      update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;
    end if;
    result:=jsonb_build_object('ok',true,'decision',a.status,'approvalId',a.id);
  else
    if p_operation not in ('save','complete') and (not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz) then raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='PT409'; end if;
    if p_operation not in ('save','complete') and p_expected_version is not null and w.version<>p_expected_version then raise exception 'SUSPEND_TAG_VERSION_CHANGED' using errcode='PT409'; end if;
    if w.source_revision is distinct from s.last_updated then
      update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
      update suspend_tag_private.workflows set source_revision=s.last_updated,status='pending',completed_by=null,completed_at=null,current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
    end if;
    if p_operation in ('save','complete') then
      if w.status in ('awaiting_rep','approved') then
        update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
        update suspend_tag_private.workflows set status='pending',current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
      end if;
      was_denied:=w.status='denied'; patch:=coalesce(p_payload->'patch','{}');
      if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) k where k<>all(array['dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','av_note','match','loc_match_qty','initial_ptr'])) then raise exception 'SUSPEND_TAG_FIELD_FORBIDDEN' using errcode='42501'; end if;
      -- Preserve concurrent photos while allowing field edits on the latest locked source.
      if patch ? 'dock_photo_link' then
        patch:=jsonb_set(patch,'{dock_photo_link}',to_jsonb(coalesce((select string_agg(distinct btrim(link),',') from unnest(string_to_array(concat_ws(',',nullif(s.dock_photo_link,''),nullif(patch->>'dock_photo_link','')),',')) link where btrim(link)<>''),'')),true);
      end if;
      edited:=jsonb_populate_record(s,patch);
      if p_operation='complete' then edited:=suspend_tag_private.existing_review(edited); end if;
      if p_operation='complete' then perform suspend_tag_private.validate_review(edited); end if;
      update public.ph_soc_master set dock_spec=edited.dock_spec,dock_caliper=edited.dock_caliper,dock_note=edited.dock_note,
        dock_photo_link=edited.dock_photo_link,dock_photo_name=edited.dock_photo_name,av_note=edited.av_note,match=edited.match,
        loc_match_qty=edited.loc_match_qty,initial_ptr=edited.initial_ptr where unique_id=uid returning * into s;
      -- Share evidence only; each physical tag keeps its own completion/approval state.
      update public.ph_soc_master sibling set
        dock_photo_link=coalesce(nullif(s.dock_photo_link,''),sibling.dock_photo_link),
        dock_photo_name=coalesce(nullif(s.dock_photo_name,''),sibling.dock_photo_name),
        dock_spec=coalesce(nullif(s.dock_spec,''),sibling.dock_spec),
        av_note=coalesce(nullif(s.av_note,''),sibling.av_note),
        match=coalesce(nullif(s.match,''),sibling.match)
      where sibling.itemcode=s.itemcode and sibling.unique_id<>uid
        and sibling.locationcode=s.locationcode and coalesce(sibling.lotcode,'')=coalesce(s.lotcode,'') and coalesce(sibling.source,'')=coalesce(s.source,'')
        and suspend_tag_private.eligible(sibling.suspend,sibling.suspend_to)
        and sibling.date_completed is null
        and not exists(select 1 from suspend_tag_private.workflows locked
          where locked.source_uid=sibling.unique_id and locked.status in ('awaiting_rep','approved'));
      -- Sync only the exact inventory identity; lifecycle state stays in Suspend Tag.
      update public.ph_master_inventory m set spec=coalesce(nullif(s.dock_spec,''),m.spec),caliper=coalesce(nullif(s.dock_caliper,''),m.caliper),
        av_note=coalesce(nullif(s.av_note,''),m.av_note),match=coalesce(nullif(s.match,''),m.match),
        photo_link=coalesce(nullif(s.dock_photo_link,''),m.photo_link),photo_name=coalesce(nullif(s.dock_photo_name,''),m.photo_name),
        loc_match_qty=coalesce(nullif(s.loc_match_qty,''),m.loc_match_qty),initial_ptr=coalesce(nullif(s.initial_ptr,''),m.initial_ptr)
        where m.unique_id=(select candidate.unique_id from public.ph_master_inventory candidate
          where regexp_replace(rtrim(upper(candidate.itemcode),'.'),'[.]1$','')=regexp_replace(rtrim(upper(s.itemcode),'.'),'[.]1$','')
            and candidate.locationcode=s.locationcode and not suspend_tag_private.is_false_block_v2378(candidate.locationcode)
            and (nullif(p_payload->'sourceIdentity'->>'masterUid','') is null or candidate.unique_id=p_payload->'sourceIdentity'->>'masterUid')
            and (nullif(p_payload->'sourceIdentity'->>'masterUid','') is not null or (candidate.lotcode=s.lotcode and upper(coalesce(candidate.source,''))=upper(coalesce(s.source,''))))
          order by (coalesce(candidate.lotcode,'')=coalesce(s.lotcode,'')) desc,
            private.reclass_numeric_v1(candidate.ptronhand) desc nulls last,candidate.unique_id limit 1);
      -- location-sales-notes-v2390: exact item/location/lot evidence, never a fallback location.
      insert into public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,photo_link,photo_name,spec,caliper,
        loc_match_pct,av_note,pick_note,sales_note,updated_by,updated_at)
      select m.unique_id,coalesce(m.source,''),m.itemcode,m.locationcode,coalesce(m.lotcode,''),m.photo_link,m.photo_name,m.spec,m.caliper,
        private.reclass_numeric_v1(m.match),m.av_note,m.pick_note,m.sales_note,p_actor_id,clock_timestamp()
      from public.ph_master_inventory m
      where m.unique_id=(select candidate.unique_id from public.ph_master_inventory candidate
          where regexp_replace(rtrim(upper(candidate.itemcode),'.'),'[.]1$','')=regexp_replace(rtrim(upper(s.itemcode),'.'),'[.]1$','')
            and candidate.locationcode=s.locationcode and not suspend_tag_private.is_false_block_v2378(candidate.locationcode)
            and (nullif(p_payload->'sourceIdentity'->>'masterUid','') is null or candidate.unique_id=p_payload->'sourceIdentity'->>'masterUid')
            and (nullif(p_payload->'sourceIdentity'->>'masterUid','') is not null or (candidate.lotcode=s.lotcode and upper(coalesce(candidate.source,''))=upper(coalesce(s.source,''))))
          order by (coalesce(candidate.lotcode,'')=coalesce(s.lotcode,'')) desc,
            private.reclass_numeric_v1(candidate.ptronhand) desc nulls last,candidate.unique_id limit 1)
      order by m.unique_id limit 1
      on conflict(unique_id) do update set photo_link=excluded.photo_link,photo_name=excluded.photo_name,
        spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,av_note=excluded.av_note,
        pick_note=excluded.pick_note,sales_note=excluded.sales_note,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
      if p_operation='complete' then
        update public.ph_soc_master set date_completed=clock_timestamp() where unique_id=uid returning * into s;
        update suspend_tag_private.workflows set status='completed',completed_by=actor.id,completed_at=s.date_completed,version=version+1,updated_at=now() where source_uid=uid;
        if was_denied then approval_id:=suspend_tag_private.request_approval(uid); end if;
      end if;
    elsif p_operation='send' then
      approval_id:=suspend_tag_private.request_approval(uid);
    elsif p_operation='retry' then
      if w.current_approval_id is null then raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023'; end if;
      update public.ph_request_delivery_outbox as outbox set status='pending',next_attempt_at=now(),sanitized_error_code=null
        where outbox.event_id in(select request_event_id from suspend_tag_private.approvals where id=w.current_approval_id) and outbox.status='failed';
    else raise exception 'SUSPEND_TAG_OPERATION_INVALID' using errcode='22023';
    end if;
    result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
  end if;
  insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result);
  return result;
end $function$;

-- Repair only the confirmed copied Hetzi bundle; retain the source F1 row.
select set_config('gnc.inventory_location_evidence_apply','on',true);
update public.ph_master_inventory m set photo_link=null,photo_name=null,photo_url=null,photos='[]'::jsonb,photo_date=null,photo_expires_at=null,spec=null,match=null,loc_match_pct=null,loc_match_qty=null,loc_photo_match=null,initial_ptr=null,baseline_on_hand=null,initial_photo_match_qty=null,date_completed=null,av_rule_photo_updated_at=null,av_rule_spec_updated_at=null,av_rule_match_updated_at=null,last_updated=clock_timestamp()
from public.ph_master_inventory f
where f.itemcode='000180.008.1' and f.locationcode='L.05.000' and f.lotcode='28.F1' and f.source='LD'
and m.itemcode=f.itemcode and m.locationcode=f.locationcode and m.unique_id<>f.unique_id
and m.lotcode in ('28.S1','26.U3','27.U3','27.Y','28.Y','Y')
and m.photo_link=f.photo_link and m.spec=f.spec and m.match=f.match;
select set_config('gnc.inventory_location_evidence_apply','',true);
insert into public.ph_location_sales_notes(unique_id,source,itemcode,locationcode,lotcode,photo_link,photo_name,spec,caliper,loc_match_pct,av_note,pick_note,sales_note,updated_at)
select unique_id,source,itemcode,locationcode,lotcode,photo_link,photo_name,spec,caliper,loc_match_pct,av_note,pick_note,sales_note,clock_timestamp() from public.ph_master_inventory where itemcode='000180.008.1' and locationcode='L.05.000'
on conflict(unique_id) do update set photo_link=excluded.photo_link,photo_name=excluded.photo_name,spec=excluded.spec,loc_match_pct=excluded.loc_match_pct,updated_at=excluded.updated_at;
notify pgrst,'reload schema';
commit;
