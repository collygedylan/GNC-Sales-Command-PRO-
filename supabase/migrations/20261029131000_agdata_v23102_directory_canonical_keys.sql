begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- Publish trusted canonical identity metadata for alias-preserving clients.
-- The executive branch is deliberately unchanged.
create or replace function public.request_customer_directory_v23102(
  p_actor_id uuid,p_salesrep_identity text default '',p_salesrep_id text default '',
  p_page integer default 0,p_page_size integer default 200,p_q text default ''
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare actor public.profiles%rowtype; resolved_id text:=upper(btrim(coalesce(p_salesrep_id,'')));
  rep_key text:=sales_private.rep_identity_key_v2394(p_salesrep_identity);
  rep_person_key text:=sales_private.rep_identity_key_v2394(split_part(coalesce(p_salesrep_identity,''),' - ',1));
  selected_key text;
  rows_value jsonb; total_value bigint; revision_value text; universal_actor boolean;
  catalog_ids text[]; catalog_names text[]; catalog_usernames text[]; catalog_profile_ids uuid[]; catalog_keys text[];
  selected_ids text[];
begin
  select * into actor from public.profiles p where p.id=p_actor_id and p.disabled_at is null
    and not coalesce(p.must_change_password,false) and (p.locked_until is null or p.locked_until<=clock_timestamp());
  if actor.id is null then raise exception using errcode='42501',message='CUSTOMER_REP_MAPPING_PROFILE_INACTIVE'; end if;
  if p_page<0 or p_page>1000 or p_page_size<1 or p_page_size>200 or length(coalesce(p_q,''))>120
    or length(coalesce(p_salesrep_identity,''))>240 or length(coalesce(p_salesrep_id,''))>100 then
    raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_FILTER_INVALID'; end if;
  universal_actor:=lower(btrim(coalesce(actor.username,'')))='jd_jones';
  if universal_actor then
    select public.request_jd_customer_directory_v1(p_actor_id,p_page,p_page_size,p_q) into rows_value;
    return jsonb_build_object('ok',coalesce((rows_value->>'ok')::boolean,true),'rows',coalesce(rows_value->'rows','[]'::jsonb),
      'total',coalesce((rows_value->>'total')::bigint,0),'page',p_page,'pageSize',p_page_size,
      'revision',coalesce(rows_value->>'revision','0'),'universal',true,'salesrepId','AGDATA_EXECUTIVE_ALL',
      'salesrepIdentity','JD Jones');
  end if;
  select array_agg(salesrepid order by salesrepid),array_agg(salesrepname order by salesrepid),
    array_agg(salesrep_username order by salesrepid),array_agg(salesrep_profile_id order by salesrepid),
    array_agg(salesrep_canonical_key order by salesrepid)
  into catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys
  from sales_private.customer_rep_catalog_v23102();
  if resolved_id<>'' then
    select c.salesrep_canonical_key into selected_key
      from unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
        as c(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
      where c.salesrepid=resolved_id limit 1;
    if selected_key is null then raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
    if rep_key<>'' and not exists(select 1
      from unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
        as c(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
      where c.salesrep_canonical_key=selected_key and (c.salesrep_canonical_key in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrep_username)=rep_key
        or sales_private.rep_identity_key_v2394(c.salesrepname) in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrepid)=rep_key)) then
      raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
  else
    if rep_key='' then raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
    select min(c.salesrepid),min(c.salesrep_canonical_key) into resolved_id,selected_key
    from unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
      as c(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
    where c.salesrep_profile_id=actor.id;
    if resolved_id is null then
      select min(c.salesrepid),min(c.salesrep_canonical_key) into resolved_id,selected_key
      from unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
        as c(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
      where c.salesrep_canonical_key in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrep_username)=rep_key
        or sales_private.rep_identity_key_v2394(c.salesrepname) in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrepid)=rep_key;
    end if;
    if resolved_id is null or not exists(select 1
      from unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
        as c(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
      where c.salesrep_canonical_key=selected_key and (c.salesrep_canonical_key in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrep_username)=rep_key
        or sales_private.rep_identity_key_v2394(c.salesrepname) in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrepid)=rep_key)) then
      raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
  end if;
  if regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') in ('REP','SALESREP','SALES') then
    if not exists(select 1 from unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
        as own(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
      where own.salesrep_profile_id=actor.id)
      or not exists(select 1
        from unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
          as own(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
        join unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
          as selected(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
          on selected.salesrepid=resolved_id
        where own.salesrep_profile_id=actor.id and own.salesrep_canonical_key=selected.salesrep_canonical_key) then
      raise exception using errcode='42501',message='CUSTOMER_REP_MAPPING_FORBIDDEN';
    end if;
  end if;
  select array_agg(c.salesrepid order by c.salesrepid) into selected_ids
  from unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
    as c(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
  where c.salesrep_canonical_key=selected_key;
  with catalog as materialized (
    select * from unnest(catalog_ids,catalog_names,catalog_usernames,catalog_profile_ids,catalog_keys)
      as c(salesrepid,salesrepname,salesrep_username,salesrep_profile_id,salesrep_canonical_key)
  ), matched as materialized (
    select distinct on (lower(btrim(m.customeridentityid)),lower(btrim(m.consigneeid)),lower(btrim(m.customername)),
      lower(btrim(m.consigneename)),c.salesrepid)
      m.unique_id,btrim(m.customeridentityid) customeridentityid,btrim(m.customername) customername,
      btrim(m.consigneeid) consigneeid,btrim(m.consigneename) consigneename,c.salesrepid,c.salesrepname,c.salesrep_canonical_key,
      coalesce(m.customerstatus,'A') customerstatus,coalesce(m.consigneestatus,'A') consigneestatus
    from public.ph_customer_consignee_sales_reps m join catalog c on c.salesrepid=upper(btrim(m.salesrepid))
    where upper(btrim(coalesce(m.customerstatus,'')))='A' and upper(btrim(coalesce(m.consigneestatus,'')))='A'
      and upper(btrim(m.salesrepid))=any(selected_ids)
      and nullif(btrim(m.customeridentityid),'') is not null and nullif(btrim(m.customername),'') is not null
      and nullif(btrim(m.consigneeid),'') is not null and nullif(btrim(m.consigneename),'') is not null
    order by lower(btrim(m.customeridentityid)),lower(btrim(m.consigneeid)),lower(btrim(m.customername)),
      lower(btrim(m.consigneename)),c.salesrepid,m.unique_id
  ), filtered as materialized (
    select * from matched x where btrim(coalesce(p_q,''))='' or concat_ws(' ',x.customeridentityid,x.customername,
      x.consigneeid,x.consigneename) ilike '%'||replace(replace(btrim(p_q),'\','\\'),'%','\%')||'%'
  ), paged as (
    select * from filtered order by (upper(customername)='N/A' and upper(consigneename)='N/A') desc,
      customername,consigneename,customeridentityid,consigneeid limit p_page_size offset p_page*p_page_size
  )
  select (select count(*) from filtered),
    (select coalesce(jsonb_agg(jsonb_build_object('unique_id',unique_id,'salesrepid',salesrepid,'salesrepname',salesrepname,
      'salesrep_canonical_key',salesrep_canonical_key,'customeridentityid',customeridentityid,'customername',customername,'consigneeid',consigneeid,'consigneename',consigneename,
      'customerstatus',customerstatus,'consigneestatus',consigneestatus,'directory_scope','Mapped Customers')
      order by (upper(customername)='N/A' and upper(consigneename)='N/A') desc,customername,consigneename), '[]'::jsonb) from paged)
  into total_value,rows_value;
  select coalesce(string_agg(key||':'||revision::text,',' order by key),'0') into revision_value
    from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps';
  return jsonb_build_object('ok',true,'rows',rows_value,'total',total_value,'page',p_page,'pageSize',p_page_size,
    'revision',revision_value,'universal',false,'salesrepId',resolved_id,'salesrepIdentity',p_salesrep_identity,
    'salesrepCanonicalKey',selected_key);
end
$function$;
revoke all on function public.request_customer_directory_v23102(uuid,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.request_customer_directory_v23102(uuid,text,text,integer,integer,text) to service_role;

commit;
