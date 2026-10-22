// @test-group: release-tooling
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const domains = {
  'drive-and-av-specialist': ['EXPORT EXCEL', 'COMMONNAME', 'CONTSIZE', 'SEASON', 'Loc Photo Match', 'Loc On Hand', 'ORANGE', 'NS 1.0', 'LD'],
  'bloom-and-request-specialist': ['CLEAR BLOOM PICKER', 'Consignee', 'ITEM 1 OF N', 'Sales Rep', 'Take Back', '2nd Cut', 'Shear', 'TX', 'NE', 'ADV'],
  'queue-and-reclass-specialist': ['physical', 'tag line ID', 'locationcode', 'lotcode', 'HTML', 'PDF', 'dylan_collyge', 'megan_kelly', 'jd_jones', 'sunday_ellis'],
  'field-ops-and-qc': ['LOCATION MOVES', 'RECOUNT', 'SHEAR LIST', 'EVAL WORK', 'BUNCH NOTES', 'overwintering'],
  'docks-and-orders-specialist': ['PLANSTART', 'Dock', 'Drop', 'SOC-10-Open-Orders', 'SOC-10-Reserves', 'Warehouse Assigned Items', 'Pikes', 'Stine'],
  'sync-and-supabase-architect': ['UP_TO_DATE', 'TEMP_*', '~$*', '120s', 'READY', 'America/Chicago', 'paused'],
  'zero-lockout-guard': ['same-account', 'Verifying updated access', 'Drive Inventory unavailable', 'Row Details Unavailable', 'v2.1.x', 'revocation'],
  'release-governor': ['scripts/run-release-smoke.mjs', '2,000 ms', '9,487', 'allowlist', 'zero retries', 'historical'],
  'skill-learner': ['ERP', 'Supabase', 'UI', 'same commit', 'allowlist', 'SKILL.md'],
  'app-shell-and-navigation': ['goBackUniversal', 'switchView', 'viewHistoryStack', 'global-header-inline-back', 'data-secondary-back', 'Home'],
  'aura-assistant': ['callAuraLlmRouter', 'requestAuraQuery', 'switchView', 'aura_voice_access_v1', 'legacy'],
  'runtime-watchdog': ['GncRuntimeWatchdog', 'VIEW_LOAD_STALL', 'watchdog_log_event', 'watchdog_list_events', 'COPY AI FIX BRIEF', 'switchView', 'goBackUniversal'],
};

