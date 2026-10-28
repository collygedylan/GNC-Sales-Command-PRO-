begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

create or replace function sales_private.rep_identity_key_v2394(value text)
returns text language sql immutable set search_path='' as $function$
  select coalesce(string_agg(part,' ' order by part),'')
  from regexp_split_to_table(lower(split_part(coalesce(value,''),'@',1)),'[^a-z0-9]+') part
  where part<>''
$function$;
revoke all on function sales_private.rep_identity_key_v2394(text) from public,anon,authenticated;
grant execute on function sales_private.rep_identity_key_v2394(text) to service_role;

create or replace function public.request_customer_directory_v2394(
  p_actor_id uuid,
  p_salesrep_identity text default '',
  p_salesrep_id text default '',
  p_page integer default 0,
  p_page_size integer default 200,
  p_q text default ''
) returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare actor public.profiles%rowtype; rows_value jsonb; total_value bigint; revision_value text;
  rep_key text:=sales_private.rep_identity_key_v2394(p_salesrep_identity); resolved_id text:=btrim(coalesce(p_salesrep_id,''));
begin
  select * into actor from public.profiles p where p.id=p_actor_id and p.disabled_at is null
    and not coalesce(p.must_change_password,false) and (p.locked_until is null or p.locked_until<=clock_timestamp());
  if actor.id is null then raise exception using errcode='42501',message='CUSTOMER_REP_MAPPING_PROFILE_INACTIVE'; end if;
  if p_page<0 or p_page>1000 or p_page_size<1 or p_page_size>200 or length(coalesce(p_q,''))>120
     or length(coalesce(p_salesrep_identity,''))>240 or length(coalesce(p_salesrep_id,''))>100 then
    raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_FILTER_INVALID';
  end if;

  if resolved_id='' and rep_key<>'' then
    select source.salesrepid into resolved_id from (
      select btrim(m.salesrepid) salesrepid,m.salesrepname from public.ph_customer_consignee_sales_reps m
      where nullif(btrim(m.salesrepid),'') is not null
      union all select btrim(s.salesrepid),s.salesrepname from public.ph_soc_master s where nullif(btrim(s.salesrepid),'') is not null
      union all select btrim(coalesce(to_jsonb(r)->>'salesrepid',to_jsonb(r)->>'salesrep_id','')),
        coalesce(to_jsonb(r)->>'salesrepname',to_jsonb(r)->>'salesrep',to_jsonb(r)->>'salesperson','') from public.ph_reserves r
    ) source where sales_private.rep_identity_key_v2394(source.salesrepname)=rep_key
    group by source.salesrepid order by count(*) desc,source.salesrepid limit 1;
  end if;

  with source_rows as materialized (
    select 0 source_priority,true rep_match,'AGDATA_NA_CUSTOMER'::text customeridentityid,'N/A'::text customername,
      'AGDATA_NA_CONSIGNEE'::text consigneeid,'N/A'::text consigneename
    union all
    select 1,(resolved_id<>'' and btrim(m.salesrepid)=resolved_id) or (rep_key<>'' and sales_private.rep_identity_key_v2394(m.salesrepname)=rep_key),
      btrim(m.customeridentityid),btrim(m.customername),btrim(m.consigneeid),btrim(m.consigneename)
    from public.ph_customer_consignee_sales_reps m
    where upper(btrim(coalesce(m.customerstatus,'')))='A' and upper(btrim(coalesce(m.consigneestatus,'')))='A'
    union all
    select 2,(resolved_id<>'' and btrim(s.salesrepid)=resolved_id) or (rep_key<>'' and sales_private.rep_identity_key_v2394(s.salesrepname)=rep_key),
      btrim(s.customeridentityid),btrim(s.customername),btrim(s.consigneeidentityid),btrim(s.consigneename) from public.ph_soc_master s
    union all
    select 3,(resolved_id<>'' and btrim(coalesce(to_jsonb(r)->>'salesrepid',to_jsonb(r)->>'salesrep_id',''))=resolved_id)
      or (rep_key<>'' and sales_private.rep_identity_key_v2394(coalesce(to_jsonb(r)->>'salesrepname',to_jsonb(r)->>'salesrep',to_jsonb(r)->>'salesperson',''))=rep_key),
      btrim(coalesce(to_jsonb(r)->>'customeridentityid','')),btrim(coalesce(to_jsonb(r)->>'customername',to_jsonb(r)->>'customer','')),
      btrim(coalesce(to_jsonb(r)->>'consigneeidentityid',to_jsonb(r)->>'consigneeid','')),btrim(coalesce(to_jsonb(r)->>'consigneename',to_jsonb(r)->>'consignee','')) from public.ph_reserves r
    union all
    select 4,(rep_key<>'' and sales_private.rep_identity_key_v2394(coalesce(to_jsonb(a)->>'request_selected_rep_display',to_jsonb(a)->>'sales_rep',to_jsonb(a)->>'requested_by',''))=rep_key),
      btrim(a.customeridentityid),btrim(a.customername),btrim(a.consigneeidentityid),btrim(a.consigneename) from public.ph_active_request a
    union all
    select 5,(rep_key<>'' and sales_private.rep_identity_key_v2394(coalesce(to_jsonb(h)->>'request_selected_rep_display',to_jsonb(h)->>'sales_rep',to_jsonb(h)->>'requested_by',''))=rep_key),
      btrim(h.customeridentityid),btrim(h.customername),btrim(h.consigneeidentityid),btrim(h.consigneename) from public.ph_request_history h
  ), valid_rows as materialized (
    select * from source_rows where nullif(customeridentityid,'') is not null and nullif(customername,'') is not null
      and nullif(consigneeid,'') is not null and nullif(consigneename,'') is not null
  ), canonical as materialized (
    select distinct on (lower(customeridentityid),lower(consigneeid),lower(customername),lower(consigneename))
      customeridentityid,customername,consigneeid,consigneename,bool_or(rep_match) over(partition by lower(customeridentityid),lower(consigneeid),lower(customername),lower(consigneename)) rep_match
    from valid_rows order by lower(customeridentityid),lower(consigneeid),lower(customername),lower(consigneename),source_priority
  ), filtered as materialized (
    select * from canonical c where btrim(coalesce(p_q,''))='' or concat_ws(' ',c.customeridentityid,c.customername,c.consigneeid,c.consigneename)
      ilike '%'||replace(replace(btrim(p_q),'\','\\'),'%','\%')||'%'
  ), paged as (
    select * from filtered order by (upper(customername)='N/A' and upper(consigneename)='N/A') desc,rep_match desc,
      customername,consigneename,customeridentityid,consigneeid limit p_page_size offset p_page*p_page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'unique_id','universal-'||md5(concat_ws(chr(31),coalesce(resolved_id,rep_key),customeridentityid,consigneeid,customername,consigneename)),
    'salesrepid',coalesce(nullif(resolved_id,''),p_salesrep_identity),'salesrepname',p_salesrep_identity,
    'customeridentityid',customeridentityid,'customername',customername,'consigneeid',consigneeid,'consigneename',consigneename,
    'customerstatus','A','consigneestatus','A','directory_scope',case when rep_match then 'Mapped Customers' else 'All Customers' end)
    order by (upper(customername)='N/A' and upper(consigneename)='N/A') desc,rep_match desc,customername,consigneename),'[]'::jsonb)
  into rows_value from paged;
  with source_rows as (
    select 'AGDATA_NA_CUSTOMER'::text customeridentityid,'N/A'::text customername,'AGDATA_NA_CONSIGNEE'::text consigneeid,'N/A'::text consigneename
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeid),btrim(consigneename) from public.ph_customer_consignee_sales_reps where upper(btrim(coalesce(customerstatus,'')))='A' and upper(btrim(coalesce(consigneestatus,'')))='A'
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeidentityid),btrim(consigneename) from public.ph_soc_master
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeidentityid),btrim(consigneename) from public.ph_reserves
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeidentityid),btrim(consigneename) from public.ph_active_request
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeidentityid),btrim(consigneename) from public.ph_request_history
  ) select count(*) into total_value from source_rows s where nullif(customeridentityid,'') is not null and nullif(customername,'') is not null
    and nullif(consigneeid,'') is not null and nullif(consigneename,'') is not null
    and (btrim(coalesce(p_q,''))='' or concat_ws(' ',s.customeridentityid,s.customername,s.consigneeid,s.consigneename) ilike '%'||replace(replace(btrim(p_q),'\','\\'),'%','\%')||'%');
  select coalesce(string_agg(key||':'||revision::text,',' order by key),'0') into revision_value from public.app_dataset_revisions
    where key in ('ph_customer_consignee_sales_reps','ph_soc_master','ph_reserves','ph_active_request','ph_request_history');
  return jsonb_build_object('ok',true,'rows',rows_value,'total',total_value,'page',p_page,'pageSize',p_page_size,
    'revision',revision_value,'universal',true,'salesrepId',resolved_id,'salesrepIdentity',p_salesrep_identity);
end $function$;
revoke all on function public.request_customer_directory_v2394(uuid,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.request_customer_directory_v2394(uuid,text,text,integer,integer,text) to service_role;

create or replace function sales_private.is_universal_request_tuple_v2394(
  p_customeridentityid text,p_customername text,p_consigneeidentityid text,p_consigneename text
) returns boolean language sql stable security definer set search_path='' as $function$
  select (btrim(p_customeridentityid)='AGDATA_NA_CUSTOMER' and upper(btrim(p_customername))='N/A'
      and btrim(p_consigneeidentityid)='AGDATA_NA_CONSIGNEE' and upper(btrim(p_consigneename))='N/A')
    or (btrim(p_customeridentityid) like 'AGDATA_CUSTOM_CUSTOMER_%' and btrim(p_consigneeidentityid) like 'AGDATA_CUSTOM_CONSIGNEE_%'
      and nullif(btrim(p_customername),'') is not null and nullif(btrim(p_consigneename),'') is not null
      and length(p_customername)<=300 and length(p_consigneename)<=300)
    or exists(select 1 from (
      select customeridentityid,customername,consigneeid consigneeidentityid,consigneename from public.ph_customer_consignee_sales_reps
        where upper(btrim(coalesce(customerstatus,'')))='A' and upper(btrim(coalesce(consigneestatus,'')))='A'
      union all select customeridentityid,customername,consigneeidentityid,consigneename from public.ph_soc_master
      union all select customeridentityid,customername,consigneeidentityid,consigneename from public.ph_reserves
      union all select customeridentityid,customername,consigneeidentityid,consigneename from public.ph_active_request
      union all select customeridentityid,customername,consigneeidentityid,consigneename from public.ph_request_history
    ) source_row where btrim(source_row.customeridentityid)=btrim(p_customeridentityid)
      and btrim(source_row.consigneeidentityid)=btrim(p_consigneeidentityid)
      and lower(btrim(source_row.customername))=lower(btrim(p_customername))
      and lower(btrim(source_row.consigneename))=lower(btrim(p_consigneename)))
$function$;
revoke all on function sales_private.is_universal_request_tuple_v2394(text,text,text,text) from public,anon,authenticated;
grant execute on function sales_private.is_universal_request_tuple_v2394(text,text,text,text) to service_role;

do $patch_request_trigger$
declare target regprocedure:='sales_private.require_active_customer_mapping_for_request_v1()'::regprocedure;
  definition text:=pg_get_functiondef(target); old_text text; new_text text;
begin
  if position('universal-request-directory-v2394' in definition)>0 then return; end if;
  old_text:=$old$if selected_id='AGDATA_EXECUTIVE_ALL' then$old$;
  new_text:=$new$-- universal-request-directory-v2394: every selected active rep accepts the bounded universal/custom directory.
  if selected_id is not null then$new$;
  if position(old_text in definition)=0 then raise exception 'AGDATA_V2394_REQUEST_TRIGGER_BRANCH_MISSING'; end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$where lower(btrim(profile.username))='jd_jones' and profile.disabled_at is null
      and not coalesce(profile.must_change_password,false)
      and (profile.locked_until is null or profile.locked_until<=clock_timestamp())
      and (lower(btrim(requested_identity))='jd_jones'
        or sales_private.rep_name_key(requested_identity)=sales_private.rep_name_key('JD Jones'))$old$;
  new_text:=$new$where profile.disabled_at is null and not coalesce(profile.must_change_password,false)
      and (profile.locked_until is null or profile.locked_until<=clock_timestamp())
      and (lower(btrim(profile.username))=lower(btrim(requested_identity))
        or sales_private.rep_identity_key_v2394(coalesce(nullif(btrim(profile.display_name),''),profile.username))
          =sales_private.rep_identity_key_v2394(requested_identity))$new$;
  if position(old_text in definition)=0 then raise exception 'AGDATA_V2394_REQUEST_TRIGGER_PROFILE_MISSING'; end if;
  definition:=replace(definition,old_text,new_text);
  definition:=replace(definition,'sales_private.is_jd_universal_request_tuple_v1','sales_private.is_universal_request_tuple_v2394');
  definition:=replace(definition,$old$canonical_name:='JD Jones';$old$,$new$canonical_name:=coalesce(nullif(btrim(selected_profile.display_name),''),selected_profile.username);$new$);
  execute definition;
end $patch_request_trigger$;

do $patch_suspend$
declare target regprocedure:='suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure;
  definition text:=pg_get_functiondef(target); old_text text; new_text text;
begin
  if position('suspend-physical-identity-v2394' in definition)>0 then
    definition:=replace(definition,'suspend_tag_private.rep_for_row(s) is distinct from actor.id',
      '(suspend_tag_private.rep_for_row(s)).id is distinct from actor.id');
    execute definition;
    return;
  end if;
  old_text:=$old$select * into s from public.ph_soc_master where unique_id=uid;
 if s.unique_id is null then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;$old$;
  new_text:=$new$-- suspend-physical-identity-v2394: resolve stale UIDs before the former early missing-source guard.
 select * into s from public.ph_soc_master where unique_id=uid;
 if s.unique_id is null and jsonb_typeof(p_payload->'sourceIdentity')='object' then
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
 if s.unique_id is null then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
 if regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g')='SALESREP'
    and (suspend_tag_private.rep_for_row(s)).id is distinct from actor.id then
   raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
 end if;$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'AGDATA_V2394_SUSPEND_EARLY_GUARD_ANCHOR_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$elsif actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;$old$;
  new_text:=$new$elsif regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in
      ('ADMIN','ADMINISTRATOR','MANAGER','EVALUATOR','INVENTORY','INVENTORYMANAGER','SALESREP')
      and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then
      raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;$new$;
  if position(old_text in definition)>0 then definition:=replace(definition,old_text,new_text); end if;

  old_text:=$old$if a.id is null or (a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)
       and not (p_operation='approval' and actor.username='dan_mccuistion')) then$old$;
  new_text:=$new$if a.id is null or (a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)
       and regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in ('ADMIN','ADMINISTRATOR','MANAGER','EVALUATOR','INVENTORY','INVENTORYMANAGER')
       and not (p_operation='approval' and actor.username='dan_mccuistion')) then$new$;
  if position(old_text in definition)>0 then definition:=replace(definition,old_text,new_text); end if;

  old_text:=$old$and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'lotcode','')))
      and upper(btrim(coalesce(candidate.consigneeidentityid,candidate.consigneename,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'consignee','')))$old$;
  new_text:=$new$and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'lotcode','')))
      -- suspend-physical-identity-v2394: shipped quantity/tag disambiguate duplicate physical order lines.
      and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'quantityshipped','')),'') is null
        or coalesce(nullif(regexp_replace(candidate.quantityshipped,'[^0-9.-]','','g'),''),'0')::numeric
          =coalesce(nullif(regexp_replace(p_payload->'sourceIdentity'->>'quantityshipped','[^0-9.-]','','g'),''),'0')::numeric)
      and (nullif(btrim(coalesce(p_payload->'sourceIdentity'->>'tagcode','')),'') is null
        or upper(btrim(coalesce(candidate.tagcode,'')))=upper(btrim(p_payload->'sourceIdentity'->>'tagcode')))
      and upper(btrim(coalesce(candidate.consigneeidentityid,candidate.consigneename,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'consignee','')))$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'AGDATA_V2394_SUSPEND_IDENTITY_ANCHOR_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
 elsif p_operation='decide' then$old$;
  new_text:=$new$result:=jsonb_build_object('ok',true,'completed',true,'unique_id',uid,'row',suspend_tag_private.row_json(uid));
 elsif p_operation='decide' then$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'AGDATA_V2394_SUSPEND_RECEIPT_ANCHOR_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
       values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),stamp)
       returning public.ph_request_delivery_outbox.event_id into event_id;
     update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;$old$;
  new_text:=$new$begin
       insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
         values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),stamp)
         returning public.ph_request_delivery_outbox.event_id into event_id;
       update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;
     exception when others then event_id:=null; end;$new$;
  if position(old_text in definition)>0 then definition:=replace(definition,old_text,new_text); end if;
  execute definition;
end $patch_suspend$;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('release','AgData v2.3.94','app_version','2.3.94'),'release-v2.3.94',clock_timestamp())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

do $verify$
begin
  if position('suspend-physical-identity-v2394' in pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))=0
    or to_regprocedure('public.request_customer_directory_v2394(uuid,text,text,integer,integer,text)') is null
    or not exists(select 1 from pg_class where oid='public.ph_suspend_history'::regclass and reloptions @> array['security_invoker=true'])
    or not exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.94') then
    raise exception 'AGDATA_V2394_INSTALL_FAILED';
  end if;
end $verify$;
commit;
