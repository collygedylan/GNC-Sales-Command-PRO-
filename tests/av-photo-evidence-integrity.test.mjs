import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NOW = Date.parse('2026-09-07T18:00:00Z');
const DAY = 86_400_000;
const PHOTO = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/crop.webp';
function source(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.notEqual(start, -1, `${name} is present`);
  const end = html.indexOf('\n        }', start);
  assert.notEqual(end, -1, `${name} closes`);
  return html.slice(start, end + '\n        }'.length);
}
const coreNames = ['firstNonEmptyValue', 'parseAppNumber', 'normalizeLocMatchPercentText', 'parseLocMatchPercent',
  'calculateLocMatchQtyValue', 'getLocPhotoEvidenceContext', 'getLocPhotoOwnedValue',
  'parseLocPhotoEvidenceTimestamp', 'getLocPhotoCaptureEvidence', 'getLocPhotoEvidenceState',
  'getPhotoQualifiedLocMatchQtyValue', 'getDisplayLocMatchQtyValue', 'getCurrentCardLocPhotoMatchQtyValue',
  'formatLocPhotoMatchQtyValue'];
function runtime(extraNames = [], extra = {}) {
  class FixedDate extends Date { static now() { return NOW; } }
  const context = vm.createContext({ Date: FixedDate, URL,
    shouldPreferFlyerOwnedFields: (row, view) => view === 'flyer' || (view === 'tasks' && row?.selectedFlyer === true),
    ...extra });
  vm.runInContext([...coreNames, ...extraNames].map(source).join('\n'), context);
  return context;
}
const row = (changes = {}) => ({ SOURCE_TABLE: 'ph_master_inventory', MATCH: '50', INITIAL_PTR: '347',
  PTRAVAILABLE: '347', LOC_MATCH_QTY: '174', PHOTO_LINK: PHOTO,
  PHOTO_NAME: 'crop.webp', AV_RULE_PHOTO_UPDATED_AT: '2026-09-06T18:00:00Z', ...changes });

test('Acoma orphan observations remain raw but are not photo-qualified or falsely zero', () => {
  const ctx = runtime();
  const acoma = row({ PHOTO_LINK: null, PHOTO_NAME: null, AV_RULE_PHOTO_UPDATED_AT: null, DATE_COMPLETED: null });
  const before = JSON.stringify(acoma);
  assert.equal(ctx.calculateLocMatchQtyValue(acoma), 174);
  assert.equal(ctx.getLocPhotoEvidenceState(acoma).state, 'missing');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(acoma), null);
  assert.equal(ctx.getDisplayLocMatchQtyValue(acoma), '');
  assert.equal(ctx.getCurrentCardLocPhotoMatchQtyValue(acoma), '');
  assert.equal(ctx.formatLocPhotoMatchQtyValue(acoma), 'Not verified');
  assert.equal(JSON.stringify(acoma), before);
});

test('Anna current evidence preserves 695 without season, S_LTS or on-hand caps', () => {
  const ctx = runtime();
  const anna = row({ MATCH: '70', PTRAVAILABLE: 993, INITIAL_PTR: 993, LOC_MATCH_QTY: 1, SEASON: 'S1', YEAR: 2027, S_LTS: 0, PTRONHAND: 2 });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(anna, 'av'), 695);
  assert.equal(ctx.getCurrentCardLocPhotoMatchQtyValue(anna, 'av'), '695');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...anna, INITIAL_PTR: 1000 }), 693);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...anna, INITIAL_PTR: 900 }), 630);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...anna, INITIAL_PTR: '' }), 695);
});

