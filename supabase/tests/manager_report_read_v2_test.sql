-- @test-runtime: isolated-supabase
-- Exercises bounded report semantics, source-date diagnostics and service-only access.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(49);

select ok(has_function_privilege('service_role','public.manager_report_read_v2(jsonb)','execute')
  and not has_function_privilege('authenticated','public.manager_report_read_v2(jsonb)','execute')
  and not has_function_privilege('anon','public.manager_report_read_v2(jsonb)','execute'),
  'manager report read is service-only');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid='public.manager_report_read_v2(jsonb)'::regprocedure),'report RPC is security definer with a pinned search path');
select ok(has_function_privilege('service_role','public.manager_ncr_outbox_metadata_v1(text,text)','execute')
  and not has_function_privilege('authenticated','public.manager_ncr_outbox_metadata_v1(text,text)','execute')
  and not has_function_privilege('anon','public.manager_ncr_outbox_metadata_v1(text,text)','execute'),
  'NCR outbox aggregate is service-only');
select is(private.manager_report_ncr_active_line_count_v1('[[GNC_NCR_ITEM_INQUIRY:{"activeRows":[{"id":1},{"id":2}]}]]'),2,
  'outbox package active-line count parses the serialized active rows');
select is(private.manager_report_sales_year_v1('27'),2027,'two-digit sales year resolves to the configured century');
select is(private.manager_report_date_v1('not-a-date')::text,null::text,'invalid date text is rejected safely');
select ok(private.manager_report_grid_filter_v1('32','{"value":">= 30"}'::jsonb),'numeric grid expressions compare numerically');
select ok(private.manager_report_grid_filter_v1('Long container fixture','{"value":"long cont"}'::jsonb),'text grid expressions require every lowercase token');
select ok(private.manager_report_progressive_search_v1(array['Maple red'],'red map'),
  'progressive report search matches tokens at word starts across fields');
select ok(not private.manager_report_progressive_search_v1(array['Maple red'],'maple blue'),
  'progressive report search rejects unmatched tokens');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('9f8b0000-0000-4000-8000-000000000091','manager-report-read@example.invalid',now(),'{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000091','dylan_collyge','Manager Report Fixture','ADMIN',false)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":27}'::jsonb,'dylan_collyge',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
insert into public.ph_eval_report_settings(singleton,low_stock_max_slts,hold_age_days,location_note_age_days,updated_by)
values(true,150,5,10,'dylan_collyge') on conflict(singleton) do update set low_stock_max_slts=150,hold_age_days=5,location_note_age_days=10;
insert into public.app_dataset_revisions(key,revision,state)
values('ph_master_inventory',1,'ready'),('ph_eval_report_settings',1,'ready'),
  ('ph_cav_import',1,'ready'),('ph_inventory_row_assignments',1,'ready')
on conflict(key) do update set state='ready',revision=greatest(public.app_dataset_revisions.revision,1);
update private.ph_inventory_row_assignment_policy_state set active=true,source_revision=1 where singleton;

insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,
  ptravailable,priority,season,saleyear,s_lts,desigitem,holdstopcode,holdstopbegindate,locationnotedate,source)
