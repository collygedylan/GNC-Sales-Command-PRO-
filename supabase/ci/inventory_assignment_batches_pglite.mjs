// Apply the actual bounded-assignment migration to isolated PGlite and verify
// its service-role boundary, checkpoint paging, stale retirement, witness reset,
// and normal publication fence. The resolver and import-fence functions below
// are isolated contract stubs; this does not run the full production resolver
// body. No remote database is contacted.
// node supabase/ci/inventory_assignment_batches_pglite.mjs --pglite-root C:/Users/dylan/Projects/GNC/tools/bunch-note-check
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--pglite-root');
if (rootIndex < 0 || !args[rootIndex + 1]) throw new Error('Pass --pglite-root with the installed PGlite package.');
const dependencyRoot = path.resolve(args[rootIndex + 1]);
const { PGlite } = createRequire(path.join(dependencyRoot, 'package.json'))('@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261014155536_inventory_assignment_reconciliation_batches.sql', import.meta.url), 'utf8');
const projectionMigration = await readFile(new URL('../migrations/20261014160924_inventory_assignment_witness_projection.sql', import.meta.url), 'utf8');
const generationMigration = await readFile(new URL('../migrations/20261014161813_inventory_assignment_input_generation.sql', import.meta.url), 'utf8');
assert.match(migration, /reconcile_inventory_row_assignments_batch_v1/i, 'actual assignment-batch migration is present');
assert.match(projectionMigration, /create or replace function private\.inventory_row_assignment_reconcile_source_witness_v1/i,
  'actual witness-projection follow-up migration is present');
assert.match(generationMigration, /inventory_row_assignment_input_generation/i,
  'actual generation-stamp migration is present');