test('ten-day boundary is inclusive, with missing, undated, future and stale distinct', () => {
  const ctx = runtime();
  const dated = (at) => row({ AV_RULE_PHOTO_UPDATED_AT: new Date(at).toISOString() });
  assert.equal(ctx.getLocPhotoEvidenceState(dated(NOW - 10 * DAY)).state, 'current');
  assert.equal(ctx.getLocPhotoEvidenceState(dated(NOW - 10 * DAY)).expiresAt, NOW + 1);
  for (const [candidate, state] of [[dated(NOW - 10 * DAY - 1), 'stale'], [dated(NOW + 1), 'future'],
    [row({ AV_RULE_PHOTO_UPDATED_AT: '' }), 'undated'], [row({ PHOTO_LINK: '' }), 'missing'], [row({ PHOTO_LINK: 'javascript:alert(1)' }), 'invalid']]) {
    assert.equal(ctx.getLocPhotoEvidenceState(candidate).state, state);
    assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(candidate), null);
  }
});

test('generic edits and later completion never revive older or invalid photo timestamps', () => {
  const ctx = runtime();
  const edits = { DATE_COMPLETED: '2026-09-07T17:00:00Z', UPDATED_AT: '2026-09-07T17:00:00Z',
    AV_RULE_BUNDLE_UPDATED_AT: '2026-09-07T17:00:00Z', AV_RULE_MATCH_UPDATED_AT: '2026-09-07T17:00:00Z',
    AV_RULE_SPEC_UPDATED_AT: '2026-09-07T17:00:00Z', AV_NOTE: 'Updated note', SPEC: 'Updated spec' };
  assert.equal(ctx.getLocPhotoEvidenceState(row({ ...edits, AV_RULE_PHOTO_UPDATED_AT: '2026-08-01T12:00:00Z' })).state, 'stale');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ ...edits, AV_RULE_PHOTO_UPDATED_AT: 'invalid' })).state, 'undated');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ ...edits, AV_RULE_PHOTO_UPDATED_AT: null })).state, 'current');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ ...edits, AV_RULE_PHOTO_UPDATED_AT: null, DATE_COMPLETED: null })).state, 'undated');
});

test('explicit capture dates are paired with their own URLs and never use detached names', () => {
  const ctx = runtime();
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_LINK: `${PHOTO},${PHOTO.replace('crop.webp', 'second.webp')}`, PHOTO_NAME: '8.1.26_crop.webp,9.6.26_crop.webp', AV_RULE_PHOTO_UPDATED_AT: '' })).state, 'current');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_NAME: '2026-09-06.jpg', AV_RULE_PHOTO_UPDATED_AT: '2026-08-01T12:00:00Z' })).state, 'current');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_LINK: `,${PHOTO}`, PHOTO_NAME: '9.6.26_crop.webp,unknown.webp', AV_RULE_PHOTO_UPDATED_AT: '' })).state, 'undated');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_LINK: '', PHOTO_NAME: '9.6.26_crop.webp' })).state, 'missing');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_NAME: '2026%2D09%2D06.jpg', AV_RULE_PHOTO_UPDATED_AT: '' })).state, 'current');
  assert.equal(ctx.getLocPhotoCaptureEvidence('2026-09-06T18:23:45.000Z.jpg').at, Date.parse('2026-09-06T12:00:00Z'));
});

test('invalid explicit calendar dates cannot fall back to fresh metadata', () => {
  const ctx = runtime();
  for (const name of ['2026-09-31.jpg', '2026-02-30T12:00:00Z', '2026-09-06T99:99:99Z', '9.31.26_crop.jpg', 'bad%name']) {
    assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_NAME: name })).state, 'undated', name);
  }
  for (const stamp of ['now', 'tomorrow', '9/6/26', '2026-09-06', '2026-09-06T12:00:00', '2026-09-31T12:00:00Z']) {
    assert.equal(ctx.getLocPhotoEvidenceState(row({ AV_RULE_PHOTO_UPDATED_AT: stamp })).state, 'undated', stamp);
  }
  assert.equal(ctx.parseLocPhotoEvidenceTimestamp('2026-09-06 18:00:00+00'), NOW - DAY);
});