values
 ('MRV2-E2-S1','MRV2-UNION','Report Union Fixture','#3','A.01.001','27.S1','10','8','1','S1','27','20','','','','','PH'),
 ('MRV2-E2-U1','MRV2-UNION','Report Union Fixture','#3','A.01.002','27.U1','10','8','','U1','27','20','','','','','PH'),
 ('MRV2-E2-U2','MRV2-UNION','Report Union Fixture','#3','A.01.003','27.U2','10','8','','U2','27','20','','','invalid hold date','invalid note date','PH'),
 ('MRV2-E2-SHFT','MRV2-UNION','Report Union Fixture','#3','A.01.004','27.U3','10','8','','U3','27','20','SHFT','','','','PH'),
 ('MRV2-OVERRIDE-F1','MRV2-OVERRIDE','Override Fixture','#1','B.01.001','27.F1','10','8','','F1','27','20','','','','','PH'),
 ('MRV2-OVERRIDE-S1','MRV2-OVERRIDE','Override Fixture','#1','B.01.002','27.S1','10','8','','S1','27','20','','','','','PH'),
 ('MRV2-E1','MRV2-EVAL1','Eval One Fixture','#2','C.01.001','27.F1','10','8','1','F1','27','20','','H','invalid hold date','invalid note date','PH'),
 ('MRV2-GOLD-U3','MRV2-GOLD-U3','Golden U3','#2','D.01.001','27.U3','10','8','','U3','27','20','','','','','PH'),
 ('MRV2-GOLD-NOTE','MRV2-GOLD-NOTE','Golden Note','#2','D.02.001','27.F1','10','8','','F1','27','20','','','',to_char((now() at time zone 'America/Chicago')::date-11,'YYYY-MM-DD'),'PH'),
 ('MRV2-GOLD-HOLD','MRV2-GOLD-HOLD','Golden Hold','#2','D.03.001','27.F1','10','8','','F1','27','20','','H',to_char((now() at time zone 'America/Chicago')::date-6,'YYYY-MM-DD'),'','PH'),
 ('MRV2-GOLD-OFF-HOLD','MRV2-GOLD-OFF-HOLD','Golden Off Hold','#2','D.04.001','27.F1','10','8','','F1','27','20','','H',to_char((now() at time zone 'America/Chicago')::date-6,'YYYY-MM-DD'),'','PH'),
 ('MRV2-GOLD-OFF-CLEAR','MRV2-GOLD-OFF-HOLD','Golden Off Hold','#2','D.04.002','27.F1','10','8','','F1','27','20','','','','','PH'),
 ('MRV2-GOLD-LOW-F1','MRV2-GOLD-LOW','Golden Low Stock','#2','D.05.001','27.F1','10','8','','F1','27','3','','','','','PH'),
 ('MRV2-GOLD-LOW-U1','MRV2-GOLD-LOW','Golden Low Stock','#2','D.05.002','27.U1','10','8','','U1','27','20','','','','','PH'),
 ('MRV2-GOLD-LOW-S1','MRV2-GOLD-LOW','Golden Low Stock','#2','D.05.003','27.S1','10','8','','S1','27','20','','','','','PH'),
 ('MRV2-GOLD-CULL','MRV2-GOLD-CULL','Golden Cull','#2','D.06.001','27.X','10','8','','X','27','20','','','','','PH'),
 ('MRV2-GOLD-FUTURE','MRV2-GOLD-FUTURE','Golden Future F1','#2','D.07.001','28.F1','10','8','','F1','28','20','','','','','PH'),
 ('MRV2-BASE-1','MRV2-BASE','Location Base Fixture','#2','E.01.001','27.F1','10','8','1','F1','27','20','','','','','PH'),
 ('MRV2-BASE-2','MRV2-BASE','Location Base Fixture','#2','E.01.002','27.F1','10','8','1','F1','27','20','','','','','PH'),
 ('MRV2-GOLD-BOUNDARY','MRV2-GOLD-BOUNDARY','Golden Date Boundary','#2','D.08.001','27.F1','10','8','','F1','27','20','', 'H',
   to_char((now() at time zone 'America/Chicago')::date-5,'YYYY-MM-DD'),
   to_char((now() at time zone 'America/Chicago')::date-10,'YYYY-MM-DD'),'PH'),
 ('MRV2-LOW-NO-TARGET-F1','MRV2-LOW-NO-TARGET','Low Stock Without Target Fixture','#2','Z.98.001','27.F1','10','8','','F1','27','1','','','','','PH'),
 ('MRV2-SHARED-LOC-LOT1','MRV2-SHARED-LOC','Shared Location Fixture','#2','Z.99.001','27.U1-A','10','8','','U1','27','20','','','','','PH'),
 ('MRV2-SHARED-LOC-LOT2','MRV2-SHARED-LOC','Shared Location Fixture','#2','Z.99.001','27.U1-B','10','8','','U1','27','20','','','','','PH'),
 ('MRV2-SHARED-LOC-OTHER','MRV2-SHARED-OTHER','Shared Location Other Item','#2','Z.99.001','27.U1','10','8','','U1','27','20','','','','','PH');
