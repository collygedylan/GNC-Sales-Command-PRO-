import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readComposedAppSource();
const api = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/archive_migrations/20260901131941_dock_trip_status_global_v1.sql', import.meta.url), 'utf8');
const source = name => html.match(new RegExp('        function ' + name + '\\([^]*?^        }', 'm'))?.[0] || assert.fail(name);

test('shared Dock teams are stored by TRIPNUMBER with protected tables and an append-only audit', () => {
  assert.match(migration, /create table if not exists public\.ph_dock_trip_status\s*\([\s\S]*tripnumber text primary key/i);
  assert.match(migration, /create table if not exists public\.ph_dock_trip_status_audit/i);
  assert.match(migration, /alter table public\.ph_dock_trip_status enable row level security/i);
  assert.match(migration, /revoke all on table public\.ph_dock_trip_status from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.ph_dock_trip_status to service_role/i);
});

test('Dock trip saves are transactional, revision checked, serialized, and audited', () => {
  assert.match(migration, /create or replace function public\.save_dock_trip_status_v1/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('dock-trip-status:' \|\| upper\(trip_value\), 0\)\)/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /dock_trip_revision_conflict/i);
  assert.match(migration, /insert into public\.ph_dock_trip_status_audit/i);
  assert.match(migration, /revoke all on function public\.save_dock_trip_status_v1[\s\S]*from public, anon, authenticated/i);
});

