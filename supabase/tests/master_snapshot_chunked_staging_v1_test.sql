-- @test-runtime: canonical
create extension if not exists pgtap with schema extensions;
select plan(77);

select set_config('request.jwt.claims','{"role":"authenticated"}',false);
select set_config('request.jwt.claim.role','authenticated',false);
select throws_ok($$select public.begin_master_snapshot_stage_v1(
  null,null,'[]'::jsonb,repeat('a',64),1,1)$$,
  '42501','MASTER_SNAPSHOT_STAGE_FORBIDDEN','only the service role may create private staging');
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.jwt.claim.role','service_role',false);
select set_config('request.headers','{}',false);

select ok(has_function_privilege('service_role',
  'public.begin_master_snapshot_stage_v1(uuid,uuid,jsonb,text,integer,integer)','execute'),
  'service role can begin a staged snapshot');
select ok(not has_function_privilege('authenticated',
  'public.begin_master_snapshot_stage_v1(uuid,uuid,jsonb,text,integer,integer)','execute'),
  'authenticated cannot begin a staged snapshot');
select ok((select proconfig @> array['statement_timeout=120s','lock_timeout=15s']
  from pg_proc where oid='public.begin_master_snapshot_stage_v1(uuid,uuid,jsonb,text,integer,integer)'::regprocedure),
  'begin RPC declares bounded elevated timeouts');
select ok((select proconfig @> array['statement_timeout=120s','lock_timeout=15s']
  from pg_proc where oid='public.append_master_snapshot_stage_chunk_v1(uuid,uuid,integer,jsonb)'::regprocedure),
  'append RPC declares bounded elevated timeouts');
select ok((select proconfig @> array['statement_timeout=120s','lock_timeout=15s']
  from pg_proc where oid='public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure),
  'finalize RPC declares bounded elevated timeouts');
select ok(not has_table_privilege('service_role','app_sync_private.ph_master_snapshot_stage_rows_v1','select'),
  'service role accesses staging only through the fenced definer RPCs');
select ok(not has_function_privilege('anon',
    'private.ph_master_crop_roll_from_master_v1(public.ph_master_inventory)'::regprocedure,'execute')
  and not has_function_privilege('authenticated',
    'private.ph_master_crop_roll_from_master_v1(public.ph_master_inventory)'::regprocedure,'execute'),
  'narrow mapper projection is not directly callable by browser roles');
select ok((select p.prosecdef
    and pg_get_functiondef(p.oid) ~ 'private[[:space:]]*\.[[:space:]]*ph_master_crop_roll_from_master_v1[[:space:]]*\([[:space:]]*master[[:space:]]*\)'
    and pg_get_functiondef(p.oid) ~ 'gnc\.master_bulk_crop_roll_deferred'
    and pg_get_functiondef(p.oid) ~ 'c[[:space:]]*\.[[:space:]]*run_id[[:space:]]*=[[:space:]]*p_run_id'
    and pg_get_functiondef(p.oid) ~ 'c[[:space:]]*\.[[:space:]]*request_id[[:space:]]*=[[:space:]]*p_request_id'
    and pg_get_functiondef(p.oid) ~ 'c[[:space:]]*\.[[:space:]]*backend_pid[[:space:]]*=[[:space:]]*pg_backend_pid[[:space:]]*\([[:space:]]*\)'
    and pg_get_functiondef(p.oid) ~ 'c[[:space:]]*\.[[:space:]]*transaction_id[[:space:]]*=[[:space:]]*txid_current[[:space:]]*\([[:space:]]*\)'
  from pg_proc p
  where p.oid='private.sync_ph_master_bulk_crop_roll_v1(uuid,uuid,text[])'::regprocedure),
  'optimized crop-roll sync retains its definer, run marker, and transaction-bound import context');

-- Disposable-only integration draft. Run before the large performance seed.
-- Each case runs the original bulk API and staged finalizer against the SAME
-- source, then rolls every data/lease/receipt mutation back in a subtransaction.
-- The4 differential cases add8 pgTAP assertions; use no_plan or update plan.
create or replace function pg_temp.v2313_drive_guard_case_v1(p_pipeline text,p_case text)
returns jsonb language plpgsql as $canary$
declare
  run_id uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); values_row jsonb; rows_value jsonb;
  response_value jsonb; result_value jsonb; outcome text:='published'; error_state text; error_message text;
  uid_a text:='v2313-review-'||p_case||'-a'; uid_b text:='v2313-review-'||p_case||'-b';
  canonical_uid text:='v2313-review-'||p_case||'-canonical'; stable_key text; raw_fields jsonb;
begin
  begin
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    perform set_config('request.jwt.claim.role','service_role',true);
    perform set_config('request.headers','{}',true);
    values_row:=jsonb_build_object('unique_id',uid_a,'itemcode','REVIEW-'||p_case,
      'commonname','Scoped new-insert review canary','contsize','#1','locationcode','Z.97.001',
      'lotcode','27.REVIEW','source','PH','warehouseid','10','priority','2',
      'holdstopcode','SOURCE-H','holdstopreason','Source reason','holdstopbegindate','2026-10-19',
      'locationnote','Source location note','locationptn1','Source location pattern',
      'desigitem','A','desigcust',null,'desigloc',null,'pullerresponsibility',null,
      'oversellpercentage',null,'salesnote','Source sales note','suspend',null,
      'last_updated','2026-10-19T20:00:00Z','filename','drive-review.xlsx','concat','review-source');
    raw_fields:='["desigcust","desigitem","desigloc","locationnote","locationptn1","oversellpercentage","pullerresponsibility","salesnote","suspend"]';
    rows_value:=jsonb_build_array(jsonb_build_object('values',values_row,'rawFields',raw_fields));
    if p_case='duplicate_lineage' then
      rows_value:=rows_value||jsonb_build_array(jsonb_build_object('values',values_row||jsonb_build_object('unique_id',uid_b),'rawFields',raw_fields));
    elsif p_case='duplicate_stable' then
      rows_value:=rows_value||jsonb_build_array(jsonb_build_object('values',values_row||jsonb_build_object('unique_id',uid_b,'desigitem','B'),'rawFields',raw_fields));
    elsif p_case='historical_alias' then
      insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,
        warehouseid,desigitem,priority,holdstopcode,holdstopreason,locationnote)
      values(canonical_uid,'REVIEW-'||p_case,'Scoped new-insert review canary','#1','Z.97.001','27.REVIEW','PH',
        '10','OLD','2','LIVE-H','Live reason','Live location note');
      stable_key:=private.ph_master_inventory_stable_identity_v7(values_row);
      insert into app_sync_private.ph_master_inventory_item6_aliases_v7(imported_unique_id,canonical_unique_id,stable_identity_key)
      values(uid_a,canonical_uid,stable_key);
    elsif p_case='orphan_alias' then
      stable_key:=private.ph_master_inventory_stable_identity_v7(values_row);
      insert into app_sync_private.ph_master_inventory_item6_aliases_v7(imported_unique_id,canonical_unique_id,stable_identity_key)
      values(uid_a,canonical_uid,stable_key);
    else
      raise exception 'Unknown canary case: %',p_case;
    end if;
    perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
    begin
      if p_pipeline='original' then
        response_value:=public.bulk_import_master_snapshot_v1(run_id,request_id,rows_value,repeat('a',64));
      elsif p_pipeline='staged' then
        perform public.begin_master_snapshot_stage_v1(run_id,request_id,
          jsonb_build_array(jsonb_build_object('fileId','review-'||p_case,'modifiedAt','2026-10-19T20:00:00Z','size',1024)),
          repeat('a',64),jsonb_array_length(rows_value),1);
        perform public.append_master_snapshot_stage_chunk_v1(run_id,request_id,0,rows_value);
        response_value:=public.finalize_master_snapshot_stage_v1(run_id,request_id,repeat('a',64));
      else raise exception 'Unknown pipeline'; end if;
    exception when others then
      outcome:='rejected';error_state:=sqlstate;error_message:=sqlerrm;
    end;
    result_value:=jsonb_build_object('outcome',outcome,'errorMessage',error_message,
      -- The staged API intentionally translates non-retryable identity40001
      -- conflicts to55000; compare that documented normalization only.
      'errorState',case when error_state='40001' and
        (left(error_message,length('MASTER_ITEM6_'))='MASTER_ITEM6_' or left(error_message,length('MASTER_PRIORITY_HOLD_'))='MASTER_PRIORITY_HOLD_' or left(error_message,length('BULK_MASTER_IMPORT_'))='BULK_MASTER_IMPORT_')
        then '55000' else error_state end,
      'rows',(select coalesce(jsonb_agg(jsonb_build_object('unique_id',m.unique_id,'priority',m.priority,
        'holdstopcode',m.holdstopcode,'holdstopreason',m.holdstopreason,'locationnote',m.locationnote,
        'locationptn1',m.locationptn1,'desigitem',m.desigitem,'salesnote',m.salesnote) order by m.unique_id),'[]'::jsonb)
        from public.ph_master_inventory m where m.unique_id like 'v2313-review-'||p_case||'-%'),
      'baselines',(select coalesce(jsonb_agg(jsonb_build_object('uid',b.canonical_unique_id,'lineage',b.lineage_key,
        'priority',b.priority,'holdstopcode',b.holdstopcode,'holdstopreason',b.holdstopreason) order by b.canonical_unique_id),'[]'::jsonb)
        from app_sync_private.ph_master_inventory_source_baselines b where b.canonical_unique_id like 'v2313-review-'||p_case||'-%'),
      'item6',(select coalesce(jsonb_agg(jsonb_build_object('uid',b.canonical_unique_id,'stable',b.stable_identity_key,
        'fields',b.field_values) order by b.canonical_unique_id),'[]'::jsonb)
        from app_sync_private.ph_master_inventory_item6_source_v7 b where b.canonical_unique_id like 'v2313-review-'||p_case||'-%'));
    raise exception using errcode='ZC001',message='ROLLBACK_REVIEW_CANARY';
  exception when sqlstate 'ZC001' then null;
  end;
  return result_value;