update public.ph_master_inventory set app_tab_assignment='ncr_outbox_new_crop',
  ncr_approval_message='[[GNC_NCR_ITEM_INQUIRY:{"activeRows":[{"unique_id":"MRV2-E1"},{"unique_id":"MRV2-E2"}]}]]'
where unique_id='MRV2-E1';
insert into public.ph_inventory_row_assignments(master_unique_id,unique_id,itemcode,itemcode_normalized,commonname,
  contsize,locationcode,lotcode,source,assignedto,assignment_reason,present_in_drive)
values('MRV2-E2-S1','MRV2-E2-S1','MRV2-UNION','MRV2-UNION','Report Union Fixture','#3','A.01.001','27.S1','PH',
  'dylan_collyge','unresolved_preserved',true)
on conflict(master_unique_id) do update set assignedto=excluded.assignedto,present_in_drive=true;
insert into private.ph_eval_item_low_stock_overrides(itemcode_normalized,manual_override_qty,updated_by)
values('MRV2-OVERRIDE',5,'dylan_collyge') on conflict(itemcode_normalized) do update set manual_override_qty=5,updated_by='dylan_collyge';
insert into private.ph_eval_item_low_stock_overrides(itemcode_normalized,manual_override_qty,updated_by)
values('MRV2-GOLD-LOW',4,'dylan_collyge') on conflict(itemcode_normalized) do update set manual_override_qty=4,updated_by='dylan_collyge';

create temporary table report_read_results(name text primary key,result jsonb not null);
create temporary table report_golden_results(name text primary key,result jsonb not null);
insert into report_golden_results
select fixture.name,public.manager_report_read_v2(jsonb_build_object(
  'actorUsername','dylan_collyge','surface','eval2','operation','rows','limit',100,
  'filters',jsonb_build_object('itemCode',fixture.itemcode,'reportIds',
    jsonb_build_array('s1-with-pri','u1','u2','u3','od-loc-note-date','hs-plus-5-days',
      'get-off-hold','low-stock','no-pri','culls','not-in-f1'))))
from (values
  ('u3','MRV2-GOLD-U3'),('note','MRV2-GOLD-NOTE'),('hold','MRV2-GOLD-HOLD'),
  ('off-hold','MRV2-GOLD-OFF-HOLD'),('low-stock','MRV2-GOLD-LOW'),('culls','MRV2-GOLD-CULL'),
  ('future-f1','MRV2-GOLD-FUTURE'),('date-boundary','MRV2-GOLD-BOUNDARY')
) fixture(name,itemcode);
insert into report_read_results values
('eval2_groups',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','groups',
  'filters',jsonb_build_object('itemCode','MRV2-UNION','reportIds',jsonb_build_array('s1-with-pri','u1','u2')),'limit',25))),
('eval2_blockgroups',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','groups',
  'filters',jsonb_build_object('itemCode','MRV2-UNION','reportIds',jsonb_build_array('s1-with-pri','u1','u2'),'groupBy','blockalpha'),'limit',25))),
('eval2_cards',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','rows',
  'filters',jsonb_build_object('itemCode','MRV2-UNION','reportIds',jsonb_build_array('s1-with-pri','u1','u2'),'cardRows',true,'projection','card'),'limit',100))),
('eval2_explicit_season',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','rows',
  'filters',jsonb_build_object('itemCode','MRV2-UNION','reportIds',jsonb_build_array('s1-with-pri','u1','u2'),'seasons',jsonb_build_array('S1'),'cardRows',true),'limit',100))),
