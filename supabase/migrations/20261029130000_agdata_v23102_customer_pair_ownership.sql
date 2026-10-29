begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- Preserve the externally supplied rep ID while resolving only verified identity aliases.
create or replace function sales_private.customer_rep_catalog_v23102()
returns table(salesrepid text, salesrepname text, salesrep_username text,
  salesrep_profile_id uuid, salesrep_canonical_key text)
language sql stable security definer set search_path = '' as $function$
  with source_ids as materialized (
    select distinct upper(btrim(m.salesrepid)) salesrepid, btrim(m.salesrepname) salesrepname
    from public.ph_customer_consignee_sales_reps m
    where nullif(btrim(m.salesrepid),'') is not null and nullif(btrim(m.salesrepname),'') is not null
    union
    select distinct upper(btrim(s.salesrepid)), btrim(s.salesrepname)
    from sales_private.customer_rep_assignment_sources s
    where nullif(btrim(s.salesrepid),'') is not null and nullif(btrim(s.salesrepname),'') is not null
    union
    select upper(btrim(i.identity_key)), coalesce(nullif(btrim(p.display_name),''),p.username)
    from sales_private.rep_identities i join public.profiles p on p.id=i.profile_id
    where i.kind='external_id' and i.verified_at is not null
      and p.disabled_at is null and not coalesce(p.must_change_password,false)
      and (p.locked_until is null or p.locked_until<=clock_timestamp())
      and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z]','','g') in ('REP','SALESREP','SALES')
    union
    select upper(btrim(p.username)),coalesce(nullif(btrim(p.display_name),''),p.username)
    from public.profiles p
    where p.disabled_at is null and not coalesce(p.must_change_password,false)
      and (p.locked_until is null or p.locked_until<=clock_timestamp())
      and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z]','','g') in ('REP','SALESREP','SALES')
      and nullif(btrim(p.username),'') is not null
      and not exists(select 1 from sales_private.rep_identities i where i.profile_id=p.id and i.kind='external_id')
  ), source_keys as materialized (
    select s.salesrepid,s.salesrepname,
      nullif(sales_private.rep_identity_key_v2394(s.salesrepname),'') name_key,
      nullif(sales_private.rep_identity_key_v2394(split_part(s.salesrepname,' - ',1)),'') person_key
    from source_ids s
  ), active_profiles as materialized (
    select p.id,p.username,p.display_name,
      nullif(sales_private.rep_identity_key_v2394(p.display_name),'') display_key,
      nullif(sales_private.rep_identity_key_v2394(p.username),'') username_key,
      nullif(sales_private.rep_identity_key_v2394(split_part(p.display_name,' - ',1)),'') display_person_key
    from public.profiles p
    where p.disabled_at is null and not coalesce(p.must_change_password,false)
      and (p.locked_until is null or p.locked_until<=clock_timestamp())
      and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z]','','g') in ('REP','SALESREP','SALES')
  ), known_external_ids as materialized (
    select distinct upper(btrim(i.identity_key)) external_id
    from sales_private.rep_identities i where i.kind='external_id' and i.verified_at is not null
      and nullif(btrim(i.identity_key),'') is not null
  ), verified_external as materialized (
    select distinct i.profile_id,upper(btrim(i.identity_key)) external_id
    from sales_private.rep_identities i join active_profiles p on p.id=i.profile_id
    where i.kind='external_id' and i.verified_at is not null and nullif(btrim(i.identity_key),'') is not null
  ), exact_candidates as materialized (
    select s.salesrepid,p.id profile_id,p.username,p.display_name,1 priority
    from source_keys s join verified_external x on x.external_id=s.salesrepid
    join active_profiles p on p.id=x.profile_id
    union all
    select s.salesrepid,p.id,p.username,p.display_name,1
    from source_keys s join active_profiles p on upper(btrim(p.username))=s.salesrepid
    where not exists(select 1 from verified_external x where x.external_id=s.salesrepid)
      and not exists(select 1 from known_external_ids x where x.external_id=s.salesrepid)
  ), exact_profile_counts as materialized (
    select salesrepid,count(distinct profile_id)::integer profile_count
    from exact_candidates group by salesrepid
  ), exact_matches as materialized (
    select distinct e.salesrepid,e.profile_id,e.username,e.display_name
    from exact_candidates e join exact_profile_counts c on c.salesrepid=e.salesrepid and c.profile_count=1
  ), profile_alias_keys as materialized (
    select p.id profile_id,p.username,p.display_name,p.display_key canonical_key,p.username_key
    from active_profiles p where p.display_key is not null
    union
    select p.id,p.username,p.display_name,
      p.display_person_key canonical_key,p.username_key
    from active_profiles p where p.display_person_key is not null
    union
    select p.id,p.username,p.display_name,
      nullif(sales_private.rep_identity_key_v2394(i.identity_key),'') canonical_key,p.username_key
    from sales_private.rep_identities i join active_profiles p on p.id=i.profile_id
    where i.kind in ('name','username') and i.verified_at is not null
      and nullif(sales_private.rep_identity_key_v2394(i.identity_key),'') is not null
  ), alias_candidates as materialized (
    select distinct s.salesrepid,a.profile_id,a.username,a.display_name
    from source_keys s join profile_alias_keys a on a.canonical_key in (s.person_key,s.name_key)
    where (s.person_key is not null or s.name_key is not null)
      and not exists(select 1 from known_external_ids x where x.external_id=s.salesrepid)
      and not exists(select 1 from exact_matches e where e.salesrepid=s.salesrepid)
  ), alias_profile_counts as materialized (
    select salesrepid,count(*)::integer profile_count from alias_candidates group by salesrepid
  ), alias_matches as materialized (
    select a.salesrepid,a.profile_id,a.username,a.display_name
    from alias_candidates a join alias_profile_counts c on c.salesrepid=a.salesrepid and c.profile_count=1
  ), profile_matches as materialized (
    select * from exact_matches union all select * from alias_matches
  ), resolved as materialized (
    select s.salesrepid,s.salesrepname,p.username salesrep_username,p.id salesrep_profile_id,
      coalesce(p.display_key,p.username_key,sales_private.rep_identity_key_v2394(s.salesrepid)) salesrep_canonical_key
    from source_keys s left join profile_matches m on m.salesrepid=s.salesrepid
    left join active_profiles p on p.id=m.profile_id
  )
  select distinct on (r.salesrepid) r.salesrepid,r.salesrepname,r.salesrep_username,
    r.salesrep_profile_id,r.salesrep_canonical_key
  from resolved r
  order by r.salesrepid, (r.salesrep_profile_id is not null) desc, r.salesrepname