test('known zeros are retained; malformed/missing measurements cannot use stored fallback', () => {
  const ctx = runtime();
  for (const changes of [{ MATCH: 0 }, { PTRAVAILABLE: 0 }, { INITIAL_PTR: 0 }]) {
    assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(row(changes)), 0);
    assert.equal(ctx.formatLocPhotoMatchQtyValue(row(changes)), '0');
  }
  for (const changes of [{ MATCH: '' }, { MATCH: 'review50' }, { MATCH: '101' }, { MATCH: '-2' },
    { PTRAVAILABLE: '' }, { PTRAVAILABLE: 'unknown' }, { PTRAVAILABLE: '0x10' }, { PHOTO_MATCH_PTR_AVAILABLE_KNOWN: false }, { INITIAL_PTR: 'unknown' }, { INITIAL_PTR: '0x10' }]) {
    assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(row(changes)), null, JSON.stringify(changes));
  }
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(row({ MATCH: '50%' })), 174);
});

test('shared references match production storage paths; only dock context accepts dock photos', () => {
  const ctx = runtime();
  for (const link of ['https://example.com/9.6.26.jpg', PHOTO + '?token=temporary', PHOTO + '#hash',
    PHOTO.replace('crop.webp', '../crop.webp'), PHOTO.replace('crop.webp', '%2e%2e/crop.webp'),
    PHOTO.replace('crop.webp', '%2e%2e%2fcrop.webp'), PHOTO.replace('request_photos', 'dock_photos')]) {
    assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_LINK: link })).state, 'invalid', link);
  }
  const dock = row({ DOCK_PHOTO_LINK: PHOTO.replace('request_photos', 'dock_photos'), DOCK_PHOTO_NAME: '9.6.26_crop.webp' });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(dock, 'docks'), 174);
});

test('request and flyer display evidence belongs to the selected owner only', () => {
  const ctx = runtime();
  const shared = row({ REQ_MATCH: 50, FLYER_MATCH: 50, FLYER_LOC_MATCH_QTY: 99 });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(shared, 'request'), null);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(shared, 'flyer'), null);
  const request = { ...shared, REQ_PHOTO_LINK: PHOTO, REQ_PHOTO_NAME: '9.6.26_crop.webp' };
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), 174);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, REQ_MATCH: '' }, 'request'), null);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, REQ_PHOTO_NAME: '8.1.26_crop.webp' }, 'request'), null);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, PHOTO_LINK: '' }, 'av'), null);
  const flyer = { ...shared, FLYER_PHOTO_LINK: PHOTO, FLYER_PHOTO_NAME: '9.6.26_crop.webp', selectedFlyer: true };
  assert.equal(ctx.getDisplayLocMatchQtyValue(flyer, 'tasks'), '174');
  assert.equal(ctx.getDisplayLocMatchQtyValue({ ...flyer, FLYER_INITIAL_PTR: 400 }, 'tasks'), '147');
  assert.equal(ctx.getDisplayLocMatchQtyValue({ ...flyer, FLYER_MATCH: 0 }, 'tasks'), '0');
  assert.equal(ctx.getDisplayLocMatchQtyValue({ ...flyer, FLYER_PHOTO_LINK: '' }, 'tasks'), '');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...flyer, FLYER_MATCH: '' , MATCH: '' }, 'flyer'), null);
});

test('native owner completion is allowed but unrelated master completion is not', () => {
  const ctx = runtime();
  const request = row({ REQ_MATCH: 50, REQ_PHOTO_LINK: PHOTO, DATE_COMPLETED: '2026-09-06T18:00:00Z' });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), null);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, SOURCE_TABLE: 'ph_active_request' }), 174);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, SOURCE_TABLE: 'ph_request_history' }), 174);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, SOURCE_TABLE: 'ph_active_request', REQ_PHOTO_UPDATED_AT: '2026-08-01T12:00:00Z' }), null);
  assert.equal(ctx.getLocPhotoEvidenceContext({ SOURCE_TABLE: 'ph_flyer_folder_rows' }, 'request'), 'request');
  assert.equal(ctx.getLocPhotoEvidenceContext({ SOURCE_TABLE: 'ph_active_request' }, 'docks'), 'dock');
});

