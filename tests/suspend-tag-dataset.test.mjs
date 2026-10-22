import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const appApi = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const appAuth = readFileSync(new URL('../supabase/functions/_shared/app-auth.ts', import.meta.url), 'utf8');
const suspendRead = readFileSync(new URL('../supabase/functions/app-api/suspend-tag-read.ts', import.meta.url), 'utf8');
const queueInventory = readFileSync(new URL('../assets/queue-inventory-hydration.js', import.meta.url), 'utf8');

test('candidate commands use the authenticated atomic Suspend endpoint', () => {
  const source = readComposedAppSource();
  const addition = source.match(/        async function addSelectedDockSuspendDcRequestOptions\([^]*?^        }/m)[0];
  assert.match(addition, /suspendTagApi\('add_candidates'/);
  assert.doesNotMatch(addition, /runDetailWriteWithRetry\('ph_soc_master'/);
});

test('current SOC snapshot keeps unchanged suspend rows from earlier delta filenames', () => {
  const html = readComposedAppSource();
  const context = vm.createContext({ socRawSourceRows: [],
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== '') || '',
    getDockSuspendValue: row => row.suspend,
    getDockSuspendToValue: row => row.suspend_to,
    getLatestSocImportFileWatermark: () => ({ filename: 'SOC-noon.xlsx' }) });
  vm.runInContext(html.match(/        function getLatestSocSuspendTagSourceRows\([^]*?^        }/m)[0], context);
  const rows = [
    { unique_id: 'physical-row-1', suspend: 'SUSPEND', suspend_to: 'dc', filename: 'SOC-morning.xlsx' },
    { unique_id: 'physical-row-2', suspend: 'SUSPEND', suspend_to: 'dc', filename: 'SOC-morning.xlsx' },
    { unique_id: 'other-owner', suspend: 'SUSPEND', suspend_to: 'mk', filename: 'SOC-noon.xlsx' }
  ];
  assert.deepEqual(Array.from(context.getLatestSocSuspendTagSourceRows(rows, rows), row => row.unique_id),
    ['physical-row-1', 'physical-row-2']);
  assert.equal(context.getLatestSocSuspendTagSourceRows([], rows).length, 0, 'no archive resurrection');
});

test('all sales rep aliases retain the same limited server role and inventory access', () => {
  const auth = actualAccessFunctions();
  for (const role of ['salesrep', 'sales rep', 'sales_rep']) {
    assert.equal(auth.roleState(role).isRep, true, role);
    assert.equal(auth.roleState(role).isAdmin, false, role);
    assert.equal(auth.access(role, 'ph_master_inventory', 'brian_hatfield'), true);
  }
});

function extractFunction(source, name, exported = false) {
  const marker = `${exported ? 'export ' : ''}function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} exists`);
  let brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1).replace(/^export /, '');
  }
  assert.fail(`${name} function closes`);
}

