begin;
create temporary table request_drive_reset_checks(description text);
create function pg_temp.reset_check(ok boolean,description text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Request evidence reset guard: %',description; end if;
  insert into request_drive_reset_checks values(description);
end $$;
select set_config('request.jwt.claim.role','service_role',true);
create temporary table reset_outbox_before as select count(*) n from public.ph_request_delivery_outbox;

-- Each history belongs to one synthetic master. INSERT preserves controlled
-- provenance; do not disable production triggers or touch existing business rows.
insert into public.ph_master_inventory(unique_id,itemcode,av_rule_last_cleared_at,av_rule_last_clear_reason)
select 'RESET-TEST-'||kind,'RESET-TEST-'||kind,
  case kind when 'newer' then now() when 'equal' then now()-interval '1 hour'
    when 'older' then now()-interval '2 hours' else null end,
  case when kind in ('newer','equal','older') then 'stale_10_day' end
from unnest(array['newer','equal','older','absent','sparse','field','bundle']) kind;
insert into public.ph_request_history(unique_id,master_id,req_status,date_completed,
  req_spec,req_caliper,req_match,req_pic_note,av_note,req_photo_link,req_photo_name)
select 'RESET-HISTORY-'||kind,'RESET-TEST-'||kind,'Completed',now()-interval '1 hour',
  'old spec','old caliper','8','old picture note','old availability note',
  'https://example.invalid/old.jpg','old.jpg'
from unnest(array['newer','equal','older','absent','sparse','field','bundle']) kind;
update public.ph_request_history set req_caliper=null,req_match=null,req_pic_note=null,av_note=null,
  req_photo_link=null,req_photo_name=null where unique_id in ('RESET-HISTORY-sparse','RESET-HISTORY-field','RESET-HISTORY-bundle');
update public.ph_master_inventory set caliper='keep caliper',match='7',pic_note='keep picture note',
  av_note='keep availability note',photo_link='https://example.invalid/keep.jpg',photo_name='keep.jpg'
where unique_id='RESET-TEST-sparse';
update public.ph_master_inventory set spec='new spec',av_rule_spec_updated_at=now()
where unique_id='RESET-TEST-field';
update public.ph_master_inventory set av_rule_bundle_updated_at=now() where unique_id='RESET-TEST-bundle';

select pg_temp.reset_check(not (public.get_request_drive_evidence_health_snapshot_v1()->'mismatch_request_ids'
  ?| array['RESET-HISTORY-newer','RESET-HISTORY-equal','RESET-HISTORY-field','RESET-HISTORY-bundle']),
  'health excludes equal/newer shared resets and newer field/bundle evidence');
select pg_temp.reset_check(public.get_request_drive_evidence_health_snapshot_v1()->'mismatch_request_ids'
  ?& array['RESET-HISTORY-older','RESET-HISTORY-absent','RESET-HISTORY-sparse'],
  'health still detects missing evidence after older/no reset and sparse history');

do $$
declare mode boolean; result jsonb;
begin
  foreach mode in array array[true,false] loop
    result := public.repair_request_drive_evidence_v1(array['RESET-HISTORY-newer','RESET-HISTORY-equal'],mode);
    perform pg_temp.reset_check(result->>'eligible_count'='0' and result->>'repaired_count'='0'
      and result->>'skipped_newer_count'='2','dry-run and real repair both skip superseded completions');
  end loop;
end $$;
select pg_temp.reset_check((select bool_and(spec is null and caliper is null and match is null
  and pic_note is null and av_note is null and photo_link is null and photo_name is null
  and av_rule_bundle_updated_at is null and av_rule_last_clear_reason='stale_10_day')
  from public.ph_master_inventory where unique_id in ('RESET-TEST-newer','RESET-TEST-equal')),
  'deliberately cleared values and provenance remain blank');
select pg_temp.reset_check(public.repair_request_drive_evidence_v1(array['RESET-HISTORY-older','RESET-HISTORY-absent'])->>'eligible_count'='2',
  'default mode is a non-mutating dry run');
select pg_temp.reset_check((select bool_and(spec is null) from public.ph_master_inventory
  where unique_id in ('RESET-TEST-older','RESET-TEST-absent')),'dry run leaves missing values untouched');
select pg_temp.reset_check(public.repair_request_drive_evidence_v1(array['RESET-HISTORY-older','RESET-HISTORY-absent'],false)->>'repaired_count'='2',
  'genuinely newer completion or no reset remains repairable');
select pg_temp.reset_check((select bool_and(spec='old spec' and caliper='old caliper' and match='8'
  and pic_note='old picture note' and av_note='old availability note'
  and photo_link='https://example.invalid/old.jpg' and photo_name='old.jpg') from public.ph_master_inventory
  where unique_id in ('RESET-TEST-older','RESET-TEST-absent')),'eligible repair restores all evidenced fields');
select pg_temp.reset_check(public.repair_request_drive_evidence_v1(array['RESET-HISTORY-sparse'],false)->>'repaired_count'='1',
  'sparse completion restores its nonempty evidence');
select pg_temp.reset_check((select spec='old spec' and caliper='keep caliper' and match='7'
  and pic_note='keep picture note' and av_note='keep availability note'
  and photo_link='https://example.invalid/keep.jpg' and photo_name='keep.jpg'
  from public.ph_master_inventory where unique_id='RESET-TEST-sparse'),'empty history never erases populated master fields');
select pg_temp.reset_check(public.repair_request_drive_evidence_v1(array['RESET-HISTORY-field','RESET-HISTORY-bundle'],false)->>'skipped_newer_count'='2',
  'existing newer-field and bundle guards remain effective');
select pg_temp.reset_check((select count(*)=(select n from reset_outbox_before) from public.ph_request_delivery_outbox),
  'health, dry run, skipped repair and actual isolated repair enqueue no notifications');
select pg_temp.reset_check(not has_function_privilege('authenticated','public.repair_request_drive_evidence_v1(text[],boolean)','execute')
  and not has_function_privilege('anon','public.get_request_drive_evidence_health_snapshot_v1()','execute'),
  'service-only API permissions remain closed to browser roles');
rollback;
