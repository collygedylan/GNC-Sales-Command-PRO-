begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function private.historical_photo_date_for_record_v2368(p_kind text,p_row jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  date_value text;
  taken_at timestamptz;
begin
  if coalesce(jsonb_typeof(p_row->'photoLinks'),'')<>'array' or jsonb_array_length(p_row->'photoLinks')=0 then return null; end if;
  if p_kind='requests' then
    select history.photo_date into date_value from public.ph_requests_completed_history history
    where history.unique_id=p_row->>'id' limit 1;
  elsif p_kind='orders' then
    select history.photo_date into date_value from public.ph_orders_history history
    where history.order_line_key=p_row->>'id' limit 1;
  elsif p_kind='reserves' then
    select history.photo_date into date_value from public.ph_reserves_history history
    where history.reserve_history_key=p_row->>'id' limit 1;
  elsif p_kind='drive' then
    select history.photo_date into date_value from public.ph_drive_mode_history history
    where history.source_unique_id=p_row->>'id' or history.history_key=p_row->>'id'
    order by history.updated_at desc nulls last limit 1;
    if nullif(btrim(coalesce(date_value,'')),'') is null then
      select max(asset.photo_at) into taken_at from public.ph_photo_history_assets asset
      where upper(btrim(asset.itemcode))=upper(btrim(p_row->>'itemcode'))
        and (nullif(btrim(p_row->>'locationcode'),'') is null or nullif(btrim(asset.locationcode),'') is null
          or upper(btrim(asset.locationcode))=upper(btrim(p_row->>'locationcode')));
    end if;
  end if;
  taken_at:=coalesce(public.safe_parse_timestamptz(date_value,null),taken_at);
  return case when taken_at is null then null else to_char(taken_at at time zone 'America/Chicago','MM/DD/YY') end;
end
$function$;

revoke all on function private.historical_photo_date_for_record_v2368(text,jsonb) from public,anon,authenticated,service_role;

do $assertions$
declare
  function_definition text:=pg_get_functiondef('private.historical_photo_date_for_record_v2368(text,jsonb)'::regprocedure);
begin
  if position('history.source_unique_id' in function_definition)=0
    or position('history.history_key' in function_definition)=0
    or has_function_privilege('authenticated','private.historical_photo_date_for_record_v2368(text,jsonb)','execute') then
    raise exception using errcode='55000',message='V2368_HISTORICAL_PHOTO_DATE_KEY_FIX_FAILED';
  end if;
end
$assertions$;

commit;
