begin;

set local lock_timeout = '2s';
set local statement_timeout = '10s';

-- The projection is written in the same transaction. Compare the complete
-- identity sets once instead of probing the materialized projection per row.
create or replace function private.drive_mode_projection_matches_source_v3039(p_file text,p_date date,p_count integer)
returns boolean language sql stable set search_path='' as $function$
  with projected as materialized (
    select history_key,source_unique_id,report_date
    from public.ph_drive_mode_history
    where source_kind='drive_around' and archive_reason='drive_file_snapshot' and source_file_id=p_file
  ), expected as materialized (
    select md5(p_file||'|'||unique_id) as history_key,unique_id as source_unique_id
    from public.ph_master_inventory
  )
  select (select count(*) from projected)=p_count
    and (select count(*) from expected)=p_count
    and not exists(
      select history_key,source_unique_id from expected
      except
      select history_key,source_unique_id from projected where report_date::text=p_date::text
    )
$function$;

-- JSONB already canonicalizes object keys. Preserve the digest byte-for-byte
-- while eliminating a sort and aggregate over every field of each source row.
create or replace function private.ph_master_bulk_source_hash_v1(p_values jsonb,p_raw_fields text[])
returns text language sql immutable security definer set search_path='' as $function$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'values', case when p_values is null then '{}'::jsonb
      when jsonb_typeof(p_values)='object' then p_values-array['last_updated','filename','concat','assignedto']
      else (select jsonb_object_agg(key,value) from jsonb_each(p_values))
      end,
    'rawFields', to_jsonb(coalesce(p_raw_fields,'{}'::text[]))
  )::text,'UTF8'),'sha256'),'hex')
$function$;

commit;