end
$canary$;
create temporary table v2313_drive_review_outcomes(case_name text primary key,original jsonb,staged jsonb) on commit preserve rows;
insert into v2313_drive_review_outcomes(case_name,original,staged)
select c.case_name,pg_temp.v2313_drive_guard_case_v1('original',c.case_name),
  pg_temp.v2313_drive_guard_case_v1('staged',c.case_name)
from(values('duplicate_lineage'),('duplicate_stable'),('historical_alias'),('orphan_alias')) c(case_name);
select is(staged,original,'new-insert optimization preserves original '||case_name||' outcome, live fields and baselines')
from v2313_drive_review_outcomes order by case_name;
select ok(case case_name
  when 'duplicate_lineage' then staged->>'outcome'='rejected'
  when 'duplicate_stable' then staged->>'outcome'='published' and jsonb_array_length(staged->'rows')=2
  when 'historical_alias' then staged->>'outcome'='published' and jsonb_array_length(staged->'rows')=1
    and staged#>>'{rows,0,unique_id}'='v2313-review-historical_alias-canonical'
  when 'orphan_alias' then staged->>'outcome'='rejected' and staged->>'errorMessage'='MASTER_ITEM6_LINEAGE_CONFLICT'
  else false end,'explicit alias guard expectation for '||case_name)
from v2313_drive_review_outcomes order by case_name;

-- Optional ninth assertion: a forged pid/transaction GUC is reset by the
-- unconditional BEFORE INSERT statement trigger when no private proof exists.
-- Execute inside the same rollback harness if root wants it included.

-- Disposable-only reduced-context canaries: insert immediately BEFORE
-- `create temporary table v2313_source_rows(` in the current Drive fixture.
-- Add13 to plan(61) => plan(74), unless other added assertions change the base.
-- Every live-data/lease/trigger mutation is rolled back by each helper call.
-- No DB calls/tests were run while preparing this ignored file.
create temporary table v2313_context_probe_control(
  race_enabled boolean not null, raced boolean not null default false,
  observed boolean not null default false, run_id uuid not null, request_id uuid not null,
  race_uid text not null, context_count integer, proven_count integer,
  witness_valid boolean, fallback_context jsonb
) on commit preserve rows;
-- The production finalizer is owned by postgres; this disposable probe records its context.
grant select,update on v2313_context_probe_control to postgres;

create or replace function pg_temp.v2313_context_statement_probe()
returns trigger language plpgsql as $probe$
declare ctl record; old_headers text; old_marker text;
begin
  select * into ctl from pg_temp.v2313_context_probe_control;
  if not found then return null; end if;
  if exists(select 1 from app_sync_private.ph_master_new_insert_statement_v1 p
    where p.backend_pid=pg_backend_pid() and p.transaction_id=txid_current())
    and pg_trigger_depth()=1 then
    if not ctl.observed then
      update pg_temp.v2313_context_probe_control set observed=true,
        context_count=(select count(*)::integer from app_sync_private.ph_master_bulk_import_context_v1 c
          where c.run_id=ctl.run_id and c.request_id=ctl.request_id
            and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()),
        proven_count=(select count(*)::integer from pg_temp.ph_master_proven_new_ids_v1),
        witness_valid=exists(select 1 from app_sync_private.ph_master_bulk_import_context_v1 c
          join pg_temp.ph_master_bulk_stage_v1 s on s.unique_id=c.source_unique_id
          where c.run_id=ctl.run_id and c.request_id=ctl.request_id
            and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
            and c.raw_values=s.raw_values and c.raw_item6_fields=s.raw_item6_fields and c.source_hash=s.source_hash);
    end if;
    if ctl.race_enabled and not ctl.raced then
      -- Simulate another writer arriving after classification. This UID is
      -- deliberately not the retained (lexicographically first) witness.
      update pg_temp.v2313_context_probe_control set raced=true;
      old_headers:=current_setting('request.headers',true);
      old_marker:=current_setting('gnc.master_snapshot_verified_insert',true);
      perform set_config('request.headers','{}',true);
      perform set_config('gnc.master_snapshot_verified_insert','',true);
      insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,
        lotcode,source,warehouseid,priority,holdstopcode,holdstopreason,locationnote)
      values(ctl.race_uid,'CTX-race-3','Context source row 3','#1','Z.98.003',
        '27.CANARY','PH','10','7','APP-H','App hold reason','App location note');
      perform set_config('request.headers',coalesce(old_headers,''),true);
      -- This restores the proof-validated OUTER statement marker only. The
      -- nested statement has already run the normal guards and crop mapper.
      perform set_config('gnc.master_snapshot_verified_insert',coalesce(old_marker,''),true);
    end if;
  end if;
  return null;
end
$probe$;

create or replace function pg_temp.v2313_context_row_probe()
returns trigger language plpgsql as $probe$
declare ctl record;
begin
  select * into ctl from pg_temp.v2313_context_probe_control;
  if found and tg_op='UPDATE' and new.unique_id=ctl.race_uid then
    update pg_temp.v2313_context_probe_control set fallback_context=(
      select jsonb_build_object('values',c.raw_values,'rawFields',to_jsonb(c.raw_item6_fields),'hash',c.source_hash)
      from app_sync_private.ph_master_bulk_import_context_v1 c
      where c.run_id=ctl.run_id and c.request_id=ctl.request_id
        and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
        and c.source_unique_id=ctl.race_uid);
  end if;
  return null;
end
$probe$;

create or replace function pg_temp.v2313_reduced_context_case(p_case text)
returns jsonb language plpgsql as $canary$
declare
  v_run uuid:=gen_random_uuid(); v_req uuid:=gen_random_uuid(); v_req2 uuid:=gen_random_uuid();
  v_rows jsonb; v_values jsonb; v_receipt jsonb; v_unchanged jsonb; result_value jsonb;
  v_prefix text:='v2313-context-'||p_case||'-';
  v_fields jsonb:='["desigcust","desigitem","desigloc","locationnote","locationptn1","oversellpercentage","pullerresponsibility","salesnote","suspend"]';
  forged_uid text:='v2313-context-forged'; inserted_crop boolean; updated_crop boolean; deleted_crop boolean;
