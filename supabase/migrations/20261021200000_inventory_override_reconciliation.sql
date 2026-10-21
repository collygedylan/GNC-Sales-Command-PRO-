begin;
set local lock_timeout='1s';
set local statement_timeout='15s';

-- Private durable audit, keyed by the canonical physical row; display fallbacks
-- never identify a mutation. Existing priority/Item6 lineage guards remain.
create table if not exists app_sync_private.inventory_live_overrides_v1 (
 canonical_unique_id text not null, field_name text not null,
 itemcode text, locationcode text, lotcode text,
 erp_baseline_value jsonb, app_override_value jsonb, latest_erp_value jsonb,
 pending boolean not null default true, updated_at timestamptz not null default now(),
 updated_by text not null, reconciled_at timestamptz,
 primary key(canonical_unique_id,field_name),
 check(field_name=any(array['priority','holdstopcode','holdstopreason','holdstopbegindate','holdstopenddate','ptronhand','ptravailable','ptrreviewed','locationnote','locationptn1','desigitem','desigcust','desigloc','pullerresponsibility','oversellpercentage','salesnote','suspend','spec','caliper','av_note','sales_note','match','loc_match_qty','photo_link','photo_name','pic_note','date_completed']))
);
alter table app_sync_private.inventory_live_overrides_v1 enable row level security;
revoke all on app_sync_private.inventory_live_overrides_v1 from public,anon,authenticated;