$function$;
revoke all on function sales_private.customer_rep_catalog_v23102() from public,anon,authenticated;
grant execute on function sales_private.customer_rep_catalog_v23102() to service_role;

create or replace view public.ph_customer_rep_map with (security_invoker=true) as
select m.unique_id,m.customeridentityid,m.customername,m.consigneeid,m.consigneename,
  m.salesrepid,m.salesrepname,m.salesrepid as salesrep_id,m.salesrepname as salesrep_name,c.salesrep_username,c.salesrep_profile_id,c.salesrep_canonical_key,
  m.customerstatus,m.consigneestatus,m.territorycode,m.territorydesc,m.filename,m.source_file_name,
  m.mapping_revision,m.mapping_updated_by,m.updated_at
from public.ph_customer_consignee_sales_reps m
left join sales_private.customer_rep_catalog_v23102() c on c.salesrepid=upper(btrim(m.salesrepid));
revoke all on public.ph_customer_rep_map from PUBLIC,anon,authenticated;
grant select on public.ph_customer_rep_map to service_role;

create table if not exists sales_private.customer_rep_na_cleanup_v23102 (
  unique_id text primary key, original_row jsonb not null, archived_at timestamptz not null default clock_timestamp()
);
alter table sales_private.customer_rep_na_cleanup_v23102 enable row level security;
revoke all on sales_private.customer_rep_na_cleanup_v23102 from public,anon,authenticated,service_role;

