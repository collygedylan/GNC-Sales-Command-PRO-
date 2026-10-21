import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const engineSource = readFileSync(new URL('../assets/eval-reports-engine.js', import.meta.url), 'utf8');
const context = vm.createContext({ Intl, Date, Map, Set, Object, Array, String, Number, Math });
context.globalThis = context;
vm.runInContext(engineSource, context, { filename: 'eval-reports-engine.js' });
const engine = context.GncEvalReports;

function row(itemcode, season, lotcode, overrides = {}) {
  return { ITEMCODE: itemcode, SEASON: season, LOTCODE: lotcode, ITEMDESI: '', ...overrides };
}

test('Eval Reports #2 suppresses a card only when every underlying row is Y/U3, lot-Y/U3, or SHFT', () => {
  const fixtures = [
    ['jim-dandy', [row('000201.030.1', 'Y', '27.Y'), row('000201.030.1', 'Y', '28.Y')], true],
    ['season-u3', [row('U3.ONLY', 'u3', '27.S1')], true],
    ['lot-u3', [row('LOT.U3', 'F1', '27.u3')], true],
    ['design-shft', [row('SHIFT.ONLY', 'S1', '27.S1', { itemdesi: 'shade-shFt-extra' })], true],
    ['salsa-dancer', [row('000193.031.1', 'S1', '27.S1'), row('000193.031.1', 'Z', '27.Z')], false],
    ['mixed-active-row', [row('MIXED.1', 'U3', '27.U3'), row('MIXED.1', 'S1', '27.S1')], false],
    ['empty', [], false]
  ];
  for (const [name, rows, expected] of fixtures) {
    assert.equal(engine.isSuppressedEvalReportCardRows(rows), expected, name);
  }
  assert.equal(engine.isSuppressedEvalReportCardRow(row('DESIG.ALIAS', 'S1', '27.S1', { DESIGITEM: 'a SHFT label' })), true);
});

test('card suppression examines a 10,001-row, 1,000-itemcode snapshot without mutating source rows', () => {
  const rows = [];
  for (let item = 0; item < 1000; item += 1) {
    for (let physicalRow = 0; physicalRow < 10; physicalRow += 1) {
      const suppressed = item < 800;
      rows.push(row(`ITEM-${String(item).padStart(4, '0')}`, suppressed ? 'U3' : 'F1', suppressed ? '27.U3' : '27.F1', {
        UNIQUE_ID: `${item}-${physicalRow}`,
        COMMONNAME: `Fixture ${item}`,
        ITEMDESI: ''
      }));
    }
  }
  rows[0].SEASON = 'F1';
  rows[0].LOTCODE = '27.F1'; // Any active row preserves the whole item card.
  rows.push(row('ITEM-0000', 'U3', '27.U3', { UNIQUE_ID: '10000', COMMONNAME: 'Fixture 0' }));

  const sourceSnapshot = JSON.stringify(rows);
  const startedAt = performance.now();
  const byItemCode = new Map();
  for (const sourceRow of rows) {
    if (!byItemCode.has(sourceRow.ITEMCODE)) byItemCode.set(sourceRow.ITEMCODE, []);
    byItemCode.get(sourceRow.ITEMCODE).push(sourceRow);
  }
  const suppressedCodes = [...byItemCode].filter(([, cardRows]) => engine.isSuppressedEvalReportCardRows(cardRows)).map(([code]) => code);
  const durationMs = performance.now() - startedAt;
  console.log(JSON.stringify({ operation: 'Eval2 cached card suppression', rows: rows.length, itemcodes: byItemCode.size, durationMs, limitMs: 100, runtime: process.version, cache: 'in-memory fixture; no network', osCaches: 'uncontrolled' }));
  assert.ok(durationMs < 100, `Cached card suppression took ${durationMs} ms`);

  assert.equal(rows.length, 10001);
  assert.equal(byItemCode.size, 1000);
  assert.equal(suppressedCodes.length, 799);
  assert.ok(!suppressedCodes.includes('ITEM-0000'));
  assert.ok(suppressedCodes.includes('ITEM-0001'));
  assert.equal(JSON.stringify(rows), sourceSnapshot);
  assert.equal(byItemCode.get('ITEM-0000')[0], rows[0]);
});

