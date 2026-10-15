// @test-group: node-unit
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
function fixture(iso) {
  let now = Date.parse(iso);
  const properties = new Map(); const timers = []; const calls = [];
  const DateClass = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const ctx = vm.createContext({ Date: DateClass, console,
    Utilities: { formatDate(date, zone, pattern) {
      const fields = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(date).map(p => [p.type, p.value]));
      if (pattern === 'yyyy-MM-dd') return `${fields.year}-${fields.month}-${fields.day}`;
      if (pattern === 'HH:mm:ss') return `${fields.hour}:${fields.minute}:${fields.second}`;
      if (pattern === 'Z') return fields.timeZoneName.replace('GMT', '').replace(':', '');
      throw new Error('Unexpected date format');
    } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties.get(k) || null, setProperty: (k,v) => properties.set(k,v), deleteProperty: k => properties.delete(k) }) },
    ScriptApp: { getProjectTriggers: () => timers.slice(), deleteTrigger: t => timers.splice(timers.indexOf(t),1),
      newTrigger: handler => { const t = { getHandlerFunction: () => handler, timeBased() { return this; }, at(date) { this.atTime = date.toISOString(); return this; }, create() { timers.push(this); return this; } }; return t; } }
  });
  vm.runInContext(source, ctx);
  ctx.readImportHistoryBackfillState_ = () => ({ status:'running', currentFileId:'checkpoint-file', failures:0 });
  ctx.LockService = { getUserLock: () => { calls.push('lock'); return { tryLock: () => true, releaseLock() {} }; } };
  return { ctx, timers, calls, properties, setNow: value => { now=Date.parse(value); } };
}

test('nightly window is exact in Central time, including both DST offsets', () => {
  for (const [iso, allowed] of [
    ['2026-10-16T04:29:59Z',false], ['2026-10-16T04:30:00Z',true], ['2026-10-16T11:14:59Z',true], ['2026-10-16T11:15:00Z',false],
    ['2026-12-16T05:29:59Z',false], ['2026-12-16T05:30:00Z',true], ['2026-12-16T12:15:00Z',false]
  ]) assert.equal(fixture(iso).ctx.importHistoryNightWindow_().allowed,allowed,iso);
});

test('daytime continuation performs no lock or data work and reschedules for 23:30', () => {
  const f=fixture('2026-10-15T21:00:00Z');
  assert.equal(f.ctx.runImportHistoryBackfillChunk_().schedulingStatus,'waiting-for-nightly-window');
  assert.deepEqual(f.calls,[]); assert.equal(f.timers.length,1);
  assert.equal(f.timers[0].atTime,'2026-10-16T04:30:00.000Z');
});

test('next start follows the Central DST change without a fixed UTC offset', () => {
  const spring=fixture('2026-03-08T06:30:00Z');
  assert.equal(spring.ctx.nextImportHistoryNightStart_().toISOString(),'2026-03-09T04:30:00.000Z');
  const fall=fixture('2026-11-01T05:30:00Z');
  assert.equal(fall.ctx.nextImportHistoryNightStart_().toISOString(),'2026-11-02T05:30:00.000Z');
});

test('cutoff reserves RPC time and preserves the partial-file cursor without counting a failure', () => {
  const f=fixture('2026-10-16T11:14:00Z');
  assert.equal(f.ctx.runImportHistoryBackfillChunk_().state.currentFileId,'checkpoint-file');
  assert.equal(f.timers[0].atTime,'2026-10-17T04:30:00.000Z');
  assert.throws(() => f.ctx.assertImportHistoryBackfillWindow_(500,1000), error => error.errorCode === 'IMPORT_HISTORY_CONTINUATION_PENDING' && error.stagedRows === 500);
  assert.deepEqual(f.calls,[]);
});

test('manual pause disarms only history continuation and prevents a watchdog from rearming it', () => {
  const f=fixture('2026-10-16T06:00:00Z');
  f.ctx.scheduleImportHistoryBackfill_(60000); assert.equal(f.timers.length,1);
  const live={getHandlerFunction:()=>'runAutoDropFolderSync_'}; f.timers.push(live);
  assert.equal(f.ctx.pauseImportHistoryBackfill().schedulingStatus,'paused');
  f.ctx.scheduleImportHistoryBackfill_(60000);
  assert.deepEqual(f.timers,[live]);
  assert.equal(f.ctx.runImportHistoryBackfillChunk_().schedulingStatus,'paused');
});

test('background history checks the window before begin, each staged RPC and publication, without gating live dual writes', () => {
  const body=source.slice(source.indexOf('function persistImportedFileHistory_('),source.indexOf('function listRoutedDropFiles_('));
  assert.match(body,/options && options.backgroundBackfill === true/);
  assert.match(body,/checkWindow\(0, snapshot.rowCount\);\s*const begun/);
  assert.match(body,/checkWindow\(start, snapshot.rowCount\);\s*const rows/);
  assert.match(body,/checkWindow\(snapshot.rowCount, snapshot.rowCount\);\s*const result/);
  assert.match(source,/persistImportedFileHistory_\(dataset, file, rawData, startedAt, identity, \{ backgroundBackfill: true \}\)/);
});
