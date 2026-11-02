BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='45s';

-- Same authorization as canonical Drive evidence. No anonymous operational writes.
CREATE TABLE IF NOT EXISTS public.ph_photo_blobs(
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'), master_uid text NOT NULL,
 object_path text NOT NULL UNIQUE, content text NOT NULL CHECK(length(content)<=280000),
 content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/webp')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ph_photo_blobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ph_photo_blobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.ph_photo_blobs TO service_role;

CREATE OR REPLACE FUNCTION public.store_drive_photo_blob_v1(p_path text,p_content text,p_content_type text DEFAULT 'image/jpeg')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE bytes bytea; photo_id text;
BEGIN
 IF NOT public.can_upload_drive_evidence_v23115(p_path) THEN RAISE EXCEPTION 'DRIVE_PHOTO_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF length(p_content)>280000 OR p_content_type NOT IN ('image/jpeg','image/webp') THEN RAISE EXCEPTION 'PHOTO_SIZE_INVALID' USING ERRCODE='22023'; END IF;
 bytes:=decode(p_content,'base64');
 IF octet_length(bytes) NOT BETWEEN 4 AND 204800 OR
    (p_content_type='image/jpeg' AND substring(bytes from 1 for 3)<>decode('ffd8ff','hex')) OR
    (p_content_type='image/webp' AND (substring(bytes from 1 for 4)<>convert_to('RIFF','UTF8') OR substring(bytes from 9 for 4)<>convert_to('WEBP','UTF8'))) THEN
   RAISE EXCEPTION 'PHOTO_ENCODING_INVALID' USING ERRCODE='22023'; END IF;
 IF split_part(regexp_replace(p_path,'^.*/',''),'.',1)<>encode(extensions.digest(bytes,'sha256'),'hex') THEN RAISE EXCEPTION 'PHOTO_HASH_INVALID' USING ERRCODE='22023'; END IF;
 photo_id:=encode(extensions.digest(p_path,'sha256'),'hex');
 INSERT INTO public.ph_photo_blobs(id,master_uid,object_path,content,content_type) VALUES(photo_id,convert_from(decode(split_part(p_path,'/',2),'hex'),'UTF8'),p_path,p_content,p_content_type) ON CONFLICT(id) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'id',photo_id);
