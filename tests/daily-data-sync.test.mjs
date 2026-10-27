// @test-group: node-unit
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

function createHarness() {
  const properties = new Map();
  const events = [];
  const triggers = [];
  let currentTime = Date.parse('2026-10-08T18:00:00.000Z');
  let locked = false;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
    static now() { return currentTime; }
  }
  const lock = {
    hasLock: () => locked,
    tryLock: () => { if (locked) return false; locked = true; return true; },
    waitLock: () => { locked = true; },
    releaseLock: () => { locked = false; },
  };
  const propertyStore = {
    getProperty: key => properties.get(String(key)) || null,
    setProperty: (key, value) => { properties.set(String(key), String(value)); },
    deleteProperty: key => { properties.delete(String(key)); },
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Date: FakeDate,
    PropertiesService: { getScriptProperties: () => propertyStore },
    LockService: { getScriptLock: () => lock },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger(trigger) { const index = triggers.indexOf(trigger); if (index >= 0) triggers.splice(index, 1); },
      newTrigger(handler) {
        const trigger = { getHandlerFunction: () => handler, handler };
        return { timeBased: () => ({ after: milliseconds => ({ create: () => { trigger.after = milliseconds; triggers.push(trigger); } }) }) };
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => Array.from(createHash(algorithm).update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      getUuid: () => '12345678-1234-1234-1234-123456789012',
    },
    __events: events,
    __triggers: triggers,
    __runStage: () => ({}),
    __advanceClock: milliseconds => { currentTime += milliseconds; },
  });
  new vm.Script(source, { filename: 'Code.gs' }).runInContext(context);
  vm.runInContext(`
    MANUAL_SYNC_STAGE_DEFINITIONS.drive.run = () => __runStage('drive');
    MANUAL_SYNC_STAGE_DEFINITIONS.soc.run = () => __runStage('soc');
    MANUAL_SYNC_STAGE_DEFINITIONS.reserves.run = () => __runStage('reserves');
    emitAppLiveEvent_ = (area, eventType, table) => { __events.push({ area, eventType, table }); return true; };
  `, context);

  function setRunningStatus(stageOrder = ['drive', 'soc', 'reserves']) {
    const now = new FakeDate().toISOString();
    propertyStore.setProperty('MANUAL_SYNC_STATUS', JSON.stringify({
      active: true, runId: 'daily-run-1', job: 'all', source: 'test', requestedBy: 'tester',
      stageOrder, stageIndex: 0, currentStage: 'queued', currentStageLabel: 'Queued',
      completedStages: [], stageResults: [], startedAt: now, updatedAt: now, finishedAt: '',
      message: 'Queued test sync.', error: '', errorCode: '',
    }));
  }

  function runStage(options = {}) {
    context.__options = options;
    return vm.runInContext('runQueuedManualSyncStage_(__options)', context);
  }

  return {
    context, events, properties, triggers, setRunningStatus, runStage,
    setStageRunner(fn) { context.__runStage = fn; },
    setLockBusy(value) { locked = !!value; },
    setProperty(key, value) { propertyStore.setProperty(key, value); },
    status() { return JSON.parse(propertyStore.getProperty('MANUAL_SYNC_STATUS')); },
  };
}

test('a lock collision defers without enqueueing a request or mutating the active worker', () => {
  const harness = createHarness();
  harness.setLockBusy(true);
  const deferred = vm.runInContext("queueManualSyncRequest_({ job: 'soc', source: 'test', requestedBy: 'tester' })", harness.context);
  assert.equal(deferred.code, 'MANUAL_SYNC_PROCESSOR_BUSY');
  assert.equal(deferred.status, 'deferred');
  assert.equal(harness.triggers.filter(trigger => trigger.handler === 'runQueuedManualSyncStage_').length, 0, 'busy responses do not enqueue or mutate triggers outside the lock');
  assert.equal(harness.properties.has('MANUAL_SYNC_DEFERRED_REQUEST_V1'), false);
  harness.setLockBusy(false);
  const calls = [];
  harness.setStageRunner(stage => { calls.push(stage); return { filesProcessed: 1, failedFiles: 0 }; });
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  assert.deepEqual(calls, []);
  assert.equal(harness.properties.has('MANUAL_SYNC_STATUS'), false, 'the caller must retry because this response did not enqueue work');
});