('eval2_export',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','rows',
  'filters',jsonb_build_object('itemCode','MRV2-UNION','reportIds',jsonb_build_array('s1-with-pri','u1','u2'),'projection','full'),'limit',100))),
('eval1_metadata',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval1','operation','metadata',
  'filters',jsonb_build_object('itemCode','MRV2-EVAL1','selectedItemCodes',jsonb_build_array('MRV2-EVAL1')),'limit',25))),
('eval1_blockgroup',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval1','operation','groups',
  'filters',jsonb_build_object('itemCode','MRV2-EVAL1','groupBy','blockalpha'),'limit',25))),
('eval1_locationbase',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval1','operation','groups',
  'filters',jsonb_build_object('itemCode','MRV2-BASE','reportIds',jsonb_build_array('s1-with-pri'),'groupBy','locationbase'),'limit',25))),
('lowstock_override',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','rows',
  'filters',jsonb_build_object('itemCode','MRV2-OVERRIDE','reportIds',jsonb_build_array('low-stock')),'limit',100))),
('lowstock_missing_target',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','rows',
  'filters',jsonb_build_object('itemCode','MRV2-LOW-NO-TARGET','reportIds',jsonb_build_array('low-stock')),'limit',100))),
('shared_location_rows',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','rows',
  'filters',jsonb_build_object('locationcode','Z.99.001','reportIds',jsonb_build_array('u1')),'limit',100))),
('shared_location_item_groups',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','groups',
  'filters',jsonb_build_object('locationcode','Z.99.001','reportIds',jsonb_build_array('u1'),'groupBy','itemcode'),'limit',25))),
('shared_location_location_groups',public.manager_report_read_v2(jsonb_build_object('actorUsername','dylan_collyge','surface','eval2','operation','groups',
  'filters',jsonb_build_object('locationcode','Z.99.001','reportIds',jsonb_build_array('u1'),'groupBy','locationcode'),'limit',25)));

select is((select result->>'total' from report_read_results where name='eval2_groups'),'1','multiple report memberships produce one grouped item');
select is((select (result->'rows'->0->>'rowCount')::integer from report_read_results where name='eval2_groups'),4,'Eval2 broad card group includes current sibling rows');
select is((select (result->'rows'->0->>'reportRowCount')::integer from report_read_results where name='eval2_groups'),3,'group report count reflects the union-qualified rows only');
select is((select (result->'rows'->0->>'rowCount')::integer from report_read_results where name='eval2_blockgroups'),3,
  'Eval2 block drill groups count only filtered report rows rather than sibling card rows');
select ok((select result->'rows'->0->'assignedToUsers' ? 'dylan_collyge' from report_read_results where name='eval2_groups'),
  'Eval2 group owner is resolved from the exact physical row assignment');
select is((select jsonb_array_length(result->'rows') from report_read_results where name='eval2_cards'),4,'card row projection is bounded and includes sibling rows');
select is((select jsonb_array_length(result->'rows') from report_read_results where name='eval2_explicit_season'),1,'explicit season narrows card projection to report rows');
select is((select result->>'total' from report_read_results where name='eval2_export'),'3','export returns the full qualified report membership');
select is((select result->>'total' from report_read_results where name='eval1_metadata'),'0','metadata operation has no page total');
select is((select result->'metadata'->>'filteredRowCount' from report_read_results where name='eval1_metadata'),'1','Eval1 default classification returns the current F1 priority row');
select ok((select result->'metadata'->'diagnostics'->>'invalidHoldStartDateCount'='1'
  and result->'metadata'->'diagnostics'->>'invalidLocationNoteDateCount'='1' from report_read_results where name='eval1_metadata'),
  'Eval1 diagnostics count invalid dates using Central time source');
select is((select result->>'total' from report_read_results where name='lowstock_override'),'0','manual low-stock override wins over the global threshold');
select ok((select result->>'total'='1' and result->'rows' @> '[{"unique_id":"MRV2-LOW-NO-TARGET-F1","reportIds":["low-stock","no-pri"]}]'::jsonb
  from report_read_results where name='lowstock_missing_target'),
  'missing low-stock target stats and override preserve qualifying inventory rows using the global threshold');
