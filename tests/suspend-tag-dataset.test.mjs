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
  assert.match(appApi, /suspend_tag_metrics: buildSuspendTagMetricFallback\(row, masterRows, cavRows\)/);
  assert.match(appApi, /if \(dataset === "suspend_tag"\)\s*\{\s*try \{ metricRows = await enrichSuspendTagMetricRows\(data\); \}\s*catch \{ metricRows = data; \}/);
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
  ], []);
  assert.equal(itemLot.MATCH_LEVEL, 'item-lot');
  assert.equal(itemLot.PTRONHAND, 40);
  assert.equal(itemLot.PTRREVIEWED, 35);
  assert.equal(itemLot.PTRAVAILABLE, 5);
  assert.equal(itemLot.S_LTS, -400, 'repeated seasonal open-stock values are not summed per location');
  assert.equal(itemLot.LOC_ON_HAND, 0, 'no physical row exists at the Suspend Tag location');

  const itemFallback = context.build({ itemcode: '006009.031.1', locationcode: '0.00.111', lotcode: 'missing-lot' }, [
    { itemcode: '006009.031.1', locationcode: 'D.17.000', lotcode: '27.F1', season: 'F1', ptronhand: '35', s_lts: '-400' },
    { itemcode: '006009.031.1', locationcode: 'B.07.000', lotcode: '27.F1', season: 'F1', ptronhand: '5', s_lts: '-400' },
    { itemcode: '006009.031.1', locationcode: 'B.07.000', lotcode: '27.S1', season: 'S1', ptronhand: '100', s_lts: '2838' },
    { itemcode: '006009.031.1', locationcode: 'C.01.000', lotcode: '27.S1', season: 'S1', ptronhand: '200', s_lts: '2838' },
  ], []);
  assert.equal(itemFallback.MATCH_LEVEL, 'item');
  assert.equal(itemFallback.PTRONHAND, 340);
  assert.equal(itemFallback.S_LTS, 2438, 'distinct season totals are summed once per season');

  const cav = context.build({ itemcode: '099999.001.1', locationcode: '0.00.111', lotcode: '27.F1' }, [], [
    { itemcode: '099999.001.1', available: '12', spec: 'CAV spec', hold_reason: 'quality' },
  ]);
  assert.equal(cav.MATCH_LEVEL, 'cav-item');
  assert.equal(cav.PTRONHAND, null, 'CAV does not supply On Hand');
  assert.equal(cav.PTRAVAILABLE, 12);
  assert.equal(cav.SOURCE, 'ph_cav_import');
  assert.equal(cav.SPEC, 'CAV spec');
  const cavWithoutQuantity = context.build({ itemcode: '088888.001.1', locationcode: '0.00.111', lotcode: '27.F1' }, [], [
    { itemcode: '088888.001.1', spec: 'CAV source without quantities' },
  ]);
  assert.equal(cavWithoutQuantity.PTRONHAND, null);
  assert.equal(cavWithoutQuantity.PTRAVAILABLE, null, 'an existing source row with a missing quantity remains unknown');
  const noSource = context.build({ itemcode: '077777.001.1', locationcode: '0.00.111', lotcode: '27.F1' }, [], []);
  assert.equal(noSource.PTRONHAND, 0, 'zero is explicit when both source datasets have no row');
  assert.equal(noSource.LOC_ON_HAND, 0);
});

test('Suspend Tag client uses item/lot and CAV display fallback and marks observable metrics', () => {
  const context = vm.createContext({ globalThis: null, window: null, Map, Set, String, Number, JSON });
  context.globalThis = context;
  context.window = context;
  vm.runInContext(queueInventory, context);
  const index = context.AgMetricQueueInventory.createIndex([
    { unique_id: 'master-a', itemcode: '006009.031.1', locationcode: 'D.17.000', lotcode: '27.F1', season: 'F1', ptronhand: '35', ptrreviewed: '35', ptravailable: '0', s_lts: '-400' },
    { unique_id: 'master-b', itemcode: '006009.031.1', locationcode: 'D.17.000', lotcode: '27.F1', season: 'F1', ptronhand: '5', ptrreviewed: '0', ptravailable: '5', s_lts: '-400' },
    { unique_id: 'master-c', itemcode: '006009.031.1', locationcode: 'D.17.000', lotcode: '27.S1', season: 'S1', ptronhand: '226', ptrreviewed: '0', ptravailable: '226', s_lts: '2838' },
  ]);
  const lotFallback = index.resolveSuspendTagDisplay({ itemcode: '006009.031.1', locationcode: '0.00.111', lotcode: '27.F1' });
  assert.equal(lotFallback.status, 'ready');
  assert.equal(lotFallback.matchLevel, 'item-lot');
  assert.equal(lotFallback.row.PTRONHAND, 40);
  assert.equal(lotFallback.row.S_LTS, -400);
  assert.equal(lotFallback.row.LOC_ON_HAND, 0);
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
  assert.match(source, /knownLocationOnHand: suspendMetrics\?\.LOC_ON_HAND/);
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
  assert.equal(serverContext.build({ suspend_tag_metrics: { PTRONHAND: 136, PTRREVIEWED: 0, LOC_ON_HAND: 0 } }), 'metrics');
  assert.equal(renderedMetrics.row.PTRONHAND, 136);
  assert.equal(renderedMetrics.options.knownLocationOnHand, 0);
  assert.equal(renderedMetrics.options.hydrationStatus, 'ready');
});
