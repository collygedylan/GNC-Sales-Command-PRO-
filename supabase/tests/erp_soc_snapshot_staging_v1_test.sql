-- Disposable PostgreSQL only; compose the SOC draft migration before this.
-- Function calls commit separately to model RPC transaction boundaries.
create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.jwt.claim.role','service_role',false);
select set_config('request.headers','{}',false);

select ok(not has_table_privilege('service_role','app_sync_private.erp_snapshot_stage_rows_v1','select'),
  'private typed staging is accessed only through RPCs');
select ok((select relrowsecurity from pg_class where oid='app_sync_private.erp_snapshot_stage_rows_v1'::regclass),
  'typed staging has RLS enabled');
select is((select count(*)::integer from pg_attribute where attrelid='app_sync_private.erp_snapshot_stage_rows_v1'::regclass
  and attnum>5 and not attisdropped),86,'stage contains exactly81 source fields plus derived size and four generated fields');
select ok(not exists(select 1 from pg_attribute where attrelid='app_sync_private.erp_snapshot_stage_rows_v1'::regclass
  and attnum>0 and attname in ('date_completed','assignedto','dock_photo_link','av_note')),
  'app-owned fields are absent from staging');
select ok(not has_function_privilege('authenticated','public.begin_erp_snapshot_stage_v1(uuid,uuid,text,jsonb,text,integer,integer)','execute'),
  'browser users cannot begin ERP snapshots');
select ok(not has_function_privilege('anon','public.finalize_erp_snapshot_stage_v1(uuid,uuid,text,text)','execute'),
  'anonymous users cannot publish ERP snapshots');
select ok((select proconfig @> array['statement_timeout=120s','lock_timeout=15s']
  from pg_proc where oid='public.begin_erp_snapshot_stage_v1(uuid,uuid,text,jsonb,text,integer,integer)'::regprocedure),
  'begin declares120second statement and15second lock bounds');
select ok((select proconfig @> array['statement_timeout=120s','lock_timeout=15s']
  from pg_proc where oid='public.append_erp_snapshot_stage_chunk_v1(uuid,uuid,text,integer,jsonb)'::regprocedure),
  'append declares120second statement and15second lock bounds');
select ok((select proconfig @> array['statement_timeout=120s','lock_timeout=15s']
  from pg_proc where oid='public.finalize_erp_snapshot_stage_v1(uuid,uuid,text,text)'::regprocedure),
  'finalize declares120second statement and15second lock bounds');
select set_config('request.jwt.claims','{"role":"authenticated"}',false);
select set_config('request.jwt.claim.role','authenticated',false);
select throws_ok($$select public.begin_erp_snapshot_stage_v1(null,null,'ph_soc_master','[]',repeat('a',64),1,1)$$,
  '42501','ERP_SNAPSHOT_FORBIDDEN','source operations require service role');
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.jwt.claim.role','service_role',false);

insert into app_sync_private.sources(key,modules) values
  ('ph_soc_master',array['docks']),('ph_reserves',array['reserves']),
  ('ph_customer_consignee_sales_reps',array['customer-rep-map']) on conflict(key) do nothing;
insert into public.app_dataset_revisions(key,revision,state) values
  ('ph_soc_master',1,'ready'),('ph_reserves',1,'ready'),('ph_customer_consignee_sales_reps',1,'ready')
  on conflict(key) do nothing;
insert into public.ph_customer_consignee_sales_reps(unique_id,customeridentityid,consigneeid,
  customername,consigneename,salesrepid,salesrepname,customerstatus,consigneestatus)
values('v2313-erp-map-protected','ERP-C1','ERP-Q1','  Existing customer  ','Existing consignee','EXISTING-REP','Existing Rep','A','A'),
  ('v2313-erp-map-blank','ERP-C2','ERP-Q2',null,null,null,null,'A','A')
on conflict(unique_id) do nothing;
create temporary table v2313_erp_map_before on commit preserve rows as
select customeridentityid,consigneeid,customername,consigneename,salesrepid,salesrepname
from public.ph_customer_consignee_sales_reps where unique_id='v2313-erp-map-protected';
create temporary table v2313_erp_rows(target_table text,row_number integer,payload jsonb,
  primary key(target_table,row_number)) on commit preserve rows;
