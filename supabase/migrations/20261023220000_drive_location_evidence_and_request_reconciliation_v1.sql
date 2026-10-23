begin;
set local lock_timeout='1s';
set local statement_timeout='20s';

create table if not exists app_sync_private.inventory_location_evidence_v1 (
  itemcode_key text not null,
  locationcode_key text not null,
  itemcode text not null,
  locationcode text not null,
  source_unique_id text,
  spec text,
  caliper text,
  match text,
  loc_match_qty text,
  initial_ptr text,
  av_note text,
  pic_note text,
  sales_note text,
  photo_link text,
  photo_name text,
  date_completed timestamptz,
  app_tab_assignment text,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by text not null,
  primary key(itemcode_key,locationcode_key)
);
alter table app_sync_private.inventory_location_evidence_v1 enable row level security;
revoke all on app_sync_private.inventory_location_evidence_v1 from public,anon,authenticated;

insert into app_sync_private.inventory_location_evidence_v1(
  itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,
  spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,
  photo_link,photo_name,date_completed,app_tab_assignment,updated_at,updated_by
)
select itemcode_key,locationcode_key,itemcode,locationcode,unique_id,
  spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,
  photo_link,photo_name,date_completed,app_tab_assignment,updated_at,'legacy-location-evidence'
from (
  select upper(btrim(itemcode)) itemcode_key,upper(btrim(locationcode)) locationcode_key,
    (array_agg(itemcode order by evidence_at desc nulls last,unique_id))[1] itemcode,
    (array_agg(locationcode order by evidence_at desc nulls last,unique_id))[1] locationcode,
    (array_agg(unique_id order by evidence_at desc nulls last,unique_id))[1] unique_id,
    (array_agg(spec order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(spec),'') is not null))[1] spec,
    (array_agg(caliper order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(caliper),'') is not null))[1] caliper,
    (array_agg(match order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(match),'') is not null))[1] match,
    (array_agg(loc_match_qty order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(loc_match_qty),'') is not null))[1] loc_match_qty,
    (array_agg(initial_ptr order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(initial_ptr),'') is not null))[1] initial_ptr,
    (array_agg(av_note order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(av_note),'') is not null))[1] av_note,
    (array_agg(pic_note order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(pic_note),'') is not null))[1] pic_note,
    (array_agg(sales_note order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(sales_note),'') is not null))[1] sales_note,
    (array_agg(photo_link order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(photo_link),'') is not null))[1] photo_link,
    (array_agg(photo_name order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(photo_name),'') is not null))[1] photo_name,
    (array_agg(date_completed order by evidence_at desc nulls last,unique_id) filter(where date_completed is not null))[1] date_completed,
    (array_agg(app_tab_assignment order by evidence_at desc nulls last,unique_id) filter(where nullif(btrim(app_tab_assignment),'') is not null))[1] app_tab_assignment,
    coalesce(max(evidence_at),clock_timestamp()) updated_at
  from (
    select m.*,coalesce(av_rule_bundle_updated_at,av_rule_photo_updated_at,date_completed,last_updated) evidence_at
    from public.ph_master_inventory m
  ) m
  where nullif(btrim(coalesce(itemcode,'')),'') is not null
    and nullif(btrim(coalesce(locationcode,'')),'') is not null
    and coalesce(nullif(btrim(spec),''),nullif(btrim(caliper),''),nullif(btrim(match),''),
      nullif(btrim(loc_match_qty),''),nullif(btrim(initial_ptr),''),nullif(btrim(av_note),''),
      nullif(btrim(pic_note),''),nullif(btrim(sales_note),''),nullif(btrim(photo_link),''),
      nullif(btrim(photo_name),''),date_completed::text,nullif(btrim(app_tab_assignment),'')) is not null
  group by upper(btrim(itemcode)),upper(btrim(locationcode))
) seeded
on conflict(itemcode_key,locationcode_key) do nothing;