begin
  begin
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    perform set_config('request.jwt.claim.role','service_role',true);
    perform set_config('request.headers','{}',true);
    if p_case='forged' then
      perform set_config('gnc.master_snapshot_verified_insert',pg_backend_pid()::text||':'||txid_current()::text,true);
      insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,warehouseid)
      values(forged_uid,'FORGED-CROP','Original forged marker row','#1','Z.98.010','27.CANARY','PH','10');
      inserted_crop:=current_setting('gnc.master_snapshot_verified_insert',true)=''
        and exists(select 1 from public.ph_crop_roll_drive_rows where master_unique_id=forged_uid and commonname='Original forged marker row');
      perform set_config('gnc.master_snapshot_verified_insert',pg_backend_pid()::text||':'||txid_current()::text,true);
      update public.ph_master_inventory set commonname='Updated forged marker row' where unique_id=forged_uid;
      updated_crop:=exists(select 1 from public.ph_crop_roll_drive_rows where master_unique_id=forged_uid and commonname='Updated forged marker row');
      perform set_config('gnc.master_snapshot_verified_insert',pg_backend_pid()::text||':'||txid_current()::text,true);
      delete from public.ph_master_inventory where unique_id=forged_uid;
      deleted_crop:=not exists(select 1 from public.ph_crop_roll_drive_rows where master_unique_id=forged_uid);
      result_value:=jsonb_build_object('insert',inserted_crop,'update',updated_crop,'delete',deleted_crop);
    else
      select jsonb_agg(jsonb_build_object('values',jsonb_build_object(
        'unique_id',v_prefix||g.n,'itemcode','CTX-'||p_case||'-'||g.n,
        'commonname','Context source row '||g.n,'contsize','#1','locationcode','Z.98.00'||g.n,
        'lotcode','27.CANARY','source','PH','warehouseid','10','priority','2',
        'holdstopcode','SOURCE-H','holdstopreason','Source hold reason','locationnote','Source location note',
        'desigitem','A','desigcust',null,'desigloc',null,'locationptn1','Source pattern',
        'oversellpercentage',null,'pullerresponsibility',null,'salesnote','Source note','suspend',null,
        'last_updated','2026-10-19T20:00:00Z','filename','context-canary.xlsx','concat','context-source'),
        'rawFields',v_fields) order by g.n) into v_rows from generate_series(1,3) g(n);
      insert into pg_temp.v2313_context_probe_control(race_enabled,run_id,request_id,race_uid)
      values(p_case='race',v_run,v_req,v_prefix||'3');
      execute 'create trigger aa001_v2313_context_statement_probe before insert on public.ph_master_inventory for each statement execute function pg_temp.v2313_context_statement_probe()';
      execute 'create trigger zz_v2313_context_row_probe after update on public.ph_master_inventory for each row execute function pg_temp.v2313_context_row_probe()';
      perform public.begin_dataset_import_v1(array['ph_master_inventory'],v_run,array['ph_master_inventory']);
      perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',v_run::text)::text,true);
      perform public.begin_master_snapshot_stage_v1(v_run,v_req,
        jsonb_build_array(jsonb_build_object('fileId','context-'||p_case,'modifiedAt','2026-10-19T20:00:00Z','size',1024)),repeat('e',64),3,1);
      perform public.append_master_snapshot_stage_chunk_v1(v_run,v_req,0,v_rows);
      v_receipt:=public.finalize_master_snapshot_stage_v1(v_run,v_req,repeat('e',64));
      v_values:=v_rows#>'{2,values}';
      result_value:=jsonb_build_object(
        'contextCount',(select context_count from pg_temp.v2313_context_probe_control),
        'provenCount',(select proven_count from pg_temp.v2313_context_probe_control),
        'witnessValid',(select witness_valid from pg_temp.v2313_context_probe_control),
        'fallbackExact',(select fallback_context=jsonb_build_object('values',v_values,'rawFields',v_fields,
          'hash',private.ph_master_bulk_source_hash_v1(v_values,array(select jsonb_array_elements_text(v_fields)))) from pg_temp.v2313_context_probe_control),
        'protected',(select holdstopcode='APP-H' and holdstopreason='App hold reason' and locationnote='App location note'
          from public.ph_master_inventory where unique_id=v_prefix||'3'),
        'baselineExact',(select count(*)=3 and bool_and(b.source_unique_id=s.row_value#>>'{values,unique_id}'
          and b.source_hash=private.ph_master_bulk_source_hash_v1(s.row_value->'values',array(select jsonb_array_elements_text(v_fields))))
          from jsonb_array_elements(v_rows) s(row_value) join app_sync_private.ph_master_bulk_import_source_v1 b
            on b.canonical_unique_id=s.row_value#>>'{values,unique_id}'),
        'contextClean',not exists(select 1 from app_sync_private.ph_master_bulk_import_context_v1 where run_id=v_run),
        'receipt',v_receipt);
      if p_case='new' then
        perform public.begin_master_snapshot_stage_v1(v_run,v_req2,
          jsonb_build_array(jsonb_build_object('fileId','context-'||p_case,'modifiedAt','2026-10-19T20:00:00Z','size',1024)),repeat('f',64),3,1);
        perform public.append_master_snapshot_stage_chunk_v1(v_run,v_req2,0,v_rows);
        v_unchanged:=public.finalize_master_snapshot_stage_v1(v_run,v_req2,repeat('f',64));
        result_value:=result_value||jsonb_build_object('unchanged',v_unchanged);
      end if;
    end if;
    raise exception using errcode='ZC002',message='ROLLBACK_REDUCED_CONTEXT_CANARY';
  exception when sqlstate 'ZC002' then null;
  end;
  return result_value;
end
$canary$;
create temporary table v2313_reduced_context_outcomes(case_name text primary key,result jsonb) on commit preserve rows;
insert into v2313_reduced_context_outcomes select c,pg_temp.v2313_reduced_context_case(c) from unnest(array['new','race','forged']) c;
select ok((result->>'contextCount')::integer=1 and (result->>'provenCount')::integer=3 and (result->>'witnessValid')::boolean,
  'all-new snapshot keeps exactly one real transaction-bound context witness') from v2313_reduced_context_outcomes where case_name='new';
select ok((result->>'baselineExact')::boolean,'every fast insert publishes its exact source hash and source UID') from v2313_reduced_context_outcomes where case_name='new';
select ok((result->>'contextClean')::boolean,'successful fast-new publication cleans its retained context witness') from v2313_reduced_context_outcomes where case_name='new';
select ok((result#>>'{unchanged,updated}')::integer=0 and (result#>>'{unchanged,unchanged}')::integer=3,
  'an immediate unchanged snapshot updates zero fast-new rows') from v2313_reduced_context_outcomes where case_name='new';
select ok((result->>'contextCount')::integer=1 and (result->>'provenCount')::integer=3,
  'race arrival happens after three candidates are proven with only one context witness') from v2313_reduced_context_outcomes where case_name='race';
select ok((result->>'fallbackExact')::boolean,'race fallback restores exact raw values, field mask and source hash before guarded UPDATE') from v2313_reduced_context_outcomes where case_name='race';
select ok((result->>'protected')::boolean,'race fallback preserves the competing app hold and location note') from v2313_reduced_context_outcomes where case_name='race';
select ok((result->>'baselineExact')::boolean,'race fallback and fast successes all publish exact source baselines') from v2313_reduced_context_outcomes where case_name='race';
select ok((result#>>'{receipt,inserted}')::integer=2 and (result#>>'{receipt,updated}')::integer=1,
  'race receipt counts two fast inserts and one guarded UPDATE') from v2313_reduced_context_outcomes where case_name='race';
select ok((result->>'contextClean')::boolean,'race fallback context is cleaned after atomic publication') from v2313_reduced_context_outcomes where case_name='race';
select ok((result->>'insert')::boolean,'forged GUC is cleared and ordinary INSERT still publishes crop data') from v2313_reduced_context_outcomes where case_name='forged';
select ok((result->>'update')::boolean,'forged GUC cannot suppress ordinary UPDATE crop synchronization') from v2313_reduced_context_outcomes where case_name='forged';
select ok((result->>'delete')::boolean,'forged GUC cannot suppress ordinary DELETE crop synchronization') from v2313_reduced_context_outcomes where case_name='forged';

-- Disposable-only: insert immediately BEFORE `create temporary table
-- v2313_source_rows(`, after the reduced-context canaries if present. Adds3 TAP
-- assertions (plan74 ->77 if the preceding13 are integrated). No DB/tests run.
create or replace function pg_temp.v2313_genuine_split_case(p_case text)
returns jsonb language plpgsql as $canary$
declare
 v_run uuid:=gen_random_uuid();v_req uuid:=gen_random_uuid();v_prefix text:='v2313-split-'||p_case||'-';
 v_rows jsonb;v_fields jsonb:='["desigcust","desigitem","desigloc","locationnote","locationptn1","oversellpercentage","pullerresponsibility","salesnote","suspend"]';
 v_values jsonb;v_uid text;v_stable text;v_response jsonb;v_before jsonb;v_after jsonb;
 v_result jsonb;v_error text;v_state text;v_legacy_error text;v_label text;
begin
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.headers','{}',true);
  perform set_config('gnc.master_snapshot_verified_insert','',true);
  perform set_config('gnc.master_bulk_crop_roll_deferred','',true);
  v_rows:='[]'::jsonb;
  foreach v_label in array array['a','b','new'] loop
   v_uid:=v_prefix||v_label;
   v_values:=jsonb_build_object('unique_id',v_uid,'warehouseid','10','itemcode','SPLIT-'||p_case,
    'commonname','Genuine split canary','contsize','#1','locationcode','Z.96.001','lotcode','27.CANARY','source','LD',
    'desigcust',case v_label when 'a' then 'ABRN' when 'b' then 'CHRS' else null end,
    'desigitem',null,'desigloc',null,'priority','2','holdstopcode','SOURCE-H','holdstopreason','Source reason',
    'locationnote','Source note','locationptn1',null,'oversellpercentage',null,'pullerresponsibility',null,
    'salesnote',null,'suspend',null,'last_updated','2026-10-19T20:00:00Z','filename','split-canary.xlsx','concat','split-source');
   v_stable:=private.ph_master_inventory_stable_identity_v7(v_values);
   if v_label<>'new' then
    insert into public.ph_master_inventory(unique_id,warehouseid,itemcode,commonname,contsize,locationcode,lotcode,source,
     desigcust,priority,holdstopcode,holdstopreason,locationnote,photo_link,photo_name,assignedto)
    values(v_uid,'10','SPLIT-'||p_case,'Genuine split canary','#1','Z.96.001','27.CANARY','LD',
     case v_label when 'a' then 'ABRN' else 'CHRS' end,'1','APP-'||v_label,'App reason '||v_label,
     'App note '||v_label,'https://example.invalid/'||v_label||'.jpg','photo-'||v_label,'dylan_collyge');
    insert into app_sync_private.ph_master_inventory_source_baselines(canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason)
    values(v_uid,private.ph_master_inventory_lineage_key_v1(v_values),'1','SOURCE-H','Source reason')
    on conflict(canonical_unique_id) do update set lineage_key=excluded.lineage_key;
    insert into app_sync_private.ph_master_inventory_item6_source_v7(canonical_unique_id,stable_identity_key,field_values)
    select v_uid,v_stable,jsonb_object_agg(field_name,v_values->field_name) from jsonb_array_elements_text(v_fields) as fields(field_name)
    on conflict(canonical_unique_id) do update set stable_identity_key=excluded.stable_identity_key,field_values=excluded.field_values;
   end if;
   if not(p_case='omitted' and v_label='b') then
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('values',v_values,'rawFields',v_fields));
   end if;
  end loop;
  if p_case='pending' then
   insert into app_sync_private.ph_master_inventory_item6_edits_v7(canonical_unique_id,field_name,stable_identity_key,source_value,app_value,pending)
   values(v_prefix||'a','desigcust',v_stable,'ABRN','APP-ABRN',true);
   update public.ph_master_inventory set desigcust='APP-ABRN' where unique_id=v_prefix||'a';
  end if;
  select jsonb_agg(to_jsonb(m) order by m.unique_id) into v_before
   from public.ph_master_inventory m where m.unique_id in(v_prefix||'a',v_prefix||'b');
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],v_run,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',v_run::text)::text,true);
  if p_case='retained' then
   -- Diagnostic only: old rejection is the reported operational failure. The
   -- accepted new split intentionally differs from that legacy behavior.
   begin
    perform public.bulk_import_master_snapshot_v1(v_run,gen_random_uuid(),v_rows,repeat('c',64));
    v_legacy_error:='UNEXPECTED_LEGACY_ACCEPT';
   exception when others then v_legacy_error:=sqlerrm; end;
  end if;
  perform public.begin_master_snapshot_stage_v1(v_run,v_req,
   jsonb_build_array(jsonb_build_object('fileId','split-'||p_case,'modifiedAt','2026-10-19T20:00:00Z','size',1024)),
   repeat('d',64),jsonb_array_length(v_rows),1);
  perform public.append_master_snapshot_stage_chunk_v1(v_run,v_req,0,v_rows);
  begin
   v_response:=public.finalize_master_snapshot_stage_v1(v_run,v_req,repeat('d',64));
  exception when others then v_state:=sqlstate;v_error:=sqlerrm;end;
  select jsonb_agg(to_jsonb(m) order by m.unique_id) into v_after
   from public.ph_master_inventory m where m.unique_id in(v_prefix||'a',v_prefix||'b');
  v_result:=jsonb_build_object('state',v_state,'error',v_error,'legacyError',v_legacy_error,'response',v_response,
   'liveRows',(select count(*) from public.ph_master_inventory where unique_id like v_prefix||'%'),
   'newPresent',exists(select 1 from public.ph_master_inventory where unique_id=v_prefix||'new'),
   'atomicUnchanged',v_before=v_after,
   'appPreserved',(select count(*)=2 and bool_and(m.holdstopcode='APP-'||right(m.unique_id,1)
    and m.holdstopreason='App reason '||right(m.unique_id,1) and m.locationnote='App note '||right(m.unique_id,1)
    and m.photo_link='https://example.invalid/'||right(m.unique_id,1)||'.jpg'
    and m.photo_name='photo-'||right(m.unique_id,1) and m.assignedto='dylan_collyge')
    from public.ph_master_inventory m where m.unique_id in(v_prefix||'a',v_prefix||'b')));
  raise exception using errcode='ZC003',message='ROLLBACK_GENUINE_SPLIT_CANARY';
 exception when sqlstate 'ZC003' then null;end;
 return v_result;
end
$canary$;
create temporary table v2313_genuine_split_outcomes(case_name text primary key,result jsonb) on commit preserve rows;
insert into v2313_genuine_split_outcomes select c,pg_temp.v2313_genuine_split_case(c) from unnest(array['retained','omitted','pending']) c;
select ok(result->>'error' is null and (result->>'liveRows')::integer=3 and (result->>'newPresent')::boolean
 and (result->>'appPreserved')::boolean and (result#>>'{response,inserted}')::integer=1,
 'intentional third split publishes three identities and preserves both retained siblings app fields')
 from v2313_genuine_split_outcomes where case_name='retained';
select ok(result->>'state'='55000' and result->>'error'='MASTER_ITEM6_LINEAGE_AMBIGUOUS'
 and (result->>'atomicUnchanged')::boolean and not(result->>'newPresent')::boolean,
 'new split with an omitted stable sibling retains original rejection and atomic rollback')
 from v2313_genuine_split_outcomes where case_name='omitted';
select ok(result->>'state'='55000' and result->>'error'='BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS'
 and (result->>'atomicUnchanged')::boolean and not(result->>'newPresent')::boolean,
 'new split with a pending designation retains original rejection and protected app state')
 from v2313_genuine_split_outcomes where case_name='pending';
-- Inspect legacyError for case retained as diagnostic evidence only.

create temporary table v2313_source_rows(row_number integer primary key, payload jsonb not null) on commit preserve rows;
create temporary table v2313_import_keys(key text primary key) on commit preserve rows;
insert into v2313_import_keys select unnest(array['warehouseid','plantgroupcode','itemcode','qualitycode','contsize','commonname','lotcode','locationcode','source','desigitem','desigcust','desigloc','priority','ptronhand','ptrreviewed','ptravailable','holdstopcode','holdstopbegindate','holdstopreason','hsreasonbegin','season_supply','season_oh','season_demand','s_lts','oversellpercentage','itemspec','locationnote','locationnotedate','suspend','suspend_to','specialpuller','pulltagnote1','pulltagnote2','fieldtagcolor','salesnote','inventorynote','locationptn1','locationptn2','prisetby','priupdated','bypassloc','largeptrqty','maxorderquantity','lochold','listprice','ext_ptronhand','varietycode','genusname','botanicalname','reversecommon','sortnamevariety','containersort','saleyear','season','blockalpha','blocknumber','bay','pullerresponsibility','grower','si_lts','a_lts','ai_lts','season_available','holdstopenddate','fnsalesnote','warehousename','mcstatus','hz','intercopo','insurancegroup','brand','printedcontainercode','salesnotebegindate','equiv_unit','unique_id','last_updated','filename','concat']::text[]);
with source_shape as (
  select g.n as row_number,jsonb_object_agg(c.column_name,
    case
      when c.column_name='unique_id' then to_jsonb('v2313-'||lpad(g.n::text,5,'0'))
      when c.column_name='itemcode' then to_jsonb('V2313-'||lpad((1+((g.n-1)%3206))::text,5,'0'))
      when c.column_name='commonname' then to_jsonb('Representative imported inventory row '||g.n::text)
      when c.column_name='contsize' then to_jsonb('#1'::text)
      when c.column_name='locationcode' then to_jsonb('C.'||lpad((1+((g.n-1)%638))::text,3,'0')||'.001')
      when c.column_name='lotcode' then to_jsonb('27.'||case 1+((g.n-1)%38)
        when 1 then 'S1' when 2 then 'F1' when 3 then 'Z' when 4 then 'U1' when 5 then 'U2'
        when 6 then 'Y' when 7 then 'U3' else 'S'||(1+((g.n-1)%38))::text end)
      when c.column_name='source' then to_jsonb('PH'::text)
      when c.column_name='warehouseid' then to_jsonb('10'::text)
      when c.column_name='priority' then to_jsonb('2'::text)
      when c.column_name='holdstopcode' and g.n=1 then to_jsonb('SOURCE-HOLD'::text)
      when c.column_name='holdstopreason' and g.n=1 then to_jsonb('Source hold reason'::text)
      when c.column_name='locationnote' and g.n=1 then to_jsonb('Source location note'::text)
      when c.data_type in ('text','character varying','character','varchar','char') then to_jsonb(repeat('x',32))
      when c.data_type in ('smallint','integer','bigint','numeric','decimal','real','double precision') then to_jsonb(1)
      when c.data_type='boolean' then 'false'::jsonb
      when c.data_type='date' then to_jsonb('2026-10-19'::text)
      when c.data_type like 'timestamp%' then to_jsonb('2026-10-19T12:00:00Z'::text)
      when c.data_type in ('json','jsonb') then '{}'::jsonb
      when c.data_type='ARRAY' then '[]'::jsonb
      else null
    end) as values
  from generate_series(1,9504) g(n)
  cross join information_schema.columns c
  where c.table_schema='public' and c.table_name='ph_master_inventory'
    and c.is_generated='NEVER' and c.is_identity='NO'
    and c.column_name in (select key from v2313_import_keys)
    and (c.data_type in ('text','character varying','character','varchar','char',
      'smallint','integer','bigint','numeric','decimal','real','double precision','boolean','date',
      'json','jsonb','ARRAY') or c.data_type like 'timestamp%')
  group by g.n
)
insert into v2313_source_rows(row_number,payload)
select source_shape.row_number,jsonb_build_object('values',source_shape.values||jsonb_build_object('ext_equiv_unit','raw-source-unmapped'),
  'rawFields',coalesce((select jsonb_agg(k.key order by k.key)
    from jsonb_object_keys(source_shape.values) k(key)
    where k.key=any(array['locationnote','locationptn1','desigitem','desigcust','desigloc',
      'pullerresponsibility','oversellpercentage','salesnote','suspend'])), '[]'::jsonb))
from source_shape;

insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,warehousei,priority,
  holdstopcode,holdstopreason,locationnote
) values (
  'v2313-00001','V2313-00001','Existing protected-field fixture','#1','C.001.001','27.S1','PH','10','2',
  'LIVE-H','Live hold reason','Live location note'
) ;
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,warehousei,priority
) values (
  'v2313-sentinel','V2313-SENTINEL','Must remain until complete snapshot','#1','C.99.001','27.S1','PH','10','2'
);
create temporary table v2313_target_only_before on commit preserve rows as
select to_jsonb(master) - (select array_agg(key) from v2313_import_keys) as fields
from public.ph_master_inventory master where unique_id='v2313-00001';
create temporary table v2313_rpc_metrics(
  scenario text not null, operation text not null, item_index integer not null, elapsed_ms numeric not null
) on commit preserve rows;
create temporary table v2313_responses(scenario text primary key,response jsonb not null) on commit preserve rows;
create temporary table v2313_evidence(key text primary key,value jsonb not null) on commit preserve rows;
create temporary table v2313_ambiguous_before on commit preserve rows as
select unique_id,to_jsonb(master) as row_value
from public.ph_master_inventory master where false;

