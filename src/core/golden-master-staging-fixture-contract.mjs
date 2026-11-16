import assert from 'node:assert/strict';
import {compileCanonicalMasterStagingFixture,HISTORICAL_MASTER_STAGING_FIXTURE} from '../services/canonical-master-staging-fixture.mjs';

export function assertQueueResolution(read) {
  const migration = read('supabase/migrations/20261025234500_agdata_v2366_queue_resolution_cleanup.sql');
  for (const marker of ['queue_cleanup_recount_jobs_v2366', 'queue_cleanup_bunch_jobs_v2366',
    'queue_cleanup_sales_recounts_v2366', "status = 'completed'", "then 'retired'",
    'ph_ncr_completions', 'QUEUE_CLEANUP_RECOUNT_ACTIVE_ROWS_REMAIN',
    'QUEUE_CLEANUP_BUNCH_ACTIVE_ROWS_REMAIN', 'QUEUE_CLEANUP_OUTBOX_CHANGED',
    'REQ-mvk1xgv2ty9fttuqj2', 'REQ-mvlbp5hkkk58akaubms', 'REQ-mvlfib5eqwa3typzcqq',
    'REQ-mvlfib5evawvlvvx09', 'REQ-mvlg4t85vlzf7053pv', 'REQ-mvlgbfl7p8r8zxrj97j',
    'Pink Delight Butterfly Bush', 'queue-resolution-cleanup-v2366']) {
    assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ph_request_delivery_outbox/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ph_delivery_outbox/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ph_requests_pending/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ph_soc_master/i);
  assert.doesNotMatch(migration, /\btruncate\b|\bdrop\s+table\b/i);

  const verifier = read('scripts/verify-live-request-queue.mjs');
  for (const marker of ['queueProof', 'RECOUNT ${recountBadgeCount}', 'BUNCH NOTES ${bunchBadgeCount}',
    'SUSPEND ${suspendBadgeCount}', 'No recount rows.', 'No Bunch Notes in this filter.',
    'Pink Delight Butterfly Bush', '[data-bunch-card]']) {
    assert.match(verifier, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'),
    /agdataV2366QueueResolutionCleanupMigrationName[^]*registeredReleaseDatabaseMigrations/);
}

export function assertCanonicalStagingAdaptation(read) {
  const original=read(HISTORICAL_MASTER_STAGING_FIXTURE);
  const compiled=compileCanonicalMasterStagingFixture(original,read);
  const count=source=>source.match(/\bselect (ok|is|throws_ok)\(/g).length;
  assert.equal(count(compiled),count(original));
  assert.match(compiled,/select plan\(77\)/);
  assert.match(compiled,/registered retirement keeps exactly three crop hooks disabled/);
  assert.match(compiled,/designationReceipt,same_run/);
  assert.match(compiled,/designationReceipt,app_value.*APP-ABRN/);
  assert.match(compiled,/designationReceipt,erp_value.*ABRN/);
  assert.equal(read(HISTORICAL_MASTER_STAGING_FIXTURE),original,'historical checkpoint bytes remain untouched');
  for(const changed of ['',original+'\n',original.replace('select plan(77)','select plan(76)')]) {
    assert.throws(()=>compileCanonicalMasterStagingFixture(changed,read),assert.AssertionError);
  }
  assert.throws(()=>compileCanonicalMasterStagingFixture(original,()=>''),assert.AssertionError);
  const missingAssertion=file=>read(file).replace(/select ok\([\s\S]*?\);/,'');
  assert.throws(()=>compileCanonicalMasterStagingFixture(original,missingAssertion),assert.AssertionError);
}