create temporary table v2313_erp_rpc_metrics(target_table text,scenario text,operation text,item_index integer,
  dataset_rows integer,cache_condition text,elapsed_ms numeric) on commit preserve rows;
create temporary table v2313_erp_responses(target_table text,scenario text,response jsonb,
  primary key(target_table,scenario)) on commit preserve rows;
create temporary table v2313_erp_context(target_table text primary key,run_id uuid,request_id uuid,
  source_digest text,expected_rows integer) on commit preserve rows;
create temporary table v2313_erp_errors(case_name text primary key,passed boolean,error_state text,error_message text)
  on commit preserve rows;
create temporary table v2313_erp_protected_before(target_table text primary key,fields jsonb) on commit preserve rows;

-- Both source sizes exceed the observed source volumes requested for coverage:
-- SOC32,484 rows and Reserves7,454 rows.81 headers are identical.
insert into v2313_erp_rows(target_table,row_number,payload)
select target.table_name,g.n,jsonb_object_agg(a.attname,
  case
    when a.attname='unique_id' then to_jsonb('v2313-'||target.table_name||'-'||lpad(g.n::text,6,'0'))
    when a.attname='warehouseid' then to_jsonb('10'::text)
    when a.attname='warehousename' then to_jsonb('Park Hill'::text)
    when a.attname='itemcode' then to_jsonb('SOC-'||lpad((g.n%3206)::text,5,'0'))
    when a.attname='commonname' then to_jsonb('Representative SOC source item '||(g.n%3206)::text)
    when a.attname in ('contsize','printedcontainercode','containersort') then to_jsonb('#1'::text)
    when a.attname='locationcode' then to_jsonb('C.'||lpad((1+g.n%638)::text,3,'0')||'.001')
    when a.attname='lotcode' then to_jsonb('27.S1'::text)
    when a.attname='customeridentityid' then to_jsonb('ERP-C'||(1+g.n%2)::text)
    when a.attname='customername' then to_jsonb('Source customer '||(1+g.n%2)::text)
    when a.attname='consigneeidentityid' then to_jsonb('ERP-Q'||(1+g.n%2)::text)
    when a.attname='consigneename' then to_jsonb('Source consignee '||(1+g.n%2)::text)
    when a.attname='salesrepid' then to_jsonb('ERP-SOURCE-REP'::text)
    when a.attname='salesrepname' then to_jsonb('Source Sales Rep'::text)
    when a.attname='transactionnumber' then to_jsonb('ERP-T'||(1+g.n/12)::text)
    when a.attname in ('dock','tripnumber') then to_jsonb('D'||(1+g.n%15)::text)
    when a.attname='stopnumber' then to_jsonb((1+g.n%12)::text)
    when a.attname='quantityordered' then to_jsonb((1+g.n%50)::text)
    when a.attname='quantityshipped' then to_jsonb('0'::text)
    when a.attname in ('listprice','unitprice') then to_jsonb('12.50'::text)
    when a.attname='holdstopcode' then to_jsonb('H'::text)
    when a.attname='holdstopreason' then to_jsonb('Source hold reason'::text)
    when a.attname='planstart' then to_jsonb('2026-10-21'::text)
    when a.attname='suspend' then to_jsonb('Suspend'::text)
    when a.attname='suspend_to' then to_jsonb('DC'::text)
    when a.attname='isreserve' then to_jsonb(case when target.table_name='ph_reserves' then 'Y' else 'N' end)
    when a.attname='last_updated' then to_jsonb('2026-10-19T20:00:00Z'::text)
    when a.attname='filename' then to_jsonb(target.table_name||'-source.xlsx')
    when a.attname='concat' then to_jsonb('source-hash-'||g.n::text)
    else 'null'::jsonb end order by a.attnum)
from (values('ph_soc_master'::text,32484),('ph_reserves'::text,7454)) target(table_name,row_count)
cross join lateral generate_series(1,target.row_count) g(n)
cross join pg_attribute a
where a.attrelid='app_sync_private.erp_snapshot_stage_rows_v1'::regclass and a.attnum>5 and not a.attisdropped
group by target.table_name,g.n;
select is((select count(*)::integer from v2313_erp_rows where target_table='ph_soc_master'),32484,'SOC fixture has32,484 rows');
select is((select count(*)::integer from v2313_erp_rows where target_table='ph_reserves'),7454,'Reserves fixture has7,454 rows');