test('all AgData domain skills have valid unique manifests and requested contracts', () => {
  const skillRoot = path.join(root, '.codex/skills');
  const names = fs.readdirSync(skillRoot).filter(name => name.startsWith('agdata-')).sort();
  assert.deepEqual(names, Object.keys(domains).map(name => `agdata-${name}`).sort());
  const governance = read('AGENTS.md');
  for (const [domain, terms] of Object.entries(domains)) {
    const name = `agdata-${domain}`;
    const source = read(`.codex/skills/${name}/SKILL.md`);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
    assert.ok(frontmatter, name);
    const manifest = yaml.safeLoad(frontmatter[1]);
    assert.equal(manifest.name, name);
    assert.equal(typeof manifest.description, 'string');
    assert.ok(manifest.description.length > 20);
    assert.ok(governance.includes(`.codex/skills/${name}/SKILL.md`), `${name} must be routed`);
    for (const term of terms) assert.ok(source.includes(term), `${name}: missing ${term}`);
    assert.doesNotMatch(source, /TODO|\[insert|\\r\\n/);
  }
});

test('governance, LF attributes and effort defaults preserve explicit boundaries', () => {
  const source = read('AGENTS.md');
  // Approved governance plus source-audited skill routing; Markdown remains LF.
  assert.equal(createHash('sha256').update(source).digest('hex'),
    '9674343e113274f5de41962d4f38897acc640d08d8ffe5cf7ce39c46d34b3608');
  assert.ok(source.startsWith('# CRITICAL: Zero-Downtime, Zero-Lockout & Autonomous Execution Protocols\n'));
  assert.doesNotMatch(source, /\\r\\n|STEP 2:|Markdown#/);
  assert.ok(source.includes('<= 2,000 ms'));
  assert.ok(source.includes('eight consecutive attempts'));
  assert.ok(source.includes('must remain PAUSED whenever explicitly instructed'));
  assert.ok(source.includes('Production AI and Runtime Watchdog Boundary'));
  assert.ok(source.includes('read-only by default'));
  assert.ok(source.includes('explicit user release prompt naming the reviewed change and authorized action'));
  assert.ok(source.includes('local implementation permission alone does not authorize production writes, push, or deployment'));
  const attributes = read('.gitattributes');
  for (const ext of ['js', 'mjs', 'ts', 'json', 'html', 'css', 'sql', 'gs', 'webmanifest', 'md', 'yml']) {
    assert.ok(attributes.split('\n').includes(`*.${ext} text eol=lf`), ext);
  }
  assert.ok(attributes.indexOf('assets/vendor/supabase-browser-*.min.js binary') > attributes.indexOf('*.js text eol=lf'));
  assert.match(read('.codex/config.toml'), /^model_reasoning_effort = "medium"$/m);
  assert.match(read('.codex/config.toml'), /^default_subagent_reasoning_effort = "medium"$/m);
  assert.equal(Object.hasOwn(JSON.parse(read('package.json')), 'scopedValidationReceipt'), false);
});

test('staging validates one artifact without widening the production release path', () => {
  const workflow = yaml.safeLoad(read('.github/workflows/release-validation.yml'));
  assert.deepEqual(workflow.on.push.branches, ['staging']);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.permissions.actions, 'read');
  assert.match(workflow.jobs.build.steps.find(step => step.id === 'site').with.name, /^\$\{\{.*staging-site.*\}\}/);
  assert.match(workflow.jobs['production-health'].if, /inputs\.production-health/);
  assert.doesNotMatch(workflow.jobs.build.steps.map(step => JSON.stringify(step)).join('\n'), /secrets\./);
  assert.equal(Object.keys(workflow.jobs).some(name => /deploy|publish/i.test(name)), false);
  for (const name of ['lint', 'unit', 'react', 'contracts', 'database', 'fast-browser', 'foundation', 'functional', 'compiled', 'timing', 'performance', 'lighthouse']) {
    assert.match(workflow.jobs[name].if, /refs\/heads\/main/);
    assert.match(workflow.jobs[name].if, /run-nightly-suites/);
  }
});

test('setup documentation supplies a compiler prompt without claiming account activation', () => {
  const source = read('docs/gnc-codex-app.md');
  assert.ok(source.includes('You are the AgData Codex Compiler'));
  assert.ok(source.includes('does not create account-side skills'));
  assert.ok(source.includes('Build Cloud and Testcontainers Cloud remain disabled'));
  assert.ok(source.includes('88/142/387 ms'));
  assert.ok(source.includes('not measurements of the modified harness'));
});

test('startup snapshot fixtures reject unregistered operations and injected parameters',async()=>{
 const {releaseSnapshotReadFixture}=await import('./helpers/release-smoke-route-policy.mjs');
 assert.equal(releaseSnapshotReadFixture({action:'customer-rep-map',operation:'preload'}).total,0);
 assert.deepEqual(releaseSnapshotReadFixture({action:'suspend_tag',operation:'inbox',payload:{},commandId:null,expectedVersion:null}).data.approvals,[]);
 assert.equal(releaseSnapshotReadFixture({action:'customer-rep-map',operation:'preload',actorId:'forged'}),null);
 assert.equal(releaseSnapshotReadFixture({action:'suspend_tag',operation:'send',payload:{},commandId:null,expectedVersion:null}),null);
});

test('Request and sync startup reads reject forged parameters and all mutations',async()=>{
 const {releaseSnapshotReadFixture}=await import('./helpers/release-smoke-route-policy.mjs');
 assert.equal(releaseSnapshotReadFixture({action:'manual_sync_status'}).data.active,false);
 assert.equal(releaseSnapshotReadFixture({action:'manual_sync_status',operation:'write'}),null);
 assert.equal(releaseSnapshotReadFixture({action:'request_work',operation:'save'}),null);
 assert.equal(releaseSnapshotReadFixture({action:'request_work',operation:'capabilities',actorId:'forged'},[],[],{}),null);
 assert.deepEqual(releaseSnapshotReadFixture({action:'request_work',operation:'capabilities'},[],[],{username:'dylan_collyge'}).data,{username:'dylan_collyge'});
 const runner=read('scripts/apply-item-low-stock-migration.mjs');
 assert.ok(runner.includes('suspendCandidatesRequestPreloadMigrationName, requestWorkSyncStatusMigrationName, applicationConflictRetryMigrationName, operationalLookupIndexesMigrationName, masterChunkLedgerCapacityMigrationName, inventoryOverrideReconciliationMigrationName, evalBrowseSuspendReceiptsMigrationName, reclassSeasonStockMigrationName]'));
 assert.ok(runner.includes('if (name === requestWorkSyncStatusMigrationName)'));
});

test('sync status table is registered in typed and runtime read contracts',()=>{
 const types=read('supabase/functions/_shared/database.types.ts');
 const generated=read('services/database-contracts.generated.ts');
 assert.ok(types.includes('app_manual_sync_status: {'));
 assert.ok(generated.includes('"app_manual_sync_status": {'));
 for(const field of ['id','status','updated_at'])assert.ok(generated.slice(generated.indexOf('"app_manual_sync_status"'),generated.indexOf('"app_dataset_revisions"')).includes('"'+field+'"'));
});


test('conditional dataset fixture rejects unknown keys, unsupported datasets and forged operations', async () => {
 const vm = await import('node:vm');
 const source=read('tests/fixtures/hl-order-state.mjs');
 const expression=source.slice(source.indexOf('const datasetRead =') + 'const datasetRead ='.length, source.indexOf(';', source.indexOf('const datasetRead =')));
 const allowed=body=>vm.runInNewContext(expression,{body,req:{headers:()=>({})}});
 const body={action:'dataset_read',dataset:'cav',params:{limit:500,offset:0,ifRevision:'7'}};
 assert.equal(allowed(body),true);
 assert.equal(allowed({...body,params:{...body.params,actorId:'forged'}}),false);
 assert.equal(allowed({...body,params:{...body.params,ifRevision:'invalid'}}),false);
 assert.equal(allowed({...body,dataset:'suspend_tag'}),false);
 assert.equal(allowed({...body,operation:'delete'}),false);
});


test('master staging constraints accept 2000-row batches and preserve existing 500-row receipts',async()=>{
 const sql=read('supabase/migrations/20261021195000_master_chunk_ledger_capacity.sql');
 assert.match(sql,/row_count >= 1 and row_count <= 2000/);
 assert.doesNotMatch(sql,/delete from|truncate|drop table/i);
 const {selectReleaseMigrations,migrationContractQuery}=await import('../scripts/apply-item-low-stock-migration.mjs');
 assert.equal(selectReleaseMigrations(JSON.stringify(['supabase/migrations/20261021195000_master_chunk_ledger_capacity.sql'])).length,1);
 assert.match(migrationContractQuery('20261021195000_master_chunk_ledger_capacity.sql'),/convalidated/);
});

test('desktop shell publication refreshes assets without clearing account stores', () => {
 const sw=read('sw.js');assert.match(sw,/APP_SHELL_BUILD = 'AgData v2.3.39'/);assert.match(sw,/APP_SHELL_RUNTIME_REVISION = 'watchdog-queue-r1'/);assert.match(sw,/CACHE_NAME = 'agdata-v2.3.39'/);assert.match(sw,/cache: 'reload'/);
});


test('queue badge startup contracts remain read-only and reject forged scopes',async()=>{
 const {releaseSnapshotReadFixture:fixture}=await import('./helpers/release-smoke-route-policy.mjs');
 const location={action:'location_work',operation:'list',status:'all'};
 const bunch={action:'bunch_note_workflow',operation:'queue',payload:{filter:'mine',offset:0,limit:100}};
 assert.deepEqual(fixture(location).data,[]);assert.equal(fixture(bunch).data.active_count,0);
 assert.equal(fixture({...location,actorId:'forged'}),null);
 assert.equal(fixture({...bunch,operation:'complete_card'}),null);
 assert.equal(fixture({...bunch,payload:{...bunch.payload,actorId:'forged'}}),null);
});
