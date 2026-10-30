import { readComposedRuntimeSource } from '../scripts/composed-app-source.mjs';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: eval
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const engineSource = readFileSync(new URL('../assets/eval-reports-engine.js', import.meta.url), 'utf8');
const context = vm.createContext({ Intl, Date, Map, Set, Object, Array, String, Number, Math });
context.globalThis = context;
vm.runInContext(engineSource, context, { filename: 'eval-reports-engine.js' });
const engine = context.GncEvalReports;

test('Manager report sessions and in-flight responses survive same-account permission refresh but retain denial and owner fences', async () => {
  const html = readComposedAppSource();
  const source = html.match(/        function getManagerReportPageController\([^]*?^        }/m)?.[0];
  assert.ok(source);
  const live = { module: { exports: {} }, AbortController };
  vm.runInNewContext(readFileSync(new URL('../assets/report-pages-live.js', import.meta.url), 'utf8'), live);
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  let owner = 'account-a:login-1', gate = deferred(), requests = 0, clears = 0;
  const runtime = vm.createContext({ managerReportPageController: null, managerReportVisibleRows:new Map(), AbortController,
    getSupabaseReadIdentityScope: () => owner,
    appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'access-v1' } },
    nativeAuthProfile: { id: 'account-a', active: true }, window: {}, activeHomeTab: 'ncr-approvals',
    getCurrentVisibleViewId:() => 'managers', MANAGER_EVAL_REPORTS_2_VIEW:'eval2',
    APP_API_FUNCTION_URL: 'fixture.invalid', APP_VERSION: 'fixture', SUPABASE_READ_TIMEOUT_MS: 10000,
    postAppFunctionJson: async () => { requests++; return gate.promise; },
    staleSupabaseReadScopeError: () => Object.assign(new Error('Account changed'), { code: 'DATASET_READ_SCOPE_CHANGED' }),
    canViewManagerEvalReports: () => true, canViewManagerEvalReports2: () => true,
    canViewAssignedItemsExport: () => true, canViewManagerSeasonPriority: () => true,
    isManagerApprovalTab: () => true, canAccessView: () => true,
    GncReportPagesLive: { createController: options => live.module.exports.createController({ ...options,
      loadModule: async () => ({ createReportSession: config => ({ refresh: config.transport, read: config.transport, clear() {} }) }),
      onReady() {}, onClear: () => { clears++; }, onMetadata() {}, onState() {},
    }) },
  });
  vm.runInContext(source, runtime);
  const controller = runtime.getManagerReportPageController();
  const ready = controller.initialize();
  await settle();
  runtime.appAccessSnapshotState.snapshot.dataPermissionVersion = 'access-v2';
  gate.resolve({ ok: true, data: { surfaces: ['season-priority', 'eval2', 'approval'], approvalTabs: ['ncr-approvals'] } });
  await ready;
  assert.equal(requests, 1);
  assert.ok(controller.getSession());
  assert.equal(clears, 0, 'background access refresh must not destroy mounted rows or draft selections');
  gate = deferred();
  const rows = controller.readPage({ surface: 'season-priority', operation: 'rows' });
  await settle();
  runtime.appAccessSnapshotState.snapshot.dataPermissionVersion = 'access-v3';
  gate.resolve({ ok: true, data: { sourceRevision: 'server-v1', rows: [{ uid: 'published-row' }] } });
  assert.deepEqual((await rows).rows, [{ uid: 'published-row' }]);
  gate = deferred();
  const denied = controller.readPage({ surface: 'eval2', operation: 'rows' });
  await settle();
  runtime.nativeAuthProfile.active = false;
  gate.resolve({ ok: true, data: { rows: [{ uid: 'must-not-publish' }] } });
  await assert.rejects(denied, error => error.status === 403);
  runtime.nativeAuthProfile.active = true;
  gate = deferred();
  const leftReport = controller.readPage({ surface: 'eval2', operation: 'rows' });
  await settle();
  controller.suspendReads();
  gate.resolve({ ok: true, data: { rows: [{ uid: 'must-not-reopen' }] } });
  await assert.rejects(leftReport, error => error.name === 'AbortError');
  gate = deferred();
  const switched = controller.readPage({ surface: 'eval2', operation: 'rows' });
  await settle();
  owner = 'account-b:login-2';
  gate.resolve({ ok: true, data: { rows: [{ uid: 'must-not-publish' }] } });
  await assert.rejects(switched, error => error.code === 'DATASET_READ_SCOPE_CHANGED');
  controller.clear();
});

test('Manager report read gates accept only an existing published snapshot proof and preserve the installed function bodies', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261021014500_manager_published_read_continuity_v1.sql', import.meta.url), 'utf8');
  for (const signature of ['public.manager_report_read_v2(jsonb)', 'public.manager_ncr_outbox_metadata_v1(text,text)', 'private.manager_report_enrich_location_on_hand_v1(jsonb,boolean)', 'private.manager_report_season_page_v2(uuid,jsonb,text,integer,integer,text)']) assert.ok(migration.includes(signature));
  assert.match(migration, /state='ready' or coalesce\(\(app_sync_private\.published_snapshot_read_proof\(key,revision\)->>'publishedReadable'\)::boolean,false\)/);
  assert.match(migration, /source_revision is null or \(source_state is distinct from 'ready'[\s\S]*?and not coalesce/);
  assert.match(migration, /length\(replace\(definition,patch\.old_gate,''\)\)\) \/ length\(patch\.old_gate\) <> 1/);
  assert.match(migration, /execute replace\(definition,patch\.old_gate,patch\.new_gate\)/);
  assert.doesNotMatch(migration, /update public\.|grant execute|disable trigger|mutationAllowed/);
  const canonical = readFileSync(new URL('../supabase/migrations/20261014110620_eval2_shared_low_stock_threshold.sql', import.meta.url), 'utf8');
  assert.match(canonical, /private\.eval_work_assert_actor_v1/);
  assert.match(canonical, /private\.inventory_row_assignment_policy_active_v1\(\)/);
  assert.match(canonical, /p_payload->>'sourceRevision' <> source_revision/);
  assert.match(canonical, /manager_report_eval2_forbidden/);
});

