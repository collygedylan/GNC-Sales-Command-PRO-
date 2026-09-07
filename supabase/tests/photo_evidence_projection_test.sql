-- Pure projection verification: synthetic JSON arguments only. No customer,
-- inventory, order, workflow, auth, or fixture table is inserted/updated/deleted.
-- Run after the migration; transaction rolls back even the session settings.
begin read only;
set local timezone = 'UTC';

do $test$
declare
  checked integer := 0;
  at_time timestamptz := '2026-09-07T12:00:00Z';
  photo_url text := 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/crop.jpg';
  base jsonb;
  sample jsonb;
  evidence jsonb;
  before_value jsonb;
  expected_fingerprint text;
begin
  base := jsonb_build_object('photo_link', photo_url, 'photo_name', 'crop.jpg',
    'av_rule_photo_updated_at', at_time::text, 'ptravailable', '347',
    'match', '50', 'initial_ptr', '347', 'loc_match_qty', '174',
    'spec', '3-4 ft H', 'av_note', 'SPEC - 3-4 ft H');

  if private.av_verified_photo_match_qty_v1(base, at_time) is distinct from 174::numeric then
    raise exception 'current photo + 347 stock x 50 percent must verify 174'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base - 'photo_link', at_time) is not null then
    raise exception 'orphan stored/calculable MATCH must not verify without an attached photo'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base - 'av_rule_photo_updated_at', at_time) is not null then
    raise exception 'undated photo must not verify'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1((base - 'av_rule_photo_updated_at') || jsonb_build_object('av_rule_bundle_updated_at', at_time, 'av_rule_av_note_updated_at', at_time), at_time) is not null then
    raise exception 'generic bundle/note timestamp cannot establish photo age'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('av_rule_photo_updated_at', 'invalid', 'date_completed', at_time), at_time) is not null then
    raise exception 'invalid nonempty photo timestamp cannot fall back to completion'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1((base - 'av_rule_photo_updated_at') || jsonb_build_object('date_completed', at_time), at_time) is distinct from 174::numeric then
    raise exception 'completion timestamp is the legacy fallback only when photo timestamp is absent'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('av_rule_photo_updated_at', at_time - interval '11 days', 'date_completed', at_time), at_time) is not null then
    raise exception 'recent completion cannot revive an older photo timestamp'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('av_rule_photo_updated_at', at_time + interval '1 second'), at_time) is not null then
    raise exception 'future photo evidence must not verify'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('av_rule_photo_updated_at', at_time - interval '10 days'), at_time) is distinct from 174::numeric then
    raise exception 'exactly ten days remains eligible'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('av_rule_photo_updated_at', at_time - interval '10 days 1 second'), at_time) is not null then
    raise exception 'older than ten days must not verify'; end if; checked := checked + 1;

  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_name', 'crop 8/1/26.jpg'), at_time) is not null then
    raise exception 'old paired filename date beats recently touched photo metadata'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_name', 'crop%209%2F4%2F26.jpg', 'av_rule_photo_updated_at', 'invalid'), at_time) is distinct from 174::numeric then
    raise exception 'paired encoded explicit date precedes invalid fallback metadata'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_link', replace(photo_url, 'crop.jpg', 'crop_2026-08-01_photo.jpg'), 'photo_name', 'crop.jpg'), at_time) is not null then
    raise exception 'old URL capture date beats recently touched metadata'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_name', 'crop_2026-02-31_photo.jpg'), at_time) is not null then
    raise exception 'impossible explicit date cannot use metadata fallback'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_name', 'crop_2026-09-08_photo.jpg'), at_time) is not null then
    raise exception 'future paired capture date cannot use metadata fallback'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_name', '2026-09-06T18:23:45.000Z.jpg'), at_time) is distinct from 174::numeric then
    raise exception 'ISO-prefixed photo filename must use its valid calendar capture date'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_name', '2026-09-31T18:23:45.000Z.jpg'), at_time) is not null then
    raise exception 'impossible ISO-prefixed filename calendar date must fail closed'; end if; checked := checked + 1;
  sample := base || jsonb_build_object('photo_link', photo_url || ',' || replace(photo_url, 'crop.jpg', 'other.jpg'),
    'photo_name', 'old_2026-08-01_photo.jpg,current_2026-09-04_photo.jpg');
  evidence := private.av_current_photo_evidence_v1(sample, at_time);
  if evidence->>'photoCount' <> '1' or private.av_verified_photo_match_qty_v1(sample, at_time) is distinct from 174::numeric then
    raise exception 'one separately dated current photo qualifies a multi-photo row'; end if; checked := checked + 1;
  sample := base || jsonb_build_object('photo_link', ',' || photo_url, 'photo_name', 'current_2026-09-04_photo.jpg,old_2026-08-01_photo.jpg');
  if private.av_verified_photo_match_qty_v1(sample, at_time) is not null then
    raise exception 'blank CSV slots cannot shift a new filename onto an old linked photo'; end if; checked := checked + 1;

  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_link', 'https://other.example/crop.jpg'), at_time) is not null then
    raise exception 'unapproved photo origin must not verify'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_link', photo_url || '?token=anything'), at_time) is not null then
    raise exception 'temporary query-bearing photo reference must not verify'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_link', replace(photo_url, 'crop.jpg', '%2e%2e/private.jpg')), at_time) is not null then
    raise exception 'photo path traversal must not verify'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('photo_link', 'blob:local-preview'), at_time) is not null then
    raise exception 'uncommitted local preview must not verify'; end if; checked := checked + 1;

  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('ptravailable', '330'), at_time) is distinct from 157::numeric then
    raise exception 'baseline deductions reduce verified amount by consumed stock, not percentage'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('ptravailable', '1000'), at_time) is distinct from 174::numeric then
    raise exception 'stock growth cannot raise original matched amount'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('initial_ptr', '0'), at_time) is distinct from 0::numeric then
    raise exception 'zero baseline wins over positive stored LOC_MATCH_QTY'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('initial_ptr', 'bad'), at_time) is not null then
    raise exception 'invalid baseline cannot be replaced with current stock'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('match', '101'), at_time) is not null then
    raise exception 'out-of-range percentage must not verify'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base || jsonb_build_object('match', 'bad50'), at_time) is not null then
    raise exception 'malformed numeric observation must not be coerced into a percentage'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base - 'match', at_time) is not null then
    raise exception 'stored quantity alone cannot substitute for a match observation'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1(base - 'ptravailable', at_time) is not null then
    raise exception 'unknown current stock must stay unknown, not verify zero'; end if; checked := checked + 1;
  if private.av_verified_photo_match_qty_v1((base - 'initial_ptr') || jsonb_build_object('ptravailable', '993', 'match', '70', 's_lts', '1', 'season', 'S1', 'saleyear', '2027'), at_time) is distinct from 695::numeric then
    raise exception 'Anna fixture preserves 695 independently of season or S_LTS'; end if; checked := checked + 1;

  -- The Season wrapper uses the real transaction clock, not synthetic dates.
  sample := base || jsonb_build_object('av_rule_photo_updated_at', now());
  before_value := sample;
  evidence := private.season_sales_evidence_v1(sample);
  if evidence->>'ready' <> 'true' or evidence->>'status' <> 'ready_for_custom_av' then
    raise exception 'complete current evidence retains the Season ready contract'; end if; checked := checked + 1;
  if sample is distinct from before_value then raise exception 'projection mutated its input'; end if; checked := checked + 1;
  expected_fingerprint := encode(extensions.digest(concat_ws('|',
    coalesce(sample->>'photo_link', ''), coalesce(sample->>'photo_name', ''),
    coalesce(sample->>'av_note', ''), coalesce(sample->>'spec', ''),
    coalesce(sample->>'caliper', ''), coalesce(sample->>'match', ''),
    coalesce(sample->>'loc_match_qty', ''), coalesce(sample->>'av_rule_last_cleared_at', '')
  ), 'sha256'), 'hex');
  if evidence->>'fingerprint' is distinct from expected_fingerprint then
    raise exception 'existing Season fingerprint contract changed'; end if; checked := checked + 1;
  evidence := private.season_sales_evidence_v1(sample || '{"spec":"N/A"}'::jsonb);
  if evidence->>'ready' <> 'false' or not (evidence->'reasons' ? 'spec_missing') then
    raise exception 'placeholder specification must need review'; end if; checked := checked + 1;
  evidence := private.season_sales_evidence_v1(sample || '{"spec":"--- / ..."}'::jsonb);
  if evidence->>'ready' <> 'false' or not (evidence->'reasons' ? 'spec_missing') then
    raise exception 'punctuation-only specification must retain spec_missing reason'; end if; checked := checked + 1;
  evidence := private.season_sales_evidence_v1(sample - 'photo_link');
  if evidence->>'status' <> 'needs_photo_data' or not (evidence->'reasons' ? 'photo_missing') then
    raise exception 'Season missing-photo reason and status must remain compatible'; end if; checked := checked + 1;
  evidence := private.season_sales_evidence_v1(sample || jsonb_build_object('av_rule_photo_updated_at', now() - interval '30 days', 'av_rule_av_note_updated_at', now()));
  if evidence->>'ready' <> 'false' or not (evidence->'reasons' ? 'photo_or_evidence_expired') then
    raise exception 'fresh note cannot make Season evidence ready with old photo'; end if; checked := checked + 1;
  evidence := private.season_sales_evidence_v1(sample || jsonb_build_object('av_rule_last_cleared_at', now(), 'av_rule_last_clear_reason', 'priority_changed'));
  if evidence->>'ready' <> 'false' or not (evidence->'reasons' ? 'priority_changed') then
    raise exception 'existing explicit evidence invalidation remains effective'; end if; checked := checked + 1;
  if has_function_privilege('anon', 'private.av_current_photo_evidence_v1(jsonb,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.av_verified_photo_match_qty_v1(jsonb,timestamptz)', 'EXECUTE') then
    raise exception 'private projection helpers must not expose a new browser API'; end if; checked := checked + 1;
  raise notice 'photo evidence projection: % assertions passed; no business rows touched', checked;
end
$test$;

rollback;