do $test$
declare
  manifest_value jsonb := jsonb_build_array(jsonb_build_object(
    'fileId','synthetic-drive-master-v2313','modifiedAt','2026-10-19T12:00:00Z','size',15000000));
  run_id uuid;
  request_id uuid;
  digest_value text;
  begin_value jsonb;
  chunk_value jsonb;
  response_value jsonb;
  started_at timestamptz;
  elapsed numeric;
  scenario_value text;
  run_values uuid[] := array[
    'b3100000-0000-4000-8000-000000000001'::uuid,
    'b3100000-0000-4000-8000-000000000002'::uuid,
    'b3100000-0000-4000-8000-000000000003'::uuid,
    'b3100000-0000-4000-8000-000000000004'::uuid,
    'b3100000-0000-4000-8000-000000000005'::uuid,
    'b3100000-0000-4000-8000-000000000006'::uuid
  ];
  request_values uuid[] := array[
    'b3200000-0000-4000-8000-000000000001'::uuid,
    'b3200000-0000-4000-8000-000000000002'::uuid,
    'b3200000-0000-4000-8000-000000000003'::uuid,
    'b3200000-0000-4000-8000-000000000004'::uuid
  ];
  plan_stage jsonb;
  plan_target jsonb;
  rows_value jsonb;
  chunk_index integer;
  target_row_count integer;
  columns_per_row integer;
  bytes_per_row integer;
  source_bytes bigint;
  final_new jsonb;
  final_unchanged jsonb;
  final_changed jsonb;
  replay_response jsonb;
  performance_value jsonb;
  reconcile_value jsonb;
  reconcile_index integer;
