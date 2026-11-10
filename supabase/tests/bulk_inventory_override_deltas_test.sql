-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(14);

insert into app_sync_private.import_runs(id,source_keys,canonical_keys,state,expires_at)
values ('173e8bc3-d04d-43dc-8ed2-b86138c55b6d',array['ph_master_inventory'],
  array['ph_master_inventory'],'active',now()+interval '10 minutes');
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,season,ptronhand,ptrreviewed,ptravailable)
values ('override-deltas-exact','OVERRIDE-FIXTURE','C.01.001','27.F1','F1','7','4','0'),
       ('override-deltas-unknown','OVERRIDE-UNKNOWN','C.01.002','27.F1','F1','7','4','3');

create temp table ph_master_bulk_stage_v1 on commit drop as
select 1::bigint row_number,'{"ptronhand":"12","ptrreviewed":"5","ptravailable":"2"}'::jsonb raw_values,m.*
from public.ph_master_inventory m where m.unique_id='override-deltas-exact';
insert into ph_master_bulk_stage_v1
select 2,'{"ptronhand":"99","ptrreviewed":"99","ptravailable":"99"}'::jsonb,m.*
from public.ph_master_inventory m where m.unique_id='override-deltas-exact';
update ph_master_bulk_stage_v1 set unique_id='override-deltas-ambiguous' where row_number=2;
update ph_master_bulk_stage_v1 set
  raw_values=raw_values||'{"priority":"4.0","spec":"Argos spec","locationnote":null,"av_note":"Argos AV note"}',
  priority='4.0',spec='Argos spec',av_note='Argos AV note',locationnote=null
where row_number=1;
insert into ph_master_bulk_stage_v1
select 3,'{"ptronhand":"12","ptrreviewed":null,"ptravailable":"2"}'::jsonb,m.*
from public.ph_master_inventory m where m.unique_id='override-deltas-unknown';
create temp table ph_master_bulk_map_v1(row_number bigint,canonical_unique_id text,candidate_count integer) on commit drop;
insert into ph_master_bulk_map_v1 values
  (1,'override-deltas-exact',1),(2,'override-deltas-exact',2),(3,'override-deltas-unknown',1);

insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,erp_baseline_value,app_override_value,updated_by)
values ('override-deltas-exact','ptronhand','"10"','"7"','override_fixture'),
       ('override-deltas-exact','ptrreviewed','"8"','"4"','override_fixture'),
       ('override-deltas-exact','ptravailable','"7"','"0"','override_fixture'),
       ('override-deltas-unknown','ptronhand','null','"7"','override_fixture'),
       ('override-deltas-unknown','ptrreviewed','"5"','"4"','override_fixture'),
       ('override-deltas-unknown','ptravailable','"8"','"3"','override_fixture')
on conflict(canonical_unique_id,field_name) do update set
  erp_baseline_value=excluded.erp_baseline_value,app_override_value=excluded.app_override_value,pending=true;
insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,
  app_override_value,latest_erp_value,pending,updated_by)
values ('override-deltas-exact','priority','"4"',null,true,'override_fixture'),
       ('override-deltas-exact','spec','"App spec"','"Old spec"',true,'override_fixture'),
       ('override-deltas-exact','date_completed','"2026-01-02T03:04:05Z"','"Old date"',true,'override_fixture'),
       ('override-deltas-exact','locationnote',null,'"Old note"',true,'override_fixture'),
       ('override-deltas-exact','av_note','"Historical app note"','"Previous AV note"',false,'override_fixture');
insert into app_sync_private.inventory_season_stock_overrides_v1(itemcode,season,open_stock,season_oh,updated_by)
values ('OVERRIDE-FIXTURE','F1',8,11,'override_fixture');

select lives_ok($$select private.apply_inventory_live_overrides_bulk_v1('173e8bc3-d04d-43dc-8ed2-b86138c55b6d')$$,
  'canonical bulk stage applies authorized numeric and seasonal overrides');