function actualAccessFunctions() {
  const readableStart = appApi.indexOf('const READABLE_TABLES = new Set([');
  const readableEnd = appApi.indexOf('const supabase = createClient', readableStart);
  assert.ok(readableStart >= 0 && readableEnd > readableStart);
  const accessConstants = appApi.slice(readableStart, readableEnd);
  const functions = [
    extractFunction(appApi, 'hasTableReadAccess'),
    extractFunction(appAuth, 'normalizeUsername', true),
    extractFunction(appAuth, 'normalizeRole', true),
    extractFunction(appAuth, 'getRoleAccessState', true),
  ];
  const fullAccess = appApi.match(/const FULL_ACCESS_USER_KEYS = new Set\((\[[^;]+\])\);/);
  assert.ok(fullAccess);
  const code = ts.transpileModule(`const AV_OPTION_EVAL_REQUESTS_TABLE = 'ph_av_option_eval_requests';\nconst FULL_ACCESS_USER_KEYS = new Set(${fullAccess[1]});\n${accessConstants}\n${functions.join('\n')}\nthis.access = hasTableReadAccess; this.roleState = getRoleAccessState; this.normalizeUsername = normalizeUsername;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext({ Set });
  vm.runInContext(code, context);
  return context;
}

test('QC Drive baseline can read inventory without gaining sales or account data', () => {
  const auth = actualAccessFunctions();
  for (const role of ['QC', 'qc', '\nQC']) {
    assert.equal(auth.access(role, 'ph_master_inventory', 'diagnostic_qc'), true);
    assert.equal(auth.access(role, 'ph_customer_consignee_sales_reps', 'diagnostic_qc'), false);
    assert.equal(auth.access(role, 'ph_hl_po', 'diagnostic_qc'), false);
  }
});

test('Suspend Tag has an exact editor allowlist without broadening ordinary SOC permissions', () => {
  const auth = actualAccessFunctions();
  const matrix = [
    ['QC Supervisor', 'dan_mccuistion', true],
    ['QC Supervisor', 'qc_other', true],
    ['QC', 'qc_user', true],
    ['REP', 'rep_user', true],
    ['Sales Rep', 'sales_rep', true],
    ['Sales', 'sales_user', true],
    ['CSR', 'csr_user', true],
    ['Admin', 'admin_user', true],
    ['QC Supervisor', 'dylan_collyge', true],
  ];
  for (const [role, username, expected] of matrix) {
    const normalized = auth.normalizeUsername(username);
    const roleAccess = auth.roleState(role);
    const socRead = auth.access(role, 'ph_soc_master', normalized);
    assert.equal(socRead, expected, `${role}/${username} SOC permission`);
    // suspend_tag resolves to the exact existing permission key in DATASET_READ_SOURCES.
    assert.equal(socRead, auth.access(role, 'ph_soc_master', normalized), 'the alias may not introduce a distinct grant');
    if (role === 'QC Supervisor' && username !== 'dylan_collyge') {
      assert.equal(auth.access(role, 'ph_app_settings', normalized), false, 'QC Supervisor still cannot read app settings');
      assert.equal(auth.access(role, 'ph_master_inventory', normalized), true, 'existing QC Supervisor master permission remains unchanged');
      assert.equal(roleAccess.isQcSupervisor, true);
    }
  }
  assert.match(appApi, /suspend_tag:\s*\{\s*table: "ph_soc_master", permission: "ph_soc_master"/);
  assert.match(appApi, /dataset === "suspend_tag"\s*\? !SUSPEND_TAG_EDITORS\.has\(username\)\s*:\s*!hasTableReadAccess\(role, source\.permission, username\) && !canonicalDatasetAccess/);
  const policy=readFileSync(new URL("../supabase/functions/_shared/suspend-tag.ts",import.meta.url),"utf8");
  assert.match(policy,/new Set\(\['dylan_collyge', 'megan_kelly', 'jd_jones', 'dan_mccuistion'\]\)/);
});

test('Suspend Tag first page exposes only bounded latest SOC filename metadata', () => {
  const freshnessFns = [
    extractFunction(suspendRead, 'suspendSourceFreshnessQuery', true),
    extractFunction(suspendRead, 'suspendSourceFreshnessFromRows', true),
  ];
  const compiled = ts.transpileModule(`
    function jsonObject(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON_OBJECT_INVALID');
      return value;
    }
    ${freshnessFns.join('\n')}
    this.query = suspendSourceFreshnessQuery;
    this.fromRows = suspendSourceFreshnessFromRows;
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const context = vm.createContext({ URLSearchParams, Date, Number, Error });
  vm.runInContext(compiled, context);
  const query = new URLSearchParams(context.query());
  assert.equal(query.get('select'), 'filename,last_updated');
  assert.equal(query.get('order'), 'last_updated.desc.nullslast,unique_id.asc');
  assert.equal(query.get('limit'), '1');
  assert.deepEqual(JSON.parse(JSON.stringify(context.fromRows([{
    filename: 'SOC current.xlsx', last_updated: '2026-10-20T12:00:00Z',
  }]))), { filename: 'SOC current.xlsx', last_updated: '2026-10-20T12:00:00Z' });
  assert.equal(context.fromRows([]), null);
  assert.throws(() => context.fromRows([{ filename: '', last_updated: '2026-10-20T12:00:00Z' }]));
  assert.match(appApi, /dataset === "suspend_tag" && parsed\.offset === 0[\s\S]*suspendSourceFreshnessQuery\(\)/);
  assert.match(appApi, /const \[response, sourceFreshnessResponse\] = await Promise\.all\(/);
});

test('Suspend Tag dataset pages carry ordered master/CAV metric fallback without changing row identity gates', () => {
  assert.match(appApi, /async function enrichSuspendTagMetricRows\(/);
  assert.match(appApi, /readSuspendTagMetricRows\("ph_master_inventory"/);
  assert.match(appApi, /readSuspendTagMetricRows\("ph_cav_import"/);
  assert.match(appApi, /SUSPEND_TAG_METRIC_CAV_FIELDS\s*=\s*"[^"]*itemcode,season,/);
  assert.match(appApi, /captureReadyInventoryLocationRevision\(actorId\)[\s\S]*?readSuspendTagMetricRows\("ph_master_inventory"[\s\S]*?captureReadyInventoryLocationRevision\(actorId\) !== inventoryRevision/);
  assert.ok(appApi.includes('[metricKey]: buildSuspendTagMetricFallback(row, masterByItem.get(key) || [], cavByItem.get(key) || [], true, metricKey === "request_inventory_metrics")'));
  assert.ok(appApi.includes('["suspend_tag", "request_queue", "active_request"].includes(dataset)'));
  assert.ok(appApi.includes('catch { metricRows = data; }'));
  assert.match(appApi, /verifySuspendTagSession\(supabase, actor, request\)/);
  assert.match(appApi, /dataset === "suspend_tag"\s*\? !SUSPEND_TAG_EDITORS\.has\(username\)/);

  const functions = [
    extractFunction(appApi, 'normalizeSuspendTagMetricKey'),
    extractFunction(appApi, 'sumSuspendTagMetric'),
    extractFunction(appApi, 'sumSuspendTagOpenStock'),
    extractFunction(appApi, 'sumSuspendTagAvailable'),
    extractFunction(appApi, 'firstSuspendTagMetricValue'),
    extractFunction(appApi, 'buildSuspendTagMetricFallback'),
  ];
  const compiled = ts.transpileModule(`${functions.join('\n')}\nthis.build = buildSuspendTagMetricFallback;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext({ Number, String });
  vm.runInContext(compiled, context);
  const itemLot = context.build({ itemcode: '006009.031.1', locationcode: '0.00.111', lotcode: '27.F1' }, [
    { itemcode: '006009.031.1', locationcode: 'D.17.000', lotcode: '27.F1', season: 'F1', ptronhand: '35', ptrreviewed: '35', ptravailable: null, s_lts: '-400' },
    { itemcode: '006009.031.1', locationcode: 'B.07.000', lotcode: '27.F1', season: 'F1', ptronhand: '5', ptrreviewed: null, ptravailable: '5', s_lts: '-400' },
    { itemcode: '006009.031.1', locationcode: 'B.07.000', lotcode: '27.S1', season: 'S1', ptronhand: '100', ptrreviewed: null, ptravailable: '100', s_lts: '2838' },
  ], [], true);
  assert.equal(itemLot.MATCH_LEVEL, 'item-lot');
  assert.equal(itemLot.PTRONHAND, 40);
  assert.equal(itemLot.PTRREVIEWED, 35);
  assert.equal(itemLot.PTRAVAILABLE, 5);
  assert.equal(itemLot.S_LTS, -400, 'repeated seasonal open-stock values are not summed per location');
  assert.equal(itemLot.LOC_ON_HAND, 40, 'missing staging location uses the numeric item/lot stock fallback');

  const itemFallback = context.build({ itemcode: '006009.031.1', locationcode: '0.00.111', lotcode: 'missing-lot' }, [
    { itemcode: '006009.031.1', locationcode: 'D.17.000', lotcode: '27.F1', season: 'F1', ptronhand: '35', s_lts: '-400' },
    { itemcode: '006009.031.1', locationcode: 'B.07.000', lotcode: '27.F1', season: 'F1', ptronhand: '5', s_lts: '-400' },
    { itemcode: '006009.031.1', locationcode: 'B.07.000', lotcode: '27.S1', season: 'S1', ptronhand: '100', s_lts: '2838' },
    { itemcode: '006009.031.1', locationcode: 'C.01.000', lotcode: '27.S1', season: 'S1', ptronhand: '200', s_lts: '2838' },
  ], [], true);
  assert.equal(itemFallback.MATCH_LEVEL, 'item');
  assert.equal(itemFallback.PTRONHAND, 340);
  assert.equal(itemFallback.S_LTS, 2438, 'distinct season totals are summed once per season');

  const cav = context.build({ itemcode: '099999.001.1', locationcode: '0.00.111', lotcode: '27.F1' }, [], [
    { itemcode: '099999.001.1', available: '12', spec: 'CAV spec', hold_reason: 'quality' },
  ], true);
  assert.equal(cav.MATCH_LEVEL, 'cav-item');
  assert.equal(cav.PTRONHAND, null, 'CAV does not supply On Hand');
  assert.equal(cav.PTRAVAILABLE, 12);
  assert.equal(cav.SOURCE, 'ph_cav_import');
  assert.equal(cav.SPEC, 'CAV spec');
  const cavWithoutQuantity = context.build({ itemcode: '088888.001.1', locationcode: '0.00.111', lotcode: '27.F1' }, [], [
    { itemcode: '088888.001.1', spec: 'CAV source without quantities' },
  ], true);
  assert.equal(cavWithoutQuantity.PTRONHAND, null);
  assert.equal(cavWithoutQuantity.PTRAVAILABLE, null, 'an existing source row with a missing quantity remains unknown');
  const noSource = context.build({ itemcode: '077777.001.1', locationcode: '0.00.111', lotcode: '27.F1' }, [], []);
  assert.equal(noSource.PTRONHAND, null, 'missing item source rows stay unknown');
  assert.equal(noSource.LOC_ON_HAND, null, 'missing location is unknown until the master read is authoritative');
  const authoritativeNoSource = context.build({ itemcode: '077777.001.1', locationcode: '0.00.111', lotcode: '27.F1' }, [], [], true);
  assert.equal(authoritativeNoSource.PTRONHAND, null, 'an authoritative missing item still does not invent item quantities');
  assert.equal(authoritativeNoSource.LOC_ON_HAND, 0, 'authoritative master absence at the physical location is numeric zero');

  const oldLot = context.build({itemcode:'003360.070.2',locationcode:'I.02.000',lotcode:'25.F1'},[
    {itemcode:'003360.070.2',locationcode:'I.02.000',lotcode:'27.F1',ptronhand:'2',ptrreviewed:'2',ptravailable:'0',s_lts:'0'},
    {itemcode:'003360.070.2',locationcode:'A.01.000',lotcode:'25.F1',ptronhand:'9'}
  ],[],true,true);
  assert.equal(oldLot.MATCH_LEVEL,'item-location');assert.equal(oldLot.PTRONHAND,2);assert.equal(oldLot.PTRAVAILABLE,0);
  const requestMissing=context.build({itemcode:'none',locationcode:'none',lotcode:'25.F1'},[],[],true,true);
  for(const metric of ['PTRONHAND','PTRREVIEWED','PTRAVAILABLE','S_LTS','LOC_ON_HAND'])assert.equal(requestMissing[metric],0,metric);
  const reported = [
    ['010248.021.1', 'Tiny Quick Fire Hydrangea 2DP'],
    ['006009.031.1', 'Bobo Hydrangea 3DP'],
    ['006408.031.1', 'Little Quick Fire Hydrangea 3DP'],
    ['008035.081.1', 'Pugster Periwinkle Butterfly Bush 8DP'],
  ];
  for (const [itemcode, commonname] of reported) {
    const card = context.build({ itemcode, commonname, locationcode: '0.00.111', lotcode: '27.F1' }, [
      { itemcode, locationcode: 'B.07.000', lotcode: '27.F1', season: 'F1', ptronhand: '12', ptrreviewed: '2', ptravailable: '10', s_lts: '8', loc_match_qty: itemcode === '006408.031.1' ? '967' : '3', holdstopreason: 'QC HOLD' },
    ], [], true);
    assert.equal(card.MATCH_LEVEL, 'item-lot', `${itemcode} matches the tag lot before item fallback`);
    for (const metric of ['PTRONHAND', 'PTRREVIEWED', 'PTRAVAILABLE', 'S_LTS', 'LOC_MATCH_QTY', 'LOC_ON_HAND']) {
      assert.equal(typeof card[metric], 'number', `${itemcode} exposes numeric ${metric}`);
    }
    assert.equal(card.LOC_ON_HAND, 12, `${itemcode} uses item/lot On Hand at the staging location`);
    assert.equal(card.LOC_MATCH_QTY, 0, `${itemcode} has no location photo match at 0.00.111; unrelated lot matches do not leak`);
    assert.equal(card.HOLDSTOPREASON, 'QC HOLD', `${itemcode} retains the master reason for the card`);
  }
  const locationPhotoEvidence = context.build({ itemcode: '006408.031.1', locationcode: '0.00.111', lotcode: '27.F1' }, [
    { itemcode: '006408.031.1', locationcode: 'F.14.000', lotcode: '27.S1', season: 'S1', ptronhand: '1462', loc_match_qty: '967' },
    { itemcode: '006408.031.1', locationcode: '0.00.111', lotcode: '27.F1', season: 'F1', ptronhand: '4', loc_match_qty: '11' },
  ], [], true);
  assert.equal(locationPhotoEvidence.LOC_MATCH_QTY, 11, 'a positive photo match remains tied to the requested physical location');
});

test('Suspend Tag client uses item/lot and CAV display fallback and marks observable metrics', () => {
  const context = vm.createContext({ globalThis: null, window: null, Map, Set, String, Number, JSON });
  context.globalThis = context;
  context.window = context;
  vm.runInContext(queueInventory, context);
  const index = context.AgMetricQueueInventory.createIndex([
    { unique_id: 'master-a', itemcode: '006009.031.1', locationcode: 'D.17.000', lotcode: '27.F1', season: 'F1', ptronhand: '35', ptrreviewed: '35', ptravailable: '0', s_lts: '-400' },
    { unique_id: 'master-b', itemcode: '006009.031.1', locationcode: 'D.17.000', lotcode: '27.F1', season: 'F1', ptronhand: '5', ptrreviewed: '0', ptravailable: '5', s_lts: '-400' },
    { unique_id: 'master-c', itemcode: '006009.031.1', locationcode: 'F.14.000', lotcode: '27.S1', season: 'S1', ptronhand: '226', ptrreviewed: '0', ptravailable: '226', s_lts: '2838', loc_match_qty: '967' },
  ]);
  const lotFallback = index.resolveSuspendTagDisplay({ itemcode: '006009.031.1', locationcode: '0.00.111', lotcode: '27.F1' });
  assert.equal(lotFallback.status, 'ready');
  assert.equal(lotFallback.matchLevel, 'item-lot');
  assert.equal(lotFallback.row.PTRONHAND, 40);
  assert.equal(lotFallback.row.S_LTS, -400);
  assert.equal(lotFallback.row.LOC_ON_HAND, 0);
  assert.equal(lotFallback.row.LOC_MATCH_QTY, 0, 'photo match from another physical location is not shown on the tag location');
  const locationScopedIndex = context.AgMetricQueueInventory.createIndex([
    { unique_id: 'target-loc', itemcode: '006009.031.1', locationcode: '0.00.111', lotcode: '27.F1', ptronhand: '4', ptrreviewed: '0', ptravailable: '4', loc_match_qty: '11' },
    { unique_id: 'other-loc', itemcode: '006009.031.1', locationcode: 'F.14.000', lotcode: '27.S1', ptronhand: '226', ptrreviewed: '0', ptravailable: '226', loc_match_qty: '967' },
  ]);
  assert.equal(locationScopedIndex.resolveSuspendTagDisplay({ itemcode: '006009.031.1', locationcode: '0.00.111', lotcode: '27.F1' }).row.LOC_MATCH_QTY, 11);
  const cavFallback = index.resolveSuspendTagDisplay({ itemcode: '099999.001.1', locationcode: '0.00.111', lotcode: '27.F1' }, [
    { unique_id: 'cav-1', itemcode: '099999.001.1', available: '12' },
  ]);
  assert.equal(cavFallback.matchLevel, 'cav-item');
  assert.equal(cavFallback.row.PTRAVAILABLE, 12);
  const cavMissingMetric = index.resolveSuspendTagDisplay({ itemcode: '088888.001.1', locationcode: '0.00.111', lotcode: '27.F1' }, [
    { unique_id: 'cav-2', itemcode: '088888.001.1', spec: 'Known row, unknown quantity' },
  ]);
  assert.equal(cavMissingMetric.row.PTRAVAILABLE, null);
  assert.equal(cavMissingMetric.row.S_LTS, null);
  const source = readComposedAppSource();
  assert.match(source, /resolveSuspendTagDisplay\(identity, cavInventory\)/);
  assert.match(source, /data-suspend-tag-card="true"/);
  assert.match(source, /data-queue-metric="\$\{metricIdFor\(label\)\}"/);
  for (const metric of ["'On Hand': 'on-hand'", "Review: 'review'", "Available: 'available'", "'Open Stock': 'open-stock'", "'Loc Photo Match': 'loc-photo-match'", "'Loc On Hand': 'loc-on-hand'"]) {
    assert.ok(source.includes(metric), `${metric} is exposed to the watchdog sensor`);
  }
  assert.match(source, /data-queue-metric="reason"/);
  assert.match(source, /knownLocationOnHand: metricRow\.LOC_ON_HAND \?\? suspendMetrics\?\.LOC_ON_HAND/);
  assert.match(source, /knownLocationPhotoMatch: suspendMetrics\?\.LOC_MATCH_QTY/);
  assert.match(source, /knownLocationPhotoMatch !== null && knownLocationPhotoMatch !== undefined/);
  assert.match(source, /knownLocationOnHand !== null && knownLocationOnHand !== undefined && Number\.isFinite/);
  const queueState = extractFunction(source, 'getQueueCardInventoryState');
  const reclassLookup = extractFunction(source, 'getOperationalCardInventoryRow');
  assert.doesNotMatch(queueState, /resolveSuspendTagDisplay/);
  assert.match(reclassLookup, /getQueueCardInventoryRow\(item, 'request'\)/);
  assert.doesNotMatch(reclassLookup, /suspend_tag_metrics|resolveSuspendTagDisplay/);
  let renderedMetrics;
  const serverContext = vm.createContext({
    isDockSuspendDcRequestMirrorRow: () => true,
    getQueueCardInventoryState: () => { throw new Error('Server-enriched cards must not queue another identity read'); },
    getSuspendTagMetricDisplayFallback: () => { throw new Error('Server-enriched cards do not require a local snapshot'); },
    buildInventoryQuantityChipsHtml: (row, options) => { renderedMetrics = { row, options }; return 'metrics'; }
  });
  vm.runInContext(source.match(/        function buildQueueInventoryMetricsHtml\([^]*?^        }/m)[0] + '\nthis.build = buildQueueInventoryMetricsHtml;', serverContext);
  assert.equal(serverContext.build({ suspend_tag_metrics: { PTRONHAND: 136, PTRREVIEWED: 0, LOC_ON_HAND: 0, LOC_MATCH_QTY: 0 } }), 'metrics');
  assert.equal(renderedMetrics.row.PTRONHAND, 136);
  assert.equal(renderedMetrics.options.knownLocationOnHand, 0);
  assert.equal(renderedMetrics.options.knownLocationPhotoMatch, 0);
  assert.equal(renderedMetrics.options.hydrationStatus, 'ready');

  const renderContext = vm.createContext({
    parseAppNumber: value => value == null ? null : Number(value),
    preserveCardLocationOnHand: (_row,value) => value,
    escapeHtml: value => String(value ?? ''),
    normalizeCardQuantityValue: value => String(value ?? ''),
    getCardPtrOnHandValue: () => null,
    getCardPtrReviewedValue: () => null,
    getCardPtrAvailableValue: () => null,
    getCardOpenStockValue: () => null,
    formatLocPhotoMatchQtyValue: () => 'Not verified',
    getCardLocationOnHandServerAggregate: () => null,
    getCardLocationOnHandValue: () => null,
  });
  const quantityBuilder = source.match(/        function buildInventoryQuantityChipsHtml\([^]*?^        }/m)?.[0];
  assert.ok(quantityBuilder, 'quantity renderer is present');
  vm.runInContext(`${quantityBuilder}\nthis.render = buildInventoryQuantityChipsHtml;`, renderContext);
  const html = renderContext.render({ PTRONHAND: 136, PTRREVIEWED: 0, PTRAVAILABLE: 136, S_LTS: 116, LOC_MATCH_QTY: 0, LOC_ON_HAND: 0 }, {
    canonical: true, preserveUnknown: true, sourceView: 'request', queueMetricTelemetry: true,
    knownLocationOnHand: 0, knownLocationPhotoMatch: 0,
  });
  assert.match(html, /data-queue-metric="loc-photo-match">0<\/span>/);
  assert.match(html, /data-queue-metric="loc-on-hand">0<\/span>/);
});

test('existing photo and spec allow each physical Suspend Tag to complete', () => {
  const html=readComposedAppSource();
  const ctx=vm.createContext({fullInventory:[{ITEMCODE:'004380.010.1',LOCATIONCODE:'C.09.000',LOTCODE:'27.F1',PHOTO_LINK:'https://example.invalid/photo.jpg',SPEC:'6-8" H'}],suspendTagRawSourceRows:[],
    firstNonEmptyValue:(...values)=>values.find(v=>v!=null&&String(v).trim()!=='')||'',
    getDockSuspendDcRequestCompletionValues:()=>({match:'',spec:'',avNote:''}), parseLocMatchPercent:v=>v===''?null:Number(v),
    hasDockSuspendDcRequestCompletionPhoto:()=>false, requiresAvNoteForCompletion:()=>true});
  for(const name of ['getSuspendTagExistingReview','getDockSuspendDcRequestCompletionReadiness']) vm.runInContext(html.match(new RegExp('        function '+name+'\\([^]*?^        }','m'))[0],ctx);
  for(const uid of ['dock39-drop40','dock50-drop50','dock56-drop10','dock56-drop70']) {
    const row={UNIQUE_ID:uid,ITEMCODE:'004380.010.1',LOCATIONCODE:'C.09.000',LOTCODE:'27.F1'};
    const ready=ctx.getDockSuspendDcRequestCompletionReadiness(row,row);
    assert.equal(ready.ready,true,uid); assert.equal(ready.values.match,'100'); assert.equal(ready.values.avNote,'SPEC - 6-8" H');
  }
});

test('Suspend review reuse keeps source versions and approval locks in the atomic command', () => {
  const sql=readFileSync(new URL('../supabase/migrations/20261021160000_suspend_existing_review_v1.sql',import.meta.url),'utf8');
  for (const contract of ['SUSPEND_TAG_SOURCE_CHANGED','SUSPEND_TAG_VERSION_CHANGED','SUSPEND_TAG_TOKEN_CONFLICT','SUSPEND_TAG_REVIEW_LOCKED','suspend_tag_private.validate_review(edited)','suspend_tag_private.existing_review(edited)','sibling.itemcode=s.itemcode']) assert.ok(sql.includes(contract),contract);
});

test('confirmed priority report uses frozen quantity but retains quantity-action conflicts', () => {
  const code=readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
  const tree=ts.createSourceFile('Code.gs',code,ts.ScriptTarget.Latest,true);
  let implementation; function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='buildProtectedLiveEditReportRows_') implementation=n.getText(tree);ts.forEachChild(n,visit);} visit(tree);
  const ctx=vm.createContext({RECLASS_ACTION_WORKFLOW_V5_POLICY_VERSION_:'v5',normalizeInventoryTransactionText_:String,
    buildReclassInquiryActionRowsV3_:(_tx,rows,overlays)=>({ok:overlays[0].expected.ptronhand===rows[0].ptronhand,rows:[{unique_id:'row',values:{priority:''},changedFields:[]}]}),
    RECLASS_INQUIRY_HOLD_ACTIONS_V3_:['hold','stop_ship','take_off_hold','off_stop_ship']});
  vm.runInContext(implementation,ctx);
  const rows=[{unique_id:'row',ptronhand:'144'}],live={rowsByUid:new Map([['row',rows[0]]]),editsByUid:new Map([['row',{priority:'1'}]])};
  const overlay={unique_id:'row',expected:{ptronhand:'150'},proposals:[{action:'priority_change',priority:'1'}]};
  assert.equal(ctx.buildProtectedLiveEditReportRows_({},rows,[overlay],live,{} )[0].values.priority,'1');
  overlay.proposals=[{action:'move_up',quantity:1}];
  assert.throws(()=>ctx.buildProtectedLiveEditReportRows_({},rows,[overlay],live,{}),/RECLASS_CONFLICT/);
});

test('Reclass recovery reads committed receipts and restores an unloaded source by identity', () => {
  const html=readComposedAppSource();
  assert.match(html,/const receipt = await driveReclassApi\('status'/);
  const reopen=html.match(/        async function reopenReclassDeliveryJob\([^]*?^        }/m)[0];
  assert.match(reopen,/requestInventoryRead\('master_page'/);
  assert.doesNotMatch(reopen,/The source row is not loaded/);
  assert.match(html,/Dismiss inquiry notification/);
  assert.match(appApi,/result\.jobId[\s\S]*receipt\[field\]/);
});

test('a committed priority receipt survives failed email status without rollback', async () => {
  const html=readComposedAppSource();let rollback=0,applied=0;
  const receipt={ok:false,status:'conflict',liveEdits:[{unique_id:'006489.021.1/G.24.000/27.F1',priority:'1'}]};
  const ctx=vm.createContext({getInventoryStatusSync:()=>({begin:()=> 'pending',confirm:async()=>{},rollback:async()=>{rollback++;},revalidate:()=>{}}),
    buildInventoryStatusPatches:()=>[{unique_id:'row',priority:'1'}],getArgosReclassLiveEditIdentityKey:()=> 'actor',getSupabaseReadIdentityScope:()=> 'actor',
    inventoryStatusPendingSaves:new Map(),clearTimeout,document:{getElementById:()=>null},applyConfirmedArgosReclassLiveEdits:()=>{applied++;},
    window:{GncDatabase:{confirmedReclassLiveEditsFromResult:()=>({liveEdits:[]})}}});
  vm.runInContext(html.match(/        async function runInventoryStatusMutation\([^]*?^        }/m)[0],ctx);
  const result=await ctx.runInventoryStatusMutation({idempotencyToken:'same-command'},async()=>receipt);
  assert.equal(result,receipt);assert.equal(applied,1);assert.equal(rollback,0);assert.equal(ctx.inventoryStatusPendingSaves.size,0);
});

test('candidate handler forwards only exact inventory IDs and the verified actor to the atomic RPC',async()=>{
 const src=readFileSync(new URL('../supabase/functions/_shared/suspend-tag.ts',import.meta.url),'utf8');
 const body=src.replace(/^import[^]*?;\s*$/gm,'').replace(/^export /gm,'');
 const code=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const calls=[],ctx=vm.createContext({jsonValue:value=>value});
 vm.runInContext(code,ctx);
 const actor={id:'actor-native',username:'dylan_collyge',nativeSessionId:'session-native'};
 const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:{ok:true,rows:[{unique_id:'choice',locationcode:'B.08.000',lotcode:'26.F1'},{unique_id:'false',locationcode:'0.00.111',suspend_candidate_state:'replaced',quantityordered:'0'}]},error:null};}};
 const command={operation:'add_candidates',commandId:'command-stable',expectedVersion:0,payload:{sourceUid:'dock35-drop80-010248.021.1',expectedLastUpdated:'2026-10-21T00:00:00Z',inventoryIds:['inventory-b08-26f1']}};
 const result=await ctx.handleSuspendTag(client,actor,command);
 assert.equal(result.rows[0].locationcode,'B.08.000');assert.equal(result.rows[1].suspend_candidate_state,'replaced');
 assert.equal(calls[0][0],'suspend_tag_command_v1');assert.equal(calls[0][1].p_actor_id,'actor-native');
 assert.equal(calls[0][1].p_session_id,'session-native');assert.equal(calls[0][1].p_command_id,'command-stable');
 await assert.rejects(ctx.handleSuspendTag(client,{...actor,username:'nelly_aguilar'},command),/FORBIDDEN/);
 await assert.rejects(ctx.handleSuspendTag(client,actor,{...command,payload:{...command.payload,quantityordered:'999'}}),/FIELD_FORBIDDEN/);
});
test('group transaction fences identity, replaces False Block, resolves all candidates and retains idempotency',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261021170000_suspend_candidates_request_preload_v1.sql',import.meta.url),'utf8');
 for(const identity of ['stopnumber','transactionnumber','planstart','consigneeidentityid','salesrepid','itemcode','suspend_order_quantity'])assert.ok(sql.includes(identity));
 assert.match(sql,/suspend_candidate_state='replaced',suspend=null,suspend_to=null,quantityordered='0'/);
 assert.match(sql,/case when decision='approve' and r.unique_id=chosen then 'approved' else 'denied' end/);
 assert.match(sql,/suspend_candidate_state='canceled'/);
 assert.match(sql,/SUSPEND_TAG_TOKEN_CONFLICT/);assert.match(sql,/SUSPEND_TAG_APPROVAL_SUPERSEDED/);
 assert.match(sql,/rep_id<>actor.id/);assert.match(sql,/session_active\(p_actor_id, p_session_id\)/);
 assert.match(sql,/retain_suspend_candidate_decision/);
 assert.match(appApi,/eventType: "suspend_tag_approval_requested"/);
});


test('candidate receipt removes the false block from active Suspend arrays immediately',()=>{
 const source=readComposedAppSource().match(/        function applySuspendCandidateRows\([^]*?^        }/m)[0];
 const stale={UNIQUE_ID:'false',LOCATIONCODE:'0.00.111'};
 const ctx=vm.createContext({socInventory:[{...stale}],socRawSourceRows:[{...stale}],suspendTagInventory:[{...stale}],suspendTagRawSourceRows:[{...stale}],upsertRealtimeRow:(rows,row)=>{const i=rows.findIndex(x=>x.UNIQUE_ID===row.UNIQUE_ID);if(i<0)rows.push(row);else rows[i]=row;},refreshRealtimeDetailLookupIndexes(){},invalidateDockSuspendDcSourceRowLookup(){},requestScopedItemsCacheKey:'',refreshLocalDockSuspendDcRequestState(){},markViewDirty(){},isViewVisible:()=>false});
 vm.runInContext(source,ctx);ctx.applySuspendCandidateRows([{unique_id:'false',locationcode:'0.00.111',suspend_candidate_state:'replaced'},{unique_id:'real',itemcode:'010248.021.1',locationcode:'B.08.000',lotcode:'26.F1',ptronhand:'16'}]);
 assert.equal(ctx.suspendTagInventory.length,1);assert.equal(ctx.suspendTagInventory[0].LOCATIONCODE,'B.08.000');assert.equal(ctx.suspendTagInventory[0].LOTCODE,'26.F1');
 const migration=readFileSync(new URL('../supabase/migrations/20261021210000_eval_browse_suspend_receipts_v1.sql',import.meta.url),'utf8');assert.ok(migration.includes('removed_false_block'));assert.ok(migration.includes('added_rows'));
});


test('Reclass stock migration preserves physical identity, season import overrides and Sharon recipient authority', () => {
 const sql=readFileSync(new URL('../supabase/migrations/20261021220000_reclass_season_stock_and_recipients.sql',import.meta.url),'utf8');
 for(const contract of ['inventory_stock_season_v1','inventory_season_stock_overrides_v1','stock_new','stock_old','inventory_live_overrides_v1_field_name_check','cav_acknowledged','seasonStocks','FLAME_GRASS_REPAIR_SOURCE_CHANGED'])assert.ok(sql.includes(contract),contract);
 assert.match(sql,/dylan_collyge','megan_kelly','sharon_combs',actor_key/);
 assert.match(sql,/before insert or update or delete on public.ph_cav_import/);
 assert.match(appApi,/runtime.waitUntil\(task\)/);
 const dispatch=appApi.slice(appApi.indexOf('function dispatchReclassDeliveryNow'),appApi.indexOf('export async function handleDriveReclassAction'));
 assert.doesNotMatch(dispatch,/await invokeReclassDeliveryWorkerNow/);
});


test('valid dataset aliases and default select retain server projection and transient error semantics', () => {
  assert.match(appApi, /function normalizeDatasetReadAlias/);
  assert.match(appApi, /DATASET_READ_UNAVAILABLE/);
  assert.doesNotMatch(appApi, /return errorResponse\("Dataset read parameters are invalid.", 400, \{ code \}\);/);
  const runtime = readComposedAppSource();
  assert.match(runtime.match(/function setReqTab\([^]*?^        }/m)[0], /resetQueueReadCooldowns/);
});


test('Suspend projections include all four deployed candidate columns in the generated contract', () => {
  const generated=readFileSync(new URL('../services/database-contracts.generated.ts',import.meta.url),'utf8');
  const contracts=JSON.parse(generated.slice(generated.indexOf(' = {')+3).trim().replace(/;$/, ''));
  const bridge=readFileSync(new URL('../services/databaseRest.ts',import.meta.url),'utf8');
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(bridge,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,URLSearchParams,require:name=>name.includes('generated')?{contracts}:{}});
  const fields=['unique_id','suspend_candidate_group','suspend_candidate_state','suspend_order_quantity','suspend_origin_uid'];
  assert.doesNotThrow(()=>module.exports.validateQuery('ph_soc_master','select='+fields.join(',')));
  assert.throws(()=>module.exports.validateQuery('ph_soc_master','select=unreviewed_secret_column'));
  const ctx=vm.createContext({}); vm.runInContext(ts.transpileModule(extractFunction(appApi,'normalizeDatasetReadAlias')+extractFunction(appApi,'validateDatasetReadParams'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
  for(const [alias,canonical] of Object.entries({suspend:'suspend_tag',suspend_tag:'suspend_tag',ph_soc_master:'soc',location_move:'location_moves',location_moves:'location_moves',recount:'sales_office',shear_list:'shear',eval_work:'eval_work',bunch_notes:'bunch_notes',count_review:'count_review',requests:'request_queue',request_queue:'request_queue',request_history:'request_history'})) assert.equal(ctx.normalizeDatasetReadAlias(alias),canonical);
  ctx.DATASET_READ_PAGE_MAX=500;
  assert.equal(ctx.validateDatasetReadParams({action:'dataset_read',dataset:'suspend',params:{select:'*'}}).limit,250);
  assert.throws(()=>ctx.validateDatasetReadParams({params:{select:'private_payload'}}));
  assert.throws(()=>ctx.validateDatasetReadParams({params:{offset:-1}}));
});