-- Archive only positively identified legacy synthetic rows. Never touch source-ledger or maintained tuples.
with candidates as materialized (
  select m.unique_id,to_jsonb(m) original_row
  from public.ph_customer_consignee_sales_reps m
  where m.unique_id ~ '^cust_rep_na_[0-9a-f]{32}$'
    and m.filename='PROTECTED REQUEST N/A MAPPING' and m.source_file_name='PROTECTED REQUEST N/A MAPPING'
    and m.consigneeid='AGDATA_NA_CONSIGNEE' and upper(btrim(coalesce(m.consigneename,'')))='N/A'
    and m.customeridentityid<>'AGDATA_NA_CUSTOMER' and upper(btrim(coalesce(m.customername,'')))<>'N/A'
    and m.mapping_updated_by is null
    and not exists(select 1 from sales_private.customer_rep_assignment_sources s
      where s.unique_id=m.unique_id or (s.customeridentityid=m.customeridentityid and s.consigneeid=m.consigneeid))
    and not exists(select 1 from sales_private.customer_rep_assignment_overrides o
      where o.customeridentityid=m.customeridentityid and o.consigneeid=m.consigneeid)
), archived as (
  insert into sales_private.customer_rep_na_cleanup_v23102(unique_id,original_row)
  select unique_id,original_row from candidates on conflict(unique_id) do nothing returning unique_id
)
delete from public.ph_customer_consignee_sales_reps m using candidates c,archived a
where m.unique_id=c.unique_id and m.unique_id=a.unique_id
  and m.unique_id ~ '^cust_rep_na_[0-9a-f]{32}$'
  and m.filename='PROTECTED REQUEST N/A MAPPING' and m.source_file_name='PROTECTED REQUEST N/A MAPPING'
  and m.consigneeid='AGDATA_NA_CONSIGNEE' and m.customeridentityid<>'AGDATA_NA_CUSTOMER'
  and upper(btrim(coalesce(m.customername,'')))<>'N/A' and m.mapping_updated_by is null;

-- Keep one protected N/A/N/A tuple per active external rep ID, never one per customer.
create or replace function sales_private.ensure_request_na_customer_mappings_v1(p_run_id uuid default null)
returns integer language plpgsql security definer set search_path='' as $function$
declare affected integer;
begin
  with active_reps as (
    select distinct on (lower(btrim(salesrepid))) btrim(salesrepid) salesrepid,btrim(salesrepname) salesrepname,
      territorycode,territorydesc
    from (
      select m.salesrepid,m.salesrepname,m.territorycode,m.territorydesc,m.updated_at,m.unique_id
      from public.ph_customer_consignee_sales_reps m where p_run_id is null
        and nullif(btrim(m.salesrepid),'') is not null and nullif(btrim(m.salesrepname),'') is not null
        and upper(btrim(coalesce(m.customerstatus,'')))='A' and upper(btrim(coalesce(m.consigneestatus,'')))='A'
      union all
      select s.row_data->>'salesrepid',s.row_data->>'salesrepname',s.row_data->>'territorycode',s.row_data->>'territorydesc',
        null::timestamptz,s.unique_id from sales_private.customer_rep_mapping_import_stage s where p_run_id is not null and s.run_id=p_run_id
        and upper(btrim(coalesce(s.row_data->>'customerstatus','')))='A' and upper(btrim(coalesce(s.row_data->>'consigneestatus','')))='A'
      union all
      select i.identity_key,coalesce(nullif(btrim(p.display_name),''),p.username),null::text,null::text,p.updated_at,'profile:'||p.id::text
      from sales_private.rep_identities i join public.profiles p on p.id=i.profile_id
      where i.kind='external_id' and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z]','','g') in ('REP','SALESREP','SALES') and p.disabled_at is null
        and not coalesce(p.must_change_password,false) and (p.locked_until is null or p.locked_until<=clock_timestamp())
      union all
      select p.username,coalesce(nullif(btrim(p.display_name),''),p.username),null::text,null::text,p.updated_at,'profile:'||p.id::text
      from public.profiles p where regexp_replace(upper(coalesce(p.role,'')),'[^A-Z]','','g') in ('REP','SALESREP','SALES') and p.disabled_at is null
        and not coalesce(p.must_change_password,false) and (p.locked_until is null or p.locked_until<=clock_timestamp())
        and nullif(btrim(p.username),'') is not null
        and not exists(select 1 from sales_private.rep_identities i where i.profile_id=p.id and i.kind='external_id')
    ) x where nullif(btrim(salesrepid),'') is not null and nullif(btrim(salesrepname),'') is not null
    order by lower(btrim(salesrepid)),updated_at desc nulls last,unique_id
  )
  insert into public.ph_customer_consignee_sales_reps (
    unique_id,customeridentityid,customername,consigneeid,consigneename,salesrepid,salesrepname,territorycode,territorydesc,
    customerstatus,consigneestatus,filename,source_file_name,row_hash,imported_at,updated_at,raw_data
  )
  select 'cust_rep_na_'||md5(lower(btrim(r.salesrepid))||'|agdata_na_customer'),
    'AGDATA_NA_CUSTOMER','N/A','AGDATA_NA_CONSIGNEE','N/A',r.salesrepid,r.salesrepname,r.territorycode,r.territorydesc,
    'A','A','PROTECTED REQUEST N/A MAPPING','PROTECTED REQUEST N/A MAPPING',
    md5(lower(btrim(r.salesrepid))||'|agdata_na_customer|n/a'),clock_timestamp(),clock_timestamp(),
    jsonb_build_object('customeridentityid','AGDATA_NA_CUSTOMER','customername','N/A','consigneeid','AGDATA_NA_CONSIGNEE',
      'consigneename','N/A','salesrepid',r.salesrepid,'salesrepname',r.salesrepname,'customerstatus','A','consigneestatus','A')
  from active_reps r
  on conflict(unique_id) do update set salesrepid=excluded.salesrepid,salesrepname=excluded.salesrepname,
    territorycode=coalesce(excluded.territorycode,public.ph_customer_consignee_sales_reps.territorycode),
    territorydesc=coalesce(excluded.territorydesc,public.ph_customer_consignee_sales_reps.territorydesc),
    customerstatus='A',consigneestatus='A',updated_at=clock_timestamp(),
    mapping_revision=public.ph_customer_consignee_sales_reps.mapping_revision+1,mapping_updated_by=null,raw_data=excluded.raw_data;
  get diagnostics affected=row_count;
  return affected;
