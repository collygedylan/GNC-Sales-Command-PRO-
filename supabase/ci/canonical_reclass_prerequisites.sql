-- Restore the inventory state expected by the historical Reclass repair migrations.
begin;
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or exists(select 1 from public.ph_master_inventory where itemcode in ('004103.010.1','004424.010.1','010585.031.1')) then
    raise exception 'CANONICAL_RECLASS_FIXTURE_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

-- Preserve the captured dates and stock during fixture loading. Subsequent migrations run with the normal triggers.
set local session_replication_role='replica';
with rows(unique_id,itemcode,locationcode,lotcode,size,on_hand,open_stock) as (values
  ('ci-reclass-juncus-s1','004103.010.1','C.15.000','27.S1','#1','532','253'),
  ('ci-reclass-juncus-f1','004103.010.1','C.15.000','27.F1','#1','276','0'),
  ('ci-reclass-juncus-other','004103.010.1','C.15.000','26.S1','#1','70','1'),
  ('ci-reclass-juncus-f16-f1','004103.010.1','F.16.000','27.F1','#1','113','0'),
  ('ci-reclass-juncus-h06-f1','004103.010.1','H.06.000','27.F1','#1','1','0'),
  ('ci-reclass-juncus-f16-s1','004103.010.1','F.16.000','27.S1','#1','175','0'),
  ('ci-reclass-juncus-i03-s1','004103.010.1','I.03.000','27.S1','#1','1596','0'),
  ('ci-reclass-shenandoah-c16-f1','004424.010.1','C.16.000','27.F1','#1','1','0'),
  ('ci-reclass-shenandoah-h06-f1','004424.010.1','H.06.000','27.F1','#1','1','0'),
  ('ci-reclass-shenandoah-c16-s1','004424.010.1','C.16.000','27.S1','#1','1','0'),
  ('010585_031_1-3DP-D_21_000-27_S1-LD----','010585.031.1','D.21.000','27.S1','3DP','1','0'),
  ('ci-reclass-orange-f1','010585.031.1','D.21.000','27.F1','3DP','1','0')
)
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,contsize,season,saleyear,
  ptronhand,ptrreviewed,ptravailable,s_lts,spec,photo_date)
select unique_id,itemcode,locationcode,lotcode,size,split_part(lotcode,'.',2),split_part(lotcode,'.',1),
  on_hand,'0',on_hand,open_stock,case when unique_id='ci-reclass-juncus-f1' then '8-10" H' end,
  case when unique_id='ci-reclass-juncus-f1' then timestamptz '2026-10-26T12:00:00Z' end from rows;

insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,app_override_value,updated_by)
select '010585_031_1-3DP-D_21_000-27_S1-LD----',field,to_jsonb(value),'ci-replay'
from (values ('photo_link','https://fixture.invalid/orange.jpg'),('photo_name','orange.jpg'),
  ('spec','CI measured spec'),('caliper','N/A'),('match','15'),('loc_match_qty','325')) fields(field,value);

insert into app_sync_private.inventory_location_evidence_v1(itemcode_key,locationcode_key,itemcode,locationcode,
  source_unique_id,source_lotcode,evaluated_at,updated_by)
values ('010585.031.1','D.21.000','010585.031.1','D.21.000',
  '010585_031_1-3DP-D_21_000-27_S1-LD----','27.S1',clock_timestamp(),'ci-replay');
commit;