test('existing positive-quantity visibility guards do not mutate raw observations or suppress known zero', () => {
  const ctx = runtime([], { shouldHideSharedAppPayloadForInvalidAvRules(copy) { copy.LOC_MATCH_QTY = 1; return true; } });
  const saved = row();
  assert.equal(ctx.getDisplayLocMatchQtyValue(saved, 'av'), '');
  assert.equal(saved.LOC_MATCH_QTY, '174');
  assert.equal(ctx.getDisplayLocMatchQtyValue(row({ MATCH: 0 }), 'av'), '0');
});

test('lowercase source rows and explicit canonical removal have the same qualification', () => {
  const ctx = runtime();
  const lower = Object.fromEntries(Object.entries(row()).map(([key, value]) => [key.toLowerCase(), value]));
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(lower, 'av'), 174);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...row(), PHOTO_LINK: null, SAVED_PHOTO_LINK: PHOTO, photo_link: PHOTO }), null);
});

test('normalization and remove-photo/keep-data preserve raw measurements and history', () => {
  const ctx = runtime(['normalizeRowPhotoFields', 'getSharedAppPhotoName', 'getProductivitySnapshotLocMatchQty'], {
    normalizeFlyerShadowFields: () => {},
    sortPhotoCsvPairByCaptureOrder: (links, names) => ({ photoCsv: links || '', photoNameCsv: names || '' }),
    mergePhotoCsvList: (values) => values.filter(Boolean).join(','),
  });
  const removed = row({ PHOTO_LINK: null, PHOTO_NAME: null, SAVED_PHOTO_LINK: PHOTO, PHOTOLINK: PHOTO,
    FLYER_PHOTO_LINK: null, flyer_photo_link: PHOTO, FLYERPHOTO_LINK: PHOTO, HISTORY: [{ LOC_MATCH_QTY: 174 }] });
  ctx.normalizeRowPhotoFields(removed);
  assert.equal(removed.MATCH, '50');
  assert.equal(removed.INITIAL_PTR, '347');
  assert.equal(removed.LOC_MATCH_QTY, '174');
  assert.deepEqual(removed.HISTORY, [{ LOC_MATCH_QTY: 174 }]);
  assert.equal(removed.SAVED_PHOTO_LINK, '');
  assert.equal(removed.PHOTOLINK, '');
  assert.equal(removed.FLYERPHOTO_LINK, '');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(removed), null);
  assert.equal(ctx.getProductivitySnapshotLocMatchQty(removed), '174');
});

test('real alias-removal helper drops the last photo without clearing observations', () => {
  const ctx = runtime(['getPhotoAliasFieldsForPrefix', 'setPhotoAliasFieldsForPrefix', 'removePhotoFromAliasFields'], {
    parsePhotoCsvValues: (value) => String(value || '').split(',').map((part) => part.trim()).filter(Boolean),
    mergePhotoCsvList: (values) => [...new Set(values.filter(Boolean).flatMap((value) => value.split(',')))].join(','),
  });
  const saved = row({ SAVED_PHOTO_LINK: PHOTO, SAVED_PHOTO_NAME: 'crop.webp' });
  assert.equal(ctx.removePhotoFromAliasFields(saved, '', PHOTO).removed, true);
  assert.equal(saved.MATCH, '50');
  assert.equal(saved.INITIAL_PTR, '347');
  assert.equal(saved.LOC_MATCH_QTY, '174');
  assert.equal(saved.PHOTO_LINK, '');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), null);
});

test('fetched rows retain explicit photo clears and distinguish missing stock from known zero', () => {
  const ctx = runtime(['formatFetchedRows', 'normalizeRowPhotoFields', 'getSharedAppPhotoName'], {
    normalizeAppTableName: (value) => value,
    normalizeFlyerShadowFields: () => {}, repairDisplayFieldsOnRow: () => {},
    sortPhotoCsvPairByCaptureOrder: (links, names) => ({ photoCsv: links || '', photoNameCsv: names || '' }),
    mergePhotoCsvList: (values) => values.filter(Boolean).join(','),
  });
  const raw = { photo_link: null, saved_photo_link: PHOTO, match: 50, initial_ptr: 347, loc_match_qty: 174 };
  const [formatted] = ctx.formatFetchedRows([raw], 'ph_master_inventory');
  assert.equal(formatted.PHOTO_LINK, '');
  assert.equal(formatted.LOC_MATCH_QTY, 174);
  assert.equal(formatted.PHOTO_MATCH_PTR_AVAILABLE_KNOWN, false);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(formatted), null);
  assert.equal(ctx.formatFetchedRows([{ ...raw, ptravailable: 0 }], 'ph_master_inventory')[0].PHOTO_MATCH_PTR_AVAILABLE_KNOWN, true);
});