end
$function$;
revoke all on function sales_private.ensure_request_na_customer_mappings_v1(uuid) from public,anon,authenticated;
do $seed_canonical_na_rows$
begin
  perform sales_private.ensure_request_na_customer_mappings_v1(null);
end
$seed_canonical_na_rows$;

create or replace function public.request_customer_directory_v23102(
  p_actor_id uuid,p_salesrep_identity text default '',p_salesrep_id text default '',
  p_page integer default 0,p_page_size integer default 200,p_q text default ''
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare actor public.profiles%rowtype; resolved_id text:=upper(btrim(coalesce(p_salesrep_id,'')));
  rep_key text:=sales_private.rep_identity_key_v2394(p_salesrep_identity);
  rep_person_key text:=sales_private.rep_identity_key_v2394(split_part(coalesce(p_salesrep_identity,''),' - ',1));
  selected_key text;
  rows_value jsonb; total_value bigint; revision_value text; universal_actor boolean;
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
  if resolved_id<>'' then
    select c.salesrep_canonical_key into selected_key from sales_private.customer_rep_catalog_v23102() c
      where c.salesrepid=upper(resolved_id) limit 1;
    if selected_key is null then raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
    if rep_key<>'' then
      if not exists(select 1 from sales_private.customer_rep_catalog_v23102() c
        where c.salesrep_canonical_key=selected_key and (c.salesrep_canonical_key in (rep_key,rep_person_key)
          or sales_private.rep_identity_key_v2394(c.salesrep_username)=rep_key
          or sales_private.rep_identity_key_v2394(c.salesrepname) in (rep_key,rep_person_key)
          or sales_private.rep_identity_key_v2394(c.salesrepid)=rep_key)) then
        raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
    end if;
  else
    if rep_key='' then raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
    select min(c.salesrepid),min(c.salesrep_canonical_key) into resolved_id,selected_key
    from sales_private.customer_rep_catalog_v23102() c where c.salesrep_profile_id=actor.id;
    if resolved_id is null then
      select min(c.salesrepid),min(c.salesrep_canonical_key) into resolved_id,selected_key
      from sales_private.customer_rep_catalog_v23102() c
      where c.salesrep_canonical_key in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrep_username)=rep_key
        or sales_private.rep_identity_key_v2394(c.salesrepname) in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrepid)=rep_key;
    end if;
    if resolved_id is null or (rep_key<>'' and not exists(select 1 from sales_private.customer_rep_catalog_v23102() c
      where c.salesrep_canonical_key=selected_key and (c.salesrep_canonical_key in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrep_username)=rep_key
        or sales_private.rep_identity_key_v2394(c.salesrepname) in (rep_key,rep_person_key)
        or sales_private.rep_identity_key_v2394(c.salesrepid)=rep_key))) then
      raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
  end if;
  if regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') in ('REP','SALESREP','SALES') then
    if not exists(select 1 from sales_private.customer_rep_catalog_v23102() own
      where own.salesrep_profile_id=actor.id)
      or not exists(select 1 from sales_private.customer_rep_catalog_v23102() own
        join sales_private.customer_rep_catalog_v23102() selected on selected.salesrepid=resolved_id
        where own.salesrep_profile_id=actor.id
          and own.salesrep_canonical_key=selected.salesrep_canonical_key) then
      raise exception using errcode='42501',message='CUSTOMER_REP_MAPPING_FORBIDDEN';
    end if;
  end if;
  with catalog as materialized (select * from sales_private.customer_rep_catalog_v23102()),
  matched as materialized (
    select distinct on (lower(btrim(m.customeridentityid)),lower(btrim(m.consigneeid)),lower(btrim(m.customername)),
      lower(btrim(m.consigneename)),c.salesrepid)
      m.unique_id,btrim(m.customeridentityid) customeridentityid,btrim(m.customername) customername,
      btrim(m.consigneeid) consigneeid,btrim(m.consigneename) consigneename,c.salesrepid,c.salesrepname,
      coalesce(m.customerstatus,'A') customerstatus,coalesce(m.consigneestatus,'A') consigneestatus
    from public.ph_customer_consignee_sales_reps m
    join catalog c on c.salesrepid=upper(btrim(m.salesrepid))
    where upper(btrim(coalesce(m.customerstatus,'')))='A' and upper(btrim(coalesce(m.consigneestatus,'')))='A'
      and (c.salesrepid=resolved_id or (selected_key<>'' and c.salesrep_canonical_key=selected_key))
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
      'customeridentityid',customeridentityid,'customername',customername,'consigneeid',consigneeid,'consigneename',consigneename,
      'customerstatus',customerstatus,'consigneestatus',consigneestatus,'directory_scope','Mapped Customers')
      order by (upper(customername)='N/A' and upper(consigneename)='N/A') desc,customername,consigneename), '[]'::jsonb)
      from paged)
  into total_value,rows_value;
  select coalesce(string_agg(key||':'||revision::text,',' order by key),'0') into revision_value
    from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps';
  return jsonb_build_object('ok',true,'rows',rows_value,'total',total_value,'page',p_page,'pageSize',p_page_size,
    'revision',revision_value,'universal',false,'salesrepId',resolved_id,'salesrepIdentity',p_salesrep_identity);