const schema = `
create role anon; create role authenticated; create role service_role;
create schema private; create schema app_sync_private;
create table public.ph_master_inventory(unique_id text primary key,itemcode text,genusname text,commonname text,contsize text,locationcode text,lotcode text,source text,warehousei text,plantgroupcode text,legacy_assignedto text);
create table public.ph_itemcode_default_owners(itemcode_normalized text primary key,assignedto text,assigned_at timestamptz,revision integer,review_required boolean);
create table public.ph_warehouse_assigned_items(assignment_key text primary key,present_in_drive boolean,assignedto text,assigned_at timestamptz,zone_override_active boolean,zone_override_prior_assignedto text,zone_override_prior_assigned_at timestamptz);
create table public.ph_eval_assignment_users(username text primary key,active boolean);
create table public.profiles(username text primary key,disabled_at timestamptz,locked_until timestamptz,last_seen timestamptz);
insert into public.profiles values('fixture-profile',null,null);
create table private.ph_inventory_row_assignment_policy_state(singleton boolean primary key,active boolean);
insert into private.ph_inventory_row_assignment_policy_state values(true,true);
create table public.ph_inventory_row_assignments(master_unique_id text primary key,unique_id text,itemcode text,itemcode_normalized text,assignment_reason text,present_in_drive boolean,source_revision bigint,revision integer,assignedto text);
create table private.ph_inventory_row_assignment_audit(master_unique_id text,event_type text);
create table private.assignment_resolver_calls(call_id bigint generated always as identity,master_unique_id text,source_found boolean);
create table private.fixture_controls(mutate_dependency boolean not null default false,mutation_done boolean not null default false);
insert into private.fixture_controls values(false,false);
create table public.app_dataset_revisions(key text primary key,state text not null,revision bigint not null default 0);
insert into public.app_dataset_revisions values('ph_master_inventory','ready',0);
create table app_sync_private.import_runs(id uuid primary key,state text not null,expires_at timestamptz not null,source_keys text[] not null,canonical_keys text[] not null);
create table app_sync_private.import_leases(key text primary key,run_id uuid not null);
create function private.resolve_inventory_row_assignment_v1(p_master_unique_id text,p_source_revision bigint default null)
returns public.ph_inventory_row_assignments language plpgsql security definer set search_path='' as $$
declare result_row public.ph_inventory_row_assignments; source_found boolean;
begin
  select exists(select 1 from public.ph_master_inventory m where m.unique_id=p_master_unique_id) into source_found;
  insert into private.assignment_resolver_calls(master_unique_id,source_found) values(p_master_unique_id,source_found);
  if exists(select 1 from private.fixture_controls where mutate_dependency and not mutation_done) then
    update public.ph_itemcode_default_owners set assignedto='changed-during-batch'
      where itemcode_normalized='FIXTURE-DEFAULT';
    update public.profiles set disabled_at=clock_timestamp() where username='fixture-profile';
    update private.ph_inventory_row_assignment_policy_state set active=false where singleton;
    update private.fixture_controls set mutation_done=true;
  end if;
  if not source_found then
    update public.ph_inventory_row_assignments a set present_in_drive=false,assignment_reason='source_missing',revision=revision+1,source_revision=p_source_revision
      where a.master_unique_id=p_master_unique_id and a.present_in_drive returning * into result_row;
    if found then insert into private.ph_inventory_row_assignment_audit values(p_master_unique_id,'source_removed'); end if;
    return result_row;
  end if;
  insert into public.ph_inventory_row_assignments(master_unique_id,unique_id,itemcode,itemcode_normalized,assignment_reason,present_in_drive,source_revision,revision)
  select m.unique_id,m.unique_id,m.itemcode,upper(btrim(coalesce(m.itemcode,''))),'fixture_resolved',true,p_source_revision,1
  from public.ph_master_inventory m where m.unique_id=p_master_unique_id
  on conflict(master_unique_id) do update set unique_id=excluded.unique_id,itemcode=excluded.itemcode,itemcode_normalized=excluded.itemcode_normalized,
    assignment_reason=excluded.assignment_reason,present_in_drive=true,source_revision=excluded.source_revision,revision=public.ph_inventory_row_assignments.revision+1
  returning * into result_row;
  return result_row;
end $$;
create function private.reconcile_inventory_row_assignments_v1(p_import_run_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$ select jsonb_build_object('status','completed','processed',0) $$;
create function app_sync_private.begin_import(p_dataset_keys text[],p_run_id uuid,p_canonical_keys text[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  insert into app_sync_private.import_runs values(p_run_id,'active',clock_timestamp()+interval '12 minutes',p_dataset_keys,p_canonical_keys);
  insert into app_sync_private.import_leases select key,p_run_id from unnest(p_dataset_keys) requested(key);
  update public.app_dataset_revisions set state='importing' where key='ph_master_inventory' and 'ph_master_inventory'=any(p_dataset_keys);
  return jsonb_build_object('ok',true,'state','active');
end $$;
create function app_sync_private.advance_import(p_run_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run app_sync_private.import_runs; assignment_result jsonb;
begin
  select * into run from app_sync_private.import_runs r where r.id=p_run_id for update;
  if p_action='finish' then
    if 'ph_master_inventory'=any(run.source_keys) and 'ph_master_inventory'=any(run.canonical_keys) then
      assignment_result := private.reconcile_inventory_row_assignments_v1(p_run_id);
      if assignment_result->>'status' is distinct from 'completed' then raise exception 'LEGACY_RECONCILE_FAILED'; end if;
    end if;
    update app_sync_private.import_runs set state='completed' where id=p_run_id;
    update public.app_dataset_revisions set state='ready',revision=revision+1 where key='ph_master_inventory' and 'ph_master_inventory'=any(run.source_keys);
    delete from app_sync_private.import_leases where run_id=p_run_id;
    return coalesce(assignment_result,jsonb_build_object('status','completed'));
  end if;
  update app_sync_private.import_runs set state='failed' where id=p_run_id;
  update public.app_dataset_revisions set state='interrupted' where key='ph_master_inventory' and 'ph_master_inventory'=any(run.source_keys);
  delete from app_sync_private.import_leases where run_id=p_run_id;
  return jsonb_build_object('status','failed');
end $$;
`;

