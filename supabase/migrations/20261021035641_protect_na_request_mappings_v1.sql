begin;
set local lock_timeout = '5s';

create or replace function sales_private.protect_request_na_customer_mapping_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op = 'DELETE' then
    if old.customeridentityid = 'AGDATA_NA_CUSTOMER'
      and old.consigneeid = 'AGDATA_NA_CONSIGNEE'
      and upper(btrim(coalesce(old.customername, ''))) = 'N/A'
      and upper(btrim(coalesce(old.consigneename, ''))) = 'N/A'
      and nullif(btrim(old.salesrepid), '') is not null then
      raise exception using errcode = '55000', message = 'REQUEST_NA_MAPPING_PROTECTED';
    end if;
    return old;
  end if;

  if old.customeridentityid = 'AGDATA_NA_CUSTOMER'
    and old.consigneeid = 'AGDATA_NA_CONSIGNEE'
    and upper(btrim(coalesce(old.customername, ''))) = 'N/A'
    and upper(btrim(coalesce(old.consigneename, ''))) = 'N/A'
    and nullif(btrim(old.salesrepid), '') is not null then
    new.unique_id := old.unique_id;
    new.customeridentityid := old.customeridentityid;
    new.customername := 'N/A';
    new.consigneeid := old.consigneeid;
    new.consigneename := 'N/A';
    new.salesrepid := old.salesrepid;
    new.salesrepname := coalesce(nullif(btrim(new.salesrepname), ''), old.salesrepname);
    new.customerstatus := 'A';
    new.consigneestatus := 'A';
  end if;
  return new;
end
$function$;
revoke all on function sales_private.protect_request_na_customer_mapping_v1() from public, anon, authenticated;

drop trigger if exists protect_request_na_customer_mapping_v1 on public.ph_customer_consignee_sales_reps;
create trigger protect_request_na_customer_mapping_v1
  before update or delete on public.ph_customer_consignee_sales_reps
  for each row execute function sales_private.protect_request_na_customer_mapping_v1();