-- Reject missing chunks and unsupported app fields without changing live rows.
do $preflight$
declare run_id uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); r jsonb; chunk jsonb;
begin
  perform set_config('request.headers','{}',false);
  perform public.begin_dataset_import_v1(array['ph_soc_master','ph_customer_consignee_sales_reps'],run_id,array['ph_soc_master']);
  commit;
  perform public.begin_erp_snapshot_stage_v1(run_id,request_id,'ph_soc_master',
    jsonb_build_array(jsonb_build_object('fileId','erp-invalid-canary','modifiedAt','2026-10-19T20:00:00Z','size',123)),repeat('a',64),1,1);
  commit;
  begin
    perform public.finalize_erp_snapshot_stage_v1(run_id,request_id,'ph_soc_master',repeat('a',64));
    insert into v2313_erp_errors values('missing_chunk',false,null,null);
  exception when others then
    insert into v2313_erp_errors values('missing_chunk',sqlstate='55000' and sqlerrm='ERP_SNAPSHOT_INCOMPLETE',sqlstate,sqlerrm);
  end;
  select jsonb_build_array(payload||jsonb_build_object('date_completed','2026-10-19T20:00:00Z')) into chunk
    from v2313_erp_rows where target_table='ph_soc_master' and row_number=1;
  begin
    perform public.append_erp_snapshot_stage_chunk_v1(run_id,request_id,'ph_soc_master',0,chunk);
    insert into v2313_erp_errors values('app_owned_column',false,null,null);
  exception when others then
    insert into v2313_erp_errors values('app_owned_column',sqlstate='22023' and sqlerrm='ERP_SNAPSHOT_ROW_OR_COLUMN_INVALID',sqlstate,sqlerrm);
  end;
  begin
    perform public.begin_erp_snapshot_stage_v1(run_id,request_id,'ph_soc_master',
      jsonb_build_array(jsonb_build_object('fileId','changed-source','modifiedAt','2026-10-19T20:00:00Z','size',123)),repeat('a',64),1,1);
    insert into v2313_erp_errors values('reused_request',false,null,null);
  exception when others then
    insert into v2313_erp_errors values('reused_request',sqlstate='22023' and sqlerrm='ERP_SNAPSHOT_REQUEST_REUSED',sqlstate,sqlerrm);
  end;
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',gen_random_uuid())::text,false);
  begin
    perform public.append_erp_snapshot_stage_chunk_v1(run_id,request_id,'ph_soc_master',0,'[]');
    insert into v2313_erp_errors values('wrong_fence',false,null,null);
  exception when others then
    insert into v2313_erp_errors values('wrong_fence',sqlstate='55000' and sqlerrm='ERP_SNAPSHOT_FENCE_MISMATCH',sqlstate,sqlerrm);
  end;
  perform set_config('request.headers','{}',false);
  perform public.fail_dataset_import_v1(run_id);
  commit;
end
$preflight$;
select ok(passed,'negative case '||case_name||' preserves the acceptance contract') from v2313_erp_errors order by case_name;

-- Measure new, changed, unchanged, and exact same-run transport retry for both
-- targets. Every begin/append/finalize boundary commits as a separate RPC would.
do $scenarios$
<<scenario_run>>
declare target_table text; row_count integer; scenario text; run_id uuid; request_id uuid; manifest jsonb;
  digest_value text; chunk jsonb; response_value jsonb; retry_response jsonb; chunk_index integer; chunk_count integer;
  started_at timestamptz; elapsed numeric; fixture_uid text; old_run uuid; old_request uuid; live_count integer;