create or replace function private.inventory_override_matches_v1(p_field text,p_incoming jsonb,p_override jsonb)
returns boolean language plpgsql immutable set search_path='' as $fn$
declare incoming text:=nullif(btrim(p_incoming#>>'{}'),''); target text:=nullif(btrim(p_override#>>'{}'),'');
begin
 if p_field=any(array['priority','ptronhand','ptravailable','ptrreviewed','match','loc_match_qty','oversellpercentage'])
   and incoming ~ '^-?[0-9]+([.][0-9]+)?$' and target ~ '^-?[0-9]+([.][0-9]+)?$' then
   return incoming::numeric=target::numeric;
 end if;
 return incoming is not distinct from target;
end $fn$;

create or replace function private.reconcile_inventory_live_overrides_v1()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
 run_id uuid; canonical boolean:=false; incoming jsonb; result jsonb;
 field text; before_value jsonb; after_value jsonb; actor text;
 context_row app_sync_private.ph_master_bulk_import_context_v1;
 edit app_sync_private.inventory_live_overrides_v1;
begin
 run_id:=private.ph_master_inventory_import_run_v1();
 if tg_op='DELETE' then
   -- Missing ERP rows never erase an un-keyed in-app edit. Keep its physical UID.
   if run_id is not null and exists(select 1 from app_sync_private.inventory_live_overrides_v1 e
      where e.canonical_unique_id=old.unique_id and e.pending) then return null; end if;
   return old;
 end if;
 result:=to_jsonb(new);
 if run_id is not null then
   select 'ph_master_inventory'=any(r.canonical_keys) into canonical from app_sync_private.import_runs r where r.id=run_id;
   context_row:=private.ph_master_bulk_context_v1(run_id,new.unique_id);
   incoming:=context_row.raw_values;
   -- Only fenced raw Drive values can acknowledge an ERP field. Auxiliary CAV
   -- updates and omitted fields retain every active override without acknowledging it.
   if canonical and incoming is null then
     incoming:=to_jsonb(new);
     canonical:=false; -- legacy merged payloads are not proof of ERP acknowledgement
   end if;
   for edit in select * from app_sync_private.inventory_live_overrides_v1 e
      where e.canonical_unique_id=new.unique_id for update loop
     if canonical and incoming ? edit.field_name then
       if edit.pending and private.inventory_override_matches_v1(edit.field_name,incoming->edit.field_name,edit.app_override_value) then
         update app_sync_private.inventory_live_overrides_v1 e set pending=false,
           latest_erp_value=incoming->edit.field_name,reconciled_at=clock_timestamp()
           where e.canonical_unique_id=edit.canonical_unique_id and e.field_name=edit.field_name;
         result:=jsonb_set(result,array[edit.field_name],coalesce(incoming->edit.field_name,'null'::jsonb));
       elsif edit.pending then
         update app_sync_private.inventory_live_overrides_v1 e set latest_erp_value=incoming->edit.field_name
           where e.canonical_unique_id=edit.canonical_unique_id and e.field_name=edit.field_name;
         result:=jsonb_set(result,array[edit.field_name],coalesce(edit.app_override_value,'null'::jsonb));
       else
         -- After acknowledgement, later keyed ERP changes are authoritative.
         result:=jsonb_set(result,array[edit.field_name],coalesce(incoming->edit.field_name,'null'::jsonb));
       end if;
     elsif edit.pending then
       result:=jsonb_set(result,array[edit.field_name],coalesce(edit.app_override_value,'null'::jsonb));
     end if;
   end loop;
   new:=jsonb_populate_record(new,result);
   return new;
 end if;
 actor:=coalesce(nullif(current_setting('gnc.inventory_edit_actor',true),''),auth.uid()::text,
   nullif(current_setting('gnc.sales_rep_operation_actor',true),''),'system');
 foreach field in array array['priority','holdstopcode','holdstopreason','holdstopbegindate','holdstopenddate','ptronhand','ptravailable','ptrreviewed','locationnote','locationptn1','desigitem','desigcust','desigloc','pullerresponsibility','oversellpercentage','salesnote','suspend','spec','caliper','av_note','sales_note','match','loc_match_qty','photo_link','photo_name','pic_note','date_completed'] loop
   before_value:=case when tg_op='INSERT' then 'null'::jsonb else to_jsonb(old)->field end; after_value:=result->field;
   if before_value is distinct from after_value then
     insert into app_sync_private.inventory_live_overrides_v1 as e
       (canonical_unique_id,field_name,itemcode,locationcode,lotcode,erp_baseline_value,app_override_value,latest_erp_value,updated_by)
     values(new.unique_id,field,new.itemcode,new.locationcode,new.lotcode,before_value,after_value,before_value,actor)
     on conflict(canonical_unique_id,field_name) do update set
       erp_baseline_value=case when e.pending then e.erp_baseline_value else excluded.erp_baseline_value end,
       app_override_value=excluded.app_override_value,pending=true,reconciled_at=null,
       updated_by=excluded.updated_by,updated_at=clock_timestamp();
   end if;
 end loop;
 return new;
end $fn$;
revoke all on function private.inventory_override_matches_v1(text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function private.reconcile_inventory_live_overrides_v1() from public,anon,authenticated;
drop trigger if exists zz_inventory_live_overrides on public.ph_master_inventory;
create trigger zz_inventory_live_overrides before insert or update on public.ph_master_inventory
for each row execute function private.reconcile_inventory_live_overrides_v1();
drop trigger if exists aa00_inventory_override_delete on public.ph_master_inventory;
create trigger aa00_inventory_override_delete before delete on public.ph_master_inventory
for each row execute function private.reconcile_inventory_live_overrides_v1();

-- Retain existing pending edits; never manufacture a past actor or edit time.
insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,itemcode,locationcode,lotcode,
 erp_baseline_value,app_override_value,latest_erp_value,updated_by,updated_at)
select m.unique_id,f.name,m.itemcode,m.locationcode,m.lotcode,to_jsonb(b)->f.name,to_jsonb(m)->f.name,to_jsonb(b)->f.name,
 'legacy',e.updated_at from app_sync_private.ph_master_inventory_app_edits e
 join public.ph_master_inventory m on m.unique_id=e.canonical_unique_id
 join app_sync_private.ph_master_inventory_source_baselines b on b.canonical_unique_id=m.unique_id
 cross join unnest(array['priority','holdstopcode','holdstopreason']) f(name)
 where e.pending_legacy_sync on conflict do nothing;
insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,itemcode,locationcode,lotcode,
 erp_baseline_value,app_override_value,latest_erp_value,updated_by,updated_at)
select m.unique_id,e.field_name,m.itemcode,m.locationcode,m.lotcode,to_jsonb(e.source_value),to_jsonb(e.app_value),to_jsonb(e.source_value),
 'legacy',e.updated_at from app_sync_private.ph_master_inventory_item6_edits_v7 e
 join public.ph_master_inventory m on m.unique_id=e.canonical_unique_id where e.pending on conflict do nothing;
-- Existing app-only evidence has no ERP acknowledgement column. Preserve it,
-- including through a priority/designation alias or auxiliary CAV import.
insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,itemcode,locationcode,lotcode,
 erp_baseline_value,app_override_value,latest_erp_value,updated_by)
