begin;
-- Supply the exact historical identities and synthetic photos only in canonical replay.
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_PHOTO_RECOVERY_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
set local session_replication_role=replica;
create temp table ci_photo_recovery(uid text primary key, n integer) on commit drop;
insert into ci_photo_recovery
select uid,n from unnest(array[
  '000310_070_1-_7-J_03_000-27_S1-SH-_---','000749_031_1-3DP-F_17_000-27_U2-SH---SOUTH-',
  '000310_070_1-_7-J_03_000-27_F1-SH----1','003202_100_1-_10-F_20_000-27_S1-SH----',
  '003202_071_1-7DP-F_20_000-27_F1-SH----','003202_100_1-_10-F_20_000-27_F1-SH----1',
  '000310_050_1-_5-K_03_000-27_F1-SH----1','008880_250_1-_25-B_06_000-27_F1-SH----1',
  '008880_250_1-_25-B_06_000-27_S1-SH----','008880_250_1-_25-B_06_000-27_U1-SH----',
  '010585_031_1-3DP-D_21_000-27_S1-LD----','drive-6947bb92d1316d11a24665b1edd196e9',
  'drive-aa1f2f9c302c4acb9882339c44d9201f','drive-d913e2a41093a5d03175f2af099c02c8',
  'drive-7ccbe9fd018d0a4c5a481e7745036cf2','drive-d7148af075cfd3ef739335dce3a98c0b',
  '008095_250_1-_25-A_07_010-27_F1-SH----1'
]) with ordinality cohort(uid,n);
insert into ci_photo_recovery select 'ci-photo-recovery-'||n,n from generate_series(18,229) n;

insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,commonname,ptronhand,ptravailable,loc_photo_match,photos)
select uid,'CI312.'||n,'CI-PHOTO','27.CI','Synthetic Photo Recovery','5','4',
  case when n=17 then 0 else 4 end,
  case when n>17 then jsonb_build_array(jsonb_build_object('url','https://fixture.invalid/ag312/'||n)) else '[]'::jsonb end
from ci_photo_recovery;

insert into public.ph_location_sales_notes(unique_id,itemcode,locationcode,lotcode,loc_match_pct,photos)
select uid,'CI312.'||n,'CI-PHOTO','27.CI',80,
  jsonb_build_array(jsonb_build_object('url','https://fixture.invalid/ag312/'||n))
from ci_photo_recovery where n<17;

insert into app_sync_private.inventory_location_evidence_v1(itemcode_key,locationcode_key,itemcode,locationcode,
  source_unique_id,source_lotcode,updated_by,clear_reason,current_photo_match_qty,evaluated_at,loc_match_pct)
select lower('CI312.'||n),'ci-photo','CI312.'||n,'CI-PHOTO',uid,'27.CI','agdata311_recovery',
  case when n=17 then 'depleted' else 'expired' end,0,clock_timestamp()-interval '2 days',80
from ci_photo_recovery where n<=17;
commit;