begin
  foreach target_table in array array['ph_soc_master','ph_reserves'] loop
    row_count:=case when target_table='ph_soc_master' then 32484 else 7454 end;
    chunk_count:=(row_count+499)/500;
    fixture_uid:='v2313-'||target_table||'-000001';
    perform set_config('request.headers','{}',false);
    execute format('insert into public.%I(unique_id) values($1)',target_table)
      using 'v2313-'||target_table||'-sentinel';
    commit;
    foreach scenario in array array['new','changed','unchanged'] loop
      if scenario='changed' then
        update v2313_erp_rows set payload=jsonb_set(payload,'{quantityordered}',to_jsonb('999'::text))
          ||jsonb_build_object('last_updated','2026-10-19T21:00:00Z','concat','changed-source')
          where v2313_erp_rows.target_table=scenario_run.target_table;
      elsif scenario='unchanged' then
        update v2313_erp_rows set payload=payload||jsonb_build_object('last_updated','2026-10-19T22:00:00Z','filename','same-data-new-file.xlsx')
          where v2313_erp_rows.target_table=scenario_run.target_table;
      end if;
      run_id:=gen_random_uuid();request_id:=gen_random_uuid();
      manifest:=jsonb_build_array(jsonb_build_object('fileId','fixture-'||target_table||'-'||scenario,
        'modifiedAt','2026-10-19T22:00:00Z','size',row_count*2600));
      select encode(extensions.digest(convert_to(jsonb_agg(payload order by row_number)::text,'UTF8'),'sha256'),'hex')
        into digest_value from v2313_erp_rows r where r.target_table=scenario_run.target_table;
      perform set_config('request.headers','{}',false);
      perform public.begin_dataset_import_v1(array[target_table,'ph_customer_consignee_sales_reps'],run_id,array[target_table]);
      commit;
      started_at:=clock_timestamp();
      response_value:=public.begin_erp_snapshot_stage_v1(run_id,request_id,target_table,manifest,digest_value,row_count,chunk_count);
      elapsed:=extract(epoch from(clock_timestamp()-started_at))*1000;
      insert into v2313_erp_rpc_metrics values(target_table,scenario,'begin',0,row_count,'new manifest; warm database buffer',elapsed);
      commit;
      for chunk_index in 0..chunk_count-1 loop
        select jsonb_agg(payload order by row_number) into chunk from v2313_erp_rows r
          where r.target_table=scenario_run.target_table and row_number between chunk_index*500+1 and least((chunk_index+1)*500,row_count);
        started_at:=clock_timestamp();
        response_value:=public.append_erp_snapshot_stage_chunk_v1(run_id,request_id,target_table,chunk_index,chunk);
        elapsed:=extract(epoch from(clock_timestamp()-started_at))*1000;
        insert into v2313_erp_rpc_metrics values(target_table,scenario,'append',chunk_index,row_count,'new chunk; warm database buffer',elapsed);
        commit;
        if scenario='new' and chunk_index=0 then
          started_at:=clock_timestamp();
          response_value:=public.append_erp_snapshot_stage_chunk_v1(run_id,request_id,target_table,chunk_index,chunk);
          elapsed:=extract(epoch from(clock_timestamp()-started_at))*1000;
          insert into v2313_erp_rpc_metrics values(target_table,scenario,'append-retry',chunk_index,row_count,'identical cached chunk',elapsed);
          if response_value->>'replayed'<>'true' then raise exception 'ERP_FIXTURE_CHUNK_RETRY_NOT_IDEMPOTENT'; end if;
          execute format('select count(*)::integer from public.%I where unique_id like $1',target_table)
            into live_count using 'v2313-'||target_table||'-%';
          insert into v2313_erp_errors values(target_table||'_private_stage',live_count=1,null,null);
          commit;
          begin
            perform public.append_erp_snapshot_stage_chunk_v1(run_id,request_id,target_table,0,
              jsonb_set(chunk,'{0,commonname}',to_jsonb('changed immutable chunk'::text)));
            insert into v2313_erp_errors values(target_table||'_chunk_conflict',false,null,null);
          exception when others then
            insert into v2313_erp_errors values(target_table||'_chunk_conflict',sqlstate='22023' and sqlerrm='ERP_SNAPSHOT_CHUNK_REUSED',sqlstate,sqlerrm);
          end;
          commit;
          -- Continuation must retain the accepted first500 rows under a fresh
          -- canonical lease after the old run is deliberately failed.
          old_run:=run_id;
          perform set_config('request.headers','{}',false);
          perform public.fail_dataset_import_v1(old_run);
          commit;
          run_id:=gen_random_uuid();
          perform public.begin_dataset_import_v1(array[target_table,'ph_customer_consignee_sales_reps'],run_id,array[target_table]);
          commit;
          response_value:=public.begin_erp_snapshot_stage_v1(run_id,request_id,target_table,manifest,digest_value,row_count,chunk_count);
          if (response_value->>'rowsReceived')::integer<>500 or (response_value->>'nextChunkIndex')::integer<>1 then
            raise exception 'ERP_FIXTURE_REBIND_LOST_PROGRESS';
          end if;
          commit;
        end if;
      end loop;
      started_at:=clock_timestamp();
      response_value:=public.finalize_erp_snapshot_stage_v1(run_id,request_id,target_table,digest_value);
      elapsed:=extract(epoch from(clock_timestamp()-started_at))*1000;
      insert into v2313_erp_rpc_metrics values(target_table,scenario,'finalize',0,row_count,'staged typed columns; warm database buffer',elapsed);
      insert into v2313_erp_responses values(target_table,scenario,response_value);
      insert into v2313_erp_context values(target_table,run_id,request_id,digest_value,row_count)
        on conflict on constraint v2313_erp_context_pkey do update set run_id=excluded.run_id,request_id=excluded.request_id,
          source_digest=excluded.source_digest,expected_rows=excluded.expected_rows;
      commit;
      started_at:=clock_timestamp();
      retry_response:=public.finalize_erp_snapshot_stage_v1(run_id,request_id,target_table,digest_value);
      elapsed:=extract(epoch from(clock_timestamp()-started_at))*1000;
      insert into v2313_erp_rpc_metrics values(target_table,scenario,'finalize-retry',0,row_count,'same completed run publication receipt',elapsed);
      if retry_response->>'replayed'<>'true'
        or (retry_response-'replayed') is distinct from (response_value-'replayed') then
        raise exception 'ERP_FIXTURE_FINALIZE_RETRY_CHANGED_RECEIPT';
      end if;
      commit;
      if scenario='new' then
        perform set_config('request.headers','{}',false);
        if target_table='ph_soc_master' then
          update public.ph_soc_master set assignedto='protected_assignment',date_completed='2026-10-18T18:00:00Z',
            dock_photo_link='https://example.invalid/protected.jpg',dock_photo_name='protected.jpg',dock_spec='protected spec',
            dock_caliper='protected caliper',dock_note='protected note',av_note='protected AV',match='42',loc_match_qty='5',initial_ptr='7'
          where unique_id=fixture_uid;
          update public.ph_soc_master set date_completed='2026-10-18T18:00:00Z' where unique_id=fixture_uid;
          insert into v2313_erp_protected_before values(target_table,
            (select jsonb_build_object('assignedto',assignedto,'date_completed',date_completed,'dock_photo_link',dock_photo_link,
              'dock_photo_name',dock_photo_name,'dock_spec',dock_spec,'dock_caliper',dock_caliper,'dock_note',dock_note,
              'av_note',av_note,'match',match,'loc_match_qty',loc_match_qty,'initial_ptr',initial_ptr)
              from public.ph_soc_master where unique_id=fixture_uid));
        else
          update public.ph_reserves set assignedto='protected_assignment',date_completed='2026-10-18T18:00:00Z',
            photo_link='https://example.invalid/protected-reserve.jpg',photo_name='protected-reserve.jpg',
            spec='protected spec',sales_note='protected sales note' where unique_id=fixture_uid;
          insert into v2313_erp_protected_before values(target_table,
            (select jsonb_build_object('assignedto',assignedto,'date_completed',date_completed,'photo_link',photo_link,
              'photo_name',photo_name,'spec',spec,'sales_note',sales_note) from public.ph_reserves where unique_id=fixture_uid));
        end if;
        commit;
      end if;
    end loop;
  end loop;
