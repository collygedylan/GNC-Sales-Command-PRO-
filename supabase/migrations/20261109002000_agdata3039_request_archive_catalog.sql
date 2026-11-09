begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.ph_photo_archive_jobs add column if not exists archive_path_receipts jsonb not null default '[]'::jsonb;
alter table public.ph_photo_archive_jobs add constraint photo_archive_path_receipts_array_v3039
  check(jsonb_typeof(archive_path_receipts)='array') not valid;
create index if not exists ph_photo_archive_jobs_source_url_v3039
  on public.ph_photo_archive_jobs(source_url) where source_url is not null;

-- Keep extraction shared with the reader, but inspect every reference before
-- authorizing deletion. The display reader still limits its result to 20.
create or replace function private.archive_photo_links_v3039(p_photos jsonb,p_links text[])
returns setof text language sql immutable set search_path='' as $function$
  with candidates as (
    select case jsonb_typeof(item)
      when 'string' then item#>>'{}'
      when 'object' then coalesce(item->>'url',item->>'photo_url',item->>'photoUrl',item->>'href',item->>'link')
      else null end value
    from jsonb_array_elements(case when jsonb_typeof(p_photos)='array' then p_photos else '[]'::jsonb end) item
    union all
    select link from unnest(coalesce(p_links,'{}'::text[])) link
  )
  select distinct btrim(link)
  from candidates cross join lateral regexp_split_to_table(coalesce(value,''),'\s*[,|;\n]\s*') link
  where btrim(link) ~* '^(https?://|/[^/])'
$function$;

create or replace function private.archive_photo_array_v2366(p_photos jsonb,p_links text[] default '{}'::text[])
returns jsonb language sql immutable set search_path='' as $function$
  select coalesce(jsonb_agg(link order by link),'[]'::jsonb)
  from (select link from private.archive_photo_links_v3039(p_photos,p_links) link order by link limit 20) links
$function$;

create or replace function private.request_archive_photo_object_v3039(p_url text)
returns text language plpgsql immutable strict set search_path='' as $function$
declare encoded_path text; decoded_path text; bucket text; object_path text; decoded_bytes bytea;
begin
  encoded_path:=(regexp_match(btrim(p_url),
    '^(?:https?://kzrnyjsosryejjejliii\.supabase\.co)?/storage/v1/(?:object/(?:public|sign|authenticated)|render/image/(?:public|sign|authenticated))/([^?#]+)(?:[?#].*)?$','i'))[1];
  if encoded_path is null then return null; end if;
  if strpos(encoded_path,'%')=0 then
    decoded_path:=encoded_path;
  else
    if strpos(regexp_replace(encoded_path,'%[0-9a-fA-F]{2}','','g'),'%')>0 then return null; end if;
    select string_agg(case when left(part,1)='%' then decode(substr(part,2),'hex')
      else convert_to(part,'UTF8') end,''::bytea order by ordinality)
      into decoded_bytes
    from regexp_matches(encoded_path,'%[0-9a-fA-F]{2}|[^%]+','g') with ordinality parts(token,ordinality)
    cross join lateral (select token[1] part) decoded;
    decoded_path:=convert_from(decoded_bytes,'UTF8');
  end if;
  bucket:=split_part(decoded_path,'/',1);
  object_path:=ltrim(substr(decoded_path,length(bucket)+2),'/');
  if bucket not in ('request_photos','flyer_photos','season_sales_notes_photos','location_sales_notes_photos',
      'credit_photos','dock_photos','grower_scout_photos','marketing_materials')
    or object_path='' or strpos(object_path,'..')>0 then return null; end if;
  return bucket||'/'||object_path;
exception when character_not_in_repertoire or untranslatable_character then return null;
end
$function$;

create or replace function private.request_archive_photo_keys_v3039(p_photos jsonb,p_links text[])
returns text[] language sql immutable set search_path='' as $function$
  select coalesce(array_agg(distinct coalesce(object_key,'*')),'{}'::text[])
  from private.archive_photo_links_v3039(p_photos,p_links) link
  cross join lateral (select private.request_archive_photo_object_v3039(link) object_key) object
  where object_key is not null or link ~* '^(https?://kzrnyjsosryejjejliii\.supabase\.co)?/storage/v1/'
$function$;

create index if not exists ph_request_history_photo_objects_v3039
  on public.ph_requests_completed_history using gin
    (private.request_archive_photo_keys_v3039(photos,array[photo_url,req_photo_link,photo_link]));

create or replace function public.request_archive_consignee_v3039(p_value text)
returns text language sql immutable security invoker set search_path='' as $function$
  select case when lower(btrim(coalesce(p_value,''))) in ('','n/a','na','direct_or_na')
    then 'Direct_or_NA' else btrim(p_value) end
$function$;

