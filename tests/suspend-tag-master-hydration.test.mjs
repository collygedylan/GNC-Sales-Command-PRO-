import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
// @test-group: suspend

const html = readComposedAppSource().replace(/\r\n/g, '\n');
function source(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = html.indexOf('\n        }', start);
  assert.ok(end > start, `${name} ends`);
  return html.slice(start, end + '\n        }'.length);
}

test('blank SOC photo match hydrates from Drive master while populated row-owned photo evidence is preserved', () => {
  const context = vm.createContext({
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') ?? '',
    parseAppNumber: value => value === '' || value == null ? null : Number(value),
    normalizeRowPhotoFields() {}, buildSearchIndex() {},
    syncMasterFieldsToRow(master, row, keys) {
      for (const key of keys) {
        const lower = key.toLowerCase();
        if (Object.hasOwn(master, key) && master[key] !== undefined) row[key] = master[key];
        else if (Object.hasOwn(master, lower) && master[lower] !== undefined) row[key] = master[lower];
      }
      row.MASTER_ID = master.UNIQUE_ID;
    }
  });
  vm.runInContext(`
    const LINKED_ROW_SYNC_KEYS = ['PTRONHAND','PTRREVIEWED','PTRAVAILABLE','MATCH','MATCHPCT','MATCH_PCT','LOC_MATCH_QTY','PRIORITY','HOLDSTOPREASON','SALES_NOTE'];
    const REQUEST_ROW_OWNED_SYNC_KEYS = ['MATCH','MATCHPCT','MATCH_PCT','LOC_MATCH_QTY','SALES_NOTE'];
    ${source('captureRequestOwnedSyncValues')}
    ${source('syncMasterFieldsToRequestRow')}
  `, context);

  const master = { UNIQUE_ID:'master-1', PTRONHAND:90, PTRREVIEWED:25, PTRAVAILABLE:65,
    MATCH:80, LOC_MATCH_QTY:null, PRIORITY:10, HOLDSTOPREASON:'light roots; thin body', SALES_NOTE:'master note' };
  const blankSource = { UNIQUE_ID:'soc-1', LOC_MATCH_QTY:'', SALES_NOTE:'' };
  context.syncMasterFieldsToRequestRow(master, blankSource);
  assert.equal(blankSource.LOC_MATCH_QTY, null);
  assert.equal(blankSource.PRIORITY, 10);
  assert.equal(blankSource.HOLDSTOPREASON, 'light roots; thin body');
  assert.equal(blankSource.PTRONHAND, 90);
  assert.equal(blankSource.PTRREVIEWED, 25);
  assert.equal(blankSource.PTRAVAILABLE, 65);
  assert.equal(blankSource.MATCH, 80, 'the master match percentage hydrates alongside its computed quantity');

  const sourceEvidence = { UNIQUE_ID:'soc-2', MATCH:'22', LOC_MATCH_QTY:'18', SALES_NOTE:'SOC note' };
  context.syncMasterFieldsToRequestRow(master, sourceEvidence);
  assert.equal(sourceEvidence.LOC_MATCH_QTY, null, 'a current master null does not fall back to a stale SOC photo quantity');
  assert.equal(sourceEvidence.MATCH, 80, 'a stale SOC percentage cannot hide the authoritative master percentage fallback');
  assert.equal(sourceEvidence.SALES_NOTE, 'SOC note');

  const masterWithoutPhotoMetric = { ...master };
  delete masterWithoutPhotoMetric.LOC_MATCH_QTY;
  const sourceOnlyMetric = { UNIQUE_ID:'soc-3', LOC_MATCH_QTY:'18' };
  context.syncMasterFieldsToRequestRow(masterWithoutPhotoMetric, sourceOnlyMetric);
  assert.equal(sourceOnlyMetric.LOC_MATCH_QTY, '18', 'source evidence survives when master has no photo metric field');

  const lowercaseMaster = { UNIQUE_ID:'master-lower', ptronhand:90, ptrreviewed:25, ptravailable:65,
    loc_match_qty:59, priority:10, holdstopreason:'light roots; thin body' };
  const lowercaseRow = { UNIQUE_ID:'soc-lower', LOC_MATCH_QTY:'42' };
  context.syncMasterFieldsToRequestRow(lowercaseMaster, lowercaseRow);
  assert.equal(lowercaseRow.LOC_MATCH_QTY, 59);
  assert.equal(lowercaseRow.PRIORITY, 10);
  assert.equal(lowercaseRow.HOLDSTOPREASON, 'light roots; thin body');
});

