-- Version matches the production migration record; synthetic assertions ran before its commit.
begin;

-- Observations are not verification. These pure projections deliberately do not
-- clear MATCH, INITIAL_PTR, LOC_MATCH_QTY, photographs, or completion history.
-- No new table, trigger, public API, or permissions are introduced.
create or replace function private.av_evidence_number_v1(p_value text)
returns numeric
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $function$
declare
  value text := regexp_replace(replace(btrim(coalesce(p_value, '')), ',', ''), '%$', '');
begin
  if value !~ '^-?([0-9]+([.][0-9]*)?|[.][0-9]+)$' then return null; end if;
  return value::numeric;
exception when others then return null;
end
$function$;

create or replace function private.av_evidence_timestamp_v1(p_value text)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $function$
declare
  value text := btrim(coalesce(p_value, ''));
begin
  -- Reject relative timestamps ("now", "tomorrow"), timezone-dependent values,
  -- invalid calendar dates, and infinities instead of inventing recency.
  if value !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    return null;
  end if;
  return value::timestamptz;
exception when others then return null;
end
$function$;

create or replace function private.av_photo_capture_v1(p_value text)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $function$
declare
  value text := btrim(coalesce(p_value, ''));
  decoded bytea := ''::bytea;
  cursor_pos integer := 1;
  parts text[];
  captured_at timestamptz;
  year_value integer;