create or replace function private.inventory_location_match_qty_v1(p_on_hand text,p_match text,p_fallback text)
returns text language sql immutable set search_path='' as $fn$
  select case
    when nullif(btrim(coalesce(p_on_hand,'')),'') ~ '^-?[0-9]+([.][0-9]+)?$'
      and nullif(btrim(coalesce(p_match,'')),'') ~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$'
      then round(btrim(p_on_hand)::numeric*btrim(p_match)::numeric/100)::text
    else nullif(btrim(coalesce(p_fallback,'')),'')
  end;
$fn$;

create or replace function private.apply_inventory_location_evidence_v1()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  evidence app_sync_private.inventory_location_evidence_v1%rowtype;
  evidence_changed boolean:=false;
begin
  if current_setting('gnc.inventory_location_evidence_apply',true)='on' then return new; end if;
  if nullif(btrim(coalesce(new.itemcode,'')),'') is null
    or nullif(btrim(coalesce(new.locationcode,'')),'') is null then return new; end if;
  if tg_op='UPDATE' then
    evidence_changed:=(new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
      is distinct from
      (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment);
    if private.ph_master_inventory_import_run_v1() is null and evidence_changed then return new; end if;
  end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.itemcode_key=upper(btrim(new.itemcode)) and e.locationcode_key=upper(btrim(new.locationcode));
  if not found then return new; end if;
  new.spec:=evidence.spec;
  new.caliper:=evidence.caliper;
  new.match:=evidence.match;
  new.loc_match_qty:=private.inventory_location_match_qty_v1(new.ptronhand,evidence.match,evidence.loc_match_qty);
  new.initial_ptr:=evidence.initial_ptr;
  new.av_note:=evidence.av_note;
  new.pic_note:=evidence.pic_note;
  new.sales_note:=evidence.sales_note;
  new.photo_link:=evidence.photo_link;
  new.photo_name:=evidence.photo_name;
  new.date_completed:=evidence.date_completed;
  new.app_tab_assignment:=evidence.app_tab_assignment;
  return new;
end
$fn$;

create or replace function private.capture_inventory_location_evidence_v1()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
  actor text:=coalesce(nullif(current_setting('gnc.inventory_edit_actor',true),''),auth.uid()::text,'system');
begin
  if private.ph_master_inventory_import_run_v1() is not null or previous_guard='on' then return new; end if;
  if (new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,
      new.pic_note,new.sales_note,new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment)
    is not distinct from
    (old.spec,old.caliper,old.match,old.loc_match_qty,old.initial_ptr,old.av_note,
      old.pic_note,old.sales_note,old.photo_link,old.photo_name,old.date_completed,old.app_tab_assignment) then return new; end if;
  insert into app_sync_private.inventory_location_evidence_v1 as evidence(
    itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,
    spec,caliper,match,loc_match_qty,initial_ptr,av_note,pic_note,sales_note,
    photo_link,photo_name,date_completed,app_tab_assignment,updated_at,updated_by
  ) values(
    upper(btrim(new.itemcode)),upper(btrim(new.locationcode)),new.itemcode,new.locationcode,new.unique_id,
    new.spec,new.caliper,new.match,new.loc_match_qty,new.initial_ptr,new.av_note,new.pic_note,new.sales_note,
    new.photo_link,new.photo_name,new.date_completed,new.app_tab_assignment,clock_timestamp(),actor
  ) on conflict(itemcode_key,locationcode_key) do update set
    itemcode=excluded.itemcode,locationcode=excluded.locationcode,source_unique_id=excluded.source_unique_id,
    spec=excluded.spec,caliper=excluded.caliper,match=excluded.match,loc_match_qty=excluded.loc_match_qty,
    initial_ptr=excluded.initial_ptr,av_note=excluded.av_note,pic_note=excluded.pic_note,sales_note=excluded.sales_note,
    photo_link=excluded.photo_link,photo_name=excluded.photo_name,date_completed=excluded.date_completed,
    app_tab_assignment=excluded.app_tab_assignment,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  update public.ph_master_inventory m set
    spec=new.spec,caliper=new.caliper,match=new.match,
    loc_match_qty=private.inventory_location_match_qty_v1(m.ptronhand,new.match,new.loc_match_qty),
    initial_ptr=new.initial_ptr,av_note=new.av_note,pic_note=new.pic_note,sales_note=new.sales_note,
    photo_link=new.photo_link,photo_name=new.photo_name,date_completed=new.date_completed,
    app_tab_assignment=new.app_tab_assignment,last_updated=greatest(m.last_updated,new.last_updated)
  where upper(btrim(m.itemcode))=upper(btrim(new.itemcode))
    and upper(btrim(m.locationcode))=upper(btrim(new.locationcode));
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  return new;
end
$fn$;

revoke all on function private.inventory_location_match_qty_v1(text,text,text) from public,anon,authenticated;
revoke all on function private.apply_inventory_location_evidence_v1() from public,anon,authenticated;
revoke all on function private.capture_inventory_location_evidence_v1() from public,anon,authenticated;
drop trigger if exists zzz_inventory_location_evidence_apply on public.ph_master_inventory;
create trigger zzz_inventory_location_evidence_apply before insert or update on public.ph_master_inventory
for each row execute function private.apply_inventory_location_evidence_v1();
drop trigger if exists zzzz_inventory_location_evidence_capture on public.ph_master_inventory;
create trigger zzzz_inventory_location_evidence_capture after update of spec,caliper,match,loc_match_qty,initial_ptr,
  av_note,pic_note,sales_note,photo_link,photo_name,date_completed,app_tab_assignment on public.ph_master_inventory
for each row execute function private.capture_inventory_location_evidence_v1();

create or replace function public.reconcile_inventory_location_evidence_v1()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  affected integer:=0;
  previous_guard text:=coalesce(current_setting('gnc.inventory_location_evidence_apply',true),'');
begin
  perform set_config('gnc.inventory_location_evidence_apply','on',true);
  update public.ph_master_inventory m set
    spec=e.spec,caliper=e.caliper,match=e.match,
    loc_match_qty=private.inventory_location_match_qty_v1(m.ptronhand,e.match,e.loc_match_qty),
    initial_ptr=e.initial_ptr,av_note=e.av_note,pic_note=e.pic_note,sales_note=e.sales_note,
    photo_link=e.photo_link,photo_name=e.photo_name,date_completed=e.date_completed,
    app_tab_assignment=e.app_tab_assignment,last_updated=greatest(m.last_updated,e.updated_at)
  from app_sync_private.inventory_location_evidence_v1 e
  where e.itemcode_key=upper(btrim(m.itemcode)) and e.locationcode_key=upper(btrim(m.locationcode))
    and (m.spec,m.caliper,m.match,m.loc_match_qty,m.initial_ptr,m.av_note,m.pic_note,m.sales_note,
      m.photo_link,m.photo_name,m.date_completed,m.app_tab_assignment) is distinct from
      (e.spec,e.caliper,e.match,private.inventory_location_match_qty_v1(m.ptronhand,e.match,e.loc_match_qty),
      e.initial_ptr,e.av_note,e.pic_note,e.sales_note,e.photo_link,e.photo_name,e.date_completed,e.app_tab_assignment);
  get diagnostics affected=row_count;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  return jsonb_build_object('ok',true,'affected',affected);
end
$fn$;
revoke all on function public.reconcile_inventory_location_evidence_v1() from public,anon,authenticated;
grant execute on function public.reconcile_inventory_location_evidence_v1() to service_role;

create or replace function public.save_drive_evidence_v3(
  p_master_uid text,p_expected_itemcode text,p_expected_locationcode text,p_expected_lotcode text,
  p_expected_signature text,p_baseline jsonb,p_evidence jsonb,p_complete boolean,
  p_workflow text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $fn$
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
  actor:=private.require_active_admin_profile();
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
    or not pg_try_advisory_xact_lock(hashtextextended('drive-location:'||stable_item||':'||stable_location,0)) then
    return jsonb_build_object('ok',false,'code','DRIVE_SAVE_BUSY','canonicalConfirmed',false,'retryAfterMs',250,'retryBlocked',false);
  end if;
  select * into current_row from public.ph_master_inventory m
  where upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location
  order by (m.unique_id=btrim(coalesce(p_master_uid,''))) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  if not found then return jsonb_build_object('ok',false,'code','DRIVE_ROW_NOT_FOUND','canonicalConfirmed',true,'retryBlocked',false); end if;
  select * into evidence from app_sync_private.inventory_location_evidence_v1 e
  where e.itemcode_key=stable_item and e.locationcode_key=stable_location;
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
  on conflict(itemcode_key,locationcode_key) do update set
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
  where upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location;
  perform set_config('gnc.inventory_location_evidence_apply',previous_guard,true);
  select * into saved_row from public.ph_master_inventory m
  where upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location
  order by (m.unique_id=btrim(coalesce(p_master_uid,''))) desc,
    (upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_expected_lotcode,'')))) desc,
    m.last_updated desc nulls last,m.unique_id limit 1;
  select coalesce(jsonb_agg(to_jsonb(m) order by private.eval_work_natural_sort_key_v1(m.locationcode),private.eval_work_natural_sort_key_v1(m.lotcode),m.unique_id),'[]'::jsonb)
    into location_rows from public.ph_master_inventory m
    where upper(btrim(m.itemcode))=stable_item and upper(btrim(m.locationcode))=stable_location;
  with changed as (
    update public.ph_active_request request set
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
      and coalesce(request.req_archived,false)=false
      and lower(btrim(coalesce(request.req_status,'pending'))) not in ('complete','completed','done','archived','cancelled','canceled')
    returning request.*
  ) select coalesce(jsonb_agg(to_jsonb(changed) order by changed.unique_id),'[]'::jsonb) into request_rows from changed;
  response:=jsonb_build_object('ok',true,'code','SAVED','contractVersion','save-drive-evidence-v3-location-overlay',
    'row',to_jsonb(saved_row),'locationRows',location_rows,'requestRows',request_rows,'completed',coalesce(p_complete,false),
    'canonicalConfirmed',true,'mergedUnrelatedChanges',true,'retryBlocked',false,'recovered',false);
  insert into private.drive_evidence_idempotency(profile_id,idempotency_key,request_hash,response_payload,outcome_code)
  values(actor.id,storage_key,request_hash,response,'SAVED');
  return response;