test('automatic sync defers while a worker is active and skips maintenance work', () => {
  const harness = createHarness();
  harness.setRunningStatus(['soc']);
  let maintenanceCalls = 0;
  harness.context.scheduleSocOrderHistoryTrigger_ = () => { maintenanceCalls++; };
  harness.context.runRequestIntegrityScheduledWorker_ = () => { maintenanceCalls++; };
  const result = vm.runInContext('runAutoDropFolderSync_()', harness.context);
  assert.equal(result.code, 'MANUAL_SYNC_PROCESSOR_BUSY');
  assert.equal(result.status, 'deferred');
  assert.equal(maintenanceCalls, 0);
  assert.equal(harness.triggers.filter(trigger => trigger.handler === 'runQueuedManualSyncStage_').length, 1, 'the lock-protected active-worker check ensures one continuation');
  vm.runInContext('runAutoDropFolderSync_()', harness.context);
  assert.equal(harness.triggers.length, 1, 'repeated automatic invocations do not duplicate the continuation');
});

test('continuation recovery removes duplicate pending triggers and excludes the executing trigger', () => {
  const harness = createHarness();
  harness.setRunningStatus(['soc']);
  const trigger = id => ({ handler: 'runQueuedManualSyncStage_', getHandlerFunction: () => 'runQueuedManualSyncStage_', getUniqueId: () => id });
  harness.triggers.push(trigger('executing'), trigger('pending-1'), trigger('pending-2'));
  harness.context.__event = { triggerUid: 'executing' };
  vm.runInContext('runAutoDropFolderSync_(__event)', harness.context);
  assert.deepEqual(harness.triggers.map(item => item.getUniqueId()), ['executing', 'pending-1']);
});

test('a stale SOC worker resumes only when its persisted extraction source matches the stage', () => {
  const harness = createHarness();
  harness.setRunningStatus(['soc']);
  const staleAt = new Date(Date.parse('2026-10-08T18:00:00.000Z') - 13 * 60 * 1000).toISOString();
  const status = harness.status();
  status.currentStage = 'soc';
  status.currentStageLabel = 'SOC';
  status.updatedAt = staleAt;
  harness.setProperty('MANUAL_SYNC_STATUS', JSON.stringify(status));
  harness.setProperty('IMPORT_EXTRACTION_CHECKPOINT_V1', JSON.stringify({
    tableName: 'ph_soc_master', fileId: 'source-1', fileName: 'SOC.xlsx',
    modifiedAt: '2026-10-13T07:00:00.000Z', size: 1234, tempSheetId: 'converted-1',
    phase: 'reading', rowsRead: 500, updatedAt: staleAt,
    runId: 'daily-run-1', stage: 'soc', attempt: 1,
  }));
  const calls = [];
  harness.setStageRunner(stage => { calls.push(stage); return { filesProcessed: 1, failedFiles: 0 }; });
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  assert.deepEqual(calls, ['soc']);
  assert.equal(harness.status().currentStage, 'complete');
  assert.equal(harness.status().recoveryCount, 1);
});

test('an abandoned uncheckpointed stage is recorded failed and independent later stages still run', () => {
  const harness = createHarness();
  harness.setRunningStatus(['drive', 'soc', 'reserves']);
  const status = harness.status();
  status.currentStage = 'drive';
  status.currentStageLabel = 'Drive Around';
  status.stageStartedStage = 'drive';
  status.stageStartedAt = new Date(Date.parse('2026-10-08T18:00:00.000Z') - 5 * 60 * 1000).toISOString();
  status.updatedAt = status.stageStartedAt;
  harness.setProperty('MANUAL_SYNC_STATUS', JSON.stringify(status));
  const calls = [];
  harness.setStageRunner(stage => { calls.push(stage); return { filesProcessed: 1, failedFiles: 0 }; });

  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });

  const finalStatus = harness.status();
  assert.deepEqual(calls, ['soc', 'reserves']);
  assert.equal(finalStatus.active, false);
  assert.equal(finalStatus.currentStage, 'failed');
  assert.equal(finalStatus.stageFailureCount, 1);
  assert.equal(finalStatus.stageResults[0].key, 'drive');
  assert.equal(finalStatus.stageResults[0].errorCode, 'MANUAL_SYNC_STAGE_ABANDONED');
  assert.deepEqual(finalStatus.completedStages, ['soc', 'reserves']);
  assert.equal(finalStatus.errorCode, 'MANUAL_SYNC_STAGE_FAILURES');
});