test('set-based Eval2 report patch retains the authorization and published-read contract with bounded grouping', () => {
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  const migrationName = readdirSync(migrationDir).find(name => name.endsWith('_manager_report_set_based_read_v1.sql'));
  assert.ok(migrationName, 'the set-based report migration is registered');
  const patch = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8');
  const migrationRegistry = readFileSync(new URL('../scripts/apply-item-low-stock-migration.mjs', import.meta.url), 'utf8');
  assert.ok(migrationRegistry.includes(`managerReportSetBasedReadMigrationName = '${migrationName}'`));
  assert.match(migrationRegistry, /releaseDatabaseMigrations[\s\S]*managerReportSetBasedReadMigrationName/);
  const canonical = readFileSync(new URL('../supabase/migrations/20261014110620_eval2_shared_low_stock_threshold.sql', import.meta.url), 'utf8');
  const published = readFileSync(new URL('../supabase/migrations/20261021014500_manager_published_read_continuity_v1.sql', import.meta.url), 'utf8');
  assert.match(patch, /pg_get_functiondef\('public\.manager_report_read_v2\(jsonb\)'::regprocedure\)/);
  assert.match(patch, /active_assignment_users as materialized/);
  assert.match(patch, /effective_owners as materialized/);
  assert.match(patch, /page_keys as materialized[\s\S]*?limit page_limit offset page_offset/);
  assert.match(patch, /select count\(\*\) from group_keys/);
  assert.match(patch, /revoke all on function public\.manager_report_read_v2\(jsonb\) from public,anon,authenticated/);
  assert.match(patch, /grant execute on function public\.manager_report_read_v2\(jsonb\) to service_role/);
  assert.doesNotMatch(patch, /create or replace function public\.manager_report_read_v2/);
  for (const contract of [
    /private\.eval_work_assert_actor_v1\(p_payload->>'actorUsername'\)/,
    /p_payload->>'sourceRevision' <> source_revision/,
    /manager_report_eval2_forbidden/,
    /filters->'assignedUsers'/,
    /filters->'seasons'/,
    /filters->>'itemCode'/,
    /filters->>'uniqueId'/,
    /filters->'gridColumns'/,
    /page_offset integer := greatest\(0,coalesce\(\(p_payload->>'offset'\)::integer,0\)\)/
  ]) assert.match(canonical, contract);
  assert.match(published, /published_snapshot_read_proof\(key,revision\)->>'publishedReadable'/);
  assert.match(published, /source_revision is null or \(source_state is distinct from 'ready'[\s\S]*?published_snapshot_read_proof/);
});

test('Eval2 batched preview migration bounds cards and retains authoritative report counts', () => {
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  const migrationName = readdirSync(migrationDir).find(name => name.endsWith('_manager_eval2_batched_preview_v1.sql'));
  assert.ok(migrationName, 'the bounded Eval2 preview migration exists');
  const patch = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8');
  const registry = readFileSync(new URL('../scripts/apply-item-low-stock-migration.mjs', import.meta.url), 'utf8');
  assert.ok(registry.includes(`managerEval2BatchedPreviewMigrationName = '${migrationName}'`));
  assert.match(registry, /releaseDatabaseMigrations[\s\S]*managerEval2BatchedPreviewMigrationName/);
  assert.match(patch, /eval2_preview_candidates as materialized/);
  assert.match(patch, /preview_ordinal<=18/);
  assert.match(patch, /'previewRows'/);
  assert.match(patch, /'previewHasMore'/);
  assert.match(patch, /'reportMatchCount',\(select count\(\*\) from classified where cardinality\(report_ids\)>0\)/);
  assert.match(patch, /jsonb_agg\(private\.manager_report_enrich_location_on_hand_json_v1/);
  assert.match(patch, /jsonb_typeof\(value\) in \('array','object'\)/);
  assert.match(patch, /manager_report_actor_required/);
  assert.match(patch, /manager_report_eval2_forbidden/);
  assert.match(patch, /published_snapshot_read_proof/);
  assert.match(patch, /manager_report_source_revision_changed/);
  assert.match(patch, /revoke all on function public\.manager_report_read_v2\(jsonb\) from public,anon,authenticated/);
  assert.match(patch, /grant execute on function public\.manager_report_read_v2\(jsonb\) to service_role/);
});

test('Season Priority displays a proven published snapshot without relabeling an interrupted source ready', async () => {
  const html = readComposedAppSource();
  const source = html.match(/        async function readManagerSeasonPriorityPageMetadata\([^]*?^        }/m)?.[0];
  assert.ok(source);
  for (const proven of [true, false]) {
    const state = { account: 'worker' };
    const runtime = vm.createContext({ managerSeasonPriorityState: state, currentUser: 'worker',
      normalizeSessionIdentity: value => value, buildManagerReportPageQuery: () => ({ surface: 'season-priority', operation: 'metadata' }) });
    vm.runInContext(source, runtime);
    const page = { sourceRevision: 'report-v1', metadata: { inventoryState: 'interrupted', publishedReadable: proven,
      inventoryRevision: 8417, assignedToOptions: [{ value: 'worker', label: 'Worker' }] } };
    const controller = { load: async () => page };
    if (proven) {
      assert.equal(await runtime.readManagerSeasonPriorityPageMetadata(controller, state), page);
      assert.equal(state.loaded, true);
      assert.equal(state.inventoryState, 'interrupted');
      assert.equal(state.readOnlySnapshot, true);
      assert.equal(state.options[0].value, 'worker');
    } else await assert.rejects(runtime.readManagerSeasonPriorityPageMetadata(controller, state), /Inventory is updating/);
  }
});

test('SQL location-base fixture qualifies for the configured Eval1 priority report', () => {
  const fixture = readFileSync(new URL('../supabase/tests/manager_report_read_v2_test.sql', import.meta.url), 'utf8');
  const currentSeason = fixture.match(/"seasonCode":"([A-Z0-9]+)"/)[1];
  const rows = [...fixture.matchAll(/'MRV2-BASE-[12]','MRV2-BASE','Location Base Fixture','#2','([^']+)','([^']+)','10','8','([^']+)','([^']+)'/g)]
    .map(match => ({ ITEMCODE: 'MRV2-BASE', LOCATIONCODE: match[1], LOTCODE: match[2], PRIORITY: match[3], SEASON: match[4], SALEYEAR: '27' }));
  assert.equal(rows.length, 2);
  const classified = engine.classifyRows(rows, { currentSeason, currentSalesYear: 2027 });
  assert.equal(classified.reports['s1-with-pri'].length, 2);
  assert.deepEqual(Array.from(classified.reports['s1-with-pri'], row => row.LOCATIONCODE).sort(), ['E.01.001', 'E.01.002']);
});

test('multi-report selection preserves union, exact row deduplication and server-owned Queue membership', () => {
  const html = readComposedAppSource();
  const api = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/archive_migrations/20260904171529_eval_report2_multi_report_selection.sql', import.meta.url), 'utf8');
  const union = html.slice(html.indexOf('function getManagerEvalReport2Rows('), html.indexOf('function getManagerEvalReport2ItemCode('));
  assert.match(union, /getManagerEvalReport2SelectedReportIds\(\)/);
  assert.match(union, /getManagerEvalReport2RowKey\(row, i\)/);
  assert.match(union, /if \(!rows.has\(key\)\)/);
  assert.match(html, /data-manager-eval2-report-picker/);
  assert.match(html, /Apply Reports/);
  assert.doesNotMatch(html, /One Report Per Batch|locked until Clear/);
  assert.match(html, /reportIds: sourceMode === 'drive' \? \[\] : getManagerEvalReport2ItemReportIds\(entry.itemCode\)/);
  assert.match(api, /Array.isArray\(contextInput.reportIds\)/);
  assert.match(migration, /matching_report_ids := private.eval_report2_matching_reports_v1/);
  assert.match(migration, /cardinality\(private.eval_report2_matching_reports_v1\(work_row.source_context/);
  assert.match(migration, /eval_multi_grouped_delivery_guard/);
  assert.match(migration, /from public, anon, authenticated/);
});

function row(itemcode, season, saleyear, overrides = {}) {
  return {
    ITEMCODE: itemcode,
    SEASON: season,
    SALEYEAR: saleyear,
    ASSIGNEDTO: '',
    PRIORITY: '',
    S_LTS: 999,
    HOLDSTOPCODE: '',
    HOLDSTOPBEGINDATE: '',
    LOCATIONNOTEDATE: '',
    LOCATIONCODE: 'A.01.001',
    ...overrides
  };
}

function ids(rows) {
  return Array.from(rows, (record) => record.TEST_ID);
}

function independentScriptCompatibleReference(rows, options = {}) {
  const currentSalesYear = Number(options.currentSalesYear) < 100 ? 2000 + Number(options.currentSalesYear) : Number(options.currentSalesYear);
  const nextSalesYear = Number(options.nextSalesYear) < 100 ? 2000 + Number(options.nextSalesYear) : Number(options.nextSalesYear);
  const nextSeason = String(options.nextSeason || 'S1').toUpperCase();
  const lowStockMax = Number(options.lowStockMax ?? 150);
  const holdAgeDays = Number(options.holdAgeDays ?? 5);
  const locationNoteAgeDays = Number(options.locationNoteAgeDays ?? 10);
  const todayDay = Math.floor(Date.UTC(2026, 7, 20) / 86400000);
  const normalizeYear = (value) => {
    const parsed = Number(String(value ?? '').trim());
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed < 100 ? 2000 + parsed : parsed;
  };
  const dateDay = (value) => {
    const text = String(value ?? '').trim();
    let year;
    let month;
    let day;
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (match) [, year, month, day] = match.map(Number);
    else {
      match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
      if (!match) return null;
      month = Number(match[1]);
      day = Number(match[2]);
      year = Number(match[3]);
      if (year < 100) year += 2000;
    }
    const stamp = Date.UTC(year, month - 1, day);
    const check = new Date(stamp);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return Math.floor(stamp / 86400000);
  };
  const olderThan = (value, days) => {
    const parsed = dateDay(value);
    return parsed != null && todayDay - parsed > days;
  };
  const reportIds = ['s1-with-pri', 'u1', 'u2', 'u3', 'od-loc-note-date', 'hs-plus-5-days', 'get-off-hold', 'low-stock', 'no-pri', 'culls', 'not-in-f1'];
  const output = Object.fromEntries(reportIds.map((id) => [id, []]));
  const sourceRows = rows.filter((candidate) => {
    const season = String(candidate.SEASON || candidate.season || '').trim().toUpperCase().replace(/\s+/g, '');
    const desigItem = String(candidate.DESIGITEM || candidate.desigitem || candidate.DesigItem || '').trim().toUpperCase();
    return !((season === 'Y' || season === 'U3') && desigItem.includes('SHFT'));
  });
  for (const candidate of sourceRows) {
    const itemCode = String(candidate.ITEMCODE || '').trim().toUpperCase();
    if (!itemCode) continue;
    const itemRows = sourceRows.filter((record) => String(record.ITEMCODE || '').trim().toUpperCase() === itemCode);
    const season = String(candidate.SEASON || '').trim().toUpperCase();
    const year = normalizeYear(candidate.SALEYEAR);
    const validYear = year != null && year <= currentSalesYear;
    const hasPriority = itemRows.some((record) => String(record.PRIORITY || '').trim());
    const hasValidF1 = itemRows.some((record) => {
      const recordYear = normalizeYear(record.SALEYEAR);
      return String(record.SEASON || '').trim().toUpperCase() === 'F1' && recordYear != null && recordYear <= currentSalesYear;
    });
    const hasOldHold = itemRows.some((record) => olderThan(record.HOLDSTOPBEGINDATE, holdAgeDays));
    const lowStockItem = itemRows.some((record) => {
      const recordYear = normalizeYear(record.SALEYEAR);
      return String(record.SEASON || '').trim().toUpperCase() === 'F1'
        && recordYear != null && recordYear <= currentSalesYear && Number(record.S_LTS) < lowStockMax;
    });
    if (String(candidate.PRIORITY || '').trim() && season !== 'F1') output['s1-with-pri'].push(candidate.TEST_ID);
    if (season === 'U1') output.u1.push(candidate.TEST_ID);
    if (season === 'U2') output.u2.push(candidate.TEST_ID);
    if (season === 'U3') output.u3.push(candidate.TEST_ID);
    if (olderThan(candidate.LOCATIONNOTEDATE, locationNoteAgeDays)) output['od-loc-note-date'].push(candidate.TEST_ID);
    if (olderThan(candidate.HOLDSTOPBEGINDATE, holdAgeDays)) output['hs-plus-5-days'].push(candidate.TEST_ID);
    if (hasOldHold && !String(candidate.HOLDSTOPCODE || '').trim()) output['get-off-hold'].push(candidate.TEST_ID);
    if (lowStockItem && ((['U1', 'U2', 'U3', 'X'].includes(season) && validYear) || (season === nextSeason && year === nextSalesYear))) output['low-stock'].push(candidate.TEST_ID);
    if (!hasPriority) output['no-pri'].push(candidate.TEST_ID);
    if (season === 'X') output.culls.push(candidate.TEST_ID);
    if (!hasValidF1) output['not-in-f1'].push(candidate.TEST_ID);
  }
  for (const reportId of reportIds) output[reportId].sort();
  return output;
}

const now = new Date('2026-08-20T17:00:00Z');
const expectedAssignees = [
  'abigail_vazquez', 'bobby_adair', 'charley_robertson', 'dylan_collyge', 'ellen_ward',
  'jorge_colunga', 'josh_vann', 'megan_kelly', 'mitch_kaiser', 'zoe_green'
];

test('normalizes two-digit sales years and parses inventory dates without locale guessing', () => {
  assert.equal(engine.normalizeSalesYear('27'), 2027);
  assert.equal(engine.normalizeSalesYear(99), 2099);
  assert.equal(engine.normalizeSalesYear('2027'), 2027);
  assert.equal(engine.normalizeSalesYear(''), null);
  assert.equal(engine.parseInventoryDateEpochDay('8/9/26'), engine.parseInventoryDateEpochDay('2026-08-09'));
  assert.equal(
    engine.parseInventoryDateEpochDay('Wed Aug 12 2026 00:00:00 GMT-0500 (Central Daylight Time)'),
    engine.parseInventoryDateEpochDay('2026-08-12')
  );
  assert.equal(engine.parseInventoryDateEpochDay('2/30/2026'), null);
  assert.equal(engine.parseInventoryDateEpochDay('Mon Feb 30 2026 00:00:00 GMT-0600 (Central Standard Time)'), null);
  assert.equal(engine.parseInventoryDateEpochDay('not-a-date'), null);
});

test('HS+5days accepts serialized Apps Script dates, requires H/S, and keeps the strict boundary', () => {
  const rows = [
    row('SERIAL-H', 'F1', 27, { TEST_ID: 'serialized-h', HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: 'Wed Aug 12 2026 00:00:00 GMT-0500 (Central Daylight Time)' }),
    row('SERIAL-S', 'F1', 27, { TEST_ID: 'serialized-s', HOLDSTOPCODE: 'S', HOLDSTOPBEGINDATE: 'Fri Aug 14 2026 00:00:00 GMT-0500 (Central Daylight Time)' }),
    row('BOUNDARY', 'F1', 27, { TEST_ID: 'exact-five', HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: 'Sat Aug 15 2026 00:00:00 GMT-0500 (Central Daylight Time)' }),
    row('NO-CODE', 'F1', 27, { TEST_ID: 'no-code', HOLDSTOPCODE: '', HOLDSTOPBEGINDATE: 'Wed Aug 12 2026 00:00:00 GMT-0500 (Central Daylight Time)' }),
    row('INVALID', 'F1', 27, { TEST_ID: 'invalid-date', HOLDSTOPCODE: 'S', HOLDSTOPBEGINDATE: 'bad-date' })
  ];
  const result = engine.classifyScriptCompatibleRows(rows, {
    currentSeason: 'F1', currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27,
    settings: { holdAgeDays: 5 }, now
  });
  assert.deepEqual(ids(result.reports['hs-plus-5-days']), ['serialized-h', 'serialized-s']);
  assert.equal(result.diagnostics.invalidHoldStartDateCount, 1);
});

test('classifies the F1/27 reports with strict season, date, and low-stock boundaries', () => {
  const rows = [
    row('A', 'F1', '27', { TEST_ID: 'a-f1', ASSIGNEDTO: 'josh_vann', PRIORITY: '1', S_LTS: 100, HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: '8/14/2026', LOCATIONNOTEDATE: '8/9/2026' }),
    row('A', 'U1', 27, { TEST_ID: 'a-u1', ASSIGNEDTO: 'josh_vann' }),
    row('A', 'X', 27, { TEST_ID: 'a-x', ASSIGNEDTO: 'josh_vann' }),
    row('A', 'S1', 27, { TEST_ID: 'a-s1', ASSIGNEDTO: 'josh_vann' }),
    row('B', 'U2', 26, { TEST_ID: 'b-u2', ASSIGNEDTO: 'abigail_vazquez', HOLDSTOPBEGINDATE: 'invalid', LOCATIONNOTEDATE: 'invalid' }),
    row('C', 'F1', 28, { TEST_ID: 'c-future-f1', ASSIGNEDTO: 'bobby_adair', S_LTS: 10 }),
    row('D', 'F1', 27, { TEST_ID: 'd-boundary', ASSIGNEDTO: 'dylan_collyge', PRIORITY: '2', S_LTS: 150, HOLDSTOPBEGINDATE: '8/15/2026', LOCATIONNOTEDATE: '8/10/2026' }),
    row('E', 'S1', 27, { TEST_ID: 'e-s1-pri', ASSIGNEDTO: 'megan_kelly', PRIORITY: '3' })
  ];
  const result = engine.classifyRows(rows, {
    currentSeason: 'F1',
    currentSalesYear: 27,
    nextSeason: 'S1',
    nextSalesYear: 27,
    settings: { lowStockMaxSLts: 150, holdAgeDays: 5, locationNoteAgeDays: 10 },
    now
  });

  assert.deepEqual(ids(result.reports['s1-with-pri']), ['d-boundary', 'a-f1']);
  assert.deepEqual(ids(result.reports.u1), ['a-u1']);
  assert.deepEqual(ids(result.reports.u2), ['b-u2']);
  assert.deepEqual(ids(result.reports.u3), []);
  assert.deepEqual(ids(result.reports['od-loc-note-date']), ['a-f1']);
  assert.deepEqual(ids(result.reports['hs-plus-5-days']), ['a-f1']);
  assert.deepEqual(ids(result.reports['get-off-hold']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['low-stock']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['no-pri']), ['b-u2', 'c-future-f1']);
  assert.deepEqual(ids(result.reports.culls), ['a-x']);
  assert.deepEqual(ids(result.reports['not-in-f1']), ['b-u2', 'c-future-f1', 'e-s1-pri']);
});

test('uses ItemCode-level Priority, F1, hold, and low-stock membership', () => {
  const rows = [
    row('ONE', 'F1', 27, { TEST_ID: 'one-seed', PRIORITY: '1', S_LTS: 149, HOLDSTOPBEGINDATE: '8/1/2026', HOLDSTOPCODE: 'H' }),
    row('ONE', 'U3', 27, { TEST_ID: 'one-support' }),
    row('ONE', 'U3', 28, { TEST_ID: 'one-too-new' }),
    row('TWO', 'U1', 27, { TEST_ID: 'two-a', PRIORITY: '' }),
    row('TWO', 'S1', 27, { TEST_ID: 'two-b', PRIORITY: '9' })
  ];
  const result = engine.classifyRows(rows, {
    currentSeason: 'F1', currentSalesYear: 2027, nextSeason: 'S1', nextSalesYear: 2027, now
  });

  assert.deepEqual(ids(result.reports['low-stock']), ['one-support']);
  assert.deepEqual(ids(result.reports['get-off-hold']), ['one-support', 'one-too-new']);
  assert.equal(result.reports['no-pri'].some((record) => record.ITEMCODE === 'TWO'), false);
  assert.equal(result.reports['not-in-f1'].filter((record) => record.ITEMCODE === 'TWO').length, 2);
});

test('follows the configured current and next-season transition', () => {
  const rows = [
    row('SHIFT', 'S1', 27, { TEST_ID: 'shift-s1', PRIORITY: '1', S_LTS: 20 }),
    row('SHIFT', 'U1', 27, { TEST_ID: 'shift-u1' }),
    row('SHIFT', 'F1', 28, { TEST_ID: 'shift-f1-next' })
  ];
  const result = engine.classifyRows(rows, {
    currentSeason: 'S1', currentSalesYear: 27, nextSeason: 'F1', nextSalesYear: 28, now
  });
  assert.deepEqual(ids(result.reports['s1-with-pri']), ['shift-s1']);
  assert.deepEqual(ids(result.reports['low-stock']), ['shift-f1-next', 'shift-u1']);
});

test('low stock qualifies from the configured current season and returns only target-season rows', () => {
  const rows = [
    row('CURRENT-LOW', 'S1', 27, { TEST_ID: 'current-s1-seed', S_LTS: 149 }),
    row('CURRENT-LOW', 'U1', 27, { TEST_ID: 'current-u1-target', S_LTS: 999 }),
    row('CURRENT-LOW', 'X', 27, { TEST_ID: 'current-culls-target', S_LTS: 999 }),
    row('CURRENT-LOW', 'F1', 28, { TEST_ID: 'current-f1-target', S_LTS: 999 }),
    row('OLD-F1-LOW', 'F1', 27, { TEST_ID: 'old-f1-seed', S_LTS: 1 }),
    row('OLD-F1-LOW', 'U1', 27, { TEST_ID: 'old-f1-u1', S_LTS: 999 }),
    row('FUTURE-S1-LOW', 'S1', 28, { TEST_ID: 'future-s1-seed', S_LTS: 1 }),
    row('FUTURE-S1-LOW', 'U2', 27, { TEST_ID: 'future-s1-u2', S_LTS: 999 })
  ];

  for (const classify of [engine.classifyRows, engine.classifyScriptCompatibleRows]) {
    const result = classify(rows, {
      currentSeason: 'S1', currentSalesYear: 27, nextSeason: 'F1', nextSalesYear: 28,
      settings: { lowStockMaxSLts: 150 }, now
    });
    assert.deepEqual(ids(result.reports['low-stock']), [
      'current-f1-target',
      'current-u1-target',
      'current-culls-target'
    ]);
  }
});

test('item low-stock targets resolve override before suggestion then the configured fallback in both classifiers', () => {
  const rows = [
    row('OVERRIDE', 'F1', 27, { TEST_ID: 'override-below', S_LTS: 119 }),
    row('OVERRIDE', 'U1', 27, { TEST_ID: 'override-support' }),
    row('SUGGESTED', 'F1', 27, { TEST_ID: 'suggestion-below', S_LTS: 89 }),
    row('SUGGESTED', 'U2', 27, { TEST_ID: 'suggestion-support' }),
    row('GLOBAL', 'F1', 27, { TEST_ID: 'global-below', S_LTS: 74 }),
    row('GLOBAL', 'U3', 27, { TEST_ID: 'global-support' }),
      row('PENDING', 'F1', 27, { TEST_ID: 'pending-prior-anchor', S_LTS: 50 }),
      row('PENDING', 'U1', 27, { TEST_ID: 'pending-prior-support' }),
      row('INITIAL', 'F1', 27, { TEST_ID: 'initial-fallback-anchor', S_LTS: 74 }),
      row('INITIAL', 'U2', 27, { TEST_ID: 'initial-fallback-support' }),
    row('BOUNDARY', 'F1', 27, { TEST_ID: 'strict-boundary', S_LTS: 100 }),
    row('BOUNDARY', 'X', 27, { TEST_ID: 'boundary-support' })
  ];
  const itemLowStockTargets = new Map([
    ['OVERRIDE', { itemcode_normalized: 'OVERRIDE', manual_override_qty: 120, suggested_qty: 10 }],
    ['SUGGESTED', { itemcode_normalized: 'SUGGESTED', manual_override_qty: null, suggested_qty: 90 }],
    ['BOUNDARY', { itemcode_normalized: 'BOUNDARY', manual_override_qty: null, suggested_qty: 100 }],
      ['PENDING', { itemcode_normalized: 'PENDING', history_ready: false, manual_override_qty: null, suggested_qty: 40 }],
      ['INITIAL', { itemcode_normalized: 'INITIAL', history_ready: false, manual_override_qty: null, suggested_qty: null }]
  ]);
  for (const classify of [engine.classifyRows, engine.classifyScriptCompatibleRows]) {
    const result = classify(rows, {
      currentSeason: 'F1', currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27,
      settings: { lowStockMaxSLts: 75 }, itemLowStockTargets, now
    });
      assert.deepEqual(ids(result.reports['low-stock']), ['global-support', 'initial-fallback-support', 'override-support', 'suggestion-support']);
  }
});

test('sorts by AssignedTo, ItemCode, season order, sales year, and location', () => {
  const rows = [
    row('B', 'X', 27, { TEST_ID: '4', ASSIGNEDTO: 'zoe_green', LOCATIONCODE: 'B.02.001' }),
    row('A', 'U1', 27, { TEST_ID: '3', ASSIGNEDTO: 'zoe_green', LOCATIONCODE: 'B.01.001' }),
    row('A', 'F1', 28, { TEST_ID: '2', ASSIGNEDTO: 'zoe_green', LOCATIONCODE: 'A.02.001' }),
    row('A', 'F1', 27, { TEST_ID: '1', ASSIGNEDTO: 'abigail_vazquez', LOCATIONCODE: 'A.01.001' })
  ];
  assert.deepEqual(ids(rows.slice().sort(engine.compareRows)), ['1', '2', '3', '4']);
});

test('classifies 10,000 rows in one sub-500 ms pass on the test runtime', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => row(
    `ITEM-${String(index % 2500).padStart(4, '0')}`,
    index % 5 === 0 ? 'F1' : ['U1', 'U2', 'U3', 'X'][index % 4],
    27,
    { TEST_ID: String(index), PRIORITY: index % 7 === 0 ? '1' : '', S_LTS: index % 200 }
  ));
  const started = performance.now();
  const result = engine.classifyRows(rows, { currentSeason: 'F1', currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
  const elapsed = performance.now() - started;
  assert.equal(result.counts.culls, 2000);
  assert.ok(elapsed < 500, `classification took ${elapsed.toFixed(1)} ms`);
});

test('overlays authoritative ITEMCODE + GENUSNAME assignments without mutating inventory', () => {
  const inventory = [
    row(' 0001 ', 'F1', 27, { GENUSNAME: ' Rosa   Rugosa ', ASSIGNEDTO: 'stale_master_user' }),
    row('0002', 'U1', 27, { GENUSNAME: 'Acer', ASSIGNEDTO: 'another_stale_user' }),
    row('0003', 'U2', 27, { GENUSNAME: 'Thuja', ASSIGNEDTO: 'must_be_ignored' })
  ];
  const assignments = expectedAssignees.map((assignedto, index) => ({
    itemcode: String(index + 1).padStart(4, '0'),
    genusname: index === 0 ? '  ROSA rugosa  ' : `Genus ${index}`,
    assignedto
  }));
  assignments[1] = { ITEMCODE: '0002', GENUSNAME: ' acer ', ASSIGNEDTO: '' };

  const model = engine.buildAuthoritativeAssignmentModel(inventory, assignments);

  assert.equal(model.rows[0].ASSIGNEDTO, 'abigail_vazquez');
  assert.equal(model.rows[1].ASSIGNEDTO, '');
  assert.equal(model.rows[2].ASSIGNEDTO, '');
  assert.equal(model.rows[0].assignedto, 'abigail_vazquez');
  assert.equal(inventory[0].ASSIGNEDTO, 'stale_master_user');
  assert.equal(inventory[1].ASSIGNEDTO, 'another_stale_user');
  assert.equal(model.matchedCount, 2);
  assert.equal(model.unassignedCount, 2);
  assert.equal(engine.buildAuthoritativeAssignmentKey(inventory[0]), '0001|rosa rugosa');
});

test('builds the assignee selector from the complete assignment table', () => {
  const assignments = expectedAssignees.map((assignedto, index) => ({
    ITEMCODE: `ROSTER-${index}`,
    GENUSNAME: `Genus ${index}`,
    ASSIGNEDTO: assignedto
  }));
  assignments.push({ ITEMCODE: 'BLANK', GENUSNAME: 'Blank Genus', ASSIGNEDTO: '' });
  const model = engine.buildAuthoritativeAssignmentModel([
    row('ONLY-MASTER-ROW', 'F1', 27, { GENUSNAME: 'No assignment', ASSIGNEDTO: 'stale_master_user' })
  ], assignments);

  assert.deepEqual(Array.from(model.assignedToOptions), ['(Unassigned)', ...expectedAssignees]);
  assert.equal(model.rows[0].ASSIGNEDTO, '');
});

test('preserves multiple authoritative users on one physical inventory row', () => {
  const inventory = [row('MULTI-001', 'F1', 27, { UNIQUE_ID: 'physical-1', GENUSNAME: 'Rosa' })];
  const assignments = [
    { ITEMCODE: 'MULTI-001', GENUSNAME: 'Rosa', ASSIGNEDTO: 'dylan_collyge' },
    { ITEMCODE: 'MULTI-001', GENUSNAME: 'Rosa', ASSIGNEDTO: 'megan_kelly' },
    { ITEMCODE: 'MULTI-001', GENUSNAME: 'Rosa', ASSIGNEDTO: 'Dylan_Collyge' }
  ];
  const model = engine.buildAuthoritativeAssignmentModel(inventory, assignments);

  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].ASSIGNEDTO, 'dylan_collyge');
  assert.deepEqual(model.rows[0].ASSIGNEDTO_USERS, ['dylan_collyge', 'megan_kelly']);
  assert.equal(model.matchedCount, 1);
  assert.equal(model.unassignedCount, 0);
});

test('excludes Y and U3 rows containing SHFT in DesigItem from every Eval Reports #2 report', () => {
  const rows = [
    row('SHIFT-Y', 'Y', 27, { TEST_ID: 'shift-y', DESIGITEM: 'North SHFT group', PRIORITY: '1', HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: '8/1/2026', LOCATIONNOTEDATE: '8/1/2026' }),
    row('SHIFT-U3', 'U3', 27, { TEST_ID: 'shift-u3', desigitem: 'shft', S_LTS: 1 }),
    row('KEEP-U3', 'U3', 27, { TEST_ID: 'keep-u3', DesigItem: 'standard' }),
    row('KEEP-U2', 'U2', 27, { TEST_ID: 'keep-u2', DESIGITEM: 'SHFT' }),
    row('KEEP-Y', 'Y', 27, { TEST_ID: 'keep-y', DESIGITEM: 'standard' })
  ];
  for (const classifier of [engine.classifyRows, engine.classifyScriptCompatibleRows]) {
    const result = classifier(rows, {
      currentSeason: 'F1', currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27,
      settings: { lowStockMaxSLts: 150, holdAgeDays: 5, locationNoteAgeDays: 10 }, now
    });
    const allReportedIds = Object.values(result.reports).flatMap((reportRows) => ids(reportRows));
    assert.ok(!allReportedIds.includes('shift-y'));
    assert.ok(!allReportedIds.includes('shift-u3'));
    assert.ok(allReportedIds.includes('keep-u3'));
    assert.ok(allReportedIds.includes('keep-u2'));
    assert.ok(allReportedIds.includes('keep-y'));
  }
  assert.equal(engine.isExcludedShiftSeasonRow(rows[0]), true);
  assert.equal(engine.isExcludedShiftSeasonRow(rows[1]), true);
  assert.equal(engine.isExcludedShiftSeasonRow(rows[2]), false);
  assert.equal(engine.isExcludedShiftSeasonRow(rows[3]), false);
});

test('treats assignment container and location as samples, not ownership boundaries', () => {
  const inventory = [
    row('SHARED-001', 'F1', 27, { UNIQUE_ID: 'physical-a', GENUSNAME: 'Rosa', CONTSIZE: '#3', LOCATIONCODE: 'A.01.001', SOURCE: 'LD' }),
    row('SHARED-001', 'F1', 27, { UNIQUE_ID: 'physical-b', GENUSNAME: 'Rosa', CONTSIZE: '#3', LOCATIONCODE: 'B.02.002', SOURCE: 'LD' })
  ];
  const assignments = [
    { ITEMCODE: 'SHARED-001', GENUSNAME: 'Rosa', CONTSIZE: '#3', LOCATIONCODE: 'A.01.001', SOURCE: 'supabase_drive_reconcile', ASSIGNEDTO: 'dylan_collyge' }
  ];

  const model = engine.buildAuthoritativeAssignmentModel(inventory, assignments);

  assert.equal(model.rows[0].ASSIGNEDTO, 'dylan_collyge');
  assert.deepEqual(model.rows[0].ASSIGNEDTO_USERS, ['dylan_collyge']);
  assert.equal(model.rows[1].ASSIGNEDTO, 'dylan_collyge');
  assert.deepEqual(model.rows[1].ASSIGNEDTO_USERS, ['dylan_collyge']);
  assert.equal(model.matchedCount, 2);
  assert.equal(engine.buildAuthoritativeAssignmentExactKey(inventory[0]), 'SHARED-001|#3|A.01.001');
});

test('uses exact inventory-row owners when the assignment snapshot has source IDs', () => {
  const inventory = [
    row('SHARED-001', 'F1', 27, { UNIQUE_ID: 'physical-a', GENUSNAME: 'Rosa', LOCATIONCODE: 'A.01.001' }),
    row('SHARED-001', 'F1', 27, { UNIQUE_ID: 'physical-b', GENUSNAME: 'Rosa', LOCATIONCODE: 'B.02.002' }),
    row('SHARED-001', 'F1', 27, { UNIQUE_ID: 'physical-c', GENUSNAME: 'Rosa', LOCATIONCODE: 'C.03.003' })
  ];
  const assignments = [
    { master_unique_id: 'physical-a', assignedto: 'zoe_green' },
    { master_unique_id: 'physical-b', assignedto: 'mitch_kaiser' },
    { master_unique_id: 'physical-c', assignedto: null },
    // This legacy row must not broaden a row-level ownership snapshot.
    { itemcode: 'SHARED-001', genusname: 'Rosa', assignedto: 'legacy_owner' }
  ];

  const model = engine.buildAuthoritativeAssignmentModel(inventory, assignments);

  assert.deepEqual(Array.from(model.rows, (entry) => entry.ASSIGNEDTO), ['zoe_green', 'mitch_kaiser', '']);
  assert.deepEqual(Array.from(model.rows, (entry) => Array.from(entry.ASSIGNEDTO_USERS)), [['zoe_green'], ['mitch_kaiser'], ['']]);
  assert.deepEqual(Array.from(model.assignedToOptions), ['(Unassigned)', 'mitch_kaiser', 'zoe_green']);
  assert.equal(model.matchedCount, 3);
  assert.equal(model.unassignedCount, 1);
});

test('does not use ItemCode + Genus fallback when an exact row has no assignment record', () => {
  const inventory = [
    row('SHARED-002', 'F1', 27, { UNIQUE_ID: 'physical-assigned', GENUSNAME: 'Acer' }),
    row('SHARED-002', 'F1', 27, { UNIQUE_ID: 'physical-unmatched', GENUSNAME: 'Acer' })
  ];
  const model = engine.buildAuthoritativeAssignmentModel(inventory, [
    { master_unique_id: 'physical-assigned', assignedto: 'zoe_green' }
  ]);

  assert.deepEqual(Array.from(model.rows, (entry) => entry.ASSIGNEDTO), ['zoe_green', '']);
  assert.equal(model.matchedCount, 1);
  assert.equal(model.unassignedCount, 1);
});

test('the explicit row-authority contract disables fallback even with an empty cache snapshot', () => {
  const inventory = [row('LEGACY-CACHE', 'F1', 27, { UNIQUE_ID: 'row-legacy-cache', GENUSNAME: 'Rosa' })];
  const model = engine.buildAuthoritativeAssignmentModel(inventory, [
    { itemcode: 'LEGACY-CACHE', genusname: 'Rosa', assignedto: 'stale_owner' }
  ], { assignmentContract: 'inventory-row-assignments-v1' });

  assert.equal(model.rows[0].ASSIGNEDTO, '');
  assert.equal(model.matchedCount, 0);
  assert.equal(model.unassignedCount, 1);
});

test('script-compatible classifier preserves the pasted Apps Script predicates and boundaries', () => {
  const rows = [
    row('A', 'F1', 27, { TEST_ID: 'a-f1', ASSIGNEDTO: 'dylan_collyge', PRIORITY: '1', S_LTS: 100, HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: '8/14/2026', LOCATIONNOTEDATE: '8/9/2026' }),
    row('A', 'U1', 27, { TEST_ID: 'a-u1', ASSIGNEDTO: 'dylan_collyge' }),
    row('A', 'S1', 27, { TEST_ID: 'a-s1', ASSIGNEDTO: 'dylan_collyge', PRIORITY: '2' }),
    row('A', 'X', 27, { TEST_ID: 'a-x', ASSIGNEDTO: 'dylan_collyge', PRIORITY: '3' }),
    row('B', 'U2', 26, { TEST_ID: 'b-u2', ASSIGNEDTO: 'megan_kelly', HOLDSTOPBEGINDATE: 'invalid', LOCATIONNOTEDATE: 'invalid' }),
    row('C', 'F1', 28, { TEST_ID: 'c-future-f1', S_LTS: 10 }),
    row('D', 'F1', 27, { TEST_ID: 'd-boundary', PRIORITY: '4', S_LTS: 150, HOLDSTOPBEGINDATE: '8/15/2026', LOCATIONNOTEDATE: '8/10/2026' }),
    row('E', 'U3', 27, { TEST_ID: 'e-u3-pri', ASSIGNEDTO: 'megan_kelly', PRIORITY: '9' })
  ];
  const result = engine.classifyScriptCompatibleRows(rows, {
    currentSeason: 'F1', currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27,
    settings: { lowStockMaxSLts: 150, holdAgeDays: 5, locationNoteAgeDays: 10 }, now
  });

  assert.deepEqual(ids(result.reports['s1-with-pri']), ['a-s1', 'a-x', 'e-u3-pri']);
  assert.deepEqual(ids(result.reports.u1), ['a-u1']);
  assert.deepEqual(ids(result.reports.u2), ['b-u2']);
  assert.deepEqual(ids(result.reports.u3), ['e-u3-pri']);
  assert.deepEqual(ids(result.reports['od-loc-note-date']), ['a-f1']);
  assert.deepEqual(ids(result.reports['hs-plus-5-days']), ['a-f1']);
  assert.deepEqual(ids(result.reports['get-off-hold']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['low-stock']), ['a-s1', 'a-u1', 'a-x']);
  assert.deepEqual(ids(result.reports['no-pri']), ['c-future-f1', 'b-u2']);
  assert.deepEqual(ids(result.reports.culls), ['a-x']);
  assert.deepEqual(ids(result.reports['not-in-f1']), ['c-future-f1', 'b-u2', 'e-u3-pri']);
});

test('script-compatible fixtures match an independent Apps Script reference implementation', () => {
  const rows = [
    row('A', 'F1', 27, { TEST_ID: 'a-f1', PRIORITY: '1', S_LTS: 149, HOLDSTOPCODE: 'H', HOLDSTOPBEGINDATE: '8/14/26', LOCATIONNOTEDATE: '2026-08-09' }),
    row('A', 'U1', 27, { TEST_ID: 'a-u1' }),
    row('A', 'S1', 27, { TEST_ID: 'a-s1', PRIORITY: '2' }),
    row('A', 'X', 2027, { TEST_ID: 'a-x' }),
    row('B', 'U2', 26, { TEST_ID: 'b-u2', HOLDSTOPBEGINDATE: 'bad-date' }),
    row('C', 'F1', 28, { TEST_ID: 'c-future', S_LTS: 1 }),
    row('D', 'F1', 27, { TEST_ID: 'd-boundary', PRIORITY: '3', S_LTS: 150, HOLDSTOPBEGINDATE: '8/15/2026', LOCATIONNOTEDATE: '8/10/2026' })
  ];
  const expected = independentScriptCompatibleReference(rows, { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27 });
  const actual = engine.classifyScriptCompatibleRows(rows, {
    currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27,
    settings: { lowStockMaxSLts: 150, holdAgeDays: 5, locationNoteAgeDays: 10 }, now
  });
  for (const reportId of engine.REPORT_IDS) {
    assert.deepEqual(ids(actual.reports[reportId]).sort(), expected[reportId], reportId);
  }
});

test('U1, U2, and U3 reports use exact normalized Season membership', () => {
  const rows = [
    row('A', 'u1', 27, { TEST_ID: 'u1-lower' }),
    row('B', ' U2 ', 27, { TEST_ID: 'u2-spaced' }),
    row('C', 'U3', 28, { TEST_ID: 'u3-future-year' }),
    row('D', 'U10', 27, { TEST_ID: 'u10-not-u1' }),
    row('E', 'S1', 27, { TEST_ID: 's1-not-u1' })
  ];
  for (const classify of [engine.classifyRows, engine.classifyScriptCompatibleRows]) {
    const result = classify(rows, { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
    assert.deepEqual(ids(result.reports.u1), ['u1-lower']);
    assert.deepEqual(ids(result.reports.u2), ['u2-spaced']);
    assert.deepEqual(ids(result.reports.u3), ['u3-future-year']);
  }
  assert.equal(engine.REPORT_META.u1.label, 'U1');
  assert.equal(engine.REPORT_META.u2.label, 'U2');
  assert.equal(engine.REPORT_META.u3.label, 'U3');
});

test('script-compatible sorting keeps valid years before future or invalid years', () => {
  const rows = [
    row('SORT', 'U1', 28, { TEST_ID: 'future', ASSIGNEDTO: 'same', PRIORITY: '1' }),
    row('SORT', 'U1', '', { TEST_ID: 'invalid', ASSIGNEDTO: 'same', PRIORITY: '1' }),
    row('SORT', 'U1', 27, { TEST_ID: 'valid', ASSIGNEDTO: 'same', PRIORITY: '1' })
  ];
  const result = engine.classifyScriptCompatibleRows(rows, { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
  assert.deepEqual(ids(result.reports['s1-with-pri']), ['valid', 'invalid', 'future']);
});

test('script-compatible shared ordering preserves duplicates, source ties, aggregates, and input', () => {
  const tiedSecond = row('TIE', 'U1', 27, { TEST_ID: 'tied-second', ASSIGNEDTO: 'same', PRIORITY: '1' });
  const missingItemCode = row('', 'U1', 27, { TEST_ID: 'missing-itemcode', ASSIGNEDTO: 'same', PRIORITY: '1' });
  const duplicate = row('DUP', 'U1', 27, { TEST_ID: 'duplicate', ASSIGNEDTO: 'same', PRIORITY: '1' });
  const tiedFirst = row('TIE', 'U1', 27, { TEST_ID: 'tied-first', ASSIGNEDTO: 'same', PRIORITY: '1' });
  const rows = [tiedSecond, missingItemCode, duplicate, tiedFirst, duplicate];
  const originalOrder = rows.slice();

  const result = engine.classifyScriptCompatibleRows(rows, {
    currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now
  });

  assert.deepEqual(ids(result.reports.u1), ['duplicate', 'duplicate', 'tied-second', 'tied-first']);
  assert.deepEqual(ids(result.reports['s1-with-pri']), ['duplicate', 'duplicate', 'tied-second', 'tied-first']);
  assert.equal(result.reports.u1[0], duplicate);
  assert.equal(result.reports.u1[1], duplicate);
  assert.ok(!Object.values(result.reports).flat().includes(missingItemCode));
  assert.deepEqual(Array.from(result.aggregates.keys()), ['TIE', 'DUP']);
  assert.deepEqual(rows, originalOrder);
  assert.equal(Object.hasOwn(duplicate, '__evalReport2SourceIndex'), false);
});

test('script-compatible shared ordering retains punctuation and Unicode item-code collation', () => {
  const rows = [
    row('A', 'U1', 27, { TEST_ID: 'ascii', ASSIGNEDTO: 'same' }),
    row('Å', 'U1', 27, { TEST_ID: 'unicode', ASSIGNEDTO: 'same' }),
    row('_A', 'U1', 27, { TEST_ID: 'punctuation', ASSIGNEDTO: 'same' })
  ];

  const result = engine.classifyScriptCompatibleRows(rows, {
    currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now
  });

  assert.deepEqual(ids(result.reports.u1), ['punctuation', 'ascii', 'unicode']);
});

test('cached row keys preserve synchronous index and membership semantics', () => {
  const html = readComposedAppSource();
  const functionStart = html.indexOf('function getManagerEvalReport2RowKey(');
  const functionEnd = html.indexOf('function getManagerEvalReport2EditFieldConfig(', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const keyContext = vm.createContext({});
  keyContext.firstNonEmptyValue = (...values) => values.find((value) => (
    value !== null && value !== undefined && String(value).trim() !== ''
  )) ?? '';
  vm.runInContext(`${html.slice(functionStart, functionEnd)}\nglobalThis.rowKey = getManagerEvalReport2RowKey;`, keyContext);
  const getRowKey = keyContext.rowKey;

  const makeFixture = () => {
    const duplicate = { TEST_ID: 'duplicate', ITEMCODE: 'DUP', LOCATIONCODE: 'A.01.001', SEASON: 'U1', SALEYEAR: 27 };
    const uid = { TEST_ID: 'uid', UNIQUE_ID: 'uid-1', ITEMCODE: 'UID' };
    const blank = { TEST_ID: 'blank' };
    return {
      rows: [uid, duplicate, blank, duplicate],
      reports: { u1: [duplicate, duplicate], 'no-pri': [uid, duplicate, blank, duplicate] }
    };
  };
  const assemble = (fixture, cacheKeys) => {
    const rowByKey = new Map();
    const rowKeyByRow = new Map();
    fixture.rows.forEach((record, sourceIndex) => {
      try {
        Object.defineProperty(record, '__evalReport2SourceIndex', { value: sourceIndex, enumerable: false, configurable: false });
      } catch {}
      const key = getRowKey(record, sourceIndex);
      if (cacheKeys) rowKeyByRow.set(record, key);
      rowByKey.set(key, record);
    });
    const memberships = new Map();
    Object.entries(fixture.reports).forEach(([reportId, reportRows]) => {
      reportRows.forEach((record, reportIndex) => {
        const key = (cacheKeys && rowKeyByRow.get(record)) || getRowKey(record, reportIndex);
        if (!memberships.has(key)) memberships.set(key, new Set());
        memberships.get(key).add(reportId);
      });
    });
    return {
      rowByKey: Array.from(rowByKey, ([key, record]) => [key, record.TEST_ID]),
      memberships: Array.from(memberships, ([key, reports]) => [key, Array.from(reports)])
    };
  };

  const previous = assemble(makeFixture(), false);
  const cached = assemble(makeFixture(), true);
  assert.deepEqual(cached, previous);
  assert.deepEqual(cached.rowByKey, [
    ['uid:uid-1', 'uid'],
    ['row:|dup|||a.01.001||u1|27||', 'duplicate'],
    ['row-index:2', 'blank']
  ]);
});

test('worker report identities and memberships match the synchronous contract', () => {
  const html = readComposedAppSource();
  const source = html.slice(html.indexOf('function getManagerEvalReport2WorkerSource('), html.indexOf('let managerEvalReport2IndexJob = null'));
  const helper = vm.createContext({});
  vm.runInContext(`${source};globalThis.workerSource = getManagerEvalReport2WorkerSource();`, helper);
  let result;
  const worker = vm.createContext({ Intl, Date, Map, Set, Object, Array, String, Number, Math });
  worker.self = worker;
  worker.importScripts = () => vm.runInContext(engineSource, worker);
  worker.postMessage = value => { result = value; };
  vm.runInContext(helper.workerSource, worker);
  const inventory = [
    row('A', 'U1', 27, { TEST_ID: 'a', UNIQUE_ID: ' ', unique_id: 'a', GENUSNAME: 'oak' }),
    row('B', 'U2', 27, { TEST_ID: 'b', MASTER_UNIQUE_ID: 'b', unique_id: 'b', GENUSNAME: 'maple' }),
    row('_A', 'U1', 27, { TEST_ID: 'no-uid', WAREHOUSEI: 'PH', GENUSNAME: 'pine', SOURCE: 'LD', ROW_NUMBER: '3' }),
    { TEST_ID: 'blank' },
    row('_A', 'U1', 27, { TEST_ID: 'same-key', WAREHOUSEI: 'PH', GENUSNAME: 'pine', SOURCE: 'LD', ROW_NUMBER: '3' })
  ];
  const assignments = [{ master_unique_id: 'a', assignedto: 'dylan_collyge' }];
  const options = { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now };
  worker.onmessage({ data: { engineUrl: 'fixture-engine', inventory, assignments, options } });
  assert.equal(result.error, undefined);
  const model = engine.buildAuthoritativeAssignmentModel(inventory, assignments, { assignmentContract: 'inventory-row-assignments-v1' });
  const expected = engine.classifyScriptCompatibleRows(model.rows, options);
  const keyStart = html.indexOf('function getManagerEvalReport2RowKey(');
  const keyEnd = html.indexOf('function getManagerEvalReport2EditFieldConfig(', keyStart);
  const keyScope = vm.createContext({ firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '' });
  vm.runInContext(`${html.slice(keyStart, keyEnd)};globalThis.rowKey = getManagerEvalReport2RowKey;`, keyScope);
  const keys = new Map(model.rows.map((record, index) => [record, keyScope.rowKey(record, index)]));
  const memberships = new Map();
  for (const reportId of engine.REPORT_IDS) {
    assert.deepEqual(ids(result.classified.reports[reportId]), ids(expected.reports[reportId]));
    for (const record of expected.reports[reportId]) {
      const key = keys.get(record);
      if (!memberships.has(key)) memberships.set(key, new Set());
      memberships.get(key).add(reportId);
    }
  }
  const serialize = map => Array.from(map, ([key, values]) => [key, Array.from(values)]);
  assert.deepEqual(serialize(result.memberships), serialize(memberships));
  assert.deepEqual(Array.from(result.rowByKey, ([key, record]) => [key, record.TEST_ID]),
    Array.from(new Map(model.rows.map(record => [keys.get(record), record.TEST_ID]))));
  assert.deepEqual(JSON.parse(JSON.stringify(result.stats)), {
    assignmentCount: model.assignmentCount, matchedCount: model.matchedCount, unassignedCount: model.unassignedCount
  });
});

test('large getter uses one guarded loading lifecycle and retains monitored fallback', () => {
  const html = readComposedAppSource();
  const start = html.indexOf('function getManagerEvalReport2Index(');
  const end = html.indexOf('let managerEvalReport2SelectedReportIds', start);
  const state = { loading: false, error: '' };
  let loads = 0, builds = 0, clock = 0;
  const events = [];
  const api = { REPORT_IDS: [], buildAuthoritativeAssignmentModel: () => {
    builds++;
    return { rows: [], assignedToOptions: [], assignmentCount: 0, matchedCount: 0, unassignedCount: 0 };
  }, classifyScriptCompatibleRows: () => ({ reports: {}, counts: {} }) };
  const scope = vm.createContext({ Worker: class {}, Map, Set, Date, Object, Array,
    useManagerReportPages: () => false,
    getManagerEvalReports2Api: () => api, canUseProductionLiveSync: () => false, hasProgressiveViewData: () => false,
    isDatasetLoaded: () => true, managerEvalReport2DisplaySourcesReady: () => true, prepareManagerEvalReport2GroupLookups: value => value, managerEvalReport2LoadState: state,
    managerEvalReport2Cache: null, managerEvalReport2CacheKey: '', fullInventory: Array(9364), warehouseAssignedItemsInventory: [],
    getConfiguredCurrentSeasonCode: () => 'F1', getConfiguredCurrentSalesYearCode: () => 27,
    getConfiguredNextSaleSeasonTarget: () => ({ season: 'S1', salesYear: 27 }),
    getManagerEvalReport2CacheKeyValue: () => 'current', getManagerItemLowStockTargetsState: () => ({ rowsByCode: new Map(), revision: 0 }), managerEvalReportSettings: {},
    reconcileManagerEvalReport2Navigation: () => {}, performance: { now: () => (clock++ % 2) * 600 },
    reportSemanticHealthEvent: (...args) => events.push(args),
    loadManagerEvalReports2: () => { loads++; state.loading = true; return Promise.resolve(); }
  });
  vm.runInContext(`${html.slice(start, end)};globalThis.getIndex = getManagerEvalReport2Index;`, scope);
  assert.equal(scope.getIndex(), null);
  assert.equal(scope.getIndex(), null);
  assert.equal(loads, 1);
  assert.equal(builds, 0);
  const stale = { counts: { u1: 2 } };
  scope.managerEvalReport2Cache = stale;
  assert.equal(scope.getIndex(), stale);
  // Only the owning worker fallback may build while the load is still active.
  assert.ok(scope.getIndex(true));
  assert.equal(builds, 1);
  assert.equal(events[0][2], 'EVAL_REPORT_2_CLASSIFICATION_SLOW');
  assert.equal(events[0][3].duration_bucket, 750);
  scope.managerEvalReport2Cache = null;
  state.loading = false;
  state.error = 'fixture load failure';
  assert.equal(scope.getIndex(), null);
  assert.equal(loads, 1, 'an error must not create an automatic retry loop');
});

test('Eval Reports #2 keeps its last-good index while the authoritative report page refreshes', async () => {
  const html = readComposedAppSource();
  const functionSource = name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\n        function ', start + 1);
    assert.ok(start >= 0 && end > start, name);
    return html.slice(start, end);
  };
  const helperStart = html.indexOf('function shouldLetManagerEvalReport2OwnLoadState(');
  const helperEnd = html.indexOf('\n        function ', helperStart + 1);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const scope = vm.createContext({
    activeHomeTab: 'eval-reports-2', MANAGER_EVAL_REPORTS_2_VIEW: 'eval-reports-2',
    getCurrentVisibleViewId: () => 'managers', canViewManagerEvalReports2: () => true, String
  });
  vm.runInContext(`${html.slice(helperStart, helperEnd)};globalThis.ownsLoad = shouldLetManagerEvalReport2OwnLoadState;`, scope);
  assert.equal(scope.ownsLoad('managers'), true);
  assert.equal(scope.ownsLoad('drive'), false);
  scope.canViewManagerEvalReports2 = () => false;
  assert.equal(scope.ownsLoad('managers'), false, 'confirmed loss of report permission must remain an access boundary');

  let resolvePage, status = { state:'Syncing', message:'Checking and loading changed data.' }, settingsReads = 0;
  const lastGoodIndex = { source:'last-good' }, refreshedIndex = { source:'refreshed' };
  const refreshGate = new Promise(resolve => { resolvePage = resolve; });
  const settingsSource = functionSource('loadManagerEvalReportSettings');
  const loadSource = html.slice(html.indexOf('async function loadManagerEvalReports2('), html.indexOf('\n        function getManagerEvalReport2CacheKeyValue('));
  const pageState = { pendingKey:'', promise:null, page:null, error:'' };
  const query = { surface:'eval2', operation:'groups', filters:{ reportIds:['low-stock'] }, offset:0, limit:25 };
  const reportController = { state:() => pageState, load:() => refreshGate.then(page => {
    pageState.page = page; pageState.error = ''; runtime.managerEvalReport2Cache = refreshedIndex; return page;
  }), refresh() {} };
  const runtime = vm.createContext({
    managerEvalReportSettings:{ lowStockMaxSLts:150, holdAgeDays:5, locationNoteAgeDays:10 },
    managerEvalReportSettingsState:{ loading:false, loaded:true, error:'' },
    managerEvalReport2LoadState:{ loading:false, error:'', promise:null, lastLoadedAt:'', lastSourceUpdatedAt:'' },
    managerEvalReport2Cache:lastGoodIndex, managerEvalReport2CacheKey:'old-key',
    fullInventory:[{ ITEMCODE:'A' }], warehouseAssignedItemsInventory:[{ ITEMCODE:'A' }],
    getSupabaseReadIdentityScope:() => 'account-a:login-1', canViewManagerEvalReports2:() => true,
    useManagerReportPages:() => true, getManagerReportPageController:() => reportController,
    buildManagerReportPageQuery:() => query, getManagerEvalReport2Index:() => runtime.managerEvalReport2Cache,
    getManagerEvalReport2BrowsePage:() => pageState.page,
    getManagerEvalReport2LatestSourceUpdate:() => '',
    getProductionLiveSyncCoordinator:() => ({ getStatus:() => status }),
    shouldUseProductionLiveSyncSideLoad:() => true,
    ensureProductionLiveSyncSideData:async () => { settingsReads++; throw new Error(status.message); },
    isSupabaseReadTerminalDenial:error => [401,403].includes(Number(error?.status || 0)),
    nativeAuthProfile:{ active:true, disabled_at:null }, window:{ GncReportPagesLive:{} },
    MANAGER_EVAL_REPORTS_2_VIEW:'eval-reports-2', activeHomeTab:'eval-reports-2',
    getCurrentVisibleViewId:() => 'managers',
    scheduleManagersRender:() => {}, reconcileManagerEvalReport2Navigation:() => {},
    showToast:(title, message, isError) => toasts.push({ title, message, isError }),
    reportSemanticHealthEvent:(...args) => events.push(args),
    getFriendlyBackendErrorMessage:error => String(error?.message || error),
    Promise, Date, String, Number, Object, Array
  });
  const toasts = [], events = [];
  vm.runInContext(`let managerEvalReport2ProgressiveRowsState = null;\n${settingsSource}\n${loadSource}\nglobalThis.load = loadManagerEvalReports2;`, runtime);
  // Hold the signed server page read open to prove the same-account report
  // remains visible while the shared Manager revision is syncing.
  const loading = runtime.load(true);
  assert.equal(runtime.managerEvalReport2LoadState.loading, true);
  assert.equal(runtime.managerEvalReport2Cache, lastGoodIndex);
  for (let index = 0; index < 6; index++) await Promise.resolve();
  assert.equal(settingsReads, 0, 'report page loading does not await the optional full-snapshot settings path');
  assert.equal(runtime.managerEvalReport2Cache, lastGoodIndex);
  assert.equal(runtime.managerEvalReport2LoadState.error, '');
  assert.equal(events.length, 0);
  resolvePage({ sourceRevision:'report-r2', rows:[] });
  assert.equal(await loading, refreshedIndex);
  assert.equal(runtime.managerEvalReport2Cache, refreshedIndex);
  assert.deepEqual(toasts, [], 'background revision status does not emit a false Refresh Failed toast');

  status = { state:'Needs attention', message:'Access revoked.', status:403, authorizationDenied:true };
  runtime.ensureProductionLiveSyncSideData = async () => { const error = new Error(status.message); error.status = 403; throw error; };
  await assert.rejects(runtime.loadManagerEvalReportSettings(false), error => error.status === 403,
    'confirmed denial must remain a real failure');

  const viewLoaderStart = html.indexOf('function ensureViewDataForRender(viewId)');
  const viewLoaderEnd = html.indexOf('\n        function ', viewLoaderStart + 1);
  const liveSyncStart = html.indexOf('onStatus: (status) => {');
  const liveSyncEnd = html.indexOf('\n                on', liveSyncStart + 1);
  assert.match(html.slice(viewLoaderStart, viewLoaderEnd), /shouldLetManagerEvalReport2OwnLoadState\(viewId\)\) return false/);
  assert.match(html.slice(liveSyncStart, liveSyncEnd), /VIEW_LOAD_UI\[currentView\] && !shouldLetManagerEvalReport2OwnLoadState\(currentView\)/);
  assert.match(html.slice(liveSyncStart, liveSyncEnd), /failedUi && !shouldLetManagerEvalReport2OwnLoadState\(failedView\)/);
});

test('cold Eval2 loads the report_read_v2 page before any local inventory snapshot is cached', async () => {
  const html = readComposedAppSource();
  const start = html.indexOf('function getManagerReportPageController()');
  const end = html.indexOf('\n        function useManagerReportPages(', start);
  assert.ok(start >= 0 && end > start);
  const reportPage = { sourceRevision:'report-r1', metadata:{ assignedToOptions:['evaluator-a'] }, rows:[{ itemCode:'A' }] };
  const calls = [], datasetReads = [];
  let controllerOptions = null;
  const query = { surface:'eval2', operation:'groups', filters:{ reportIds:['low-stock'] }, offset:0, limit:25 };
  const owner = 'account-a:login-a';
  const context = vm.createContext({
    GncReportPagesLive:{ createController:options => { controllerOptions = options; return {}; } },
    managerReportPageController:null,
    managerReportScopedRows:new Map(), managerReportVisibleRows:new Map(), managerReportGridFilters:new Map(),
    managerEvalReport2SelectedItemsByKey:new Map(), managerEvalReport2EditsByRowKey:new Map(),
    managerEvalReport2DetailItemKey:'', managerEvalAssignmentSelection:new Map(),
    getSupabaseReadIdentityScope:() => owner, appAccessSnapshotState:{ snapshot:{ dataPermissionVersion:'permission-a' } },
    currentUser:{ username:'dylan_collyge' }, canViewManagerEvalReports2:() => true,
    getCurrentVisibleViewId:() => 'managers', activeHomeTab:'eval2', MANAGER_EVAL_REPORTS_2_VIEW:'eval2',
    buildManagerReportPageQuery:() => query,
    APP_API_FUNCTION_URL:'/api', SUPABASE_READ_TIMEOUT_MS:1000, AbortController,
    window:{ GncUserAccessControl:{ getSelfState:() => ({ denied:false }) } },
    nativeAuthProfile:{ active:true, disabled_at:null },
    postAppFunctionJson:async (_url, body) => {
      calls.push(body);
      return body.operation === 'capabilities'
        ? { ok:true, data:{ surfaces:['eval2'] } }
        : { ok:true, data:reportPage };
    },
    acceptCardLocationOnHandSourceReceipt:() => false,
    staleSupabaseReadScopeError:() => new Error('stale scope'),
    ensureDatasetLoaded:async (...args) => { datasetReads.push(args); throw new Error('cold full snapshot must not be awaited'); },
    Map, Set, String, Number, Object, Array, Promise, Date
  });
  vm.runInContext(`${html.slice(start, end)};globalThis.getController = getManagerReportPageController;`, context);
  const started = performance.now();
  const controller = context.getController();
  const capabilities = await controllerOptions.transport(null, new AbortController().signal);
  const loaded = await controllerOptions.transport(query, new AbortController().signal);
  const elapsed = performance.now() - started;
  assert.deepEqual(capabilities, { surfaces:['eval2'] });
  assert.deepEqual(loaded, reportPage);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), JSON.parse(JSON.stringify([
    { action:'report_read_v2', operation:'capabilities' },
    { action:'report_read_v2', query }
  ])), 'the capability check and authorized report page are independent reads');
  assert.deepEqual(datasetReads, [], 'cold Eval2 must not wait for master inventory or Assigned Items hydration');
  assert.ok(elapsed < 2000, `cold report reader path took ${elapsed.toFixed(1)} ms`);
  const idsStart = html.indexOf('function getManagerEvalReport2SelectedReportIds(');
  const idsEnd = html.indexOf('\n        function ', idsStart + 1);
  assert.ok(idsStart >= 0 && idsEnd > idsStart);
  context.managerEvalReport2SelectedReportIds = [];
  context.managerEvalReport2SelectionInitialized = false;
  context.activeManagerEvalReport2 = '';
  context.getManagerEvalReports2Api = () => ({ REPORT_IDS:Array.from(engine.REPORT_IDS) });
  vm.runInContext(`${html.slice(idsStart, idsEnd)}; globalThis.selectedIds = getManagerEvalReport2SelectedReportIds();`, context);
  assert.deepEqual(Array.from(context.selectedIds), ['low-stock'], 'cold report query defaults only to LowStock');
  assert.match(html, /loadManagerEvalReport2ProgressivePage\(state\)/,
    'the first report rows are rendered from materialized pages with one progressive continuation');
});

test('Eval2 uses authoritative all-11 server counts and bounded card previews without eager item-row fan-out', async () => {
  const html = readComposedAppSource();
  const countStart = html.indexOf('function getManagerEvalReport2ReportCount(');
  const countEnd = html.indexOf('\n        function ', countStart + 1);
  const signalStart = html.indexOf('function getManagerEvalReport2CountSignals(');
  const signalEnd = html.indexOf('\n        function ', signalStart + 1);
  assert.ok(countStart >= 0 && countEnd > countStart && signalStart >= 0 && signalEnd > signalStart);
  const counts = Object.fromEntries(engine.REPORT_IDS.map((id, index) => [id, 25 + index]));
  const index = { paged:true, counts, inventoryRowCount:9585, fullReportMatchCount:7186, filteredRowCount:1200 };
  const context = vm.createContext({ getManagerEvalReport2Index:() => index,
    getManagerEvalReport2Rows:id => [{ id }], getManagerEvalReports2Api:() => engine,
    Object, Number, String, Math });
  vm.runInContext(`${html.slice(countStart, countEnd)}\n${html.slice(signalStart, signalEnd)}; globalThis.count = getManagerEvalReport2ReportCount; globalThis.signals = getManagerEvalReport2CountSignals;`, context);
  assert.deepEqual(Array.from(engine.REPORT_IDS, id => context.count(id)), Array.from(engine.REPORT_IDS, id => counts[id]));
  assert.deepEqual(JSON.parse(JSON.stringify(context.signals())), { ready:true, sourceRows:9585, matches:7186 });

  const recordStart = html.indexOf('function renderPagedManagerEval2Record(');
  const recordEnd = html.indexOf('\n        function ', recordStart + 1);
  assert.ok(recordStart >= 0 && recordEnd > recordStart);
  let renderedGroup = null;
  context.isManagerEvalReport2ItemcodeBrowseLevel = () => true;
  context.normalizePagedManagerGroup = value => ({ ...value });
  context.normalizePagedManagerRow = row => ({ ...row, normalized:true });
  context.renderManagerEvalReport2SelectableCard = group => { renderedGroup = group; return '<article>card</article>'; };
  vm.runInContext(`${html.slice(recordStart, recordEnd)}; globalThis.renderRecord = renderPagedManagerEval2Record;`, context);
  const previewRows = [{ locationcode:'C.06.029', itemcode:'A' }];
  assert.match(context.renderRecord({ itemCode:'A', previewRows, previewHasMore:false }, 0), /<article>card<\/article>/);
  assert.equal(renderedGroup.rows[0].normalized, true, 'bounded group previews render their location rows synchronously');
  assert.doesNotMatch(html.slice(recordStart, recordEnd), /data-paged-eval2-item-rows/,
    'Eval2 cards no longer launch an independent row query for every item group');
  const pageApplyStart = html.indexOf('function applyManagerEvalReport2ProgressivePage(');
  const pageApplyEnd = html.indexOf('\n        function ', pageApplyStart + 1);
  assert.ok(pageApplyStart >= 0 && pageApplyEnd > pageApplyStart);
  const pageState = { revision:'', rows:[], nextOffset:0, total:null, hasMore:true, error:'', loading:true };
  context.applyPage = null;
  vm.runInContext(`${html.slice(pageApplyStart, pageApplyEnd)}; globalThis.applyPage = applyManagerEvalReport2ProgressivePage;`, context);
  context.applyPage(pageState, { sourceRevision:'r1', total:3, hasMore:true, offset:0, rows:[{ itemCode:'A' }, { itemCode:'B' }] }, true);
  context.applyPage(pageState, { sourceRevision:'r1', total:3, hasMore:false, offset:2, rows:[{ itemCode:'C' }] }, false);
  assert.deepEqual(Array.from(pageState.rows, group => group.itemCode), ['A', 'B', 'C']);
  assert.equal(pageState.nextOffset, 3);
  assert.equal(pageState.hasMore, false, 'progressive report reads stop at the server-reported final page');
  assert.throws(() => context.applyPage(pageState, { sourceRevision:'r2', total:4, hasMore:true, offset:3, rows:[{ itemCode:'D' }] }, false), /report changed/i,
    'a changed source revision cannot append rows from a different snapshot');
  assert.throws(() => context.applyPage(pageState, { sourceRevision:'r1', total:3, hasMore:true, offset:3, rows:[] }, false), /empty page/i,
    'an empty page that claims more results cannot leave the continuation stuck at the same offset');
  const loadStart = html.indexOf('function loadManagerEvalReport2ProgressivePage(');
  const loadEnd = html.indexOf('\n        function ', loadStart + 1);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const calls = [];
  const progressiveState = { key:'query', query:{ surface:'eval2', operation:'groups', offset:0, limit:25 }, owner:'account-a',
    rows:[], nextOffset:0, total:null, revision:'', hasMore:true, loading:false, error:'', requestId:0 };
  context.managerEvalReport2ProgressiveRowsState = progressiveState;
  context.getSupabaseReadIdentityScope = () => 'account-a';
  context.scheduleManagersRender = () => {};
  context.getManagerEvalReport2BrowsePage = () => null;
  context.getManagerReportPageController = () => ({
    load:async query => { calls.push(['load', query.offset]); return { sourceRevision:'r1', total:2, hasMore:true, offset:0, rows:[{ key:'item:A', itemCode:'A' }] }; },
    readPage:async query => { calls.push(['read', query.offset, query.sourceRevision]); return { sourceRevision:'r1', total:2, hasMore:false, offset:1, rows:[{ key:'item:B', itemCode:'B' }] }; },
    state:() => ({ error:'' })
  });
  vm.runInContext(`${html.slice(loadStart, loadEnd)}; globalThis.loadPage = loadManagerEvalReport2ProgressivePage;`, context);
  await context.loadPage(progressiveState);
  await context.loadPage(progressiveState);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['load', 0], ['read', 1, 'r1']]);
  assert.deepEqual(Array.from(progressiveState.rows, group => group.itemCode), ['A', 'B']);
  assert.equal(progressiveState.hasMore, false);

  const refreshStart = html.indexOf('function refreshManagerEvalReport2ProgressiveRows(');
  const refreshEnd = html.indexOf('\n        function ', refreshStart + 1);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  let resolveRefresh;
  const refreshPagePromise = new Promise(resolve => { resolveRefresh = resolve; });
  const retainedState = { key:'query', query:{ surface:'eval2', operation:'groups' }, owner:'account-a', rows:[{ key:'item:old', itemCode:'OLD' }],
    nextOffset:1, total:2, revision:'r1', hasMore:true, loading:false, refreshing:false, error:'', retryFirstPage:false, requestId:0 };
  let activeOwner = 'account-a';
  context.getSupabaseReadIdentityScope = () => activeOwner;
  context.managerEvalReport2ProgressiveRowsState = retainedState;
  context.getManagerReportPageController = () => ({ load:() => refreshPagePromise, state:() => ({ error:'' }) });
  context.initialProgressiveState = retainedState;
  vm.runInContext(`let managerEvalReport2ProgressiveRowsState = globalThis.initialProgressiveState;
    function scheduleManagersRender() {}
    ${html.slice(refreshStart, refreshEnd)}
    globalThis.refreshProgressive = refreshManagerEvalReport2ProgressiveRows;
    globalThis.replaceProgressiveState = value => { managerEvalReport2ProgressiveRowsState = value; };`, context);
  const refreshPromise = context.refreshProgressive(retainedState);
  assert.deepEqual(Array.from(retainedState.rows, group => group.itemCode), ['OLD'], 'last-good cards stay visible while a refresh is pending');
  resolveRefresh({ sourceRevision:'r2', total:1, hasMore:false, offset:0, rows:[{ key:'item:new', itemCode:'NEW' }] });
  await refreshPromise;
  assert.deepEqual(Array.from(retainedState.rows, group => group.itemCode), ['NEW'], 'a successful revision refresh replaces the old page set');

  const staleState = { key:'query', query:{ surface:'eval2', operation:'groups' }, owner:'account-a', rows:[{ key:'item:old', itemCode:'OLD' }],
    nextOffset:1, total:2, revision:'r1', hasMore:true, loading:false, refreshing:false, error:'', retryFirstPage:false, requestId:0 };
  let resolveStaleRefresh;
  const staleRefreshPagePromise = new Promise(resolve => { resolveStaleRefresh = resolve; });
  context.getManagerReportPageController = () => ({ load:() => staleRefreshPagePromise, state:() => ({ error:'' }) });
  context.managerEvalReport2ProgressiveRowsState = staleState;
  const staleRefresh = context.refreshProgressive(staleState);
  activeOwner = 'account-b';
  context.replaceProgressiveState({ owner:'account-b', rows:[] });
  resolveStaleRefresh({ sourceRevision:'r2', total:1, hasMore:false, offset:0, rows:[{ key:'item:new', itemCode:'NEW' }] });
  await staleRefresh;
  assert.deepEqual(Array.from(staleState.rows, group => group.itemCode), ['OLD'], 'a response from the prior account cannot replace its retained rows');
  assert.match(html.slice(html.indexOf('function renderManagerEvalReport2Records('), html.indexOf('\n        function ', html.indexOf('function renderManagerEvalReport2Records(') + 1)),
    /managerEvalReport2DisplayMode,\s*managerEvalReport2SelectionRevision,\s*managerEvalReport2EditRevision/,
    'display mode, selection, and edits participate in the progressive render key');

  assert.match(html.slice(html.indexOf('function renderManagerEvalReport2ReportsPanel('), html.indexOf('\n        function ', html.indexOf('function renderManagerEvalReport2ReportsPanel(') + 1)), /data-eval-report-counts-ready/);
  const recordsStart = html.indexOf('function renderManagerEvalReport2Records(');
  const recordsEnd = html.indexOf('\n        function ', recordsStart + 1);
  assert.ok(recordsStart >= 0 && recordsEnd > recordsStart);
  const recordsSource = html.slice(recordsStart, recordsEnd);
  assert.match(recordsSource, /data-eval2-progressive-list/);
  assert.match(recordsSource, /data-eval2-page-sentinel/);
  assert.match(recordsSource, /No matching rows for selected report filter\(s\)\./);
  assert.doesNotMatch(recordsSource, /mountPagedManagerReport\(container/,
    'Eval2 displays only materialized groups and fetches the next page from one continuation sentinel');
});

test('Eval2 report loading ignores blocked capability refresh, preserves server authorization, and retries without snapshots', async () => {
  const live = { module:{ exports:{} }, AbortController };
  vm.runInNewContext(readFileSync(new URL('../assets/report-pages-live.js', import.meta.url), 'utf8'), live);
  let rejectCapabilities, capabilityCalls = 0, readyCalls = 0, groupReads = 0;
  const capabilityPromise = new Promise((_resolve, reject) => { rejectCapabilities = reject; });
  const query = { surface:'eval2', operation:'groups', filters:{ reportIds:Array.from(engine.REPORT_IDS) }, offset:0, limit:25 };
  const expectedPage = { sourceRevision:'eval-r2', rows:[{ itemCode:'B' }] };
  const pageController = live.module.exports.createController({
    scope:() => 'account-a', permission:() => 'account-a', allowed:() => true,
    serverAuthorizedSurfaces:['eval2'], loadModule:async () => ({ createReportSession:() => ({
      read:async () => { groupReads += 1; if (groupReads === 1) throw new Error('temporary report read failure'); return expectedPage; },
      refresh:async () => expectedPage, clear() {}
    }) }),
    onReady:() => { readyCalls += 1; },
    transport:request => {
      if (request) return Promise.resolve(expectedPage);
      capabilityCalls += 1;
      return capabilityCalls === 1 ? capabilityPromise : Promise.reject(new Error('capabilities still unavailable'));
    }
  });
  const runSource = readComposedAppSource();
  const loaderStart = runSource.indexOf('async function loadManagerEvalReports2(');
  const loaderEnd = runSource.indexOf('\n        function getManagerEvalReport2CacheKeyValue(', loaderStart);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart);
  let datasetReads = 0, loaderCalls = 0;
  const pageState = { pendingKey:'', promise:null, error:'', page:null };
  const loaderController = {
    state:() => pageState,
    load:async () => { loaderCalls += 1; if (loaderCalls === 1) { pageState.error = 'temporary report read failure'; return null; }
      pageState.error = ''; pageState.page = expectedPage; return expectedPage; },
    refresh() {}
  };
  const runtime = vm.createContext({
    canViewManagerEvalReports2:() => true, window:{ GncReportPagesLive:{} },
    managerEvalReport2LoadState:{ loading:false,error:'',owner:'',promise:null }, managerEvalReport2Cache:null,
    getManagerReportPageController:() => loaderController, buildManagerReportPageQuery:() => query,
    getManagerEvalReport2Index:() => pageState.page, scheduleManagersRender() {},
    getManagerEvalReport2BrowsePage:() => pageState.page,
    ensureDatasetLoaded:async () => { datasetReads += 1; throw new Error('full snapshot path is forbidden'); },
    Promise, JSON, String, Object, Array
  });
  vm.runInContext(`let managerEvalReport2ProgressiveRowsState = null;\n${runSource.slice(loaderStart, loaderEnd)}; globalThis.loadEval2 = loadManagerEvalReports2;`, runtime);

  const actualPageRead = pageController.load(query);
  const first = await actualPageRead;
  assert.equal(first, null, 'a report read can fail while capabilities remain pending');
  assert.equal(pageController.enabled('eval2'), true, 'local eligibility keeps Eval2 routed through server authorization');
  assert.equal(pageController.enabled('assigned-items'), false, 'failed capabilities do not grant unrelated report surfaces');
  assert.equal(await pageController.load(query), expectedPage, 'the server page can retry while the capability request is still blocked');
  rejectCapabilities(new Error('temporary capabilities failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(capabilityCalls, 1, 'a failed optional capability read is attempted once without automatic rerender loops');
  assert.equal(readyCalls, 1, 'capability failure does not repeatedly remount the existing session');
  assert.equal(await pageController.load(query, true), expectedPage, 'an explicit read retry can refresh capabilities in the background');
  assert.equal(capabilityCalls, 2);
  await pageController.load(query);
  assert.equal(capabilityCalls, 2, 'ordinary report renders do not restart failed capability checks');
  assert.equal(await runtime.loadEval2(false), null, 'failed report fetch returns without entering a local snapshot path');
  const retry = await runtime.loadEval2(true);
  assert.equal(retry, expectedPage, 'explicit retry recovers the report page');
  assert.equal(loaderCalls, 2);
  assert.equal(datasetReads, 0, 'failed and retried report reads never download master or assignment snapshots');
  assert.equal(groupReads, 3);
  assert.equal(pageController.enabled('eval2'), true, 'capability failure never disables the server-authorized report surface');
});

test('Eval2 classifier paths omit per-item target APIs and honor shared threshold boundaries', () => {
  const html = readComposedAppSource();
  const source = name => {
    const start = html.indexOf(`function ${name}(`);
    const end = html.indexOf('\n        function ', start + 1);
    assert.ok(start >= 0 && end > start, name);
    return html.slice(start, end);
  };
  for (const name of ['getManagerEvalReport2CacheKeyValue', 'getManagerEvalReport2WorkerSource', 'performManagerEvalReport2IndexBuild', 'getManagerEvalReport2Index', 'renderManagerEvalReport2Records']) {
    assert.doesNotMatch(source(name), /getManagerItemLowStockTarget|managerEvalReport2NeedsLowStockTargets|managerEvalReport2LowStockTargetsReady|itemLowStockTargets|lowStockReady/, `${name} must not wait on or classify with per-item overrides`);
  }

  const rows = [
    row('OVERRIDDEN', 'F1', 27, { TEST_ID:'override-only', S_LTS:80 }),
    row('OVERRIDDEN', 'U1', 27, { TEST_ID:'override-support' }),
    row('SHARED', 'F1', 27, { TEST_ID:'shared-anchor', S_LTS:74 }),
    row('SHARED', 'U1', 27, { TEST_ID:'shared-support' })
  ];
  for (const classify of [engine.classifyRows, engine.classifyScriptCompatibleRows]) {
    const result = classify(rows, { currentSeason:'F1', currentSalesYear:27, nextSeason:'S1', nextSalesYear:27,
      settings:{lowStockMaxSLts:75}, now });
    assert.deepEqual(ids(result.reports['low-stock']), ['shared-support']);
  }
});

test('Eval2 index builder sends shared-threshold options to every classifier path', async () => {
  const html = readComposedAppSource();
  const start = html.indexOf('async function performManagerEvalReport2IndexBuild(');
  const end = html.indexOf('function getManagerEvalReport2Index(', start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  const rows = [
    row('OVERRIDDEN', 'F1', 27, { TEST_ID:'override-only', UNIQUE_ID:'override-anchor', S_LTS:80 }),
    row('OVERRIDDEN', 'U1', 27, { TEST_ID:'override-support', UNIQUE_ID:'override-support' }),
    row('SHARED', 'F1', 27, { TEST_ID:'shared-anchor', UNIQUE_ID:'shared-anchor', S_LTS:74 }),
    row('SHARED', 'U1', 27, { TEST_ID:'shared-support', UNIQUE_ID:'shared-support' })
  ];
  const warmedOverrides = new Map([['OVERRIDDEN', {manual_override_qty:120,suggested_qty:110}]]);
  let targetStateReads = 0, actualOptions = null;
  const api = Object.assign({}, engine, {
    async classifyScriptCompatibleRowsAsync(input, options, yieldTask) {
      actualOptions = options;
      return engine.classifyScriptCompatibleRowsAsync(input, options, yieldTask);
    }
  });
  const scope = vm.createContext({
    Worker:undefined, Map, Set, Date, Object, Array, String, Number, Math,
    managerEvalReport2Cache:null, managerEvalReport2CacheKey:'',
    getManagerEvalReport2CacheKeyValue:() => 'snapshot-settings-date-v1',
    getSupabaseReadIdentityScope:() => 'manager-account', canViewManagerEvalReports2:() => true,
    getManagerEvalReports2Api:() => api,
    getConfiguredCurrentSeasonCode:() => 'F1', getConfiguredCurrentSalesYearCode:() => 27,
    getConfiguredNextSaleSeasonTarget:() => ({season:'S1',salesYear:27}),
    managerEvalReportSettings:{lowStockMaxSLts:75,holdAgeDays:5,locationNoteAgeDays:10},
    fullInventory:rows, warehouseAssignedItemsInventory:[],
    getManagerItemLowStockTargetsState:() => { targetStateReads += 1; return {rowsByCode:warmedOverrides,revision:9}; },
    getManagerEvalReport2ItemCode:item => String(item.ITEMCODE || '').toUpperCase(),
    getManagerEvalReport2RowKey:(item,index) => String(item.UNIQUE_ID || `row-${index}`),
    prepareManagerEvalReport2GroupLookups:index => index,
    setTimeout:callback => { callback(); return 1; }, clearTimeout:() => {},
    reconcileManagerEvalReport2Navigation:() => {},
    reportSemanticHealthEvent:() => {}
  });
  vm.runInContext(`${source};globalThis.build = performManagerEvalReport2IndexBuild;`, scope);
  const result = await scope.build({key:'snapshot-settings-date-v1',owner:'manager-account',cancelled:false});
  assert.equal(targetStateReads, 0, 'a warm override cache must not be read by Eval2 indexing');
  assert.equal(Object.hasOwn(actualOptions, 'itemLowStockTargets'), false, 'the worker and fallback options use the shared threshold only');
  assert.deepEqual(Array.from(result.reports['low-stock'], item => item.UNIQUE_ID), ['shared-support']);
  for (const classify of [engine.classifyRows, engine.classifyScriptCompatibleRows]) {
    const classified = classify(rows, actualOptions);
    assert.deepEqual(ids(classified.reports['low-stock']), ['shared-support']);
  }
  const asyncClassified = await engine.classifyScriptCompatibleRowsAsync(rows, actualOptions, async () => {});
  assert.deepEqual(ids(asyncClassified.reports['low-stock']), ['shared-support']);
});

test('async report results reject changed identity, snapshot, and access', async () => {
  const html = readComposedAppSource();
  const start = html.indexOf('let managerEvalReport2IndexJob = null');
  const end = html.indexOf('function getManagerEvalReport2Index(', start);
  for (const changed of ['identity', 'snapshot', 'access', 'none']) {
    let identity = 'owner-a', snapshot = 'snapshot-a', allowed = true, pending;
    class FixtureWorker {
      constructor() { pending = this; }
      postMessage() {}
      terminate() {}
    }
    class FixtureURL extends URL {
      static createObjectURL() { return 'blob:fixture'; }
      static revokeObjectURL() {}
    }
    const scope = vm.createContext({ Worker: FixtureWorker, URL: FixtureURL, Blob, Map, Object, performance, recordGncPerfStat: () => {},
      managerEvalReport2Cache: null, managerEvalReport2CacheKey: '',
      getManagerEvalReport2CacheKeyValue: () => snapshot, getSupabaseReadIdentityScope: () => identity,
      canViewManagerEvalReports2: () => allowed, getManagerEvalReports2Api: () => engine,
      getConfiguredNextSaleSeasonTarget: () => ({ season: 'S1', salesYear: 27 }),
      getConfiguredCurrentSeasonCode: () => 'F1', getConfiguredCurrentSalesYearCode: () => 27,
      getManagerEvalReport2WorkerSource: () => 'fixture', window: { location: { href: 'https://fixture.invalid/' } },
      fullInventory: [], warehouseAssignedItemsInventory: [], managerEvalReportSettings: {},
      getManagerItemLowStockTargetsState: () => ({ rowsByCode: new Map(), revision: 0 }),
      managerEvalReport2LowStockTargetsReady: () => false,
      setTimeout: () => 1, clearTimeout: () => {}, reconcileManagerEvalReport2Navigation: () => {},
      reportSemanticHealthEvent: () => assert.fail('unexpected worker fallback'),
      getManagerEvalReport2Index: () => assert.fail('unexpected synchronous build')
    });
    vm.runInContext(`${html.slice(start, end)};globalThis.build = buildManagerEvalReport2IndexAsync;`, scope);
    const promise = scope.build();
    if (changed === 'identity') identity = 'owner-b';
    if (changed === 'snapshot') snapshot = 'snapshot-b';
    if (changed === 'access') allowed = false;
    const identitylessRow = {};
    const classified = { reports: {}, counts: {} };
    pending.onmessage({ data: { classified, assignedToOptions: [], stats: {}, allRows: [identitylessRow],
      rowsByItemCode: new Map(), rowByKey: new Map([['row-index:4', identitylessRow]]), memberships: new Map() } });
    const result = await promise;
    if (changed !== 'none') {
      assert.equal(result, null);
      assert.equal(scope.managerEvalReport2Cache, null);
      assert.equal(scope.managerEvalReport2CacheKey, '');
    } else {
      assert.equal(result, classified);
      assert.equal(scope.managerEvalReport2CacheKey, 'snapshot-a');
      assert.equal(identitylessRow.__evalReport2SourceIndex, 4);
      assert.equal(Object.keys(identitylessRow).includes('__evalReport2SourceIndex'), false);
    }
  }
});

test('item inquiry builds dependent filters and the three Apps Script sections', () => {
  const rows = [
    row('A', 'U1', 27, { ASSIGNEDTO: 'dylan_collyge', COMMONNAME: 'Alpha', CONTSIZE: '#3', PLANTGROUPCODE: 'PG-A', GENUSNAME: 'Genus A', LOTCODE: '27.F1', LOCATIONCODE: 'A.01.001' }),
    row('A', 'U2', 27, { ASSIGNEDTO: 'dylan_collyge', COMMONNAME: 'Alpha', CONTSIZE: '#5', PLANTGROUPCODE: 'PG-A', GENUSNAME: 'Genus A', LOTCODE: '27.F1', LOCATIONCODE: 'A.01.002' }),
    row('B', 'U1', 27, { ASSIGNEDTO: 'megan_kelly', COMMONNAME: 'Beta', CONTSIZE: '#3', PLANTGROUPCODE: 'PG-B', GENUSNAME: 'Genus B', LOTCODE: '27.F1', LOCATIONCODE: 'B.01.001' }),
    row('C', 'U1', 27, { ASSIGNEDTO: '', COMMONNAME: 'Gamma', CONTSIZE: '#1', LOCATIONCODE: 'C.01.001' })
  ];
  const initial = engine.buildItemInquiryModel(rows, {});
  assert.deepEqual(Array.from(initial.options.assignedTo), ['(Unassigned)', 'dylan_collyge', 'megan_kelly']);
  assert.deepEqual(Array.from(initial.options.commonNames), ['Alpha', 'Beta', 'Gamma']);
  assert.equal(initial.sections.location.length, 4);

  const assigned = engine.buildItemInquiryModel(rows, { assignedTo: 'dylan_collyge' });
  assert.deepEqual(Array.from(assigned.options.locationCodes), ['A.01.001', 'A.01.002']);
  assert.deepEqual(Array.from(assigned.options.commonNames), ['Alpha']);
  assert.deepEqual(Array.from(assigned.options.contSizes), ['#3', '#5']);

  const atLocation = engine.buildItemInquiryModel(rows, { assignedTo: 'dylan_collyge', locationCode: 'A.01.002' });
  assert.equal(atLocation.matchedRows.length, 1);
  assert.deepEqual(Array.from(atLocation.options.commonNames), ['Alpha']);
  assert.deepEqual(Array.from(atLocation.options.contSizes), ['#5']);

  const filtered = engine.buildItemInquiryModel(rows, { assignedTo: 'dylan_collyge', locationCode: 'A.01.001', commonName: 'Alpha', contSize: '#3' });
  assert.equal(filtered.matchedRows.length, 1);
  assert.equal(filtered.filters.locationCode, 'A.01.001');
  assert.equal(filtered.sections.item[0].PLANTGROUPCODE, 'PG-A');
  assert.equal(filtered.sections.season[0].SEASON, 'U1');
  assert.equal(filtered.sections.location[0].LOCATIONCODE, 'A.01.001');
});

test('script-compatible classifier handles 10,000 rows within the existing performance budget', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => row(
    `SCRIPT-${String(index % 2500).padStart(4, '0')}`,
    index % 5 === 0 ? 'F1' : ['U1', 'U2', 'U3', 'X'][index % 4],
    27,
    { TEST_ID: String(index), PRIORITY: index % 7 === 0 ? '1' : '', S_LTS: index % 200 }
  ));
  const started = performance.now();
  const result = engine.classifyScriptCompatibleRows(rows, { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
  const elapsed = performance.now() - started;
  assert.equal(result.counts.culls, 2000);
  assert.ok(elapsed < 500, `script-compatible classification took ${elapsed.toFixed(1)} ms`);
});

test('authoritative assignment overlay and classification stay within the 10,000-row budget', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => row(
    `OVERLAY-${String(index % 2500).padStart(4, '0')}`,
    index % 5 === 0 ? 'F1' : ['U1', 'U2', 'U3', 'X'][index % 4],
    27,
    { GENUSNAME: `Genus ${index % 2500}`, ASSIGNEDTO: 'stale_master_user', S_LTS: index % 200 }
  ));
  const assignments = Array.from({ length: 2500 }, (_, index) => ({
    ITEMCODE: `overlay-${String(index).padStart(4, '0')}`,
    GENUSNAME: `  genus   ${index} `,
    ASSIGNEDTO: expectedAssignees[index % expectedAssignees.length]
  }));
  const started = performance.now();
  const model = engine.buildAuthoritativeAssignmentModel(rows, assignments);
  const result = engine.classifyScriptCompatibleRows(model.rows, { currentSalesYear: 27, nextSeason: 'S1', nextSalesYear: 27, now });
  const elapsed = performance.now() - started;
  assert.equal(model.matchedCount, 10000);
  assert.equal(result.counts.culls, 2000);
  // This benchmark runs beside the browser-heavy pilot files in the full gate.
  // Keep a narrow allowance for Windows scheduler contention; the isolated
  // 10,000-row benchmark remains comfortably below 500 ms.
  assert.ok(elapsed < 650, `assignment overlay and classification took ${elapsed.toFixed(1)} ms`);
});

test('the live shell keeps Eval Reports #1 and settings management Dylan/Megan-only', () => {
  const html = readComposedAppSource();
  const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(html, /const MANAGER_EVAL_REPORTS_VIEW = 'eval-reports'/);
  assert.match(html, /key === 'dylan_collyge' \|\| key === 'megan_kelly'/);
  assert.match(html, /supabaseRpc\('get_eval_report_settings'/);
  assert.match(html, /supabaseRpc\('set_eval_report_settings'/);
  assert.match(html, /assets\/eval-reports-engine\.js/);
  assert.match(serviceWorker, /\.\/assets\/eval-reports-engine\.js/);
});

test('the live shell registers Eval Reports #2 without replacing Eval Reports #1', () => {
  const html = readComposedAppSource();
  assert.match(html, /const MANAGER_EVAL_REPORTS_VIEW = 'eval-reports'/);
  assert.match(html, /const MANAGER_EVAL_REPORTS_2_VIEW = 'eval-reports-2'/);
  assert.match(html, /tabs\.push\(\{ id: MANAGER_EVAL_REPORTS_2_VIEW, label: 'Eval Reports #2' \}\)/);
  assert.match(html, /else if \(activeHomeTab === MANAGER_EVAL_REPORTS_2_VIEW\) html \+= renderManagerEvalReports2Panel\(\)/);
  assert.match(html, /function loadManagerEvalReports2\(force = false\)/);
  assert.match(html, /ensureDatasetLoaded\('master', 'full'/);
  assert.match(html, /ensureDatasetLoaded\('warehouseAssignedItems', 'full'/);
  assert.match(html, /api\.buildAuthoritativeAssignmentModel\(fullInventory, warehouseAssignedItemsInventory, \{ assignmentContract: 'inventory-row-assignments-v1' \}\)/);
  assert.match(html, /api\.classifyScriptCompatibleRows\(assignmentModel\.rows/);
  assert.match(html, /api\.buildItemInquiryModel\(getManagerEvalReport2Rows\(\)/);
  assert.match(html, /model\.options\.assignedTo = getManagerEvalReport2AssignedToOptions\(\)/);
  assert.match(html, /getDatasetLoadSignature\('warehouseAssignedItems'\)/);
  assert.match(html, /invalidateManagerEvalReport2Cache\(\)/);
  const filter = html.slice(html.indexOf('async function applyManagerEvalReport2UserFilter('), html.indexOf('function applyManagerEvalUserPicker('));
  assert.doesNotMatch(filter, /force:true|invalidateManagerEvalReport2Cache/);
  assert.match(filter, /managerEvalReport2VisibleGroupsCacheKey = ''/);
  assert.match(html, /if \(managerEvalReport2AssignmentFilterRefreshing\) return \[\]/);
  assert.match(html, /Verifying current AssignedTo ownership before showing results/);
  assert.match(html, /function getManagerEvalReport2LocationOptions\(rows = null\)/);
  assert.match(html, /managerEvalReport2LocationFilter !== 'all'/);
  assert.match(html, /Each card is one ITEMCODE and lists every current row/);
  assert.match(html, /Tap its checkbox for Queue work; tap anywhere else for the Drive Mode Item Inquiry/);
  assert.match(html, /Choose Report/);
  assert.match(html, /function getManagerEvalReport2DrillGroups\(rows = null\)/);
  assert.match(html, /function openManagerEvalReport2CommonName\(commonName = ''\)/);
  assert.doesNotMatch(html, /Refresh failed; the last complete results remain visible/);
  assert.match(html, /return managerEvalReport2Cache/);
  assert.match(html, /downloadExcelWorkbook\(getDriveReportExportColumns\(\), rows, `Eval Reports #2/);
  assert.match(html, /function renderManagerEvalReport2SelectableCard\(itemGroup = null, index = 0\)/);
  assert.match(html, /function openManagerEvalReport2ItemDetail\(encodedKey = ''\)/);
  assert.match(html, /function closeManagerEvalReport2ItemDetail\(\)/);
  assert.match(html, /function renderManagerEvalReport2ItemDetail\(\)/);
  assert.match(html, /data-role="manager-eval2-selection-toggle"/);
  assert.match(html, /Select All Shown/);
  assert.match(html, /Deselect Shown/);
  assert.match(html, /\['LOCATIONCODE', 'SOURCE', 'LOTCODE', 'ITEMSPEC', 'S_LTS', 'SALESNOTE', 'DESIGITEM', 'DESIGCUST', 'DESIGLOC', 'PTRAVAILABLE'\]/);
  assert.match(html, /const MANAGER_EVAL_REPORT2_EDITABLE_FIELDS = Object\.freeze/);
  for (const field of ['HOLDSTOPCODE', 'HOLDSTOPREASON', 'HOLDSTOPBEGINDATE', 'PRIORITY', 'LOCATIONNOTE', 'LOCATIONPTN1', 'SUSPENDTO', 'SPECIALPULLER']) {
    assert.match(html, new RegExp(`buildManagerEvalReport2EditableField\\(row, index, '${field}'\\)`));
  }
  assert.match(html, /buildManagerEvalReport2DetailField\(row, 'LOCATIONNOTEDATE', \{ date: true, rowIndex: index \}\)/);
  assert.match(html, /function setManagerEvalReport2RowEditValue\(rowKey = '', fieldKey = '', value = ''\)/);
  assert.match(html, /values\.LOCATIONNOTEDATE = getManagerEvalReportCentralDateKey\(\)/);
  assert.match(html, /function ensureManagerEvalReport2ItemSelectedForEdit\(row = null\)/);
  assert.match(html, /temporary report-only proposals/);
  assert.match(html, /function toggleManagerEvalReport2ItemSelection\(encodedKey = '', forceSelected = null\)/);
  assert.match(html, /function toggleAllShownManagerEvalReport2Items\(\)/);
  assert.doesNotMatch(html, /managerEvalReport2SelectionMode|startManagerEvalReport2LongPress|renderManagerEvalReport2ReportsPanelLegacy/);
  assert.match(html, /function getManagerEvalReport2AllCurrentItemRows\(itemCode = ''\)/);
  assert.match(html, /function buildManagerEvalReport2ExcelAttachment\(rows = \[\]\)/);
  assert.match(html, /function canViewManagerEvalReports2\(userOverride = ''\)/);
  assert.match(html, /key === 'dylan_collyge' \|\| key === 'megan_kelly' \|\| key === 'jd_jones'/);
  assert.match(html, /managerEvalReport2SelectedItemsByKey=new Map\(\)/);
  assert.match(html, /managerEvalReport2EditsByRowKey=new Map\(\)/);
  assert.match(html, /managerEvalReport2LockedAssignedTo/);
  assert.match(html, /managerEvalReport2LockedReportId/);
  assert.match(html, /id="manager-eval-report-2-more-menu"/);
  assert.match(html, /manager-eval2-drive-shell/);
  assert.match(html, /manager-eval2-drive-controls/);
  assert.match(html, /manager-eval2-drive-filter-grid/);
  assert.match(html, /manager-eval2-drive-group-card/);
  assert.match(html, /manager-eval2-drive-crumb/);
  assert.match(html, /function getManagerEvalReport2BrowseCrumbText\(\)/);
  assert.match(html, /return `\$\{root\} > ITEMCODEs`/);
  assert.match(html, /return `\$\{root\} > \$\{blockLabel\} > LocationCode`/);
  assert.match(html, /id="manager-eval-report-2-view-itemcodes"/);
  assert.match(html, /id="manager-eval-report-2-view-location"/);
  assert.match(html, /function refreshManagerEvalReport2BrowseRegion\(options = \{\}\)/);
  assert.match(html, /const driveAroundLayout = tab === MANAGER_EVAL_REPORTS_2_VIEW/);
  assert.match(html, /const blockClearingLayout = tab === MANAGER_BLOCK_CLEARING_VIEW/);
  assert.match(html, /moduleFreeze\.classList\.toggle\('hidden', driveAroundLayout \|\| blockClearingLayout \|\| tab === MANAGER_PRODUCTION_SCHEDULE_VIEW \|\| tab === MANAGER_HR_COMMAND_VIEW\)/);
  assert.match(html, /const accessibleTitle = '<h2 class="sr-only">Eval Reports #2<\/h2>'/);
  assert.match(html, /managerEvalReport2Cache\.rowsByItemCode = new Map\(\)/);
  assert.match(html, /function getManagerEvalReport2SelectedRows\(\)/);
  assert.match(html, /function buildManagerEvalReport2SelectableGridHtml\(itemGroups = \[\]\)/);
  assert.match(html, /function buildManagerEvalReport2ItemInquiryWorkbookBlob\(rows = \[\]\)/);
  assert.match(html, /MANAGER_EVAL_REPORT2_ITEM_INQUIRY_MAX_BYTES = 18 \* 1024 \* 1024/);
  const exportColumnBlock = html.match(/const MANAGER_EVAL_REPORT2_ITEM_INQUIRY_COLUMNS = Object\.freeze\(\[([\s\S]*?)\n        \]\);/);
  assert.ok(exportColumnBlock, 'Eval Reports #2 export columns should be declared');
  const exportLabels = Array.from(exportColumnBlock[1].matchAll(/label: '([^']+)'/g), (match) => match[1]);
  assert.deepEqual(exportLabels, [
    'ITEMCODE', 'CONTSIZE', 'COMMONNAME', 'LOCATIONCODE', 'SOURCE', 'LOTCODE', 'ITEMSPEC',
    'HOLDSTOPCODE', 'HOLDSTOPREASON', 'HOLDSTOPBEGINDATE', 's_LTS', 'SALESNOTE', 'PRIORITY',
    'DesigItem', 'DesigCust', 'DesigLoc', 'PTRAVAILABLE', 'LOCATIONNOTE', 'LOCATIONNOTEDATE',
    'LOCATIONPTN1', 'SUSPENDTO', 'SPECIALPULLER',
  ]);
  assert.doesNotMatch(exportColumnBlock[1], /label: 'ASSIGNEDTO'|label: 'REPORTS'/);
  assert.match(html, /buildExcelSheetViewsXml\(1, 0\)/);
  assert.match(html, /<autoFilter ref="A1:\$\{lastColumn\}\$\{rowNumber\}"\/>/);
  assert.match(html, /sheet name="Item Inquiry"/);
  assert.match(html, /function emailSelectedManagerEvalReport2Rows\(\)/);
  assert.match(html, /function openManagerEvalReport2BatchSetup\(\)/);
  assert.match(html, /function createManagerEvalReport2Batch\(button = null\)/);
  assert.match(html, /id="manager-eval-report-2-done-button"/);
  assert.match(html, /if \(managerEvalReport2LoadState\.loading && !allowSynchronousBuild && !hasSavedDisplayCohort\) return managerEvalReport2Cache/);
  assert.match(html, /if \(managerEvalReport2LoadState\.error && managerEvalReport2Cache\) return managerEvalReport2Cache/);
  assert.match(html, /evalWorkApi\('create_batch'/);
  assert.match(html, /PDF assignment/);
  assert.doesNotMatch(html, /eval_reports_2_item_inquiry_excel/);
  assert.match(html, /isManagerEvalReport2ExportCellEdited\(entry, column\)/);
  assert.match(html, /rgb="FFFFF2CC"/);
  assert.match(html, /overlay\.temporaryChangedFields = Object\.keys\(temporaryValues\)/);
  assert.match(html, /const rows = getManagerEvalReport2AllCurrentItemRows\(entry\.itemCode\)/);
  assert.match(html, /itemcodeWideScope.*itemcode-all-rows-v1/);
  const batchSetupSlice = html.slice(html.indexOf('function renderManagerEvalReport2ItemcodeScopeSummary'), html.indexOf('async function createManagerEvalReport2Batch'));
  assert.match(batchSetupSlice, /Every current row for each selected ITEMCODE is included in Eval Work and the PDF/);
  assert.doesNotMatch(batchSetupSlice, /Select All Lots|Select All Shown|Clear Lots|Block Alpha|Block Number|Location\/Lot/);
  assert.doesNotMatch(html.slice(html.indexOf('function setManagerEvalReport2RowEditValue'), html.indexOf('function isNamedManagerEvalReport2AssignedTo')), /supabase(Update|Insert|Delete|Rpc)|fetch\(/i);
  assert.match(html, /Your active profile does not have access to Eval Reports #2/);
});

test('Eval Reports #1 and #2 share multi-user OR filtering without locking AssignedTo', () => {
  const html = readComposedAppSource();
  assert.match(html, /managerEvalReportAssignedToFilters=new Set\(\)/);
  assert.match(html, /managerEvalReport2AssignedToFilters=new Set\(\)/);
  assert.match(html, /function managerEvalAssignedUserMatches\(/);
  assert.match(html, /function openManagerEvalUserPicker\(/);
  assert.match(html, /Select Visible/);
  assert.match(html, /All Users/);
  assert.match(html, /\(Unassigned\)/);
  assert.match(html, /assignedToUsers/);
  assert.doesNotMatch(html, /One AssignedTo Per Email/);
  assert.doesNotMatch(html, /Select one named AssignedTo user before selecting Item Inquiry ITEMCODEs/);
});

test('detail teardown and BlockAlpha drilldowns keep navigation state explicit', () => {
  const html = readComposedAppSource();
  assert.match(html, /function teardownDetailPresentation\(reason = 'detail-teardown', options = \{\}\)/);
  assert.match(html, /const leavingDetail = safeViewId !== 'detail' && isViewVisible\('detail'\)/);
  assert.match(html, /teardownDetailPresentation\('primary-view-change', \{ preserveDraft: true \}\)/);
  assert.match(html, /document\.body\.classList\.remove\('request-av-note-sheet-open'/);
  assert.match(html, /DRIVE_NO_BLOCK_ALPHA = '__NO_BLOCK_ALPHA__'/);
  assert.match(html, /DRIVE_NO_BLOCK_NUMBER = '__NO_BLOCK_NUMBER__'/);
  assert.match(html, /function getDriveBlockAlphaValue\(item = null\)/);
  assert.match(html, /function getDriveBlockNumberValue\(item = null\)/);
  assert.match(html, /> Location > Select Block Alpha/);
  assert.match(html, /> \$\{selectedBlockLabel\} > Select Block Number/);
  assert.match(html, /function backManagerEvalReport2Drill\(\)/);
  const globalBack = html.match(/        function goBackUniversal\([^]*?^        }/m)?.[0];
  assert.ok(globalBack);
  const managerBack = globalBack.match(/if \(currentView === 'managers'\) \{([^]*?)\n            }/)?.[1];
  assert.ok(managerBack);
  assert.match(managerBack, /activeHomeTab[^]*?!== 'dashboard'\) return openManagersModules\(\)/);
  assert.match(managerBack, /fastBackHome\(\)/);
  assert.match(managerBack, /backManagerEvalReport2Drill/);
  assert.match(managerBack, /managerEvalReport2BrowseMode === 'location'/);
  const modules = html.match(/        function openManagersModules\([^]*?^        }/m)?.[0];
  assert.ok(modules);
  assert.match(modules, /activeHomeTab = 'dashboard'/);
  assert.match(modules, /cancelManagerSeasonPriorityRead\(\)/);
  assert.match(modules, /GncProductionSchedule\?\.unmount\(\)/);
  assert.match(modules, /renderManagers\(\)/);
  assert.match(html, /\[data-manager-eval2-detail\]>div:first-child>button:first-child\{display:none!important\}/);
});

test('cold paged Eval2 index uses server report totals without an undefined surface flag', async () => {
  const { default: vm } = await import('node:vm');
  const { readComposedAppSource } = await import('../scripts/composed-app-source.mjs');
  const source = readComposedAppSource();
  const ctx = vm.createContext({ getManagerEvalReportsApi: () => ({ REPORT_IDS: ['one'] }),
    getSupabaseReadIdentityScope: () => 'same-account', appAccessSnapshotState: { snapshot: {} }, managerEvalReport2Cache: null,
    getManagerEvalReport2SelectedReportIds: () => Array(11).fill('one'), getConfiguredCurrentSeasonCode: () => 'F1',
    getConfiguredCurrentSalesYearCode: () => '27', getConfiguredNextSaleSeasonTarget: () => ({ season: 'S1', salesYear: '27' }), managerEvalReportSettings: {} });
  vm.runInContext(source.match(/        function createPagedManagerEvalIndex\([^]*?^        }/m)[0], ctx);
  assert.equal(ctx.createPagedManagerEvalIndex({ revision: '1', metadata: { reportMatchCount: 31, filteredRowCount: 12 } }).fullReportMatchCount, 31);
});


test('Eval2 defaults only to LowStock and Apply owns the committed selection', () => {
 const source = readComposedAppSource();
 const get = name => source.match(new RegExp('        function '+name+'\\([^]*?^        }','m'))[0];
 const ctx = vm.createContext({getManagerEvalReports2Api:()=>engine,managerEvalReport2SelectionInitialized:false,managerEvalReport2SelectedReportIds:[],activeManagerEvalReport2:''});
 vm.runInContext(get('getManagerEvalReport2SelectedReportIds'),ctx);
 assert.deepEqual(Array.from(ctx.getManagerEvalReport2SelectedReportIds()),['low-stock']);
 assert.doesNotMatch(get('toggleManagerEvalReport2ReportPicker'),/setManagerEvalReport2Reports/);
 assert.match(get('renderManagerEvalReport2ReportsPanel'),/applyManagerEvalReport2ReportPicker\(this\)/);
 assert.match(get('renderManagerEvalReport2ReportsPanel'),/Select All/);
});


test('authorized compact Eval browse data filters reports/users/drills synchronously with row counts',()=>{
 const metadata={browseColumns:['unique_id','itemcode','commonname','contsize','locationcode','lotcode','season','blockalpha','assignedto','ptronhand','ptravailable','s_lts','reportIds'],browseRows:[['one','000101.010.1','Gold Mop','#1','C.16.000','26.F1','F1','C','allen_ward',62,60,1500,['low-stock']],['two','x','Plant','#3','C.17.000','26.F1','F1','C','abigail_vazquez',16,16,16,['low-stock']],['three','y','Plant','#3','H.06.000','26.U2','U2','H','bobby_hooper',58,58,58,['u2']]],evaluatorDirectory:['allen_ward','abigail_vazquez','bobby_hooper']};
 const query={surface:'eval2',operation:'groups',filters:{reportIds:['low-stock'],groupBy:'blockalpha'}};
 const page=engine.buildBrowsePage(metadata,query,'rev1');assert.equal(page.rows[0].value,'C');assert.equal(page.rows[0].rowCount,2);
 const options=engine.browseUserOptions(metadata,query.filters);assert.equal(options[0].label,'All Users (2)');assert.ok(options.some(o=>o.label==='allen_ward (1)'));assert.ok(options.some(o=>o.value==='bobby_hooper'));
 query.filters={...query.filters,groupBy:'locationcode',blockalpha:'C',assignedUsers:['allen_ward']};assert.equal(engine.buildBrowsePage(metadata,query,'rev1').rows[0].value,'C.16.000');
 query.filters={...query.filters,reportIds:[]};assert.equal(engine.buildBrowsePage(metadata,query,'rev1').total,0);
});


function evalReclassFixture() {
  const runtime = readComposedRuntimeSource();
  const extract = name => runtime.match(new RegExp('^        (?:async )?function '+name+'\\([^]*?^        }','m'))?.[0];
  const rows = [['c16f','C.16.000','27.F1',61,61],['f19f','F.19.000','27.F1',180,104],['c16s','C.16.000','27.S1',504,504],['h06s','H.06.000','27.S1',7,7],['c19u','C.19.000','27.U1',105,105]].map(([UNIQUE_ID,LOCATIONCODE,LOTCODE,PTRONHAND,PTRAVAILABLE])=>({UNIQUE_ID,ITEMCODE:'001973.010.1',COMMONNAME:'Northwind Switch Grass',LOCATIONCODE,LOTCODE,PTRONHAND,PTRAVAILABLE,PTRREVIEWED:UNIQUE_ID==='f19f'?76:'',PRIORITY:UNIQUE_ID==='f19f'?'1':''}));
  const group={key:'item:001973.010.1',itemCode:'001973.010.1',rows,representativeRow:rows[0],reportIds:['low-stock']};
  const inquiry={innerHTML:''}, sourceHeader={innerHTML:''};
  const modal={classList:{remove(){}},querySelectorAll:()=>[]};
  const ctx={Map,Set,AbortController,window:{},activeItem:null,
    firstNonEmptyValue:(...v)=>v.find(x=>x!==null&&x!==undefined&&x!==''),escapeHtml:v=>String(v??''),formatArgosInventoryNumber:v=>String(v??0),
    masterInventoryByItemCode:new Map([[group.itemCode,[rows[0]]]]),fullInventory:[],rebuildMasterInventoryIndexes(){},
    isRequestLikeItem:()=>false,isDockLikeItem:()=>false,isSalesOfficeLikeItem:()=>false,
    getCurrentSeasonSortRank:v=>['F1','S1','U1','U2','U3'].indexOf(v),
    getManagerEvalReport2VisibleItemGroups:()=>[group],getManagerEvalReport2AllCurrentItemRows:()=>rows,
    useManagerReportPages:()=>true,getManagerReportPageController:()=>({state:()=>({metadata:{}})}),getManagerEvalReports2Api:()=>engine,
    loadPagedManagerItem:async()=>rows,isEvalWorkManagerUser:()=>true,managerModuleReadGeneration:1,
    getSupabaseReadIdentityScope:()=>'account-a',getCurrentVisibleViewId:()=>'managers',activeHomeTab:'eval2',MANAGER_EVAL_REPORTS_2_VIEW:'eval2',
    managerEvalReport2SelectedLocationCode:'C.19.000',managerEvalReport2BrowseMode:'location',activeManagerEvalReport2:'low-stock',getManagerEvalReport2ReportLabel:()=>'LowStock',
    showToast:(...args)=>{throw Error(args.join(' '));},findItemByUniqueId:id=>rows.find(r=>r.UNIQUE_ID===id),
    getVerifiedCachedArgosItemInquiryGroup:()=>null,getReadableCachedArgosItemInquiryGroup:()=>null,
    isArgosInventoryTransactionEligible:()=>true,activeDetailSourceView:'',lastView:'managers',
    argosInquiryOpenRevision:0,argosInventoryTransactionState:null,ensureArgosInventoryTransactionModal:()=>modal,
    document:{getElementById:id=>id==='argos-reclass-item-inquiry'?inquiry:id==='argos-inventory-transaction-source'?sourceHeader:null},
    buildItemInquiryViewModel:(item,scope)=>({identity:{itemcode:item.ITEMCODE},rows:scope,locationRows:scope.map(row=>({unique_id:row.UNIQUE_ID,sourceRow:row,values:{locationcode:row.LOCATIONCODE,lotcode:row.LOTCODE,ptronhand:row.PTRONHAND,ptrreviewed:row.PTRREVIEWED,ptravailable:row.PTRAVAILABLE,priority:row.PRIORITY}}))}),
    resetArgosReclassMultiActionState(){},getArgosReclassLiveEditIdentityKey:()=>'account-a',generateArgosInventoryTransactionId:()=>'cmd',readPendingArgosInventoryReclassMove:()=>null,
    refreshArgosInventoryTransactionLotOptions(){},refreshArgosInventoryTransactionPriorityOptions(){},setArgosInventoryTransactionAction(){},setArgosInventoryTransactionHoldAction(){},captureArgosInventoryTransactionDraftBaseline:()=>[],canUseProductionLiveSync:()=>false,
    isArgosReclassMobileEditorViewport:()=>true,argosReclassRowEditorEntries:new Map(),getArgosReclassRowBodyId:id=>'body-'+id,
    getArgosReclassV3ScopeActionsForEntry:()=>[],getArgosReclassV3ActionCountForEntry:()=>0,getEvalWorkInquiryRowResolution:()=>'',getArgosReclassProposalRenderSignature:()=>'',getArgosReclassRowRenderSignature:()=>'',
  };
  vm.createContext(ctx);
  for(const name of ['getItemInquiryItemCode','getItemInquiryRowValue','getItemInquiryRowKey','getItemInquiryLotSortParts','compareItemInquiryRows','getItemInquiryRows','getArgosInventorySourceSnapshot','renderArgosInventoryTransactionSource','renderArgosReclassInquiryEditor','openArgosInventoryTransactionModal','openManagerEvalReport2DirectInquiry'])vm.runInContext(extract(name),ctx);
  return {ctx,rows,group,inquiry,sourceHeader};
}

test('Eval2 Northwind inquiry renders all five sibling rows immediately and uses the drilled location as origin',async()=>{
  const f=evalReclassFixture();
  f.ctx.loadPagedManagerItem=()=>{throw Error('Opening must use displayed rows before any network read');};
  await f.ctx.openManagerEvalReport2DirectInquiry(encodeURIComponent(f.group.key));
  assert.equal((f.inquiry.innerHTML.match(/data-reclass-row-card=/g)||[]).length,5);
  assert.deepEqual(Array.from(f.ctx.argosInventoryTransactionState.inquiryModel.rows,r=>r.UNIQUE_ID),['c16f','c16s','c19u','f19f','h06s']);
  assert.equal(f.ctx.argosInventoryTransactionState.snapshot.uniqueId,'c19u');
  assert.match(f.inquiry.innerHTML,/argos-reclass-row-card--origin[^]*?data-reclass-row-card="c19u"/);
  assert.match(f.inquiry.innerHTML,/REV 0/); assert.match(f.inquiry.innerHTML,/REV 76/); assert.match(f.inquiry.innerHTML,/PRI 1/);
  assert.match(f.sourceHeader.innerHTML,/Originating row/); assert.match(f.sourceHeader.innerHTML,/>105</);
});

test('Eval2 tapped location and lot wins over the drill while all sibling accordions remain available',async()=>{
  const f=evalReclassFixture();
  await f.ctx.openManagerEvalReport2DirectInquiry(encodeURIComponent(f.group.key),encodeURIComponent('f19f'));
  assert.equal(f.ctx.argosInventoryTransactionState.snapshot.uniqueId,'f19f');
  assert.equal(f.ctx.argosReclassRowEditorEntries.size,5);
  assert.equal((f.inquiry.innerHTML.match(/toggleArgosReclassRowCard/g)||[]).length,5);
  assert.match(f.sourceHeader.innerHTML,/>180</); assert.match(f.sourceHeader.innerHTML,/>104</);
});

test('shared inquiry merges item siblings by normalized location/lot and preserves all three Slash Pine lots',()=>{
  const f=evalReclassFixture();
  const rows=['27.U3','27.F1','27.S1'].map((LOTCODE,i)=>({UNIQUE_ID:'pine-'+i,ITEMCODE:'000760.050.1',LOCATIONCODE:'C.19.000',LOTCODE}));
  f.ctx.masterInventoryByItemCode=new Map([['000760.050.1',[rows[0]]]]);
  const duplicate={...rows[0],UNIQUE_ID:'display-alias',LOCATIONCODE:' c.19.000 ',LOTCODE:'27.u3'};
  const scoped=f.ctx.getItemInquiryRows(rows[1],[...rows,duplicate,...f.rows]);
  assert.deepEqual(Array.from(scoped,r=>r.LOTCODE),['27.F1','27.S1','27.U3']);
});

test('Eval2 table rows own exact-origin click and keyboard handlers and high-contrast quantity styling',()=>{
  const runtime=readComposedRuntimeSource();
  const card=runtime.match(/        function renderManagerEvalReport2SelectableCard\([^]*?^        }/m)[0];
  assert.equal(card.includes('data-eval2-origin-uid'),true);
  assert.equal(card.includes('event.stopPropagation(); return openManagerEvalReport2DirectInquiry'),true);
  assert.equal(card.includes('manager-eval2-quantity'),true);
  const css=readFileSync(new URL('../assets/ops-precision-pilot.css',import.meta.url),'utf8');
  assert.equal(css.includes('body.ops-precision-pilot[data-ops-theme="dark"] #managers-content .manager-eval2-inventory-row .manager-eval2-quantity'),true);
  assert.match(css,/\.manager-eval2-inventory-row \.manager-eval2-quantity[^}]*color:#38bdf8!important[^}]*font-weight:700/);
});


test('Item Inquiry report uses nine canonical columns, boxed edits and a single landscape PDF', () => {
 const gs=readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
 const fn=name=>{const a=gs.indexOf('function '+name+'(');const b=gs.indexOf('\nfunction ',a+9);assert.ok(a>=0);return gs.slice(a,b<0?gs.length:b);};
 const ctx=vm.createContext({sortReclassInquiryCompactRows_:r=>r,escapeEmailHtml_:v=>String(v),Utilities:{newBlob:(data,type,name)=>({data,type,name})}});
 vm.runInContext(['buildReclassInlineOhText_','buildReclassItemInquiryTable_','buildReclassItemInquiryHtml_','buildReclassItemInquiryPdf_'].map(fn).join('\n'),ctx);
 const model={identity:{commonname:'Flame Grass',itemcode:'004502.010.1',contsize:'#1',source:'LD'},rows:[{unique_id:'origin',values:{locationcode:'C.16.000',lotcode:'27.S1',priority:'1',ptronhand:'295',ptravailable:'295',s_lts:'585'},changedFields:['priority','s_lts'],actionValues:{moveupsplits:[{quantity:200,destinationSeason:'F1'}]}}]};
 assert.match(fn('buildReclassInquiryReportModel_'),/identity.source = getReclassInquiryExactValue_\(sourceRow, \['source', 'SOURCE'\]/);
 const table=ctx.buildReclassItemInquiryTable_(model);assert.deepEqual(Array.from(table.columns,c=>c[1]),['Lotcode','Location','SOURCE','Priority','OH','PTRREVIEWED','Loc Note Date','LOCATIONPTN1','Location Note']);
 const html=ctx.buildReclassItemInquiryHtml_(model);for(const text of ['GNC PH Reclass Item Inquiry','Common Name:','Item Code:','Size:','Source:','11in 8.5in landscape','#ffffff','#fef08a','295 - 200 --> F1','border:1.5px solid #000'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/UP 200 TO F1/);
 assert.doesNotMatch(html,/Action Details|>Action</);
 const pdf=ctx.buildReclassItemInquiryPdf_(model);assert.equal(pdf.name,'Flame Grass.pdf');assert.match(pdf.data,/\/MediaBox \[0 0 792 612\]/);assert.match(pdf.data,/\/Count 1/);assert.equal((pdf.data.match(/\/Type \/Page /g)||[]).length,1);
 assert.match(fn('getReclassInquiryEmailRecipients_'),/get_reclass_delivery_recipients_v1/);assert.match(fn('getReclassInquiryEmailRecipients_'),/recipients.length > 4/);
 const runtime=readComposedRuntimeSource();assert.match(runtime,/REQUIRED_RECIPIENT_USERS = Object.freeze\(\['dylan_collyge', 'megan_kelly', 'sharon_combs'\]\)/);
});