begin
  if (select count(*) from v2313_source_rows) <> 9504 then
    raise exception 'V2313_FIXTURE_ROW_COUNT_INVALID';
  end if;
  select count(*) into columns_per_row from jsonb_object_keys((select payload->'values' from v2313_source_rows where row_number=1));
  select octet_length(payload::text) into bytes_per_row from v2313_source_rows where row_number=1;
  select sum(octet_length(payload::text)) into source_bytes from v2313_source_rows;

  -- Begin a partial request, close its first run, then prove the exact manifest
  -- can be rebound under a new active dataset fence without losing chunk zero.
  run_id := run_values[1]; request_id := request_values[1]; digest_value := repeat('a',64);
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  commit;
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,false);
  started_at := clock_timestamp();
  begin_value := public.begin_master_snapshot_stage_v1(run_id,request_id,manifest_value,digest_value,9504,20);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('new','begin',0,elapsed);
  commit;
  select jsonb_agg(payload order by row_number) into chunk_value from v2313_source_rows where row_number between 1 and 500;
  begin
    perform public.append_master_snapshot_stage_chunk_v1(run_id,request_id,0,
      jsonb_set(chunk_value,'{0,values,photo_link}',to_jsonb('must-not-import'::text)));
    insert into v2313_evidence values('app_field_rejected','false'::jsonb);
  exception when others then
    insert into v2313_evidence values('app_field_rejected',
      to_jsonb(sqlerrm = 'BULK_MASTER_IMPORT_COLUMN_INVALID'));
  end;
  begin
    perform public.append_master_snapshot_stage_chunk_v1(run_id,request_id,0,jsonb_set(chunk_value,'{0,values,stable_identity_key}',to_jsonb('forged'::text)));
    insert into v2313_evidence values('cache_input_rejected','false'::jsonb);
  exception when others then
    insert into v2313_evidence values('cache_input_rejected',to_jsonb(sqlerrm='BULK_MASTER_IMPORT_COLUMN_INVALID'));
  end;
  started_at := clock_timestamp();
  response_value := public.append_master_snapshot_stage_chunk_v1(run_id,request_id,0,chunk_value);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('new','append',0,elapsed);
  commit;
  insert into v2313_evidence values('cache_parity',(select to_jsonb(count(*)=500 and bool_and(stable_identity_key IS NOT DISTINCT FROM private.ph_master_inventory_stable_identity_v7(raw_values))) from app_sync_private.ph_master_snapshot_stage_rows_v1 st where st.request_id=request_values[1]));
  insert into v2313_evidence values('raw_only_source_preserved',
    (select to_jsonb(raw_values->>'ext_equiv_unit'='raw-source-unmapped'
      and not ('ext_equiv_unit'=any(field_keys)))
    from app_sync_private.ph_master_snapshot_stage_rows_v1 st where st.request_id=request_values[1] and row_number=1));
  insert into v2313_evidence values('partial_snapshot_atomic',jsonb_build_object(
    'sentinel_present',exists(select 1 from public.ph_master_inventory where unique_id='v2313-sentinel'),
    'seeded_name', (select commonname from public.ph_master_inventory where unique_id='v2313-00001'),
    'live_rows', (select count(*) from public.ph_master_inventory where unique_id like 'v2313-%')
  ));
  commit;
  raise notice 'V2313_PROGRESS_JSON=%', jsonb_build_object('scenario','partial',
    'rpc_metrics',(select jsonb_agg(jsonb_build_object('operation',operation,'item_index',item_index,'elapsed_ms',elapsed_ms)
      order by operation,item_index) from v2313_rpc_metrics where scenario in ('new')));
  started_at := clock_timestamp();
  perform public.fail_dataset_import_v1(run_id);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('partial','fail',0,elapsed);
  commit;

  run_id := run_values[2];
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  commit;
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,false);
  started_at := clock_timestamp();
  begin_value := public.begin_master_snapshot_stage_v1(run_id,request_id,manifest_value,digest_value,9504,20);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('new','begin-rebind',0,elapsed);
  commit;
  perform set_config('v2313.rebind',begin_value->>'rebound',false);
  perform set_config('v2313.missing',jsonb_array_length(begin_value->'missingChunkIndexes')::text,false);
  select jsonb_agg(payload order by row_number) into chunk_value from v2313_source_rows where row_number between 1 and 500;
  started_at := clock_timestamp();
  response_value := public.append_master_snapshot_stage_chunk_v1(run_id,request_id,0,chunk_value);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('new','append-retry',0,elapsed);
  commit;
  if response_value->>'replayed' <> 'true' then raise exception 'V2313_CHUNK_REPLAY_NOT_IDEMPOTENT'; end if;
  for chunk_index in 1..19 loop
    select jsonb_agg(payload order by row_number) into chunk_value
      from v2313_source_rows where row_number between chunk_index*500+1 and least((chunk_index+1)*500,9504);
    started_at := clock_timestamp();
    response_value := public.append_master_snapshot_stage_chunk_v1(run_id,request_id,chunk_index,chunk_value);
    elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
    insert into v2313_rpc_metrics values('new','append',chunk_index,elapsed);
    commit;
  end loop;
  execute format('explain (analyze,buffers,format json) select row_number from app_sync_private.ph_master_snapshot_stage_rows_v1 where request_id=%L and unique_id=%L',request_id,'v2313-00001')
    into plan_stage;
  started_at := clock_timestamp();
  final_new := public.finalize_master_snapshot_stage_v1(run_id,request_id,digest_value);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('new','finalize',0,elapsed);
  insert into v2313_responses values('new',final_new);
  insert into v2313_evidence values('target_only_preserved',
    (select to_jsonb((to_jsonb(master)-(select array_agg(key) from v2313_import_keys))=before.fields)
      from public.ph_master_inventory master cross join v2313_target_only_before before
      where master.unique_id='v2313-00001'));
  commit;
  started_at := clock_timestamp();
  replay_response := public.finalize_master_snapshot_stage_v1(run_id,request_id,digest_value);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('retry','finalize',0,elapsed);
  insert into v2313_responses values('retry',replay_response);
  commit;
  raise notice 'V2313_PROGRESS_JSON=%', jsonb_build_object('scenario','new',
    'rpc_metrics',(select jsonb_agg(jsonb_build_object('operation',operation,'item_index',item_index,'elapsed_ms',elapsed_ms)
      order by operation,item_index) from v2313_rpc_metrics where scenario in ('new','retry')));
  reconcile_index := 0;
  loop
    started_at := clock_timestamp();
    reconcile_value := public.reconcile_inventory_row_assignments_batch_v1(run_id,100);
    elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
    insert into v2313_rpc_metrics values('new','reconcile',reconcile_index,elapsed);
    commit;
    reconcile_index := reconcile_index + 1;
    if reconcile_value->>'status'='completed' then exit; end if;
    if reconcile_index > 200 then raise exception 'V2313_NEW_RECONCILE_DID_NOT_FINISH'; end if;
  end loop;
  started_at := clock_timestamp();
  perform public.finish_dataset_import_v1(run_id);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('new','finish',0,elapsed);
  commit;

  -- Same authoritative snapshot is unchanged; only a new request UUID is used.
  run_id := run_values[3]; request_id := request_values[2]; digest_value := repeat('b',64);
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  commit;
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,false);
  started_at := clock_timestamp();
  perform public.begin_master_snapshot_stage_v1(run_id,request_id,manifest_value,digest_value,9504,20);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('unchanged','begin',0,elapsed);
  commit;
  for chunk_index in 0..19 loop
    select jsonb_agg(payload order by row_number) into chunk_value
      from v2313_source_rows where row_number between chunk_index*500+1 and least((chunk_index+1)*500,9504);
    started_at := clock_timestamp();
    perform public.append_master_snapshot_stage_chunk_v1(run_id,request_id,chunk_index,chunk_value);
    elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
    insert into v2313_rpc_metrics values('unchanged','append',chunk_index,elapsed);
    commit;
  end loop;
  started_at := clock_timestamp();
  final_unchanged := public.finalize_master_snapshot_stage_v1(run_id,request_id,digest_value);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('unchanged','finalize',0,elapsed);
  insert into v2313_responses values('unchanged',final_unchanged);
  commit;
  raise notice 'V2313_PROGRESS_JSON=%', jsonb_build_object('scenario','unchanged',
    'rpc_metrics',(select jsonb_agg(jsonb_build_object('operation',operation,'item_index',item_index,'elapsed_ms',elapsed_ms)
      order by operation,item_index) from v2313_rpc_metrics where scenario='unchanged'));
  reconcile_index := 0;
  loop
    started_at := clock_timestamp();
    reconcile_value := public.reconcile_inventory_row_assignments_batch_v1(run_id,100);
    elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
    insert into v2313_rpc_metrics values('unchanged','reconcile',reconcile_index,elapsed);
    commit;
    reconcile_index := reconcile_index + 1;
    if reconcile_value->>'status'='completed' then exit; end if;
    if reconcile_index > 200 then raise exception 'V2313_UNCHANGED_RECONCILE_DID_NOT_FINISH'; end if;
  end loop;
  started_at := clock_timestamp();
  perform public.finish_dataset_import_v1(run_id);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('unchanged','finish',0,elapsed);
  commit;

  -- One changed source value must update exactly one target row.
  run_id := run_values[4]; request_id := request_values[3]; digest_value := repeat('c',64);
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  commit;
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,false);
  started_at := clock_timestamp();
  perform public.begin_master_snapshot_stage_v1(run_id,request_id,manifest_value,digest_value,9504,20);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('changed','begin',0,elapsed);
  commit;
  for chunk_index in 0..19 loop
    select jsonb_agg(case when row_number=1 then jsonb_set(payload,'{values,commonname}',to_jsonb('Changed representative row'::text)) else payload end order by row_number)
      into chunk_value from v2313_source_rows where row_number between chunk_index*500+1 and least((chunk_index+1)*500,9504);
    started_at := clock_timestamp();
    perform public.append_master_snapshot_stage_chunk_v1(run_id,request_id,chunk_index,chunk_value);
    elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
    insert into v2313_rpc_metrics values('changed','append',chunk_index,elapsed);
    commit;
  end loop;
  started_at := clock_timestamp();
  final_changed := public.finalize_master_snapshot_stage_v1(run_id,request_id,digest_value);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('changed','finalize',0,elapsed);
  insert into v2313_responses values('changed',final_changed);
  commit;
  raise notice 'V2313_PROGRESS_JSON=%', jsonb_build_object('scenario','changed',
    'rpc_metrics',(select jsonb_agg(jsonb_build_object('operation',operation,'item_index',item_index,'elapsed_ms',elapsed_ms)
      order by operation,item_index) from v2313_rpc_metrics where scenario='changed'));
  reconcile_index := 0;
  loop
    started_at := clock_timestamp();
    reconcile_value := public.reconcile_inventory_row_assignments_batch_v1(run_id,100);
    elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
    insert into v2313_rpc_metrics values('changed','reconcile',reconcile_index,elapsed);
    commit;
    reconcile_index := reconcile_index + 1;
    if reconcile_value->>'status'='completed' then exit; end if;
    if reconcile_index > 200 then raise exception 'V2313_CHANGED_RECONCILE_DID_NOT_FINISH'; end if;
  end loop;
  started_at := clock_timestamp();
  perform public.finish_dataset_import_v1(run_id);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('changed','finish',0,elapsed);
  commit;

  -- A later current fence may safely acknowledge an already-published receipt.
  run_id := run_values[5];
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  commit;
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,false);
  started_at := clock_timestamp();
  perform public.begin_master_snapshot_stage_v1(run_id,request_values[3],manifest_value,repeat('c',64),9504,20);
  replay_response := public.finalize_master_snapshot_stage_v1(run_id,request_values[3],repeat('c',64));
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('changed-replay','begin+finalize',0,elapsed);
  insert into v2313_responses values('changed-replay',replay_response);
  commit;
  raise notice 'V2313_PROGRESS_JSON=%', jsonb_build_object('scenario','changed-replay',
    'rpc_metrics',(select jsonb_agg(jsonb_build_object('operation',operation,'item_index',item_index,'elapsed_ms',elapsed_ms)
      order by operation,item_index) from v2313_rpc_metrics where scenario='changed-replay'));
  reconcile_index := 0;
  loop
    started_at := clock_timestamp();
    reconcile_value := public.reconcile_inventory_row_assignments_batch_v1(run_id,100);
    elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
    insert into v2313_rpc_metrics values('changed-replay','reconcile',reconcile_index,elapsed);
    commit;
    reconcile_index := reconcile_index + 1;
    if reconcile_value->>'status'='completed' then exit; end if;
    if reconcile_index > 200 then raise exception 'V2313_REPLAY_RECONCILE_DID_NOT_FINISH'; end if;
  end loop;
  started_at := clock_timestamp();
  perform public.finish_dataset_import_v1(run_id);
  elapsed := extract(epoch from clock_timestamp()-started_at)*1000;
  insert into v2313_rpc_metrics values('changed-replay','finish',0,elapsed);
  commit;

  execute 'explain (analyze,buffers,format json) select unique_id from public.ph_master_inventory where unique_id=''v2313-00001''' into plan_target;
  insert into v2313_evidence values('stage_lookup_plan',plan_stage),('target_unique_id_plan',plan_target);
  select count(*) into target_row_count from public.ph_master_inventory where unique_id like 'v2313-%';
  performance_value := jsonb_build_object(
    'assertions',61,'sourceHeaderPositions',76,'mappedSourceFields',74,'rawOnlySourceFields',1,'targetColumnCount',213,'sourceRows',9504,'sourceBytes',source_bytes,'fieldCount',columns_per_row,
    'postgresVersion',version(),'cacheCondition','first full publication followed by warm unchanged/changed/retry passes; OS cache uncontrolled',
    'row_count',9504,'distinctItemcodes',(select count(distinct (payload->'values'->>'itemcode')) from v2313_source_rows),
    'distinctLocations',(select count(distinct (payload->'values'->>'locationcode')) from v2313_source_rows),
    'distinctLots',(select count(distinct (payload->'values'->>'lotcode')) from v2313_source_rows),
    'columns_per_row',columns_per_row,'bytes_per_row',bytes_per_row,
    'chunk_size',500,'chunk_count',20,'target_row_count',target_row_count,
    'rpc_metrics',(select jsonb_agg(jsonb_build_object('scenario',scenario,'operation',operation,'item_index',item_index,'elapsed_ms',elapsed_ms) order by scenario,operation,item_index) from v2313_rpc_metrics),
    'timings',(select jsonb_agg(jsonb_build_object('scenario',scenario,'operation',operation,'item_index',item_index,'ms',elapsed_ms) order by scenario,operation,item_index) from v2313_rpc_metrics),
    'queryPlans',jsonb_build_object('stage_lookup',plan_stage,'target_unique_id',plan_target),
    'stage_lookup_plan',plan_stage,'target_unique_id_plan',plan_target
  );
  insert into v2313_evidence values('performance',performance_value);