select ok((select result->>'total'='3' and jsonb_array_length(result->'rows')=3
  from report_read_results where name='shared_location_rows'),
  'multiple lots and items at one location remain three inventory report rows');
select ok((select result->>'total'='2' and (result->'rows'->0->>'rowCount')::integer+(result->'rows'->1->>'rowCount')::integer=3
  from report_read_results where name='shared_location_item_groups'),
  'shared-location item groups retain two itemcodes and three distinct inventory rows');
select ok((select result->>'total'='1' and result->'rows'->0->>'itemCount'='2' and result->'rows'->0->>'rowCount'='3'
  from report_read_results where name='shared_location_location_groups'),
  'location grouping does not multiply rows when lots and itemcodes share one location');
select is((select item_row->>'loc_on_hand' from report_read_results r
  cross join lateral jsonb_array_elements(r.result->'rows') item_row
  where r.name='shared_location_rows' and item_row->>'unique_id'='MRV2-SHARED-LOC-LOT1'),'20',
  'public Manager row projection sums both lots for the exact item and location only');
select is((select item_row->>'loc_on_hand_revision' from report_read_results r
  cross join lateral jsonb_array_elements(r.result->'rows') item_row
  where r.name='shared_location_rows' and item_row->>'unique_id'='MRV2-SHARED-LOC-LOT1'),
  (select result->>'inventoryRevision' from report_read_results where name='shared_location_rows'),
  'public Manager rows carry the inventory revision from the response envelope');
select is((select item_row->'representativeRow'->>'loc_on_hand' from report_read_results r
  cross join lateral jsonb_array_elements(r.result->'rows') item_row
  where r.name='shared_location_item_groups' and item_row->>'itemCode'='MRV2-SHARED-LOC'),'20',
  'public Manager grouped representative rows receive the item and location total');
select ok((select result->>'hasMore'='false' from report_read_results where name='eval1_metadata'),'metadata response is not an incomplete empty page');
select is((public.manager_ncr_outbox_metadata_v1('dylan_collyge','new-crop')->>'activeLineCount'),'2',
  'NCR outbox metadata aggregates all active lines independently of the page');
select ok((select result->'rows' @> '[{"unique_id":"MRV2-GOLD-U3","reportIds":["u3","no-pri","not-in-f1"]}]'::jsonb
  from report_golden_results where name='u3'),'U3 row matches all three script-compatible memberships');
select ok((select result->'rows' @> '[{"unique_id":"MRV2-GOLD-NOTE","reportIds":["od-loc-note-date","no-pri"]}]'::jsonb
  from report_golden_results where name='note'),'Central-date-relative old location note matches its strict report boundary');
select ok((select result->'rows' @> '[{"unique_id":"MRV2-GOLD-HOLD","reportIds":["hs-plus-5-days","no-pri"]}]'::jsonb
  from report_golden_results where name='hold'),'Central-date-relative old H hold matches its strict report boundary');
select ok((select result->'rows' @> '[{"unique_id":"MRV2-GOLD-OFF-CLEAR","reportIds":["get-off-hold","no-pri"]}]'::jsonb
  from report_golden_results where name='off-hold'),'an old item hold qualifies the sibling with a cleared hold code');
select ok((select result->'rows' @> '[{"unique_id":"MRV2-GOLD-LOW-U1","reportIds":["u1","low-stock","no-pri"]}]'::jsonb
  and result->'rows' @> '[{"unique_id":"MRV2-GOLD-LOW-S1","reportIds":["low-stock","no-pri"]}]'::jsonb
  from report_golden_results where name='low-stock'),'low-stock override qualifies both U1 and configured next-season S1 rows');
select ok((select result->'rows' @> '[{"unique_id":"MRV2-GOLD-CULL","reportIds":["no-pri","culls","not-in-f1"]}]'::jsonb
  from report_golden_results where name='culls'),'X season row retains culls, no-priority and not-in-F1 membership');