test('known thumbnail failure invalidates only that card display and does not fetch originals', () => {
  const ctx = runtime(['invalidateCardPhotoMatchOnLoadFailure', 'hydrateDeferredCardPhoto']);
  const output = { textContent: '174', setAttribute(name, value) { this[name] = value; } };
  const card = { querySelectorAll: () => [output] };
  const image = { dataset: { src: PHOTO }, classList: { add() {} }, closest: () => card };
  ctx.hydrateDeferredCardPhoto(image);
  assert.equal(image.src, PHOTO);
  image.onerror();
  assert.equal(output.textContent, 'Not verified');
  assert.equal(image.dataset.photoLoadFailed, '1');
  assert.equal(image.src, PHOTO);
  assert.match(output.title, /could not be loaded/);
  assert.doesNotMatch(source('invalidateCardPhotoMatchOnLoadFailure'), /activeItem|LOC_MATCH_QTY\s*=|fetch\(/);
  assert.match(source('renderAvDetailHero'), /onerror="invalidateCardPhotoMatchOnLoadFailure\(this\)"/);
});

test('authoritative stock updates refresh unknown-stock qualification without a reload', () => {
  const ctx = runtime(['applyMasterSyncPayloadToLocalRow'], {
    normalizeRowPhotoFields: (item) => item,
    repairDisplayFieldsOnRow: () => {},
    buildSearchIndex: () => {},
  });
  const saved = row({ PTRAVAILABLE: 0, PHOTO_MATCH_PTR_AVAILABLE_KNOWN: false });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), null);
  ctx.applyMasterSyncPayloadToLocalRow(saved, { ptravailable: '347' });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), 174);
  ctx.applyMasterSyncPayloadToLocalRow(saved, { ptravailable: 0 });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), 0);
  ctx.applyMasterSyncPayloadToLocalRow(saved, { ptravailable: null });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), null);
  assert.equal(saved.LOC_MATCH_QTY, '174');
});

test('public cards, shares, exports and previews use projections; invalidation is not destructive', () => {
  assert.match(source('getAvOpenStockLocPhotoMatch'), /formatLocPhotoMatchQtyValue/);
  assert.match(source('getAVExportColumns'), /label: 'Loc Photo Match', value: \(row\) => formatLocPhotoMatchQtyValue/);
  assert.match(source('getDriveColumnItemValue'), /case 'LOC_MATCH_QTY':\s*return formatLocPhotoMatchQtyValue/);
  assert.match(source('getDockSuspendDcRequestEmailFieldRows'), /formatLocPhotoMatchQtyValue\(row, 'request'\)/);
  assert.match(source('buildNcrEmailItemPayload'), /loc_match_qty: locMatchQty/);
  assert.match(source('buildNcrEmailItemPayload'), /getPhotoQualifiedLocMatchQtyValue/);
  assert.doesNotMatch(source('getMasterAvInvalidationReasons'), /getLocPhotoEvidenceState|getPhotoQualifiedLocMatchQtyValue|photo_missing|photo_date_future/);
  assert.doesNotMatch(source('normalizeRowPhotoFields'), /calculateLocMatchQtyValue|LOC_MATCH_QTY\s*=/);
  assert.match(source('calculateMatchQty'), /getPhotoQualifiedLocMatchQtyValue/);
  assert.match(source('calculateMatchQty'), /Not verified/);
  assert.doesNotMatch(html, /V2026\.09\.06\.02/);
});