end
$scenarios$;

select is((response->>'sourceRows')::integer,(response->>'inserted')::integer+(response->>'updated')::integer+(response->>'unchanged')::integer,
  target_table||' '||scenario||' receipt balances source rows') from v2313_erp_responses order by target_table,scenario;
select is((response->>'inserted')::integer,case when target_table='ph_soc_master' then 32484 else 7454 end,
  target_table||' new snapshot inserts every representative row') from v2313_erp_responses where scenario='new';
select is((response->>'updated')::integer,case when target_table='ph_soc_master' then 32484 else 7454 end,
  target_table||' changed snapshot updates incoming source fields') from v2313_erp_responses where scenario='changed';
select is((response->>'updated')::integer,0,target_table||' unchanged snapshot rewrites no rows')
  from v2313_erp_responses where scenario='unchanged';
select is((response->>'inserted')::integer,0,target_table||' unchanged snapshot inserts no duplicates')
  from v2313_erp_responses where scenario='unchanged';
select is((select count(*)::integer from public.ph_soc_master),32484,'SOC snapshot publishes exact row count');
select is((select count(*)::integer from public.ph_reserves),7454,'Reserves snapshot publishes exact row count');
select is((select count(*)::integer from public.ph_soc_master where quantityordered='999' and suspend='Suspend' and suspend_to='DC'
  and tripnumber is not null and stopnumber is not null and holdstopcode='H' and holdstopreason='Source hold reason' and planstart='2026-10-21'),
  32484,'SOC publishes requested Suspend queue source fields');