test('exhausted checkpoint recovery advances without clearing the saved extraction cursor', () => {
  const harness = createHarness();
  harness.setRunningStatus(['soc', 'reserves']);
  const staleAt = new Date(Date.parse('2026-10-08T18:00:00.000Z') - 5 * 60 * 1000).toISOString();
  const status = harness.status();
  status.currentStage = 'soc';
  status.currentStageLabel = 'SOC';
  status.stageStartedStage = 'soc';
  status.stageRecoveryCount = 1;
  status.updatedAt = staleAt;
  harness.setProperty('MANUAL_SYNC_STATUS', JSON.stringify(status));
  const checkpoint = {
    tableName: 'ph_soc_master', fileId: 'source-1', fileName: 'SOC.xlsx',
    modifiedAt: '2026-10-13T07:00:00.000Z', size: 1234, tempSheetId: 'converted-1',
    phase: 'reading', rowsRead: 500, updatedAt: staleAt, runId: 'daily-run-1', stage: 'soc', attempt: 1,
  };
  harness.setProperty('IMPORT_EXTRACTION_CHECKPOINT_V1', JSON.stringify(checkpoint));
  const calls = [];
  harness.setStageRunner(stage => { calls.push(stage); return { filesProcessed: 1, failedFiles: 0 }; });

  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });

  const finalStatus = harness.status();
  assert.deepEqual(calls, ['reserves']);
  assert.equal(finalStatus.stageResults[0].errorCode, 'MANUAL_SYNC_CHECKPOINT_RECOVERY_EXHAUSTED');
  assert.equal(finalStatus.currentStage, 'failed');
  assert.equal(harness.properties.get('IMPORT_EXTRACTION_CHECKPOINT_V1'), JSON.stringify(checkpoint));
});

test('status reads report a stale view without deactivating or clearing an active run', () => {
  const harness = createHarness();
  harness.setRunningStatus(['drive', 'soc']);
  const status = harness.status();
  status.currentStage = 'drive';
  status.updatedAt = new Date(Date.parse('2026-10-08T18:00:00.000Z') - 13 * 60 * 1000).toISOString();
  harness.setProperty('MANUAL_SYNC_STATUS', JSON.stringify(status));

  const view = vm.runInContext('getManualSyncStatusForClient_()', harness.context);

  assert.equal(view.stale, true);
  assert.equal(view.active, true);
  assert.equal(harness.status().active, true);
  assert.equal(harness.triggers.length, 0);
});

test('a preparation deferral schedules the same stage without advancing the cursor', () => {
  const harness = createHarness();
  harness.setRunningStatus(['soc', 'reserves']);
  const runId = harness.status().runId;
  let attempts = 0;
  harness.setStageRunner(stage => {
    attempts++;
    if (attempts === 1) {
      const deferred = new Error('IMPORT_PREPARATION_DEFERRED');
      deferred.errorCode = 'IMPORT_PREPARATION_DEFERRED';
      deferred.phase = 'reading';
      throw deferred;
    }
    return { filesProcessed: 1, failedFiles: 0 };
  });
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  let status = harness.status();
  assert.equal(status.active, true);
  assert.equal(status.stageIndex, 0);
  assert.equal(status.runId, runId);
  assert.equal(status.preparationRetryCount, 1);
  assert.match(status.message, /retry 1\/3 is queued/);
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  status = harness.status();
  assert.equal(status.stageIndex, 2);
  assert.equal(status.active, false);
  assert.deepEqual(status.completedStages, ['soc', 'reserves']);
});