end
$function$;
revoke all on function public.request_customer_directory_v23102(uuid,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.request_customer_directory_v23102(uuid,text,text,integer,integer,text) to service_role;


-- The same trigger guards inserts and tuple edits on ph_requests_pending. Existing
-- requests retain their drafts/history; only a changed ownership tuple is checked.
create or replace function sales_private.request_mapping_rep_allowed_v1(p_actor_id uuid,p_salesrep_id text)
returns boolean language sql stable security definer set search_path='' as $function$
  select exists(select 1 from public.profiles actor where actor.id=p_actor_id and actor.disabled_at is null
    and not coalesce(actor.must_change_password,false) and (actor.locked_until is null or actor.locked_until<=clock_timestamp())
    and (regexp_replace(upper(actor.role),'[^A-Z]','','g') not in ('REP','SALESREP','SALES')
      or exists(select 1 from sales_private.customer_rep_catalog_v23102() c
        where c.salesrep_profile_id=actor.id and upper(c.salesrepid)=upper(btrim(p_salesrep_id)))))
$function$;
revoke all on function sales_private.request_mapping_rep_allowed_v1(uuid,text) from public,anon,authenticated;

create or replace function sales_private.require_active_customer_mapping_for_request_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare selected_id text; requested_identity text; caller_id uuid:=auth.uid(); actor public.profiles%rowtype;
  owner_row record; canonical_name text; canonical_username text; canonical_email text;
begin
  if tg_op='UPDATE' and
    (old.customeridentityid,old.customername,old.consigneeidentityid,old.consigneename,old.requested_by,
      old.request_selected_rep_username,old.request_selected_rep_display,old.request_source,old.request_selected_salesrep_id)
    is not distinct from
    (new.customeridentityid,new.customername,new.consigneeidentityid,new.consigneename,new.requested_by,
      new.request_selected_rep_username,new.request_selected_rep_display,new.request_source,new.request_selected_salesrep_id) then return new;
  elsif tg_op='INSERT' and exists(select 1 from public.ph_active_request existing where existing.unique_id=new.unique_id) then return new;
  end if;
  if lower(btrim(coalesce(new.request_source,''))) not in ('general','av') then
    if coalesce(auth.role(),'')='service_role' then return new; end if;
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
  end if;
  if nullif(btrim(new.customeridentityid),'') is null or nullif(btrim(new.consigneeidentityid),'') is null
    or nullif(btrim(new.customername),'') is null or nullif(btrim(new.consigneename),'') is null then
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED'; end if;
  selected_id:=nullif(upper(btrim(new.request_selected_salesrep_id)),'');
  requested_identity:=coalesce(nullif(btrim(new.request_selected_rep_username),''),
    nullif(btrim(new.request_selected_rep_display),''),nullif(btrim(new.sales_rep),''));
  select * into actor from public.profiles p where p.disabled_at is null and not coalesce(p.must_change_password,false)
    and (p.locked_until is null or p.locked_until<=clock_timestamp())
    and (p.id=caller_id or (caller_id is null and coalesce(auth.role(),'')='service_role'
      and lower(btrim(p.username))=lower(btrim(new.request_created_by_username)))) limit 1;
  if selected_id='AGDATA_EXECUTIVE_ALL' then
    if actor.id is null or lower(btrim(actor.username))<>'jd_jones' then
      raise exception using errcode='42501',message='REQUEST_EXECUTIVE_DIRECTORY_FORBIDDEN'; end if;
    if not sales_private.is_jd_universal_request_tuple_v1(new.customeridentityid,new.customername,new.consigneeidentityid,new.consigneename) then
      raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED'; end if;
    canonical_name:='JD Jones'; canonical_username:=actor.username;
    select lower(btrim(u.email)) into canonical_email from auth.users u where u.id=actor.id and u.email_confirmed_at is not null;
  else
    with catalog as materialized (select * from sales_private.customer_rep_catalog_v23102())
    select c.* into owner_row from public.ph_customer_consignee_sales_reps m
      join catalog c on upper(btrim(m.salesrepid))=c.salesrepid
    where btrim(m.customeridentityid)=btrim(new.customeridentityid) and btrim(m.consigneeid)=btrim(new.consigneeidentityid)
      and lower(btrim(m.customername))=lower(btrim(new.customername)) and lower(btrim(m.consigneename))=lower(btrim(new.consigneename))
      and upper(btrim(m.customerstatus))='A' and upper(btrim(m.consigneestatus))='A'
      and (selected_id is null or c.salesrepid=selected_id)
      and (nullif(btrim(requested_identity),'') is null and selected_id is not null
        or sales_private.rep_identity_key_v2394(requested_identity) in (c.salesrep_canonical_key,
          sales_private.rep_identity_key_v2394(c.salesrepname),sales_private.rep_identity_key_v2394(c.salesrep_username),
          sales_private.rep_identity_key_v2394(c.salesrepid),sales_private.rep_identity_key_v2394(split_part(c.salesrepname,' - ',1)))
        or exists(select 1 from catalog alias where alias.salesrep_canonical_key=c.salesrep_canonical_key
          and sales_private.rep_identity_key_v2394(alias.salesrepid)=sales_private.rep_identity_key_v2394(requested_identity)))
      and (caller_id is null or sales_private.request_mapping_rep_allowed_v1(caller_id,c.salesrepid))
    order by c.salesrepid limit 1;
    if owner_row.salesrepid is null then raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED'; end if;
    selected_id:=owner_row.salesrepid; canonical_name:=owner_row.salesrepname; canonical_username:=owner_row.salesrep_username;
    select lower(btrim(u.email)) into canonical_email from auth.users u where u.id=owner_row.salesrep_profile_id and u.email_confirmed_at is not null;
  end if;
  new.request_selected_salesrep_id:=selected_id; new.request_selected_rep_display:=canonical_name;
  new.request_selected_rep_username:=canonical_username; new.request_selected_rep_email:=canonical_email; new.sales_rep:=canonical_name;
  return new;
end
$function$;
revoke all on function sales_private.require_active_customer_mapping_for_request_v1() from public,anon,authenticated;

-- The older service route must no longer expose the superseded broad directory.
create or replace function public.request_customer_directory_v2394(p_actor_id uuid,p_salesrep_identity text default '',
  p_salesrep_id text default '',p_page integer default 0,p_page_size integer default 200,p_q text default '')
returns jsonb language sql stable security definer set search_path='' as $function$
  select public.request_customer_directory_v23102(p_actor_id,p_salesrep_identity,p_salesrep_id,p_page,p_page_size,p_q)
$function$;
revoke all on function public.request_customer_directory_v2394(uuid,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.request_customer_directory_v2394(uuid,text,text,integer,integer,text) to service_role;

commit;