create or replace function sales_private.ensure_request_na_customer_mappings_v1(p_run_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $function$
declare affected integer;
begin
  with active_reps as (
    select distinct on (lower(btrim(salesrepid)))
      btrim(salesrepid) as salesrepid, btrim(salesrepname) as salesrepname,
      territorycode, territorydesc
    from (
      select m.salesrepid, m.salesrepname, m.territorycode, m.territorydesc, m.updated_at, m.unique_id
      from public.ph_customer_consignee_sales_reps m
      where p_run_id is null
        and nullif(btrim(m.salesrepid), '') is not null and nullif(btrim(m.salesrepname), '') is not null
        and upper(btrim(coalesce(m.customerstatus, ''))) = 'A'
        and upper(btrim(coalesce(m.consigneestatus, ''))) = 'A'
      union all
      select s.row_data->>'salesrepid', s.row_data->>'salesrepname',
        s.row_data->>'territorycode', s.row_data->>'territorydesc',
        null::timestamptz, s.unique_id
      from sales_private.customer_rep_mapping_import_stage s
      where p_run_id is not null and s.run_id = p_run_id
        and upper(btrim(coalesce(s.row_data->>'customerstatus', ''))) = 'A'
        and upper(btrim(coalesce(s.row_data->>'consigneestatus', ''))) = 'A'
      union all
      select identity.identity_key as salesrepid,
        coalesce(nullif(btrim(profile.display_name), ''), profile.username) as salesrepname,
        null::text as territorycode, null::text as territorydesc,
        profile.updated_at, 'profile:' || profile.id::text as unique_id
      from sales_private.rep_identities identity
      join public.profiles profile on profile.id = identity.profile_id
      where identity.kind = 'external_id'
        and upper(btrim(coalesce(profile.role, ''))) in ('REP', 'SALESREP', 'SALES')
        and profile.disabled_at is null and not profile.must_change_password
        and (profile.locked_until is null or profile.locked_until <= clock_timestamp())
    ) rep_rows
    order by lower(btrim(salesrepid)), updated_at desc nulls last, unique_id
  ), active_customers as (
    select distinct on (lower(btrim(salesrepid)), lower(btrim(customeridentityid)))
      btrim(salesrepid) as salesrepid, btrim(salesrepname) as salesrepname,
      btrim(customeridentityid) as customeridentityid, btrim(customername) as customername,
      territorycode, territorydesc
    from (
      select m.salesrepid, m.salesrepname, m.customeridentityid, m.customername,
        m.territorycode, m.territorydesc, m.updated_at, m.unique_id
      from public.ph_customer_consignee_sales_reps m
      where p_run_id is null
        and nullif(btrim(m.salesrepid), '') is not null and nullif(btrim(m.salesrepname), '') is not null
        and nullif(btrim(m.customeridentityid), '') is not null and nullif(btrim(m.customername), '') is not null
        and upper(btrim(coalesce(m.customerstatus, ''))) = 'A'
        and upper(btrim(coalesce(m.consigneestatus, ''))) = 'A'
      union all
      select s.row_data->>'salesrepid', s.row_data->>'salesrepname',
        s.row_data->>'customeridentityid', s.row_data->>'customername',
        s.row_data->>'territorycode', s.row_data->>'territorydesc', null::timestamptz, s.unique_id
      from sales_private.customer_rep_mapping_import_stage s
      where p_run_id is not null and s.run_id = p_run_id
        and upper(btrim(coalesce(s.row_data->>'customerstatus', ''))) = 'A'
        and upper(btrim(coalesce(s.row_data->>'consigneestatus', ''))) = 'A'
    ) customer_rows
    where nullif(btrim(salesrepid), '') is not null
      and nullif(btrim(customeridentityid), '') is not null
      and upper(btrim(coalesce(customername, ''))) <> 'N/A'
    order by lower(btrim(salesrepid)), lower(btrim(customeridentityid)), updated_at desc nulls last, unique_id
  ), na_options as (
    select rep.salesrepid, rep.salesrepname, rep.territorycode, rep.territorydesc,
      'AGDATA_NA_CUSTOMER'::text as customeridentityid, 'N/A'::text as customername
    from active_reps rep
    union all
    select customer.salesrepid, customer.salesrepname, customer.territorycode, customer.territorydesc,
      customer.customeridentityid, customer.customername
    from active_customers customer
  )
  insert into public.ph_customer_consignee_sales_reps (
    unique_id, customeridentityid, customername, consigneeid, consigneename,
    salesrepid, salesrepname, territorycode, territorydesc,
    customerstatus, consigneestatus, filename, source_file_name, row_hash,
    imported_at, updated_at, raw_data
  )
  select
    'cust_rep_na_' || md5(lower(btrim(option.salesrepid)) || '|' || lower(btrim(option.customeridentityid))),
    option.customeridentityid, option.customername, 'AGDATA_NA_CONSIGNEE', 'N/A',
    option.salesrepid, option.salesrepname, option.territorycode, option.territorydesc,
    'A', 'A', 'PROTECTED REQUEST N/A MAPPING', 'PROTECTED REQUEST N/A MAPPING',
    md5(lower(btrim(option.salesrepid)) || '|' || lower(btrim(option.customeridentityid)) || '|N/A'), clock_timestamp(), clock_timestamp(),
    jsonb_build_object('customeridentityid',option.customeridentityid,'customername',option.customername,
      'consigneeid','AGDATA_NA_CONSIGNEE','consigneename','N/A','salesrepid',option.salesrepid,
      'salesrepname',option.salesrepname,'customerstatus','A','consigneestatus','A')
  from na_options option
  on conflict (unique_id) do update set
    customeridentityid = excluded.customeridentityid,
    customername = excluded.customername,
    consigneeid = excluded.consigneeid,
    consigneename = excluded.consigneename,
    salesrepid = excluded.salesrepid,
    salesrepname = excluded.salesrepname,
    territorycode = coalesce(excluded.territorycode, public.ph_customer_consignee_sales_reps.territorycode),
    territorydesc = coalesce(excluded.territorydesc, public.ph_customer_consignee_sales_reps.territorydesc),
    filename = excluded.filename,
    source_file_name = excluded.source_file_name,
    row_hash = excluded.row_hash,
    raw_data = excluded.raw_data,
    customerstatus = 'A',
    consigneestatus = 'A',
    updated_at = clock_timestamp(),
    mapping_revision = public.ph_customer_consignee_sales_reps.mapping_revision + 1,
    mapping_updated_by = null;
  get diagnostics affected = row_count;
  return affected;
end
$function$;
revoke all on function sales_private.ensure_request_na_customer_mappings_v1(uuid) from public, anon, authenticated;

do $seed_existing_request_na$
begin
  perform sales_private.ensure_request_na_customer_mappings_v1(null);
end
$seed_existing_request_na$;

do $protect_import_cleanup$
declare source text;
  old_clause text := 'delete from public.ph_customer_consignee_sales_reps m where not exists(';
  protected_clause text := 'delete from public.ph_customer_consignee_sales_reps m where not ('
    ||'m.customeridentityid = ''AGDATA_NA_CUSTOMER'' and m.consigneeid = ''AGDATA_NA_CONSIGNEE'' '
    ||'and upper(btrim(coalesce(m.customername, ''''))) = ''N/A'' '
    ||'and upper(btrim(coalesce(m.consigneename, ''''))) = ''N/A'' '
    ||'and nullif(btrim(m.salesrepid), '''') is not null) and not exists(';
begin
  source := pg_get_functiondef('public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure);
  if position(protected_clause in source) > 0 then return; end if;
  if position(old_clause in source) = 0 then
    raise exception 'CUSTOMER_REP_IMPORT_FINALIZER_SHAPE_UNRECOGNIZED';
  end if;
  execute replace(source, old_clause, protected_clause);
end
$protect_import_cleanup$;

do $protect_import_seed$
declare source text;
  old_clause text := 'perform sales_private.customer_rep_assignment_apply_overrides_v1(p_run_id);';
  protected_clause text := old_clause || E'\n  perform sales_private.ensure_request_na_customer_mappings_v1(p_run_id);';
begin
  source := pg_get_functiondef('public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure);
  if position('ensure_request_na_customer_mappings_v1(p_run_id)' in source) > 0 then return; end if;
  if position(old_clause in source) = 0 then
    raise exception 'CUSTOMER_REP_IMPORT_FINALIZER_SEED_SHAPE_UNRECOGNIZED';
  end if;
  execute replace(source, old_clause, protected_clause);
end
$protect_import_seed$;

commit;