select is((select jsonb_build_array(ptronhand,ptrreviewed,ptravailable) from ph_master_bulk_stage_v1 where row_number=1),
  '["9","1","0"]'::jsonb,'raw ERP stock receives only the corresponding pending delta, with a zero floor');
select is((select jsonb_build_array(s_lts,season_oh) from ph_master_bulk_stage_v1 where row_number=1),
  '["8","11"]'::jsonb,'both fixed season stock fields are written to the exact stage row');
select is((select jsonb_object_agg(field_name,jsonb_build_array(erp_baseline_value,app_override_value,latest_erp_value))
  from app_sync_private.inventory_live_overrides_v1 where canonical_unique_id='override-deltas-exact'
    and field_name in ('ptronhand','ptrreviewed','ptravailable') and pending),
  '{"ptronhand":["12","9","12"],"ptrreviewed":["5","1","5"],"ptravailable":["2","0","2"]}'::jsonb,
  'each pending ledger entry rebases to the raw ERP value and matching staged value');
select is((select jsonb_build_array(ptronhand,ptrreviewed,ptravailable,s_lts,season_oh)
  from ph_master_bulk_stage_v1 where row_number=2),'["7","4","0",null,null]'::jsonb,
  'ambiguous stage identity cannot apply numeric or seasonal overrides');
select is((select jsonb_build_array(ptronhand,ptrreviewed,ptravailable,s_lts,season_oh)
  from public.ph_master_inventory where unique_id='override-deltas-exact'),'["7","4","0",null,null]'::jsonb,
  'the override preparation leaves live stock to the enclosing bulk publisher');
select is((select jsonb_build_array(ptronhand,ptrreviewed,ptravailable)
  from ph_master_bulk_stage_v1 where row_number=3),'["7","4","0"]'::jsonb,
  'unknown ERP baselines and null raw fields preserve app stock while known deltas still apply');
select is((select jsonb_object_agg(field_name,erp_baseline_value)
  from app_sync_private.inventory_live_overrides_v1 where canonical_unique_id='override-deltas-unknown' and pending),
  '{"ptronhand":null,"ptrreviewed":"5","ptravailable":"2"}'::jsonb,
  'only numerically grounded fields advance their ERP baseline');
select is((select priority from ph_master_bulk_stage_v1 where row_number=1),'4.0',
  'matching numeric source retains its original staged representation');
select is((select jsonb_object_agg(field_name,latest_erp_value) from app_sync_private.inventory_live_overrides_v1
  where canonical_unique_id='override-deltas-exact' and field_name in ('priority','locationnote')
    and not pending and reconciled_at is not null),'{"priority":"4.0","locationnote":null}'::jsonb,
  'matching raw numeric and explicit null fields are acknowledged');
select is((select jsonb_build_array(spec, date_completed='2026-01-02T03:04:05Z'::timestamptz, av_note)
  from ph_master_bulk_stage_v1 where row_number=1),'["App spec",true,"Argos AV note"]'::jsonb,
  'one typed patch retains mismatched text and omitted timestamps alongside untouched fields');
select is((select jsonb_object_agg(field_name,latest_erp_value) from app_sync_private.inventory_live_overrides_v1
  where canonical_unique_id='override-deltas-exact' and field_name in ('spec','date_completed')
    and pending and reconciled_at is null),'{"spec":"Argos spec","date_completed":"Old date"}'::jsonb,
  'mismatched source advances latest evidence and an omitted source keeps its prior witness');
select is((select latest_erp_value from app_sync_private.inventory_live_overrides_v1
  where canonical_unique_id='override-deltas-exact' and field_name='av_note' and not pending),'"Previous AV note"'::jsonb,
  'already reconciled edits are not revived or rewritten');
select is((select jsonb_build_array(old_oh,new_oh,old_review,new_review,pending_out,order_delta)
  from pg_temp.erp_order_delta_v23196 where unique_id='override-deltas-exact'),'[7,12,4,5,3,1]'::jsonb,
  'the raw stock witness uses the pre-overlay ledger and source quantities');

select * from finish();
rollback;
