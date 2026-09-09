-- Disposable local/CI database only. This test emits TAP and rolls back.
begin;
create temporary table av_reset_checks (id integer generated always as identity, description text) on commit drop;
create function pg_temp.av_reset_check(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'AV reset regression: %', description; end if;
  insert into av_reset_checks(description) values (description);
end $$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('96000000-0000-0000-0000-000000000001','av-reset@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password)
values ('96000000-0000-0000-0000-000000000001','av_reset_test','AV Reset Test','ADMIN',false);
insert into public.ph_app_settings(key,value)
values ('current_season_salesyear','{"seasonCode":"F1","salesYear":"27"}'),
       ('av_blanks_photo_bypass_users','{"users":["av_reset_test"]}')
on conflict(key) do update set value=excluded.value;

insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,season,saleyear,priority,ptravailable,s_lts,
  app_tab_assignment,locationcode,lotcode,av_note,spec,photo_link,photo_name,
  match,loc_match_qty,av_rule_bundle_updated_at,av_rule_av_note_updated_at,
  av_rule_spec_updated_at,av_rule_photo_updated_at,av_rule_priority_snapshot,av_rule_holdstop_snapshot
)
select uid,uid,'Reset fixture','F1','27','1','100','100','season','A.01.001','27.F1',
  uid||' user note','3-4 ft',
  'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/reset-fixture.jpg',null,
  '100','100',now(),now(),now(),now(),'1',''
from unnest(array['RESET-CAV','RESET-PHOTO','RESET-MANUAL','RESET-AGE','RESET-ZERO',
  'RESET-PRIORITY','RESET-HOLD','RESET-DONE','RESET-WINNER','RESET-SCOPE',
  'RESET-DEFERRED','RESET-DEFERRED-RESTORED','RESET-NO-MARKER','RESET-NEWER-NOTE']) uid;
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,season,saleyear,priority,ptravailable,s_lts,
  app_tab_assignment,locationcode,lotcode,av_note,spec,photo_link
)
values ('RESET-OTHER-WINNER','RESET-WINNER','Other winner','F1','27','1','50','100',
  'location','A.02.001','27.F1','Other winner note','3-4 ft','other-photo');

do $test$
declare
  itemcodes text[];
  captured_revision integer;
  completed_time timestamptz;
  completed_evidence jsonb;
  before_photo_time timestamptz;
