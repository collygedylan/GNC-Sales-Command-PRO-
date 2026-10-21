import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';
import { codexOpsCapabilitiesFixtureResponse } from './fixtures/hl-order-state.mjs';
import { waitForInitialHomeCohort, waitForVerifiedLiveCohort } from './helpers/initial-home-cohort.mjs';
import { isMasterBrowseInventoryReadBody } from './helpers/reclass-browse-request-tracker.mjs';
import { startReclassCdpTimeline, summarizeReclassCdpTrace } from './helpers/reclass-cdp-timeline.mjs';
import { captureReclassFailureDiagnostics, installReclassFailureDiagnostics } from './helpers/reclass-failure-diagnostics.mjs';
import { installReclassStageTiming } from './helpers/reclass-stage-timing.mjs';

const html = readComposedAppSource();
const spec = readFileSync(new URL('./reclass-splits.e2e.spec.ts', import.meta.url), 'utf8');
const fixtureSource = readFileSync(new URL('./fixtures/hl-order-state.mjs', import.meta.url), 'utf8');
const driveLayoutSource = readFileSync(new URL('./fixtures/drive-card-layout.ts', import.meta.url), 'utf8');

test('fixture serves only the authenticated read-only Codex capabilities request', () => {
  const token = 'synthetic-fixture-token';
  const request = { method: 'POST', pathname: '/functions/v1/codex-ops-api', body: { action: 'capabilities' },
    authorization: `Bearer ${token}`, token };
  assert.deepEqual(codexOpsCapabilitiesFixtureResponse(request), { canView: false, submissionEnabled: false });
  for (const changes of [
    { method: 'GET' },
    { pathname: '/functions/v1/app-api' },
    { authorization: 'Bearer other-token' },
    { body: { action: 'list' } },
    { body: { action: 'capabilities', taskId: 'unexpected' } },
    { body: ['capabilities'] },
  ]) assert.equal(codexOpsCapabilitiesFixtureResponse({ ...request, ...changes }), null);
  assert.match(fixtureSource, /url\.pathname === '\/functions\/v1\/codex-ops-api'/);
  assert.match(fixtureSource, /codexOpsCapabilitiesFixtureResponse\(\{/);
  assert.match(fixtureSource, /control\.blockedMutations\.push\(`CODEX_OPS/);
});

test('browse quiescence tracker recognizes nested production master-page params only', () => {
  const productionBrowse = { action: 'inventory_read', operation: 'master_page',
    params: { dataset: 'master', projection: 'browse', limit: 500, offset: 500 } };
  assert.equal(isMasterBrowseInventoryReadBody(productionBrowse), true);
  assert.equal(isMasterBrowseInventoryReadBody({ ...productionBrowse, params: { ...productionBrowse.params, projection: 'full' } }), false);
  assert.equal(isMasterBrowseInventoryReadBody({ ...productionBrowse, operation: 'item_lookup' }), false);
  assert.equal(isMasterBrowseInventoryReadBody({ ...productionBrowse, params: { ...productionBrowse.params, dataset: 'request' } }), false);
  assert.equal(isMasterBrowseInventoryReadBody({ action: 'inventory_read', operation: 'master_page', dataset: 'master', projection: 'browse' }), false,
    'flat or partial payloads cannot manufacture browse quiescence');
  assert.equal(isMasterBrowseInventoryReadBody(null), false);
});

test('Reclass modal preserves its dim overlay without an expensive backdrop filter', () => {
  const start = html.indexOf('function ensureArgosInventoryTransactionModal()');
  const end = html.indexOf('function renderArgosInventoryTransactionSource', start);
  assert.ok(start >= 0 && end > start, 'the dynamic Reclass modal constructor is present');
  const constructor = html.slice(start, end);
  assert.match(constructor, /bg-slate-950\/55/);
  assert.doesNotMatch(constructor, /backdrop-blur/);
});

test('Apply stage timing observes calls without changing sync values, throws, or Promise identity', async () => {
  let clickListener = null;
  let tick = 0;
  class ElementFixture {
    closest(selector) { return selector === '#argos-inventory-transaction-apply' ? this : null; }
  }
  const syncValue = { saved: true };
  const syncError = new Error('sync failure');
  const asyncError = new Error('async failure');
  const syncOk = () => { tick += 2; return syncValue; };
  const syncFail = () => { tick += 3; throw syncError; };
  const promiseValue = Promise.resolve('done');
  const promiseFail = Promise.reject(asyncError);
  const target = {
    Element: ElementFixture,
    document: { addEventListener(_type, listener) { clickListener = listener; }, removeEventListener(_type, listener) { if (clickListener === listener) clickListener = null; } },
    performance: { marks: [], mark(name) { this.marks.push(name); }, getEntriesByType() { return []; } },
    syncOk, syncFail, promiseOk: () => promiseValue, promiseFail: () => promiseFail,
  };
  const originalFunctions = Object.fromEntries(['syncOk', 'syncFail', 'promiseOk', 'promiseFail'].map(name => [name, target[name]]));
  const timing = installReclassStageTiming(target, Object.keys(originalFunctions), () => tick++);
  clickListener({ target: new ElementFixture() });
  assert.equal(target.performance.marks[0], 'reclass-610-apply-captured');
  assert.equal(target.syncOk(), syncValue);
  assert.throws(() => target.syncFail(), error => error === syncError);
  assert.equal(target.promiseOk(), promiseValue, 'the original Promise identity is returned');
  assert.equal(target.promiseFail(), promiseFail, 'a rejected Promise identity is returned');
  await promiseValue;
  await assert.rejects(promiseFail, error => error === asyncError);
  await Promise.resolve();
  assert.deepEqual(timing.getSnapshot().records.filter(record => record.type === 'function').map(record => [record.name, record.phase, record.outcome]), [
    ['syncOk', 'sync', 'return'], ['syncFail', 'sync', 'throw'], ['promiseOk', 'sync', 'return'], ['promiseFail', 'sync', 'return'],
    ['promiseOk', 'settlement', 'resolve'], ['promiseFail', 'settlement', 'reject'],
  ]);
  timing.restore();
  for (const [name, original] of Object.entries(originalFunctions)) assert.equal(target[name], original);
  assert.equal(clickListener, null);
});

test('stage timing captures a non-Apply phase with the same synchronous return semantics', () => {
  let clickListener = null;
  let tick = 10;
  class ElementFixture {
    closest(selector) { return selector === '.reclass-open-trigger' ? this : null; }
  }
  const returned = { opened: true };
  const target = {
    Element: ElementFixture,
    document: { addEventListener(_type, listener) { clickListener = listener; }, removeEventListener(_type, listener) { if (clickListener === listener) clickListener = null; } },
    performance: { marks: [], mark(name) { this.marks.push(name); }, getEntriesByType() { return []; } },
    openStep() { return returned; },
  };
  const original = target.openStep;
  const timing = installReclassStageTiming(target, ['openStep'], () => tick++, {
    selector: '.reclass-open-trigger', markName: 'reclass-610-open-captured', label: 'Open',
  });
  clickListener({ target: new ElementFixture() });
  assert.deepEqual(target.performance.marks, ['reclass-610-open-captured']);
  assert.equal(target.openStep(), returned);
  const snapshot = timing.getSnapshot();
  assert.equal(snapshot.captureLabel, 'Open');
  assert.equal(snapshot.capturedAt, 10);
  assert.deepEqual(snapshot.records.map(record => [record.name, record.type, record.outcome]), [['openStep', 'function', 'return']]);
  assert.equal('sinceApplyMs' in snapshot.records[0], false);
  timing.restore();
  assert.equal(target.openStep, original);
});

test('optional Chromium timeline summarizes rendering work relative to Apply without exposing event args', async () => {
  assert.equal(await startReclassCdpTimeline({}, {}), null, 'timeline remains disabled without explicit opt-in');
  const summary = summarizeReclassCdpTrace([
    { name: 'Layout', ts: 900, dur: 99_000 },
    { name: 'UserTiming', ph: 'R', ts: 1_000, args: { data: { name: 'reclass-610-apply-captured' } } },
    { name: 'EventDispatch', ph: 'X', ts: 1_500, dur: 20_000, args: { data: { type: 'click', token: 'must-not-escape' } } },
    { name: 'UpdateLayoutTree', ph: 'X', ts: 25_000, dur: 35_000 },
    { name: 'Paint', ph: 'X', ts: 61_000, dur: 11_000 },
  ]);
  assert.equal(summary.applyMarkFound, true);
  assert.deepEqual(summary.longestSignificantEvents.map(event => [event.name, event.sinceApplyMs, event.durationMs]), [
    ['UpdateLayoutTree', 24, 35], ['EventDispatch', 0.5, 20], ['Paint', 60, 11],
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /must-not-escape/);
  assert.match(spec, /startReclassCdpTimeline\(page\)/);
  assert.match(spec, /GNC_RECLASS_TIMELINE=1/);
  assert.match(spec, /await attachCdpTimeline\(\);/);
});

test('setup diagnostics keep the original failure when the page context is gone', async () => {
  const originalError = Object.assign(new Error('initial Home cohort timed out'), { code: 'INITIAL_HOME_COHORT_TIMEOUT' });
  const captureError = new ReferenceError('getProductionLiveSyncCoordinator is unavailable after navigation');
  const captured = await captureReclassFailureDiagnostics(originalError, async () => { throw captureError; }, {
    pageUrl: 'http://127.0.0.1:43136/?shellv=AgData%20v2.0.0', pageClosed: false,
  });
  assert.match(captured.loadError, /initial Home cohort timed out/);
  assert.match(captured.diagnosticCaptureError, /ReferenceError: getProductionLiveSyncCoordinator is unavailable/);
  assert.deepEqual(captured.diagnostics, { pageUrl: 'http://127.0.0.1:43136/?shellv=AgData%20v2.0.0', pageClosed: false });
  assert.match(spec, /diagnostics\.shellDiagnostics = control\.shellDiagnostics/);
  assert.match(spec, /shellDiagnostics: control\.shellDiagnostics/);
  assert.match(fixtureSource, /message\.args\(\)\[1\]/);
  assert.match(fixtureSource, /control\.shellDiagnostics\.push\(payload\)/);
});

test('large verified inventory fixture preserves its production snapshot while mounting one card', () => {
  const verifiedMountStart = driveLayoutSource.indexOf('export async function renderVerifiedDriveLayoutCard');
  const verifiedMountEnd = driveLayoutSource.indexOf('export async function installDriveCardLayoutFixture', verifiedMountStart);
  const verifiedMount = driveLayoutSource.slice(verifiedMountStart, verifiedMountEnd);
  assert.match(verifiedMount, /const rows = fullInventory/);
  assert.match(verifiedMount, /rows.length !== bridge.expectedRows/);
  assert.match(verifiedMount, /new Set\(ids\)\.size !== bridge.expectedRows/);
  assert.match(verifiedMount, /countUniqueCacheCommonNames\(rows\) < 1200/);
  assert.match(verifiedMount, /rows\.every\(row => requiredFields\.every/);
  assert.ok(verifiedMount.includes("state.rowCompleteness !== 'complete' || state.fieldCoverage !== 'full'"));
  assert.match(verifiedMount, /context.scope !== bridge.snapshot.scope/);
  assert.match(verifiedMount, /context.dataPermissionVersion !== bridge.snapshot.permission/);
  assert.ok(verifiedMount.includes('isConfirmedInventoryReadRevisionCurrent(bridge.snapshot.revision)'));
  assert.ok(verifiedMount.includes("host.innerHTML = generateCard(source, 'drive'"));
  assert.doesNotMatch(verifiedMount, /switchView\(|fullInventory\s*=|fieldCoverage\s*=/);
  assert.doesNotMatch(spec, /JSON\.stringify\(retainedRows\)|formatFetchedRows\(retainedRows/);
  assert.match(spec, /commonname: `Synthetic volume row \$\{index\}`/);
  assert.match(spec, /root\.__reclassVerifiedSnapshot = snapshot/);
  assert.match(spec, /const snapshot = window\.__reclassVerifiedSnapshot/);
  assert.match(spec, /finally\s*\{\s*delete root\.__reclassVerifiedSnapshot;/);
  assert.match(spec, /String\(master\.liveVerifiedRevision \|\| ''\) !== snapshot\.revision/);
  assert.match(spec, /if \(action !== 'inventory_reclass_move' && status < 400\)/);
  assert.match(spec, /bodyCaptured: false, contentLength/);
  assert.match(spec, /const read = response\.text\(\)/);
});

test('full 10k fixture satisfies the production common-name partial-snapshot guard', () => {
  const getFunction = name => {
    const marker = `function ${name}(`;
    const start = html.indexOf(marker);
    assert.notEqual(start, -1, `${name} exists in production source`);
    const open = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = open; index < html.length; index++) {
      if (html[index] === '{') depth++;
      else if (html[index] === '}' && --depth === 0) return html.slice(start, index + 1);
    }
    throw new Error(`Unclosed production function ${name}`);
  };
  const context = {
    MIN_TRUSTED_MASTER_COMMON_NAME_CACHE_COUNT: 1200,
    shouldScopeMasterInventoryToCurrentEval: () => false,
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
  };
  vm.createContext(context);
  vm.runInContext(`${getFunction('countUniqueCacheCommonNames')}\n${getFunction('masterRowsLookPartialForCurrentScope')}`, context);

  const oldRows = Array.from({ length: 10_000 }, (_, index) => ({ commonname: index ? 'Synthetic volume row' : 'Synthetic Drive Card' }));
  const correctedRows = Array.from({ length: 10_000 }, (_, index) => ({ commonname: `Synthetic volume row ${index}` }));
  assert.equal(context.masterRowsLookPartialForCurrentScope(oldRows), true,
    'repeated common names cannot claim the verified broad-scope full inventory cache');
  assert.equal(context.masterRowsLookPartialForCurrentScope(correctedRows), false,
    'unique representative names satisfy the production threshold');

  const physicalRow = inventoryReadFixture.fromFixtureShape({ unique_id: 'fixture-source', itemcode: 'FIXTURE.001', commonname: 'Synthetic Drive Card' });
  assert.equal(Object.keys(physicalRow).length, inventoryReadFixture.physicalColumns.length,
    'the warm fixture still contains every physical inventory column');
});

test('production formatter elides null physical fields while retaining required formatted fields', () => {
  const marker = 'function formatFetchedRows(items, sourceTable) {';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'formatFetchedRows exists in production source');
  let depth = 0;
  let end = -1;
  for (let index = html.indexOf('{', start); index < html.length; index++) {
    if (html[index] === '{') depth++;
    else if (html[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  assert.notEqual(end, -1, 'formatFetchedRows has a complete body');

  const context = {
    redactEvalSensitiveData: value => value,
    normalizeAppTableName: value => String(value || '').trim().toLowerCase(),
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
    parseAppNumber: value => value == null || value === '' ? null : Number(value),
    repairDisplayFieldsOnRow: () => {},
    normalizeRowPhotoFields: () => {},
    preserveConfirmedDriveEvidence: row => row,
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const raw = inventoryReadFixture.fromFixtureShape({ unique_id: 'fixture-source', itemcode: 'FIXTURE.001', commonname: 'Synthetic Drive Card',
    contsize: '#3', locationcode: 'A.01.001', lotcode: '27.F1', season: 'F1', saleyear: '27', ptronhand: '610', ptravailable: '610' });
  assert.equal(Object.keys(raw).length, inventoryReadFixture.physicalColumns.length,
    'the raw verified fixture row includes every physical column, including null columns');
  const formatted = context.formatFetchedRows([raw], 'ph_master_inventory')[0];
  assert.equal(Object.hasOwn(formatted, 'PTRONHAND'), true);
  assert.equal(formatted.PTRONHAND, '610');
  assert.equal(formatted.PTRAVAILABLE, '610');
  assert.equal(Object.hasOwn(formatted, 'HOLD_RELEASE_REASON'), false,
    'null physical values are intentionally absent from formatted cache rows');
});

test('10k representative full projection paginates into one complete unique inventory snapshot', () => {
  const source = Array.from({ length: 10_000 }, (_, index) => inventoryReadFixture.row({
    unique_id: index === 0 ? 'drive-layout-synthetic-1-no-photo' : `zz-volume-${String(index - 1).padStart(4, '0')}`,
    itemcode: index === 0 ? 'LAYOUT.001-NO-PHOTO' : `VOLUME.${String(index - 1).padStart(4, '0')}`,
    commonname: index === 0 ? 'Synthetic Drive Card' : `Synthetic volume row ${index - 1}`,
    contsize: '#3', locationcode: index === 0 ? 'A.01.001' : `Z.${String(index - 1).padStart(5, '0')}`,
    lotcode: '27.F1', season: 'F1', saleyear: '27', ptronhand: '100', ptravailable: '100'
  }));
  const collected = [];
  let offset = 0;
  while (offset < source.length) {
    const page = inventoryReadFixture.readMasterPage(source, { dataset: 'master', projection: 'full', offset, limit: 500 });
    assert.equal(page.total, source.length);
    assert.equal(page.projection, 'full');
    assert.equal(page.fieldCoverage, 'full');
    assert.equal(page.columns.length, inventoryReadFixture.physicalColumns.length);
    assert.equal(page.rows.length, Math.min(500, source.length - offset));
    collected.push(...page.rows);
    offset += page.rows.length;
  }
  const ids = collected.map(row => row.unique_id);
  assert.equal(collected.length, 10_000);
  assert.equal(new Set(ids).size, collected.length);
  assert.equal(ids[0], 'drive-layout-synthetic-1-no-photo');
  assert.equal(collected[0].ptronhand, '100');
});

test('temporary failure diagnostics rethrow unchanged errors and restore wrapped APIs', async () => {
  const networkError = new TypeError('Failed to fetch (synthetic.example.test)');
  const stageError = Object.assign(new Error('Synthetic adapter stage failure'), { code: 'SYNTHETIC_FAILURE' });
  const networkPromise = Promise.reject(networkError);
  let stagePromise;
  const coordinatorPromise = Promise.resolve(true);
  const synchronousCommitResult = { committed: true };
  const originalFetch = () => networkPromise;
  const originalFetchWithTimeout = (url, options, timeoutMs, label) => target.fetch(url, options);
  const originalStage = () => (stagePromise ||= Promise.reject(stageError));
  const originalCommit = () => { throw stageError; };
  const originalFactory = () => ({ id: 'core:master', cacheKey: 'requested-full', stage: originalStage, commit: originalCommit });
  const originalCreateCoordinator = options => ({ options });
  const productionCoordinator = Object.freeze({ ensure: () => coordinatorPromise, check: () => true,
    getStatus: () => ({ state: 'Up to date' }), getStatistics: () => ({}) });
  const originalContext = () => ({ view: 'home', viewKey: 'home-key', visible: true, adapters: [{ id: 'core:master', cacheKey: 'full-key',
    sourceKeys: ['ph_master_inventory'], stage: originalStage }] });
  const target = { location: { href: 'https://app.example.test/' }, fetch: originalFetch,
    fetchWithTimeout: originalFetchWithTimeout, getProductionLiveSyncContext: originalContext,
    createProductionCoreLiveAdapter: originalFactory,
    getProductionLiveSyncCoordinator: () => productionCoordinator,
    AgMetricLiveSync: { createCoordinator: originalCreateCoordinator } };
  const diagnostics = installReclassFailureDiagnostics(target);
  const fetchResult = target.fetchWithTimeout('/functions/v1/app-api', { method: 'POST', body: JSON.stringify({ action: 'inventory_read', operation: 'master_page' }) });
  assert.equal(fetchResult, networkPromise, 'diagnostic wrappers retain the original network Promise identity');
  await assert.rejects(fetchResult, error => error === networkError);
  const context = target.getProductionLiveSyncContext();
  const stageResult = context.adapters[0].stage();
  assert.equal(stageResult, stagePromise, 'adapter-stage Promise identity is preserved');
  await assert.rejects(stageResult, error => error === stageError);
  const requested = target.createProductionCoreLiveAdapter('master', 'full');
  assert.throws(() => requested.commit(), error => error === stageError, 'synchronous adapter commit throws remain synchronous');
  const coordinator = target.AgMetricLiveSync.createCoordinator({ commitSnapshots: () => { throw stageError; }, readRevisions: () => coordinatorPromise });
  assert.throws(() => coordinator.options.commitSnapshots(), error => error === stageError, 'synchronous cohort commits remain synchronous');
  assert.equal(coordinator.options.readRevisions(), coordinatorPromise, 'async callback Promise identity is preserved');
  const successfulCoordinator = target.AgMetricLiveSync.createCoordinator({ commitSnapshots: () => synchronousCommitResult });
  assert.equal(successfulCoordinator.options.commitSnapshots(), synchronousCommitResult, 'synchronous callback return values are preserved');
  const rejectedCoordinatorPromise = Promise.reject(stageError);
  const rejectedCoordinator = target.AgMetricLiveSync.createCoordinator({ readRevisions: () => rejectedCoordinatorPromise });
  const readFailure = rejectedCoordinator.options.readRevisions();
  assert.equal(readFailure, rejectedCoordinatorPromise, 'rejected callback Promise identity is preserved');
  await assert.rejects(readFailure, error => error === stageError);
  const wrappedCoordinator = target.getProductionLiveSyncCoordinator();
  assert.notEqual(wrappedCoordinator, productionCoordinator, 'frozen coordinator methods are observed through a separate wrapper object');
  assert.equal(wrappedCoordinator.ensure(requested), coordinatorPromise, 'coordinator ensure returns its exact original Promise');
  assert.equal(wrappedCoordinator.check(), true, 'synchronous coordinator results remain synchronous');
  await coordinatorPromise;
  assert.deepEqual(diagnostics.records.map(entry => entry.source), ['window.fetch', 'fetchWithTimeout', 'adapter.stage', 'adapter.commit', 'commitSnapshots', 'readRevisions']);
  assert.equal(diagnostics.records[0].request.action, 'inventory_read');
  assert.equal(diagnostics.records[0].request.operation, 'master_page');
  assert.equal(diagnostics.records[2].adapterId, 'core:master');
  assert.equal(diagnostics.contextSnapshots[0].adapters[0].cacheKey, 'full-key');
  diagnostics.restore();
  assert.equal(target.fetch, originalFetch);
  assert.equal(target.fetchWithTimeout, originalFetchWithTimeout);
  assert.equal(target.getProductionLiveSyncContext, originalContext);
  assert.equal(target.createProductionCoreLiveAdapter, originalFactory);
  assert.equal(target.AgMetricLiveSync.createCoordinator, originalCreateCoordinator);
  assert.equal(target.getProductionLiveSyncContext().adapters[0].stage, originalStage);
});

test('large Reclass fixture settles Home and Drive cohorts before full-read card mount', async () => {
  let now = 0;
  let reads = 0;
  const snapshots = [
    { ready: false, initialHomeApplied: true, status: { state: 'Syncing' }, view: 'home' },
    { ready: false, initialHomeApplied: true, status: { state: 'Up to date' }, contextKey: 'old-scope' },
    { ready: true, initialHomeApplied: true, roleReady: true, status: { state: 'Up to date' }, contextKey: 'current-scope', permission: 'p7' },
  ];
  const settled = await waitForInitialHomeCohort(async () => snapshots[reads++], {
    now: () => now,
    delay: async ms => { now += ms; },
  });
  assert.equal(reads, 3, 'the startup flag and stale proof do not resolve the wait');
  assert.equal(settled.contextKey, 'current-scope');
  await assert.rejects(waitForInitialHomeCohort(async () => ({ ready: false, status: { state: 'Needs attention' } })),
    error => error.code === 'INITIAL_HOME_COHORT_FAILED');
  let driveReads = 0;
  const driveSettled = await waitForVerifiedLiveCohort(async () => [
    { ready: false, status: { state: 'Syncing' }, view: 'drive', masterProjection: 'browse' },
    { ready: true, status: { state: 'Up to date' }, view: 'drive', masterProjection: 'browse', revision: '17' },
  ][driveReads++], { label: 'Drive', now: () => now, delay: async ms => { now += ms; } });
  assert.equal(driveReads, 2, 'a Drive context alone is not proof until its browse cohort applies');
  assert.equal(driveSettled.masterProjection, 'browse');
  await assert.rejects(waitForVerifiedLiveCohort(async () => ({ ready: false, status: { state: 'Needs attention' } }), { label: 'Drive' }),
    error => error.code === 'LIVE_SYNC_COHORT_FAILED' && /Drive live-sync/.test(error.message));

  const appliedAssignment = html.indexOf('hasAppliedInitialHomeView = true;', html.indexOf('if (!hasAppliedInitialHomeView)'));
  const initialSwitch = html.indexOf('switchView(defaultView);', appliedAssignment);
  const navigationStart = html.indexOf('function beginProductionVerifiedNavigation');
  const navigationEnd = html.indexOf('function signalProductionLiveSync', navigationStart);
  assert.ok(appliedAssignment >= 0 && initialSwitch > appliedAssignment,
    'production sets the startup flag before starting the initial view navigation');
  assert.match(html.slice(navigationStart, navigationEnd), /void getProductionLiveSyncCoordinator\(\)\.check\('view-entry'\)/,
    'the initial Home verification continues asynchronously after navigation starts');
  assert.match(spec, /await waitForInitialHomeCohort\(async \(\) => page\.evaluate/,
    'the large fixture waits for the actual Home cohort proof');
  assert.match(spec, /await suppressDriveLayoutRenderer\(page\);\s*await page\.evaluate\(\(\) => window\.eval\(`\(\(\) => \{ switchView\('drive'\)/,
    'the large fixture keeps rendering bounded while entering Drive before the final full snapshot');
  assert.match(spec, /await waitForVerifiedLiveCohort\(async \(\) => page\.evaluate/,
    'the fixture waits for a genuine current Drive browse cohort');
  assert.match(spec, /label: 'Drive', timeoutMs: 60_000/,
    'native WebKit setup gets enough bounded time for two verified 10k reads');
  assert.match(spec, /await waitForVerifiedLiveCohort\(async \(\) => page\.evaluate[\s\S]*?ensureDatasetLoaded\('master', 'full', \{ force: true \}\)/,
    'the full read begins only after the genuine Drive cohort settles');
  assert.match(spec, /renderVerifiedDriveLayoutCard\(page,[\s\S]*?verifiedFullSnapshot!, inventoryRows, sourceQuantity/,
    'the large fixture mounts its real source row after the complete read');
  assert.match(spec, /activeMasterBrowseRequests\.size,[\s\S]*?RECLASS_FIXTURE_OPEN_REQUIRES_SETTLED_VERIFIED_DRIVE/,
    'the open path rejects an outstanding browse request instead of manufacturing readiness');
  assert.match(spec, /isMasterBrowseInventoryReadBody\(request\.postDataJSON\(\)\)/,
    'the quiescence assertion tracks the nested inventory_read.params payload');
  assert.match(spec, /photo_link: null, photo_name: null/,
    'the verified source row does not introduce an uncontrolled image request during the paint measurement');
  assert.match(spec, /uniqueCommonNameCount\)\.toBeGreaterThanOrEqual\(1200\)/);
  assert.match(spec, /requiredFieldsPresent\)\.toBe\(true\)/);
  assert.match(spec, /!masterRowsLookPartialForCurrentScope\(fullInventory\)/,
    'the final full snapshot also passes the production completeness guard');
  assert.match(spec, /test\.setTimeout\(180_000\)/,
    'the 10k setup has a bounded fixture budget independent of interaction timing gates');
  assert.match(spec, /master\.rowCompleteness !== 'complete' \|\| master\.fieldCoverage !== 'full'/,
    'reconfirming a large snapshot requires complete/full metadata instead of assigning it');
  const driveSource = readFileSync(new URL('./fixtures/drive-card-layout.ts', import.meta.url), 'utf8');
  const mountHelperStart = driveSource.indexOf('export async function renderVerifiedDriveLayoutCard');
  const mountHelperEnd = driveSource.indexOf('export async function installDriveCardLayoutFixture', mountHelperStart);
  const mountHelperSource = driveSource.slice(mountHelperStart, mountHelperEnd);
  assert.doesNotMatch(mountHelperSource, /switchView\(|fullInventory\s*=|fieldCoverage\s*=/,
    'the verified mount helper neither navigates nor replaces/downgrades the verified inventory');
  assert.match(spec, /status\.contextKey === contextKey && verifiedView === contextKey/,
    'fixture readiness requires the coordinator and app verified-view context to match');
});