test('the five-stage RUN SCRIPT pass attempts a preparation failure once and never loops the stage', () => {
  const harness = createHarness();
  const order = ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'];
  harness.setRunningStatus(order);
  const calls = [];
  vm.runInContext("MANUAL_SYNC_STAGE_DEFINITIONS.cav.run = () => { __calls.push('cav'); return { filesProcessed: 0, failedFiles: 0 }; }; MANUAL_SYNC_STAGE_DEFINITIONS.hl_po_parsed.run = () => { __calls.push('hl_po_parsed'); return { filesProcessed: 0, failedFiles: 0 }; };", Object.assign(harness.context, { __calls: calls }));
  harness.setStageRunner(stage => {
    calls.push(stage);
    if (stage === 'drive') {
      const deferred = new Error('IMPORT_PREPARATION_DEFERRED');
      deferred.errorCode = 'IMPORT_PREPARATION_DEFERRED';
      deferred.phase = 'reading';
      throw deferred;
    }
    return { filesProcessed: 0, failedFiles: 0 };
  });
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  const status = harness.status();
  assert.deepEqual(calls, order, 'every ordered stage is called once, including after an earlier stage failure');
  assert.equal(status.active, false);
  assert.equal(status.currentStage, 'failed');
  assert.equal(status.stageResults[0].errorCode, 'MANUAL_SYNC_STAGE_FAILED', 'the bounded worker status keeps only its safe generic error code');
  assert.equal(harness.triggers.filter(trigger => trigger.handler === 'runQueuedManualSyncStage_').length, 0,
    'a deferred stage does not schedule an automatic same-stage retry');
});

test('queue responses expose the persisted run id after queue-status construction', () => {
  const harness = createHarness();
  const response = vm.runInContext("queueManualSyncRequest_({ job: 'soc', source: 'test', requestedBy: 'tester' })", harness.context);
  assert.equal(response.status, 'queued');
  assert.equal(response.runId, harness.status().runId);
  assert.ok(response.runId);
});

const sourceFailure = (name = 'bad-drive.csv', errorCode = 'IMPORT_SOURCE_NO_HEADER') => ({
  tableName: 'ph_master_inventory', filesProcessed: 0, failedFiles: 1,
  failedFileNames: [name], failedFileErrors: [{ name, errorCode }],
});

test('a classified Drive source failure continues into SOC and Reserves without a false completion event', () => {
  const harness = createHarness();
  harness.setRunningStatus();
  const calls = [];
  harness.setStageRunner(stage => {
    calls.push(stage);
    if (stage === 'drive') return sourceFailure();
    return { filesProcessed: 1, failedFiles: 0, failedFileNames: [], upsertCount: 1, deleteCount: 0 };
  });

  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  const status = harness.status();
  assert.deepEqual(calls, ['drive', 'soc', 'reserves']);
  assert.equal(status.active, false);
  assert.equal(status.currentStage, 'failed', 'a partial import is not reported as complete');
  assert.equal(status.errorCode, 'MANUAL_SYNC_SOURCE_FAILURES');
  assert.deepEqual(status.completedStages, ['soc', 'reserves']);
  assert.deepEqual(status.stageResults.map(result => result.outcome), ['failed', 'succeeded', 'succeeded']);
  assert.equal(harness.events.some(event => event.table === 'manual_sync'), false, 'no complete event is emitted');
});