END $$;
REVOKE ALL ON FUNCTION public.store_drive_photo_blob_v1(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.store_drive_photo_blob_v1(text,text,text) TO authenticated;

DROP POLICY IF EXISTS drive_evidence_native_update_v23142 ON storage.objects;
CREATE POLICY drive_evidence_native_update_v23142 ON storage.objects FOR UPDATE TO authenticated USING(bucket_id IN ('season_sales_notes_photos','location_sales_notes_photos','flyer_photos') AND public.can_upload_drive_evidence_v23115(name)) WITH CHECK(bucket_id IN ('season_sales_notes_photos','location_sales_notes_photos','flyer_photos') AND public.can_upload_drive_evidence_v23115(name));
DROP POLICY IF EXISTS drive_evidence_native_select_v23142 ON storage.objects;
CREATE POLICY drive_evidence_native_select_v23142 ON storage.objects FOR SELECT TO authenticated USING(bucket_id IN ('season_sales_notes_photos','location_sales_notes_photos','flyer_photos') AND public.can_upload_drive_evidence_v23115(name));

CREATE OR REPLACE FUNCTION suspend_tag_private.group_command(p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare actor public.profiles; s public.ph_soc_master; r public.ph_soc_master; m public.ph_master_inventory;
 a suspend_tag_private.approvals; w suspend_tag_private.workflows; receipt suspend_tag_private.commands;
 input jsonb; result jsonb; candidates jsonb; candidate jsonb; group_key text; uid text; candidate_uid text;
 chosen text; decision text; remaining integer; event_id uuid; ids text[]; custom jsonb; custom_location text; custom_lot text; custom_uid text; stamp timestamptz:=clock_timestamp();
begin
 if p_operation not in ('add_candidates','replace_location','split_location','remove_location','send','approval','decide','inbox','close','dock_review') then
   return suspend_tag_private.command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_version);
 end if;
 actor:=suspend_tag_private.actor(p_actor_id);
 if p_operation='inbox' then
   return jsonb_build_object('approvals',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from
     (select a.id,a.status,a.snapshot,a.created_at from suspend_tag_private.approvals a where a.status='pending'
       and (a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)) order by a.created_at desc limit 100) x));
 end if;
 if p_operation in ('approval','decide') then
   select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
   if a.id is null or (a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)
       and regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in ('SUPERADMIN','ADMIN','ADMINISTRATOR','MANAGER','EVALUATOR','INVENTORY','INVENTORYMANAGER')
       and not (p_operation='approval' and actor.username='dan_mccuistion')) then
     raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
   end if;
   uid:=a.source_uid;
 else
   if p_operation='dock_review' then
     if not private.is_full_app_administrator_v1(actor.username)
       and regexp_replace(upper(actor.role),'[^A-Z]','','g') not in ('QCSUPERVISOR','QCSUP') then
       raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
   elsif regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in
      ('ADMIN','ADMINISTRATOR','MANAGER','EVALUATOR','INVENTORY','INVENTORYMANAGER','SALESREP')
      and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then
      raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
   uid:=case when p_operation='add_candidates' then suspend_tag_private.resolve_edit_source_v23107(p_payload) else p_payload->>'sourceUid' end;
 end if;
 -- suspend-physical-identity-v2394: resolve stale UIDs before the former early missing-source guard.
 select * into s from public.ph_soc_master where unique_id=uid;
 if s.unique_id is null and p_operation='close' and jsonb_typeof(p_payload->'sourceIdentity')='object' then
   select candidate.* into s from public.ph_soc_master candidate
   where suspend_tag_private.eligible(candidate.suspend,candidate.suspend_to)
     and upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'itemcode','')))
     and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'locationcode','')))
     and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'lotcode','')))
     and upper(btrim(coalesce(candidate.dock,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'dock','')))
     and upper(btrim(coalesce(candidate.stopnumber,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'stopnumber','')))
     and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'quantityshipped','')),'') is null
       or coalesce(nullif(regexp_replace(candidate.quantityshipped,'[^0-9.-]','','g'),''),'0')::numeric
        =coalesce(nullif(regexp_replace(p_payload->'sourceIdentity'->>'quantityshipped','[^0-9.-]','','g'),''),'0')::numeric)
     and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'tagcode','')),'') is null
       or upper(btrim(coalesce(candidate.tagcode,'')))=upper(btrim(p_payload->'sourceIdentity'->>'tagcode')))
   order by candidate.last_updated desc,candidate.unique_id limit 1;
   if s.unique_id is not null then uid:=s.unique_id; end if;
 end if;
 -- suspend-add-candidates-physical-identity-v2397: exact one-row recovery only.
 if s.unique_id is null and p_operation in ('add_candidates','replace_location','split_location','remove_location') and jsonb_typeof(p_payload->'sourceIdentity')='object' then
   select min(candidate.unique_id) into candidate_uid from public.ph_soc_master candidate
   where suspend_tag_private.eligible(candidate.suspend,candidate.suspend_to)
     and nullif(btrim(p_payload->'sourceIdentity'->>'transactionnumber'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'tagcode'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'dock'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'stopnumber'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'itemcode'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'locationcode'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'lotcode'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'quantityshipped'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'customer'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'consignee'),'') is not null
     and nullif(btrim(p_payload->'sourceIdentity'->>'salesrep'),'') is not null
     and upper(btrim(candidate.transactionnumber))=upper(btrim(p_payload->'sourceIdentity'->>'transactionnumber'))
     and upper(btrim(candidate.tagcode))=upper(btrim(p_payload->'sourceIdentity'->>'tagcode'))
     and upper(btrim(candidate.dock))=upper(btrim(p_payload->'sourceIdentity'->>'dock'))
     and upper(btrim(candidate.stopnumber))=upper(btrim(p_payload->'sourceIdentity'->>'stopnumber'))
     and upper(btrim(candidate.itemcode))=upper(btrim(p_payload->'sourceIdentity'->>'itemcode'))
     and upper(btrim(candidate.locationcode))=upper(btrim(p_payload->'sourceIdentity'->>'locationcode'))
     and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'lotcode','')))
     and coalesce(nullif(regexp_replace(candidate.quantityshipped,'[^0-9.-]','','g'),''),'0')::numeric
       =coalesce(nullif(regexp_replace(p_payload->'sourceIdentity'->>'quantityshipped','[^0-9.-]','','g'),''),'0')::numeric
     and upper(btrim(coalesce(candidate.customeridentityid,candidate.customername,'')))=upper(btrim(p_payload->'sourceIdentity'->>'customer'))
     and upper(btrim(coalesce(candidate.consigneeidentityid,candidate.consigneename,'')))=upper(btrim(p_payload->'sourceIdentity'->>'consignee'))
     and upper(btrim(coalesce(candidate.salesrepid,candidate.salesrepname,'')))=upper(btrim(p_payload->'sourceIdentity'->>'salesrep'))
   having count(*)=1;
   if candidate_uid is not null then
     select * into s from public.ph_soc_master candidate where candidate.unique_id=candidate_uid for update;
     uid:=candidate_uid;
     p_payload:=jsonb_set(p_payload,'{expectedLastUpdated}',to_jsonb(s.last_updated::text),true);
   end if;
 end if;
 if s.unique_id is null then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
 if regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g')='SALESREP'
    and (suspend_tag_private.rep_for_row(s)).id is distinct from actor.id then
   raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
 end if;
 group_key:=suspend_tag_private.order_key(s);
 if p_operation='approval' then
   candidates:=coalesce(a.snapshot->'candidates',jsonb_build_array(a.snapshot));
   select coalesce(jsonb_agg(candidate.value||jsonb_build_object('candidate_state',coalesce(r.suspend_candidate_state,'candidate'))),'[]') into candidates
    from jsonb_array_elements(candidates) candidate left join public.ph_soc_master r on r.unique_id=candidate.value->>'unique_id';
   return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','candidates',candidates,
     'canDecide',a.status='pending' and (a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)));
 end if;
 if p_command_id is null then raise exception 'SUSPEND_TAG_COMMAND_REQUIRED' using errcode='22023'; end if;
 input:=jsonb_build_object('operation',p_operation,'payload',p_payload,'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended('suspend-tag-v2:'||actor.id||':'||p_command_id,0));
 select * into receipt from suspend_tag_private.commands where actor_id=actor.id and command_id=p_command_id;
 if found then
   if receipt.request<>input then raise exception 'SUSPEND_TAG_TOKEN_CONFLICT' using errcode='22023'; end if;
   return receipt.response;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('suspend-tag-review-item:'||s.itemcode,0));
 perform pg_advisory_xact_lock(hashtextextended('suspend-order:'||group_key,0));
 -- suspend-close-stable-identity-v2392: close the active physical tag even when an import changes its UID or timestamp.
 select * into s from public.ph_soc_master where unique_id=uid for update;
 if p_operation='close' and (s.unique_id is null or not suspend_tag_private.eligible(s.suspend,s.suspend_to))
    and jsonb_typeof(p_payload->'sourceIdentity')='object' then
   select candidate.* into s from public.ph_soc_master candidate
    where suspend_tag_private.eligible(candidate.suspend,candidate.suspend_to)
      and upper(btrim(coalesce(candidate.transactionnumber,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'transactionnumber','')))
      and upper(btrim(coalesce(candidate.dock,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'dock','')))
      and upper(btrim(coalesce(candidate.stopnumber,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'stopnumber','')))
      and upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'itemcode','')))
      and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'locationcode','')))
      and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'lotcode','')))
      -- suspend-physical-identity-v2394: shipped quantity/tag disambiguate duplicate physical order lines.
      and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'quantityshipped','')),'') is null
        or coalesce(nullif(regexp_replace(candidate.quantityshipped,'[^0-9.-]','','g'),''),'0')::numeric
          =coalesce(nullif(regexp_replace(p_payload->'sourceIdentity'->>'quantityshipped','[^0-9.-]','','g'),''),'0')::numeric)
      and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'tagcode','')),'') is null
        or upper(btrim(coalesce(candidate.tagcode,'')))=upper(btrim(p_payload->'sourceIdentity'->>'tagcode')))
      and upper(btrim(coalesce(candidate.consigneeidentityid,candidate.consigneename,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'consignee','')))
    order by candidate.last_updated desc,candidate.unique_id limit 1 for update;
   if s.unique_id is not null then uid:=s.unique_id; end if;
 end if;
 if p_operation<>'decide' then
   if p_operation<>'dock_review' and not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
   if p_operation not in ('close','add_candidates','replace_location','split_location','remove_location') and (not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz) then
     raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='PT409'; end if;
   select * into w from suspend_tag_private.workflows where source_uid=uid for update;
   if p_operation not in ('add_candidates','replace_location','split_location','remove_location') and p_expected_version is not null and coalesce(w.version,0)<>p_expected_version then raise exception 'SUSPEND_TAG_VERSION_CHANGED' using errcode='PT409'; end if;
 end if;
 if p_operation='dock_review' then
   if suspend_tag_private.eligible(s.suspend,s.suspend_to) then
     raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023';
   end if;
   if jsonb_typeof(p_payload->'patch')<>'object' or exists(select 1 from jsonb_object_keys(p_payload->'patch') k
      where k<>all(array['dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','date_completed','av_note','match','loc_match_qty','initial_ptr'])) then
     raise exception 'SUSPEND_TAG_FIELD_FORBIDDEN' using errcode='42501'; end if;
   r:=jsonb_populate_record(s,p_payload->'patch');
   update public.ph_soc_master set dock_spec=r.dock_spec,dock_caliper=r.dock_caliper,dock_note=r.dock_note,
      dock_photo_link=r.dock_photo_link,dock_photo_name=r.dock_photo_name,date_completed=r.date_completed,
      av_note=r.av_note,match=r.match,loc_match_qty=r.loc_match_qty,initial_ptr=r.initial_ptr where unique_id=uid;
   insert into suspend_tag_private.workflows(source_uid,source_revision,status)
      values(uid,s.last_updated,'pending') on conflict(source_uid) do update set version=suspend_tag_private.workflows.version+1,updated_at=stamp;
   result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
 elsif p_operation='remove_location' then
    update suspend_tag_private.approvals set status='superseded' where status='pending' and id=w.current_approval_id;
    update public.ph_soc_master set suspend_candidate_state='replaced',suspend=null,suspend_to=null,quantityordered='0',last_updated=stamp where unique_id=uid;
    result:=jsonb_build_object('ok',true);
  elsif p_operation in ('add_candidates','replace_location','split_location') then
   -- suspend-fill-tag-v2390: existing or user-entered real nursery rows share one candidate path.
   if jsonb_typeof(coalesce(p_payload->'inventoryIds','[]'::jsonb))<>'array'
      or jsonb_typeof(coalesce(p_payload->'customRows','[]'::jsonb))<>'array'
      or jsonb_array_length(coalesce(p_payload->'inventoryIds','[]'::jsonb))
        + jsonb_array_length(coalesce(p_payload->'customRows','[]'::jsonb)) not between 1 and 30 then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   select coalesce(array_agg(distinct value),'{}'::text[]) into ids
     from jsonb_array_elements_text(coalesce(p_payload->'inventoryIds','[]'::jsonb));
   for custom in select value from jsonb_array_elements(coalesce(p_payload->'customRows','[]'::jsonb)) loop
     if jsonb_typeof(custom)<>'object' or custom-jsonb_build_object('locationcode',custom->'locationcode','lotcode',custom->'lotcode')<>'{}'::jsonb then
       raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
     custom_location:=upper(btrim(coalesce(custom->>'locationcode','')));
     custom_lot:=upper(btrim(coalesce(custom->>'lotcode','')));
     if custom_location!~'^[A-Z0-9]+([.][A-Z0-9]+){1,2}$' or custom_location~'^0+[.]0+[.]111$'
        or custom_lot!~'^[0-9]{2}[.](F1|S1|U1|U2|U3|X|Y|Z)$' then
       raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
     m:=null;
     select candidate.* into m from public.ph_master_inventory candidate
       where upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(s.itemcode,'')))
         and upper(btrim(coalesce(candidate.locationcode,'')))=custom_location
         and upper(btrim(coalesce(candidate.lotcode,'')))=custom_lot
       order by candidate.unique_id limit 1;
     if m.unique_id is null then
       select candidate.* into m from public.ph_master_inventory candidate
         where upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(s.itemcode,'')))
         order by (upper(btrim(coalesce(candidate.contsize,'')))=upper(btrim(coalesce(s.contsize,'')))) desc,candidate.unique_id limit 1;
       if m.unique_id is null then raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
       custom_uid:='suspend-fill-'||md5(upper(s.itemcode)||':'||custom_location||':'||custom_lot);
       m:=jsonb_populate_record(null::public.ph_master_inventory,to_jsonb(m)||jsonb_build_object(
         'unique_id',custom_uid,'locationcode',custom_location,'lotcode',custom_lot,'season',split_part(custom_lot,'.',2),
         'saleyear',split_part(custom_lot,'.',1),'source','Suspend Fill Tag','last_updated',stamp,
         'ptronhand','0','ptrreviewed','0','ptravailable','0','s_lts','0','season_supply','0','season_oh','0',
         'season_demand','0','season_available','0','loc_match_qty',null,'initial_ptr','0','photos','[]'::jsonb,
         'photo_link',null,'photo_name',null,'photo_url',null,'photo_date',null,'spec',null,'caliper',null,
         'match',null,'loc_match_pct',null,'loc_photo_match',null,'av_note',null,'pick_note',null,'sales_note',null,
         'concat','suspend-fill-tag-v2390:'||custom_uid));
       insert into public.ph_master_inventory select (m).* on conflict(unique_id) do nothing;
     end if;
     ids:=array_append(ids,m.unique_id);
   end loop;
   select array_agg(distinct value order by value) into ids from unnest(ids) value;
   if cardinality(ids) not between 1 and 30 or exists(select 1 from unnest(ids) x left join public.ph_master_inventory m on m.unique_id=x
      where m.unique_id is null or regexp_replace(rtrim(upper(m.itemcode),'.'),'[.]1$','')<>regexp_replace(rtrim(upper(s.itemcode),'.'),'[.]1$','') or nullif(btrim(m.locationcode),'') is null or m.locationcode~'^0+[.]0+[.]111$') then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   if p_operation in ('replace_location','split_location') and cardinality(ids)<>1 then raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   if p_operation='split_location' and exists(select 1 from public.ph_master_inventory target where target.unique_id=any(ids) and target.locationcode=s.locationcode and coalesce(target.lotcode,'')=coalesce(s.lotcode,'')) then raise exception 'SUSPEND_TAG_SPLIT_SAME_LOCATION' using errcode='22023'; end if;
   if p_operation='split_location' and (coalesce((p_payload->>'splitQuantity')::numeric,0)<=0 or (p_payload->>'splitQuantity')::numeric>=coalesce(nullif(s.quantityordered,''),'0')::numeric) then raise exception 'SUSPEND_TAG_SPLIT_QUANTITY_INVALID' using errcode='22023'; end if;
   -- Authorized additions begin a fresh round; prior frozen approval snapshots remain immutable.
   -- Supersede the prior frozen round before adding a new choice.
   update suspend_tag_private.approvals a set status='superseded' where a.status='pending' and a.id in
     (select w.current_approval_id from suspend_tag_private.workflows w join public.ph_soc_master r on r.unique_id=w.source_uid
       where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key);
   update public.ph_soc_master r set suspend_candidate_group=group_key,suspend_order_quantity=coalesce(r.suspend_order_quantity,r.quantityordered),
       suspend_origin_uid=coalesce(r.suspend_origin_uid,uid),suspend_candidate_state='candidate'
     where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key and suspend_tag_private.eligible(r.suspend,r.suspend_to);
   for m in select * from public.ph_master_inventory where unique_id=any(ids) order by unique_id loop
     if exists(select 1 from public.ph_soc_master r where r.suspend_candidate_group=group_key
         and r.locationcode=m.locationcode and coalesce(r.lotcode,'')=coalesce(m.lotcode,'') and r.suspend_candidate_state='candidate') then continue; end if;
     candidate_uid:='suspend-option-'||md5(group_key||':'||m.unique_id);
     r:=jsonb_populate_record(null::public.ph_soc_master,to_jsonb(s)||jsonb_build_object(
       'unique_id',candidate_uid,'source','Suspend Tag AV Option','locationcode',m.locationcode,'lotcode',m.lotcode,
       'last_updated',stamp,'date_completed',null,'quantityordered',case when p_operation='split_location' then p_payload->>'splitQuantity' when p_operation='replace_location' then s.quantityordered else coalesce(s.suspend_order_quantity,s.quantityordered) end,
       'quantityshipped','0','suspend','SUSPEND','suspend_to','dc','suspend_candidate_group',group_key,'suspend_candidate_state','candidate',
       'suspend_origin_uid',coalesce(s.suspend_origin_uid,uid),'suspend_order_quantity',coalesce(s.suspend_order_quantity,s.quantityordered),
       'ptronhand',m.ptronhand,'ptravailable',m.ptravailable,'ptrreviewed',m.ptrreviewed,'s_lts',m.s_lts,'priority',m.priority,
       'season',m.season,'dock_spec',m.spec,'dock_caliper',m.caliper,'av_note',m.av_note,'holdstopcode',m.holdstopcode,'holdstopreason',m.holdstopreason,
       'dock_photo_link',m.photo_link,'dock_photo_name',m.photo_name,'photo_link',m.photo_link,'photo_name',m.photo_name,'photo_url',m.photo_url,'photos',m.photos,'pick_note',m.pick_note,'sales_note',m.sales_note,'match',m.match,'loc_match_qty',m.loc_match_qty));
     insert into public.ph_soc_master select (r).* on conflict(unique_id) do update set
       locationcode=excluded.locationcode,lotcode=excluded.lotcode,quantityordered=excluded.quantityordered,
       suspend=excluded.suspend,suspend_to=excluded.suspend_to,suspend_candidate_state=excluded.suspend_candidate_state,
       dock_spec=excluded.dock_spec,dock_caliper=excluded.dock_caliper,av_note=excluded.av_note,
       dock_photo_link=excluded.dock_photo_link,dock_photo_name=excluded.dock_photo_name,
       photo_link=excluded.photo_link,photo_name=excluded.photo_name,photo_url=excluded.photo_url,photos=excluded.photos,
       match=excluded.match,loc_match_qty=excluded.loc_match_qty,date_completed=null,last_updated=excluded.last_updated;
   end loop;
   update public.ph_soc_master r set suspend_candidate_state='replaced',suspend=null,suspend_to=null,quantityordered='0',date_completed=stamp
     where r.suspend_candidate_group=group_key and (suspend_tag_private.is_false_block_v2378(r.locationcode)
        or (p_operation='replace_location' and r.unique_id=uid and not exists(select 1 from public.ph_master_inventory target where target.unique_id=any(ids) and target.locationcode=r.locationcode and coalesce(target.lotcode,'')=coalesce(r.lotcode,''))));
    if p_operation='split_location' then
      update public.ph_soc_master set quantityordered=(coalesce(nullif(s.quantityordered,''),'0')::numeric-(p_payload->>'splitQuantity')::numeric)::text,last_updated=stamp where unique_id=uid;
    end if;
   insert into suspend_tag_private.workflows(source_uid,source_revision,status)
     select r.unique_id,r.last_updated,'pending' from public.ph_soc_master r where r.suspend_candidate_group=group_key
     on conflict(source_uid) do update set current_approval_id=null,status='pending',version=suspend_tag_private.workflows.version+1,updated_at=stamp;
   result:=jsonb_build_object('ok',true,
     'added_rows',(select count(*) from public.ph_soc_master c where c.suspend_candidate_group=group_key and c.last_updated=stamp and c.suspend_candidate_state='candidate'),
     'removed_false_block',exists(select 1 from public.ph_soc_master c where c.suspend_candidate_group=group_key and c.locationcode='0.00.111' and c.suspend_candidate_state='replaced'));
 elsif p_operation='send' then
   -- The clicked row retains the existing completion and sender checks.
   result:=suspend_tag_private.command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_version);
   select a2.* into a from suspend_tag_private.approvals a2 join suspend_tag_private.workflows w2 on w2.current_approval_id=a2.id where w2.source_uid=uid;
   if a.snapshot->'candidates' is null then
     select jsonb_agg(to_jsonb(suspend_tag_private.existing_review(r)) order by r.locationcode,r.lotcode,r.unique_id) into candidates
       from public.ph_soc_master r where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key
         and suspend_tag_private.eligible(r.suspend,r.suspend_to) and coalesce(r.suspend_candidate_state,'candidate') not in ('denied','canceled','replaced') and not suspend_tag_private.is_false_block_v2378(r.locationcode) and not suspend_tag_private.is_false_block_v2378(r.locationcode) and not suspend_tag_private.is_false_block_v2378(r.locationcode);
     update suspend_tag_private.approvals set snapshot=snapshot||jsonb_build_object('candidates',candidates,'candidate_group_key',group_key) where id=a.id;
     update public.ph_soc_master r set suspend_candidate_group=group_key,suspend_candidate_state='candidate',
       suspend_order_quantity=coalesce(r.suspend_order_quantity,r.quantityordered),suspend_origin_uid=coalesce(r.suspend_origin_uid,uid)
       where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates));
     insert into suspend_tag_private.workflows(source_uid,source_revision,status,current_approval_id)
       select r.unique_id,r.last_updated,'awaiting_rep',a.id from public.ph_soc_master r
       where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates))
       on conflict(source_uid) do update set status='awaiting_rep',current_approval_id=a.id,version=suspend_tag_private.workflows.version+1,updated_at=stamp;
   end if;
   result:=result||jsonb_build_object('notification',jsonb_build_object('approvalId',a.id,'repUsername',a.snapshot->>'rep_username',
     'senderDisplay',a.snapshot->>'sent_by_display','customer',coalesce(a.snapshot->>'customername',a.snapshot->>'consigneename'),
     'itemDescription',concat_ws(' ',a.snapshot->>'commonname',a.snapshot->>'contsize')));
 elsif p_operation='close' then
   insert into public.ph_productivity_history(event_key,completed_by_username,completed_by_display,completed_at,
     source_table,source_kind,source_unique_id,source_assignment,itemcode,commonname,contsize,locationcode,lotcode,
     customer_name,request_folder,snapshot)
   values('suspend-tag-complete:'||uid,actor.username,coalesce(nullif(actor.display_name,''),actor.username),stamp,
     'ph_soc_master','Suspend Tag',uid,to_jsonb(s)->>'assignedto',s.itemcode,s.commonname,s.contsize,s.locationcode,s.lotcode,
     coalesce(to_jsonb(s)->>'customername',to_jsonb(s)->>'consigneename'),to_jsonb(s)->>'request_folder',
     to_jsonb(s)||jsonb_build_object('completed_at',stamp,'completed_by_username',actor.username))
   on conflict(event_key) do nothing;
   update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
   update public.ph_soc_master set suspend=null,suspend_to=null,date_completed=stamp where unique_id=uid;
   update suspend_tag_private.workflows set status='completed',current_approval_id=null,version=version+1,updated_at=stamp where source_uid=uid;
   result:=jsonb_build_object('ok',true,'completed',true,'unique_id',uid,'row',suspend_tag_private.row_json(uid));
 elsif p_operation='decide' then
   select * into a from suspend_tag_private.approvals where id=a.id for update;
   if a.status<>'pending' then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='PT409'; end if;
   decision:=p_payload->>'decision'; chosen:=nullif(p_payload->>'candidateUid','');
   if decision not in ('approve','deny') or decision is null then raise exception 'SUSPEND_TAG_DECISION_INVALID' using errcode='22023'; end if;
   candidates:=coalesce(a.snapshot->'candidates',jsonb_build_array(a.snapshot));
   if decision='approve' and chosen is null then chosen:=a.source_uid; end if;
   if chosen is not null and not exists(select 1 from jsonb_array_elements(candidates) x where x->>'unique_id'=chosen) then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   for candidate in select value from jsonb_array_elements(candidates) order by value->>'unique_id' loop
     select * into r from public.ph_soc_master where unique_id=candidate->>'unique_id' for update;
     if r.unique_id is null or r.last_updated is distinct from (candidate->>'last_updated')::timestamptz
       or not exists(select 1 from suspend_tag_private.workflows w where w.source_uid=r.unique_id and w.current_approval_id=a.id) then
       raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='PT409'; end if;
     if r.unique_id=chosen and r.suspend_candidate_state in ('denied','canceled','replaced') then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='PT409'; end if;
   end loop;
   update public.ph_soc_master r set
     suspend_candidate_group=group_key,suspend_order_quantity=coalesce(r.suspend_order_quantity,r.quantityordered),
     suspend_candidate_state=case when decision='approve' and r.unique_id=chosen then 'approved' else 'denied' end,
     quantityordered=case when decision='approve' and r.unique_id=chosen then coalesce(r.suspend_order_quantity,r.quantityordered) else '0' end,
     suspend=null,suspend_to=null,date_completed=stamp
     where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)) and (decision='approve' or chosen is null or r.unique_id=chosen);
   update suspend_tag_private.workflows w set status=r.suspend_candidate_state,version=w.version+1,updated_at=stamp
     from public.ph_soc_master r where r.unique_id=w.source_uid and w.current_approval_id=a.id and r.suspend_candidate_state in ('approved','denied');
   select count(*) into remaining from public.ph_soc_master r where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)) and suspend_tag_private.eligible(r.suspend,r.suspend_to);
   if decision='approve' or remaining=0 then
     if decision='deny' then update public.ph_soc_master r set suspend_candidate_state='canceled' where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)); end if;
     update suspend_tag_private.approvals set status=case when decision='approve' then 'approved' else 'denied' end,
       selected_source_uid=case when decision='approve' then chosen end,decided_at=stamp,decided_by=actor.id where id=a.id returning * into a;
     begin
       insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
         values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),stamp)
         returning public.ph_request_delivery_outbox.event_id into event_id;
       update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;
     exception when others then event_id:=null; end;
   end if;
   result:=jsonb_build_object('ok',true,'decision',a.status,'approvalId',a.id);
 end if;
 if p_operation in ('send','close') then result:=result||jsonb_build_object('row',suspend_tag_private.row_json(uid)); end if;
 result:=result||jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]')
    from public.ph_soc_master r where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key));
 insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result)
   on conflict(actor_id,command_id) do update set response=excluded.response;
 return result;