const db = await PGlite.create();
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const generation = async () => (await query('select generation from private.inventory_row_assignment_input_generation where singleton'))[0].generation;
const runId = 'ae100000-0000-4000-8000-000000000001';
try {
  await db.exec(schema);
  await db.exec(migration);
  await db.exec(projectionMigration);
  await db.exec(generationMigration);
  const metadata = (await query(`select p.prosecdef security_definer,p.proconfig,p.proacl::text acl
    from pg_catalog.pg_proc p where p.oid='public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)'::regprocedure`))[0];
  assert.equal(metadata.security_definer, true);
  assert.ok(metadata.proconfig.some(value => value === 'search_path=""'));
  assert.equal((await query(`select p.provolatile from pg_catalog.pg_proc p
    where p.oid='private.inventory_row_assignment_reconcile_source_witness_v1()'::regprocedure`))[0].provolatile,'v',
    'the stamped witness helper is volatile so its locked generation read is refreshed per RPC');
  assert.equal((await query(`select has_function_privilege('service_role','public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)','EXECUTE') value`))[0].value, true);
  assert.equal((await query(`select has_function_privilege('authenticated','public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)','EXECUTE') value`))[0].value, false);
  assert.equal((await query(`select has_table_privilege('service_role','private.inventory_row_assignment_reconcile_runs','SELECT') value`))[0].value, false);

  await db.query(`insert into public.ph_master_inventory(unique_id,itemcode,genusname,locationcode)
    select 'live-'||n,'ITEM-'||n,'Testus','Z.99' from generate_series(1,105) n`);
  await db.query(`insert into public.ph_inventory_row_assignments(master_unique_id,unique_id,itemcode,itemcode_normalized,assignment_reason,present_in_drive,source_revision,revision)
    values('stale-row','stale-row','STALE','STALE','existing',true,0,1)`);
  await db.query(`select app_sync_private.begin_import(array['ph_master_inventory'],'${runId}',array['ph_master_inventory'])`);

  const first = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,100) response',[runId]))[0].response;
  assert.equal(first.status,'in_progress'); assert.equal(first.processed,100); assert.equal(first.total,106);
  assert.equal((await query('select count(*)::int n from private.assignment_resolver_calls'))[0].n,100,
    'one RPC invokes the existing resolver no more than the requested 100 times');
  assert.equal((await query(`select count(*)::int n from private.assignment_resolver_calls where master_unique_id='stale-row'`))[0].n,0,
    'source rows are processed before the stale-retirement tail');
  await assert.rejects(db.query(`select app_sync_private.advance_import($1,'finish')`,[runId]),/PERENNIAL_ASSIGNMENT_RECONCILE_INCOMPLETE/);

  const second = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,100) response',[runId]))[0].response;
  assert.equal(second.status,'completed'); assert.equal(second.processed,106); assert.equal(second.total,106); assert.equal(second.retired,1);
  assert.equal((await query(`select present_in_drive from public.ph_inventory_row_assignments where master_unique_id='stale-row'`))[0].present_in_drive,false,
    'stale assignments are retired in the bounded worklist tail');
  assert.equal((await query(`select count(*)::int n from private.ph_inventory_row_assignment_audit where master_unique_id='stale-row' and event_type='source_removed'`))[0].n,1);
  const retry = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,100) response',[runId]))[0].response;
  assert.deepEqual(retry,second,'retry after a completed response remains idempotent');
  await query(`select app_sync_private.advance_import($1,'finish')`,[runId]);
  assert.equal((await query(`select state from public.app_dataset_revisions where key='ph_master_inventory'`))[0].state,'ready');
  assert.equal((await query(`select count(*)::int n from app_sync_private.import_leases where run_id=$1`,[runId]))[0].n,0);
  await assert.rejects(query('select public.reconcile_inventory_row_assignments_batch_v1(null::uuid,101)'),/INVENTORY_ROW_ASSIGNMENT_BATCH_SIZE_INVALID/);

  const mutationRun = 'ae100000-0000-4000-8000-000000000004';
  await query(`insert into public.ph_itemcode_default_owners values('FIXTURE-DEFAULT','owner-before',null,1,false)`);
  await query(`update public.ph_inventory_row_assignments set present_in_drive=true,assignment_reason='existing' where master_unique_id='stale-row'`);
  await query(`select app_sync_private.begin_import(array['ph_master_inventory'],$1,array['ph_master_inventory'])`,[mutationRun]);
  const mutationFirstPage = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,100) response',[mutationRun]))[0].response;
  assert.equal(mutationFirstPage.status,'in_progress'); assert.equal(mutationFirstPage.processed,100);
  const processedBeforeMutation = (await query(`select processed_count from private.inventory_row_assignment_reconcile_runs where import_run_id=$1`,[mutationRun]))[0].processed_count;
  await query(`update private.fixture_controls set mutate_dependency=true,mutation_done=false`);
  const callsBeforeMutation = (await query('select count(*)::int n from private.assignment_resolver_calls'))[0].n;
  const generationBeforeMutation = await generation();
  await assert.rejects(
    query('select public.reconcile_inventory_row_assignments_batch_v1($1,100)',[mutationRun]),
    /INVENTORY_ROW_ASSIGNMENT_SOURCE_CHANGED/,
    'a dependency mutation during a batch aborts the whole transaction'
  );
  assert.equal((await query(`select assignedto from public.ph_itemcode_default_owners where itemcode_normalized='FIXTURE-DEFAULT'`))[0].assignedto,'owner-before',
    'mid-batch dependency mutation rolls back');
  assert.equal((await query(`select disabled_at from public.profiles where username='fixture-profile'`))[0].disabled_at,null,
    'mid-batch profile eligibility mutation rolls back');
  assert.equal((await query(`select active from private.ph_inventory_row_assignment_policy_state where singleton`))[0].active,true,
    'mid-batch policy mutation rolls back');
  assert.equal((await query('select count(*)::int n from private.assignment_resolver_calls'))[0].n,callsBeforeMutation,
    'resolver writes and invocation log roll back with the page');
  assert.equal(await generation(),generationBeforeMutation,
    'trigger generation increments from the failed transaction roll back with its input writes');
  assert.equal((await query(`select processed_count from private.inventory_row_assignment_reconcile_runs where import_run_id=$1`,[mutationRun]))[0].processed_count,processedBeforeMutation,
    'a rejected page preserves only previously committed checkpoint progress');
  await query(`update private.fixture_controls set mutate_dependency=false,mutation_done=false`);
  const mutationLastPage = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,100) response',[mutationRun]))[0].response;
  assert.equal(mutationLastPage.status,'completed'); assert.equal(mutationLastPage.processed,106);
  const mutationRunCheckpoint = (await query(`select source_revision from private.inventory_row_assignment_reconcile_runs where import_run_id=$1`,[mutationRun]))[0].source_revision;
  const revisionBeforeFinish = (await query(`select revision from public.app_dataset_revisions where key='ph_master_inventory'`))[0].revision;
  assert.equal(mutationRunCheckpoint,revisionBeforeFinish+1,
    'the checkpoint stores the revision the canonical master finish is about to publish');
  const mutationFinish = (await query(`select app_sync_private.advance_import($1,'finish') response`,[mutationRun]))[0].response;
  const mutationPublishedRevision = (await query(`select revision from public.app_dataset_revisions where key='ph_master_inventory'`))[0].revision;
  assert.equal(mutationRunCheckpoint,mutationPublishedRevision,
    'the assignment checkpoint source revision matches the master revision published by finish');
  assert.equal(Number(mutationFinish.sourceRevision),mutationPublishedRevision);

  const resetRun = 'ae100000-0000-4000-8000-000000000002';
  await query(`select app_sync_private.begin_import(array['ph_master_inventory'],$1,array['ph_master_inventory'])`,[resetRun]);
  const resetStart = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,1) response',[resetRun]))[0].response;
  assert.equal(resetStart.status,'in_progress');
  await query(`update public.ph_master_inventory set itemcode='changed-once' where unique_id='live-1'`);
  const reset = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,1) response',[resetRun]))[0].response;
  assert.equal(reset.status,'reset'); assert.equal(reset.processed,0);
  assert.equal((await query(`select processed_count from private.inventory_row_assignment_reconcile_runs where import_run_id=$1`,[resetRun]))[0].processed_count,0);
  await query(`update public.ph_master_inventory set itemcode='changed-twice' where unique_id='live-1'`);
  await assert.rejects(query('select public.reconcile_inventory_row_assignments_batch_v1($1,1)',[resetRun]),/INVENTORY_ROW_ASSIGNMENT_SOURCE_CHANGED/);
  assert.equal((await query(`select count(*)::int n from app_sync_private.import_leases where key='ph_master_inventory' and run_id=$1`,[resetRun]))[0].n,1,
    'a second witness change leaves the active fence intact');
  await query(`select app_sync_private.advance_import($1,'fail')`,[resetRun]);

  const nonMasterRun = 'ae100000-0000-4000-8000-000000000003';
  await query(`select app_sync_private.begin_import(array['ph_soc_master'],$1,array['ph_soc_master'])`,[nonMasterRun]);
  const resolverCallsBefore = (await query('select count(*)::int n from private.assignment_resolver_calls'))[0].n;
  await query(`select app_sync_private.advance_import($1,'finish')`,[nonMasterRun]);
  assert.equal((await query('select count(*)::int n from private.assignment_resolver_calls'))[0].n,resolverCallsBefore,
    'non-master finish preserves the existing non-assignment path');

  const irrelevantRun = 'ae100000-0000-4000-8000-000000000005';
  await query(`select app_sync_private.begin_import(array['ph_master_inventory'],$1,array['ph_master_inventory'])`,[irrelevantRun]);
  const irrelevantFirst = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,1) response',[irrelevantRun]))[0].response;
  assert.equal(irrelevantFirst.status,'in_progress'); assert.equal(irrelevantFirst.processed,1);
  await query(`update public.ph_master_inventory set legacy_assignedto='unrelated-legacy-value' where unique_id='live-1'`);
  const irrelevantSecond = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,1) response',[irrelevantRun]))[0].response;
  assert.equal(irrelevantSecond.status,'in_progress'); assert.equal(irrelevantSecond.processed,2,
    'a master field excluded from resolver input does not trigger witness reset');
  const witnessBeforeExcludedFields = (await query('select private.inventory_row_assignment_reconcile_source_witness_v1() witness'))[0].witness;
  const generationBeforeExcludedFields = await generation();
  await query(`update public.profiles set last_seen=clock_timestamp() where username='fixture-profile'`);
  assert.equal(await generation(),generationBeforeExcludedFields,'profile last_seen is not a resolver input');
  assert.equal((await query('select private.inventory_row_assignment_reconcile_source_witness_v1() witness'))[0].witness,witnessBeforeExcludedFields,
    'excluded profile last_seen does not alter the source witness');
  const irrelevantThird = (await query('select public.reconcile_inventory_row_assignments_batch_v1($1,1) response',[irrelevantRun]))[0].response;
  assert.equal(irrelevantThird.status,'in_progress'); assert.equal(irrelevantThird.processed,3,
    'excluded profile last_seen does not reset checkpoint progress');
  await query(`select app_sync_private.advance_import($1,'fail')`,[irrelevantRun]);

  assert.equal((await query(`select count(distinct t.tgrelid)::int n from pg_trigger t
    where not t.tgisinternal and t.tgname like 'inventory_assignment_witness_%'`))[0].n,6,
    'generation triggers cover all six resolver-input tables');
  const assertGenerationBump = async (label, statement) => {
    const before = await generation();
    await query(statement);
    const after = await generation();
    assert.equal(after,before+1,`${label} increments the input generation`);
  };
  await query(`insert into public.ph_warehouse_assigned_items(assignment_key,present_in_drive,assignedto) values('legacy-fixture',true,'owner-a')`);
  await query(`insert into public.ph_eval_assignment_users(username,active) values('roster-fixture',true)`);
  await assertGenerationBump('master itemcode',`update public.ph_master_inventory set itemcode='STAMPED-MASTER' where unique_id='live-1'`);
  await assertGenerationBump('default owner',`update public.ph_itemcode_default_owners set assignedto='owner-stamped' where itemcode_normalized='FIXTURE-DEFAULT'`);
  await assertGenerationBump('legacy assignment',`update public.ph_warehouse_assigned_items set assignedto='owner-stamped' where assignment_key='legacy-fixture'`);
  await assertGenerationBump('assignment roster',`update public.ph_eval_assignment_users set active=false where username='roster-fixture'`);
  await assertGenerationBump('profile eligibility',`update public.profiles set disabled_at=clock_timestamp() where username='fixture-profile'`);
  await assertGenerationBump('policy state',`update private.ph_inventory_row_assignment_policy_state set active=false where singleton`);

  // This is a schema migration, intended to be run once by the migration ledger.
  // Exercise a second application explicitly so non-idempotence is visible.
  await assert.rejects(db.exec(migration), /already exists/i);
  console.log('PASS actual migration application; security, bounded resolver pages, stale retirement, checkpoint retry, one witness reset, fail-closed finish and ready publication verified. NOTE migration replay is not idempotent (expected one-time migration ledger behavior).');
} finally {
  await db.close();
}