end
$fn$;
revoke all on function public.save_drive_evidence_v3(text,text,text,text,text,jsonb,jsonb,boolean,text,text) from public,anon;
grant execute on function public.save_drive_evidence_v3(text,text,text,text,text,jsonb,jsonb,boolean,text,text) to authenticated,service_role;

create table if not exists app_sync_private.request_lifecycle_tombstones_v1(
  unique_id text primary key,
  terminal_state text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table app_sync_private.request_lifecycle_tombstones_v1 enable row level security;
revoke all on app_sync_private.request_lifecycle_tombstones_v1 from public,anon,authenticated;

insert into app_sync_private.request_lifecycle_tombstones_v1(unique_id,terminal_state,recorded_at)
select unique_id,case when coalesce(req_archived,false) then 'archived' else 'completed' end,coalesce(updated_at,created_at,clock_timestamp())
from public.ph_active_request
where coalesce(req_archived,false) or nullif(btrim(coalesce(date_completed,'')),'') is not null
  or lower(btrim(coalesce(req_status,''))) in ('complete','completed','done','closed','archived','cancelled','canceled','removed')
on conflict(unique_id) do nothing;

with created as (
  select distinct r->>'unique_id' unique_id,max(o.created_at) created_at
  from public.ph_request_delivery_outbox o
  cross join lateral jsonb_array_elements(case when jsonb_typeof(o.payload->'requests')='array' then o.payload->'requests' else '[]'::jsonb end) r
  where o.event_type='request_created' and nullif(btrim(r->>'unique_id'),'') is not null
  group by r->>'unique_id'
)
insert into app_sync_private.request_lifecycle_tombstones_v1(unique_id,terminal_state,recorded_at)
select created.unique_id,'legacy-explicit-removal',created.created_at from created
left join public.ph_active_request active on active.unique_id=created.unique_id
where active.unique_id is null on conflict(unique_id) do nothing;

create or replace function private.capture_request_lifecycle_tombstone_v1()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  terminal text;
begin
  if tg_op='DELETE' then terminal:='deleted';
  elsif coalesce(new.req_archived,false) then terminal:='archived';
  elsif nullif(btrim(coalesce(new.date_completed,'')),'') is not null
    or lower(btrim(coalesce(new.req_status,''))) in ('complete','completed','done','closed','archived','cancelled','canceled','removed') then terminal:='completed';
  end if;
  if terminal is not null then
    insert into app_sync_private.request_lifecycle_tombstones_v1(unique_id,terminal_state)
    values(case when tg_op='DELETE' then old.unique_id else new.unique_id end,terminal)
    on conflict(unique_id) do update set terminal_state=excluded.terminal_state,recorded_at=clock_timestamp();
  elsif tg_op='UPDATE' then
    delete from app_sync_private.request_lifecycle_tombstones_v1 where unique_id=new.unique_id;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$fn$;
revoke all on function private.capture_request_lifecycle_tombstone_v1() from public,anon,authenticated;
drop trigger if exists capture_request_lifecycle_tombstone_v1 on public.ph_active_request;
create trigger capture_request_lifecycle_tombstone_v1 after update or delete on public.ph_active_request
for each row execute function private.capture_request_lifecycle_tombstone_v1();

create or replace function private.reconcile_active_requests_from_outbox_v1()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  candidate record;
  request_row public.ph_active_request%rowtype;
  inserted_count integer:=0;
  normalized_count integer:=0;
  skipped_count integer:=0;
  next_id bigint;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('request-created-outbox-reconciliation-v1',0)) then
    return jsonb_build_object('ok',true,'busy',true,'inserted',0,'normalized',0);
  end if;
  update public.ph_active_request set req_qty='1'
  where coalesce(req_archived,false)=false and nullif(btrim(coalesce(date_completed,'')),'') is null
    and coalesce(lower(nullif(btrim(req_status),'')),'pending') in ('pending','open')
    and nullif(btrim(coalesce(req_qty,'')),'') is null;
  get diagnostics normalized_count=row_count;
  select coalesce(max(id),0)+1 into next_id from public.ph_active_request;
  for candidate in
    with created as (
      select distinct on (r->>'unique_id') r request_payload,o.created_at
      from public.ph_request_delivery_outbox o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.payload->'requests')='array' then o.payload->'requests' else '[]'::jsonb end) r
      where o.event_type='request_created' and nullif(btrim(r->>'unique_id'),'') is not null
      order by r->>'unique_id',o.created_at desc
    ) select * from created c
    where coalesce(lower(nullif(btrim(c.request_payload->>'req_status'),'')),'pending') in ('pending','open')
      and coalesce((c.request_payload->>'req_archived')::boolean,false)=false
      and nullif(btrim(c.request_payload->>'date_completed'),'') is null
      and not exists(select 1 from public.ph_active_request a where a.unique_id=c.request_payload->>'unique_id')
      and not exists(select 1 from app_sync_private.request_lifecycle_tombstones_v1 t where t.unique_id=c.request_payload->>'unique_id')
    order by c.created_at,c.request_payload->>'unique_id'
  loop
    begin
      request_row:=jsonb_populate_record(null::public.ph_active_request,candidate.request_payload);
      if request_row.id is null or exists(select 1 from public.ph_active_request where id=request_row.id) then request_row.id:=next_id;next_id:=next_id+1; end if;
      request_row.req_qty:=coalesce(nullif(btrim(request_row.req_qty),''),'1');
      request_row.req_status:=coalesce(nullif(btrim(request_row.req_status),''),'Pending');
      request_row.req_archived:=false;
      request_row.date_completed:=null;
      request_row.row_version:=greatest(coalesce(request_row.row_version,1),1);
      request_row.created_at:=coalesce(request_row.created_at,candidate.created_at,clock_timestamp());
      request_row.updated_at:=greatest(coalesce(request_row.updated_at,request_row.created_at),request_row.created_at);
      insert into public.ph_active_request select (request_row).*
      on conflict(unique_id) do nothing;
      if found then inserted_count:=inserted_count+1; end if;
    exception when others then
      skipped_count:=skipped_count+1;
    end;
  end loop;
  return jsonb_build_object('ok',true,'busy',false,'inserted',inserted_count,'normalized',normalized_count,'skipped',skipped_count);