end
$test$;

select diag('V2313_PERFORMANCE_JSON='||value::text) from v2313_evidence where key='performance';
select is(current_setting('v2313.rebind'),'true','a closed prior run is rebound only under the new active fence');
select is(current_setting('v2313.missing')::integer,19,'begin reports all chunks except the persisted chunk zero');
select is((select count(*)::integer from v2313_rpc_metrics where operation <> 'reconcile' and elapsed_ms >= 2000),0,
  'every measured staging, finalize, finish, and close RPC is under two seconds');
select is((select response->>'status' from v2313_responses where scenario='new'),'published','new snapshot publishes');
select is((select (response->>'sourceRows')::integer from v2313_responses where scenario='new'),9504,'new response reports all staged source rows');
select is((select (response->>'inserted')::integer from v2313_responses where scenario='new'),9503,'new snapshot inserts absent rows and updates the seeded row');
select is((select count(*)::integer from public.ph_master_inventory where unique_id like 'v2313-%'),9504,'all representative rows are present');
select is((select count(*)::integer from (
  select master.unique_id
  from public.ph_master_inventory master
  cross join lateral public.v2_crop_roll_drive_row_from_json(to_jsonb(master)) legacy
  cross join lateral private.ph_master_crop_roll_from_master_v1(master) projected
  where master.unique_id like 'v2313-%'
    and (to_jsonb(legacy)-'created_at'-'updated_at')
      is distinct from (to_jsonb(projected)-'created_at'-'updated_at')
) mapper_differences),0,
  'narrow crop-roll mapper projection exactly matches the legacy full-row mapper for all imported rows');