test('a partial Drive result is checkpointed and SOC/Reserves resume on the next invocation', () => {
  const harness = createHarness();
  harness.setRunningStatus();
  const calls = [];
  harness.setStageRunner(stage => {
    calls.push(stage);
    if (stage === 'drive') {
      harness.context.__advanceClock(1201);
      return sourceFailure();
    }
    return { filesProcessed: 1, failedFiles: 0, failedFileNames: [], upsertCount: 1, deleteCount: 0 };
  });

  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 1000 });
  let status = harness.status();
  assert.equal(status.active, true);
  assert.equal(status.stageIndex, 1, 'the next stage is checkpointed for another invocation');
  assert.equal(status.stageResults[0].outcome, 'failed');
  assert.equal(status.stageResults[0].failedFileErrors[0].errorCode, 'IMPORT_SOURCE_NO_HEADER');
  assert.ok(harness.triggers.length > 0, 'continuation trigger is scheduled');
  assert.deepEqual(calls, ['drive']);

  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  status = harness.status();
  assert.deepEqual(calls, ['drive', 'soc', 'reserves']);
  assert.equal(status.currentStage, 'failed', 'the remembered source failure remains terminal');
  assert.equal(status.errorCode, 'MANUAL_SYNC_SOURCE_FAILURES');
  assert.equal(harness.events.some(event => event.table === 'manual_sync'), false);
});

test('a bounded Customer Rep Map continuation retains the same manual-sync stage until publication completes', () => {
  const harness = createHarness();
  harness.setRunningStatus(['customer_rep_map', 'soc']);
  vm.runInContext("MANUAL_SYNC_STAGE_DEFINITIONS.customer_rep_map.run = () => __runStage('customer_rep_map')", harness.context);
  harness.setStageRunner(stage => stage === 'customer_rep_map'
    ? { continuationPending: true, stagedRows: 300, totalRows: 301 }
    : { filesProcessed: 1, failedFiles: 0 });
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  const waiting = harness.status();
  assert.equal(waiting.active, true);
  assert.equal(waiting.stageIndex, 0);
  assert.equal(waiting.currentStage, 'customer_rep_map');
  assert.match(waiting.message, /Staged 300 of 301 Customer Rep Map rows/);
  assert.equal(waiting.stageResults.length, 0, 'a partial stage is not recorded as completed');
  assert.equal(harness.triggers.filter(trigger => trigger.handler === 'runQueuedManualSyncStage_').length, 1);

  harness.setStageRunner(stage => ({ filesProcessed: 1, failedFiles: 0 }));
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  const complete = harness.status();
  assert.equal(complete.active, false);
  assert.equal(complete.currentStage, 'complete');
  assert.deepEqual(complete.completedStages, ['customer_rep_map', 'soc']);
  assert.deepEqual(complete.stageResults.map(result => result.key), ['customer_rep_map', 'soc']);
});

test('single-pass continuation allows forward staged progress and stops after one no-progress retry', () => {
  const harness = createHarness();
  const order = ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'];
  harness.setRunningStatus(order);
  vm.runInContext("MANUAL_SYNC_STAGE_DEFINITIONS.cav.run = () => __runStage('cav'); MANUAL_SYNC_STAGE_DEFINITIONS.hl_po_parsed.run = () => __runStage('hl_po_parsed');", harness.context);
  const calls = [];
  harness.setStageRunner(stage => {
    calls.push(stage);
    if (stage === 'drive') return { continuationPending: true, stagedRows: calls.filter(value => value === 'drive').length < 2 ? 30 : 60, totalRows: 90 };
    return { filesProcessed: 0, failedFiles: 0 };
  });
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  assert.equal(harness.status().active, true, 'forward staged work is eligible for bounded continuation');
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  assert.equal(harness.status().active, true, 'increased staged rows remain eligible for continuation');
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  assert.equal(harness.status().active, true, 'one no-progress continuation is tolerated');
  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  const status = harness.status();
  assert.equal(status.active, false);
  assert.equal(status.currentStage, 'failed');
  assert.equal(status.stageResults[0].errorCode, 'MANUAL_SYNC_STAGE_CONTINUATION_REQUIRED');
  assert.equal(calls.filter(stage => stage === 'drive').length, 4);
  assert.equal(harness.triggers.filter(trigger => trigger.handler === 'runQueuedManualSyncStage_').length, 0);
});