begin
  perform pg_temp.av_reset_check(not has_function_privilege('anon','private.sync_season_sales_av_note_reset_v1()','EXECUTE'), 'reset trigger is unavailable to anonymous callers');
  perform pg_temp.av_reset_check(not has_function_privilege('authenticated','private.sync_season_sales_av_note_reset_v1()','EXECUTE'), 'browser cannot call reset trigger directly');
  select array_agg(distinct itemcode) into itemcodes from public.ph_master_inventory where unique_id like 'RESET-%';
  perform public.reconcile_season_sales_office_v1(itemcodes,false,'reset-initial',null);

  -- Imports that touch only AV Note do not qualify as shared bundle resets.
  update public.ph_master_inventory set av_note=null where unique_id='RESET-CAV';
  perform public.reconcile_season_sales_office_v1(array['RESET-CAV'],false,'cav-blank',null);
  perform pg_temp.av_reset_check((select av_note='RESET-CAV user note' from public.ph_sales_office where unique_id='RESET-CAV'), 'CAV-only blank preserves the staged note');
  update public.ph_master_inventory set av_note='Different imported CAV text' where unique_id='RESET-CAV';
  perform public.reconcile_season_sales_office_v1(array['RESET-CAV'],false,'cav-different',null);
  perform pg_temp.av_reset_check((select av_note='RESET-CAV user note' from public.ph_sales_office where unique_id='RESET-CAV'), 'different CAV text cannot replace the staged note');
  perform pg_temp.av_reset_check((select revision=1 from public.ph_season_sales_office_state where itemcode_normalized='RESET-CAV'), 'CAV changes do not manufacture a user revision');
  update public.ph_master_inventory set av_note=null,spec=null,photo_link=null,photo_name=null where unique_id='RESET-NO-MARKER';
  perform public.reconcile_season_sales_office_v1(array['RESET-NO-MARKER'],false,'blank-import-no-marker',null);
  perform pg_temp.av_reset_check((select av_note='RESET-NO-MARKER user note' from public.ph_sales_office where unique_id='RESET-NO-MARKER'), 'blank imported fields without a genuine reset marker preserve the note');

  update public.ph_master_inventory set photo_link=null,photo_name=null where unique_id='RESET-PHOTO';
  perform public.reconcile_season_sales_office_v1(array['RESET-PHOTO'],false,'photo-only',null);
  perform pg_temp.av_reset_check((select av_note='RESET-PHOTO user note' from public.ph_sales_office where unique_id='RESET-PHOTO'), 'photo-only removal preserves the note');

  -- A full shared reset must work even after an import already blanked master AV.
  update public.ph_master_inventory set av_note=null where unique_id='RESET-MANUAL';
  select av_rule_photo_updated_at into before_photo_time from public.ph_master_inventory where unique_id='RESET-MANUAL';
  update public.ph_master_inventory set av_note=null,spec=null,photo_link=null,photo_name=null,
    av_rule_last_clear_reason='explicit_test_reset',av_rule_last_cleared_at=now()+interval '1 second'
  where unique_id='RESET-MANUAL';
  perform pg_temp.av_reset_check((select retained_av_note is null and revision=2 from public.ph_season_sales_office_state where itemcode_normalized='RESET-MANUAL'), 'full reset clears retained note and increments open revision');
  perform pg_temp.av_reset_check((select av_note is null and state_revision=2 from public.ph_sales_office where unique_id='RESET-MANUAL'), 'full reset immediately clears the office mirror');
  perform pg_temp.av_reset_check((select current_evidence_snapshot->'reasons' ? 'av_note_missing' from public.ph_season_sales_office_state where itemcode_normalized='RESET-MANUAL'), 'reset recomputes evidence without the removed note');
  perform pg_temp.av_reset_check((select count(*)=1 from public.ph_season_sales_office_events e join public.ph_season_sales_office_state s on s.id=e.state_id where s.itemcode_normalized='RESET-MANUAL' and e.reason_code='shared_av_rule_reset' and e.metadata->>'previousNote'='RESET-MANUAL user note'), 'reset audits the previous note once');
  perform pg_temp.av_reset_check((select av_rule_photo_updated_at=before_photo_time and av_rule_av_note_updated_at=now() from public.ph_master_inventory where unique_id='RESET-MANUAL'), 'reset sync never fabricates master evidence timestamps');
  update public.ph_master_inventory set av_note=null where unique_id='RESET-MANUAL';
  perform public.reconcile_season_sales_office_v1(array['RESET-MANUAL'],false,'after-full-reset',null);
  perform pg_temp.av_reset_check((select retained_av_note is null and revision=2 from public.ph_season_sales_office_state where itemcode_normalized='RESET-MANUAL'), 'repeat import/reconcile cannot resurrect reset note or add revisions');

  -- Simulate an import whose immediate projection was deferred by a busy lock.
  alter table public.ph_master_inventory disable trigger sync_season_sales_av_note_reset;
  update public.ph_master_inventory set av_note=null,spec=null,photo_link=null,photo_name=null,
    av_rule_last_clear_reason='deferred_test_reset',av_rule_last_cleared_at=now()+interval '1 second'
  where unique_id='RESET-DEFERRED';
  alter table public.ph_master_inventory enable trigger sync_season_sales_av_note_reset;
  perform public.reconcile_season_sales_office_v1(array['RESET-DEFERRED'],true,'deferred-dry-run',null);
  perform pg_temp.av_reset_check((select retained_av_note='RESET-DEFERRED user note' and revision=1 from public.ph_season_sales_office_state where itemcode_normalized='RESET-DEFERRED'), 'dry run never applies a deferred reset');
  perform public.reconcile_season_sales_office_v1(array['RESET-DEFERRED'],false,'deferred-reconcile',null);
  perform pg_temp.av_reset_check((select retained_av_note is null and revision=2 from public.ph_season_sales_office_state where itemcode_normalized='RESET-DEFERRED'), 'regular reconcile repairs a deferred reset before note overlay');
  perform pg_temp.av_reset_check((select av_note is null from public.ph_sales_office where unique_id='RESET-DEFERRED'), 'deferred reset cannot republish invalidated office note');

  alter table public.ph_master_inventory disable trigger sync_season_sales_av_note_reset;
  update public.ph_master_inventory set av_note=null,spec=null,photo_link=null,photo_name=null,
    av_rule_last_clear_reason='deferred_before_new_photo',av_rule_last_cleared_at=now()+interval '1 second'
  where unique_id='RESET-DEFERRED-RESTORED';
  alter table public.ph_master_inventory enable trigger sync_season_sales_av_note_reset;
  update public.ph_master_inventory set spec='New 5-6 ft spec',
    photo_link='https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/new-reset-photo.jpg',
    av_rule_photo_updated_at=clock_timestamp(),av_rule_spec_updated_at=clock_timestamp()
  where unique_id='RESET-DEFERRED-RESTORED';
  perform public.reconcile_season_sales_office_v1(array['RESET-DEFERRED-RESTORED'],false,'reset-then-new-photo',null);
  perform pg_temp.av_reset_check((select retained_av_note is null from public.ph_season_sales_office_state where itemcode_normalized='RESET-DEFERRED-RESTORED'), 'new photo/spec cannot hide an earlier deferred note reset');
  perform pg_temp.av_reset_check((select av_note is null and spec='New 5-6 ft spec' and photo_link like '%new-reset-photo.jpg' from public.ph_sales_office where unique_id='RESET-DEFERRED-RESTORED'), 'deferred note reset preserves subsequently supplied photo/spec');

  -- Use the real protected save after a real reset in the SAME transaction.
  -- now() would still be the transaction start and would date the new save
  -- before this reset; the subsequent import/reconcile would erase it again.
  update public.ph_master_inventory set priority='2' where unique_id='RESET-NEWER-NOTE';
  select revision into captured_revision from public.ph_season_sales_office_state where itemcode_normalized='RESET-NEWER-NOTE';
  -- Allow PGlite's millisecond clock to advance between reset and save.
  perform pg_sleep(0.01);
  perform public.save_season_sales_office_av_note_v1('av_reset_test','RESET-NEWER-NOTE',captured_revision,
    'Fresh note entered after reset','av-reset-new-note-token');
  perform pg_temp.av_reset_check((select s.retained_av_note_at > m.av_rule_last_cleared_at from public.ph_season_sales_office_state s join public.ph_master_inventory m on m.unique_id=s.winner_unique_id where s.itemcode_normalized='RESET-NEWER-NOTE'), 'protected save after reset captures its actual later time within the same transaction');
  update public.ph_master_inventory set av_note=null where unique_id='RESET-NEWER-NOTE';
  perform public.reconcile_season_sales_office_v1(array['RESET-NEWER-NOTE'],false,'older-reset-marker',null);
  perform pg_temp.av_reset_check((select retained_av_note='Fresh note entered after reset' and revision=captured_revision+1 from public.ph_season_sales_office_state where itemcode_normalized='RESET-NEWER-NOTE'), 'older clear marker cannot remove a subsequently saved note or add another revision');
  perform pg_temp.av_reset_check((select av_note='Fresh note entered after reset' from public.ph_sales_office where unique_id='RESET-NEWER-NOTE'), 'CAV blank after a new protected save preserves the new office note');

  -- Run the actual checked-in maintenance expiry implementation.
  update public.ph_master_inventory set av_note=null,av_rule_bundle_updated_at=now()-interval '11 days' where unique_id='RESET-AGE';
  update public.ph_master_inventory set av_note=null,loc_match_qty='0' where unique_id='RESET-ZERO';
  perform private.expire_shared_av_results();
  perform pg_temp.av_reset_check((select retained_av_note is null from public.ph_season_sales_office_state where itemcode_normalized='RESET-AGE'), 'ten-day shared expiry clears retained note despite blank master AV');
  perform pg_temp.av_reset_check((select av_note is null and spec is null and photo_link is null and av_rule_bundle_updated_at is null and av_rule_photo_updated_at is null and av_rule_last_clear_reason='stale_10_day' from public.ph_master_inventory where unique_id='RESET-AGE'), 'shared expiry retains its original bundle and timestamp clearing');
  perform pg_temp.av_reset_check((select av_note is null from public.ph_sales_office where unique_id='RESET-ZERO'), 'zero match quantity clears retained office note');
  perform pg_temp.av_reset_check((select av_rule_last_clear_reason='loc_photo_match_qty_zero' from public.ph_master_inventory where unique_id='RESET-ZERO'), 'zero quantity uses genuine shared reset marker');

  update public.ph_master_inventory set priority='2' where unique_id='RESET-PRIORITY';
  perform pg_temp.av_reset_check((select av_note is null and spec is null and photo_link is null and av_rule_last_cleared_at is not null from public.ph_master_inventory where unique_id='RESET-PRIORITY'), 'legacy priority reset now records a shared invalidation marker');
  perform pg_temp.av_reset_check((select av_note is null from public.ph_sales_office where unique_id='RESET-PRIORITY'), 'priority reset clears office note immediately');
  update public.ph_master_inventory set holdstopcode='H' where unique_id='RESET-HOLD';
  perform pg_temp.av_reset_check((select retained_av_note is null from public.ph_season_sales_office_state where itemcode_normalized='RESET-HOLD'), 'gaining H/S clears retained note');
  update public.ph_master_inventory set av_note='Note while on hold',spec='3-4 ft',photo_link='hold-photo' where unique_id='RESET-HOLD';
  update public.ph_season_sales_office_state set retained_av_note='Note while on hold' where itemcode_normalized='RESET-HOLD';
  update public.ph_master_inventory set holdstopcode='' where unique_id='RESET-HOLD';
  perform pg_temp.av_reset_check((select retained_av_note is null from public.ph_season_sales_office_state where itemcode_normalized='RESET-HOLD'), 'losing H/S also clears retained note');

  update public.ph_master_inventory set priority='2' where unique_id='RESET-OTHER-WINNER';
  perform pg_temp.av_reset_check((select retained_av_note='RESET-WINNER user note' and winner_unique_id='RESET-WINNER' from public.ph_season_sales_office_state where itemcode_normalized='RESET-WINNER'), 'resetting another inventory row does not clear the selected winner note');
  insert into public.ph_season_sales_office_state(season_code,sales_year,itemcode_normalized,winner_unique_id,status)
  values ('U1',28,'RESET-SCOPE','RESET-SCOPE','open');
  update public.ph_season_sales_office_state set retained_av_note='Other scope note' where season_code='U1' and itemcode_normalized='RESET-SCOPE';
  update public.ph_master_inventory set priority='2' where unique_id='RESET-SCOPE';
  perform pg_temp.av_reset_check((select retained_av_note is null from public.ph_season_sales_office_state where season_code='F1' and itemcode_normalized='RESET-SCOPE'), 'current scope note follows its shared reset');
  perform pg_temp.av_reset_check((select retained_av_note='Other scope note' from public.ph_season_sales_office_state where season_code='U1' and itemcode_normalized='RESET-SCOPE'), 'another sales scope is preserved');

  perform public.complete_season_sales_office_v1('av_reset_test','RESET-DONE',1,'av-reset-complete-token');
  select revision,completed_at,completed_evidence_snapshot into captured_revision,completed_time,completed_evidence
  from public.ph_season_sales_office_state where itemcode_normalized='RESET-DONE';
  update public.ph_master_inventory set priority='2' where unique_id='RESET-DONE';
  perform pg_temp.av_reset_check((select status='done' and revision=captured_revision+1 and completed_at=completed_time and completed_evidence_snapshot=completed_evidence and retained_av_note is null from public.ph_season_sales_office_state where itemcode_normalized='RESET-DONE'), 'reset invalidates stale revisions but preserves Done status and completion evidence until reconciliation');
  perform pg_temp.av_reset_check(not exists(select 1 from public.ph_sales_office where unique_id='RESET-DONE'), 'reset trigger does not recreate a completed office mirror');
  perform public.reconcile_season_sales_office_v1(array['RESET-DONE'],false,'done-genuine-reset',null);
  perform pg_temp.av_reset_check((select status='open' and retained_av_note is null and reopen_reason='evidence_invalid' from public.ph_season_sales_office_state where itemcode_normalized='RESET-DONE'), 'regular reconciliation reopens Done for genuine invalidation');
  perform pg_temp.av_reset_check((select av_note is null from public.ph_sales_office where unique_id='RESET-DONE'), 'reopened work never restores the invalidated note');
end
$test$;
select 'ok '||id||' - '||description as tap from av_reset_checks order by id;
select '1..'||count(*) as tap from av_reset_checks;
rollback;