create or replace function public.request_archive_path_v3039(p_row jsonb)
returns text[] language sql immutable security invoker set search_path='' as $function$
  select array[
    coalesce(nullif(btrim(p_row->>'sales_rep'),''),nullif(btrim(p_row->>'request_selected_rep_username'),''),
      nullif(btrim(p_row->>'requested_by'),''),'Unassigned'),
    coalesce(nullif(btrim(p_row->>'customer_name'),''),nullif(btrim(p_row->>'customername'),''),
      nullif(btrim(p_row->>'req_customer'),''),nullif(btrim(p_row->>'request_customer'),''),'Unknown customer'),
    public.request_archive_consignee_v3039(coalesce(nullif(btrim(p_row->>'consignee_name'),''),
      nullif(btrim(p_row->>'consigneename'),''))),
    coalesce(nullif(left(coalesce(p_row->>'requested_at',p_row->>'created_at',p_row->>'date_completed'),10),''),
      'Unknown-date')||'_'||coalesce(nullif(p_row->>'client_batch_id',''),
      nullif(p_row->>'unique_id',''),p_row->>'id'),
    coalesce(nullif(btrim(p_row->>'itemcode'),''),'Unknown-item')]
$function$;

-- Both buying-account and receiving-store lookups retain their own index.
create index if not exists ph_request_history_customer_name_v3039
  on public.ph_requests_completed_history(lower(customer_name),assigned_rep_id,unique_id);
create index if not exists ph_request_history_consignee_name_v3039
  on public.ph_requests_completed_history(lower(consignee_name),assigned_rep_id,unique_id);
create index if not exists ph_request_history_customer_consignee_v3039
  on public.ph_requests_completed_history(assigned_rep_id,customer_name,consignee_name,requested_at desc,unique_id);

create or replace view public.ph_request_archive_catalog_v3039
with(security_invoker=true) as
select history.*,public.request_archive_path_v3039(to_jsonb(history)) as archive_path
from public.ph_requests_completed_history history;

-- This is a service-only projection of the installed queue owner, never a second
-- mutable job queue. Its lifecycle/verification/quarantine receipts stay in jobs.
create or replace view public.ph_photo_archive_queue
with(security_invoker=true) as
select jobs.*,coalesce(requests.paths,'[]'::jsonb) as request_archive_paths,
  coalesce(private.request_archive_photo_object_v3039(jobs.source_url)=jobs.source_bucket||'/'||jobs.source_path
    and jobs.source_key=encode(sha256(convert_to(jobs.source_bucket||'/'||jobs.source_path,'UTF8')),'hex'),false)
  and not exists (
    select 1 from public.ph_requests_completed_history history
    where private.request_archive_photo_keys_v3039(history.photos,
      array[history.photo_url,history.req_photo_link,history.photo_link]) @> array['*']
  ) as request_archive_identity_verified
from public.ph_photo_archive_jobs jobs
left join lateral (
  select jsonb_agg(distinct public.request_archive_path_v3039(to_jsonb(history))) paths
  from public.ph_requests_completed_history history
  where private.request_archive_photo_keys_v3039(history.photos,
    array[history.photo_url,history.req_photo_link,history.photo_link]) @> array[jobs.source_bucket||'/'||jobs.source_path]
) requests on true;

revoke all on function private.archive_photo_links_v3039(jsonb,text[]) from public,anon,authenticated;
revoke all on function private.request_archive_photo_object_v3039(text) from public,anon,authenticated;
revoke all on function private.request_archive_photo_keys_v3039(jsonb,text[]) from public,anon,authenticated;
grant execute on function private.archive_photo_links_v3039(jsonb,text[]) to service_role;
grant execute on function private.request_archive_photo_object_v3039(text) to service_role;
grant execute on function private.request_archive_photo_keys_v3039(jsonb,text[]) to service_role;

revoke all on public.ph_request_archive_catalog_v3039 from public,anon;
grant select on public.ph_request_archive_catalog_v3039 to authenticated,service_role;
revoke all on public.ph_photo_archive_queue from public,anon,authenticated;
grant select on public.ph_photo_archive_queue to service_role;
revoke all on function public.request_archive_consignee_v3039(text) from public,anon;
revoke all on function public.request_archive_path_v3039(jsonb) from public,anon;
grant execute on function public.request_archive_consignee_v3039(text) to authenticated,service_role;
grant execute on function public.request_archive_path_v3039(jsonb) to authenticated,service_role;

comment on view public.ph_request_archive_catalog_v3039 is
  'Permanent completed Request evidence with canonical SalesRep/Customer/Consignee/date_RequestID/ItemCode paths. Existing RLS remains authoritative.';
comment on view public.ph_photo_archive_queue is
  'Read-only service projection of ph_photo_archive_jobs. Preserve full-resolution URLs and verified Drive receipts; no independent retention or deletion policy.';
commit;