test('verified native queue master refresh replaces stale priority, hold reason, and photo metrics on the card summary', () => {
  const context = vm.createContext({});
  vm.runInContext(source('syncDockSuspendCardMasterSummaryFields'), context);
  const card = { PRIORITY:'-', HOLDSTOPREASON:'old reason', MATCH:'22', LOC_MATCH_QTY:'18' };
  context.syncDockSuspendCardMasterSummaryFields(card, {
    priority:10, holdstopreason:'current master reason', match:'80', loc_match_qty:null
  });
  assert.equal(card.PRIORITY, 10);
  assert.equal(card.priority, 10);
  assert.equal(card.HOLDSTOPREASON, 'current master reason');
  assert.equal(card.holdstopreason, 'current master reason');
  assert.equal(card.MATCH, '80');
  assert.equal(card.match, '80');
  assert.equal(card.LOC_MATCH_QTY, null, 'the master null cannot be replaced by stale SOC photo quantity');
  assert.equal(card.loc_match_qty, null);
});

test('queue master metrics use Drive photo ownership while unavailable inventory remains unknown', () => {
  let state = { status: 'ready', row: { PHOTO_LINK: 'master-owned-photo', MATCH: '65', PTRAVAILABLE: '65' } };
  const lookups = [];
  const context = vm.createContext({
    getQueueCardInventoryState(item, view) { lookups.push(view); return state; },
    buildInventoryQuantityChipsHtml(row, options) { return { row, options }; }
  });
  vm.runInContext(source('buildQueueInventoryMetricsHtml'), context);
  const result = context.buildQueueInventoryMetricsHtml({}, 'request', { compact: true });
  assert.equal(result.options.sourceView, 'drive');
  assert.equal(result.row, state.row);
  assert.equal(result.options.canonical, true);
  assert.deepEqual(lookups, ['request'], 'authorization lookup keeps the actual queue context');
  state = { status: 'unavailable', row: null };
  const unavailable = context.buildQueueInventoryMetricsHtml({}, 'request');
  assert.equal(unavailable.options.hydrationStatus, 'unavailable');
  assert.equal(unavailable.options.sourceView, 'request');
});

test('Suspend card photo metrics use the captured master photo-evidence timestamp, never inventory freshness', () => {
  const snapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/suspend-v2314.json.gz', import.meta.url))).toString('utf8'));
  assert.equal(snapshot.masterRows.length, 9487);
  const littleLime = snapshot.masterRows.find(row => row.ITEMCODE === '009373.031.1'
    && row.LOCATIONCODE === 'F.14.000' && row.LOTCODE === '27.F1');
  const liriope = snapshot.masterRows.find(row => row.ITEMCODE === '004380.010.1'
    && row.LOCATIONCODE === 'C.09.000' && row.LOTCODE === '27.F1');
  assert.ok(littleLime?.PHOTO_LINK);
  assert.equal(littleLime.AV_RULE_PHOTO_UPDATED_AT, '2026-10-16T16:03:29.828Z');
  assert.equal(littleLime.LAST_UPDATED, '2026-10-20T02:24:45.602Z');
  assert.ok(liriope?.PHOTO_LINK);
  assert.equal(liriope.AV_RULE_PHOTO_UPDATED_AT, null, 'the authoritative master has no photo-rule timestamp for this row');

  const frozenNow = Date.parse('2026-10-20T13:51:37.298Z');
  const context = vm.createContext({
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    parseAppNumber: value => value == null || String(value).trim() === '' ? null : Number(String(value).replace(/,/g, '')),
    parseLocMatchPercent: value => value == null || String(value).trim() === '' ? null : Number(String(value).replace('%', '').trim()),
    findLinkedMasterRow: () => null,
    shouldPreferFlyerOwnedFields: () => false,
    shouldHideSharedAppPayloadForInvalidAvRules: () => false,
    Date: class extends Date { static now() { return frozenNow; } }
  });
  vm.runInContext([
    'parseLocPhotoEvidenceTimestamp', 'getLocPhotoCaptureEvidence', 'getLocPhotoEvidenceContext',
    'getLocPhotoOwnedValue', 'getLocPhotoEvidenceState', 'calculateLocMatchQtyValue',
    'getEditorLocMatchQtyValue', 'getPhotoQualifiedLocMatchQtyValue',
    'getDisplayLocMatchQtyValue', 'formatLocPhotoMatchQtyValue'
  ].map(name => source(name)).join('\n'), context);

  assert.equal(context.formatLocPhotoMatchQtyValue(littleLime, 'drive'), '42',
    '65% of the verified 65 available is rounded from a fresh AV_RULE_PHOTO_UPDATED_AT');
  assert.equal(context.formatLocPhotoMatchQtyValue(liriope, 'drive'), 'Not verified',
    'a photo URL plus inventory LAST_UPDATED does not replace missing authoritative photo freshness');
});