select ok((select (value->>'sentinel_present')::boolean and value->>'seeded_name'='Existing protected-field fixture'
  and (value->>'live_rows')::integer=2 from v2313_evidence where key='partial_snapshot_atomic'),
  'partial chunks leave live rows and absent-snapshot sentinel unchanged');
select is((select count(*)::integer from public.ph_master_inventory where unique_id='v2313-sentinel'),0,
  'sentinel is removed only when the complete snapshot atomically publishes');
select is((select holdstopcode from public.ph_master_inventory where unique_id='v2313-00001'),'LIVE-H','import preserves protected live hold code');
select is((select holdstopreason from public.ph_master_inventory where unique_id='v2313-00001'),'Live hold reason','import preserves protected live hold reason');
select is((select locationnote from public.ph_master_inventory where unique_id='v2313-00001'),'Live location note','import preserves protected live location note');
select is((select count(*)::integer from app_sync_private.ph_master_snapshot_stage_rows_v1 where request_id='b3200000-0000-4000-8000-000000000001'),0,'typed payload rows are removed after publish');
select is((select count(*)::integer from app_sync_private.ph_master_snapshot_stage_chunks_v1 where request_id='b3200000-0000-4000-8000-000000000001'),20,'compact chunk digests remain for receipt replay');
select is((select response->>'replayed' from v2313_responses where scenario='retry'),'true','same-run finalization replay returns the immutable published receipt');
select is((select response->>'runId' from v2313_responses where scenario='retry'),'b3100000-0000-4000-8000-000000000002','receipt replay is bound to the current validated run');
select is((select response->>'publicationRunId' from v2313_responses where scenario='retry'),'b3100000-0000-4000-8000-000000000002','receipt retains the original publication run');
select is((select (response->>'updated')::integer from v2313_responses where scenario='unchanged'),0,'unchanged full snapshot does not update master rows');
select is((select (response->>'unchanged')::integer from v2313_responses where scenario='unchanged'),9504,'unchanged full snapshot reports all rows unchanged');
select is((select (response->>'updated')::integer from v2313_responses where scenario='changed'),1,'changed full snapshot updates only the changed row');
select is((select commonname from public.ph_master_inventory where unique_id='v2313-00001'),'Changed representative row','changed snapshot data is authoritative');
select is((select response->>'replayed' from v2313_responses where scenario='changed-replay'),'true','published receipt can be acknowledged by a later active run');
select is((select response->>'runId' from v2313_responses where scenario='changed-replay'),'b3100000-0000-4000-8000-000000000005','later replay reports the current fence run');
select ok((select value::text like '%ph_master_snapshot_stage_rows_uidx%' from v2313_evidence where key='stage_lookup_plan'),
  'staging UID lookup uses the request and typed UID index');