select m.unique_id,f.name,m.itemcode,m.locationcode,m.lotcode,'null'::jsonb,to_jsonb(m)->f.name,'null'::jsonb,'legacy'
 from public.ph_master_inventory m cross join unnest(array['spec','caliper','av_note','sales_note','match','loc_match_qty','photo_link','photo_name','pic_note','date_completed']) f(name)
 where nullif(nullif(btrim(to_jsonb(m)->>f.name),''),'NULL') is not null on conflict do nothing;

CREATE OR REPLACE FUNCTION private.resolve_ph_master_inventory_item6_alias_v7()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run_id uuid;
  canonical_run boolean := false;
  stable_key text;
  v6_key text;
  candidate_uid text;
  candidates integer;
  pending_candidates integer;
  incoming jsonb;
  baseline app_sync_private.ph_master_inventory_item6_source_v7;
  live public.ph_master_inventory;
  seen app_sync_private.ph_master_inventory_item6_alias_seen_v7;
  v_field_name text;
  incoming_value text;
  baseline_value text;
  live_value text;
  target_value text;
  mapped_uid text;
begin
  if tg_op='INSERT' and current_setting('gnc.master_snapshot_verified_insert',true)=pg_backend_pid()::text||':'||txid_current()::text then
    return new;
  end if;
  v_run_id := private.ph_master_inventory_import_run_v1();
  if v_run_id is null then return new; end if;
  select 'ph_master_inventory'=any(r.canonical_keys) into canonical_run
  from app_sync_private.import_runs r where r.id=v_run_id;
  if not canonical_run then
    return new;
  end if;

  v6_key := private.ph_master_inventory_lineage_key_v1(new);
  if exists(select 1 from app_sync_private.ph_master_inventory_source_baselines b
    join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id
    where b.lineage_key=v6_key) then
    return new;
  end if;

  stable_key := private.ph_master_inventory_stable_identity_v7(new);
  perform pg_advisory_xact_lock(hashtextextended('ph-master-item6:'||stable_key,0));
  select a.canonical_unique_id into mapped_uid
  from app_sync_private.ph_master_inventory_item6_aliases_v7 a
  where a.imported_unique_id=new.unique_id and a.stable_identity_key=stable_key;
  if mapped_uid is not null and mapped_uid is distinct from new.unique_id then
    select m.* into live from public.ph_master_inventory m where m.unique_id=mapped_uid for update;
    if live.unique_id is null then raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_CONFLICT'; end if;
    select * into seen from app_sync_private.ph_master_inventory_item6_alias_seen_v7 s
    where s.run_id=v_run_id and s.canonical_unique_id=mapped_uid;
    if seen.run_id is not null and seen.imported_unique_id is distinct from new.unique_id then
      raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
    end if;
    insert into app_sync_private.ph_master_inventory_item6_alias_seen_v7(run_id,canonical_unique_id,imported_unique_id,stable_identity_key)
    values(v_run_id,mapped_uid,new.unique_id,stable_key)
    on conflict(run_id,canonical_unique_id) do update set seen_at=clock_timestamp()
    where app_sync_private.ph_master_inventory_item6_alias_seen_v7.imported_unique_id=excluded.imported_unique_id;
    if not found then raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS'; end if;
    new.unique_id:=mapped_uid;
    return new;
  end if;
  -- Record exact canonical IDs too. If a later spreadsheet row presents a
  -- second UID for this same physical tuple in one run, the alias is ambiguous.
  if exists(select 1 from public.ph_master_inventory m where m.unique_id=new.unique_id) then
    select * into live from public.ph_master_inventory m where m.unique_id=new.unique_id for update;
    if exists(select 1
      from app_sync_private.ph_master_inventory_item6_source_v7 b
      join app_sync_private.ph_master_inventory_item6_edits_v7 e on e.canonical_unique_id=b.canonical_unique_id
      join public.ph_master_inventory protected on protected.unique_id=b.canonical_unique_id
      where b.stable_identity_key=stable_key and b.canonical_unique_id<>live.unique_id
        and e.pending and e.field_name in ('desigitem','desigcust','desigloc')) then
      raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
    end if;
    if exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
      where e.canonical_unique_id=live.unique_id and e.pending
        and e.field_name in ('desigitem','desigcust','desigloc')) then
      select * into seen from app_sync_private.ph_master_inventory_item6_alias_seen_v7 s
      where s.run_id=v_run_id and s.canonical_unique_id=live.unique_id;
      if seen.run_id is not null and seen.imported_unique_id is distinct from new.unique_id then
        raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
      end if;
      insert into app_sync_private.ph_master_inventory_item6_alias_seen_v7(
        run_id,canonical_unique_id,imported_unique_id,stable_identity_key
      ) values(v_run_id,live.unique_id,new.unique_id,stable_key)
      on conflict(run_id,canonical_unique_id) do update set seen_at=clock_timestamp()
      where app_sync_private.ph_master_inventory_item6_alias_seen_v7.imported_unique_id=excluded.imported_unique_id;
      if not found then raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS'; end if;
    end if;
    return new;
  end if;
  -- The stable tuple deliberately excludes the editable designations. Count
  -- every live row with that tuple before considering pending shields; a
  -- single shielded candidate is not enough proof when another row collides.
  select count(distinct b.canonical_unique_id)::integer into candidates
  from app_sync_private.ph_master_inventory_item6_source_v7 b
  join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id
  where b.stable_identity_key=stable_key;
  if candidates>1 then
    if exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b
      join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id
      where b.stable_identity_key=stable_key and (
        exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e where e.canonical_unique_id=m.unique_id and e.pending)
        or exists(select 1 from app_sync_private.ph_master_inventory_app_edits e where e.canonical_unique_id=m.unique_id and e.pending_legacy_sync)
        or exists(select 1 from app_sync_private.inventory_live_overrides_v1 e where e.canonical_unique_id=m.unique_id and e.pending)
      )) then raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS'; end if;
    -- No pending application state can be lost or mapped to the wrong sibling.
    -- Keep this incoming UID as a separate physical row; publication prunes only
    -- obsolete unprotected rows after every incoming row has been validated.
    return new;
  end if;
  select count(distinct b.canonical_unique_id)::integer into pending_candidates
  from app_sync_private.ph_master_inventory_item6_source_v7 b
  join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id
  where b.stable_identity_key=stable_key
    and exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
      where e.canonical_unique_id=b.canonical_unique_id and e.pending
        and e.field_name in ('desigitem','desigcust','desigloc'));
  if pending_candidates=0 then return new; end if;
  if pending_candidates>1 then
    raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
  end if;
  select b.* into baseline
  from app_sync_private.ph_master_inventory_item6_source_v7 b
  where b.stable_identity_key=stable_key
    and exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
      where e.canonical_unique_id=b.canonical_unique_id and e.pending
        and e.field_name in ('desigitem','desigcust','desigloc'))
  limit 1;
  select m.* into live
  from public.ph_master_inventory m
  where m.unique_id=baseline.canonical_unique_id
  limit 1 for update;
  candidate_uid := live.unique_id;
  incoming := jsonb_build_object('desigitem',new.desigitem,'desigcust',new.desigcust,'desigloc',new.desigloc);
  foreach v_field_name in array array['desigitem','desigcust','desigloc'] loop
    incoming_value := nullif(incoming->>v_field_name,'');
    baseline_value := nullif(baseline.field_values->>v_field_name,'');
    case v_field_name
      when 'desigitem' then live_value := nullif(live.desigitem,'');
      when 'desigcust' then live_value := nullif(live.desigcust,'');
      else live_value := nullif(live.desigloc,'');
    end case;
    select nullif(e.app_value,'') into target_value
    from app_sync_private.ph_master_inventory_item6_edits_v7 e
    where e.canonical_unique_id=candidate_uid and e.field_name=v_field_name and e.pending;
    if incoming_value is distinct from baseline_value
       and incoming_value is distinct from live_value
       and incoming_value is distinct from target_value then
      raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_CONFLICT';
    end if;
  end loop;

  select * into seen from app_sync_private.ph_master_inventory_item6_alias_seen_v7 s
  where s.run_id=v_run_id and s.canonical_unique_id=candidate_uid;
  if seen.run_id is not null and seen.imported_unique_id is distinct from new.unique_id then
    raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
  end if;
  perform private.prune_expired_master_lineage_v1(v_run_id);
  insert into app_sync_private.ph_master_inventory_item6_alias_seen_v7(
    run_id,canonical_unique_id,imported_unique_id,stable_identity_key
  ) values(v_run_id,candidate_uid,new.unique_id,stable_key)
  on conflict(run_id,canonical_unique_id) do update set seen_at=clock_timestamp()
  where app_sync_private.ph_master_inventory_item6_alias_seen_v7.imported_unique_id=excluded.imported_unique_id;
  if not found then
    raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS';
  end if;
  insert into app_sync_private.ph_master_inventory_item6_aliases_v7(imported_unique_id,canonical_unique_id,stable_identity_key)
  values(new.unique_id,candidate_uid,stable_key)
  on conflict(imported_unique_id) do update set canonical_unique_id=excluded.canonical_unique_id,
    stable_identity_key=excluded.stable_identity_key
  where app_sync_private.ph_master_inventory_item6_aliases_v7.canonical_unique_id=excluded.canonical_unique_id
    and app_sync_private.ph_master_inventory_item6_aliases_v7.stable_identity_key=excluded.stable_identity_key;
  if not found then raise exception using errcode='PT409',message='MASTER_ITEM6_LINEAGE_AMBIGUOUS'; end if;
  new.unique_id := candidate_uid;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION private.ph_master_bulk_pending_ack_v1(p_unique_id text, p_raw_values jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- A source fingerprint can be unchanged after an app edit returns to that
  -- exact tuple. The normal guard must still observe it to acknowledge the edit.
  select exists(select 1 from app_sync_private.inventory_live_overrides_v1 e
    where e.canonical_unique_id=p_unique_id and e.pending and p_raw_values ? e.field_name
      and private.inventory_override_matches_v1(e.field_name,p_raw_values->e.field_name,e.app_override_value))
    or p_raw_values ?& array['priority','holdstopcode','holdstopreason'] and exists (
    select 1
    from app_sync_private.ph_master_inventory_app_edits edit
    join public.ph_master_inventory live on live.unique_id = edit.canonical_unique_id
    where edit.canonical_unique_id = p_unique_id and edit.pending_legacy_sync
      and nullif(p_raw_values->>'priority', '') is not distinct from live.priority
      and nullif(p_raw_values->>'holdstopcode', '') is not distinct from live.holdstopcode
      and nullif(p_raw_values->>'holdstopreason', '') is not distinct from live.holdstopreason
  )
$function$
;

CREATE OR REPLACE FUNCTION public.retry_drive_reclass_inquiry_v1(p_actor_username text, p_idempotency_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_username text := lower(btrim(coalesce(p_actor_username, '')));
  token text := btrim(coalesce(p_idempotency_token, ''));
  event_row public.ph_request_delivery_outbox;
begin
  if actor_username = '' or length(token) < 12 or length(token) > 180 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_RETRY_INVALID';
  end if;
  select o.* into event_row
  from public.ph_request_delivery_outbox o
  where o.event_key = 'reclass-inquiry:' || left(encode(extensions.digest(token, 'sha256'), 'hex'), 40)
    and o.event_type = 'reclass_inquiry'
    and lower(btrim(coalesce(o.payload #>> '{reclassPayload,actor,username}', ''))) = actor_username
    and o.payload #>> '{reclassPayload,protectedDelivery,contractVersion}' = 'drive-reclass-protected-v1'
  limit 1
  for update;
  if event_row.event_id is null then
    return jsonb_build_object('ok', false, 'status', 'missing', 'message', 'This inquiry was not found.');
  end if;
  if event_row.status = 'delivered' or event_row.status in ('pending', 'processing') then
    return private.drive_reclass_delivery_result_v1(event_row);
  end if;
  if upper(coalesce(event_row.sanitized_error_code, '')) like 'RECLASS_CONFLICT%'
    and not (case when jsonb_typeof(event_row.payload#>'{reclassPayload,protectedDelivery,v7FrozenRows}')='array'
      then jsonb_array_length(event_row.payload#>'{reclassPayload,protectedDelivery,v7FrozenRows}')>0 else false end) then
    return private.drive_reclass_delivery_result_v1(event_row);
  end if;
  update public.ph_request_delivery_outbox o
  set status = 'pending', attempt_count = 0, next_attempt_at = now(),
      sanitized_error_code = null, lease_token = null, lease_owner = null,
      lease_expires_at = null, updated_at = now()
  where o.event_id = event_row.event_id
  returning * into event_row;
  return private.drive_reclass_delivery_result_v1(event_row);
end
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_drive_reclass_inquiry_v7(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles; actor_count integer; projected jsonb; result jsonb;
  previous_edit_actor text:=coalesce(current_setting('gnc.inventory_edit_actor',true),'');
  previous_scope text:=coalesce(current_setting('gnc.sales_rep_operation_actor',true),'');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='DRIVE_RECLASS_FORBIDDEN';
  end if;
  select count(*) into actor_count from public.profiles p
    where lower(btrim(p.username))=lower(btrim(coalesce(p_payload->>'actorUsername','')));
  select p.* into actor from public.profiles p
    where lower(btrim(p.username))=lower(btrim(coalesce(p_payload->>'actorUsername','')));
  if actor_count<>1 or actor.disabled_at is not null or actor.must_change_password
    or actor.locked_until>now() then
    raise exception using errcode='42501',message='DRIVE_RECLASS_PROFILE_NOT_ACTIVE';
  end if;
  if upper(btrim(actor.role,E' \t\n\r')) in ('REP','SALESREP','SALES') then
    if not private.navigation_module_allowed_v1(actor.id,'drive') or exists (
      select 1 from private.app_access_user_overrides o
      where o.policy_id=private.resolve_app_access_policy_id_v1(false) and o.profile_id=actor.id
        and o.permission_key='drive.reclass.submit' and not o.allowed
    ) then
      raise exception using errcode='42501',message='DRIVE_RECLASS_FORBIDDEN';
    end if;
    projected:=private.project_reclass_editable_fields_v7(p_payload);
    if coalesce(projected#>>'{sourceContext,sourceMode}','drive')<>'drive'
      or jsonb_array_length(projected#>'{transaction,requestActions}')=0
      or exists(select 1 from jsonb_array_elements_text(projected#>'{transaction,requestActions}') a(value)
        where value not in ('priority_change','hold','take_off_hold','stop_ship','off_stop_ship'))
      or exists(select 1 from jsonb_array_elements(projected->'rowOverlays') r(value)
        where jsonb_array_length(coalesce(value->'fieldEdits','[]'::jsonb))>0)
    then raise exception using errcode='42501',message='SALES_REP_OPERATION_FORBIDDEN'; end if;
    perform set_config('gnc.sales_rep_operation_actor',actor.id::text,true);
  else
    perform set_config('gnc.sales_rep_operation_actor','',true);
  end if;
  perform set_config('gnc.inventory_edit_actor',actor.id::text,true);
  result:=private.enqueue_drive_reclass_inquiry_v7_rep_impl(p_payload);
  perform set_config('gnc.inventory_edit_actor',previous_edit_actor,true);
  perform set_config('gnc.sales_rep_operation_actor',previous_scope,true);
  return result;
exception when others then
  perform set_config('gnc.inventory_edit_actor',previous_edit_actor,true);
  perform set_config('gnc.sales_rep_operation_actor',previous_scope,true);
  raise;
end
$function$
;
CREATE OR REPLACE FUNCTION public.apply_inventory_reclass_moves_with_delivery_v1(p_actor_id uuid, p_command_id text, p_expected_revision bigint DEFAULT NULL::bigint, p_moves jsonb DEFAULT NULL::jsonb, p_receipt_encoding text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '15s'
 SET lock_timeout TO '2s'
AS $function$
declare
  batch_receipt private.ph_inventory_reclass_batch_receipts_v1%rowtype;
  actor_profile public.profiles%rowtype;
  result_value jsonb;
  event_row public.ph_request_delivery_outbox%rowtype;
  event_key_value text;
  actor_username text;
  actor_email text;
  recipient_emails text[];
  applied_rows jsonb;
  moves_value jsonb;
  child_ids uuid[];
  move_request_id uuid;
  existing_command boolean := false;
  resolved_revision bigint;
  previous_edit_actor text:=coalesce(current_setting('gnc.inventory_edit_actor',true),'');
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_FORBIDDEN';
  end if;
  if p_actor_id is null or p_command_id is null or p_command_id !~ '^[A-Za-z0-9:_.-]{12,180}$'

    or (p_expected_revision is not null and p_expected_revision < 1)
    or jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves) < 1
    or jsonb_array_length(p_moves) > 100
    or (p_receipt_encoding is not null and p_receipt_encoding <> 'master-null-elision-v1') then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_PAYLOAD_INVALID';
  end if;

  -- Match the movement RPC's actor/command lock so receipt lookup, movement,
  -- and event insertion cannot race a retry of the same command.
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || ':' || p_command_id, 0));
  select * into batch_receipt from private.ph_inventory_reclass_batch_receipts_v1 b
    where b.actor_id = p_actor_id and b.command_id = p_command_id for update;
  existing_command := found;
  if existing_command then
    resolved_revision := (batch_receipt.request->>'expectedRevision')::bigint;
  else
    resolved_revision := private.lock_ph_master_inventory_for_reclass_lkg_v1();
  end if;

  perform set_config('gnc.inventory_edit_actor',p_actor_id::text,true);
  if p_receipt_encoding = 'master-null-elision-v1' then
    result_value := public.apply_inventory_reclass_moves_compact_v1(p_actor_id, p_command_id, resolved_revision, p_moves);
  else
    result_value := public.apply_inventory_reclass_moves_v1(p_actor_id, p_command_id, resolved_revision, p_moves);
  end if;

  perform set_config('gnc.inventory_edit_actor',previous_edit_actor,true);
  -- A command created before this delivery contract is not retroactively
  -- emailed. Newly applied commands always have their outbox intent below.
  if existing_command then
    event_key_value := 'inventory-reclass-move-completed:' || p_actor_id::text || ':' || p_command_id;
    select * into event_row from public.ph_request_delivery_outbox o
      where o.event_key = event_key_value and o.event_type = 'inventory_reclass_move_completed';
    return result_value || jsonb_build_object('duplicate', true, 'emailQueued', event_row.event_id is not null,
      'deliveryEventId', event_row.event_id);
  end if;

  if coalesce(result_value->>'status', '') <> 'applied' then
    return result_value;
  end if;

  select * into actor_profile from public.profiles p where p.id = p_actor_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password;
  if actor_profile.id is null then raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_PROFILE_INACTIVE'; end if;
  actor_username := lower(btrim(actor_profile.username));
  select lower(btrim(u.email)) into actor_email from auth.users u
    where u.id = p_actor_id and u.email_confirmed_at is not null
      and btrim(coalesce(u.email, '')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
  if actor_email is null then raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_ACTOR_EMAIL_UNAVAILABLE'; end if;

  -- Resolve the server-owned Dylan + Megan + active actor policy; never trust
  -- any recipient address from the request payload.
  recipient_emails := private.reclass_delivery_recipients_v1(actor_username);
  if actor_email <> all(recipient_emails) then raise exception using errcode='P0001',message='INVENTORY_RECLASS_REQUIRED_RECIPIENT_POLICY_INVALID'; end if;

  move_request_id := nullif(result_value->>'requestId', '')::uuid;
  if move_request_id is null then raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_MISSING'; end if;
  select b.child_request_ids, b.result->'rows' into child_ids, applied_rows from private.ph_inventory_reclass_batch_receipts_v1 b
    where b.actor_id = p_actor_id and b.command_id = p_command_id and b.request_id = move_request_id;
  if child_ids is null or jsonb_typeof(applied_rows) is distinct from 'array' or jsonb_array_length(applied_rows) < 1 then
    raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_MISSING';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'direction', m.direction,
      'destinationSeason', m.destination_season,
      'quantity', m.quantity,
      'source', jsonb_build_object('unique_id',m.source_unique_id,'itemcode', m.source_identity->>'itemcode',
        'commonname', coalesce(m.source_before->>'commonname', ''),
        'contsize', m.source_identity->>'contsize', 'locationcode', m.source_identity->>'locationcode',
        'lotcode', m.source_identity->>'lotcode', 'season', m.source_identity->>'season'),
      'destination', jsonb_build_object('unique_id',m.destination_unique_id,'itemcode', m.destination_identity->>'itemcode',
        'commonname', coalesce(m.source_before->>'commonname', ''),
        'contsize', m.destination_identity->>'contsize', 'locationcode', m.destination_identity->>'locationcode',
        'lotcode', m.destination_identity->>'lotcode', 'season', m.destination_identity->>'season')
    ) order by m.request_id, m.line_index), '[]'::jsonb)
    into moves_value from private.ph_inventory_reclass_movements_v1 m where m.request_id = any(child_ids);
  if jsonb_array_length(moves_value) < 1 then raise exception using errcode = 'P0001', message = 'INVENTORY_RECLASS_MOVE_RECEIPT_MISSING'; end if;

  event_key_value := 'inventory-reclass-move-completed:' || p_actor_id::text || ':' || p_command_id;
  insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, payload, status, next_attempt_at)
    values(event_key_value, 'inventory_reclass_move_completed', move_request_id::text,
      jsonb_build_object('contractVersion', 'inventory-reclass-move-completed-v1',
        'commandId', p_command_id, 'requestId', move_request_id, 'actorProfileId', p_actor_id,
        'actorUsername', actor_username, 'actorDisplayName', coalesce(nullif(btrim(actor_profile.display_name), ''), actor_username),
        'actorEmail', actor_email, 'revision',result_value->>'revision','moves',moves_value,'appliedRows',applied_rows,'deliveryRecipients',to_jsonb(recipient_emails)),
      'pending', now()) returning * into event_row;

  return result_value || jsonb_build_object('duplicate', false, 'emailQueued', true, 'deliveryEventId', event_row.event_id);
end;
$function$
;
commit;