end
$fn$;
revoke all on function private.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
create or replace function public.reconcile_active_requests_from_outbox_v1()
returns jsonb language sql security definer set search_path='' as $fn$
  select private.reconcile_active_requests_from_outbox_v1();
$fn$;
revoke all on function public.reconcile_active_requests_from_outbox_v1() from public,anon,authenticated;
grant execute on function public.reconcile_active_requests_from_outbox_v1() to service_role;

do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.manager_report_read_v2(jsonb)'::regprocedure);
  if position('where preview_ordinal<=18 group by item_key' in definition)>0 then
    if position($anchor$'previewHasMore',surface='eval2' and coalesce(filters->>'groupBy','itemcode')='itemcode' and row_count>18$anchor$ in definition)=0 then
      raise exception 'MANAGER_EVAL2_PREVIEW_CAP_ANCHOR_INVALID';
    end if;
    definition:=replace(definition,
      $old$order by p.assignedto,
      case p.season_key when 'F1' then 1 when 'S1' then 2 when 'U1' then 3 when 'U2' then 4 when 'U3' then 5 when 'X' then 6 when 'Y' then 7 when 'Z' then 8 else 9 end,
      (p.sales_year=0),p.sales_year,private.eval_work_natural_sort_key_v1(p.locationcode),p.unique_id$old$,
      $new$order by private.eval_work_natural_sort_key_v1(p.locationcode),private.eval_work_natural_sort_key_v1(p.lotcode),p.unique_id$new$);
    definition:=replace(definition,'where preview_ordinal<=18 group by item_key','group by item_key');
    definition:=replace(definition,
      $old$'previewHasMore',surface='eval2' and coalesce(filters->>'groupBy','itemcode')='itemcode' and row_count>18$old$,
      $new$'previewHasMore',false$new$);
    if position('where preview_ordinal<=18 group by item_key' in definition)>0
      or position('private.eval_work_natural_sort_key_v1(p.lotcode)' in definition)=0 then
      raise exception 'MANAGER_EVAL2_PREVIEW_PATCH_INVALID';
    end if;
    execute definition;
  elsif position($anchor$'previewHasMore',false$anchor$ in definition)=0
    or position('private.eval_work_natural_sort_key_v1(p.lotcode)' in definition)=0 then
    raise exception 'MANAGER_EVAL2_PREVIEW_PATCH_STATE_INVALID';
  end if;
end
$migration$;

select public.reconcile_inventory_location_evidence_v1();
select private.reconcile_active_requests_from_outbox_v1();

revoke all on function public.manager_report_read_v2(jsonb) from public,anon,authenticated;
grant execute on function public.manager_report_read_v2(jsonb) to service_role;
commit;