select is((select count(*)::integer from public.ph_reserves where quantityordered='999' and suspend='Suspend' and suspend_to='DC'
  and tripnumber is not null and stopnumber is not null and holdstopcode='H' and holdstopreason='Source hold reason' and planstart='2026-10-21'),
  7454,'Reserves publishes requested Suspend data fields');
select ok((select (m.customername,m.consigneename,m.salesrepid,m.salesrepname) is not distinct from
  (saved.customername,saved.consigneename,saved.salesrepid,saved.salesrepname)
  from public.ph_customer_consignee_sales_reps m join v2313_erp_map_before saved using(customeridentityid,consigneeid)),
  'nonempty customer mappings remain byte-for-byte unchanged');
select ok((select nullif(customername,'') is not null and nullif(consigneename,'') is not null
  and nullif(salesrepid,'') is not null and nullif(salesrepname,'') is not null
  from public.ph_customer_consignee_sales_reps where unique_id='v2313-erp-map-blank'),
  'SOC enrichment fills empty customer tuple fields');
select is((select jsonb_build_object('assignedto',assignedto,'date_completed',date_completed,'dock_photo_link',dock_photo_link,
  'dock_photo_name',dock_photo_name,'dock_spec',dock_spec,'dock_caliper',dock_caliper,'dock_note',dock_note,
  'av_note',av_note,'match',match,'loc_match_qty',loc_match_qty,'initial_ptr',initial_ptr)
  from public.ph_soc_master where unique_id='v2313-ph_soc_master-000001'),
  (select fields from v2313_erp_protected_before where target_table='ph_soc_master'),
  'SOC app assignment/completion/photo/review fields survive changed source snapshot');
select is((select jsonb_build_object('assignedto',assignedto,'date_completed',date_completed,'photo_link',photo_link,
  'photo_name',photo_name,'spec',spec,'sales_note',sales_note) from public.ph_reserves where unique_id='v2313-ph_reserves-000001'),
  (select fields from v2313_erp_protected_before where target_table='ph_reserves'),
  'Reserves app fields survive changed source snapshot');
select ok(not exists(select 1 from public.app_dataset_revisions where key in
  ('ph_soc_master','ph_reserves','ph_customer_consignee_sales_reps') and state<>'ready'),
  'source and mapping publications finish ready atomically');
select ok(not exists(select 1 from app_sync_private.import_leases where key in
  ('ph_soc_master','ph_reserves','ph_customer_consignee_sales_reps')),'successful publication releases target/map leases');
select ok(not exists(select 1 from app_sync_private.erp_snapshot_stage_rows_v1 s join v2313_erp_context c using(request_id)),
  'published typed payloads are cleaned while receipts remain');
select ok(not exists(select 1 from app_sync_private.erp_snapshot_bulk_context_v1),'private trigger deferral context is removed');
select ok(passed,'immutable chunk retry rejects changed content for '||case_name)
  from v2313_erp_errors where case_name like '%chunk_conflict';
select ok(passed,'accepted staging remains invisible to source readers for '||case_name)
  from v2313_erp_errors where case_name like '%private_stage';
select ok((response->>'deleted')::integer>=1,target_table||' complete publication removes absent sentinel')
  from v2313_erp_responses where scenario='new';
create or replace function pg_temp.erp_snapshot_fixture_fail_delete() returns trigger
language plpgsql as $fault$begin
  raise exception using errcode='P0001',message='ERP_FIXTURE_INJECTED_FINALIZE_FAILURE';
