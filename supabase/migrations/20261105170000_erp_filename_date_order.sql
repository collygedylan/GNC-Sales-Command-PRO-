BEGIN;
SET LOCAL lock_timeout='1200ms';
SET LOCAL statement_timeout='5s';
CREATE OR REPLACE FUNCTION public.check_erp_file_sync_needed_v1(p_dataset_key text, p_file_id text, p_file_name text, p_modified_at text, p_content_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '200ms'
 SET lock_timeout TO '50ms'
AS $function$
declare
  started_at timestamptz:=clock_timestamp();
  revision_key text:=private.fast_erp_dataset_key_v2369(p_dataset_key);
  modified_at timestamptz;
  content_hash text:=lower(nullif(btrim(coalesce(p_content_hash,'')),''));
  current_revision public.app_dataset_revisions%rowtype;
  up_to_date boolean:=false;
  incoming_parts text[]; active_parts text[]; incoming_order text; active_order text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='FAST_ERP_SYNC_CHECK_FORBIDDEN';
  end if;
  if revision_key is null or nullif(btrim(coalesce(p_file_id,'')),'') is null
     or nullif(btrim(coalesce(p_file_name,'')),'') is null
     or (content_hash is not null and content_hash !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='FAST_ERP_SYNC_CHECK_INVALID';
  end if;
  if btrim(p_file_name) like '~$%' or upper(btrim(p_file_name)) like 'TEMP\_%' escape '\' then
    return jsonb_build_object('up_to_date',true,'skip',true,'ignored',true,
      'file_name',btrim(p_file_name),'dataset_key',revision_key,
      'target_ms',50,
      'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
  end if;
  modified_at:=private.fast_erp_timestamptz_v2369(p_modified_at);
  select * into current_revision from public.app_dataset_revisions
  where key=revision_key and state='ready';
  -- ERP filename clocks precede the date; compare YYYYMMDD + the first HHMMSS.
  incoming_parts:=regexp_match(p_file_name,'([0-9]{6})(20[0-9]{6})([0-9]{6})');
  active_parts:=regexp_match(current_revision.source_file_name,'([0-9]{6})(20[0-9]{6})([0-9]{6})');
  incoming_order:=coalesce(incoming_parts[2]||incoming_parts[1],to_char(modified_at at time zone 'UTC','YYYYMMDDHH24MISS'));
  active_order:=coalesce(active_parts[2]||active_parts[1],to_char(current_revision.source_modified_at at time zone 'UTC','YYYYMMDDHH24MISS'));
  if incoming_order < active_order then
    return jsonb_build_object('up_to_date',true,'skip',true,'ignored',true,'superseded',true,
      'file_name',btrim(p_file_name),'dataset_key',revision_key,'target_ms',50,
      'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
  end if;
  if current_revision.key is not null and current_revision.source_file_id=btrim(p_file_id) then
    up_to_date:=case
      when content_hash is not null and current_revision.source_content_hash is not null
        then current_revision.source_content_hash=content_hash
      when modified_at is not null and current_revision.source_modified_at is not null
        then current_revision.source_modified_at=modified_at
      when modified_at is not null then coalesce(current_revision.source_imported_at,current_revision.changed_at)>=modified_at
      else current_revision.source_file_name=btrim(p_file_name)
    end;
    if up_to_date and (current_revision.source_modified_at is null or
        (content_hash is not null and current_revision.source_content_hash is null)) then
      update public.app_dataset_revisions set
        source_modified_at=coalesce(source_modified_at,modified_at),
        source_content_hash=coalesce(source_content_hash,content_hash)
      where key=revision_key and state='ready' and source_file_id=btrim(p_file_id);
    end if;
  end if;
  return jsonb_build_object('up_to_date',up_to_date,'skip',up_to_date,'ignored',false,
    'file_name',btrim(p_file_name),'dataset_key',revision_key,
    'target_ms',50,
    'duration_ms',round(extract(epoch from clock_timestamp()-started_at)*1000,3));
end
$function$
;
COMMIT;