end $function$;



-- Statement-level exact-row evidence propagation; imports with unchanged protected fields do no work.
CREATE OR REPLACE FUNCTION private.publish_drive_evidence_to_soc_v23142() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.ph_soc_master s SET photo_link=n.photo_link,photo_name=n.photo_name,photo_url=n.photo_url,photos=n.photos,
   dock_photo_link=n.photo_link,dock_photo_name=n.photo_name,dock_spec=n.spec,dock_caliper=n.caliper,
   av_note=n.av_note,pick_note=n.pick_note,match=n.match,loc_match_qty=n.loc_match_qty,date_completed=n.date_completed
 FROM new_drive_evidence n JOIN old_drive_evidence o USING(unique_id)
 WHERE (n.photo_link,n.spec,n.caliper,n.av_note,n.pick_note,n.match,n.loc_match_qty,n.date_completed) IS DISTINCT FROM
       (o.photo_link,o.spec,o.caliper,o.av_note,o.pick_note,o.match,o.loc_match_qty,o.date_completed)
   AND s.itemcode=n.itemcode AND s.locationcode=n.locationcode AND coalesce(s.lotcode,'')=coalesce(n.lotcode,'')
   AND n.locationcode!~'^0+[.]0+[.]111$'
   AND (s.photo_link,s.dock_spec,s.dock_caliper,s.av_note,s.pick_note,s.match,s.loc_match_qty,s.date_completed) IS DISTINCT FROM
       (n.photo_link,n.spec,n.caliper,n.av_note,n.pick_note,n.match,n.loc_match_qty,n.date_completed);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.publish_drive_evidence_to_soc_v23142() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS publish_drive_evidence_to_soc_v23142 ON public.ph_master_inventory;