end $fault$;
create trigger v2313_erp_fixture_fail_delete before delete on public.ph_soc_master
for each row execute function pg_temp.erp_snapshot_fixture_fail_delete();
do $atomic_failure$
<<atomic_probe>>
declare run_id uuid:=gen_random_uuid();request_id uuid:=gen_random_uuid(); payload jsonb; response_value jsonb;
begin
  perform set_config('request.headers','{}',false);
  perform public.begin_dataset_import_v1(array['ph_soc_master','ph_customer_consignee_sales_reps'],run_id,array['ph_soc_master']);
  commit;
  perform public.begin_erp_snapshot_stage_v1(run_id,request_id,'ph_soc_master',
    jsonb_build_array(jsonb_build_object('fileId','atomic-fault-source','modifiedAt','2026-10-19T23:00:00Z','size',123)),repeat('f',64),1,1);
  commit;
  select jsonb_set(r.payload,'{quantityordered}',to_jsonb('9999'::text)) into payload
    from v2313_erp_rows r where target_table='ph_soc_master' and row_number=1;
  perform public.append_erp_snapshot_stage_chunk_v1(run_id,request_id,'ph_soc_master',0,jsonb_build_array(payload));
  commit;
  begin
    perform public.finalize_erp_snapshot_stage_v1(run_id,request_id,'ph_soc_master',repeat('f',64));
    insert into v2313_erp_errors values('atomic_failure',false,null,null);
  exception when others then
    insert into v2313_erp_errors values('atomic_failure',sqlstate='P0001' and sqlerrm='ERP_FIXTURE_INJECTED_FINALIZE_FAILURE',sqlstate,sqlerrm);
  end;
  insert into v2313_erp_errors values('atomic_rows_preserved',
    (select count(*)=32484 and count(*) filter(where quantityordered='999')=32484 from public.ph_soc_master),null,null);
  insert into v2313_erp_errors values('atomic_receipt_not_published',
    (select status='staging' and published_response is null from app_sync_private.erp_snapshot_stage_v1 where erp_snapshot_stage_v1.request_id=atomic_probe.request_id),null,null);
  perform set_config('request.headers','{}',false);
  perform public.fail_dataset_import_v1(run_id);
  commit;
end
$atomic_failure$;
drop trigger v2313_erp_fixture_fail_delete on public.ph_soc_master;
select ok(passed,'failed finalization rollback check '||case_name) from v2313_erp_errors where case_name like 'atomic_%';
select set_config('request.headers','{}',false);

do $performance_diagnostic$
declare slow_metrics jsonb; operation_maxima jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(m) order by elapsed_ms desc), '[]'::jsonb)
    into slow_metrics from v2313_erp_rpc_metrics m where elapsed_ms>=2000;
  select coalesce(jsonb_agg(to_jsonb(r) order by target_table,scenario,operation), '[]'::jsonb)
    into operation_maxima
  from (select distinct on(target_table,scenario,operation)
      target_table,scenario,operation,item_index,dataset_rows,cache_condition,elapsed_ms
    from v2313_erp_rpc_metrics order by target_table,scenario,operation,elapsed_ms desc) r;
  if jsonb_array_length(slow_metrics)>0 then
    raise notice 'V2313_ERP_SLOW_RPC_METRICS=%',jsonb_build_object(
      'slowMetrics',slow_metrics,'operationMaxima',operation_maxima);
  end if;
end
$performance_diagnostic$;
select ok(not exists(select 1 from v2313_erp_rpc_metrics where elapsed_ms>=2000),
  'every measured begin/500row append/finalize/retry is below the strict2000ms gate');
select jsonb_build_object('suite','soc-reserves-staged-erp','environment',version(),
  'datasetRows',jsonb_build_object('ph_soc_master',32484,'ph_reserves',7454),
  'cache','new manifest/chunk and warm PostgreSQL buffer; no network/browser timing',
  'metrics',(select jsonb_agg(to_jsonb(m) order by target_table,scenario,operation,item_index) from v2313_erp_rpc_metrics m));
-- Reproducible index/pagination evidence at the same representative volumes.
explain(analyze,buffers,format json)
select source_hash from app_sync_private.erp_snapshot_source_rows_v1
where target_table='ph_soc_master' and unique_id='v2313-ph_soc_master-000001';
explain(analyze,buffers,format json)
select unique_id,tripnumber,stopnumber,quantityordered,consigneename,salesrepname,
  holdstopcode,holdstopreason,planstart,suspend,suspend_to
from public.ph_soc_master where unique_id>'v2313-ph_soc_master-000000'
order by unique_id limit 100;
select * from finish();
