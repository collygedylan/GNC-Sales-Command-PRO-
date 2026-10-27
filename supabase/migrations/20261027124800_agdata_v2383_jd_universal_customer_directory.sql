begin;

create or replace function public.request_jd_customer_directory_v1(
  p_actor_id uuid,
  p_page integer default 0,
  p_page_size integer default 200,
  p_q text default ''
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles%rowtype;
  rows_value jsonb;
  total_value bigint;
  revision_value text;
begin
  select * into actor from public.profiles p
  where p.id=p_actor_id and p.disabled_at is null and not coalesce(p.must_change_password,false)
    and (p.locked_until is null or p.locked_until<=clock_timestamp());
  if actor.id is null then
    raise exception using errcode='42501',message='CUSTOMER_REP_MAPPING_PROFILE_INACTIVE';
  end if;
  if p_page<0 or p_page>1000 or p_page_size<1 or p_page_size>200 or length(coalesce(p_q,''))>120 then
    raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_FILTER_INVALID';
  end if;

  with source_rows as materialized (
    select 0 source_priority,'AGDATA_NA_CUSTOMER'::text customeridentityid,'N/A'::text customername,
      'AGDATA_NA_CONSIGNEE'::text consigneeid,'N/A'::text consigneename
    union all
    select 1,btrim(m.customeridentityid),btrim(m.customername),btrim(m.consigneeid),btrim(m.consigneename)
    from public.ph_customer_consignee_sales_reps m
    where upper(btrim(coalesce(m.customerstatus,'')))='A' and upper(btrim(coalesce(m.consigneestatus,'')))='A'
    union all
    select 2,btrim(s.customeridentityid),btrim(s.customername),btrim(s.consigneeidentityid),btrim(s.consigneename)
    from public.ph_soc_master s
    union all
    select 3,btrim(r.customeridentityid),btrim(r.customername),btrim(r.consigneeidentityid),btrim(r.consigneename)
    from public.ph_reserves r
    union all
    select 4,btrim(a.customeridentityid),btrim(a.customername),btrim(a.consigneeidentityid),btrim(a.consigneename)
    from public.ph_active_request a
    union all
    select 5,btrim(h.customeridentityid),btrim(h.customername),btrim(h.consigneeidentityid),btrim(h.consigneename)
    from public.ph_request_history h
  ), valid_rows as materialized (
    select * from source_rows
    where nullif(customeridentityid,'') is not null and nullif(customername,'') is not null
      and nullif(consigneeid,'') is not null and nullif(consigneename,'') is not null
  ), canonical as materialized (
    select distinct on (lower(customeridentityid),lower(consigneeid),lower(customername),lower(consigneename))
      customeridentityid,customername,consigneeid,consigneename
    from valid_rows
    order by lower(customeridentityid),lower(consigneeid),lower(customername),lower(consigneename),source_priority
  ), filtered as materialized (
    select * from canonical c
    where btrim(coalesce(p_q,''))='' or concat_ws(' ',c.customeridentityid,c.customername,c.consigneeid,c.consigneename)
      ilike '%'||replace(replace(btrim(p_q),'\\','\\\\'),'%','\\%')||'%'
  ), paged as (
    select * from filtered
    order by (upper(customername)='N/A' and upper(consigneename)='N/A') desc,
      customername,consigneename,customeridentityid,consigneeid
    limit p_page_size offset p_page*p_page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'unique_id','jd-exec-'||md5(concat_ws(chr(31),customeridentityid,consigneeid,customername,consigneename)),
    'salesrepid','AGDATA_EXECUTIVE_ALL','salesrepname','JD Jones',
    'customeridentityid',customeridentityid,'customername',customername,
    'consigneeid',consigneeid,'consigneename',consigneename,
    'customerstatus','A','consigneestatus','A'
  ) order by (upper(customername)='N/A' and upper(consigneename)='N/A') desc,
    customername,consigneename,customeridentityid,consigneeid),'[]'::jsonb)
  into rows_value from paged;

  with source_rows as (
    select 'AGDATA_NA_CUSTOMER'::text customeridentityid,'N/A'::text customername,
      'AGDATA_NA_CONSIGNEE'::text consigneeid,'N/A'::text consigneename
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeid),btrim(consigneename)
      from public.ph_customer_consignee_sales_reps where upper(btrim(coalesce(customerstatus,'')))='A' and upper(btrim(coalesce(consigneestatus,'')))='A'
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeidentityid),btrim(consigneename) from public.ph_soc_master
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeidentityid),btrim(consigneename) from public.ph_reserves
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeidentityid),btrim(consigneename) from public.ph_active_request
    union select btrim(customeridentityid),btrim(customername),btrim(consigneeidentityid),btrim(consigneename) from public.ph_request_history
  ) select count(*) into total_value from source_rows s
  where nullif(customeridentityid,'') is not null and nullif(customername,'') is not null
    and nullif(consigneeid,'') is not null and nullif(consigneename,'') is not null
    and (btrim(coalesce(p_q,''))='' or concat_ws(' ',s.customeridentityid,s.customername,s.consigneeid,s.consigneename)
      ilike '%'||replace(replace(btrim(p_q),'\\','\\\\'),'%','\\%')||'%');

  select coalesce(string_agg(key||':'||revision::text,',' order by key),'0') into revision_value
  from public.app_dataset_revisions
  where key in ('ph_customer_consignee_sales_reps','ph_soc_master','ph_reserves','ph_active_request','ph_request_history');
  return jsonb_build_object('ok',true,'rows',rows_value,'total',total_value,'page',p_page,
    'pageSize',p_page_size,'revision',revision_value,'universal',true);
