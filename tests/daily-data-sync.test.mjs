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
    status() { return JSON.parse(propertyStore.getProperty('MANUAL_SYNC_STATUS')); },
  };
}

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

test('stage-level errors and non-source codes cannot be masked by source-coded file failures', () => {
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

    assert.throws(
      () => harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 }),
      /did not finish|failed/i,
      'an additional stage-level failure must stay fatal',
    );
    const status = harness.status();
    assert.deepEqual(calls, ['drive']);
    assert.deepEqual(status.stageResults.map(result => result.outcome), ['failed', 'skipped', 'skipped']);
    assert.equal(status.active, false);
    assert.equal(harness.events.some(event => event.table === 'manual_sync'), false);
  }
});

test('database and processor-lock failures stop the chain and mark every later stage skipped', () => {
  for (const failure of [
    { errorCode: 'IMPORT_DATABASE_XX000', message: 'Supabase upsert failed for ph_master_inventory (500): {"code":"XX000"}' },
    { errorCode: 'DATASET_IMPORT_LOCK_FAILED', message: 'DATASET_IMPORT_LOCK_FAILED' },
  ]) {
    const harness = createHarness();
    harness.setRunningStatus();
    const calls = [];
    harness.setStageRunner(stage => {
      calls.push(stage);
      if (stage === 'drive') throw new Error(failure.message);
      return { filesProcessed: 1, failedFiles: 0 };
    });

    assert.throws(
      () => harness.runStage({ executionBudgetMs: 60000, nextStageStartCutoffMs: 120000 }),
      /did not finish|failed/i,
      'fatal failures preserve the runner’s throw behavior',
    );
    const status = harness.status();
    assert.deepEqual(calls, ['drive']);
    assert.equal(status.active, false);
    assert.equal(status.currentStage, 'drive', 'fatal status preserves the stage that failed');
    assert.equal(status.errorCode, failure.errorCode);
    assert.deepEqual(status.stageResults.map(result => result.outcome), ['failed', 'skipped', 'skipped']);
    assert.deepEqual(status.stageResults.slice(1).map(result => result.reasonCode), [
      'MANUAL_SYNC_ABORTED_AFTER_FATAL_FAILURE',
      'MANUAL_SYNC_ABORTED_AFTER_FATAL_FAILURE',
    ]);
    assert.equal(harness.events.some(event => event.table === 'manual_sync'), false);
  }
});