test('the protected API allows all Docks roles to read but only Admin or QC Supervisor to edit', () => {
  assert.match(api, /async function handleDockTripStatusAction/);
  assert.match(api, /normalizedRole\.includes\("ADMIN"\)[\s\S]*normalizedRole\.includes\("MANAGER"\)[\s\S]*normalizedRole\.includes\("SALESREP"\)[\s\S]*normalizedRole\.startsWith\("QC"\)[\s\S]*normalizedRole\.includes\("EVAL"\)/);
  assert.match(api, /const canEdit = FULL_ACCESS_USER_KEYS\.has\(actor\)[\s\S]*QCSUPERVISOR/);
  assert.match(api, /supabase\.rpc\("save_dock_trip_status_v1"/);
  assert.match(api, /if \(action === "dock_trip_status"\) return await handleDockTripStatusAction/);
  assert.match(api, /table === "ph_dock_team_status"[\s\S]*return false/);
});

test('the browser never reports a local-only Dock team save', () => {
  assert.doesNotMatch(html, /Dock team saved on this device/);
  assert.doesNotMatch(html, /gnc_dock_team_/);
  assert.match(html, /Reconnect before saving\. Dock teams are shared and are never stored only on this device/);
  assert.match(html, /Saved for Everyone/);
  assert.match(html, /queueAppLiveEventForWrite\('ph_dock_trip_status'/);
});

test('Dock trip saves normalize the RPC composite response and rerender the canonical assignment immediately', () => {
  assert.match(api, /const savedStatus = Array\.isArray\(data\) \? data\[0\] : data/);
  assert.match(api, /jsonResponse\(\{ ok: true, data: savedStatus \}\)/);
  assert.match(html, /function getDockTripStatusResponseRow[\s\S]*Array\.isArray\(data\) \? data\[0\] : data/);
  assert.match(html, /const canonicalRow = getDockTripStatusResponseRow\(result\.data\)/);
  assert.match(html, /markViewDirty\('docks'\)[\s\S]*scheduleDocksRender\(0, 0, true\)/);
  assert.match(html, /renderSignature: buildRowsRenderSignature\('docks-main\|Select a Dock', dockCards, \['dockTeamRenderVersion'\]\)/);

  const helperStart = html.indexOf('function getDockTripStatusResponseRow');
  const helperEnd = html.indexOf('async function ensureDockTeamSchemaReady', helperStart);
  assert.ok(helperStart > 0 && helperEnd > helperStart, 'Dock response normalizer should be present');
  const context = vm.createContext({ Array, Object });
  vm.runInContext(`${html.slice(helperStart, helperEnd)};this.normalizeDockResult=getDockTripStatusResponseRow;`, context);
  assert.equal(context.normalizeDockResult([{ tripnumber: 'T1', checker: 'one' }]).checker, 'one');
  assert.equal(context.normalizeDockResult({ tripnumber: 'T2', checker: 'two' }).checker, 'two');
  assert.equal(context.normalizeDockResult([]), null);
});

test('Dock rows require PLANSTARTDATE on or after 01\/01\/2026 and display MM\/DD\/YYYY', () => {
  const start = html.indexOf('const DOCK_CARD_PLANSTART_ALIASES');
  const end = html.indexOf('function renderDocks()', start);
  assert.ok(start > 0 && end > start, 'Dock PLANSTART helper block should be present');
  const context = vm.createContext({
    Date,
    Math,
    String,
    Number,
    Object,
    firstNonEmptyValue: (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? ''
  });
  vm.runInContext(`${html.slice(start, end)};this.api={isDockRowWithinPlanStartWindow,formatDockCardPlanStartValue};`, context);
  assert.equal(context.api.isDockRowWithinPlanStartWindow({ PLANSTARTDATE: '12/31/2025' }), false);
  assert.equal(context.api.isDockRowWithinPlanStartWindow({ PLANSTARTDATE: '01/01/2026' }), true);
  assert.equal(context.api.isDockRowWithinPlanStartWindow({ PLANSTARTDATE: '2027-02-03T00:00:00Z' }), true);
  assert.equal(context.api.isDockRowWithinPlanStartWindow({ PLANSTARTDATE: '' }), false);
  assert.equal(context.api.formatDockCardPlanStartValue('2026-9-1'), '09/01/2026');
});

test('Dock cards render a separate shared team block for every TRIPNUMBER', () => {
  assert.match(html, /tripCounts: new Map\(\)/);
  assert.match(html, /entry\.tripCounts\.set\(tripNumber/);
  assert.match(html, /savedInfo: getDockTeamInfo\(tripNumber\)/);
  assert.match(html, /Edit Trip Team & Status/);
  assert.match(html, /openDockInfoModal', \[dockCard\.dockNum, trip\.tripNumber\]/);
  assert.match(html, /getDockTeamInfo\(item\.TRIPNUMBER\)/);
});

test('Docks retains valid imported docks without a PLANSTART gate while work actions remain assignment checked', () => {
  const start = html.indexOf('function getScopedDocksItems(');
  const end = html.indexOf('function applyRolePermissions()', start);
  const block = html.slice(start, end);
  assert.doesNotMatch(block, /filter\(isDockRowWithinPlanStartWindow\)/);
  const ctx = vm.createContext({
    socInventory: [],
    getRoleAccessState: () => ({ isAdmin:true }),
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim()) || '',
  });
  for (const name of ['getActiveSuspendDockRows','normalizeDockViewDockKey','getScopedDocksItems']) vm.runInContext(source(name), ctx);
  const rows = [{ DOCK:'38.0', PLANSTART:'' }, { DOCK:'27', PLANSTART:'2020-01-01' }, { DOCK:'0' }, { DOCK:'none' }];
  assert.deepEqual(Array.from(ctx.getScopedDocksItems(rows), row => row.DOCK), ['38.0','27']);
  assert.match(block, /if \(isRep\)/);
  assert.doesNotMatch(block, /else if \(isQc/);
  assert.match(html, /function canCurrentUserMarkDockStage[\s\S]*isDockRowQueuedForCurrentUser/);
});

test('Docks display lookup falls back through normalized lot, location and item without changing strict identities', () => {
  const f = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../assets/queue-inventory-hydration.js', import.meta.url), 'utf8'), f);
  const rows = [
    { UNIQUE_ID:'z', ITEMCODE:'004380.010.1', LOCATIONCODE:'C.09.000', LOTCODE:'27.F1', SOURCE:'1', PTRONHAND:40 },
    { UNIQUE_ID:'a', ITEMCODE:'43800101', LOCATIONCODE:'c.9.0', LOTCODE:'27.S1', SOURCE:'2', PTRONHAND:60 },
    { UNIQUE_ID:'b', ITEMCODE:'OTHER', LOCATIONCODE:'C.09.000', LOTCODE:'27.F1', PTRONHAND:999 },
  ];
  const q = f.AgMetricQueueInventory, index = q.createIndex(rows);
  const exact = { itemCode:'43800101', locationCode:' c.9.0 ', lotCode:'27.F1', source:'SOC' };
  assert.equal(index.resolveDisplay(exact).row, rows[0]);
  assert.equal(index.resolveDisplay({ ...exact, lotCode:'old-lot' }).row, rows[1]);
  assert.equal(index.resolveDisplay({ ...exact, locationCode:'UNKNOWN', lotCode:'' }).row, rows[1]);
  assert.equal(index.resolveDisplay({ itemCode:'MISSING' }).row, null);
  assert.equal(index.resolve({ ...exact, lotCode:'old-lot' }).row, null, 'ambiguous exact-row hydration remains strict');
  assert.equal(q.matches(rows[1], exact), false, 'display fallback cannot authorize a row mutation');
  assert.equal(q.createIndex([...rows].reverse()).resolveDisplay({ ...exact, lotCode:'old-lot' }).row, rows[1], 'fallback selection is independent of import order');
});

test('Docks stop cards contain exactly one title, six-metric strip and action row each with numeric all-lot location stock', t => {
  const rows = [
    { UNIQUE_ID:'master-a', ITEMCODE:'004380.010.1', LOCATIONCODE:'C.09.000', LOTCODE:'27.F1', PTRONHAND:40, PTRREVIEWED:2, PTRAVAILABLE:38, S_LTS:30, LOC_MATCH_QTY:7 },
    { UNIQUE_ID:'master-b', ITEMCODE:'43800101', LOCATIONCODE:'c.9.0', LOTCODE:'27.S1', PTRONHAND:60, PTRREVIEWED:5, PTRAVAILABLE:55, S_LTS:50, LOC_MATCH_QTY:7 },
  ];
  const dom = new JSDOM('<main id="cards"></main>');
  t.after(() => dom.window.close());
  const f = vm.createContext({
    window: {}, Map, Set, fullInventory:rows, nativeAuthSessionActive:false, nativeAuthProfile:null, acceptedLocOnHandAggregateReceipt:null,
    getDatasetState: () => ({ initialLoaded:true, rowCompleteness:'complete' }),
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    getCardPtrOnHandValue: row => row.PTRONHAND, getCardPtrReviewedValue: row => row.PTRREVIEWED,
    getCardPtrAvailableValue: row => row.PTRAVAILABLE, getCardOpenStockValue: row => row.S_LTS,
    getCardLocationOnHandServerAggregate: () => ({ verified:false }), formatLocPhotoMatchQtyValue: () => '7',
    parseAppNumber: value => value == null || String(value).trim() === '' ? null : Number(String(value).replaceAll(',', '')),
    normalizeCardQuantityValue: value => String(value),
    preserveCardLocationOnHand: (row,value) => value == null ? null : String(value),
    getDockOrderedQtyRaw: () => 3, getDockOrderedQtyDisplay: () => '3', getDockDisplayQty: () => 3, formatDockDisplayQty: String,
    getDockSuspendDcRequestPlanstartInfo: () => ({ valid:false }),
    getDockItemProgress: () => ({ checker:false, inspector:false }), getRoleAccessState: () => ({ isRep:false }),
    buildDocksCreditAction: () => '', buildCardActivationAttrs: () => '',
    getDockStopOrDropValue: () => '10', formatDockCardPlanStartValue: String, getDockSuspendDcRequestPlanstartValue: () => '01/01/2026',
    buildInventoryCardFieldChipsHtml: () => '',
  });
  vm.runInContext(readFileSync(new URL('../assets/queue-inventory-hydration.js', import.meta.url), 'utf8'), f);
  f.esc = f.escapeHtml;
  const index = f.window.AgMetricQueueInventory.createIndex(rows);
  f.getOperationalCardInventoryRow = item => index.resolveDisplay(item).row;
  f.getQueueCardInventoryState = item => index.resolveDisplay(item);
  for (const name of ['getInventoryCardItemLocationKey', 'addInventoryCardLocationOnHand', 'getCardLocationOnHandValue',
    'buildInventoryQuantityChipsHtml', 'buildQueueInventoryMetricsHtml', 'buildSharedInventoryCardLayout']) vm.runInContext(source(name), f);
  f.masterInventoryByItemLocationOnHand = new Map();
  rows.forEach(row => f.addInventoryCardLocationOnHand(f.masterInventoryByItemLocationOnHand, row));
  const start = html.indexOf("if(sourceView === 'docks'){");
  const end = html.indexOf("if(sourceView==='sales-office-order'){", start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(`function renderDock(item) { const sourceView='docks', safeUidJs=item.UNIQUE_ID, safeDockIssueSourceUidJs=item.UNIQUE_ID, isChecked='', safeCardSourceViewKey='docks', inlineThumbHtml='', inventoryEditActionHtml=''; ${html.slice(start, end)} }`, f);
  const cards = rows.map((row, i) => ({ ...row, UNIQUE_ID:`order-${i}`, DOM_ID:`soc_${i}`, COMMONNAME:`Plant ${i}`, CONTSIZE:'#5', DOCK_NUM:'28' }));
  const host = dom.window.document.getElementById('cards');
  host.innerHTML = cards.map(item => f.renderDock(item)).join('');
  assert.equal(host.children.length, 2, 'no detached top-level strips');
  for (const card of host.children) {
    assert.ok(card.hasAttribute('data-docks-stop-card'));
    assert.equal(card.querySelectorAll('.app-drive-card-title').length, 1);
    assert.equal(card.querySelectorAll('.app-drive-card-quantity-band').length, 1);
    assert.equal(card.querySelectorAll('[data-inventory-card-metric]').length, 6);
    assert.equal(card.querySelectorAll('button').length, 3, 'one Verified/Inspect/Flag Issue set');
    assert.equal(card.querySelector('[data-inventory-card-metric="loc-on-hand"] .app-card-qty-value').textContent, '100');
    assert.equal(card.querySelector('[data-inventory-card-metric="loc-photo-match"] .app-card-qty-value').textContent, '7');
  }
});

test('Docks renders published orders while assignment refresh is pending and invalidates metrics on a new master revision', () => {
  const render = source('renderDocks');
  assert.doesNotMatch(render, /Loading dock workflow|Loading Assignments/);
  assert.match(render, /ensureDockTeamStatusLoaded\(\)/);
  assert.match(render, /verifyRowSelector: '\[data-docks-stop-card\]'/);
  const f = vm.createContext({ queueCardInventoryRenderVersion:0, getDatasetState: () => f.master,
    buildRowsRenderSignature: () => 'same-SOC' });
  vm.runInContext(source('buildDocksStopItemsRenderSignature'), f);
  f.master = { liveVerifiedScope:'actor', liveVerifiedPermission:'p', liveVerifiedRevision:'1' };
  const before = f.buildDocksStopItemsRenderSignature('28', '10', []);
  f.master.liveVerifiedRevision = '2';
  assert.notEqual(f.buildDocksStopItemsRenderSignature('28', '10', []), before);
});

// Import identity is separate from Dock rendering. This file is in the user's
// explicitly authorized fast Node set; these are source contracts and a pure
// full-family proof model, not claims of executed migration/trigger coverage.
const prioritySplitMigration = readFileSync(new URL('../supabase/migrations/20261021021000_master_priority_split_identity_v1.sql', import.meta.url), 'utf8');

test('priority split migration preserves exact mapping, ordinary ambiguity rejection, private INSERT proof and baseline publication', () => {
  assert.match(prioritySplitMigration, /returns boolean language sql stable security definer set search_path=''/);
  assert.match(prioritySplitMigration, /revoke all on function private\.is_master_priority_split_v1\(uuid,text\) from public,anon,authenticated,service_role/);
  assert.equal((prioritySplitMigration.match(/where not private\.is_master_priority_split_v1\(p_request_id,s\.unique_id\)/g) || []).length, 3, 'two guarded replacements plus replay contract anchor');
  assert.match(prioritySplitMigration, /m\.canonical_unique_id is null and private\.is_master_priority_split_v1/);
  assert.match(prioritySplitMigration, /group by f\.lineage_key,coalesce\(btrim\(f\.raw_values->>'priority'\),''\) having count\(\*\)>1/);
  assert.match(prioritySplitMigration, /not \(f\.raw_values \? 'priority'\)/);
  assert.match(prioritySplitMigration, /jsonb_typeof\(f\.raw_values->'priority'\) not in\('string','null'\)/);
  for (const contract of ['BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS', 'apply_inventory_reclass_import_overlay_v1',
    'ph_master_new_insert_statement_v1', 'insert into app_sync_private.ph_master_inventory_source_baselines(',
    'insert into app_sync_private.ph_master_inventory_item6_source_v7(', 'p.proacl is not distinct from acl_before',
    'p.proconfig is not distinct from config_before', 'p.prosecdef=security_before']) assert.ok(prioritySplitMigration.includes(contract), contract);
  assert.match(prioritySplitMigration, /pending_legacy_sync/);
  assert.match(prioritySplitMigration, /e\.pending and \(e\.stable_identity_key=s\.stable_identity_key/);
  assert.match(prioritySplitMigration, /movement\.status in\('pending','conflict'\)/);
  assert.doesNotMatch(prioritySplitMigration, /disable trigger|delete from public\.ph_master_inventory|update public\.ph_master_inventory|new\.unique_id\s*:=/i);
});

function prioritySplitModel({ source, live, candidate, baselines, claimed = false, retainedAlias = false, pending = false }) {
  const id = row => ['002740.030.1', '#3', 'C.12.009', '27.F1', 'HL', row.designation ?? '', '', '', row.priority ?? ''].join('-').replace(/[^a-zA-Z0-9-]/g, '_');
  const family = source.filter(row => row.stable === candidate.stable);
  const old = live.filter(row => row.stable === candidate.stable);
  if (candidate.warehouse !== '10' || old.some(row => row.uid === candidate.uid) || claimed || retainedAlias || pending) return false;
  if (!old.length || family.length !== old.length + 1 || family.filter(row => !live.some(current => current.uid === row.uid)).length !== 1) return false;
  if (family.some(row => !Object.hasOwn(row, 'priority') || (row.priority !== null && typeof row.priority !== 'string') || row.uid !== id(row))) return false;
  if (new Set(family.map(row => JSON.stringify([row.lineage, row.priority ?? '']))).size !== family.length) return false;
  const siblings = old.filter(row => baselines.get(row.uid)?.lineage === candidate.lineage);
  if (siblings.length !== 1 || baselines.get(siblings[0].uid).priority === candidate.priority) return false;
  return old.every(row => {
    const witness = family.find(entry => entry.uid === row.uid), baseline = baselines.get(row.uid);
    return witness && baseline && baseline.stable === candidate.stable && baseline.lineage === witness.lineage
      && baseline.priority === row.priority && witness.priority === baseline.priority;
  });
}

function prioritySplitFixture() {
  const physical = (designation, priority, quantity, status) => ({ stable:'physical', warehouse:'10', designation, priority,
    lineage:designation === '#' ? 'designated' : 'undesignated', quantity, status,
    uid:['002740.030.1', '#3', 'C.12.009', '27.F1', 'HL', designation ?? '', '', '', priority ?? ''].join('-').replace(/[^a-zA-Z0-9-]/g, '_') });
  const candidate = physical(null, null, 180, 'I');
  const retainedPriority = physical(null, '1', 256, 'A'), retainedDesignation = physical('#', null, 55, 'A');
  const live = [{ ...retainedPriority, quantity:76 }, { ...retainedDesignation }];
  return { candidate, source:[candidate, retainedPriority, retainedDesignation], live,
    baselines:new Map(live.map(row => [row.uid, { priority:row.priority, lineage:row.lineage, stable:row.stable }])) };
}

test('full stable-family priority split model retains both old rows and accepts the explicit-null third source row', () => {
  const f = prioritySplitFixture();
  assert.equal(f.source.length, 3);
  assert.equal(f.live.length, 2);
  assert.equal(prioritySplitModel(f), true);
  assert.equal(prioritySplitModel({ ...f, source:[...f.source].reverse(), live:[...f.live].reverse() }), true);
  assert.deepEqual(f.source.map(row => [row.designation, row.priority, row.quantity, row.status]), [[null, null, 180, 'I'], [null, '1', 256, 'A'], ['#', null, 55, 'A']]);
  for (const existing of f.live) assert.equal(prioritySplitModel({ ...f, candidate:existing }), false, 'existing IDs never enter new INSERT classification');
});

test('priority split model rejects incomplete witnesses, aliases, orphan shields, moves, duplicate keys and inconsistent baselines', () => {
  const cases = [
    ['missing designated witness', f => { f.source.pop(); }],
    ['missing priority witness', f => { f.source.splice(1, 1); }],
    ['renamed witness', f => { f.source[2] = { ...f.source[2], uid:'renamed' }; }],
    ['omitted priority', f => { delete f.candidate.priority; }],
    ['numeric priority', f => { f.candidate.priority = 0; }],
    ['duplicate source tuple', f => { f.source.push({ ...f.candidate, uid:`${f.candidate.uid}-1` }); }],
    ['additional new row', f => { f.source.push({ ...f.candidate, uid:'extra', priority:'2' }); }],
    ['live priority diverges', f => { f.live[0].priority = '7'; }],
    ['missing baseline', f => { f.baselines.delete(f.live[1].uid); }],
    ['changed designation baseline', f => { f.baselines.get(f.live[1].uid).lineage = 'other'; }],
    ['wrong stable baseline', f => { f.baselines.get(f.live[1].uid).stable = 'other'; }],
    ['orphan UID claim', f => { f.claimed = true; }],
    ['retained crosscanonical alias', f => { f.retainedAlias = true; }],
    ['pending priority/hold shield', f => { f.pending = true; }],
    ['orphan pending Item6 shield', f => { f.pending = true; }],
    ['pending/conflict movement', f => { f.pending = true; }],
    ['unknown site', f => { f.candidate.warehouse = '20'; }],
  ];
  for (const [label, change] of cases) {
    const f = prioritySplitFixture(); change(f);
    assert.equal(prioritySplitModel(f), false, label);
  }
});

test('Docks and Tasks preview their primary rows before optional joins finish', () => {
  const contextSource=source('getProductionLiveSyncContext');
  assert.ok(contextSource.includes("['home', 'drive', 'av', 'tasks', 'docks'].includes(view)"));
  assert.match(contextSource,/view === 'docks' \? 'core:soc' : 'core:master'/);
  const preview=source('previewProductionSnapshots');
  assert.match(preview,/context\.view === 'docks' \? 'core:soc' : 'core:master'/);
});

test('grouped Suspend choices count once; approval changes the pull and deny-all cancels it',()=>{
 const source=readFileSync(new URL('../assets/app-runtime.js',import.meta.url),'utf8');
 const ctx=vm.createContext({});
 vm.runInContext(source.match(/        function getActiveSuspendDockRows\([^]*?^        }/m)[0],ctx);
 const base={suspend_candidate_group:'dock35-drop80-item010248',quantityordered:'20'};
 const rows=[
  {...base,unique_id:'false-block',locationcode:'0.00.111',suspend_candidate_state:'replaced',quantityordered:'0'},
  {...base,unique_id:'choice1',locationcode:'B.08.000',lotcode:'26.F1',suspend_candidate_state:'candidate'},
  {...base,unique_id:'choice2',locationcode:'E.12.000',lotcode:'26.U2',suspend_candidate_state:'candidate'}
 ];
 assert.equal(ctx.getActiveSuspendDockRows(rows).length,1);
 rows[1].suspend_candidate_state='denied'; rows[1].quantityordered='0'; rows[2].suspend_candidate_state='approved';
 assert.deepEqual(Array.from(ctx.getActiveSuspendDockRows(rows),r=>[r.locationcode,r.lotcode,r.quantityordered]),[['E.12.000','26.U2','20']]);
 rows[2].suspend_candidate_state='canceled'; rows[2].quantityordered='0';
 assert.equal(ctx.getActiveSuspendDockRows(rows).length,0);
});