select ok((select result->'rows' @> '[{"unique_id":"MRV2-GOLD-FUTURE","reportIds":["no-pri","not-in-f1"]}]'::jsonb
  from report_golden_results where name='future-f1'),'future F1 year is not treated as a valid current F1 row');
select ok((select not (result->'rows' @> '[{"unique_id":"MRV2-GOLD-BOUNDARY","reportIds":["hs-plus-5-days"]}]'::jsonb)
  and not (result->'rows' @> '[{"unique_id":"MRV2-GOLD-BOUNDARY","reportIds":["od-loc-note-date"]}]'::jsonb)
  from report_golden_results where name='date-boundary'),'hold and location note age thresholds remain strict at exactly five and ten days');
select ok((select result->'rows' @> '[{"unique_id":"MRV2-E2-S1","reportIds":["s1-with-pri"]}]'::jsonb
  from report_read_results where name='eval2_cards'),'priority row has the exact S1WithPRI membership');
select is((select result->'metadata'->>'groupCount' from report_read_results where name='eval1_metadata'),'1','metadata reports the complete filtered group count');
select is((select result->'rows'->0->>'value' from report_read_results where name='eval1_blockgroup'),'C',
  'Eval1 block browse falls back to the first location character');
select ok((select result->'rows'->0->>'fullLocationCount'='2' and result->'rows'->0->'fullLocations' @> '["E.01.001","E.01.002"]'::jsonb
  from report_read_results where name='eval1_locationbase'),'Eval1 location-base browse preserves the distinct bay locations');
select is((select result->'metadata'->>'matchingSelectedItemCount' from report_read_results where name='eval1_metadata'),'1','selection count includes selected matching itemcodes outside the mounted page');
select is((select result->'metadata'->>'matchingSelectedItemCount' from report_read_results where name='eval2_groups'),'0','empty selected itemcode list returns zero selected groups');
select ok(to_regclass('public.idx_ph_master_inventory_eval_itemcode_lookup') is not null
  and (select indisvalid from pg_index where indexrelid='public.idx_ph_master_inventory_eval_itemcode_lookup'::regclass)
  and position('upper(btrim(coalesce(itemcode' in lower(regexp_replace(pg_get_indexdef('public.idx_ph_master_inventory_eval_itemcode_lookup'::regclass),'[[:space:]\"]','','g')))>0,
  'normalized itemcode expression index exists, is valid and matches the RPC lookup predicate');
select ok(to_regclass('public.ph_inventory_row_assignments_owner_idx') is not null
  and (select indisvalid from pg_index where indexrelid='public.ph_inventory_row_assignments_owner_idx'::regclass)
  and position('assignedto' in lower(pg_get_expr((select indpred from pg_index where indexrelid='public.ph_inventory_row_assignments_owner_idx'::regclass),
    'public.ph_inventory_row_assignments'::regclass)))>0,
  'owner lookup index is valid and has its assignment-presence predicate');
set local enable_seqscan=off;
create temporary table manager_report_query_plan(plan jsonb);
do $$
declare
  query_plan jsonb;
begin
  execute format('explain (format json) select unique_id from public.ph_master_inventory where upper(btrim(coalesce(itemcode,%L)))=%L',
    '', 'MRV2-UNION') into query_plan;
  insert into manager_report_query_plan values(query_plan);
end
$$;
select ok((select plan::text like '%idx_ph_master_inventory_eval_itemcode_lookup%' from manager_report_query_plan),
  'selective normalized itemcode predicate has a usable index plan');
select throws_ok($$select public.manager_report_read_v2('{"actorUsername":"dylan_collyge","surface":"eval1","operation":"metadata","sourceRevision":"stale"}'::jsonb)$$,
  '40001','manager_report_source_revision_changed','source revision mismatch requires the frontend to restart its page sequence');

select * from finish();
rollback;