begin
  -- Match decodeURIComponent once, including dates embedded in encoded names.
  if strpos(value, '%') > 0 then
    while cursor_pos <= length(value) loop
      if substr(value, cursor_pos, 1) = '%' then
        if substr(value, cursor_pos + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then
          return jsonb_build_object('provided', true, 'at', null);
        end if;
        decoded := decoded || decode(substr(value, cursor_pos + 1, 2), 'hex');
        cursor_pos := cursor_pos + 3;
      else
        decoded := decoded || convert_to(substr(value, cursor_pos, 1), 'UTF8');
        cursor_pos := cursor_pos + 1;
      end if;
    end loop;
    value := convert_from(decoded, 'UTF8');
  end if;
  if value ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then
    captured_at := private.av_evidence_timestamp_v1(value);
    if captured_at is not null then
      return jsonb_build_object('provided', true, 'at', captured_at);
    end if;
    -- A date-bearing photo filename is not itself a complete timestamp.
    -- Match the app's calendar-date interpretation (UTC noon) while retaining
    -- full timestamp precision for exact ISO values without an extension.
    if value !~* '[.](jpe?g|png|webp|gif|heic|heif|avif)$' then
      return jsonb_build_object('provided', true, 'at', null);
    end if;
  end if;
  parts := regexp_match(value, '(^|[^0-9])((1[6-9]|2[0-4])[0-9]{11})([^0-9]|$)');
  if parts is not null then
    captured_at := to_timestamp(parts[2]::numeric / 1000);
    return jsonb_build_object('provided', true, 'at', captured_at);
  end if;
  parts := regexp_match(value, '(^|[^0-9])(20[0-9]{2})[-_/]([0-9]{1,2})[-_/]([0-9]{1,2})([^0-9]|$)');
  if parts is not null then
    captured_at := make_timestamptz(parts[2]::integer, parts[3]::integer, parts[4]::integer, 12, 0, 0, 'UTC');
    return jsonb_build_object('provided', true, 'at', captured_at);
  end if;
  parts := regexp_match(value, '(^|[^0-9])([0-9]{1,2})[/.-]([0-9]{1,2})[/.-](20[0-9]{2}|[0-9]{2})([^0-9]|$)');
  if parts is not null then
    year_value := parts[4]::integer;
    if year_value < 100 then year_value := year_value + 2000; end if;
    captured_at := make_timestamptz(year_value, parts[2]::integer, parts[3]::integer, 12, 0, 0, 'UTC');
    return jsonb_build_object('provided', true, 'at', captured_at);
  end if;
  return jsonb_build_object('provided', false, 'at', null);
exception when others then
  return jsonb_build_object('provided', true, 'at', null);
end
$function$;

create or replace function private.av_current_photo_evidence_v1(
  p_row jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $function$
declare
  links text[] := string_to_array(coalesce(p_row->>'photo_link', ''), ',');
  names text[] := string_to_array(coalesce(p_row->>'photo_name', ''), ',');
  link text;
  link_capture jsonb;
  name_capture jsonb;
  fallback_at timestamptz;
  captured_at timestamptz;
  latest_at timestamptz;
  reasons text[] := '{}'::text[];
  current_count integer := 0;
  linked_count integer := 0;
  i integer;
  fallback_text text;
begin
  if p_now is null then
    return jsonb_build_object('verified', false, 'photoCount', 0, 'photoUpdatedAt', null,
      'reasons', jsonb_build_array('evidence_timestamp_invalid'));
  end if;
  -- An invalid nonempty photo timestamp must NOT fall back to completion.
  fallback_text := coalesce(nullif(btrim(p_row->>'av_rule_photo_updated_at'), ''),
                            nullif(btrim(p_row->>'date_completed'), ''));
  fallback_at := private.av_evidence_timestamp_v1(fallback_text);
  for i in 1..coalesce(array_length(links, 1), 0) loop
    link := btrim(links[i]);
    if link = '' then continue; end if;
    linked_count := linked_count + 1;
    -- Production storage references only, same allowed origins/buckets as the
    -- partner projection. No query, credentials, traversal, or temporary blob.
    if link !~ '^https://kzrnyjsosryejjejliii[.]supabase[.]co/storage/v1/(object/public|render/image/public)/(request_photos|flyer_photos|season_sales_notes_photos|location_sales_notes_photos)/[^?#]+$'
       or link ~ '[[:cntrl:]\\]'
       or link ~* '(^|/|%2f)([.]|%2e){1,2}(/|%2f|$)' then
      reasons := array_append(reasons, 'photo_reference_invalid');
      continue;
    end if;
    link_capture := private.av_photo_capture_v1(link);
    name_capture := private.av_photo_capture_v1(names[i]);
    if coalesce((link_capture->>'provided')::boolean, false)
       or coalesce((name_capture->>'provided')::boolean, false) then
      if ((link_capture->>'provided')::boolean and link_capture->>'at' is null)
         or ((name_capture->>'provided')::boolean and name_capture->>'at' is null) then
        reasons := array_append(reasons, 'evidence_timestamp_invalid');
        continue;
      end if;
      captured_at := greatest((link_capture->>'at')::timestamptz, (name_capture->>'at')::timestamptz);
    else
      captured_at := fallback_at;
    end if;
    if captured_at is null then
      reasons := array_append(reasons, case when fallback_text is null
        then 'photo_date_missing' else 'evidence_timestamp_invalid' end);
    elsif captured_at > p_now then
      reasons := array_append(reasons, 'photo_date_future');
    elsif captured_at < p_now - interval '240 hours' then
      reasons := array_append(reasons, 'photo_or_evidence_expired');
    else
      current_count := current_count + 1;
      latest_at := greatest(latest_at, captured_at);
    end if;
  end loop;
  if linked_count = 0 then reasons := array_append(reasons, 'photo_missing'); end if;
  -- A row may have several photos: rejected entries do not invalidate a
  -- separately dated, current attached photo. Only current photos qualify it.
  if current_count > 0 then reasons := '{}'::text[];
  else select coalesce(array_agg(distinct reason order by reason), '{}'::text[])
    into reasons from unnest(reasons) reason;
  end if;
  return jsonb_build_object('verified', current_count > 0, 'photoCount', current_count,
    'photoUpdatedAt', latest_at, 'reasons', to_jsonb(reasons));
end
$function$;

create or replace function private.av_verified_photo_match_qty_v1(
  p_row jsonb,
  p_now timestamptz default now()
)
returns numeric
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $function$
declare
  evidence jsonb := private.av_current_photo_evidence_v1(p_row, p_now);
  percentage numeric := private.av_evidence_number_v1(p_row->>'match');
  current_stock numeric := private.av_evidence_number_v1(p_row->>'ptravailable');
  baseline numeric := private.av_evidence_number_v1(p_row->>'initial_ptr');
  original_quantity numeric;
begin
  if not coalesce((evidence->>'verified')::boolean, false)
     or percentage is null or percentage < 0 or percentage > 100
     or current_stock is null then return null; end if;
  current_stock := greatest(0, current_stock);
  if nullif(btrim(p_row->>'initial_ptr'), '') is not null and baseline is null then return null; end if;
  if baseline is null then return round(current_stock * percentage / 100); end if;
  baseline := greatest(0, baseline);
  original_quantity := greatest(0, round(baseline * percentage / 100));
  -- Derived zero wins over an old stored LOC_MATCH_QTY. Stock growth cannot
  -- increase a baseline-qualified amount. S_LTS and season do not alter this.
  return least(original_quantity, greatest(0, original_quantity - greatest(0, baseline - current_stock)));
end
$function$;

create or replace function private.season_sales_evidence_v1(p_row jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $function$
declare
  photo_evidence jsonb := private.av_current_photo_evidence_v1(p_row);
  photo_at timestamptz := (photo_evidence->>'photoUpdatedAt')::timestamptz;
  reasons text[] := '{}'::text[];
  match_qty numeric := private.av_verified_photo_match_qty_v1(p_row);
  match_value numeric := private.av_evidence_number_v1(p_row->>'match');
  spec_value text := lower(btrim(coalesce(p_row->>'spec', '')));
  clear_text text := nullif(btrim(p_row->>'av_rule_last_cleared_at'), '');
  cleared_at timestamptz;
  ready boolean;
begin
  select coalesce(array_agg(value), '{}'::text[]) into reasons
  from jsonb_array_elements_text(photo_evidence->'reasons');
  if btrim(coalesce(p_row->>'av_note', '')) = '' then reasons := array_append(reasons, 'av_note_missing'); end if;
  if nullif(btrim(p_row->>'match'), '') is null then reasons := array_append(reasons, 'match_missing');
  elsif match_value is null or match_value < 0 or match_value > 100 then reasons := array_append(reasons, 'match_invalid'); end if;
  if spec_value !~ '[[:alnum:]]'
     or spec_value in ('n/a', 'na', 'n.a.', 'none', 'null', 'unknown', 'tbd') then
    reasons := array_append(reasons, 'spec_missing');
  end if;
  if match_qty is null or match_qty <= 0 then reasons := array_append(reasons, 'loc_match_qty_missing'); end if;
  cleared_at := private.av_evidence_timestamp_v1(clear_text);
  if clear_text is not null and cleared_at is null then reasons := array_append(reasons, 'evidence_timestamp_invalid');
  elsif cleared_at is not null and (photo_at is null or cleared_at >= photo_at) then
    reasons := array_append(reasons, coalesce(nullif(p_row->>'av_rule_last_clear_reason', ''), 'evidence_invalidated'));
  end if;
  ready := cardinality(reasons) = 0;
  return jsonb_build_object(
    'ready', ready,
    'status', case when ready then 'ready_for_custom_av' else 'needs_photo_data' end,
    'reasons', to_jsonb(reasons),
    -- Keep the existing response property for callers, but now it identifies
    -- the qualifying photo instead of an unrelated note edit.
    'bundleUpdatedAt', photo_at,
    'photoUpdatedAt', photo_at,
    'verifiedPhotoMatchQty', match_qty,
    -- Keep the existing fingerprint inputs byte-for-byte. No lifecycle or
    -- idempotency key changes; existing reconciliation handles invalid evidence.
    'fingerprint', encode(extensions.digest(concat_ws('|',
      coalesce(p_row->>'photo_link', ''), coalesce(p_row->>'photo_name', ''),
      coalesce(p_row->>'av_note', ''), coalesce(p_row->>'spec', ''),
      coalesce(p_row->>'caliper', ''), coalesce(p_row->>'match', ''),
      coalesce(p_row->>'loc_match_qty', ''), coalesce(p_row->>'av_rule_last_cleared_at', '')
    ), 'sha256'), 'hex')
  );
exception when others then
  return jsonb_build_object('ready', false, 'status', 'needs_photo_data',
    'reasons', jsonb_build_array('evidence_timestamp_invalid'), 'fingerprint', 'invalid');
end
$function$;

revoke all on function private.av_evidence_number_v1(text) from public, anon, authenticated;
revoke all on function private.av_evidence_timestamp_v1(text) from public, anon, authenticated;
revoke all on function private.av_photo_capture_v1(text) from public, anon, authenticated;
revoke all on function private.av_current_photo_evidence_v1(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function private.av_verified_photo_match_qty_v1(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function private.season_sales_evidence_v1(jsonb) from public, anon, authenticated;

commit;