test('Eval2 removes suppressed-only itemcodes before report counts and picker rows are published', () => {
  const html = readComposedAppSource();
  const start = html.indexOf('function prepareManagerEvalReport2GroupLookups(index)');
  const end = html.indexOf('async function performManagerEvalReport2IndexBuild(job)', start);
  assert.ok(start >= 0 && end > start, 'Eval2 group preparation helper must be present');
  const rows = [
    row('Y-ONLY', 'Y', '27.Y', { UNIQUE_ID:'y-only' }),
    row('U3-ONLY', 'U3', '27.U3', { UNIQUE_ID:'u3-only' }),
    row('SHFT-ONLY', 'F1', '27.F1', { UNIQUE_ID:'shft-only', itemdesi:'shade SHFT' }),
    row('SALSA', 'U3', '27.U3', { UNIQUE_ID:'salsa-u3' }),
    row('SALSA', 'S1', '27.S1', { UNIQUE_ID:'salsa-s1' })
  ];
  const classified = engine.classifyScriptCompatibleRows(rows, {
    currentSeason:'F1', currentSalesYear:27, nextSeason:'S1', nextSalesYear:27, now:new Date('2026-10-19T12:00:00Z')
  });
  const rowsByItemCode = new Map();
  const reportMembershipByKey = new Map();
  for (const sourceRow of rows) {
    const code = sourceRow.ITEMCODE.toUpperCase();
    if (!rowsByItemCode.has(code)) rowsByItemCode.set(code, []);
    rowsByItemCode.get(code).push(sourceRow);
  }
  for (const reportId of engine.REPORT_IDS) {
    for (const sourceRow of classified.reports[reportId]) {
      const key = sourceRow.UNIQUE_ID;
      if (!reportMembershipByKey.has(key)) reportMembershipByKey.set(key, new Set());
      reportMembershipByKey.get(key).add(reportId);
    }
  }
  const scope = vm.createContext({
    Map, Set, Array, String, Object,
    getManagerEvalReports2Api:() => engine,
    getManagerEvalReport2RowKey:sourceRow => sourceRow.UNIQUE_ID,
    getManagerEvalReport2ItemCode:sourceRow => String(sourceRow.ITEMCODE || '').toUpperCase(),
    compareManagerEvalReport2InventoryRows:() => 0
  });
  vm.runInContext(`${html.slice(start, end)};globalThis.prepare = prepareManagerEvalReport2GroupLookups;`, scope);
  const index = scope.prepare({ ...classified, allRows:rows, rowsByItemCode, reportMembershipByKey });
  assert.deepEqual(Array.from(index.suppressedItemCodes).sort(), ['SHFT-ONLY', 'U3-ONLY', 'Y-ONLY']);
  for (const reportId of engine.REPORT_IDS) {
    const reportRows = index.reports[reportId];
    assert.equal(index.counts[reportId], reportRows.length, `${reportId} tab count must match its published rows`);
    assert.ok(reportRows.every(sourceRow => !index.suppressedItemCodes.has(sourceRow.ITEMCODE)), `${reportId} picker rows exclude suppressed-only cards`);
  }
  assert.deepEqual(Array.from(index.reports.u3, sourceRow => sourceRow.UNIQUE_ID), ['salsa-u3'], 'a mixed active card keeps its U3 row');
  assert.deepEqual(Array.from(index.allRows, sourceRow => sourceRow.UNIQUE_ID), rows.map(sourceRow => sourceRow.UNIQUE_ID), 'the shared source snapshot remains intact');
});