test('a Drive stage with successful files and a classified rejected file is partial', () => {
  const harness = createHarness();
  harness.setRunningStatus();
  const calls = [];
  harness.setStageRunner(stage => {
    calls.push(stage);
    if (stage === 'drive') return {
      ...sourceFailure(),
      filesProcessed: 2,
      failedFiles: 1,
    };
    return { filesProcessed: 1, failedFiles: 0, failedFileNames: [], upsertCount: 1, deleteCount: 0 };
  });

  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  const status = harness.status();
  assert.deepEqual(calls, ['drive', 'soc', 'reserves']);
  assert.equal(status.stageResults[0].filesProcessed, 2);
  assert.equal(status.stageResults[0].outcome, 'partial');
  assert.deepEqual(status.completedStages, ['soc', 'reserves']);
  assert.equal(status.currentStage, 'failed');
  assert.equal(status.errorCode, 'MANUAL_SYNC_SOURCE_FAILURES');
  assert.equal(harness.events.some(event => event.table === 'manual_sync'), false);
});

test('stage-level errors remain visible while independent later stages continue', () => {
  const cases = [
    { error: 'unexpected stage-level infrastructure failure' },
    { errorCode: 'IMPORT_DATABASE_XX000' },
  ];
  for (const failure of cases) {
    const harness = createHarness();
    harness.setRunningStatus();
    const calls = [];
    harness.setStageRunner(stage => {
      calls.push(stage);
      if (stage === 'drive') return {
        ...sourceFailure(),
        ...failure,
        fatalFailure: false,
      };
      return { filesProcessed: 1, failedFiles: 0 };
    });

    harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
    const status = harness.status();
    assert.deepEqual(calls, ['drive', 'soc', 'reserves']);
    assert.deepEqual(status.stageResults.map(result => result.outcome), ['failed', 'succeeded', 'succeeded']);
    assert.equal(status.active, false);
    assert.equal(status.stageIndex, 3);
    assert.equal(status.stageFailureCount, 1);
    assert.equal(status.currentStage, 'failed');
    assert.equal(status.errorCode, 'MANUAL_SYNC_STAGE_FAILURES');
    assert.equal(harness.events.some(event => event.table === 'manual_sync'), false);
  }
});

test('an uncertain database stage is recorded without retry while later stages proceed', () => {
  const harness = createHarness();
  harness.setRunningStatus();
  const calls = [];
  harness.setStageRunner(stage => {
    calls.push(stage);
    if (stage === 'drive') throw new Error('Supabase upsert failed for ph_master_inventory (500): {"code":"XX000"}');
    return { filesProcessed: 1, failedFiles: 0 };
  });

  harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 });
  const status = harness.status();
  assert.deepEqual(calls, ['drive', 'soc', 'reserves']);
  assert.equal(status.active, false);
  assert.equal(status.currentStage, 'failed');
  assert.equal(status.errorCode, 'MANUAL_SYNC_STAGE_FAILURES');
  assert.equal(status.stageResults[0].errorCode, 'IMPORT_DATABASE_XX000');
  assert.deepEqual(status.stageResults.map(result => result.outcome), ['failed', 'succeeded', 'succeeded']);
  assert.deepEqual(status.completedStages, ['soc', 'reserves']);
  assert.equal(harness.events.some(event => event.table === 'manual_sync'), false);
});

test('processor-lock failure remains fatal and preserves later stages as skipped', () => {
  const harness = createHarness();
  harness.setRunningStatus();
  const calls = [];
  harness.setStageRunner(stage => {
    calls.push(stage);
    if (stage === 'drive') throw new Error('DATASET_IMPORT_LOCK_FAILED');
    return { filesProcessed: 1, failedFiles: 0 };
  });

  assert.throws(
    () => harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 }),
    /did not finish|failed/i,
  );
  const status = harness.status();
  assert.deepEqual(calls, ['drive']);
  assert.equal(status.active, false);
  assert.equal(status.currentStage, 'drive');
  assert.equal(status.errorCode, 'DATASET_IMPORT_LOCK_FAILED');
  assert.deepEqual(status.stageResults.map(result => result.outcome), ['failed', 'skipped', 'skipped']);
  assert.equal(harness.events.some(event => event.table === 'manual_sync'), false);
});