end
$function$;
revoke all on function public.request_jd_customer_directory_v1(uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function public.request_jd_customer_directory_v1(uuid,integer,integer,text) to service_role;

create or replace function sales_private.is_jd_universal_request_tuple_v1(
  p_customeridentityid text,p_customername text,p_consigneeidentityid text,p_consigneename text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (btrim(p_customeridentityid)='AGDATA_NA_CUSTOMER' and upper(btrim(p_customername))='N/A'
      and btrim(p_consigneeidentityid)='AGDATA_NA_CONSIGNEE' and upper(btrim(p_consigneename))='N/A')
    or exists(
      select 1 from (
        select customeridentityid,customername,consigneeid consigneeidentityid,consigneename
        from public.ph_customer_consignee_sales_reps
        where upper(btrim(coalesce(customerstatus,'')))='A' and upper(btrim(coalesce(consigneestatus,'')))='A'
        union all select customeridentityid,customername,consigneeidentityid,consigneename from public.ph_soc_master
        union all select customeridentityid,customername,consigneeidentityid,consigneename from public.ph_reserves
        union all select customeridentityid,customername,consigneeidentityid,consigneename from public.ph_active_request
        union all select customeridentityid,customername,consigneeidentityid,consigneename from public.ph_request_history
      ) source_row
      where btrim(source_row.customeridentityid)=btrim(p_customeridentityid)
        and btrim(source_row.consigneeidentityid)=btrim(p_consigneeidentityid)
        and lower(btrim(source_row.customername))=lower(btrim(p_customername))
        and lower(btrim(source_row.consigneename))=lower(btrim(p_consigneename))
    )
$function$;
revoke all on function sales_private.is_jd_universal_request_tuple_v1(text,text,text,text) from public,anon,authenticated;
grant execute on function sales_private.is_jd_universal_request_tuple_v1(text,text,text,text) to service_role;

create or replace function sales_private.require_active_customer_mapping_for_request_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  matches integer;
  selected_id text;
  canonical_name text;
  canonical_username text;
  canonical_email text;
  requested_identity text;
  selected_profile public.profiles%rowtype;
  caller_id uuid:=auth.uid();
begin
  if tg_op='UPDATE' and
    (old.customeridentityid,old.customername,old.consigneeidentityid,old.consigneename,
      old.requested_by,old.request_selected_rep_username,old.request_selected_rep_display,old.request_source,old.request_selected_salesrep_id)
    is not distinct from
    (new.customeridentityid,new.customername,new.consigneeidentityid,new.consigneename,
      new.requested_by,new.request_selected_rep_username,new.request_selected_rep_display,new.request_source,new.request_selected_salesrep_id) then
    return new;
  elsif tg_op='INSERT' and exists(select 1 from public.ph_active_request existing where existing.unique_id=new.unique_id) then
    return new;
  end if;
  if lower(btrim(coalesce(new.request_source,''))) not in ('general','av') then
    if coalesce(auth.role(),'')='service_role' then return new; end if;
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
  end if;
  if nullif(btrim(new.customeridentityid),'') is null or nullif(btrim(new.consigneeidentityid),'') is null
    or nullif(btrim(new.customername),'') is null or nullif(btrim(new.consigneename),'') is null then
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
  end if;
  selected_id:=nullif(btrim(new.request_selected_salesrep_id),'');
  if selected_id='AGDATA_EXECUTIVE_ALL' then
    requested_identity:=coalesce(nullif(btrim(new.request_selected_rep_username),''),
      nullif(btrim(new.request_selected_rep_display),''),nullif(btrim(new.sales_rep),''),nullif(btrim(new.requested_by),''));
    select profile.* into selected_profile from public.profiles profile
    where lower(btrim(profile.username))='jd_jones' and profile.disabled_at is null
      and not coalesce(profile.must_change_password,false)
      and (profile.locked_until is null or profile.locked_until<=clock_timestamp())
      and (lower(btrim(requested_identity))='jd_jones'
        or sales_private.rep_name_key(requested_identity)=sales_private.rep_name_key('JD Jones'))
    limit 1;
    if selected_profile.id is null then raise exception using errcode='22023',message='REQUEST_SELECTED_USER_REQUIRED'; end if;
    if not sales_private.is_jd_universal_request_tuple_v1(new.customeridentityid,new.customername,new.consigneeidentityid,new.consigneename) then
      raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
    end if;
    canonical_name:='JD Jones';
    canonical_username:=selected_profile.username;
    select lower(btrim(auth_user.email)) into canonical_email from auth.users auth_user
      where auth_user.id=selected_profile.id and auth_user.email_confirmed_at is not null;
  elsif selected_id is not null then
    select count(distinct btrim(mapping.salesrepid)) into matches
    from public.ph_customer_consignee_sales_reps mapping
    where btrim(mapping.customeridentityid)=btrim(new.customeridentityid)
      and btrim(mapping.consigneeid)=btrim(new.consigneeidentityid)
      and lower(btrim(mapping.customername))=lower(btrim(new.customername))
      and lower(btrim(mapping.consigneename))=lower(btrim(new.consigneename))
      and btrim(mapping.salesrepid)=selected_id
      and upper(btrim(mapping.customerstatus))='A' and upper(btrim(mapping.consigneestatus))='A'
      and (caller_id is null or sales_private.request_mapping_rep_allowed_v1(caller_id,mapping.salesrepid));
    if matches<>1 then raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED'; end if;
    select btrim(mapping.salesrepname),rep.username,lower(btrim(auth_user.email))
    into canonical_name,canonical_username,canonical_email
    from public.ph_customer_consignee_sales_reps mapping
    left join sales_private.rep_identities identity on identity.kind='external_id'
      and identity.identity_key=sales_private.key(mapping.salesrepid)
    left join public.profiles rep on rep.id=identity.profile_id and rep.disabled_at is null
      and not coalesce(rep.must_change_password,false) and (rep.locked_until is null or rep.locked_until<=clock_timestamp())
    left join auth.users auth_user on auth_user.id=rep.id and auth_user.email_confirmed_at is not null
    where btrim(mapping.customeridentityid)=btrim(new.customeridentityid)
      and btrim(mapping.consigneeid)=btrim(new.consigneeidentityid)
      and btrim(mapping.salesrepid)=selected_id
      and upper(btrim(mapping.customerstatus))='A' and upper(btrim(mapping.consigneestatus))='A'
    order by rep.username nulls last limit 1;
  else
    select count(*) into matches from public.ph_customer_consignee_sales_reps mapping
    where btrim(mapping.customeridentityid)=btrim(new.customeridentityid)
      and btrim(mapping.consigneeid)=btrim(new.consigneeidentityid)
      and lower(btrim(mapping.customername))=lower(btrim(new.customername))
      and lower(btrim(mapping.consigneename))=lower(btrim(new.consigneename))
      and upper(btrim(mapping.customerstatus))='A' and upper(btrim(mapping.consigneestatus))='A';
    if matches<1 then raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED'; end if;
    requested_identity:=coalesce(nullif(btrim(new.request_selected_rep_username),''),
      nullif(btrim(new.request_selected_rep_display),''),nullif(btrim(new.sales_rep),''));
    select profile.* into selected_profile from public.profiles profile
    where profile.disabled_at is null and not coalesce(profile.must_change_password,false)
      and (profile.locked_until is null or profile.locked_until<=clock_timestamp())
      and (lower(btrim(profile.username))=lower(btrim(requested_identity))
        or sales_private.rep_name_key(coalesce(nullif(btrim(profile.display_name),''),profile.username))
          =sales_private.rep_name_key(requested_identity))
    order by (lower(btrim(profile.username))=lower(btrim(requested_identity))) desc,profile.username limit 1;
    if selected_profile.id is null then raise exception using errcode='22023',message='REQUEST_SELECTED_USER_REQUIRED'; end if;
    canonical_name:=coalesce(nullif(btrim(selected_profile.display_name),''),selected_profile.username);
    canonical_username:=selected_profile.username;
    select lower(btrim(auth_user.email)) into canonical_email from auth.users auth_user
      where auth_user.id=selected_profile.id and auth_user.email_confirmed_at is not null;
  end if;
  new.request_selected_salesrep_id:=selected_id;
  new.request_selected_rep_display:=canonical_name;
  new.request_selected_rep_username:=canonical_username;
  new.request_selected_rep_email:=canonical_email;
  new.sales_rep:=canonical_name;
  return new;
end
$function$;
revoke all on function sales_private.require_active_customer_mapping_for_request_v1() from public,anon,authenticated;

commit;