CREATE TRIGGER publish_drive_evidence_to_soc_v23142 AFTER UPDATE ON public.ph_master_inventory
REFERENCING OLD TABLE AS old_drive_evidence NEW TABLE AS new_drive_evidence
FOR EACH STATEMENT EXECUTE FUNCTION private.publish_drive_evidence_to_soc_v23142();

do $photos$
declare col record; normalizer text;
begin
  for col in
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c join pg_class t on t.relname=c.table_name
      join pg_namespace n on n.oid=t.relnamespace and n.nspname=c.table_schema
    where c.table_schema='public' and t.relkind in ('r','p')
      and c.table_name in ('ph_master_inventory','ph_location_sales_notes','ph_active_requests',
        'ph_requests_pending','ph_request_history','ph_active_suspend','ph_suspend_history',
        'ph_flyer_folders','ph_flyer_folder_items','ph_eval_work','ph_soc_master','inventory_projects','inventory_project_rows')
      and (c.data_type='jsonb' or (c.data_type in ('text','character varying') and c.column_name ~ '(photo|image|evidence)'))
  loop
    normalizer := case when col.data_type='jsonb' then 'normalize_photo_json_v23130' else 'normalize_storage_public_url_v23130' end;
    execute format('update public.%I set %I=private.%I(%I) where %I::text like %L and %I is distinct from private.%I(%I)',
      col.table_name,col.column_name,normalizer,col.column_name,col.column_name,'%/storage/v1/%/public/%',col.column_name,normalizer,col.column_name);
  end loop;
end $photos$;

COMMIT;