test('Eval2 main Users control stays direct, counts distinct ITEMCODEs, and filters unassigned rows', () => {
  const html = readComposedAppSource();
  const optionStart = html.indexOf('function getManagerEvalReport2UserFilterOptions(');
  const optionEnd = html.indexOf('function getManagerEvalReport2LocationOptions(', optionStart);
  const matchStart = html.indexOf('function normalizeManagerEvalAssignedUser(', optionEnd);
  const matchEnd = html.indexOf('function getManagerEvalAssignedUsers(', matchStart);
  const controlStart = html.indexOf('function renderManagerEvalAssignedUserControl(', matchEnd);
  const controlEnd = html.indexOf('function getManagerEvalUserPickerOptions(', controlStart);
  assert.ok(optionStart >= 0 && optionEnd > optionStart && matchStart > optionEnd && matchEnd > matchStart && controlStart > matchEnd && controlEnd > controlStart);
  const rows = [
    { ITEMCODE:'A', ASSIGNEDTO_USERS:['Alice'] },
    { ITEMCODE:'A', ASSIGNEDTO_USERS:[''] },
    { ITEMCODE:'B', ASSIGNEDTO_USERS:['Bob'] },
    { ITEMCODE:'C', ASSIGNEDTO_USERS:[] }
  ];
  const scope = vm.createContext({
    Map, Set, Array, String, Object,
    managerEvalReport2ContSizeFilter:'all', managerEvalReport2LocationFilter:'all', managerEvalReport2PriorityFilter:'all',
    managerEvalReport2AssignedToFilters:new Set(),
    getManagerEvalReport2Rows:() => rows, getManagerEvalReport2SeasonFilters:() => new Set(),
    doesManagerEvalReport2RowMatchSeasonFilter:() => true,
    getManagerEvalReportRowContSize:() => '', getManagerEvalReportRowLocation:() => '', getManagerEvalReportRowPriority:() => '',
    managerEvalReportRowMatchesSearch:() => true,
    getManagerEvalReport2ItemCode:sourceRow => String(sourceRow.ITEMCODE || '').toUpperCase(),
    getManagerEvalReportRowAssignedToUsers:sourceRow => Array.isArray(sourceRow.ASSIGNEDTO_USERS) ? sourceRow.ASSIGNEDTO_USERS.map(value => value || '(Unassigned)') : ['(Unassigned)'],
    compareManagerEvalReport2Natural:(left, right) => String(left).localeCompare(String(right)),
    escapeHtml:value => String(value),
    getManagerEvalAssignedUsers:() => [],
    getManagerEvalReport2UserFilterOptions:() => [{value:'all',label:'All Users (3)'},{value:'(Unassigned)',label:'Unassigned (2)'},{value:'Alice',label:'Alice (1)'},{value:'Bob',label:'Bob (1)'}]
  });
  const matchSource = html.slice(matchStart, matchEnd);
  const optionSource = html.slice(optionStart, optionEnd);
  const controlSource = html.slice(controlStart, controlEnd);
  vm.runInContext(`${matchSource};${optionSource};${controlSource};
    globalThis.matches=managerEvalAssignedUserMatches;
    globalThis.options=getManagerEvalReport2UserFilterOptions;
    globalThis.render=renderManagerEvalAssignedUserControl;`, scope);
  const options = Array.from(scope.options()).map(option => [option.value, option.label]);
  assert.deepEqual(options, [
    ['all', 'All Users (3)'],
    ['(Unassigned)', 'Unassigned (2)'],
    ['Alice', 'Alice (1)'],
    ['Bob', 'Bob (1)']
  ]);
  const markup = scope.render('eval2', [], false);
  assert.match(markup, /<select data-role="manager-eval2-user-filter"/);
  assert.doesNotMatch(markup, /<button/);
  assert.match(markup, /aria-label="Filter Eval Reports #2 by user"/);
  assert.match(html, /manager-eval-report-2-more-menu[^`]*managerEvalReport2MoreMenuOpen/);
  assert.match(html, /ontoggle="managerEvalReport2MoreMenuOpen=this\.open"/);
  const setFilterStart = html.indexOf('function setManagerEvalReport2Filter(');
  const setFilterEnd = html.indexOf('function clearManagerEvalReport2Filters(', setFilterStart);
  assert.ok(setFilterStart >= 0 && setFilterEnd > setFilterStart);
  const setFilterSource = html.slice(setFilterStart, setFilterEnd);
  assert.match(setFilterSource, /managerEvalReport2AssignedToFilters = safeValue === 'all' \? new Set\(\) : new Set\(\[safeValue\]\)/);
  assert.doesNotMatch(setFilterSource, /managerEvalReport2LocationFilter = 'all'/, 'changing the selected user preserves optional location filters');
  assert.doesNotMatch(setFilterSource, /loadManagerEvalReports2|applyManagerEvalReport2UserFilter/, 'changing the selected user filters the shared local snapshot without refreshing');
  scope.managerEvalReport2AssignedToFilters = new Set(['(Unassigned)']);
  assert.equal(scope.matches({ ASSIGNEDTO_USERS:[] }, 'eval2'), true);
  assert.equal(scope.matches({ ASSIGNEDTO_USERS:[''] }, 'eval2'), true);
  assert.equal(scope.matches({ ASSIGNEDTO_USERS:['Alice'] }, 'eval2'), false);
});

test('Eval2 shared-snapshot reopen is a sub-300ms cache hit without repeating dataset or settings loads', async () => {
  const html = readComposedAppSource();
  const start = html.indexOf('async function loadManagerEvalReports2(force = false)');
  const end = html.indexOf('function getManagerEvalReport2CacheKeyValue()', start);
  assert.ok(start >= 0 && end > start, 'Eval2 shared-snapshot loader must be present');
  const cache = { reports:{}, counts:{}, allRows:[] };
  let datasetLoads = 0;
  let settingsLoads = 0;
  let reconciles = 0;
  const scope = vm.createContext({
    managerEvalReport2Cache:cache,
    managerEvalReport2CacheKey:'shared-snapshot-v1',
    managerEvalReport2LoadState:{ loading:false, error:'', promise:null },
    canViewManagerEvalReports2:() => true,
    useManagerReportPages:() => false,
    getManagerEvalReport2CacheKeyValue:() => 'shared-snapshot-v1',
    managerEvalReport2DisplaySourcesReady:() => true,
    reconcileManagerEvalReport2Navigation:() => { reconciles += 1; },
    ensureDatasetLoaded:async () => { datasetLoads += 1; throw new Error('warm snapshot must not refetch'); },
    loadManagerEvalReportSettings:async () => { settingsLoads += 1; throw new Error('warm snapshot must not refetch settings'); },
    scheduleManagersRender:() => { throw new Error('warm snapshot must not flash a loading render'); },
    Promise, JSON, Object, Array, Set, Map, String
  });
  vm.runInContext(`${html.slice(start, end)};globalThis.open=loadManagerEvalReports2;`, scope);
  const startedAt = performance.now();
  const result = await scope.open(false);
  const elapsedMs = performance.now() - startedAt;
  console.log(JSON.stringify({ operation:'Eval2 shared-snapshot cache reopen', elapsedMs, limitMs:300,
    datasetLoads, settingsLoads, reconciles, network:'none; cache hit', runtime:process.version }));
  assert.equal(result, cache);
  assert.ok(elapsedMs < 300, `Eval2 warm cache reopen took ${elapsedMs.toFixed(2)} ms`);
  assert.equal(datasetLoads, 0);
  assert.equal(settingsLoads, 0);
  assert.equal(reconciles, 1);
});