select ok((select value::text like '%idx_ph_ok_master_inventory_unique_id%' from v2313_evidence where key='target_unique_id_plan'),
  'target unique ID lookup plan is captured');
select ok((select count(*)=9504
  and count(distinct (payload->'values'->>'itemcode'))=3206
  and count(distinct (payload->'values'->>'locationcode'))=638
  and count(distinct (payload->'values'->>'lotcode'))=38
  from v2313_source_rows),
  'fixture matches production row, itemcode, location, and lot cardinalities');
select is((select count(*)::integer from jsonb_object_keys((select payload->'values' from v2313_source_rows limit 1))),79,
  '76 header positions map to 74 target fields, one raw-only field, and four generated fields');
select is((select count(*)::integer from information_schema.columns where table_schema='public' and table_name='ph_master_inventory'),213,
  'all 213 inventory columns remain intact');
select is((select count(*)::integer from information_schema.columns where table_schema='app_sync_private' and table_name='ph_master_snapshot_stage_rows_v1'),87,
  'flat stage contains only 78 mapped/generated columns plus eight staging metadata columns and one computed identity cache');
select is((select value from v2313_evidence where key='target_only_preserved'),'true'::jsonb,
  'finalization leaves every target-only field unchanged on existing inventory');
select is((select hsreasonbegin from public.ph_master_inventory where unique_id='v2313-00001'),repeat('x',32),
  'HSREASONBEGIN is imported into its existing target column');
select is((select value from v2313_evidence where key='raw_only_source_preserved'),'true'::jsonb,
  'EXT_EQUIV_UNIT remains in raw staging evidence without entering target keys');
select is((select value from v2313_evidence where key='app_field_rejected'),'true'::jsonb,
  'source payloads cannot overwrite app-owned photo fields');

select ok((select b.priority=s.payload->'values'->>'priority' and b.holdstopcode=s.payload->'values'->>'holdstopcode'
    and b.holdstopreason=s.payload->'values'->>'holdstopreason'
  from app_sync_private.ph_master_inventory_source_baselines b join v2313_source_rows s on s.row_number=2
  where b.canonical_unique_id='v2313-00002'),
  'new-row batch records the original raw priority and hold baseline');
select is((select b.field_values from app_sync_private.ph_master_inventory_item6_source_v7 b where b.canonical_unique_id='v2313-00002'),
  (select jsonb_object_agg(k.key,payload->'values'->k.key) from v2313_source_rows s
    cross join lateral jsonb_array_elements_text(s.payload->'rawFields') k(key) where s.row_number=2),
  'new-row batch records every raw Item6 field including isolated location note');
-- Keep the finalizer-conflict scenario after the 9,504-row performance and
-- publication assertions so its deliberate extra rows do not alter them.
do $conflict_setup$
declare
  run_id uuid := 'b3100000-0000-4000-8000-000000000006';
  request_id uuid := 'b3200000-0000-4000-8000-000000000004';
  chunk_index integer;
  chunk_value jsonb;
begin
  perform set_config('request.headers','{}',false);
  insert into public.ph_master_inventory(
    unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,warehousei,priority
  ) values
    ('v2313-ambiguous-a','V2313-AMBIG','Ambiguous staged import fixture','#1','Z.01.001','27.S1','PH',null,'2'),
    ('v2313-ambiguous-b','V2313-AMBIG','Ambiguous staged import fixture','#1','Z.01.001','27.S1','PH',null,'2');
  insert into app_sync_private.ph_master_inventory_source_baselines(
    canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason
  )
  select master.unique_id,private.ph_master_inventory_lineage_key_v1(to_jsonb(master)),
    master.priority,master.holdstopcode,master.holdstopreason
  from public.ph_master_inventory master
  where master.unique_id in ('v2313-ambiguous-a','v2313-ambiguous-b');
  insert into v2313_ambiguous_before
  select master.unique_id,to_jsonb(master) from public.ph_master_inventory master
  where master.unique_id in ('v2313-ambiguous-a','v2313-ambiguous-b');
  insert into v2313_evidence(key,value) values('ambiguous_live_count_before',jsonb_build_object(
    'count',(select count(*) from public.ph_master_inventory where unique_id like 'v2313-%')
  ));
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  commit;
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,false);
  perform public.begin_master_snapshot_stage_v1(run_id,request_id,
    jsonb_build_array(jsonb_build_object('fileId','synthetic-drive-master-v2313','modifiedAt','2026-10-19T12:00:00Z','size',15000000)),
    repeat('d',64),9504,20);
  commit;
  for chunk_index in 0..19 loop
    select jsonb_agg(
      case when row_number=1 then jsonb_set(payload,'{values}',(payload->'values')||jsonb_build_object(
        'unique_id','v2313-ambiguous-source','itemcode','V2313-AMBIG',
        'commonname','Ambiguous staged import fixture','contsize','#1',
        'locationcode','Z.01.001','lotcode','27.S1','source','PH',
        'warehouseid',null,'desigitem',null,'desigcust',null,'desigloc',null
      )) else payload end
      order by row_number
    ) into chunk_value
    from v2313_source_rows
    where row_number between chunk_index*500+1 and least((chunk_index+1)*500,9504);
    perform public.append_master_snapshot_stage_chunk_v1(run_id,request_id,chunk_index,chunk_value);
    commit;
  end loop;
end
$conflict_setup$;

select throws_ok($$select public.finalize_master_snapshot_stage_v1(
  'b3100000-0000-4000-8000-000000000006','b3200000-0000-4000-8000-000000000004',repeat('d',64))$$,
  '55000','BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS',
  'known protected lineage conflicts become non-retryable while preserving the original error message');
select is((select count(*)::integer from public.ph_master_inventory where unique_id like 'v2313-%'),
  (select (value->>'count')::integer from v2313_evidence where key='ambiguous_live_count_before'),
  'a rejected staged finalization leaves the full live row count unchanged');
select is((select count(*)::integer from public.ph_master_inventory master
  join v2313_ambiguous_before saved using(unique_id)
  where to_jsonb(master) is distinct from saved.row_value),0,
  'a rejected staged finalization leaves both ambiguous canonical rows unchanged');
select is((select count(*)::integer from public.ph_master_inventory where unique_id='v2313-ambiguous-source'),0,
  'a rejected staged finalization does not publish the conflicting alias');
select public.fail_dataset_import_v1('b3100000-0000-4000-8000-000000000006');
select set_config('request.headers','{}',false);
select set_config('gnc.master_snapshot_verified_insert',pg_backend_pid()::text||':'||txid_current()::text,false);
select set_config('request.headers','{"x-gnc-import-run-id":"b3100000-0000-4000-8000-999999999999"}',false);
select throws_ok($$insert into public.ph_master_inventory(unique_id,itemcode) values('v2313-forged-proof','FORGED')$$,
  '55000','MASTER_PRIORITY_HOLD_IMPORT_TOKEN_INVALID','forged client GUC cannot bypass the private statement proof');
select set_config('request.headers','{}',false);
select is((select value from v2313_evidence where key='cache_input_rejected'),'true'::jsonb,'computed identity cache cannot be supplied by a caller');
select is((select value from v2313_evidence where key='cache_parity'),'true'::jsonb,'all500 cached stable keys match the original immutable source helper');
select is(cardinality(string_to_array(app_sync_private.master_snapshot_stage_columns_v1(null),',')),78,'computed cache remains outside the78-column source contract');
select * from finish();
